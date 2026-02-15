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
import { discoverScriptCommands } from './script-command-runner';
import { loadSettings } from './settings-store';

const execAsync = promisify(exec);
let iconCounter = 0;

export interface CommandInfo {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  iconDataUrl?: string;
  iconEmoji?: string;
  category: 'app' | 'settings' | 'system' | 'extension' | 'script';
  /** .app path for apps, bundle identifier for settings */
  path?: string;
  /** Extension command mode, e.g. view/no-view/menu-bar */
  mode?: string;
  /** Background refresh interval from manifest, e.g. 1m, 12h */
  interval?: string;
  /** Whether command should start disabled until user enables it */
  disabledByDefault?: boolean;
  /** Whether user confirmation is required before execution */
  needsConfirmation?: boolean;
  /** Argument definitions (used by script commands and extension no-view setup) */
  commandArgumentDefinitions?: Array<{
    name: string;
    required?: boolean;
    type?: string;
    placeholder?: string;
    title?: string;
    data?: Array<{ title?: string; value?: string }>;
  }>;
  /** Bundle path on disk (used for icon extraction) */
  _bundlePath?: string;
}

// ─── Cache ──────────────────────────────────────────────────────────

let cachedCommands: CommandInfo[] | null = null;
let cacheTimestamp = 0;
let inflightDiscovery: Promise<CommandInfo[]> | null = null;
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
  return s.replace(/\s+/g, ' ').trim();
}

function canonicalSettingsTitle(title: string, bundleId?: string): string {
  return cleanPaneName(title);
}

function canonicalAppTitle(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (key === 'supercmd' || key === 'supercmd') return 'SuperCmd';
  return name;
}

function collectAppBundles(rootDir: string, maxDepth = 4): string[] {
  const results: string[] = [];
  if (!rootDir || !fs.existsSync(rootDir)) return results;

  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    let visitKey = current.dir;
    try {
      visitKey = fs.realpathSync(current.dir);
    } catch {}
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(fullPath).isDirectory();
        } catch {}
      }
      if (!isDir) continue;

      if (entry.name.endsWith('.app')) {
        results.push(fullPath);
        continue;
      }

      if (
        entry.name.endsWith('.appex') ||
        entry.name.endsWith('.prefPane') ||
        entry.name.endsWith('.bundle') ||
        entry.name.endsWith('.plugin')
      ) {
        continue;
      }

      if (current.depth < maxDepth) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return results;
}

function isPathInsideRoots(targetPath: string, roots: string[]): boolean {
  const resolvedTarget = path.resolve(targetPath);
  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    if (resolvedTarget === resolvedRoot) return true;
    if (resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) return true;
  }
  return false;
}

async function discoverAppBundlesViaSpotlight(allowedRoots: string[]): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `/usr/bin/mdfind "kMDItemContentTypeTree == 'com.apple.application-bundle'" 2>/dev/null`
    );
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((p) => p.endsWith('.app') && !p.includes('.app/') && fs.existsSync(p))
      .filter((p) => isPathInsideRoots(p, allowedRoots));
  } catch {
    return [];
  }
}

function makeSettingsItemId(input: string): string {
  return `settings-item-${crypto.createHash('md5').update(input).digest('hex').slice(0, 12)}`;
}

function splitSearchKeywords(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 2);
}

function getLocaleCandidates(): string[] {
  const set = new Set<string>();
  const locale = String(Intl.DateTimeFormat().resolvedOptions().locale || '')
    .replace('-', '_')
    .trim();
  const envLang = String(process.env.LANG || '')
    .split('.')
    .shift()
    ?.replace('-', '_')
    .trim();

  if (locale) {
    set.add(locale);
    const base = locale.split('_')[0];
    if (base) set.add(base);
  }
  if (envLang) {
    set.add(envLang);
    const base = envLang.split('_')[0];
    if (base) set.add(base);
  }
  set.add('en_US');
  set.add('en_GB');
  set.add('en');
  return Array.from(set);
}

