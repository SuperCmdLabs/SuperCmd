import { app } from 'electron';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type ScriptCommandMode = 'fullOutput' | 'compact' | 'silent' | 'inline';
export type ScriptArgumentType = 'text' | 'password' | 'dropdown';

export interface ScriptArgumentDefinition {
  name: string;
  index: number;
  type: ScriptArgumentType;
  placeholder: string;
  required: boolean;
  percentEncoded?: boolean;
  data?: Array<{ title?: string; value?: string }>;
}

export interface ScriptCommandInfo {
  id: string;
  title: string;
  mode: ScriptCommandMode;
  description?: string;
  packageName?: string;
  iconDataUrl?: string;
  iconEmoji?: string;
  scriptPath: string;
  scriptDir: string;
  slug: string;
  refreshTime?: string;
  interval?: string;
  currentDirectoryPath?: string;
  needsConfirmation: boolean;
  arguments: ScriptArgumentDefinition[];
  keywords: string[];
}

export interface ScriptExecutionResult {
  commandId: string;
  title: string;
  mode: ScriptCommandMode;
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  firstLine: string;
  lastLine: string;
  message: string;
  packageName?: string;
}

const CACHE_TTL_MS = 12_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // 2MB
const DEFAULT_TIMEOUT_MS = 60_000;

let cache: { fetchedAt: number; commands: ScriptCommandInfo[] } | null = null;

