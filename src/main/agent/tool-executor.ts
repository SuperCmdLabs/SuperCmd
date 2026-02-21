/**
 * Tool Executor — maps tool names to direct function calls.
 *
 * Runs in the main process. Calls the same Node.js APIs that existing
 * IPC handlers use, but directly (no IPC round-trip needed).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { clipboard } from 'electron';
import { searchMemories, addMemory } from '../memory';
import { loadSettings } from '../settings-store';

interface ToolResult {
  success: boolean;
  output: string;
}

type ToolExecutor = (args: Record<string, any>) => Promise<ToolResult>;

const MAX_OUTPUT = 8000;

function truncate(text: string, limit = MAX_OUTPUT): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '\n...(truncated)';
}

function resolvePath(p: string): string {
  const input = String(p || '').trim();
  if (!input) return input;
  if (input.startsWith('~/') || input === '~') {
    return path.join(os.homedir(), input.slice(1));
  }
  if (path.isAbsolute(input)) {
    return path.normalize(input);
  }
  return path.join(os.homedir(), input);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = -1;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[idx]}`;
}

interface DirSizeState {
  nodesVisited: number;
  maxNodes: number;
  truncated: boolean;
}

function computeRecursiveSize(targetPath: string, state: DirSizeState): number {
  if (state.nodesVisited >= state.maxNodes) {
    state.truncated = true;
    return 0;
  }
  state.nodesVisited += 1;

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(targetPath);
  } catch {
    return 0;
  }

  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;

  let total = 0;
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(targetPath);
  } catch {
    return 0;
  }

  for (const name of entries) {
    if (state.nodesVisited >= state.maxNodes) {
      state.truncated = true;
      break;
    }
    total += computeRecursiveSize(path.join(targetPath, name), state);
  }
  return total;
}

function normalizePositiveInt(value: any, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

function toRelativeHomePath(absPath: string): string {
  const home = os.homedir();
  if (absPath === home) return '~';
  if (absPath.startsWith(`${home}${path.sep}`)) {
    return `~${absPath.slice(home.length)}`;
  }
  return absPath;
}

function safeError(e: any): string {
  return e?.message ? String(e.message) : 'Unknown error';
}

function ensureParentDirectory(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function assertNotCriticalDeleteTarget(targetPath: string): string | null {
  const normalized = path.resolve(targetPath);
  const home = path.resolve(os.homedir());
  const blocked = new Set(['/', '/Users', '/System', '/Applications', home]);
  if (blocked.has(normalized)) {
    return `Refusing to delete critical path: ${normalized}`;
  }
  return null;
}

function copyRecursive(source: string, destination: string): void {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.cpSync(source, destination, { recursive: true });
    return;
  }
  ensureParentDirectory(destination);
  fs.copyFileSync(source, destination);
}

function serializePathInfo(targetPath: string): ToolResult {
  try {
    const stat = fs.statSync(targetPath);
    const info: Record<string, any> = {
      path: targetPath,
      pathDisplay: toRelativeHomePath(targetPath),
      exists: true,
      type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
      sizeBytes: stat.size,
      sizeHuman: formatBytes(stat.size),
      modifiedAt: stat.mtime.toISOString(),
      createdAt: stat.birthtime.toISOString(),
      readable: true,
      writable: true,
    };
    if (stat.isDirectory()) {
      try {
        info.entryCount = fs.readdirSync(targetPath).length;
      } catch {
        info.entryCount = null;
      }
    }
    return { success: true, output: truncate(JSON.stringify(info, null, 2)) };
  } catch (e: any) {
    return { success: false, output: `Error: ${safeError(e)}` };
  }
}

function walkFindPaths(
  basePath: string,
  queryLower: string,
  type: 'all' | 'file' | 'directory',
  maxDepth: number,
  maxResults: number,
  includeHidden: boolean
): string[] {
  const results: string[] = [];

  const walk = (currentPath: string, depth: number) => {
    if (results.length >= maxResults || depth > maxDepth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (!includeHidden && isHiddenName(entry.name)) continue;

      const fullPath = path.join(currentPath, entry.name);
      const isDir = entry.isDirectory();
      const isFile = entry.isFile();
      const nameMatch = entry.name.toLowerCase().includes(queryLower);
      const typeMatch =
        type === 'all' || (type === 'directory' && isDir) || (type === 'file' && isFile);

      if (nameMatch && typeMatch) {
        results.push(fullPath);
      }
      if (isDir && depth < maxDepth) {
        walk(fullPath, depth + 1);
      }
    }
  };

  walk(basePath, 0);
  return results;
}

function walkFilesForContentSearch(
  basePath: string,
  maxDepth: number,
  includeHidden: boolean
): string[] {
  const files: string[] = [];
  const walk = (currentPath: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!includeHidden && isHiddenName(entry.name)) continue;
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };

  walk(basePath, 0);
  return files;
}

const executors: Record<string, ToolExecutor> = {
  exec_command: async (args) => {
    const command = String(args.command || '');
    if (!command) return { success: false, output: 'No command provided.' };

    const cwd = resolvePath(args.cwd || '~');

    try {
      const stdout = execSync(command, {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        shell: '/bin/sh',
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: truncate(stdout) };
    } catch (e: any) {
      const stdout = e.stdout ? String(e.stdout) : '';
      const stderr = e.stderr ? String(e.stderr) : '';
      const exitCode = e.status ?? 1;
      return {
        success: false,
        output: truncate(
          `Exit code: ${exitCode}\n${stdout ? `stdout:\n${stdout}\n` : ''}${stderr ? `stderr:\n${stderr}` : e.message || 'Command failed'}`
        ),
      };
    }
  },

  run_applescript: async (args) => {
    const script = String(args.script || '');
    if (!script) return { success: false, output: 'No script provided.' };

    try {
      const stdout = execSync(`osascript -e ${JSON.stringify(script)}`, {
        timeout: 15_000,
        maxBuffer: 512 * 1024,
        encoding: 'utf-8',
      });
      return { success: true, output: truncate(stdout) };
    } catch (e: any) {
      return {
        success: false,
        output: e.stderr ? String(e.stderr).slice(0, 2000) : (e.message || 'AppleScript failed'),
      };
    }
  },

  read_file: async (args) => {
    const filePath = resolvePath(String(args.path || ''));
    if (!filePath) return { success: false, output: 'No path provided.' };

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, output: truncate(content) };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  write_file: async (args) => {
    const filePath = resolvePath(String(args.path || ''));
    const content = String(args.content ?? '');
    if (!filePath) return { success: false, output: 'No path provided.' };

    try {
      ensureParentDirectory(filePath);
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true, output: `Written ${content.length} bytes to ${filePath}` };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  create_directory: async (args) => {
    const dirPath = resolvePath(String(args.path || ''));
    if (!dirPath) return { success: false, output: 'No path provided.' };
    const recursive = args.recursive !== false;

    try {
      fs.mkdirSync(dirPath, { recursive });
      return { success: true, output: `Directory ready: ${toRelativeHomePath(dirPath)}` };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  copy_path: async (args) => {
    const sourcePath = resolvePath(String(args.source || ''));
    const destinationPath = resolvePath(String(args.destination || ''));
    if (!sourcePath) return { success: false, output: 'No source provided.' };
    if (!destinationPath) return { success: false, output: 'No destination provided.' };
    const overwrite = Boolean(args.overwrite);

    try {
      if (!fs.existsSync(sourcePath)) {
        return { success: false, output: `Error: Source does not exist: ${sourcePath}` };
      }
      if (fs.existsSync(destinationPath)) {
        if (!overwrite) {
          return { success: false, output: `Error: Destination exists: ${destinationPath}` };
        }
        fs.rmSync(destinationPath, { recursive: true, force: true });
      }
      copyRecursive(sourcePath, destinationPath);
      return {
        success: true,
        output: `Copied:\n${toRelativeHomePath(sourcePath)}\n→ ${toRelativeHomePath(destinationPath)}`,
      };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  move_path: async (args) => {
    const sourcePath = resolvePath(String(args.source || ''));
    const destinationPath = resolvePath(String(args.destination || ''));
    if (!sourcePath) return { success: false, output: 'No source provided.' };
    if (!destinationPath) return { success: false, output: 'No destination provided.' };
    const overwrite = Boolean(args.overwrite);

    try {
      if (!fs.existsSync(sourcePath)) {
        return { success: false, output: `Error: Source does not exist: ${sourcePath}` };
      }
      if (fs.existsSync(destinationPath)) {
        if (!overwrite) {
          return { success: false, output: `Error: Destination exists: ${destinationPath}` };
        }
        fs.rmSync(destinationPath, { recursive: true, force: true });
      } else {
        ensureParentDirectory(destinationPath);
      }
      fs.renameSync(sourcePath, destinationPath);
      return {
        success: true,
        output: `Moved:\n${toRelativeHomePath(sourcePath)}\n→ ${toRelativeHomePath(destinationPath)}`,
      };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  rename_path: async (args) => {
    const sourcePath = resolvePath(String(args.path || ''));
    const newName = String(args.newName || '').trim();
    if (!sourcePath) return { success: false, output: 'No path provided.' };
    if (!newName) return { success: false, output: 'No newName provided.' };
    if (newName.includes(path.sep)) {
      return { success: false, output: 'newName must be a single file/folder name.' };
    }
    const overwrite = Boolean(args.overwrite);

    try {
      if (!fs.existsSync(sourcePath)) {
        return { success: false, output: `Error: Path does not exist: ${sourcePath}` };
      }
      const destinationPath = path.join(path.dirname(sourcePath), newName);
      if (fs.existsSync(destinationPath)) {
        if (!overwrite) {
          return { success: false, output: `Error: Target exists: ${destinationPath}` };
        }
        fs.rmSync(destinationPath, { recursive: true, force: true });
      }
      fs.renameSync(sourcePath, destinationPath);
      return {
        success: true,
        output: `Renamed:\n${toRelativeHomePath(sourcePath)}\n→ ${toRelativeHomePath(destinationPath)}`,
      };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  delete_path: async (args) => {
    const targetPath = resolvePath(String(args.path || ''));
    if (!targetPath) return { success: false, output: 'No path provided.' };
    const recursive = args.recursive !== false;

    const criticalError = assertNotCriticalDeleteTarget(targetPath);
    if (criticalError) {
      return { success: false, output: criticalError };
    }

    try {
      if (!fs.existsSync(targetPath)) {
        return { success: false, output: `Error: Path does not exist: ${targetPath}` };
      }
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        if (!recursive) {
          return { success: false, output: 'Target is a directory. Set recursive=true to delete it.' };
        }
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.rmSync(targetPath, { force: true });
      }
      return { success: true, output: `Deleted: ${toRelativeHomePath(targetPath)}` };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  read_dir: async (args) => {
    const dirPath = resolvePath(String(args.path || ''));
    if (!dirPath) return { success: false, output: 'No path provided.' };

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      if (entries.length === 0) return { success: true, output: '(empty directory)' };
      const lines = entries.map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
      return { success: true, output: truncate(lines.join('\n')) };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  path_info: async (args) => {
    const targetPath = resolvePath(String(args.path || ''));
    if (!targetPath) return { success: false, output: 'No path provided.' };
    return serializePathInfo(targetPath);
  },

  find_paths: async (args) => {
    const basePath = resolvePath(String(args.path || ''));
    const query = String(args.query || '').trim();
    if (!basePath) return { success: false, output: 'No path provided.' };
    if (!query) return { success: false, output: 'No query provided.' };

    const typeRaw = String(args.type || 'all').toLowerCase();
    const type: 'all' | 'file' | 'directory' =
      typeRaw === 'file' || typeRaw === 'directory' ? typeRaw : 'all';
    const maxDepth = normalizePositiveInt(args.maxDepth, 5, 20);
    const maxResults = normalizePositiveInt(args.maxResults, 50, 200);
    const includeHidden = Boolean(args.includeHidden);

    try {
      const stat = fs.statSync(basePath);
      if (!stat.isDirectory()) {
        return { success: false, output: `Error: Not a directory: ${basePath}` };
      }
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }

    const matches = walkFindPaths(
      basePath,
      query.toLowerCase(),
      type,
      maxDepth,
      maxResults,
      includeHidden
    );
    if (matches.length === 0) {
      return { success: true, output: 'No matching paths found.' };
    }

    const out = [
      `Found ${matches.length} path(s):`,
      ...matches.map((p, i) => `${i + 1}. ${toRelativeHomePath(p)}`),
    ].join('\n');
    return { success: true, output: truncate(out) };
  },

  search_file_content: async (args) => {
    const basePath = resolvePath(String(args.path || ''));
    const query = String(args.query || '');
    if (!basePath) return { success: false, output: 'No path provided.' };
    if (!query) return { success: false, output: 'No query provided.' };

    const maxDepth = normalizePositiveInt(args.maxDepth, 6, 20);
    const maxResults = normalizePositiveInt(args.maxResults, 80, 500);
    const includeHidden = Boolean(args.includeHidden);
    const caseSensitive = Boolean(args.caseSensitive);
    const queryNorm = caseSensitive ? query : query.toLowerCase();

    try {
      const stat = fs.statSync(basePath);
      if (!stat.isDirectory()) {
        return { success: false, output: `Error: Not a directory: ${basePath}` };
      }
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }

    const files = walkFilesForContentSearch(basePath, maxDepth, includeHidden);
    const lines: string[] = [];

    for (const filePath of files) {
      if (lines.length >= maxResults) break;
      let content = '';
      try {
        const st = fs.statSync(filePath);
        if (st.size > 512 * 1024) continue;
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const split = content.split(/\r?\n/);
      for (let i = 0; i < split.length; i++) {
        if (lines.length >= maxResults) break;
        const line = split[i];
        const hay = caseSensitive ? line : line.toLowerCase();
        if (hay.includes(queryNorm)) {
          lines.push(`${toRelativeHomePath(filePath)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    if (lines.length === 0) return { success: true, output: 'No text matches found.' };
    return {
      success: true,
      output: truncate(`Found ${lines.length} match(es):\n${lines.join('\n')}`),
    };
  },

  replace_in_file: async (args) => {
    const filePath = resolvePath(String(args.path || ''));
    const findText = String(args.find ?? '');
    const replaceText = String(args.replace ?? '');
    if (!filePath) return { success: false, output: 'No path provided.' };
    if (!findText) return { success: false, output: 'No find text provided.' };

    const all = args.all !== false;
    const caseSensitive = args.caseSensitive !== false;
    const dryRun = Boolean(args.dryRun);

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { success: false, output: `Error: Not a file: ${filePath}` };

      const source = fs.readFileSync(filePath, 'utf-8');
      const flags = all ? 'g' : '';
      const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, `${flags}${caseSensitive ? '' : 'i'}`);
      const matches = source.match(re);
      const count = matches ? matches.length : 0;
      if (count === 0) return { success: true, output: 'No matches found. No changes made.' };

      const next = source.replace(re, replaceText);
      if (dryRun) {
        return {
          success: true,
          output: `Dry run: ${count} replacement(s) planned in ${toRelativeHomePath(filePath)}.`,
        };
      }

      fs.writeFileSync(filePath, next, 'utf-8');
      return {
        success: true,
        output: `Updated ${toRelativeHomePath(filePath)} with ${count} replacement(s).`,
      };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  top_largest_entries: async (args) => {
    const basePath = resolvePath(String(args.path || ''));
    if (!basePath) return { success: false, output: 'No path provided.' };
    const limit = normalizePositiveInt(args.limit, 15, 100);
    const includeHidden = Boolean(args.includeHidden);
    const recursiveDirSize = args.recursiveDirSize !== false;

    let entries: fs.Dirent[] = [];
    try {
      const stat = fs.statSync(basePath);
      if (!stat.isDirectory()) {
        return { success: false, output: `Error: Not a directory: ${basePath}` };
      }
      entries = fs.readdirSync(basePath, { withFileTypes: true });
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }

    const sized: Array<{ name: string; isDirectory: boolean; size: number }> = [];
    const sizeState: DirSizeState = { nodesVisited: 0, maxNodes: 50_000, truncated: false };

    for (const entry of entries) {
      if (!includeHidden && isHiddenName(entry.name)) continue;
      const fullPath = path.join(basePath, entry.name);
      let size = 0;

      try {
        if (entry.isDirectory()) {
          if (recursiveDirSize) {
            size = computeRecursiveSize(fullPath, sizeState);
          } else {
            const children = fs.readdirSync(fullPath, { withFileTypes: true });
            size = children.reduce((acc, child) => {
              if (!child.isFile()) return acc;
              try {
                return acc + fs.statSync(path.join(fullPath, child.name)).size;
              } catch {
                return acc;
              }
            }, 0);
          }
        } else if (entry.isFile()) {
          size = fs.statSync(fullPath).size;
        } else {
          continue;
        }
      } catch {
        continue;
      }

      sized.push({ name: entry.name, isDirectory: entry.isDirectory(), size });
    }

    sized.sort((a, b) => b.size - a.size);
    const top = sized.slice(0, limit);
    if (top.length === 0) return { success: true, output: '(no entries found)' };

    const lines = [
      `Largest entries in ${toRelativeHomePath(basePath)}:`,
      ...top.map((item, idx) => `${idx + 1}. ${formatBytes(item.size)}  ${item.name}${item.isDirectory ? '/' : ''}`),
    ];
    if (sizeState.truncated) {
      lines.push('Note: directory sizing was truncated for performance limits.');
    }

    return { success: true, output: truncate(lines.join('\n')) };
  },

  clipboard_read: async () => {
    const text = clipboard.readText();
    if (!text) return { success: true, output: '(clipboard is empty)' };
    return { success: true, output: truncate(text) };
  },

  clipboard_write: async (args) => {
    const text = String(args.text ?? '');
    clipboard.writeText(text);
    return { success: true, output: 'Copied to clipboard.' };
  },

  http_request: async (args) => {
    const url = String(args.url || '');
    if (!url) return { success: false, output: 'No URL provided.' };

    const method = String(args.method || 'GET').toUpperCase();
    const headers = (args.headers || {}) as Record<string, string>;
    const body = args.body ? String(args.body) : undefined;

    return new Promise((resolve) => {
      try {
        const parsedUrl = new URL(url);
        const transport = parsedUrl.protocol === 'https:' ? https : http;

        const reqOpts: any = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method,
          headers: {
            'User-Agent': 'SuperCmd-Agent/1.0',
            ...headers,
            ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          },
        };

        const req = transport.request(reqOpts, (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.length > MAX_OUTPUT) {
              req.destroy();
            }
          });
          res.on('end', () => {
            resolve({
              success: (res.statusCode || 0) < 400,
              output: truncate(`HTTP ${res.statusCode}\n\n${data}`),
            });
          });
        });

        req.on('error', (e: Error) => {
          resolve({ success: false, output: `Request error: ${e.message}` });
        });

        req.setTimeout(15_000, () => {
          req.destroy();
          resolve({ success: false, output: 'Request timed out (15s).' });
        });

        if (body) req.write(body);
        req.end();
      } catch (e: any) {
        resolve({ success: false, output: `Error: ${safeError(e)}` });
      }
    });
  },

  get_frontmost_application: async () => {
    try {
      const stdout = execSync(
        `osascript -e 'tell application "System Events" to get {name, bundle identifier} of first application process whose frontmost is true'`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return { success: true, output: stdout.trim() };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  get_applications: async () => {
    try {
      const stdout = execSync(
        `ls /Applications /System/Applications /System/Applications/Utilities 2>/dev/null | grep -E '\\.app$' | sed 's/\\.app$//' | sort -u`,
        { encoding: 'utf-8', timeout: 10_000, maxBuffer: 512 * 1024 }
      );
      return { success: true, output: truncate(stdout.trim()) };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  memory_search: async (args) => {
    const query = String(args.query || '');
    if (!query) return { success: false, output: 'No query provided.' };

    try {
      const settings = loadSettings();
      const results = await searchMemories(settings, { query, limit: 6 });
      if (!results.length) return { success: true, output: 'No relevant memories found.' };
      return {
        success: true,
        output: results.map((m, i) => `${i + 1}. ${m.text}`).join('\n'),
      };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },

  memory_add: async (args) => {
    const text = String(args.text || '');
    if (!text) return { success: false, output: 'No text provided.' };

    try {
      const settings = loadSettings();
      const result = await addMemory(settings, { text, source: 'agent' });
      return {
        success: result.success,
        output: result.success ? 'Memory saved.' : (result.error || 'Failed to save memory.'),
      };
    } catch (e: any) {
      return { success: false, output: `Error: ${safeError(e)}` };
    }
  },
};

export async function executeAgentTool(
  name: string,
  args: Record<string, any>
): Promise<ToolResult> {
  const executor = executors[name];
  if (!executor) {
    return { success: false, output: `Unknown tool: ${name}` };
  }
  return executor(args);
}
