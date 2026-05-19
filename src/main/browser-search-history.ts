/**
 * Browser Search History
 *
 * Tracks URL opens and web searches issued from the launcher (Cmd+Enter)
 * and provides frecency-ranked autocomplete suggestions for the search input.
 * History is JSON-backed in userData and pruned by the retention setting.
 *
 * Imports from installed browsers' SQLite history DBs via the system
 * `sqlite3` CLI (same pattern as `run-sqlite-query` in main.ts) so we
 * don't take on a native dep.
 */

import { app, shell } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import { resolveBrowserInput } from './browser-input-resolver';
import { loadSettings } from './settings-store';

const execFileAsync = promisify(execFile);

export type BrowserSearchEntryType = 'url' | 'search' | 'bookmark';
export type BrowserSearchSource =
  | 'user'
  | 'helium'
  | 'chrome'
  | 'arc'
  | 'brave'
  | 'edge'
  | 'vivaldi'
  | 'safari'
  | 'firefox';

export interface BrowserSearchEntry {
  /** Stable id (timestamp + random) for diffing/cache busting. */
  id: string;
  type: BrowserSearchEntryType;
  /** Original user input (the literal query / URL as typed). */
  query: string;
  /** Resolved URL we open in the default browser. */
  url: string;
  /** Host portion of the URL — empty for `search` entries with no host context. */
  host: string;
  lastUsedAt: number;
  useCount: number;
  source: BrowserSearchSource;
  sourceProfileId?: string;
  sourceProfileName?: string;
  bookmarkFolder?: string;
  bookmarkOrder?: number;
}

export interface BrowserSearchStats {
  revision: number;
  totalEntries: number;
  historyEntries: number;
  bookmarkEntries: number;
  profileCountsByKind: {
    history: Record<string, number>;
    bookmark: Record<string, number>;
  };
}

export interface AutocompleteSuggestion {
  /** The full text the user would end up with after accepting. */
  completion: string;
  /** The portion of `completion` that comes AFTER the user's prefix (the ghost-text suffix). */
  suffix: string;
  entry: BrowserSearchEntry;
}

let cache: BrowserSearchEntry[] | null = null;
let browserSearchRevision = 1;

// ─── Paths ──────────────────────────────────────────────────────────

function getHistoryDir(): string {
  const dir = path.join(app.getPath('userData'), 'browser-search');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getHistoryPath(): string {
  return path.join(getHistoryDir(), 'history.json');
}

// ─── Persistence ────────────────────────────────────────────────────

function load(): BrowserSearchEntry[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(getHistoryPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      cache = parsed
        .map((entry) => sanitizeEntry(entry))
        .filter((entry): entry is BrowserSearchEntry => entry !== null);
    } else {
      cache = [];
    }
  } catch {
    cache = [];
  }
  return cache!;
}

function save(): void {
  if (!cache) return;
  try {
    fs.writeFileSync(getHistoryPath(), JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('Failed to save browser-search history:', e);
  }
}

function bumpBrowserSearchRevision(): void {
  browserSearchRevision += 1;
}

function sanitizeEntry(raw: any): BrowserSearchEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const type: BrowserSearchEntryType = raw.type === 'search'
    ? 'search'
    : raw.type === 'bookmark'
    ? 'bookmark'
    : 'url';
  const query = String(raw.query || '').trim();
  const url = String(raw.url || '').trim();
  if (!query || !url) return null;
  const host = String(raw.host || '').trim() || extractHost(url);
  const lastUsedAt = Number.isFinite(Number(raw.lastUsedAt)) ? Number(raw.lastUsedAt) : 0;
  const useCount = Number.isFinite(Number(raw.useCount)) ? Math.max(1, Math.floor(Number(raw.useCount))) : 1;
  const source: BrowserSearchSource = ALLOWED_SOURCES.has(raw.source) ? raw.source : 'user';
  const sourceProfileId = typeof raw.sourceProfileId === 'string' && raw.sourceProfileId.trim()
    ? raw.sourceProfileId.trim()
    : undefined;
  const sourceProfileName = typeof raw.sourceProfileName === 'string' && raw.sourceProfileName.trim()
    ? raw.sourceProfileName.trim()
    : undefined;
  const bookmarkFolder = typeof raw.bookmarkFolder === 'string' && raw.bookmarkFolder.trim()
    ? raw.bookmarkFolder.trim()
    : undefined;
  const bookmarkOrder = Number.isFinite(Number(raw.bookmarkOrder)) && Number(raw.bookmarkOrder) >= 0
    ? Math.floor(Number(raw.bookmarkOrder))
    : undefined;
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : makeId();
  return { id, type, query, url, host, lastUsedAt, useCount, source, sourceProfileId, sourceProfileName, bookmarkFolder, bookmarkOrder };
}

const ALLOWED_SOURCES: Set<string> = new Set([
  'user',
  'helium',
  'chrome',
  'arc',
  'brave',
  'edge',
  'vivaldi',
  'safari',
  'firefox',
]);

const CHROMIUM_PROFILE_OPEN_APPS: Partial<Record<BrowserSearchSource, string>> = {
  helium: 'Helium',
  chrome: 'Google Chrome',
  brave: 'Brave Browser',
  edge: 'Microsoft Edge',
  vivaldi: 'Vivaldi',
};

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── URL detection ──────────────────────────────────────────────────

export interface ResolvedInput {
  type: BrowserSearchEntryType;
  /** URL to actually navigate to — for search this is a Google search URL. */
  url: string;
  /** Host (only meaningful for url type). */
  host: string;
}

