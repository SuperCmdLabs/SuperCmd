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
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isCommandPlatformCompatible,
  isManifestPlatformCompatible,
} from './extension-platform';
import { getExtensionPreferences } from './extension-preferences-store';
import { loadSettings } from './settings-store';

/**
 * Require esbuild, handling the asar-packed Electron case.
 * When the app is packaged, esbuild's native binary lives in app.asar.unpacked/
 * but requireEsbuild() resolves to the asar path where spawn fails with ENOTDIR.
 */
function requireEsbuild(): any {
  try {
    // Try the unpacked path first (works in packaged app)
    const mainPath = require.resolve('esbuild');
    if (mainPath.includes('app.asar')) {
      const unpackedPath = mainPath.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(unpackedPath)) {
        return require(unpackedPath);
      }
    }
    return require('esbuild');
  } catch {
    // Fallback for environments where require.resolve behaves differently.
    return require('esbuild');
  }
}

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
  extensionTitle: string;
  extName: string;
  cmdName: string;
  owner?: string;
  description: string;
  mode: string;
  interval?: string;
  disabledByDefault?: boolean;
  keywords: string[];
  iconDataUrl?: string;
  commandArgumentDefinitions?: Array<{
    name: string;
    required?: boolean;
    type?: string;
    placeholder?: string;
    title?: string;
    data?: Array<{ title?: string; value?: string }>;
  }>;
}

// ─── Paths ──────────────────────────────────────────────────────────

interface InstalledExtensionSource {
  extName: string;
  extPath: string;
  sourceRoot: string;
}

interface FsPathSignature {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

interface BuildFileSignature extends FsPathSignature {
  path: string;
  hash: string;
}

interface ExtensionCommandBuildStamp {
  name: string;
  commandSignature: string;
  entryFile: string;
  outFile: string;
  outputSignature: BuildFileSignature;
  inputSignatures: BuildFileSignature[];
}

interface ExtensionBuildStamp {
  version: number;
  extName: string;
  platform: string;
  arch: string;
  esbuildVersion: string;
  external: string[];
  tsconfigRaw: string;
  runtimeDeps: string[];
  configSignatures: BuildFileSignature[];
  commands: ExtensionCommandBuildStamp[];
}

interface ExtensionBuildInput {
  requiresNodeModules: boolean;
  tsconfigRaw: string;
  buildContext: Omit<ExtensionBuildStamp, 'commands'>;
}

const extensionBuildStampVersion = 1;
const extensionBuildStampFile = '.sc-build-stamp.json';

interface InstalledExtensionSourceSignature {
  extName: string;
  extPath: string;
  sourceRoot: string;
  extPathSignature: FsPathSignature;
  packageJsonSignature: FsPathSignature;
}

interface InstalledExtensionsSnapshot {
  roots: string[];
  rootSignatures: FsPathSignature[];
  sources: InstalledExtensionSource[];
  sourceSignatures: InstalledExtensionSourceSignature[];
}

interface CachedManifest {
  signature: FsPathSignature;
  value: any;
}

interface CachedTextFile {
  signature: FsPathSignature;
  value: string;
}

let _installedExtensionsSnapshot: InstalledExtensionsSnapshot | null = null;
const _extensionManifestCache = new Map<string, CachedManifest>();
const _extensionBundleCodeCache = new Map<string, CachedTextFile>();

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

function getPathSignature(filePath: string): FsPathSignature {
  try {
    const stat = fs.statSync(filePath);
    return {
      exists: true,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return {
      exists: false,
      isFile: false,
      isDirectory: false,
      size: -1,
      mtimeMs: -1,
    };
  }
}

function getStoredBuildPath(extPath: string, filePath: string): string {
  const normalized = path.resolve(filePath);
  const relative = path.relative(extPath, normalized);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return `rel:${relative.split(path.sep).join('/')}`;
  }
  return `abs:${normalized}`;
}

function resolveStoredBuildPath(extPath: string, storedPath: string): string {
  if (storedPath.startsWith('rel:')) {
    return path.join(extPath, ...storedPath.slice(4).split('/'));
  }
  if (storedPath.startsWith('abs:')) {
    return storedPath.slice(4);
  }
  return storedPath;
}

function hashFile(filePath: string): string {
  try {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function getBuildFileSignature(extPath: string, filePath: string): BuildFileSignature {
  const signature = getPathSignature(filePath);
  return {
    path: getStoredBuildPath(extPath, filePath),
    ...signature,
    hash: signature.exists && signature.isFile ? hashFile(filePath) : '',
  };
}

function sameBuildFileSignature(a: BuildFileSignature, b: BuildFileSignature): boolean {
  return (
    a.path === b.path &&
    a.exists === b.exists &&
    a.isFile === b.isFile &&
    a.isDirectory === b.isDirectory &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.hash === b.hash
  );
}

function sameBuildFileSignatures(a: BuildFileSignature[], b: BuildFileSignature[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!sameBuildFileSignature(a[i], b[i])) return false;
  }
  return true;
}

function samePathSignature(a: FsPathSignature, b: FsPathSignature): boolean {
  return (
    a.exists === b.exists &&
    a.isFile === b.isFile &&
    a.isDirectory === b.isDirectory &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs
  );
}

function sameRootSnapshot(
  roots: string[],
  rootSignatures: FsPathSignature[],
  snapshot: InstalledExtensionsSnapshot
): boolean {
  if (roots.length !== snapshot.roots.length) return false;
  if (rootSignatures.length !== snapshot.rootSignatures.length) return false;
  for (let i = 0; i < roots.length; i++) {
    if (roots[i] !== snapshot.roots[i]) return false;
    if (!samePathSignature(rootSignatures[i], snapshot.rootSignatures[i])) return false;
  }
  return true;
}

function readExtensionBuildStamp(buildDir: string): ExtensionBuildStamp | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(buildDir, extensionBuildStampFile), 'utf-8'));
    if (parsed?.version !== extensionBuildStampVersion || !Array.isArray(parsed?.commands)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeExtensionBuildStamp(buildDir: string, stamp: ExtensionBuildStamp): void {
  try {
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, extensionBuildStampFile), JSON.stringify(stamp, null, 2));
  } catch (error: any) {
    console.warn('Failed to write extension build stamp:', error?.message || error);
  }
}

