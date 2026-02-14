/**
 * Extension Runner
 *
 * Discovers installed community extensions and serves pre-built bundles
 * to the renderer.
 *
 * Build strategy:
 *   - All commands are built at install time (not at runtime)
 *   - esbuild bundles each command entry to CJS
 *   - react, react-dom, @raycast/api are kept external
 *   - The renderer provides these modules at runtime via a custom require()
 *
 * At runtime, getExtensionBundle() simply reads the pre-built JS file.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isCommandPlatformCompatible,
  isManifestPlatformCompatible,
} from './extension-platform';
import { loadSettings } from './settings-store';

export interface ExtensionPreferenceSchema {
  scope: 'extension' | 'command';
  name: string;
  title?: string;
  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
  default?: any;
  data?: Array<{ title?: string; value?: string }>;
}

export interface ExtensionCommandSettingsSchema {
  name: string;
  title: string;
  description: string;
  mode: string;
  interval?: string;
  disabledByDefault?: boolean;
  preferences: ExtensionPreferenceSchema[];
}

export interface InstalledExtensionSettingsSchema {
  extName: string;
  title: string;
  description: string;
  owner: string;
  iconDataUrl?: string;
  preferences: ExtensionPreferenceSchema[];
  commands: ExtensionCommandSettingsSchema[];
}

export interface ExtensionCommandInfo {
  id: string;
  title: string;
  extName: string;
  cmdName: string;
  description: string;
  mode: string;
  interval?: string;
  disabledByDefault?: boolean;
  keywords: string[];
  iconDataUrl?: string;
}

// ─── Paths ──────────────────────────────────────────────────────────

interface InstalledExtensionSource {
  extName: string;
  extPath: string;
  sourceRoot: string;
}

function getManagedExtensionsDir(): string {
  const dir = path.join(app.getPath('userData'), 'extensions');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getBuildDir(extPath: string): string {
  const dir = path.join(extPath, '.sc-build');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function expandHome(inputPath: string): string {
  const raw = String(inputPath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function normalizeFsPath(inputPath: string): string {
  return path.resolve(expandHome(inputPath));
}

function normalizeExtensionName(name: string): string {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return raw.replace(/^@/, '').replace(/[\\/]/g, '-');
}

function getConfiguredExtensionRoots(): string[] {
  const settingsPaths = Array.isArray(loadSettings().customExtensionFolders)
    ? loadSettings().customExtensionFolders
    : [];
  const envPaths = String(process.env.SUPERCMD_EXTENSION_PATHS || '')
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = new Set<string>();
  for (const root of [getManagedExtensionsDir(), ...settingsPaths, ...envPaths]) {
    const normalized = normalizeFsPath(root);
    if (!normalized) continue;
    unique.add(normalized);
  }
  return [...unique];
}

function collectInstalledExtensions(): InstalledExtensionSource[] {
  const results: InstalledExtensionSource[] = [];
  const seen = new Set<string>();

  const addIfValid = (extPath: string, sourceRoot: string, fallbackName: string) => {
    const pkgPath = path.join(extPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return;
    try {
      if (!fs.statSync(extPath).isDirectory()) return;
    } catch {
      return;
    }

    const extName = normalizeExtensionName(fallbackName);
    if (!extName) return;
    const dedupeKey = extName.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    results.push({ extName, extPath, sourceRoot });
  };

  for (const sourceRoot of getConfiguredExtensionRoots()) {
    if (!fs.existsSync(sourceRoot)) continue;

    const sourceRootPkg = path.join(sourceRoot, 'package.json');
    if (fs.existsSync(sourceRootPkg)) {
      addIfValid(sourceRoot, sourceRoot, path.basename(sourceRoot));
      continue;
    }

    let entries: string[] = [];
    try {
      entries = fs.readdirSync(sourceRoot);
    } catch {
      continue;
    }
    for (const entry of entries) {
      addIfValid(path.join(sourceRoot, entry), sourceRoot, entry);
    }
  }

  return results;
}

function resolveInstalledExtensionPath(extName: string): string | null {
  const normalized = normalizeExtensionName(extName);
  if (!normalized) return null;
  const match = collectInstalledExtensions().find((entry) => entry.extName === normalized);
  return match?.extPath || null;
}

// ─── Icon extraction ────────────────────────────────────────────────

function getExtensionIconDataUrl(
  extPath: string,
  iconFile: string
): string | undefined {
  const candidates = [
    path.join(extPath, 'assets', iconFile),
    path.join(extPath, iconFile),
  ];

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const ext = path.extname(p).toLowerCase();
      const data = fs.readFileSync(p);
      if (data.length < 50) continue;
      const mime =
        ext === '.svg'
          ? 'image/svg+xml'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : 'image/png';
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch {}
  }
  return undefined;
}

function resolvePlatformDefault(value: any): any {
  const platformKey = process.platform === 'win32' ? 'Windows' : 'macOS';
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.prototype.hasOwnProperty.call(value, 'macOS') ||
      Object.prototype.hasOwnProperty.call(value, 'Windows'))
  ) {
    if (Object.prototype.hasOwnProperty.call(value, platformKey)) {
      return value[platformKey];
    }
    return value.macOS ?? value.Windows;
  }
  return value;
}

function normalizePreferenceSchema(pref: any, scope: 'extension' | 'command'): ExtensionPreferenceSchema | null {
  if (!pref || typeof pref !== 'object' || !pref.name) return null;
  return {
    scope,
    name: String(pref.name),
    title: pref.title,
    label: pref.label,
    description: pref.description,
    placeholder: pref.placeholder,
    required: Boolean(pref.required),
    type: pref.type,
    default: resolvePlatformDefault(pref.default),
    data: Array.isArray(pref.data) ? pref.data : undefined,
  };
}

// ─── Discovery ──────────────────────────────────────────────────────

/**
 * Scan installed extensions directory and return a flat list of
 * commands that should appear in the launcher.
 */