export function resolveInput(rawInput: string): ResolvedInput | null {
  const resolved = resolveBrowserInput(rawInput);
  if (!resolved) return null;
  return {
    type: resolved.type,
    url: resolved.url,
    host: resolved.host,
  };
}

function extractHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export function listEntries(): BrowserSearchEntry[] {
  return load().slice();
}

export function getBrowserSearchRevision(): number {
  load();
  return browserSearchRevision;
}

export function getBrowserSearchStats(): BrowserSearchStats {
  const entries = load();
  const history: Record<string, number> = {};
  const bookmark: Record<string, number> = {};
  let historyEntries = 0;
  let bookmarkEntries = 0;
  for (const entry of entries) {
    if (entry.type !== 'url' && entry.type !== 'bookmark') continue;
    const profileId = entry.sourceProfileId ? `${entry.source}:${entry.sourceProfileId}` : '';
    if (entry.type === 'url') {
      historyEntries += 1;
      if (profileId) history[profileId] = (history[profileId] || 0) + 1;
    } else {
      bookmarkEntries += 1;
      if (profileId) bookmark[profileId] = (bookmark[profileId] || 0) + 1;
    }
  }
  return {
    revision: browserSearchRevision,
    totalEntries: entries.length,
    historyEntries,
    bookmarkEntries,
    profileCountsByKind: { history, bookmark },
  };
}

export function removeEntriesForProfile(profileSourceId: string): number {
  const [source, ...profileParts] = String(profileSourceId || '').trim().split(':');
  const profileId = profileParts.join(':');
  if (!source || !profileId) return 0;
  const entries = load();
  const before = entries.length;
  const next = entries.filter((entry) => {
    if (entry.source !== source) return true;
    const entryProfile = String(entry.sourceProfileId || '');
    return entryProfile !== profileId && entryProfile !== profileSourceId;
  });
  if (next.length === before) return 0;
  cache = next;
  bumpBrowserSearchRevision();
  save();
  return before - next.length;
}

export async function openInDefaultBrowser(rawInput: string): Promise<{
  ok: boolean;
  resolved: ResolvedInput | null;
}> {
  const profileEntry = findProfileEntryForInput(rawInput);
  if (profileEntry) {
    void openEntryUrl(profileEntry).catch((e) => {
      console.error('Failed to open browser-search entry:', e);
    });
    recordEntryUse(profileEntry);
    return {
      ok: true,
      resolved: { type: profileEntry.type, url: profileEntry.url, host: profileEntry.host },
    };
  }

  const resolved = resolveInput(rawInput);
  if (!resolved) return { ok: false, resolved: null };
  // Fire-and-forget: don't await LaunchServices. The renderer's IPC await
  // would otherwise hold the launcher visible for the full dispatch window.
  void shell.openExternal(resolved.url).catch((e) => {
    console.error('Failed to open URL in default browser:', e);
  });
  recordEntry(rawInput.trim(), resolved);
  return { ok: true, resolved };
}

export function recordResolvedInput(rawInput: string, resolved: ResolvedInput): void {
  recordEntry(String(rawInput || '').trim(), resolved);
}

function findProfileEntryForInput(rawInput: string): BrowserSearchEntry | null {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;

  const bookmarkMatches = load().filter((entry) =>
    entry.type === 'bookmark' &&
    entry.sourceProfileId &&
    Boolean(CHROMIUM_PROFILE_OPEN_APPS[entry.source]) &&
    entry.query.toLowerCase() === trimmed.toLowerCase()
  );
  if (bookmarkMatches.length > 0) return bestByFrecency(bookmarkMatches);

  const resolved = resolveInput(trimmed);
  if (!resolved || resolved.type !== 'url') return null;

  const entries = load().filter((entry) =>
    (entry.type === 'url' || entry.type === 'bookmark') &&
    entry.sourceProfileId &&
    Boolean(CHROMIUM_PROFILE_OPEN_APPS[entry.source])
  );
  if (entries.length === 0) return null;

  const normalizedTarget = normalizeUrlForMatch(resolved.url);
  const exactMatches = entries.filter((entry) => normalizeUrlForMatch(entry.url) === normalizedTarget);
  if (exactMatches.length > 0) return bestByFrecency(exactMatches);

  const host = stripWww(resolved.host);
  const inputWithoutProtocol = trimmed.replace(/^https?:\/\//i, '');
  const isHostOnlyInput = !inputWithoutProtocol.includes('/') && !inputWithoutProtocol.includes('?') && !inputWithoutProtocol.includes('#');
  if (!host || !isHostOnlyInput) return null;
  if (stripWww(inputWithoutProtocol) === host) return null;

  const hostMatches = entries.filter((entry) => stripWww(entry.host) === host);
  return hostMatches.length > 0 ? bestByFrecency(hostMatches) : null;
}

function bestByFrecency(entries: BrowserSearchEntry[]): BrowserSearchEntry {
  return entries.slice().sort((a, b) => frecency(b) - frecency(a))[0];
}

function normalizeUrlForMatch(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname === '/') parsed.pathname = '';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return String(url || '').trim().replace(/\/$/, '').toLowerCase();
  }
}

