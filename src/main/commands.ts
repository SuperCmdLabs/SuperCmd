/**
 * Command Registry
 * 
 * Dynamically discovers ALL installed applications and ALL System Settings
 * panes by scanning the filesystem directly. No hardcoded lists.
 */

import { app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

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
}

// ─── Cache ──────────────────────────────────────────────────────────

let cachedCommands: CommandInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 120_000; // 2 min

// ─── Helpers ────────────────────────────────────────────────────────

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
 * Extract the actual icon from a .app / .appex / .prefPane bundle.
 * 1. Reads CFBundleIconFile from Info.plist → converts .icns with sips
 * 2. Searches for common icon filenames in Contents/Resources/
 * 3. Falls back to app.getFileIcon({ size: 'large' })
 */
async function getIconDataUrl(bundlePath: string): Promise<string | undefined> {
  const resourcesDir = path.join(bundlePath, 'Contents', 'Resources');

  // Step 1: Try CFBundleIconFile / CFBundleIconName from Info.plist
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
          const result = await icnsToPngDataUrl(icnsPath);
          if (result) return result;
        }
      }
    }
  } catch {
    // plist read failed — fall through
  }

  // Step 2: Search for common icon filenames in Resources/
  if (fs.existsSync(resourcesDir)) {
    try {
      const files = fs.readdirSync(resourcesDir);
      // Prefer known icon names first, then any .icns file
      const priorityNames = ['icon.icns', 'AppIcon.icns', 'SharedAppIcon.icns'];
      for (const name of priorityNames) {
        if (files.includes(name)) {
          const result = await icnsToPngDataUrl(path.join(resourcesDir, name));
          if (result) return result;
        }
      }
      // Try any .icns file we find
      const anyIcns = files.find((f) => f.endsWith('.icns'));
      if (anyIcns) {
        const result = await icnsToPngDataUrl(path.join(resourcesDir, anyIcns));
        if (result) return result;
      }
    } catch {
      // ignore
    }
  }

  // Step 3: Fallback — use Electron's getFileIcon
  try {
    const icon = await app.getFileIcon(bundlePath, { size: 'large' });
    if (!icon.isEmpty()) {
      return icon.toDataURL();
    }
  } catch {
    // ignore
  }

  return undefined;
}

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
 * Turn "DateAndTime" → "Date & Time", "DesktopScreenEffectsPref" → "Desktop & Screen Effects"
 * Cleans camelCase / PascalCase prefPane names into human-readable titles.
 */
function cleanPaneName(raw: string): string {
  // Remove known suffixes
  let s = raw
    .replace(/Pref$/, '')
    .replace(/\.prefPane$/, '')
    .replace(/SettingsExtension$/, '')
    .replace(/Settings$/, '')
    .replace(/Extension$/, '')
    .replace(/Intents$/, '')
    .replace(/IntentsExtension$/, '');

  // Insert space before uppercase letters that follow lowercase letters: "DateTime" → "Date Time"
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Insert space before uppercase letters that follow other uppercase + lowercase: "HTMLParser" → "HTML Parser"
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Known replacements
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

  // Replace "And" with "&"
  s = s.replace(/\bAnd\b/g, '&');

  // Apply known full replacements
  for (const [from, to] of Object.entries(replacements)) {
    if (s === from) {
      s = to;
      break;
    }
  }

  return s.trim();
}

// ─── Application Discovery ──────────────────────────────────────────

/**
 * Scan standard macOS directories for .app bundles.
 */
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

    // Collect .app paths from this directory
    const appPaths: string[] = [];
    for (const entry of entries) {
      if (entry.endsWith('.app')) {
        appPaths.push(path.join(dir, entry));
      }
    }

    // Process in parallel batches for speed
    const BATCH = 15;
    for (let i = 0; i < appPaths.length; i += BATCH) {
      const batch = appPaths.slice(i, i + BATCH);
      const items = await Promise.all(
        batch.map(async (appPath) => {
          const name = path.basename(appPath, '.app');
          const key = name.toLowerCase();

          // Deduplicate
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

/**
 * Discover System Settings panes from two sources:
 * 1. .prefPane bundles in /System/Library/PreferencePanes/ (gives us the pane list)
 * 2. .appex extensions in ExtensionKit (gives us display names & bundle IDs for opening)
 */
async function discoverSystemSettings(): Promise<CommandInfo[]> {
  const results: CommandInfo[] = [];
  const seen = new Set<string>();

  // Get the System Settings app icon (used as fallback when a pane has no icon)
  let settingsIconDataUrl: string | undefined;
  for (const p of [
    '/System/Applications/System Settings.app',
    '/System/Applications/System Preferences.app',
  ]) {
    if (fs.existsSync(p)) {
      settingsIconDataUrl = await getIconDataUrl(p);
      break;
    }
  }

  // ── Source 1: .appex extensions (macOS Ventura+) ──
  // These have proper Info.plist with display names & bundle IDs
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
        // Only grab settings-related extensions
        (f.toLowerCase().includes('settings') ||
          f.toLowerCase().includes('preference') ||
          f.toLowerCase().includes('pref'))
    );

    // Also include known settings extensions that don't have "settings" in the name
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

          // Skip internal/helper extensions
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

          // Clean up names that still look like code
          if (
            displayName.includes('Extension') ||
            displayName.includes('Settings')
          ) {
            displayName = cleanPaneName(displayName);
          }

          // Skip if name got too short or empty after cleaning
          if (!displayName || displayName.length < 2) return null;

          const key = displayName.toLowerCase();
          if (seen.has(key)) return null;
          seen.add(key);

          // Extract the individual icon for this settings pane
          const iconDataUrl =
            (await getIconDataUrl(extPath)) || settingsIconDataUrl;

          return {
            id: `settings-${key.replace(/[^a-z0-9]+/g, '-')}`,
            title: displayName,
            keywords: ['system settings', 'preferences', key],
            iconDataUrl,
            category: 'settings' as const,
            path: bundleId, // Store bundle ID for opening
          };
        })
      );

      for (const item of items) {
        if (item) results.push(item);
      }
    }
  }

  // ── Source 2: .prefPane bundles (covers older panes & ensures completeness) ──
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

          // Skip if we already have this from appex
          if (seen.has(key)) return null;
          seen.add(key);

          // Extract the individual icon for this pref pane
          const iconDataUrl =
            (await getIconDataUrl(panePath)) || settingsIconDataUrl;

          return {
            id: `settings-${key.replace(/[^a-z0-9]+/g, '-')}`,
            title: displayName,
            keywords: ['system settings', 'preferences', key],
            iconDataUrl,
            category: 'settings' as const,
            path: rawName, // Raw prefPane identifier
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
  // If it looks like a bundle ID (com.apple.xxx), use the URL scheme directly
  if (identifier.startsWith('com.apple.')) {
    try {
      await execAsync(`open "x-apple.systempreferences:${identifier}"`);
      return;
    } catch { /* fall through */ }
  }

  // Try Ventura-style URL scheme
  try {
    await execAsync(
      `open "x-apple.systempreferences:com.apple.settings.${identifier}"`
    );
    return;
  } catch { /* fall through */ }

  // Try older preference pane style
  try {
    await execAsync(
      `open "x-apple.systempreferences:com.apple.preference.${identifier.toLowerCase()}"`
    );
    return;
  } catch { /* fall through */ }

  // Final fallback: just open System Settings
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

  // Sort alphabetically
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

  cachedCommands = [...apps, ...settings, ...systemCommands];
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