export function discoverInstalledExtensionCommands(): ExtensionCommandInfo[] {
  const results: ExtensionCommandInfo[] = [];
  for (const source of collectInstalledExtensions()) {
    const extPath = source.extPath;
    const pkgPath = path.join(extPath, 'package.json');
    const extName = source.extName;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (!isManifestPlatformCompatible(pkg)) continue;
      const iconDataUrl = getExtensionIconDataUrl(
        extPath,
        pkg.icon || 'icon.png'
      );

      for (const cmd of pkg.commands || []) {
        if (!cmd.name) continue;
        if (!isCommandPlatformCompatible(cmd)) continue;
        results.push({
          id: `ext-${extName}-${cmd.name}`,
          title: cmd.title || cmd.name,
          extName,
          cmdName: cmd.name,
          description: cmd.description || '',
          mode: cmd.mode || 'view',
          interval: typeof cmd.interval === 'string' ? cmd.interval : undefined,
          disabledByDefault: Boolean(cmd.disabledByDefault),
          keywords: [
            extName,
            pkg.title || '',
            cmd.name,
            cmd.title || '',
            cmd.description || '',
          ]
            .filter(Boolean)
            .map((s: string) => s.toLowerCase()),
          iconDataUrl,
        });
      }
    } catch {}
  }

  return results;
}

/**
 * Parse all installed extension manifests and return settings schema
 * (extension + command preferences) for Settings UI and API parity.
 */