function stripWww(host: string): string {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

async function openEntryUrl(entry: BrowserSearchEntry): Promise<void> {
  const appName = entry.sourceProfileId ? CHROMIUM_PROFILE_OPEN_APPS[entry.source] : undefined;
  if (!appName) {
    await shell.openExternal(entry.url);
    return;
  }

  try {
    const args = [
      '-a',
      appName,
      entry.url,
    ];
  if (entry.sourceProfileId && entry.sourceProfileId !== 'Default') {
    args.push('--args', `--profile-directory=${entry.sourceProfileId}`);
  }
    await execFileAsync('/usr/bin/open', args, { timeout: 5000 });
  } catch (e) {
    console.warn(`Failed to open ${entry.url} in ${appName} profile ${entry.sourceProfileId}; falling back to default browser.`, e);
    await shell.openExternal(entry.url);
  }
}

function recordEntryUse(entry: BrowserSearchEntry): void {
  const entries = load();
  const existing = entries.find((candidate) => candidate.id === entry.id) ||
    entries.find((candidate) => importEntryKey(candidate) === importEntryKey(entry));
  const now = Date.now();
  if (existing) {
    existing.useCount += 1;
    existing.lastUsedAt = now;
    bumpBrowserSearchRevision();
  }
  pruneByRetentionInPlace(entries);
  trimToCapInPlace(entries);
  cache = entries;
  save();
}

function recordEntry(query: string, resolved: ResolvedInput, source: BrowserSearchSource = 'user'): void {
  if (!query) return;
  const entries = load();
  const dedupeKey = entryKey(resolved.type, resolved.type === 'search' ? query : resolved.url);
  const existing = entries.find((e) => entryKey(e.type, e.type === 'search' ? e.query : e.url) === dedupeKey);
  const now = Date.now();
  if (existing) {
    existing.useCount += 1;
    existing.lastUsedAt = now;
    if (resolved.type === 'url' && !existing.host) existing.host = resolved.host;
  } else {
    entries.push({
      id: makeId(),
      type: resolved.type,
      query,
      url: resolved.url,
      host: resolved.host,
      lastUsedAt: now,
      useCount: 1,
      source,
    });
  }
  pruneByRetentionInPlace(entries);
  trimToCapInPlace(entries);
  cache = entries;
  bumpBrowserSearchRevision();
  save();
}

function entryKey(type: BrowserSearchEntryType, value: string): string {
  return `${type}:${value.toLowerCase()}`;
}

function importEntryKey(entry: Pick<BrowserSearchEntry, 'type' | 'url' | 'query' | 'source'> & {
  sourceProfileId?: string;
}): string {
  const value = entry.type === 'search' ? entry.query : entry.url;
  const source = entry.source || 'user';
  const profile = entry.sourceProfileId || '';
  return `${entry.type}:${source}:${profile}:${value.toLowerCase()}`;
}

export function clearHistory(): void {
  const hadEntries = load().length > 0;
  cache = [];
  if (hadEntries) bumpBrowserSearchRevision();
  save();
}

export function pruneByRetentionNow(): void {
  const entries = load();
  const before = entries.length;
  pruneByRetentionInPlace(entries);
  cache = entries;
  if (entries.length !== before) bumpBrowserSearchRevision();
  save();
}

function pruneByRetentionInPlace(entries: BrowserSearchEntry[]): void {
  const days = loadSettings().browserSearch.historyRetentionDays;
  if (!days || days <= 0) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === 'bookmark') continue;
    if (entries[i].lastUsedAt < cutoff) entries.splice(i, 1);
  }
}

function trimToCapInPlace(entries: BrowserSearchEntry[]): void {
  // Browser imports intentionally keep every retained row. Retention settings
  // still prune old entries, but there is no fixed count cap.
}

function frecency(entry: BrowserSearchEntry): number {
  const ageDays = Math.max(0, (Date.now() - entry.lastUsedAt) / (24 * 60 * 60 * 1000));
  // log-style decay: a year-old visit is worth ~30% of a fresh one.
  const recencyFactor = 1 / (1 + Math.log10(1 + ageDays));
  return entry.useCount * recencyFactor;
}

// ─── Autocomplete (ghost text) ──────────────────────────────────────

/**
 * Compute the best inline-autocomplete suggestion for the given input.
 * Priority:
 *   1. URL host completion (e.g. "git" → "github.com" if user has a github.com URL).
 *   2. Falls back to search-query prefix completion.
 * Returns null if no entry yields a strict prefix extension.
 */
