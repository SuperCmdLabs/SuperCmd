/**
 * Command Registry
 * 
 * Dynamically discovers ALL installed applications and ALL System Settings
 * panes by scanning the filesystem directly. No hardcoded lists.
 * 
 * Icons are extracted using:
 * 1. sips for .icns files (fast, works for .app bundles)
 * 2. NSWorkspace via osascript/JXA for bundles without .icns (settings panes)
 * 3. Persistent disk cache so icons are only extracted once
 */

import { app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { discoverInstalledExtensionCommands } from './extension-runner';

const execAsync = promisify(exec);
let iconCounter = 0;

export interface CommandInfo {
  id: string;
  title: string;
  keywords?: string[];
  iconDataUrl?: string;
  category: 'app' | 'settings' | 'system' | 'extension';
  /** .app path for apps, bundle identifier for settings */
  path?: string;
  /** Extension command mode, e.g. view/no-view/menu-bar */
  mode?: string;
  /** Background refresh interval from manifest, e.g. 1m, 12h */
  interval?: string;
  /** Whether command should start disabled until user enables it */
  disabledByDefault?: boolean;
  /** Bundle path on disk (used for icon extraction) */
  _bundlePath?: string;
}

// ─── Cache ──────────────────────────────────────────────────────────

let cachedCommands: CommandInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 120_000; // 2 min

// ─── Icon Disk Cache ────────────────────────────────────────────────

let iconCacheDir: string | null = null;

function getIconCacheDir(): string {
  if (!iconCacheDir) {
    iconCacheDir = path.join(app.getPath('userData'), 'icon-cache');
    if (!fs.existsSync(iconCacheDir)) {
      fs.mkdirSync(iconCacheDir, { recursive: true });
    }
  }
  return iconCacheDir;
}

function iconCacheKey(bundlePath: string): string {
  // v6: invalidate cached generic settings icons and old naming/icon behavior
  return 'v6-' + crypto.createHash('md5').update(bundlePath).digest('hex');
}

function getCachedIcon(bundlePath: string): string | undefined {
  try {
    const cacheFile = path.join(getIconCacheDir(), `${iconCacheKey(bundlePath)}.b64`);
    if (fs.existsSync(cacheFile)) {
      return fs.readFileSync(cacheFile, 'utf-8');
    }
  } catch {}
  return undefined;
}

function setCachedIcon(bundlePath: string, dataUrl: string): void {
  try {
    const cacheFile = path.join(getIconCacheDir(), `${iconCacheKey(bundlePath)}.b64`);
    fs.writeFileSync(cacheFile, dataUrl);
  } catch {}
}

// ─── Icon Extraction ────────────────────────────────────────────────

/**
 * Convert an .icns file to a base64 PNG data URL using macOS `sips`.
 */
async function icnsToPngDataUrl(icnsPath: string): Promise<string | undefined> {
  const tmpPng = path.join(
    app.getPath('temp'),
    `launcher-icon-${++iconCounter}.png`
  );
  try {
    await execAsync(
      `/usr/bin/sips -s format png -z 64 64 "${icnsPath}" --out "${tmpPng}" 2>/dev/null`
    );
    const pngBuf = fs.readFileSync(tmpPng);
    fs.unlinkSync(tmpPng);
    if (pngBuf.length > 100) {
      return `data:image/png;base64,${pngBuf.toString('base64')}`;
    }
  } catch {
    try { fs.unlinkSync(tmpPng); } catch {}
  }
  return undefined;
}

/**
 * Extract icon from a bundle via .icns files (fast path).
 * Returns undefined if no .icns is found.
 */
async function getIconFromIcns(bundlePath: string): Promise<string | undefined> {
  const resourcesDir = path.join(bundlePath, 'Contents', 'Resources');

  // Try CFBundleIconFile / CFBundleIconName from Info.plist
  try {
    const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
    if (fs.existsSync(plistPath)) {
      const { stdout } = await execAsync(
        `/usr/bin/plutil -convert json -o - "${plistPath}" 2>/dev/null`
      );
      const info = JSON.parse(stdout);
      const iconFileName: string | undefined =
        info.CFBundleIconFile || info.CFBundleIconName;

      if (iconFileName) {
        let icnsPath = path.join(resourcesDir, iconFileName);
        if (!fs.existsSync(icnsPath) && !iconFileName.endsWith('.icns')) {
          icnsPath = path.join(resourcesDir, `${iconFileName}.icns`);
        }
        if (fs.existsSync(icnsPath)) {
          return await icnsToPngDataUrl(icnsPath);
        }
      }
    }
  } catch {}

  // Search for common icon filenames in Resources/
  if (fs.existsSync(resourcesDir)) {
    try {
      const files = fs.readdirSync(resourcesDir);
      const priorityNames = ['icon.icns', 'AppIcon.icns', 'SharedAppIcon.icns'];
      for (const name of priorityNames) {
        if (files.includes(name)) {
          const result = await icnsToPngDataUrl(path.join(resourcesDir, name));
          if (result) return result;
        }
      }
      const anyIcns = files.find((f) => f.endsWith('.icns'));
      if (anyIcns) {
        return await icnsToPngDataUrl(path.join(resourcesDir, anyIcns));
      }
    } catch {}
  }

  return undefined;
}

/**
 * Batch-extract icons for bundles that don't have .icns files.
 * Uses macOS NSWorkspace API via osascript/JXA — gets the real icon for ANY bundle.
 * Results are written to temp PNGs, resized, and converted to base64 data URLs.
 */
async function batchGetIconsViaWorkspace(
  bundlePaths: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (bundlePaths.length === 0) return result;

  const tmpDir = path.join(app.getPath('temp'), `launcher-ws-icons-${Date.now()}`);
  const tmpPathsFile = path.join(app.getPath('temp'), `launcher-icon-paths-${Date.now()}.json`);
  const tmpScript = path.join(app.getPath('temp'), `launcher-icon-script-${Date.now()}.js`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpPathsFile, JSON.stringify(bundlePaths));

    // JXA script that uses NSWorkspace.iconForFile to get actual bundle icons
    const jxaScript = `
ObjC.import("AppKit");
ObjC.import("Foundation");

var inputPath = "${tmpPathsFile.replace(/"/g, '\\"')}";
var outputDir = "${tmpDir.replace(/"/g, '\\"')}";

var data = $.NSData.dataWithContentsOfFile(inputPath);
var str = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
var paths = JSON.parse(str);

var ws = $.NSWorkspace.sharedWorkspace;
var results = {};

for (var i = 0; i < paths.length; i++) {
  try {
    var p = paths[i];
    var icon = ws.iconForFile(p);
    icon.setSize({width: 64, height: 64});
    var tiffData = icon.TIFFRepresentation;
    var bitmapRep = $.NSBitmapImageRep.imageRepWithData(tiffData);
    var pngData = bitmapRep.representationUsingTypeProperties(4, $({}));
    var outFile = outputDir + "/" + i + ".png";
    pngData.writeToFileAtomically(outFile, true);
    results[p] = outFile;
  } catch(e) {}
}

var resultStr = $.NSString.alloc.initWithUTF8String(JSON.stringify(results));
resultStr.writeToFileAtomicallyEncodingError(outputDir + "/map.json", true, 4, null);
`;

    fs.writeFileSync(tmpScript, jxaScript);
    await execAsync(`/usr/bin/osascript -l JavaScript "${tmpScript}" 2>/dev/null`);

    // Read the mapping
    const mapFile = path.join(tmpDir, 'map.json');
    if (fs.existsSync(mapFile)) {
      const map: Record<string, string> = JSON.parse(
        fs.readFileSync(mapFile, 'utf-8')
      );

      // Resize all PNGs with sips and convert to base64
      for (const [bundlePath, pngFile] of Object.entries(map)) {
        try {
          // Resize to 64x64
          await execAsync(
            `/usr/bin/sips -z 64 64 "${pngFile}" --out "${pngFile}" 2>/dev/null`
          );
          const pngBuf = fs.readFileSync(pngFile);
          if (pngBuf.length > 100) {
            const dataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`;
            result.set(bundlePath, dataUrl);
            // Save to disk cache
            setCachedIcon(bundlePath, dataUrl);
          }
        } catch {}
      }
    }
  } catch (error) {
    console.warn('Batch icon extraction via NSWorkspace failed:', error);
  } finally {
    // Cleanup temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(tmpPathsFile); } catch {}
    try { fs.unlinkSync(tmpScript); } catch {}
  }

  return result;
}

/**
 * Get icon for a single bundle: disk cache → .icns → mark for batch.
 * Returns the data URL or undefined (meaning needs batch NSWorkspace extraction).
 */
async function getIconDataUrl(bundlePath: string): Promise<string | undefined> {
  // Check disk cache first
  const cached = getCachedIcon(bundlePath);
  if (cached) return cached;

  // Try .icns extraction for any bundle type (.app, .appex, .prefPane)
  const icnsResult = await getIconFromIcns(bundlePath);
  if (icnsResult) {
    setCachedIcon(bundlePath, icnsResult);
    return icnsResult;
  }

  // No .icns found — return undefined.
  // NSWorkspace batch extraction will run later for app/settings bundles.
  return undefined;
}

// ─── Plist / Name Helpers ───────────────────────────────────────────

/**
 * Read a JSON-converted Info.plist and return the whole object.
 */
async function readPlistJson(
  bundlePath: string
): Promise<Record<string, any> | null> {
  try {
    const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
    if (!fs.existsSync(plistPath)) return null;
    const { stdout } = await execAsync(
      `/usr/bin/plutil -convert json -o - "${plistPath}" 2>/dev/null`
    );
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Turn "DateAndTime" → "Date & Time", etc.
 */
function cleanPaneName(raw: string): string {
  let s = raw
    .replace(/Pref$/, '')
    .replace(/\.prefPane$/, '')
    .replace(/SettingsExtension$/, '')
    .replace(/Settings$/, '')
    .replace(/Extension$/, '')
    .replace(/Intents$/, '')
    .replace(/IntentsExtension$/, '');

  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  const replacements: Record<string, string> = {
    'And': '&',
    'Energy Saver': 'Energy Saver',
    'Print And Fax': 'Printers & Fax',
    'Print And Scan': 'Printers & Scanners',
    'Sharing Pref': 'Sharing',
    'Expose': 'Mission Control',
    'Universal Access Pref': 'Accessibility',
    'Localization': 'Language & Region',
    'Speech': 'Siri & Dictation',
    'Discs': 'Discs Handling',
    'Apple ID Pref Pane': 'Apple ID',
    'Family Sharing Pref Pane': 'Family Sharing',
    'Class Kit Preference Pane': 'Classroom',
    'Desktop Screen Effects': 'Desktop & Screen Saver',
    'Touch ID': 'Touch ID & Password',
    'Digi Hub': 'CDs & DVDs',
    'Power Preferences': 'Battery',
    'PowerPreferences': 'Battery',
    'Security': 'Privacy & Security',
    'Print & Scan': 'Printers & Scanners',
    'Print & Fax': 'Printers & Scanners',
    'Keyboard Shortcuts': 'Keyboard',
    'Trackpad Settings': 'Trackpad',
  };

  s = s.replace(/\bAnd\b/g, '&');

  for (const [from, to] of Object.entries(replacements)) {
    if (s === from) {
      s = to;
      break;
    }
  }

  return s.trim();
}

function canonicalSettingsTitle(title: string, bundleId?: string): string {
  const cleaned = cleanPaneName(title);
  const byBundle: Record<string, string> = {
    'com.apple.settings.PrivacySecurity.extension': 'Privacy & Security',
    'com.apple.preference.security': 'Privacy & Security',
    'com.apple.preference.battery': 'Battery',
    'com.apple.preference.energysaver': 'Battery',
    'com.apple.preference.printfax': 'Printers & Scanners',
    'com.apple.preference.print': 'Printers & Scanners',
    'com.apple.preference.trackpad': 'Trackpad',
  };
  if (bundleId && byBundle[bundleId]) return byBundle[bundleId];

  const byTitle: Record<string, string> = {
    security: 'Privacy & Security',
    'privacy security': 'Privacy & Security',
    powerpreferences: 'Battery',
    'power preferences': 'Battery',
    'print & fax': 'Printers & Scanners',
    'print & scan': 'Printers & Scanners',
  };
  const key = cleaned.toLowerCase().replace(/\s+/g, ' ').trim();
  return byTitle[key] || cleaned;
}

// ─── Application Discovery ──────────────────────────────────────────

async function discoverApplications(): Promise<CommandInfo[]> {
  const results: CommandInfo[] = [];
  const seen = new Set<string>();

  const appDirs = [
    '/Applications',
    '/System/Applications',
    '/System/Applications/Utilities',
    path.join(process.env.HOME || '', 'Applications'),
  ];

  for (const dir of appDirs) {
    if (!fs.existsSync(dir)) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    const appPaths: string[] = [];
    for (const entry of entries) {
      if (entry.endsWith('.app')) {
        appPaths.push(path.join(dir, entry));
      }
    }

    const BATCH = 15;
    for (let i = 0; i < appPaths.length; i += BATCH) {
      const batch = appPaths.slice(i, i + BATCH);
      const items = await Promise.all(
        batch.map(async (appPath) => {
          const name = path.basename(appPath, '.app');
          const key = name.toLowerCase();
          if (seen.has(key)) return null;
          seen.add(key);

          const iconDataUrl = await getIconDataUrl(appPath);

          return {
            id: `app-${key.replace(/[^a-z0-9]+/g, '-')}`,
            title: name,
            keywords: [key],
            iconDataUrl,
            category: 'app' as const,
            path: appPath,
            _bundlePath: appPath,
          };
        })
      );

      for (const item of items) {
        if (item) results.push(item);
      }
    }
  }

  return results;
}

// ─── System Settings Discovery ──────────────────────────────────────

async function discoverSystemSettings(): Promise<CommandInfo[]> {
  const results: CommandInfo[] = [];
  const seen = new Set<string>();

  // ── Source 1: .appex extensions (macOS Ventura+) ──
  const extDir = '/System/Library/ExtensionKit/Extensions';
  if (fs.existsSync(extDir)) {
    let files: string[];
    try {
      files = fs.readdirSync(extDir);
    } catch {
      files = [];
    }

    const allAppex = files.filter((f) => f.endsWith('.appex'));

    const BATCH = 15;
    for (let i = 0; i < allAppex.length; i += BATCH) {
      const batch = allAppex.slice(i, i + BATCH);
      const items = await Promise.all(
        batch.map(async (file) => {
          const extPath = path.join(extDir, file);
          const info = await readPlistJson(extPath);
          if (!info) return null;

          const exAttrs = info.EXAppExtensionAttributes || {};
          const extPoint = exAttrs.EXExtensionPointIdentifier;
          if (extPoint !== 'com.apple.Settings.extension.ui') {
            return null;
          }

          const settingsAttrs = exAttrs.SettingsExtensionAttributes || {};
          let displayName =
            info.CFBundleDisplayName || info.CFBundleName || '';
          const bundleId: string = info.CFBundleIdentifier || '';
          const legacyBundleId: string | undefined =
            typeof settingsAttrs.legacyBundleIdentifier === 'string'
              ? settingsAttrs.legacyBundleIdentifier
              : undefined;
          const openIdentifier = legacyBundleId || bundleId;

          if (
            !displayName ||
            displayName.includes('Intents') ||
            displayName.includes('Widget') ||
            displayName.endsWith('DeviceExpert') ||
            bundleId.includes('intents') ||
            bundleId.includes('widget') ||
            !openIdentifier
          ) {
            return null;
          }

          displayName = canonicalSettingsTitle(displayName, bundleId);

          if (!displayName || displayName.length < 2) return null;

          const key = displayName.toLowerCase();
          if (seen.has(key)) return null;
          seen.add(key);

          // Try fast .icns extraction (will return undefined for Assets.car-only bundles)
          const iconDataUrl = await getIconDataUrl(extPath);

          return {
            id: `settings-${key.replace(/[^a-z0-9]+/g, '-')}`,
            title: displayName,
            keywords: ['system settings', 'preferences', key, bundleId, legacyBundleId || ''],
            iconDataUrl,
            category: 'settings' as const,
            path: openIdentifier,
            _bundlePath: extPath,
          };
        })
      );

      for (const item of items) {
        if (item) results.push(item);
      }
    }
  }

  // ── Source 2: .prefPane bundles ──
  const prefDirs = [
    '/System/Library/PreferencePanes',
    '/Library/PreferencePanes',
    path.join(process.env.HOME || '', 'Library', 'PreferencePanes'),
  ];

  for (const dir of prefDirs) {
    if (!fs.existsSync(dir)) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    const panePaths: string[] = [];
    for (const entry of entries) {
      if (entry.endsWith('.prefPane')) {
        panePaths.push(path.join(dir, entry));
      }
    }

    const BATCH = 15;
    for (let i = 0; i < panePaths.length; i += BATCH) {
      const batch = panePaths.slice(i, i + BATCH);
      const items = await Promise.all(
        batch.map(async (panePath) => {
          const rawName = path.basename(panePath, '.prefPane');
          const paneInfo = await readPlistJson(panePath);
          const paneBundleId: string | undefined =
            typeof paneInfo?.CFBundleIdentifier === 'string'
              ? paneInfo.CFBundleIdentifier
              : undefined;
          const displayName = canonicalSettingsTitle(rawName, paneBundleId);
          const key = displayName.toLowerCase();
          if (seen.has(key)) return null;
          seen.add(key);

          const iconDataUrl = await getIconDataUrl(panePath);

          return {
            id: `settings-${key.replace(/[^a-z0-9]+/g, '-')}`,
            title: displayName,
            keywords: ['system settings', 'preferences', key],
            iconDataUrl,
            category: 'settings' as const,
            path: paneBundleId || rawName,
            _bundlePath: panePath,
          };
        })
      );

      for (const item of items) {
        if (item) results.push(item);
      }
    }
  }

  return results;
}

// ─── Command Execution ──────────────────────────────────────────────

async function openAppByPath(appPath: string): Promise<void> {
  await execAsync(`open "${appPath}"`);
}

async function openSettingsPane(identifier: string): Promise<void> {
  if (identifier.startsWith('com.apple.')) {
    try {
      await execAsync(`open "x-apple.systempreferences:${identifier}"`);
      return;
    } catch { /* fall through */ }
  }

  try {
    await execAsync(
      `open "x-apple.systempreferences:com.apple.settings.${identifier}"`
    );
    return;
  } catch { /* fall through */ }

  try {
    await execAsync(
      `open "x-apple.systempreferences:com.apple.preference.${identifier.toLowerCase()}"`
    );
    return;
  } catch { /* fall through */ }

  try {
    await execAsync('open -a "System Settings"');
  } catch {
    try {
      await execAsync('open -a "System Preferences"');
    } catch (e) {
      console.error('Could not open System Settings:', e);
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export async function getAvailableCommands(): Promise<CommandInfo[]> {
  const now = Date.now();
  if (cachedCommands && now - cacheTimestamp < CACHE_TTL) {
    return cachedCommands;
  }

  console.log('Discovering applications and settings…');
  const t0 = Date.now();

  const [apps, settings] = await Promise.all([
    discoverApplications(),
    discoverSystemSettings(),
  ]);

  apps.sort((a, b) => a.title.localeCompare(b.title));
  settings.sort((a, b) => a.title.localeCompare(b.title));

  const systemCommands: CommandInfo[] = [
    {
      id: 'system-cursor-prompt',
      title: 'Inline AI Prompt',
      keywords: ['ai', 'prompt', 'cursor', 'inline', 'rewrite', 'edit', 'command+k'],
      category: 'system',
    },
    {
      id: 'system-clipboard-manager',
      title: 'Clipboard History',
      keywords: ['clipboard', 'history', 'copy', 'paste', 'manager'],
      category: 'system',
    },
    {
      id: 'system-open-settings',
      title: 'SuperCommand Settings',
      keywords: ['settings', 'preferences', 'config', 'configuration', 'supercommand'],
      category: 'system',
    },
    {
      id: 'system-open-ai-settings',
      title: 'SuperCommand AI',
      keywords: ['ai', 'model', 'provider', 'openai', 'anthropic', 'ollama', 'supercommand'],
      category: 'system',
    },
    {
      id: 'system-supercommand-whisper',
      title: 'SuperCommand Whisper',
      keywords: ['whisper', 'speech', 'voice', 'dictation', 'transcribe', 'overlay', 'supercommand'],
      category: 'system',
    },
    {
      id: 'system-supercommand-speak',
      title: 'SuperCommand Speak',
      keywords: ['speak', 'tts', 'read', 'selected text', 'edge-tts', 'speechify', 'jarvis', 'supercommand'],
      category: 'system',
    },
    {
      id: 'system-open-extensions-settings',
      title: 'SuperCommand Extensions',
      keywords: ['extensions', 'store', 'community', 'hotkey', 'supercommand'],
      category: 'system',
    },
    {
      id: 'system-open-onboarding',
      title: 'SuperCommand Onboarding',
      keywords: ['welcome', 'onboarding', 'intro', 'setup', 'supercommand'],
      category: 'system',
    },
    {
      id: 'system-quit-launcher',
      title: 'Quit SuperCommand',
      keywords: ['exit', 'close', 'quit', 'stop'],
      category: 'system',
    },
    {
      id: 'system-create-snippet',
      title: 'Create Snippet',
      keywords: ['snippet', 'create', 'new', 'text expansion'],
      category: 'system',
    },
    {
      id: 'system-search-snippets',
      title: 'Search Snippets',
      keywords: ['snippet', 'search', 'find', 'text expansion'],
      category: 'system',
    },
    {
      id: 'system-search-files',
      title: 'Search Files',
      keywords: ['files', 'finder', 'search', 'find', 'open'],
      category: 'system',
    },
    {
      id: 'system-import-snippets',
      title: 'Import Snippets',
      keywords: ['snippet', 'import', 'load', 'file'],
      category: 'system',
    },
    {
      id: 'system-export-snippets',
      title: 'Export Snippets',
      keywords: ['snippet', 'export', 'save', 'backup', 'file'],
      category: 'system',
    },
  ];

  // Installed community extensions
  let extensionCommands: CommandInfo[] = [];
  try {
    extensionCommands = discoverInstalledExtensionCommands().map((ext) => ({
      id: ext.id,
      title: ext.title,
      keywords: ext.keywords,
      iconDataUrl: ext.iconDataUrl,
      category: 'extension' as const,
      path: `${ext.extName}/${ext.cmdName}`,
      mode: ext.mode,
      interval: ext.interval,
      disabledByDefault: ext.disabledByDefault,
    }));
  } catch (e) {
    console.error('Failed to discover installed extensions:', e);
  }

  const allCommands = [...apps, ...settings, ...extensionCommands, ...systemCommands];

  // ── Batch-extract icons via NSWorkspace for app/settings bundles ──
  const bundlesNeedingIcon = allCommands.filter(
    (c) =>
      !c.iconDataUrl &&
      c._bundlePath &&
      (c.category === 'app' || c.category === 'settings')
  );

  if (bundlesNeedingIcon.length > 0) {
    console.log(`Extracting ${bundlesNeedingIcon.length} app/settings icons via NSWorkspace…`);
    const bundlePaths = bundlesNeedingIcon.map((c) => c._bundlePath!);
    const iconMap = await batchGetIconsViaWorkspace(bundlePaths);

    for (const cmd of bundlesNeedingIcon) {
      const dataUrl = iconMap.get(cmd._bundlePath!);
      if (dataUrl) {
        cmd.iconDataUrl = dataUrl;
      }
    }
  }

  // Some settings bundles yield the same generic document icon.
  // If a settings icon is repeated many times, drop it so UI fallback icon is used.
  const settingsIconCounts = new Map<string, number>();
  for (const cmd of allCommands) {
    if (cmd.category !== 'settings' || !cmd.iconDataUrl) continue;
    settingsIconCounts.set(cmd.iconDataUrl, (settingsIconCounts.get(cmd.iconDataUrl) || 0) + 1);
  }
  for (const cmd of allCommands) {
    if (cmd.category !== 'settings' || !cmd.iconDataUrl) continue;
    if ((settingsIconCounts.get(cmd.iconDataUrl) || 0) >= 5) {
      cmd.iconDataUrl = undefined;
    }
  }

  // Clean up internal _bundlePath before caching
  for (const cmd of allCommands) {
    delete cmd._bundlePath;
  }

  cachedCommands = allCommands;
  cacheTimestamp = now;

  console.log(
    `Discovered ${apps.length} apps, ${settings.length} settings panes, ${extensionCommands.length} extension commands in ${Date.now() - t0}ms`
  );

  return cachedCommands;
}

export async function executeCommand(id: string): Promise<boolean> {
  if (id === 'system-quit-launcher') {
    app.quit();
    return true;
  }

  const commands = await getAvailableCommands();
  const command = commands.find((c) => c.id === id);
  if (!command?.path) {
    console.error(`Command not found: ${id}`);
    return false;
  }

  try {
    if (command.category === 'app') {
      await openAppByPath(command.path);
    } else if (command.category === 'settings') {
      await openSettingsPane(command.path);
    }
    return true;
  } catch (error) {
    console.error(`Failed to execute command ${id}:`, error);
    return false;
  }
}

export function invalidateCache(): void {
  cachedCommands = null;
  cacheTimestamp = 0;
}