export function getInstalledExtensionsSettingsSchema(): InstalledExtensionSettingsSchema[] {
  const results: InstalledExtensionSettingsSchema[] = [];
  for (const source of collectInstalledExtensions()) {
    const extPath = source.extPath;
    const pkgPath = path.join(extPath, 'package.json');
    const extName = source.extName;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (!isManifestPlatformCompatible(pkg)) continue;
      const iconDataUrl = getExtensionIconDataUrl(extPath, pkg.icon || 'icon.png');
      const ownerRaw = pkg.owner || pkg.author || '';
      const owner = typeof ownerRaw === 'object' ? ownerRaw.name || '' : String(ownerRaw || '');

      const extensionPreferences: ExtensionPreferenceSchema[] = Array.isArray(pkg.preferences)
        ? pkg.preferences
            .map((pref: any) => normalizePreferenceSchema(pref, 'extension'))
            .filter(Boolean) as ExtensionPreferenceSchema[]
        : [];

      const commands: ExtensionCommandSettingsSchema[] = Array.isArray(pkg.commands)
        ? pkg.commands
            .filter((cmd: any) => cmd && cmd.name && isCommandPlatformCompatible(cmd))
            .map((cmd: any) => ({
              name: cmd.name,
              title: cmd.title || cmd.name,
              description: cmd.description || '',
              mode: cmd.mode || 'view',
              interval: typeof cmd.interval === 'string' ? cmd.interval : undefined,
              disabledByDefault: Boolean(cmd.disabledByDefault),
              preferences: Array.isArray(cmd.preferences)
                ? cmd.preferences
                    .map((pref: any) => normalizePreferenceSchema(pref, 'command'))
                    .filter(Boolean) as ExtensionPreferenceSchema[]
                : [],
            }))
        : [];

      results.push({
        extName,
        title: pkg.title || extName,
        description: pkg.description || '',
        owner,
        iconDataUrl,
        preferences: extensionPreferences,
        commands,
      });
    } catch {}
  }

  return results.sort((a, b) => a.title.localeCompare(b.title));
}

// ─── Build (called at install time) ─────────────────────────────────

// Node.js built-in modules — must be external since we run in the renderer.
const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto',
  'dgram', 'dns', 'events', 'fs', 'fs/promises', 'http',
  'http2', 'https', 'module', 'net', 'os', 'path',
  'perf_hooks', 'process', 'querystring', 'readline',
  'stream', 'stream/promises', 'string_decoder', 'timers',
  'timers/promises', 'tls', 'tty', 'url', 'util', 'v8',
  'vm', 'worker_threads', 'zlib',
  'async_hooks',
  'node:assert', 'node:buffer', 'node:child_process',
  'node:crypto', 'node:events', 'node:fs', 'node:fs/promises',
  'node:http', 'node:https', 'node:module', 'node:net',
  'node:os', 'node:path', 'node:process', 'node:querystring',
  'node:stream', 'node:timers', 'node:timers/promises',
  'node:url', 'node:util', 'node:vm', 'node:worker_threads',
  'node:zlib',
  'node:async_hooks',
];

/**
 * Resolve the source entry file for a given command.
 */
function resolveEntryFile(extPath: string, cmd: any): string | null {
  const cmdName = String(cmd?.name || '').trim();
  if (!cmdName) return null;

  const srcDir = path.join(extPath, 'src');
  const validExt = /\.(tsx?|jsx?)$/i;
  const explicitEntry =
    typeof cmd?.path === 'string'
      ? cmd.path
      : typeof cmd?.entrypoint === 'string'
        ? cmd.entrypoint
        : typeof cmd?.entry === 'string'
          ? cmd.entry
          : typeof cmd?.file === 'string'
            ? cmd.file
            : typeof cmd?.source === 'string'
              ? cmd.source
              : '';

  const candidates = [
    explicitEntry ? path.join(extPath, explicitEntry) : '',
    path.join(srcDir, `${cmdName}.tsx`),
    path.join(srcDir, `${cmdName}.ts`),
    path.join(srcDir, `${cmdName}.jsx`),
    path.join(srcDir, `${cmdName}.js`),
    path.join(srcDir, cmdName, 'index.tsx'),
    path.join(srcDir, cmdName, 'index.ts'),
    path.join(srcDir, cmdName, 'index.jsx'),
    path.join(srcDir, cmdName, 'index.js'),
    path.join(srcDir, 'commands', `${cmdName}.tsx`),
    path.join(srcDir, 'commands', `${cmdName}.ts`),
    path.join(srcDir, 'commands', `${cmdName}.jsx`),
    path.join(srcDir, 'commands', `${cmdName}.js`),
  ].filter(Boolean);

  const found = candidates.find((p) => fs.existsSync(p));
  if (found) return found;
  if (!fs.existsSync(srcDir)) return null;

  // Fallback: recursive search for files matching command name.
  const stack = [srcDir];
  const normalized = cmdName.toLowerCase();
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!validExt.test(entry)) continue;
      const base = path.basename(entry, path.extname(entry)).toLowerCase();
      if (base === normalized) return full;
    }
  }
  return null;
}