export function getAutocomplete(rawInput: string): AutocompleteSuggestion | null {
  const input = String(rawInput || '');
  const lower = input.toLowerCase();
  if (!lower.trim()) return null;
  // Don't autocomplete inputs that already contain whitespace at a "URL-ish" position
  // unless the user is clearly typing a search query.
  const entries = load();
  if (entries.length === 0) return null;

  // Strip a leading "https://" or "http://" so typing a host alone matches.
  const stripped = lower.replace(/^https?:\/\//, '');
  const hasProtocol = stripped !== lower;

  // Pass 1: URL-host prefix match (highest priority).
  const urlCandidates = entries
    .filter((e) => (e.type === 'url' || e.type === 'bookmark') && e.host)
    .map((e) => {
      const host = e.host;
      const fullPrefixOptions = [host];
      // Allow matches like "git" → host "github.com" — match against host and host without "www.".
      if (host.startsWith('www.')) fullPrefixOptions.push(host.slice(4));
      return { entry: e, options: fullPrefixOptions };
    })
    .map(({ entry, options }) => {
      for (const opt of options) {
        if (opt.startsWith(stripped) && opt.length > stripped.length) {
          return { entry, completion: opt, score: frecency(entry) };
        }
      }
      return null;
    })
    .filter((x): x is { entry: BrowserSearchEntry; completion: string; score: number } => x !== null);

  if (urlCandidates.length > 0) {
    urlCandidates.sort((a, b) => b.score - a.score);
    const best = urlCandidates[0];
    // Reconstruct the completion text in the user's casing where possible.
    const completionDisplay = (hasProtocol ? input.slice(0, input.length - stripped.length) : '') +
      preserveLeadingCase(input.replace(/^https?:\/\//, ''), best.completion);
    return {
      completion: completionDisplay,
      suffix: completionDisplay.slice(input.length),
      entry: best.entry,
    };
  }

  // Pass 2: bookmark-title and search-query prefix match.
  const searchCandidates = entries
    .filter((e) =>
      (e.type === 'search' || e.type === 'bookmark') &&
      e.query.toLowerCase().startsWith(lower) &&
      e.query.length > input.length
    )
    .map((entry) => ({ entry, score: frecency(entry) }));

  if (searchCandidates.length > 0) {
    searchCandidates.sort((a, b) => b.score - a.score);
    const best = searchCandidates[0];
    const completion = input + best.entry.query.slice(input.length);
    return { completion, suffix: completion.slice(input.length), entry: best.entry };
  }

  return null;
}

function preserveLeadingCase(typed: string, completion: string): string {
  if (!typed) return completion;
  return typed + completion.slice(typed.length);
}

// ─── Browser history import ─────────────────────────────────────────

export interface ImportableBrowser {
  id: BrowserSearchSource;
  name: string;
  /** Path to the SQLite history file. */
  dbPath: string;
  available: boolean;
}

export interface ImportableBrowserProfile {
  id: string;
  browserId: BrowserSearchSource;
  browserName: string;
  profileId: string;
  profileName: string;
  /** Path to the SQLite history file. */
  dbPath: string;
  /** Path to the Chromium bookmarks JSON file, when present. */
  bookmarksPath?: string;
  available: boolean;
}

interface ChromiumBrowserRoot {
  id: BrowserSearchSource;
  name: string;
  rootPath: string;
}

function homeDir(): string {
  return os.homedir();
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function getChromiumBrowserRoots(): ChromiumBrowserRoot[] {
  const home = homeDir();
  return [
    { id: 'helium', name: 'Helium', rootPath: path.join(home, 'Library/Application Support/net.imput.helium') },
    { id: 'chrome', name: 'Google Chrome', rootPath: path.join(home, 'Library/Application Support/Google/Chrome') },
    { id: 'arc', name: 'Arc', rootPath: path.join(home, 'Library/Application Support/Arc/User Data') },
    { id: 'brave', name: 'Brave', rootPath: path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser') },
    { id: 'edge', name: 'Microsoft Edge', rootPath: path.join(home, 'Library/Application Support/Microsoft Edge') },
    { id: 'vivaldi', name: 'Vivaldi', rootPath: path.join(home, 'Library/Application Support/Vivaldi') },
  ];
}

function profileLabelFromId(profileId: string): string {
  if (profileId === 'Default') return 'Default';
  const match = /^Profile\s+(\d+)$/i.exec(profileId);
  return match ? `Profile ${match[1]}` : profileId;
}

function readChromiumProfileInfoCache(rootPath: string): Record<string, any> {
  const localStatePath = path.join(rootPath, 'Local State');
  if (!fileExists(localStatePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(localStatePath, 'utf-8'));
    const infoCache = parsed?.profile?.info_cache;
    return infoCache && typeof infoCache === 'object' ? infoCache : {};
  } catch {
    return {};
  }
}

function buildChromiumProfileSource(
  browser: ChromiumBrowserRoot,
  profileId: string,
  profileInfo?: any
): ImportableBrowserProfile | null {
  const dbPath = path.join(browser.rootPath, profileId, 'History');
  if (!fileExists(dbPath)) return null;
  const bookmarksPath = path.join(browser.rootPath, profileId, 'Bookmarks');
  const profileName = typeof profileInfo?.name === 'string' && profileInfo.name.trim()
    ? profileInfo.name.trim()
    : profileLabelFromId(profileId);
  return {
    id: `${browser.id}:${profileId}`,
    browserId: browser.id,
    browserName: browser.name,
    profileId,
    profileName,
    dbPath,
    bookmarksPath: fileExists(bookmarksPath) ? bookmarksPath : undefined,
    available: true,
  };
}

export function listImportableBrowserProfiles(): ImportableBrowserProfile[] {
  const out: ImportableBrowserProfile[] = [];
  for (const browser of getChromiumBrowserRoots()) {
    const infoCache = readChromiumProfileInfoCache(browser.rootPath);
    const profileIds = new Set<string>(Object.keys(infoCache));
    profileIds.add('Default');
    for (const profileId of profileIds) {
      const profile = buildChromiumProfileSource(browser, profileId, infoCache[profileId]);
      if (profile) out.push(profile);
    }
  }
  return out.sort((a, b) => {
    const browserCompare = a.browserName.localeCompare(b.browserName);
    if (browserCompare !== 0) return browserCompare;
    if (a.profileId === 'Default') return -1;
    if (b.profileId === 'Default') return 1;
    return a.profileName.localeCompare(b.profileName);
  });
}

export function listImportableBrowsers(): ImportableBrowser[] {
  const home = homeDir();
  const out: ImportableBrowser[] = [];

  // Chromium-family default profiles
  for (const b of getChromiumBrowserRoots()) {
    const dbPath = path.join(b.rootPath, 'Default/History');
    out.push({ id: b.id, name: b.name, dbPath, available: fileExists(dbPath) });
  }

  // Safari (sandboxed — may be unreadable without Full Disk Access)
  const safariDb = path.join(home, 'Library/Safari/History.db');
  out.push({ id: 'safari', name: 'Safari', dbPath: safariDb, available: fileExists(safariDb) });

  // Firefox (default profile is suffixed with `.default-release` or similar)
  const ffProfiles = path.join(home, 'Library/Application Support/Firefox/Profiles');
  let ffDb = '';
  if (dirExists(ffProfiles)) {
    try {
      const dirs = fs.readdirSync(ffProfiles);
      const release = dirs.find((d) => d.endsWith('.default-release')) || dirs.find((d) => d.endsWith('.default'));
      if (release) {
        const candidate = path.join(ffProfiles, release, 'places.sqlite');
        if (fileExists(candidate)) ffDb = candidate;
      }
    } catch {}
  }
  out.push({ id: 'firefox', name: 'Firefox', dbPath: ffDb, available: ffDb.length > 0 });

  return out;
}

interface RawHistoryRow {
  url: string;
  title?: string;
  visitCount: number;
  lastVisit: number; // unix epoch ms
}

interface RawBookmarkRow {
  url: string;
  title: string;
  dateAdded: number;
  folder: string;
  order: number;
}

export async function importFromBrowser(
  browserId: BrowserSearchSource
): Promise<{ imported: number; skipped: number; total: number; reason?: string }> {
  const profiles = listImportableBrowserProfiles().filter((profile) => profile.browserId === browserId);
  if (profiles.length > 0) {
    return importFromProfiles(profiles);
  }

  const browsers = listImportableBrowsers();
  const browser = browsers.find((b) => b.id === browserId);
  if (!browser) return { imported: 0, skipped: 0, total: 0, reason: 'Unknown browser' };
  if (!browser.available) return { imported: 0, skipped: 0, total: 0, reason: 'Browser history file not found' };

  return importFromSource(browser);
}

export async function importFromBrowserProfile(
  profileSourceId: string
): Promise<{ imported: number; skipped: number; total: number; reason?: string }> {
  const profile = listImportableBrowserProfiles().find((candidate) => candidate.id === profileSourceId);
  if (!profile) return { imported: 0, skipped: 0, total: 0, reason: 'Browser profile history file not found' };
  return importFromSource(profile);
}

export async function refreshEnabledBrowserProfiles(): Promise<{
  imported: number;
  skipped: number;
  total: number;
  refreshed: number;
  reason?: string;
}> {
  const settings = loadSettings().browserSearch;
  if (!settings.enabled) return { imported: 0, skipped: 0, total: 0, refreshed: 0 };
  const enabledIds = new Set(
    (Array.isArray(settings.profiles) && settings.profiles.length > 0
      ? settings.profiles.map((profile) => profile.id)
      : settings.profileSourceIds) || []
  );
  if (enabledIds.size === 0) return { imported: 0, skipped: 0, total: 0, refreshed: 0 };
  const profiles = listImportableBrowserProfiles().filter((profile) => enabledIds.has(profile.id));
  const result = await importFromProfiles(profiles);
  return {
    ...result,
    refreshed: profiles.length,
  };
}

async function importFromProfiles(
  profiles: ImportableBrowserProfile[]
): Promise<{ imported: number; skipped: number; total: number; reason?: string }> {
  let imported = 0;
  let skipped = 0;
  let total = 0;
  const reasons: string[] = [];
  for (const profile of profiles) {
    const result = await importFromSource(profile);
    imported += result.imported;
    skipped += result.skipped;
    total += result.total;
    if (result.reason) reasons.push(`${profile.browserName} ${profile.profileName}: ${result.reason}`);
  }
  return {
    imported,
    skipped,
    total,
    reason: imported === 0 && reasons.length > 0 ? reasons.join('; ') : undefined,
  };
}

async function importFromSource(
  browser: ImportableBrowser | ImportableBrowserProfile
): Promise<{ imported: number; skipped: number; total: number; reason?: string }> {
  const browserId = 'browserId' in browser ? browser.browserId : browser.id;
  const sourceProfileId = 'profileId' in browser ? browser.profileId : undefined;
  const sourceProfileName = 'profileName' in browser ? browser.profileName : undefined;
  const entries = load();
  const since = getNewestStoredVisitAt(entries, browserId, sourceProfileId);
  let rows: RawHistoryRow[] = [];
  try {
    rows = await readBrowserHistoryRows(browser, since);
  } catch (e: any) {
    return { imported: 0, skipped: 0, total: 0, reason: e?.message || 'Failed to read history' };
  }
  const bookmarkRows = 'bookmarksPath' in browser && browser.bookmarksPath
    ? readChromiumBookmarks(browser.bookmarksPath)
    : [];

  const existingKeys = new Set(entries.map((e) => importEntryKey(e)));
  let changed = false;
  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.url) continue;
    const host = extractHost(row.url);
    if (!host) {
      skipped += 1;
      continue;
    }
    const query = row.title?.trim() || host;
    const key = importEntryKey({
      type: 'url',
      url: row.url,
      query,
      source: browserId,
      sourceProfileId,
    });
    const legacyKey = sourceProfileId
      ? importEntryKey({
          type: 'url',
          url: row.url,
          query,
          source: browserId,
        })
      : key;
    const matchedKey = existingKeys.has(key) ? key : existingKeys.has(legacyKey) ? legacyKey : null;
    if (matchedKey) {
      const ex = entries.find((e) => importEntryKey(e) === matchedKey);
      if (ex) {
        const nextUseCount = Math.max(ex.useCount, row.visitCount);
        if (nextUseCount !== ex.useCount) {
          ex.useCount = nextUseCount;
          changed = true;
        }
        if (row.lastVisit > ex.lastUsedAt) {
          ex.lastUsedAt = row.lastVisit;
          changed = true;
        }
        if (sourceProfileId && ex.sourceProfileId !== sourceProfileId) {
          ex.sourceProfileId = sourceProfileId;
          changed = true;
        }
        if (sourceProfileName && ex.sourceProfileName !== sourceProfileName) {
          ex.sourceProfileName = sourceProfileName;
          changed = true;
        }
        existingKeys.add(importEntryKey(ex));
      }
      skipped += 1;
      continue;
    }
    entries.push({
      id: makeId(),
      type: 'url',
      query,
      url: row.url,
      host,
      lastUsedAt: row.lastVisit,
      useCount: Math.max(1, row.visitCount),
      source: browserId,
      sourceProfileId,
      sourceProfileName,
    });
    existingKeys.add(key);
    imported += 1;
    changed = true;
  }

  if (sourceProfileId) {
    const seenBookmarkKeys = new Set<string>();
    const existingBookmarkByKey = new Map<string, BrowserSearchEntry>();
    for (const entry of entries) {
      if (entry.type !== 'bookmark') continue;
      if (entry.source !== browserId) continue;
      if ((entry.sourceProfileId || '') !== sourceProfileId) continue;
      existingBookmarkByKey.set(importEntryKey(entry), entry);
    }

    for (const bookmark of bookmarkRows) {
      const host = extractHost(bookmark.url);
      if (!host) {
        skipped += 1;
        continue;
      }
      const query = bookmark.title || host;
      const key = importEntryKey({
        type: 'bookmark',
        query,
        url: bookmark.url,
        source: browserId,
        sourceProfileId,
      });
      seenBookmarkKeys.add(key);
      const existingBookmark = existingBookmarkByKey.get(key);
      if (existingBookmark) {
        const nextLastUsedAt = bookmark.dateAdded || existingBookmark.lastUsedAt || Date.now();
        if (existingBookmark.query !== query) {
          existingBookmark.query = query;
          changed = true;
        }
        if (existingBookmark.host !== host) {
          existingBookmark.host = host;
          changed = true;
        }
        if (existingBookmark.lastUsedAt !== nextLastUsedAt) {
          existingBookmark.lastUsedAt = nextLastUsedAt;
          changed = true;
        }
        if (existingBookmark.useCount !== 1) {
          existingBookmark.useCount = 1;
          changed = true;
        }
        if (existingBookmark.sourceProfileName !== sourceProfileName) {
          existingBookmark.sourceProfileName = sourceProfileName;
          changed = true;
        }
        if (existingBookmark.bookmarkFolder !== bookmark.folder) {
          existingBookmark.bookmarkFolder = bookmark.folder;
          changed = true;
        }
        if (existingBookmark.bookmarkOrder !== bookmark.order) {
          existingBookmark.bookmarkOrder = bookmark.order;
          changed = true;
        }
        skipped += 1;
        continue;
      }
      const entry = {
        id: makeId(),
        type: 'bookmark' as const,
        query,
        url: bookmark.url,
        host,
        lastUsedAt: bookmark.dateAdded || Date.now(),
        useCount: 1,
        source: browserId,
        sourceProfileId,
        sourceProfileName,
        bookmarkFolder: bookmark.folder,
        bookmarkOrder: bookmark.order,
      };
      entries.push(entry);
      existingKeys.add(importEntryKey(entry));
      imported += 1;
      changed = true;
    }

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type !== 'bookmark') continue;
      if (entry.source !== browserId) continue;
      if ((entry.sourceProfileId || '') !== sourceProfileId) continue;
      if (seenBookmarkKeys.has(importEntryKey(entry))) continue;
      existingKeys.delete(importEntryKey(entry));
      entries.splice(i, 1);
      changed = true;
    }
  }

  const beforePruneLength = entries.length;
  pruneByRetentionInPlace(entries);
  trimToCapInPlace(entries);
  if (entries.length !== beforePruneLength) changed = true;
  cache = entries;
  if (changed) {
    bumpBrowserSearchRevision();
    save();
  }

  return { imported, skipped, total: rows.length + bookmarkRows.length };
}

function getNewestStoredVisitAt(
  entries: BrowserSearchEntry[],
  source: BrowserSearchSource,
  sourceProfileId?: string
): number {
  let newest = 0;
  for (const entry of entries) {
    if (entry.type !== 'url') continue;
    if (entry.source !== source) continue;
    if ((entry.sourceProfileId || '') !== (sourceProfileId || '')) continue;
    if (entry.lastUsedAt > newest) newest = entry.lastUsedAt;
  }
  return newest;
}

async function readBrowserHistoryRows(
  browser: ImportableBrowser | ImportableBrowserProfile,
  afterVisitAt = 0
): Promise<RawHistoryRow[]> {
  // Chromium DBs are usually locked while the browser is running. Copy first.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-bh-'));
  const tempDb = path.join(tempDir, 'History.copy');
  try {
    fs.copyFileSync(browser.dbPath, tempDb);
    // Best-effort: copy WAL/SHM siblings if present (Chromium uses WAL mode).
    for (const ext of ['-wal', '-shm']) {
      const sibling = browser.dbPath + ext;
      if (fileExists(sibling)) {
        try {
          fs.copyFileSync(sibling, tempDb + ext);
        } catch {}
      }
    }

    const browserId = 'browserId' in browser ? browser.browserId : browser.id;
    const sql = buildHistoryQuery(browserId, afterVisitAt);

    const { stdout } = await execFileAsync(
      'sqlite3',
      ['-json', tempDb, sql],
      { maxBuffer: 256 * 1024 * 1024, timeout: 60_000 }
    );
    const trimmed = (stdout || '').trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r: any) => normalizeRow(browserId, r))
      .filter((r: RawHistoryRow | null): r is RawHistoryRow => r !== null);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

function readChromiumBookmarks(bookmarksPath: string): RawBookmarkRow[] {
  if (!fileExists(bookmarksPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(bookmarksPath, 'utf-8'));
    const rows: RawBookmarkRow[] = [];
    collectChromiumBookmarks(parsed?.roots, rows, []);
    return rows;
  } catch (e) {
    console.warn('Failed to read Chromium bookmarks:', e);
    return [];
  }
}

function collectChromiumBookmarks(node: any, rows: RawBookmarkRow[], folderPath: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectChromiumBookmarks(child, rows, folderPath);
    return;
  }

  if (isChromiumRootsNode(node)) {
    for (const key of getOrderedChromiumRootKeys(node)) {
      collectChromiumBookmarks(node[key], rows, []);
    }
    return;
  }

  if (node.type === 'folder') {
    const folderName = cleanBookmarkFolderName(node.name);
    const nextFolderPath = folderName ? [...folderPath, folderName] : folderPath;
    if (node.children) collectChromiumBookmarks(node.children, rows, nextFolderPath);
    return;
  }

  if (node.type === 'url') {
    const url = String(node.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    const title = String(node.name || '').trim() || extractHost(url);
    rows.push({
      url,
      title,
      dateAdded: decodeTimestamp('chrome', Number(node.date_added || 0)) || Date.now(),
      folder: folderPath.join(' - '),
      order: rows.length,
    });
    return;
  }

  if (node.children) collectChromiumBookmarks(node.children, rows, folderPath);
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object' && value !== node.children) {
      collectChromiumBookmarks(value, rows, folderPath);
    }
  }
}

