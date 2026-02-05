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

const execAsync = promisify(exec);
let iconCounter = 0;

export interface CommandInfo {
  id: string;
  title: string;
  keywords?: string[];
  iconDataUrl?: string;
  category: 'app' | 'settings' | 'system';
  /** .app path for apps, bundle identifier for settings */
  path?: string;
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
  // v4: drop generic NSWorkspace document icons for settings
  return 'v4-' + crypto.createHash('md5').update(bundlePath).digest('hex');
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
  // For apps, NSWorkspace batch extraction will run later.
  // For settings, the renderer shows a cog icon.
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

    const appexFiles = files.filter(
      (f) =>
        f.endsWith('.appex') &&
        (f.toLowerCase().includes('settings') ||
          f.toLowerCase().includes('preference') ||
          f.toLowerCase().includes('pref'))
    );

    const knownSettingsExt = files.filter((f) =>
      [
        'Bluetooth.appex',
        'Appearance.appex',
        'PowerPreferences.appex',
        'Network.appex',
        'Screen Saver.appex',
        'Wallpaper.appex',
        'StartupDisk.appex',
        'Computer Name.appex',
        'CDs & DVDs Settings Extension.appex',
        'FamilySettings.appex',
        'ClassKitSettings.appex',
        'ClassroomSettings.appex',
        'CoverageSettings.appex',
        'DesktopSettings.appex',
      ].includes(f)
    );

    const allAppex = [...new Set([...appexFiles, ...knownSettingsExt])];

    const BATCH = 15;
    for (let i = 0; i < allAppex.length; i += BATCH) {
      const batch = allAppex.slice(i, i + BATCH);
      const items = await Promise.all(
        batch.map(async (file) => {
          const extPath = path.join(extDir, file);
          const info = await readPlistJson(extPath);
          if (!info) return null;

          let displayName =
            info.CFBundleDisplayName || info.CFBundleName || '';
          const bundleId: string = info.CFBundleIdentifier || '';

          if (
            !displayName ||
            displayName.includes('Intents') ||
            displayName.includes('Widget') ||
            displayName.endsWith('DeviceExpert') ||
            bundleId.includes('intents') ||
            bundleId.includes('widget')
          ) {
            return null;
          }

          if (
            displayName.includes('Extension') ||
            displayName.includes('Settings')
          ) {
            displayName = cleanPaneName(displayName);
          }

          if (!displayName || displayName.length < 2) return null;

          const key = displayName.toLowerCase();
          if (seen.has(key)) return null;
          seen.add(key);

          // Try fast .icns extraction (will return undefined for Assets.car-only bundles)
          const iconDataUrl = await getIconDataUrl(extPath);

          return {
            id: `settings-${key.replace(/[^a-z0-9]+/g, '-')}`,
            title: displayName,
            keywords: ['system settings', 'preferences', key],
            iconDataUrl,
            category: 'settings' as const,
            path: bundleId,
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
          const displayName = cleanPaneName(rawName);
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
            path: rawName,
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
      id: 'system-quit-launcher',
      title: 'Quit Launcher',
      keywords: ['exit', 'close', 'quit', 'stop'],
      category: 'system',
    },
  ];

  const allCommands = [...apps, ...settings, ...systemCommands];

  // ── Batch-extract icons via NSWorkspace for APPS only ──
  // (NSWorkspace returns generic document icons for settings .appex bundles,
  //  so we skip settings — the renderer shows a cog for those instead.)
  const appsNeedingIcon = allCommands.filter(
    (c) => !c.iconDataUrl && c._bundlePath && c.category === 'app'
  );

  if (appsNeedingIcon.length > 0) {
    console.log(`Extracting ${appsNeedingIcon.length} app icons via NSWorkspace…`);
    const bundlePaths = appsNeedingIcon.map((c) => c._bundlePath!);
    const iconMap = await batchGetIconsViaWorkspace(bundlePaths);

    for (const cmd of appsNeedingIcon) {
      const dataUrl = iconMap.get(cmd._bundlePath!);
      if (dataUrl) {
        cmd.iconDataUrl = dataUrl;
      }
    }
  }

  // Clean up internal _bundlePath before caching
  for (const cmd of allCommands) {
    delete cmd._bundlePath;
  }

  cachedCommands = allCommands;
  cacheTimestamp = now;

  console.log(
    `Discovered ${apps.length} apps, ${settings.length} settings panes in ${Date.now() - t0}ms`
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