/**
 * Build ALL commands for an installed extension using esbuild.
 * Called at install time so the extension is ready to run instantly.
 *
 * Returns the number of commands successfully built.
 */
export async function buildAllCommands(extName: string, extPathOverride?: string): Promise<number> {
  const extPath = extPathOverride
    ? normalizeFsPath(extPathOverride)
    : resolveInstalledExtensionPath(extName);

  if (!extPath) {
    console.error(`Extension path not found for ${extName}`);
    return 0;
  }
  const pkgPath = path.join(extPath, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    console.error(`No package.json found for extension ${extName}`);
    return 0;
  }

  let commands: any[];
  let manifestExternal: string[] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (!isManifestPlatformCompatible(pkg)) {
      console.warn(`Skipping build for incompatible extension ${extName}`);
      return 0;
    }
    commands = pkg.commands || [];
    manifestExternal = Array.isArray(pkg.external)
      ? pkg.external.filter((v: any) => typeof v === 'string' && v.trim().length > 0)
      : [];
  } catch {
    return 0;
  }

  if (commands.length === 0) return 0;

  const esbuild = require('esbuild');
  const extNodeModules = path.join(extPath, 'node_modules');
  const buildDir = getBuildDir(extPath);
  // Avoid stale command bundles when extension source layout changes.
  try {
    fs.rmSync(buildDir, { recursive: true, force: true });
  } catch {}
  fs.mkdirSync(buildDir, { recursive: true });
  let built = 0;

  for (const cmd of commands) {
    if (!cmd.name) continue;
    if (!isCommandPlatformCompatible(cmd)) continue;

    const entryFile = resolveEntryFile(extPath, cmd);
    if (!entryFile) {
      console.warn(`No entry file for ${extName}/${cmd.name}, skipping`);
      continue;
    }

    const outFile = path.join(buildDir, `${cmd.name}.js`);

    try {
      console.log(`  Building ${extName}/${cmd.name}…`);

      await esbuild.build({
        entryPoints: [entryFile],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        outfile: outFile,
        plugins: [
          // Mark swift: imports as external so fakeRequire can handle them at runtime
          {
            name: 'swift-external',
            setup(build: any) {
              build.onResolve({ filter: /^swift:/ }, (args: any) => ({
                path: args.path,
                external: true,
              }));
            },
          },
        ],
        external: [
          // React — provided by the renderer at runtime
          'react',
          'react-dom',
          'react-dom/*',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
          // Raycast — provided by our shim
          '@raycast/api',
          '@raycast/utils',
          // Native C++ addons — cannot be bundled, we stub them at runtime
          're2',
          'better-sqlite3',
          'fsevents',
          // Cross-extension calls — not supported, stubbed
          'raycast-cross-extension',
          // Fetch libs — use runtime shims in renderer instead of bundling Node internals
          'node-fetch',
          'undici',
          'undici/*',
          // HTTP / file-download / archive packages — must be kept external so our renderer
          // shim can intercept them and route file I/O through the main process (which has
          // real filesystem access). Bundling them inline breaks binary downloads because the
          // browser renderer cannot do streaming file writes or archive extraction natively.
          'axios',
          'tar',
          'extract-zip',
          'sha256-file',
          // Respect extension-defined externals from manifest
          ...manifestExternal,
          // Node.js built-ins — stubbed at runtime in the renderer
          ...nodeBuiltins,
        ],
        nodePaths: fs.existsSync(extNodeModules) ? [extNodeModules] : [],
        target: 'es2020',
        jsx: 'automatic',
        jsxImportSource: 'react',
        tsconfigRaw: JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            jsx: 'react-jsx',
            jsxImportSource: 'react',
            strict: false,
            esModuleInterop: true,
            moduleResolution: 'node',
          },
        }),
        define: {
          'process.env.NODE_ENV': '"production"',
          'global': 'globalThis',
        },
        logLevel: 'warning',
      });

      if (fs.existsSync(outFile)) {
        built++;
      }
    } catch (e) {
      console.error(`  esbuild failed for ${extName}/${cmd.name}:`, e);
    }
  }

  console.log(`Built ${built}/${commands.length} commands for ${extName}`);
  return built;
}