function isChromiumRootsNode(node: any): boolean {
  return Boolean(node && typeof node === 'object' && (node.bookmark_bar || node.other || node.synced));
}

function getOrderedChromiumRootKeys(node: Record<string, unknown>): string[] {
  const preferred = ['bookmark_bar', 'other', 'synced'];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const key of preferred) {
    if (node[key]) {
      ordered.push(key);
      seen.add(key);
    }
  }
  for (const key of Object.keys(node)) {
    if (!seen.has(key)) ordered.push(key);
  }
  return ordered;
}

function cleanBookmarkFolderName(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function buildChromiumQuery(): string {
  return buildHistoryQuery('chrome', 0);
}

function buildHistoryQuery(browserId: BrowserSearchSource, afterVisitAt: number): string {
  if (browserId === 'safari') return buildSafariQuery(afterVisitAt);
  if (browserId === 'firefox') return buildFirefoxQuery(afterVisitAt);
  return buildChromiumQueryAfter(afterVisitAt);
}

function buildChromiumQueryAfter(afterVisitAt: number): string {
  // last_visit_time is microseconds since 1601-01-01.
  const where = afterVisitAt > 0
    ? `last_visit_time > ${Math.floor((afterVisitAt + 11_644_473_600_000) * 1000)}`
    : 'last_visit_time > 0';
  return `SELECT url, title, visit_count AS visitCount, last_visit_time AS lastVisitRaw
FROM urls
WHERE ${where}
ORDER BY last_visit_time DESC;`;
}

function buildSafariQuery(afterVisitAt = 0): string {
  // visit_time is CFAbsoluteTime: seconds since 2001-01-01 UTC.
  const where = afterVisitAt > 0
    ? `WHERE v.visit_time > ${afterVisitAt / 1000 - 978_307_200}`
    : '';
  return `SELECT i.url AS url, i.visit_count AS visitCount, MAX(v.visit_time) AS lastVisitRaw, '' AS title
FROM history_items i
JOIN history_visits v ON v.history_item = i.id
${where}
GROUP BY i.id
ORDER BY lastVisitRaw DESC;`;
}

function buildFirefoxQuery(afterVisitAt = 0): string {
  // last_visit_date is microseconds since 1970-01-01.
  const where = afterVisitAt > 0
    ? `last_visit_date > ${Math.floor(afterVisitAt * 1000)}`
    : 'last_visit_date IS NOT NULL';
  return `SELECT url, title, visit_count AS visitCount, last_visit_date AS lastVisitRaw
FROM moz_places
WHERE ${where}
ORDER BY last_visit_date DESC;`;
}

function normalizeRow(browserId: BrowserSearchSource, raw: any): RawHistoryRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const url = String(raw.url || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  const visitCount = Math.max(1, Math.floor(Number(raw.visitCount) || 1));
  const lastVisit = decodeTimestamp(browserId, Number(raw.lastVisitRaw));
  if (!Number.isFinite(lastVisit) || lastVisit <= 0) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  return { url, visitCount, lastVisit, title };
}

// ─── Live search suggestions ────────────────────────────────────────
//
// Google's `suggestqueries` endpoint returns a JSON array
//   [ "<typed>", [ "suggestion 1", "suggestion 2", ... ], … ]
// — the same one Chromium uses for the omnibox. No API key required.
// We pick the first suggestion that *strictly extends* the user's prefix
// so it can be used as inline autocomplete; if no such suggestion exists,
// we return null and the caller will skip autocompletion.

const SUGGEST_TIMEOUT_MS = 1500;
const MAX_SEARCH_SUGGESTIONS = 30;

export async function fetchSearchSuggestion(rawInput: string): Promise<string | null> {
  const suggestions = await fetchSearchSuggestions(rawInput, 1);
  return suggestions[0] || null;
}

type SearchSuggestionProvider = {
  key?: string;
  host?: string;
  name?: string;
};

type NormalizedSearchSuggestionProvider = {
  key: string;
  host: string;
  name: string;
};

function normalizeSuggestionProvider(value: SearchSuggestionProvider | undefined): NormalizedSearchSuggestionProvider {
  return {
    key: String(value?.key || '').trim().toLowerCase().replace(/^!+/, ''),
    host: String(value?.host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''),
    name: String(value?.name || '').trim().toLowerCase(),
  };
}

function fetchJsonUrl(url: string): Promise<any> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: any) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const req = https.get(url, { timeout: SUGGEST_TIMEOUT_MS }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            finish(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch {
            finish(null);
          }
        });
        res.on('error', () => finish(null));
      });
      req.on('error', () => finish(null));
      req.on('timeout', () => {
        try {
          req.destroy();
        } catch {}
        finish(null);
      });
    } catch {
      finish(null);
    }
  });
}