function getInstalledExtensionSourceSignature(source: InstalledExtensionSource): InstalledExtensionSourceSignature {
  return {
    extName: source.extName,
    extPath: source.extPath,
    sourceRoot: source.sourceRoot,
    extPathSignature: getPathSignature(source.extPath),
    packageJsonSignature: getPathSignature(path.join(source.extPath, 'package.json')),
  };
}

function sameInstalledExtensionSourceSignature(
  a: InstalledExtensionSourceSignature,
  b: InstalledExtensionSourceSignature
): boolean {
  return (
    a.extName === b.extName &&
    a.extPath === b.extPath &&
    a.sourceRoot === b.sourceRoot &&
    samePathSignature(a.extPathSignature, b.extPathSignature) &&
    samePathSignature(a.packageJsonSignature, b.packageJsonSignature)
  );
}

function getInstalledExtensionSourceSignatures(
  sources: InstalledExtensionSource[]
): InstalledExtensionSourceSignature[] {
  return sources.map((source) => getInstalledExtensionSourceSignature(source));
}

function sameInstalledExtensionSourceSignatures(
  a: InstalledExtensionSourceSignature[],
  b: InstalledExtensionSourceSignature[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!sameInstalledExtensionSourceSignature(a[i], b[i])) return false;
  }
  return true;
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