// ─── Runtime: read pre-built bundles ────────────────────────────────

export interface ExtensionBundleResult {
  code: string;
  title: string;
  mode: string;
  // Extension metadata
  extensionName: string;
  extensionDisplayName: string;
  extensionIconDataUrl?: string;
  commandName: string;
  assetsPath: string;
  supportPath: string;
  extensionPath: string;
  owner: string;
  // Preferences
  preferences: Record<string, any>;
  // Command-specific preferences
  commandPreferences: Record<string, any>;
  // Preference schema (extension + command-level)
  preferenceDefinitions: Array<{
    scope: 'extension' | 'command';
    name: string;
    title?: string;
    description?: string;
    placeholder?: string;
    required?: boolean;
    type?: string;
    default?: any;
    data?: Array<{ title?: string; value?: string }>;
  }>;
  commandArgumentDefinitions: Array<{
    name: string;
    required?: boolean;
    type?: string;
    placeholder?: string;
    title?: string;
    data?: Array<{ title?: string; value?: string }>;
  }>;
}

/**
 * Parse preferences from package.json and return default values.
 * Extension preferences are defined in the manifest and can have default values.
 */
function parsePreferences(
  pkg: any,
  cmdName: string
): {
  extensionPrefs: Record<string, any>;
  commandPrefs: Record<string, any>;
  definitions: Array<{
    scope: 'extension' | 'command';
    name: string;
    title?: string;
    description?: string;
    placeholder?: string;
    required?: boolean;
    type?: string;
    default?: any;
    data?: Array<{ title?: string; value?: string }>;
  }>;
} {
  const extensionPrefs: Record<string, any> = {};
  const commandPrefs: Record<string, any> = {};
  const definitions: Array<{
    scope: 'extension' | 'command';
    name: string;
    title?: string;
    description?: string;
    placeholder?: string;
    required?: boolean;
    type?: string;
    default?: any;
    data?: Array<{ title?: string; value?: string }>;
  }> = [];

  // Extension-level preferences
  for (const pref of pkg.preferences || []) {
    if (!pref.name) continue;
    const resolvedDefault = resolvePlatformDefault(pref.default);
    definitions.push({
      scope: 'extension',
      name: pref.name,
      title: pref.title,
      description: pref.description,
      placeholder: pref.placeholder,
      required: Boolean(pref.required),
      type: pref.type,
      default: resolvedDefault,
      data: Array.isArray(pref.data) ? pref.data : undefined,
    });
    // Set default value based on type
    if (resolvedDefault !== undefined) {
      extensionPrefs[pref.name] = resolvedDefault;
    } else if (pref.type === 'checkbox') {
      extensionPrefs[pref.name] = false;
    } else if (pref.type === 'textfield' || pref.type === 'password') {
      extensionPrefs[pref.name] = '';
    } else if (pref.type === 'dropdown') {
      // Use first option as default
      extensionPrefs[pref.name] = pref.data?.[0]?.value ?? '';
    }
  }

  // Command-level preferences
  const cmd = (pkg.commands || []).find((c: any) => c.name === cmdName);
  if (cmd?.preferences) {
    for (const pref of cmd.preferences) {
      if (!pref.name) continue;
      const resolvedDefault = resolvePlatformDefault(pref.default);
      definitions.push({
        scope: 'command',
        name: pref.name,
        title: pref.title,
        description: pref.description,
        placeholder: pref.placeholder,
        required: Boolean(pref.required),
        type: pref.type,
        default: resolvedDefault,
        data: Array.isArray(pref.data) ? pref.data : undefined,
      });
      if (resolvedDefault !== undefined) {
        commandPrefs[pref.name] = resolvedDefault;
      } else if (pref.type === 'checkbox') {
        commandPrefs[pref.name] = false;
      } else if (pref.type === 'textfield' || pref.type === 'password') {
        commandPrefs[pref.name] = '';
      } else if (pref.type === 'dropdown') {
        commandPrefs[pref.name] = pref.data?.[0]?.value ?? '';
      }
    }
  }

  return { extensionPrefs, commandPrefs, definitions };
}

