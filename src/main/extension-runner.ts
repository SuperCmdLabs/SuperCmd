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
import * as path from 'path';

export interface ExtensionCommandInfo {
  id: string;
  title: string;
  extName: string;
  cmdName: string;
  description: string;
  mode: string;
  keywords: string[];
  iconDataUrl?: string;
}

// ─── Paths ──────────────────────────────────────────────────────────

function getExtensionsDir(): string {
  return path.join(app.getPath('userData'), 'extensions');
}

function getBuildDir(extName: string): string {
  const dir = path.join(getExtensionsDir(), extName, '.sc-build');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
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

// ─── Discovery ──────────────────────────────────────────────────────

/**
 * Scan installed extensions directory and return a flat list of
 * commands that should appear in the launcher.
 */
export function discoverInstalledExtensionCommands(): ExtensionCommandInfo[] {
  const extDir = getExtensionsDir();
  if (!fs.existsSync(extDir)) return [];

  const results: ExtensionCommandInfo[] = [];

  for (const dir of fs.readdirSync(extDir)) {
    const extPath = path.join(extDir, dir);
    const pkgPath = path.join(extPath, 'package.json');

    try {
      if (!fs.statSync(extPath).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!fs.existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const iconDataUrl = getExtensionIconDataUrl(
        extPath,
        pkg.icon || 'icon.png'
      );

      for (const cmd of pkg.commands || []) {
        if (!cmd.name) continue;
        results.push({
          id: `ext-${dir}-${cmd.name}`,
          title: cmd.title || cmd.name,
          extName: dir,
          cmdName: cmd.name,
          description: cmd.description || '',
          mode: cmd.mode || 'view',
          keywords: [
            dir,
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
  'node:assert', 'node:buffer', 'node:child_process',
  'node:crypto', 'node:events', 'node:fs', 'node:fs/promises',
  'node:http', 'node:https', 'node:module', 'node:net',
  'node:os', 'node:path', 'node:process', 'node:querystring',
  'node:stream', 'node:timers', 'node:timers/promises',
  'node:url', 'node:util', 'node:vm', 'node:worker_threads',
  'node:zlib',
];

/**
 * Resolve the source entry file for a given command.
 */
function resolveEntryFile(extPath: string, cmdName: string): string | null {
  const candidates = [
    path.join(extPath, 'src', `${cmdName}.tsx`),
    path.join(extPath, 'src', `${cmdName}.ts`),
    path.join(extPath, 'src', `${cmdName}.jsx`),
    path.join(extPath, 'src', `${cmdName}.js`),
    path.join(extPath, 'src', 'index.tsx'),
    path.join(extPath, 'src', 'index.ts'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Build ALL commands for an installed extension using esbuild.
 * Called at install time so the extension is ready to run instantly.
 *
 * Returns the number of commands successfully built.
 */
export async function buildAllCommands(extName: string): Promise<number> {
  const extPath = path.join(getExtensionsDir(), extName);
  const pkgPath = path.join(extPath, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    console.error(`No package.json found for extension ${extName}`);
    return 0;
  }

  let commands: { name: string }[];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    commands = pkg.commands || [];
  } catch {
    return 0;
  }

  if (commands.length === 0) return 0;

  const esbuild = require('esbuild');
  const extNodeModules = path.join(extPath, 'node_modules');
  const buildDir = getBuildDir(extName);
  let built = 0;

  for (const cmd of commands) {
    if (!cmd.name) continue;

    const entryFile = resolveEntryFile(extPath, cmd.name);
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
}

/**
 * Parse preferences from package.json and return default values.
 * Extension preferences are defined in the manifest and can have default values.
 */
function parsePreferences(
  pkg: any,
  cmdName: string
): { extensionPrefs: Record<string, any>; commandPrefs: Record<string, any> } {
  const extensionPrefs: Record<string, any> = {};
  const commandPrefs: Record<string, any> = {};

  // Extension-level preferences
  for (const pref of pkg.preferences || []) {
    if (!pref.name) continue;
    // Set default value based on type
    if (pref.default !== undefined) {
      extensionPrefs[pref.name] = pref.default;
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
      if (pref.default !== undefined) {
        commandPrefs[pref.name] = pref.default;
      } else if (pref.type === 'checkbox') {
        commandPrefs[pref.name] = false;
      } else if (pref.type === 'textfield' || pref.type === 'password') {
        commandPrefs[pref.name] = '';
      } else if (pref.type === 'dropdown') {
        commandPrefs[pref.name] = pref.data?.[0]?.value ?? '';
      }
    }
  }

  return { extensionPrefs, commandPrefs };
}

/**
 * Get a pre-built extension command bundle.
 * Returns null if the bundle doesn't exist (extension not built).
 */
export function getExtensionBundle(
  extName: string,
  cmdName: string
): ExtensionBundleResult | null {
  const extPath = path.join(getExtensionsDir(), extName);
  const outFile = path.join(extPath, '.sc-build', `${cmdName}.js`);

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

  try {
    const pkgPath = path.join(extPath, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const cmd = (pkg.commands || []).find((c: any) => c.name === cmdName);
    if (cmd?.title) title = cmd.title;
    if (cmd?.mode) mode = cmd.mode;
    if (pkg?.title) extensionDisplayName = pkg.title;
    extensionIconDataUrl = getExtensionIconDataUrl(extPath, pkg.icon || 'icon.png');

    const rawOwner = pkg.owner || pkg.author || '';
    owner = typeof rawOwner === 'object' ? (rawOwner as any).name || '' : rawOwner;

    const { extensionPrefs, commandPrefs } = parsePreferences(pkg, cmdName);
    preferences = extensionPrefs;
    commandPreferences = commandPrefs;
  } catch {}

  // Compute paths
  const assetsPath = path.join(extPath, 'assets');
  const supportPath = path.join(app.getPath('userData'), 'extension-support', extName);

  // Ensure support directory exists
  if (!fs.existsSync(supportPath)) {
    fs.mkdirSync(supportPath, { recursive: true });
  }

  return {
    code,
    title,
    mode,
    extensionName: extName,
    extensionDisplayName,
    extensionIconDataUrl,
    commandName: cmdName,
    assetsPath,
    supportPath,
    extensionPath: extPath,
    owner,
    preferences: { ...preferences, ...commandPreferences },
    commandPreferences,
  };
}