function uniqueSuggestionList(values: unknown[], max: number): string[] {
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const candidate of values) {
    const s = String(candidate || '').trim();
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    suggestions.push(s);
    if (suggestions.length >= max) break;
  }
  return suggestions;
}

async function fetchWikipediaSuggestions(trimmed: string, max: number): Promise<string[]> {
  const parsed = await fetchJsonUrl(`https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=${max}&search=${encodeURIComponent(trimmed)}`);
  return Array.isArray(parsed?.[1]) ? uniqueSuggestionList(parsed[1], max) : [];
}

async function fetchNpmSuggestions(trimmed: string, max: number): Promise<string[]> {
  const parsed = await fetchJsonUrl(`https://registry.npmjs.org/-/v1/search?size=${max}&text=${encodeURIComponent(trimmed)}`);
  const objects = Array.isArray(parsed?.objects) ? parsed.objects : [];
  return uniqueSuggestionList(objects.map((item: any) => item?.package?.name), max);
}

function getGoogleSuggestUrl(trimmed: string, provider: SearchSuggestionProvider): string {
  const normalized = normalizeSuggestionProvider(provider);
  const isYouTube = normalized.key === 'yt' ||
    normalized.key === 'youtube' ||
    normalized.host.includes('youtube.com') ||
    normalized.name.includes('youtube');
  const ds = isYouTube ? '&ds=yt' : '';
  return `https://suggestqueries.google.com/complete/search?client=firefox${ds}&q=${encodeURIComponent(trimmed)}`;
}