/**
 * Get a pre-built extension command bundle.
 * Returns null if the bundle doesn't exist (extension not built).
 */
export function getExtensionBundle(
  extName: string,
  cmdName: string
): ExtensionBundleResult | null {
  const normalizedExtName = normalizeExtensionName(extName);
  const extPath = resolveInstalledExtensionPath(normalizedExtName);
  if (!extPath) {
    console.error(`Extension not found: ${normalizedExtName}`);
    return null;
  }
  let outFile = path.join(extPath, '.sc-build', `${cmdName}.js`);

  if (!fs.existsSync(outFile)) {
    console.error(
      `Pre-built bundle not found: ${outFile}. Was the extension built?`
    );
    return null;
  }

  const code = fs.readFileSync(outFile, 'utf-8');
  if (!code) {
    console.error(`Pre-built bundle is empty: ${outFile}`);
    return null;
  }

  // Read command info, preferences, and metadata from package.json
  let title = cmdName;
  let mode = 'view';
  let owner = '';
  let extensionDisplayName = extName;
  let extensionIconDataUrl: string | undefined;
  let preferences: Record<string, any> = {};
  let commandPreferences: Record<string, any> = {};
  let preferenceDefinitions: Array<{
    scope: 'extension' | 'command';
    name: string;
    title?: string;
    description?: string;
    placeholder?: string;
    required?: boolean;
    type?: string;
    default?: any;
    data?: Array<{ title?: string; value?: string }>;
  }> = [];
  let commandArgumentDefinitions: Array<{
    name: string;
    required?: boolean;
    type?: string;
    placeholder?: string;
    title?: string;
    data?: Array<{ title?: string; value?: string }>;
  }> = [];

  try {
    const pkgPath = path.join(extPath, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (!isManifestPlatformCompatible(pkg)) {
      return null;
    }
    const cmd = (pkg.commands || []).find((c: any) => c.name === cmdName);
    if (cmd && !isCommandPlatformCompatible(cmd)) {
      return null;
    }
    if (cmd?.title) title = cmd.title;
    if (cmd?.mode) mode = cmd.mode;
    if (pkg?.title) extensionDisplayName = pkg.title;
    extensionIconDataUrl = getExtensionIconDataUrl(extPath, pkg.icon || 'icon.png');

    const rawOwner = pkg.owner || pkg.author || '';
    owner = typeof rawOwner === 'object' ? (rawOwner as any).name || '' : rawOwner;

    const { extensionPrefs, commandPrefs, definitions } = parsePreferences(pkg, cmdName);
    preferences = extensionPrefs;
    commandPreferences = commandPrefs;
    preferenceDefinitions = definitions;
    commandArgumentDefinitions = Array.isArray(cmd?.arguments)
      ? cmd.arguments
          .filter((arg: any) => arg && arg.name)
          .map((arg: any) => ({
            name: arg.name,
            required: Boolean(arg.required),
            type: arg.type,
            placeholder: arg.placeholder,
            title: arg.title,
            data: Array.isArray(arg.data) ? arg.data : undefined,
          }))
      : [];
  } catch {}

  // Compute paths
  const assetsPath = path.join(extPath, 'assets');
  const supportPath = path.join(app.getPath('userData'), 'extension-support', normalizedExtName);

  // Ensure support directory exists
  if (!fs.existsSync(supportPath)) {
    fs.mkdirSync(supportPath, { recursive: true });
  }

  return {
    code,
    title,
    mode,
    extensionName: normalizedExtName,
    extensionDisplayName,
    extensionIconDataUrl,
    commandName: cmdName,
    assetsPath,
    supportPath,
    extensionPath: extPath,
    owner,
    preferences: { ...preferences, ...commandPreferences },
    commandPreferences,
    preferenceDefinitions,
    commandArgumentDefinitions,
  };
}