function getSuperCmdScriptsDir(): string {
  const dir = path.join(app.getPath('userData'), 'script-commands');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function expandHome(inputPath: string): string {
  const raw = String(inputPath || '').trim();
  if (!raw) return raw;
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function getScriptCommandDirectories(): string[] {
  const fromEnv = String(process.env.SUPERCMD_SCRIPT_COMMAND_PATHS || '')
    .split(path.delimiter)
    .map((v) => expandHome(v))
    .filter(Boolean);

  const defaults = [
    getSuperCmdScriptsDir(),
    path.join(os.homedir(), 'raycast', 'script-commands'),
    path.join(os.homedir(), 'raycast', 'scripts'),
    path.join(os.homedir(), '.raycast', 'script-commands'),
    path.join(os.homedir(), '.config', 'raycast', 'script-commands'),
  ];

  const unique = new Set<string>();
  for (const dir of [...defaults, ...fromEnv]) {
    const normalized = path.resolve(expandHome(dir));
    unique.add(normalized);
  }

  return [...unique];
}

function isLikelyEmoji(value: string): boolean {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw.includes('/') || raw.includes('\\')) return false;
  if (/^https?:\/\//i.test(raw)) return false;
  if (/^\w+(\.\w+)?$/.test(raw)) return false;
  return true;
}

function fileToDataUrl(filePath: string): string | undefined {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.svg'].includes(ext)) return undefined;
    const buf = fs.readFileSync(filePath);
    const mime =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

function resolveIcon(
  rawIcon: string,
  scriptDir: string
): { iconDataUrl?: string; iconEmoji?: string } {
  const icon = String(rawIcon || '').trim();
  if (!icon) return {};

  if (isLikelyEmoji(icon)) {
    return { iconEmoji: icon };
  }

  if (/^https:\/\/.+/i.test(icon)) {
    return { iconDataUrl: icon };
  }

  const expanded = expandHome(icon);
  const iconPath = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(scriptDir, expanded);
  if (!fs.existsSync(iconPath)) return {};

  const dataUrl = fileToDataUrl(iconPath);
  if (dataUrl) return { iconDataUrl: dataUrl };
  return {};
}

function slugifyScriptName(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  return base
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function hashScriptId(filePath: string): string {
  const digest = crypto
    .createHash('sha1')
    .update(path.resolve(filePath))
    .digest('hex')
    .slice(0, 16);
  return `script-${digest}`;
}

function parseBoolean(input: any): boolean {
  if (typeof input === 'boolean') return input;
  const raw = String(input || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function parseMode(input: string): ScriptCommandMode | null {
  const raw = String(input || '').trim();
  if (raw === 'fullOutput') return 'fullOutput';
  if (raw === 'compact') return 'compact';
  if (raw === 'silent') return 'silent';
  if (raw === 'inline') return 'inline';
  return null;
}

function normalizeRefreshTime(input: string): string | undefined {
  const raw = String(input || '').trim();
  const match = raw.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return undefined;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return undefined;

  if (unit === 's' && value < 10) {
    return '10s';
  }
  return `${value}${unit}`;
}

function parseArgumentDefinition(raw: string, index: number): ScriptArgumentDefinition | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  let parsed: any = {};
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const typeRaw = String(parsed?.type || 'text').trim().toLowerCase();
  const type: ScriptArgumentType =
    typeRaw === 'password' ? 'password' : typeRaw === 'dropdown' ? 'dropdown' : 'text';
  const placeholder = String(parsed?.placeholder || `Argument ${index}`).trim() || `Argument ${index}`;
  const required =
    parsed?.required !== undefined
      ? parseBoolean(parsed.required)
      : !parseBoolean(parsed?.optional);
  const percentEncoded = parseBoolean(parsed?.percentEncoded);

  const data =
    type === 'dropdown' && Array.isArray(parsed?.data)
      ? parsed.data
          .map((entry: any) => ({
            title: entry?.title !== undefined ? String(entry.title) : undefined,
            value: entry?.value !== undefined ? String(entry.value) : undefined,
          }))
          .filter((entry: { title?: string; value?: string }) => entry.title || entry.value)
      : undefined;

  return {
    name: `argument${index}`,
    index,
    type,
    placeholder,
    required,
    percentEncoded: percentEncoded ? true : undefined,
    data,
  };
}

function stripAnsi(input: string): string {
  return String(input || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function firstNonEmptyLine(input: string): string {
  const lines = String(input || '')
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean);
  return lines[0] || '';
}

function lastNonEmptyLine(input: string): string {
  const lines = String(input || '')
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean);
  return lines[lines.length - 1] || '';
}

function toKeywordParts(input: string): string[] {
  return String(input || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function discoverScriptFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const out: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.includes('.template.')) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      out.push(fullPath);
    }
  }

  return out;
}

function parseScriptCommandFile(filePath: string): ScriptCommandInfo | null {
  const scriptPath = path.resolve(filePath);
  const scriptDir = path.dirname(scriptPath);

  let raw = '';
  try {
    raw = fs.readFileSync(scriptPath, 'utf-8');
  } catch {
    return null;
  }

  if (!raw.trim()) return null;

  const lines = raw.split(/\r?\n/);
  const metadata: Record<string, string> = {};
  const argumentDefs = new Map<number, ScriptArgumentDefinition>();

  for (const line of lines.slice(0, 120)) {
    const match = line.match(/^\s*(#|\/\/|--)\s*@raycast\.([A-Za-z0-9]+)\s*(.*)$/);
    if (!match) continue;
    const key = String(match[2] || '').trim();
    const value = String(match[3] || '').trim();
    if (!key) continue;

    const argMatch = key.match(/^argument([1-3])$/);
    if (argMatch) {
      const idx = Number(argMatch[1]);
      const parsedArg = parseArgumentDefinition(value, idx);
      if (parsedArg) argumentDefs.set(idx, parsedArg);
      continue;
    }

    metadata[key] = value;
  }

  if (String(metadata.schemaVersion || '').trim() !== '1') return null;
  const title = String(metadata.title || '').trim();
  if (!title) return null;

  const parsedMode = parseMode(metadata.mode);
  if (!parsedMode) return null;

  const refreshTime = normalizeRefreshTime(metadata.refreshTime || '');
  const mode: ScriptCommandMode =
    parsedMode === 'inline' && !refreshTime ? 'compact' : parsedMode;

  const currentDirectoryPathRaw = String(metadata.currentDirectoryPath || '').trim();
  const currentDirectoryPath = currentDirectoryPathRaw
    ? path.isAbsolute(expandHome(currentDirectoryPathRaw))
      ? path.resolve(expandHome(currentDirectoryPathRaw))
      : path.resolve(scriptDir, currentDirectoryPathRaw)
    : undefined;

  const packageName =
    String(metadata.packageName || '').trim() ||
    path.basename(scriptDir);

  const iconValue = String(metadata.iconDark || metadata.icon || '').trim();
  const { iconDataUrl, iconEmoji } = resolveIcon(iconValue, scriptDir);

  const slug = slugifyScriptName(scriptPath);
  if (!slug) return null;

  const id = hashScriptId(scriptPath);
  const description = String(metadata.description || '').trim() || undefined;
  const needsConfirmation = parseBoolean(metadata.needsConfirmation);
  const argumentsList = [...argumentDefs.values()].sort((a, b) => a.index - b.index);

  const keywords = [
    ...toKeywordParts(title),
    ...toKeywordParts(description || ''),
    ...toKeywordParts(packageName),
    ...toKeywordParts(path.basename(scriptPath)),
    'script',
    'command',
  ];

  return {
    id,
    title,
    mode,
    description,
    packageName,
    iconDataUrl,
    iconEmoji,
    scriptPath,
    scriptDir,
    slug,
    refreshTime,
    interval: mode === 'inline' ? refreshTime : undefined,
    currentDirectoryPath,
    needsConfirmation,
    arguments: argumentsList,
    keywords: Array.from(new Set(keywords)),
  };
}

export function invalidateScriptCommandsCache(): void {
  cache = null;
}

export function discoverScriptCommands(): ScriptCommandInfo[] {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.commands;
  }

  const results: ScriptCommandInfo[] = [];
  for (const dir of getScriptCommandDirectories()) {
    const files = discoverScriptFiles(dir);
    for (const filePath of files) {
      const parsed = parseScriptCommandFile(filePath);
      if (parsed) results.push(parsed);
    }
  }

  results.sort((a, b) => a.title.localeCompare(b.title));
  cache = { fetchedAt: now, commands: results };
  return results;
}

export function getScriptCommandById(id: string): ScriptCommandInfo | null {
  return discoverScriptCommands().find((cmd) => cmd.id === id) || null;
}

export function getScriptCommandBySlug(slug: string): ScriptCommandInfo | null {
  const normalized = String(slug || '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;

  return (
    discoverScriptCommands().find((cmd) => {
      if (cmd.slug === normalized) return true;
      const base = slugifyScriptName(cmd.scriptPath);
      return base === normalized;
    }) || null
  );
}

function shebangArgs(firstLine: string): string[] {
  const raw = String(firstLine || '').trim();
  if (!raw.startsWith('#!')) return [];
  const body = raw.slice(2).trim();
  if (!body) return [];
  return body.split(/\s+/g).filter(Boolean);
}

function buildScriptArgs(
  cmd: ScriptCommandInfo,
  argumentValues?: Record<string, any>
): { args: string[]; missing: ScriptArgumentDefinition[] } {
  const values = argumentValues || {};
  const args: string[] = [];
  const missing: ScriptArgumentDefinition[] = [];

  for (const def of cmd.arguments) {
    const rawValue = values[def.name];
    const value = rawValue === undefined || rawValue === null ? '' : String(rawValue);
    if (!value.trim() && def.required) {
      missing.push(def);
    }

    if (!value.trim()) {
      args.push('');
      continue;
    }

    args.push(def.percentEncoded ? encodeURIComponent(value) : value);
  }

  return { args, missing };
}

export async function executeScriptCommand(
  commandId: string,
  argumentValues?: Record<string, any>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<
  | ScriptExecutionResult
  | {
      missingArguments: ScriptArgumentDefinition[];
      command: ScriptCommandInfo;
    }
> {
  const cmd = getScriptCommandById(commandId);
  if (!cmd) {
    throw new Error(`Script command not found: ${commandId}`);
  }

  const { args, missing } = buildScriptArgs(cmd, argumentValues);
  if (missing.length > 0) {
    return { missingArguments: missing, command: cmd };
  }

  const source = fs.readFileSync(cmd.scriptPath, 'utf-8');
  const firstLine = source.split(/\r?\n/)[0] || '';
  const shebang = shebangArgs(firstLine);

  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''}:/usr/local/bin`,
    RAYCAST_TITLE: cmd.title,
    RAYCAST_MODE: cmd.mode,
    RAYCAST_COMMAND_ID: cmd.id,
    RAYCAST_SCRIPT_PATH: cmd.scriptPath,
    RAYCAST_PACKAGE_NAME: cmd.packageName || '',
  };

  const cwd = cmd.currentDirectoryPath || cmd.scriptDir;

  const spawnCommand =
    shebang.length > 0 ? shebang[0] : '/bin/bash';
  const spawnArgs =
    shebang.length > 0
      ? [...shebang.slice(1), cmd.scriptPath, ...args]
      : [cmd.scriptPath, ...args];

  const run = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const proc = spawn(spawnCommand, spawnArgs, {
      cwd,
      env,
      shell: false,
    });

    const finalize = (payload: { stdout: string; stderr: string; exitCode: number }) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    proc.stdout.on('data', (chunk: Buffer | string) => {
      const text = String(chunk || '');
      stdoutBytes += Buffer.byteLength(text, 'utf-8');
      if (stdoutBytes <= MAX_OUTPUT_BYTES) {
        stdout += text;
      }
      if (stdoutBytes > MAX_OUTPUT_BYTES && !settled) {
        try { proc.kill(); } catch {}
        finalize({
          stdout,
          stderr: `${stderr}\nOutput exceeded 2MB limit.`,
          exitCode: 1,
        });
      }
    });

    proc.stderr.on('data', (chunk: Buffer | string) => {
      const text = String(chunk || '');
      stderrBytes += Buffer.byteLength(text, 'utf-8');
      if (stderrBytes <= MAX_OUTPUT_BYTES) {
        stderr += text;
      }
      if (stderrBytes > MAX_OUTPUT_BYTES && !settled) {
        try { proc.kill(); } catch {}
        finalize({
          stdout,
          stderr: `${stderr}\nError output exceeded 2MB limit.`,
          exitCode: 1,
        });
      }
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      try { proc.kill(); } catch {}
      finalize({
        stdout,
        stderr: `${stderr}\nScript timed out after ${Math.round(timeoutMs / 1000)}s.`,
        exitCode: 124,
      });
    }, timeoutMs);

    proc.on('close', (code: number | null) => {
      clearTimeout(timeout);
      finalize({
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : 1,
      });
    });

    proc.on('error', (error: Error) => {
      clearTimeout(timeout);
      finalize({
        stdout,
        stderr: `${stderr}\n${error.message}`,
        exitCode: 1,
      });
    });
  });

  const combined = [run.stdout, run.stderr].filter(Boolean).join('\n').trim();
  const firstLineOut = firstNonEmptyLine(run.stdout || combined);
  const lastLineOut = lastNonEmptyLine(combined);
  const message = (run.exitCode === 0 ? lastLineOut : lastLineOut || 'Script failed') || '';

  return {
    commandId: cmd.id,
    title: cmd.title,
    mode: cmd.mode,
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    output: combined,
    firstLine: firstLineOut,
    lastLine: lastLineOut,
    message,
    packageName: cmd.packageName,
  };
}

function buildTemplateScript(title: string): string {
  const escapedTitle = title.replace(/"/g, '\\"');
  return `#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title ${escapedTitle}
# @raycast.mode fullOutput

# Optional parameters:
# @raycast.packageName SuperCmd
# @raycast.icon 💡

# Documentation:
# @raycast.description Describe what this command does

echo "Hello from ${escapedTitle}"
`;
}

export function createScriptCommandTemplate(): { scriptPath: string; scriptsDir: string } {
  const scriptsDir = getSuperCmdScriptsDir();
  const baseName = 'custom-script-command';
  let targetPath = path.join(scriptsDir, `${baseName}.sh`);
  let seq = 2;
  while (fs.existsSync(targetPath)) {
    targetPath = path.join(scriptsDir, `${baseName}-${seq}.sh`);
    seq += 1;
  }

  const title = path
    .basename(targetPath, path.extname(targetPath))
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

  fs.writeFileSync(targetPath, buildTemplateScript(title), { mode: 0o755 });
  try {
    fs.chmodSync(targetPath, 0o755);
  } catch {}

  invalidateScriptCommandsCache();
  return { scriptPath: targetPath, scriptsDir };
}

export function ensureSampleScriptCommand(): {
  scriptsDir: string;
  scriptPath?: string;
  created: boolean;
} {
  const scriptsDir = getSuperCmdScriptsDir();
  const hasAnyScriptCommand = discoverScriptFiles(scriptsDir)
    .some((filePath) => Boolean(parseScriptCommandFile(filePath)));
  if (hasAnyScriptCommand) {
    return { scriptsDir, created: false };
  }

  const sampleTitle = 'Sample Script Command';
  const sampleBaseName = 'sample-script-command';
  let targetPath = path.join(scriptsDir, `${sampleBaseName}.sh`);
  let seq = 2;
  while (fs.existsSync(targetPath)) {
    targetPath = path.join(scriptsDir, `${sampleBaseName}-${seq}.sh`);
    seq += 1;
  }

  fs.writeFileSync(targetPath, buildTemplateScript(sampleTitle), { mode: 0o755 });
  try {
    fs.chmodSync(targetPath, 0o755);
  } catch {}

  invalidateScriptCommandsCache();
  return { scriptsDir, scriptPath: targetPath, created: true };
}

export function getSuperCmdScriptCommandsDirectory(): string {
  return getSuperCmdScriptsDir();
}