function scanInstalledExtensions(roots: string[]): InstalledExtensionSource[] {
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

  for (const sourceRoot of roots) {
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

function collectInstalledExtensions(): InstalledExtensionSource[] {
  const roots = getConfiguredExtensionRoots();
  const rootSignatures = roots.map((root) => getPathSignature(root));

  if (_installedExtensionsSnapshot && sameRootSnapshot(roots, rootSignatures, _installedExtensionsSnapshot)) {
    const currentSourceSignatures = getInstalledExtensionSourceSignatures(_installedExtensionsSnapshot.sources);
    if (sameInstalledExtensionSourceSignatures(currentSourceSignatures, _installedExtensionsSnapshot.sourceSignatures)) {
      return _installedExtensionsSnapshot.sources;
    }
  }

  const sources = scanInstalledExtensions(roots);
  _installedExtensionsSnapshot = {
    roots,
    rootSignatures,
    sources,
    sourceSignatures: getInstalledExtensionSourceSignatures(sources),
  };
  return sources;
}

function resolveInstalledExtensionPath(extName: string): string | null {
  const normalized = normalizeExtensionName(extName);
  if (!normalized) return null;
  const match = collectInstalledExtensions().find((entry) => entry.extName === normalized);
  return match?.extPath || null;
}

function readExtensionManifest(extPath: string): any | null {
  const pkgPath = path.join(extPath, 'package.json');
  const signature = getPathSignature(pkgPath);
  if (!signature.exists || !signature.isFile) return null;

  const cached = _extensionManifestCache.get(pkgPath);
  if (cached && samePathSignature(cached.signature, signature)) {
    return cached.value;
  }

  const value = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  _extensionManifestCache.set(pkgPath, { signature, value });
  return value;
}

function readExtensionBundleCode(outFile: string): string {
  const signature = getPathSignature(outFile);
  if (!signature.exists || !signature.isFile) return '';

  const cached = _extensionBundleCodeCache.get(outFile);
  if (cached && samePathSignature(cached.signature, signature)) {
    return cached.value;
  }

  const value = fs.readFileSync(outFile, 'utf-8');
  _extensionBundleCodeCache.set(outFile, { signature, value });
  return value;
}

function invalidateExtensionStaticCacheForPath(extPath: string): void {
  const normalizedExtPath = path.resolve(extPath);
  _installedExtensionsSnapshot = null;
  _extensionManifestCache.delete(path.join(normalizedExtPath, 'package.json'));

  const buildDir = path.join(normalizedExtPath, '.sc-build') + path.sep;
  for (const bundlePath of _extensionBundleCodeCache.keys()) {
    if (bundlePath.startsWith(buildDir)) {
      _extensionBundleCodeCache.delete(bundlePath);
    }
  }
}

export function invalidateExtensionRunnerCaches(): void {
  _installedExtensionsSnapshot = null;
  _extensionManifestCache.clear();
  _extensionBundleCodeCache.clear();
  _extensionIconCache.clear();
}

// ─── Icon extraction ────────────────────────────────────────────────

// Session-level cache: absolute icon path → stable data URL string.
// Prevents re-reading and re-encoding the same icon file on every getCommands() call.
const _extensionIconCache = new Map<string, { signature: FsPathSignature; value: string }>();

function resizeIconWithSips(inputPath: string): Buffer | null {
  const tmp = path.join(os.tmpdir(), `sc-icon-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  try {
    execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-z', '64', '64', inputPath, '--out', tmp], { stdio: 'ignore' });
    return fs.readFileSync(tmp);
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function getExtensionIconDataUrl(
  extPath: string,
  iconFile: string
): string | undefined {
  const candidates = [
    path.join(extPath, 'assets', iconFile),
    path.join(extPath, iconFile),
  ];

  for (const p of candidates) {
    const signature = getPathSignature(p);
    if (!signature.exists || !signature.isFile) continue;

    const cached = _extensionIconCache.get(p);
    if (cached !== undefined && samePathSignature(cached.signature, signature)) {
      return cached.value;
    }

    try {
      const ext = path.extname(p).toLowerCase();
      const data = fs.readFileSync(p);
      if (data.length < 50) continue;

      let result: string;
      if (ext === '.svg') {
        result = `data:image/svg+xml;base64,${data.toString('base64')}`;
      } else {
        const resized = resizeIconWithSips(p);
        const finalData = resized ?? data;
        result = `data:image/png;base64,${finalData.toString('base64')}`;
      }

      _extensionIconCache.set(p, { signature, value: result });
      return result;
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
    const extName = source.extName;

    try {
      const pkg = readExtensionManifest(extPath);
      if (!pkg) continue;
      if (!isManifestPlatformCompatible(pkg)) continue;
      const iconDataUrl = getExtensionIconDataUrl(
        extPath,
        pkg.icon || 'icon.png'
      );
      const ownerRaw = pkg.owner || pkg.author || '';
      const owner = (typeof ownerRaw === 'object' ? ownerRaw?.name || '' : String(ownerRaw || '')).trim();

      for (const cmd of pkg.commands || []) {
        if (!cmd.name) continue;
        if (!isCommandPlatformCompatible(cmd)) continue;
        results.push({
          id: `ext-${extName}-${cmd.name}`,
          title: cmd.title || cmd.name,
          extensionTitle: pkg.title || extName,
          extName,
          cmdName: cmd.name,
          owner: owner || undefined,
          description: cmd.description || '',
          mode: cmd.mode || 'view',
          interval: typeof cmd.interval === 'string' ? cmd.interval : undefined,
          disabledByDefault: Boolean(cmd.disabledByDefault),
          commandArgumentDefinitions: Array.isArray(cmd.arguments)
            ? cmd.arguments
                .filter((arg: any) => arg && arg.name)
                .map((arg: any) => ({
                  name: String(arg.name),
                  required: Boolean(arg.required),
                  type: arg.type,
                  placeholder: arg.placeholder,
                  title: arg.title,
                  data: Array.isArray(arg.data) ? arg.data : undefined,
                }))
            : [],
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
    const extName = source.extName;

    try {
      const pkg = readExtensionManifest(extPath);
      if (!pkg) continue;
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

function getInstallableRuntimeDeps(pkg: any): string[] {
  const deps = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.optionalDependencies || {}),
  };

  return Object.entries(deps)
    .filter(([name]) => typeof name === 'string' && !name.startsWith('@raycast/'))
    .map(([name, version]) => `${name}@${String(version || '').trim()}`)
    .filter((value) => {
      const atIndex = value.lastIndexOf('@');
      return atIndex > 0 && atIndex < value.length - 1;
    });
}

function extensionRequiresNodeModules(pkg: any): boolean {
  return getInstallableRuntimeDeps(pkg).length > 0;
}

function createNativeSchemeExternalPlugin(): any {
  return {
    name: 'native-scheme-external',
    setup(build: any) {
      build.onResolve({ filter: /^(swift|rust):/ }, (args: any) => ({
        path: args.path,
        external: true,
      }));
    },
  };
}

function getExtensionBuildExternals(manifestExternal: string[]): string[] {
  return [
    'react',
    'react-dom',
    'react-dom/*',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    '@raycast/api',
    '@raycast/utils',
    're2',
    'better-sqlite3',
    'fsevents',
    'raycast-cross-extension',
    'node-fetch',
    'undici',
    'undici/*',
    'axios',
    'tar',
    'extract-zip',
    'sha256-file',
    ...manifestExternal,
    ...nodeBuiltins,
  ];
}

/**
 * Parse a tsconfig.json that may contain JSONC features (comments, trailing commas).
 * TypeScript itself accepts these, and many Raycast extensions ship them
 * (e.g. library-genesis has a trailing comma after `paths`).
 */
function parseJsonc(source: string): any {
  // Strip block comments, then line comments, then trailing commas before } or ].
  // String-aware: skip over double-quoted string contents so we don't mangle them.
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    // String literal — copy verbatim, honoring escapes
    if (ch === '"') {
      out += ch;
      i++;
      while (i < n) {
        const c = source[i];
        out += c;
        i++;
        if (c === '\\' && i < n) {
          out += source[i];
          i++;
          continue;
        }
        if (c === '"') break;
      }
      continue;
    }
    // Line comment
    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  // Strip trailing commas: `,` followed by optional whitespace and `}` or `]`.
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

function getExtensionCompilerOptions(extPath: string): Record<string, any> {
  const tsconfigPath = path.join(extPath, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) return {};

  try {
    const parsed = parseJsonc(fs.readFileSync(tsconfigPath, 'utf-8'));
    const compilerOptions =
      parsed && typeof parsed === 'object' && parsed.compilerOptions && typeof parsed.compilerOptions === 'object'
        ? parsed.compilerOptions
        : {};

    const options: Record<string, any> = {};
    if (typeof compilerOptions.baseUrl === 'string' && compilerOptions.baseUrl.trim()) {
      options.baseUrl = compilerOptions.baseUrl;
    }
    if (compilerOptions.paths && typeof compilerOptions.paths === 'object' && !Array.isArray(compilerOptions.paths)) {
      options.paths = compilerOptions.paths;
      // Some Raycast extensions define paths without baseUrl; default to extension root.
      if (!options.baseUrl) options.baseUrl = '.';
    }
    if (typeof compilerOptions.jsx === 'string' && compilerOptions.jsx.trim()) {
      options.jsx = compilerOptions.jsx;
    }
    if (typeof compilerOptions.jsxImportSource === 'string' && compilerOptions.jsxImportSource.trim()) {
      options.jsxImportSource = compilerOptions.jsxImportSource;
    }

    return options;
  } catch (error: any) {
    console.warn(`Failed to parse tsconfig for ${path.basename(extPath)}:`, error?.message || error);
    return {};
  }
}

function getEsbuildTsconfigRaw(extPath: string): string {
  const extensionCompilerOptions = getExtensionCompilerOptions(extPath);
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      jsx: 'react-jsx',
      jsxImportSource: 'react',
      strict: false,
      esModuleInterop: true,
      moduleResolution: 'node',
      ...extensionCompilerOptions,
    },
  });
}

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

function getEsbuildPackageVersion(): string {
  try {
    const pkgPath = require.resolve('esbuild/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return typeof pkg?.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function getExtensionConfigSignatures(extPath: string): BuildFileSignature[] {
  return [
    'package.json',
    'tsconfig.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
    'bun.lockb',
  ]
    .map((fileName) => path.join(extPath, fileName))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => getBuildFileSignature(extPath, filePath));
}

function createExtensionBuildContext(
  extName: string,
  extPath: string,
  pkg: any,
  manifestExternal: string[],
  tsconfigRaw: string
): Omit<ExtensionBuildStamp, 'commands'> {
  return {
    version: extensionBuildStampVersion,
    extName,
    platform: process.platform,
    arch: process.arch,
    esbuildVersion: getEsbuildPackageVersion(),
    external: getExtensionBuildExternals(manifestExternal),
    tsconfigRaw,
    runtimeDeps: getInstallableRuntimeDeps(pkg),
    configSignatures: getExtensionConfigSignatures(extPath),
  };
}

function getManifestExternal(pkg: any): string[] {
  return Array.isArray(pkg?.external)
    ? pkg.external.filter((v: any) => typeof v === 'string' && v.trim().length > 0)
    : [];
}

function createExtensionBuildInput(
  extName: string,
  extPath: string,
  pkg: any
): ExtensionBuildInput {
  const manifestExternal = getManifestExternal(pkg);
  const tsconfigRaw = getEsbuildTsconfigRaw(extPath);
  return {
    requiresNodeModules: extensionRequiresNodeModules(pkg),
    tsconfigRaw,
    buildContext: createExtensionBuildContext(extName, extPath, pkg, manifestExternal, tsconfigRaw),
  };
}

function createCommonExtensionBuildOptions(
  extPath: string,
  extNodeModules: string,
  buildInput: ExtensionBuildInput
): Record<string, any> {
  return {
    absWorkingDir: extPath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    plugins: [createNativeSchemeExternalPlugin()],
    external: buildInput.buildContext.external,
    nodePaths: fs.existsSync(extNodeModules) ? [extNodeModules] : [],
    target: 'es2020',
    jsx: 'automatic',
    jsxImportSource: 'react',
    tsconfigRaw: buildInput.tsconfigRaw,
    define: {
      'process.env.NODE_ENV': '"production"',
      'global': 'globalThis',
    },
    logLevel: 'warning',
    metafile: true,
  };
}

function sameExtensionBuildContext(
  stamp: ExtensionBuildStamp | null,
  context: Omit<ExtensionBuildStamp, 'commands'>
): stamp is ExtensionBuildStamp {
  if (!stamp) return false;
  return (
    stamp.version === context.version &&
    stamp.extName === context.extName &&
    stamp.platform === context.platform &&
    stamp.arch === context.arch &&
    stamp.esbuildVersion === context.esbuildVersion &&
    JSON.stringify(stamp.external) === JSON.stringify(context.external) &&
    stamp.tsconfigRaw === context.tsconfigRaw &&
    JSON.stringify(stamp.runtimeDeps) === JSON.stringify(context.runtimeDeps) &&
    sameBuildFileSignatures(stamp.configSignatures, context.configSignatures)
  );
}

function commandBuildSignature(cmd: any): string {
  return JSON.stringify(cmd || {});
}

function findCommandStamp(
  stamp: ExtensionBuildStamp,
  cmdName: string
): ExtensionCommandBuildStamp | null {
  return stamp.commands.find((command) => command.name === cmdName) || null;
}

function isCommandBuildUpToDate(
  extPath: string,
  commandStamp: ExtensionCommandBuildStamp | null,
  cmd: any,
  entryFile: string,
  outFile: string
): commandStamp is ExtensionCommandBuildStamp {
  if (!commandStamp) return false;
  if (commandStamp.commandSignature !== commandBuildSignature(cmd)) return false;
  if (commandStamp.entryFile !== getStoredBuildPath(extPath, entryFile)) return false;
  if (commandStamp.outFile !== getStoredBuildPath(extPath, outFile)) return false;
  if (!fs.existsSync(outFile)) return false;

  const outputSignature = getBuildFileSignature(extPath, outFile);
  if (!sameBuildFileSignature(commandStamp.outputSignature, outputSignature)) return false;

  const currentInputSignatures = commandStamp.inputSignatures.map((input) =>
    getBuildFileSignature(extPath, resolveStoredBuildPath(extPath, input.path))
  );
  return sameBuildFileSignatures(commandStamp.inputSignatures, currentInputSignatures);
}

function getMetafileInputsForOutput(
  extPath: string,
  metafile: any,
  outFile: string
): string[] {
  const outputs = metafile?.outputs && typeof metafile.outputs === 'object'
    ? metafile.outputs
    : {};
  const normalizedOutFile = path.resolve(outFile);

  for (const [outputPath, outputMeta] of Object.entries(outputs)) {
    const resolvedOutput = path.isAbsolute(outputPath)
      ? path.resolve(outputPath)
      : path.resolve(extPath, outputPath);
    if (resolvedOutput !== normalizedOutFile) continue;
    const inputs = (outputMeta as any)?.inputs;
    if (!inputs || typeof inputs !== 'object') return [];
    return Object.keys(inputs).map((inputPath) =>
      path.isAbsolute(inputPath) ? inputPath : path.resolve(extPath, inputPath)
    );
  }

  return [];
}

function createCommandBuildStamp(
  extPath: string,
  cmd: any,
  entryFile: string,
  outFile: string,
  metafile: any
): ExtensionCommandBuildStamp {
  const inputFiles = new Set<string>([
    entryFile,
    ...getMetafileInputsForOutput(extPath, metafile, outFile),
  ]);
  return {
    name: String(cmd.name),
    commandSignature: commandBuildSignature(cmd),
    entryFile: getStoredBuildPath(extPath, entryFile),
    outFile: getStoredBuildPath(extPath, outFile),
    outputSignature: getBuildFileSignature(extPath, outFile),
    inputSignatures: [...inputFiles]
      .map((filePath) => getBuildFileSignature(extPath, filePath))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function writeMergedCommandBuildStamp(
  buildDir: string,
  buildContext: Omit<ExtensionBuildStamp, 'commands'>,
  commandStamp: ExtensionCommandBuildStamp
): void {
  const previousStamp = readExtensionBuildStamp(buildDir);
  const nextCommandStamps = new Map<string, ExtensionCommandBuildStamp>();

  if (sameExtensionBuildContext(previousStamp, buildContext)) {
    for (const existingStamp of previousStamp.commands) {
      nextCommandStamps.set(existingStamp.name, existingStamp);
    }
  }

  nextCommandStamps.set(commandStamp.name, commandStamp);
  writeExtensionBuildStamp(buildDir, {
    ...buildContext,
    commands: [...nextCommandStamps.values()].sort((a, b) => a.name.localeCompare(b.name)),
  });
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

  invalidateExtensionStaticCacheForPath(extPath);

  let commands: any[];
  let buildInput: ExtensionBuildInput;
  try {
    const pkg = readExtensionManifest(extPath);
    if (!pkg) return 0;
    if (!isManifestPlatformCompatible(pkg)) {
      console.warn(`Skipping build for incompatible extension ${extName}`);
      return 0;
    }
    commands = pkg.commands || [];
    buildInput = createExtensionBuildInput(extName, extPath, pkg);
  } catch {
    return 0;
  }

  if (commands.length === 0) return 0;

  const buildDir = getBuildDir(extPath);
  const buildContext = buildInput.buildContext;
  const previousStamp = readExtensionBuildStamp(buildDir);
  const matchingStamp = sameExtensionBuildContext(previousStamp, buildContext) ? previousStamp : null;
  const buildableCommands: Array<{ cmd: any; entryFile: string; outFile: string }> = [];
  const staleCommands: Array<{ cmd: any; entryFile: string; outFile: string }> = [];
  const nextCommandStamps = new Map<string, ExtensionCommandBuildStamp>();
  let reusedPrebuilt = 0;
  let skipped = 0;

  for (const cmd of commands) {
    if (!cmd.name) continue;
    if (!isCommandPlatformCompatible(cmd)) continue;

    const outFile = path.join(buildDir, `${cmd.name}.js`);
    const entryFile = resolveEntryFile(extPath, cmd);
    if (!entryFile) {
      if (fs.existsSync(outFile)) {
        reusedPrebuilt++;
        continue;
      }
      console.warn(`No entry file for ${extName}/${cmd.name}, skipping`);
      continue;
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const buildableCommand = { cmd, entryFile, outFile };
    buildableCommands.push(buildableCommand);

    const commandStamp = matchingStamp
      ? findCommandStamp(matchingStamp, String(cmd.name))
      : null;
    if (isCommandBuildUpToDate(extPath, commandStamp, cmd, entryFile, outFile)) {
      nextCommandStamps.set(String(cmd.name), commandStamp);
      skipped++;
    } else {
      staleCommands.push(buildableCommand);
    }
  }

  if (buildableCommands.length === 0) {
    if (reusedPrebuilt > 0) {
      console.log(`Reused ${reusedPrebuilt}/${commands.length} pre-built commands for ${extName}`);
      return reusedPrebuilt;
    }
    console.log(`Built 0/${commands.length} commands for ${extName}`);
    return 0;
  }

  if (staleCommands.length === 0) {
    const ready = skipped + reusedPrebuilt;
    console.log(`Reused ${ready}/${commands.length} commands for ${extName}`);
    return ready;
  }

  const extNodeModules = path.join(extPath, 'node_modules');
  if (buildInput.requiresNodeModules && !fs.existsSync(extNodeModules)) {
    try {
      const { installExtensionDeps } = require('./extension-registry');
      await installExtensionDeps(extPath);
    } catch (e: any) {
      console.error(`Failed to install dependencies for ${extName}:`, e?.message || e);
      return skipped + reusedPrebuilt;
    }
    if (!fs.existsSync(extNodeModules)) {
      console.error(`Dependencies missing for ${extName}: ${extNodeModules} not found`);
      return skipped + reusedPrebuilt;
    }
  }

  const esbuild = requireEsbuild();
  const commonOptions = createCommonExtensionBuildOptions(extPath, extNodeModules, buildInput);

  for (const { outFile } of staleCommands) {
    try {
      fs.rmSync(outFile, { force: true });
    } catch {}
  }

  let built = skipped + reusedPrebuilt;
  try {
    console.log(`  Building ${staleCommands.length}/${buildableCommands.length} stale commands for ${extName}…`);
    const entryPoints = Object.fromEntries(
      staleCommands.map(({ cmd, entryFile }) => [String(cmd.name), entryFile])
    );
    const result = await runEsbuildBuild(
      esbuild,
      {
        ...commonOptions,
        entryPoints,
        outdir: buildDir,
      },
      extPath,
      `${extName}/*`
    );

    for (const { cmd, entryFile, outFile } of staleCommands) {
      if (fs.existsSync(outFile)) {
        nextCommandStamps.set(
          String(cmd.name),
          createCommandBuildStamp(extPath, cmd, entryFile, outFile, result?.metafile)
        );
        built++;
      }
    }
  } catch (batchError) {
    console.warn(
      `  Batched esbuild failed for ${extName}; falling back to per-command builds:`,
      (batchError as any)?.message || batchError
    );

    built = skipped + reusedPrebuilt;
    for (const { cmd, entryFile, outFile } of staleCommands) {
      try {
        console.log(`  Building ${extName}/${cmd.name}…`);

        const result = await runEsbuildBuild(
          esbuild,
          {
            ...commonOptions,
            entryPoints: [entryFile],
            outfile: outFile,
          },
          extPath,
          `${extName}/${cmd.name}`
        );

        if (fs.existsSync(outFile)) {
          nextCommandStamps.set(
            String(cmd.name),
            createCommandBuildStamp(extPath, cmd, entryFile, outFile, result?.metafile)
          );
          built++;
        }
      } catch (e) {
        console.error(`  esbuild failed for ${extName}/${cmd.name}:`, e);
      }
    }
  }

  if (nextCommandStamps.size > 0) {
    writeExtensionBuildStamp(buildDir, {
      ...buildContext,
      commands: [...nextCommandStamps.values()].sort((a, b) => a.name.localeCompare(b.name)),
    });
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
 * Build a single command for an extension on-demand.
 * Used as a fallback when the pre-built bundle is missing.
 */
export async function buildSingleCommand(extName: string, cmdName: string): Promise<boolean> {
  const extPath = resolveInstalledExtensionPath(extName);
  if (!extPath) {
    console.error(`buildSingleCommand: extension path not found for ${extName}`);
    return false;
  }

  const pkgPath = path.join(extPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error(`buildSingleCommand: package.json not found at ${pkgPath}`);
    return false;
  }

  invalidateExtensionStaticCacheForPath(extPath);

  let cmd: any;
  let buildInput: ExtensionBuildInput;
  try {
    const pkg = readExtensionManifest(extPath);
    if (!pkg) return false;
    if (!isManifestPlatformCompatible(pkg)) {
      console.error(`buildSingleCommand: platform not compatible for ${extName}`);
      return false;
    }
    const commands = pkg.commands || [];
    cmd = commands.find((c: any) => c.name === cmdName);
    buildInput = createExtensionBuildInput(extName, extPath, pkg);
  } catch (e: any) {
    console.error(`buildSingleCommand: failed to parse package.json for ${extName}:`, e?.message);
    return false;
  }

  if (!cmd) {
    console.error(`buildSingleCommand: command "${cmdName}" not found in ${extName} package.json`);
    return false;
  }
  if (!isCommandPlatformCompatible(cmd)) {
    console.error(`buildSingleCommand: command "${cmdName}" not compatible with current platform`);
    return false;
  }

  const entryFile = resolveEntryFile(extPath, cmd);
  if (!entryFile) {
    console.error(`buildSingleCommand: entry file not found for ${extName}/${cmdName}`);
    return false;
  }

  const buildDir = getBuildDir(extPath);
  fs.mkdirSync(buildDir, { recursive: true });
  const outFile = path.join(buildDir, `${cmdName}.js`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const extNodeModules = path.join(extPath, 'node_modules');

  // If node_modules is missing, install dependencies first
  if (buildInput.requiresNodeModules && !fs.existsSync(extNodeModules)) {
    console.log(`  node_modules missing for ${extName}, installing dependencies…`);
    try {
      const { installExtensionDeps } = require('./extension-registry');
      await installExtensionDeps(extPath);
    } catch (e: any) {
      console.error(`  Failed to install dependencies for ${extName}:`, e?.message);
      return false;
    }
    if (!fs.existsSync(extNodeModules)) return false;
  }

  try {
    const esbuild = requireEsbuild();
    console.log(`  On-demand building ${extName}/${cmdName}…`);
    const result = await runEsbuildBuild(
      esbuild,
      {
        ...createCommonExtensionBuildOptions(extPath, extNodeModules, buildInput),
        outfile: outFile,
        entryPoints: [entryFile],
      },
      extPath,
      `${extName}/${cmdName}`
    );
    const built = fs.existsSync(outFile);
    if (built) {
      writeMergedCommandBuildStamp(
        buildDir,
        buildInput.buildContext,
        createCommandBuildStamp(extPath, cmd, entryFile, outFile, result?.metafile)
      );
    }
    return built;
  } catch (e: any) {
    console.error(`  On-demand esbuild failed for ${extName}/${cmdName}:`, e);
    lastBuildError.set(`${extName}/${cmdName}`, e?.message || String(e));
    return false;
  }
}

// Records the most recent build error per extension/command so that
// getExtensionBundle can surface the real cause to the user instead of
// the generic "On-demand build failed" message.
const lastBuildError = new Map<string, string>();

/**
 * Parse an esbuild BuildFailure and return the list of bare-import package
 * names it could not resolve. Some Raycast extensions import packages (e.g.
 * `fast-glob`) without declaring them in their manifest — Raycast's `ray build`
 * provides them implicitly, but esbuild bails out. When this returns a
 * non-empty list the caller can install them and retry.
 */
function extractMissingBareImports(error: any): string[] {
  const errors = Array.isArray(error?.errors) ? error.errors : [];
  const found = new Set<string>();
  for (const err of errors) {
    const text = String(err?.text || '');
    const match = text.match(/Could not resolve\s+"([^"]+)"/);
    if (!match) continue;
    const specifier = match[1];
    // Only bare imports — ignore relative/absolute paths and scheme URLs
    if (
      !specifier ||
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      specifier.includes(':')
    ) {
      continue;
    }
    // Bare-package name: optional @scope/ then name. Drop any subpath.
    const parts = specifier.split('/');
    const pkgName = specifier.startsWith('@')
      ? parts.slice(0, 2).join('/')
      : parts[0];
    if (!pkgName) continue;
    // Skip things that are already external (shouldn't appear, but defensive)
    if (nodeBuiltins.includes(pkgName)) continue;
    if (pkgName.startsWith('@raycast/')) continue;
    found.add(pkgName);
  }
  return [...found];
}

async function runEsbuildBuild(
  esbuild: any,
  options: any,
  extPath: string,
  label: string
): Promise<any> {
  try {
    return await esbuild.build(options);
  } catch (error: any) {
    const missing = extractMissingBareImports(error);
    if (missing.length === 0) throw error;
    console.log(
      `  Missing packages for ${label} (${missing.join(', ')}); installing and retrying…`
    );
    const { installSpecificPackages } = require('./extension-registry');
    try {
      await installSpecificPackages(extPath, missing);
    } catch (installError: any) {
      console.error(
        `  Failed to install missing packages for ${label}: ${installError?.message || installError}`
      );
      throw error;
    }
    return await esbuild.build(options);
  }
}

/**
 * Get a pre-built extension command bundle.
 * Falls back to on-demand building if the bundle is missing.
 */
export async function getExtensionBundle(
  extName: string,
  cmdName: string
): Promise<ExtensionBundleResult | null> {
  const normalizedExtName = normalizeExtensionName(extName);
  const extPath = resolveInstalledExtensionPath(normalizedExtName);
  if (!extPath) {
    const searchRoots = getConfiguredExtensionRoots();
    const msg = `Extension directory not found: ${normalizedExtName}. Searched roots: ${searchRoots.join(', ')}`;
    console.error(msg);
    throw new Error(msg);
  }
  let outFile = path.join(extPath, '.sc-build', `${cmdName}.js`);

  if (!fs.existsSync(outFile)) {
    console.log(`Pre-built bundle not found for ${normalizedExtName}/${cmdName}, building on-demand…`);
    const built = await buildSingleCommand(normalizedExtName, cmdName);
    if (!built || !fs.existsSync(outFile)) {
      // Fallback: some extensions require full-workspace bundling to hydrate deps.
      try {
        console.log(`Single-command build failed for ${normalizedExtName}/${cmdName}; trying full extension rebuild…`);
        await buildAllCommands(normalizedExtName);
      } catch (rebuildError) {
        console.warn(`Full rebuild fallback failed for ${normalizedExtName}:`, rebuildError);
      }
    }

    // Detect "incomplete bundle" scenario: an S3 pre-built bundle dropped
    // .sc-build/ on disk for some commands but didn't ship the matching
    // source files for others. resolveEntryFile() returns null, the build
    // can never produce outFile, and the user is stuck. Re-run the install
    // from the source-download path (skipBundle: true) and retry the build.
    if (!fs.existsSync(outFile)) {
      let entryMissing = false;
      try {
        const pkg = readExtensionManifest(extPath);
        const cmd = (Array.isArray(pkg?.commands) ? pkg.commands : []).find((c: any) => c?.name === cmdName);
        if (cmd && !resolveEntryFile(extPath, cmd)) entryMissing = true;
      } catch {}

      if (entryMissing) {
        console.log(`Source missing for ${normalizedExtName}/${cmdName}; re-installing from source to recover…`);
        try {
          const { installExtension } = require('./extension-registry');
          const reinstalled = await installExtension(normalizedExtName, { skipBundle: true });
          if (reinstalled) {
            // Retry building now that source should be present.
            const rebuilt = await buildSingleCommand(normalizedExtName, cmdName);
            if (!rebuilt || !fs.existsSync(outFile)) {
              try {
                await buildAllCommands(normalizedExtName);
              } catch (e) {
                console.warn(`Post-recovery full rebuild failed for ${normalizedExtName}:`, e);
              }
            }
          }
        } catch (recoveryError) {
          console.warn(`Source-reinstall recovery failed for ${normalizedExtName}:`, recoveryError);
        }
      }
    }

    if (!fs.existsSync(outFile)) {
      let diagnostic = '';
      try {
        const pkg = readExtensionManifest(extPath);
        const commands = Array.isArray(pkg?.commands) ? pkg.commands : [];
        const cmd = commands.find((c: any) => c?.name === cmdName);
        const nodeModulesExists = fs.existsSync(path.join(extPath, 'node_modules'));
        const requiresNodeModules = extensionRequiresNodeModules(pkg);

        if (!cmd) {
          diagnostic = ` Command "${cmdName}" not found in package.json.`;
        } else {
          const entry = resolveEntryFile(extPath, cmd);
          if (!entry) {
            diagnostic = ` Entry file not found for "${cmdName}".`;
          } else if (requiresNodeModules && !nodeModulesExists) {
            diagnostic = ' node_modules is missing (dependency installation likely failed).';
          }
        }
      } catch {}

      const underlying = lastBuildError.get(`${normalizedExtName}/${cmdName}`);
      const underlyingSuffix = underlying ? ` Underlying error: ${underlying}` : '';
      const msg = `On-demand build failed for ${normalizedExtName}/${cmdName}. Extension path: ${extPath}. Expected output: ${outFile}.${diagnostic}${underlyingSuffix}`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  const code = readExtensionBundleCode(outFile);
  if (!code) {
    const msg = `Pre-built bundle is empty: ${outFile}`;
    console.error(msg);
    throw new Error(msg);
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
    const pkg = readExtensionManifest(extPath);
    if (!pkg) return null;
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
    const storedExtensionPrefs = getExtensionPreferences(normalizedExtName);
    const storedCommandPrefs = getExtensionPreferences(normalizedExtName, cmdName);
    preferences = { ...extensionPrefs, ...storedExtensionPrefs };
    commandPreferences = { ...commandPrefs, ...storedCommandPrefs };
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
  const rawAssetsPath = path.join(extPath, 'assets');
  // Some extensions run `chmod +x ${assetsPath}/...` via execSync without quoting the path.
  // If assetsPath contains spaces (e.g. "Application Support"), the shell splits on them and
  // the command fails. Work around this by exposing a symlink at a space-free /tmp path.
  let assetsPath = rawAssetsPath;
  if (rawAssetsPath.includes(' ') && fs.existsSync(rawAssetsPath)) {
    const symlinkDir = path.join(os.tmpdir(), 'supercmd-assets');
    const symlinkPath = path.join(symlinkDir, normalizedExtName);
    try {
      fs.mkdirSync(symlinkDir, { recursive: true });
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
      fs.symlinkSync(rawAssetsPath, symlinkPath);
      assetsPath = symlinkPath;
    } catch {
      // Symlink failed (permissions, etc.) — fall back to the original path
    }
  }
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