export async function fetchSearchSuggestions(rawInput: string, limit = MAX_SEARCH_SUGGESTIONS, provider?: SearchSuggestionProvider): Promise<string[]> {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return [];
  const max = Math.max(1, Math.min(MAX_SEARCH_SUGGESTIONS, Math.floor(Number(limit) || MAX_SEARCH_SUGGESTIONS)));
  const normalizedProvider = normalizeSuggestionProvider(provider);
  const isWikipedia = normalizedProvider.key === 'wiki' ||
    normalizedProvider.key === 'w' ||
    normalizedProvider.host.includes('wikipedia.org') ||
    normalizedProvider.name.includes('wikipedia');
  if (isWikipedia) {
    const suggestions = await fetchWikipediaSuggestions(trimmed, max);
    if (suggestions.length > 0) return suggestions;
  }
  const isNpm = normalizedProvider.key === 'npm' ||
    normalizedProvider.host.includes('npmjs.com') ||
    normalizedProvider.name === 'npm';
  if (isNpm) {
    const suggestions = await fetchNpmSuggestions(trimmed, max);
    if (suggestions.length > 0) return suggestions;
  }
  const url = getGoogleSuggestUrl(trimmed, normalizedProvider);
  return new Promise<string[]>((resolve) => {
    let settled = false;
    const finish = (value: string[]) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const req = https.get(url, { timeout: SUGGEST_TIMEOUT_MS }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish([]);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            const parsed = JSON.parse(body);
            if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) {
              finish([]);
              return;
            }
            finish(uniqueSuggestionList(parsed[1], max));
          } catch {
            finish([]);
          }
        });
        res.on('error', () => finish([]));
      });
      req.on('error', () => finish([]));
      req.on('timeout', () => {
        try {
          req.destroy();
        } catch {}
        finish([]);
      });
    } catch {
      finish([]);
    }
  });
}

function decodeTimestamp(browserId: BrowserSearchSource, raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (browserId === 'safari') {
    // CFAbsoluteTime → unix epoch ms.
    return Math.round((raw + 978_307_200) * 1000);
  }
  if (browserId === 'firefox') {
    // microseconds since unix epoch.
    return Math.round(raw / 1000);
  }
  // Chromium-family: microseconds since 1601-01-01.
  return Math.round(raw / 1000 - 11_644_473_600_000);
}