function resolveSearchTermsFile(bundlePath: string, searchTermsFileName?: string): string | undefined {
  const resourcesDir = path.join(bundlePath, 'Contents', 'Resources');
  if (!fs.existsSync(resourcesDir)) return undefined;

  const fileStem = String(searchTermsFileName || '').trim();
  const localeCandidates = getLocaleCandidates();
  if (fileStem) {
    for (const locale of localeCandidates) {
      const candidate = path.join(resourcesDir, `${locale}.lproj`, `${fileStem}.searchTerms`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  for (const locale of localeCandidates) {
    const lprojDir = path.join(resourcesDir, `${locale}.lproj`);
    if (!fs.existsSync(lprojDir)) continue;
    try {
      const files = fs.readdirSync(lprojDir).filter((f) => f.endsWith('.searchTerms'));
      if (files.length > 0) return path.join(lprojDir, files[0]);
    } catch {}
  }

  return undefined;
}

async function readPlistFileJson(plistPath: string): Promise<Record<string, any> | null> {
  try {
    if (!fs.existsSync(plistPath)) return null;
    const safePath = plistPath.replace(/"/g, '\\"');
    const { stdout } = await execAsync(
      `/usr/bin/plutil -convert json -o - "${safePath}" 2>/dev/null`
    );
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

async function discoverSettingsSearchTermCommands(
  bundlePath: string,
  pane: CommandInfo,
  bundleId?: string,
  legacyBundleId?: string,
  searchTermsFileName?: string
): Promise<CommandInfo[]> {
  const searchTermsFile = resolveSearchTermsFile(bundlePath, searchTermsFileName);
  if (!searchTermsFile) return [];

  const data = await readPlistFileJson(searchTermsFile);
  if (!data || typeof data !== 'object') return [];

  const commands: CommandInfo[] = [];
  const seen = new Set<string>();
  const paneTitleLower = String(pane.title || '').trim().toLowerCase();

  const addCommand = (title: string, extraKeywords: string[], sourceKey: string) => {
    const finalTitle = String(title || '').trim();
    if (finalTitle.length < 2) return;

    const dedupeKey = `${String(pane.path || '')}:${finalTitle.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    commands.push({
      id: makeSettingsItemId(`${dedupeKey}:${sourceKey}`),
      title: finalTitle,
      subtitle: pane.title,
      keywords: buildSettingsKeywords(finalTitle, bundleId, legacyBundleId, extraKeywords),
      iconDataUrl: pane.iconDataUrl,
      category: 'settings',
      path: pane.path,
      _bundlePath: pane._bundlePath,
    });
  };

  for (const [sectionRaw, sectionValue] of Object.entries(data)) {
    const sectionTitle = cleanPaneName(sectionRaw);
    const sectionKey = sectionRaw.toLowerCase();
    const sectionKeywords: string[] = [sectionKey];

    if (sectionTitle && sectionTitle.toLowerCase() !== paneTitleLower) {
      addCommand(sectionTitle, sectionKeywords, `section:${sectionRaw}`);
    }

    const rows = Array.isArray((sectionValue as any)?.localizableStrings)
      ? (sectionValue as any).localizableStrings
      : [];

    for (const row of rows) {
      const rowTitle = String(row?.title || '').trim();
      if (!rowTitle) continue;
      const keywords = [
        sectionKey,
        sectionTitle.toLowerCase(),
        ...splitSearchKeywords(String(row?.index || '')),
      ].filter(Boolean);
      addCommand(rowTitle, keywords, `${sectionRaw}:${rowTitle}`);
    }
  }

  return commands;
}

function buildSettingsKeywords(
  title: string,
  bundleId?: string,
  legacyBundleId?: string,
  extraKeywords: string[] = []
): string[] {
  const lowerTitle = title.toLowerCase();

  const set = new Set<string>([
    'system settings',
    'preferences',
    lowerTitle,
  ]);

  if (bundleId) set.add(bundleId);
  if (legacyBundleId) set.add(legacyBundleId);
  for (const keyword of extraKeywords) {
    const k = String(keyword || '').trim().toLowerCase();
    if (k) set.add(k);
  }

  return Array.from(set);
}

// ─── Application Discovery ──────────────────────────────────────────

async function discoverApplications(): Promise<CommandInfo[]> {
  const results: CommandInfo[] = [];
  const usedIds = new Set<string>();

  const appDirs = [
    '/Applications',
    '/System/Applications',
    '/System/Applications/Utilities',
    path.join(process.env.HOME || '', 'Applications'),
  ];

  const appPathsSet = new Set<string>();
  const spotlightPaths = await discoverAppBundlesViaSpotlight(appDirs);
  for (const appPath of spotlightPaths) {
    appPathsSet.add(appPath);
  }

  for (const dir of appDirs) {
    for (const appPath of collectAppBundles(dir)) {
      appPathsSet.add(appPath);
    }
  }
  const finderPath = '/System/Library/CoreServices/Finder.app';
  if (fs.existsSync(finderPath)) {
    appPathsSet.add(finderPath);
  }

  const appPaths = Array.from(appPathsSet).sort((a, b) => a.localeCompare(b));
  const BATCH = 6;
  for (let i = 0; i < appPaths.length; i += BATCH) {
    const batch = appPaths.slice(i, i + BATCH);
    const items = await Promise.all(
      batch.map(async (appPath) => {
        const info = await readPlistJson(appPath);
        if (info) {
          const packageType = String(info.CFBundlePackageType || '').trim();
          const isFinder = appPath === finderPath;
          if (packageType && packageType !== 'APPL' && !isFinder) return null;
          if (info.LSUIElement === true) return null;
          if (info.NSUIElement === true) return null;
          if (info.LSBackgroundOnly === true) return null;
        }

        const rawName = path.basename(appPath, '.app');
        const name = canonicalAppTitle(rawName);
        const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
        const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
        const idSuffix = crypto.createHash('md5').update(appPath).digest('hex').slice(0, 8);
        const baseId = `app-${slug}`;
        const id = usedIds.has(baseId) ? `${baseId}-${idSuffix}` : baseId;
        usedIds.add(id);

        const iconDataUrl = await getIconDataUrl(appPath);

        return {
          id,
          title: name,
          keywords: [key, rawName.toLowerCase()],
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

  const titleCounts = new Map<string, number>();
  for (const item of results) {
    const key = item.title.toLowerCase();
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  for (const item of results) {
    if (!item.path) continue;
    if ((titleCounts.get(item.title.toLowerCase()) || 0) <= 1) continue;
    item.subtitle = path.dirname(item.path);
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

    const BATCH = 6;
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
          const searchTermsFileName: string | undefined =
            typeof settingsAttrs.searchTermsFileName === 'string'
              ? settingsAttrs.searchTermsFileName
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

          const paneCommand: CommandInfo = {
            id: `settings-${key.replace(/[^a-z0-9]+/g, '-')}`,
            title: displayName,
            keywords: buildSettingsKeywords(displayName, bundleId, legacyBundleId),
            iconDataUrl,
            category: 'settings' as const,
            path: openIdentifier,
            _bundlePath: extPath,
          };

          return paneCommand;
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

    const BATCH = 6;
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

          const paneCommand: CommandInfo = {
            id: `settings-${key.replace(/[^a-z0-9]+/g, '-')}`,
            title: displayName,
            keywords: buildSettingsKeywords(displayName, paneBundleId),
            iconDataUrl,
            category: 'settings' as const,
            path: paneBundleId || rawName,
            _bundlePath: panePath,
          };

          return paneCommand;
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

  // Deduplicate concurrent calls: return the in-flight promise if discovery is already running
  if (inflightDiscovery) {
    return inflightDiscovery;
  }

  inflightDiscovery = (async () => {
    try {
      const t0 = Date.now();
      console.log('Discovering applications and settings…');

      // Run discovery sequentially to reduce startup process churn.
      // On some systems, launching too many plist/icon subprocesses in parallel can
      // destabilize Electron during early startup.
      const apps = await discoverApplications();
      const settings = await discoverSystemSettings();

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
      id: 'system-add-to-memory',
      title: 'Add This to Memory',
      keywords: ['memory', 'supermemory', 'selected text', 'remember', 'save context'],
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
      title: 'SuperCmd Settings',
      keywords: ['settings', 'preferences', 'config', 'configuration', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-open-ai-settings',
      title: 'SuperCmd AI',
      keywords: ['ai', 'model', 'provider', 'openai', 'anthropic', 'ollama', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-supercmd-whisper',
      title: 'SuperCmd Whisper',
      keywords: ['whisper', 'speech', 'voice', 'dictation', 'transcribe', 'overlay', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-whisper-onboarding',
      title: 'SuperCmd Whisper Onboarding',
      keywords: ['whisper', 'onboarding', 'dictation', 'voice', 'tutorial', 'hotkey', 'practice'],
      category: 'system',
    },
    {
      id: 'system-supercmd-speak',
      title: 'SuperCmd Read',
      keywords: ['speak', 'tts', 'read', 'selected text', 'edge-tts', 'speechify', 'jarvis', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-open-extensions-settings',
      title: 'SuperCmd Extensions',
      keywords: ['extensions', 'store', 'community', 'hotkey', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-open-onboarding',
      title: 'SuperCmd Onboarding',
      keywords: ['welcome', 'onboarding', 'intro', 'setup', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-quit-launcher',
      title: 'Quit SuperCmd',
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
      id: 'system-create-script-command',
      title: 'Create Script Command',
      keywords: ['script', 'command', 'create', 'custom', 'raycast', 'shell'],
      category: 'system',
    },
    {
      id: 'system-open-script-commands',
      title: 'Open Script Commands Folder',
      keywords: ['script', 'command', 'folder', 'directory', 'raycast', 'custom'],
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
      subtitle: ext.extensionTitle,
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

  // Raycast-compatible script commands
  let scriptCommands: CommandInfo[] = [];
  try {
    scriptCommands = discoverScriptCommands().map((script) => ({
      id: script.id,
      title: script.title,
      subtitle: script.packageName,
      keywords: script.keywords,
      iconDataUrl: script.iconDataUrl,
      iconEmoji: script.iconEmoji,
      category: 'script' as const,
      path: script.scriptPath,
      mode: script.mode,
      interval: script.interval,
      needsConfirmation: script.needsConfirmation,
      commandArgumentDefinitions: script.arguments.map((arg) => ({
        name: arg.name,
        required: arg.required,
        type: arg.type,
        placeholder: arg.placeholder,
        title: arg.placeholder,
        data: arg.data,
      })),
    }));
  } catch (e) {
    console.error('Failed to discover script commands:', e);
  }

  const allCommands = [...apps, ...settings, ...extensionCommands, ...scriptCommands, ...systemCommands];

  // ── Batch-extract icons via NSWorkspace for app/settings bundles ──
  const bundlesNeedingIcon = allCommands.filter(
    (c) =>
      !c.iconDataUrl &&
      c._bundlePath &&
      (c.category === 'app' || c.category === 'settings')
  );

  if (bundlesNeedingIcon.length > 0) {
    console.log(`Extracting ${bundlesNeedingIcon.length} app/settings icons via NSWorkspace…`);
    const bundlePaths = Array.from(new Set(bundlesNeedingIcon.map((c) => c._bundlePath!)));
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
    if (cmd.category !== 'settings' || !cmd.iconDataUrl || cmd.subtitle) continue;
    settingsIconCounts.set(cmd.iconDataUrl, (settingsIconCounts.get(cmd.iconDataUrl) || 0) + 1);
  }
  for (const cmd of allCommands) {
    if (cmd.category !== 'settings' || !cmd.iconDataUrl || cmd.subtitle) continue;
    if ((settingsIconCounts.get(cmd.iconDataUrl) || 0) >= 5) {
      cmd.iconDataUrl = undefined;
    }
  }

  // Clean up internal _bundlePath before caching
  for (const cmd of allCommands) {
    delete cmd._bundlePath;
  }

  // Runtime metadata overlays (used by updateCommandMetadata and inline scripts).
  try {
    const commandMetadata = loadSettings().commandMetadata || {};
    for (const cmd of allCommands) {
      if (cmd.category === 'script' && cmd.mode !== 'inline') continue;
      const subtitle = String(commandMetadata[cmd.id]?.subtitle || '').trim();
      if (subtitle) {
        cmd.subtitle = subtitle;
      }
    }
  } catch {}

      cachedCommands = allCommands;
      cacheTimestamp = Date.now();

      console.log(
        `Discovered ${apps.length} apps, ${settings.length} settings panes, ${extensionCommands.length} extension commands, ${scriptCommands.length} script commands in ${Date.now() - t0}ms`
      );

      return cachedCommands;
    } finally {
      inflightDiscovery = null;
    }
  })();

  return inflightDiscovery;
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
