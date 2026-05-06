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

import { loadSettings } from './settings-store';

const execFileAsync = promisify(execFile);

export type BrowserSearchEntryType = 'url' | 'search';
export type BrowserSearchSource =
  | 'user'
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
}

export interface AutocompleteSuggestion {
  /** The full text the user would end up with after accepting. */
  completion: string;
  /** The portion of `completion` that comes AFTER the user's prefix (the ghost-text suffix). */
  suffix: string;
  entry: BrowserSearchEntry;
}

const MAX_ENTRIES = 5_000;
const MAX_IMPORT_PER_BROWSER = 2_000;

let cache: BrowserSearchEntry[] | null = null;

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

function sanitizeEntry(raw: any): BrowserSearchEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const type: BrowserSearchEntryType = raw.type === 'search' ? 'search' : 'url';
  const query = String(raw.query || '').trim();
  const url = String(raw.url || '').trim();
  if (!query || !url) return null;
  const host = String(raw.host || '').trim() || extractHost(url);
  const lastUsedAt = Number.isFinite(Number(raw.lastUsedAt)) ? Number(raw.lastUsedAt) : 0;
  const useCount = Number.isFinite(Number(raw.useCount)) ? Math.max(1, Math.floor(Number(raw.useCount))) : 1;
  const source: BrowserSearchSource = ALLOWED_SOURCES.has(raw.source) ? raw.source : 'user';
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : makeId();
  return { id, type, query, url, host, lastUsedAt, useCount, source };
}

const ALLOWED_SOURCES: Set<string> = new Set([
  'user',
  'chrome',
  'arc',
  'brave',
  'edge',
  'vivaldi',
  'safari',
  'firefox',
]);

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── URL detection ──────────────────────────────────────────────────

const URL_PROTOCOL_RE = /^[a-z][\w+.\-]*:\/\//i;
const LOCALHOST_RE = /^localhost(:\d+)?(\/.*)?$/i;
const IP_RE = /^\d{1,3}(?:\.\d{1,3}){3}(:\d+)?(\/.*)?$/;
// Liberal but cautious URL char set — anything beyond this and we treat as search.
const URL_BODY_RE = /^[\w.\-:/?#[\]@!$&'()*+,;=%~]+$/;

export interface ResolvedInput {
  type: BrowserSearchEntryType;
  /** URL to actually navigate to — for search this is a Google search URL. */
  url: string;
  /** Host (only meaningful for url type). */
  host: string;
}

export function resolveInput(rawInput: string): ResolvedInput | null {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;

  if (URL_PROTOCOL_RE.test(trimmed)) {
    return { type: 'url', url: trimmed, host: extractHost(trimmed) };
  }

  const noSpaces = !/\s/.test(trimmed);
  const looksLikeUrl =
    noSpaces &&
    URL_BODY_RE.test(trimmed) &&
    (LOCALHOST_RE.test(trimmed) || IP_RE.test(trimmed) || /^[\w-]+(\.[\w-]+)+/.test(trimmed));

  if (looksLikeUrl) {
    const url = `https://${trimmed}`;
    return { type: 'url', url, host: extractHost(url) };
  }

  // Default search engine intentionally hardcoded — opens in user's default
  // browser via shell.openExternal so they still get their browser of choice.
  const url = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  return { type: 'search', url, host: '' };
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

export async function openInDefaultBrowser(rawInput: string): Promise<{
  ok: boolean;
  resolved: ResolvedInput | null;
}> {
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

function recordEntry(query: string, resolved: ResolvedInput, source: BrowserSearchSource = 'user'): void {
  if (!query) return;
  const entries = load();
  const dedupeKey = entryKey(resolved.type, resolved.type === 'url' ? resolved.url : query);
  const existing = entries.find((e) => entryKey(e.type, e.type === 'url' ? e.url : e.query) === dedupeKey);
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
  save();
}

function entryKey(type: BrowserSearchEntryType, value: string): string {
  return `${type}:${value.toLowerCase()}`;
}

export function clearHistory(): void {
  cache = [];
  save();
}

export function pruneByRetentionNow(): void {
  const entries = load();
  pruneByRetentionInPlace(entries);
  cache = entries;
  save();
}

function pruneByRetentionInPlace(entries: BrowserSearchEntry[]): void {
  const days = loadSettings().browserSearch.historyRetentionDays;
  if (!days || days <= 0) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].lastUsedAt < cutoff) entries.splice(i, 1);
  }
}

function trimToCapInPlace(entries: BrowserSearchEntry[]): void {
  if (entries.length <= MAX_ENTRIES) return;
  // Keep the most recent / most-used. Sort by frecency desc and slice.
  entries.sort((a, b) => frecency(b) - frecency(a));
  entries.length = MAX_ENTRIES;
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
    .filter((e) => e.type === 'url' && e.host)
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

  // Pass 2: search-query prefix match.
  const searchCandidates = entries
    .filter((e) => e.type === 'search' && e.query.toLowerCase().startsWith(lower) && e.query.length > input.length)
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

export function listImportableBrowsers(): ImportableBrowser[] {
  const home = homeDir();
  const out: ImportableBrowser[] = [];

  // Chromium-family default profiles
  const chromium: { id: BrowserSearchSource; name: string; dbPath: string }[] = [
    { id: 'chrome', name: 'Google Chrome', dbPath: path.join(home, 'Library/Application Support/Google/Chrome/Default/History') },
    { id: 'arc', name: 'Arc', dbPath: path.join(home, 'Library/Application Support/Arc/User Data/Default/History') },
    { id: 'brave', name: 'Brave', dbPath: path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser/Default/History') },
    { id: 'edge', name: 'Microsoft Edge', dbPath: path.join(home, 'Library/Application Support/Microsoft Edge/Default/History') },
    { id: 'vivaldi', name: 'Vivaldi', dbPath: path.join(home, 'Library/Application Support/Vivaldi/Default/History') },
  ];
  for (const b of chromium) {
    out.push({ ...b, available: fileExists(b.dbPath) });
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

export async function importFromBrowser(
  browserId: BrowserSearchSource
): Promise<{ imported: number; skipped: number; total: number; reason?: string }> {
  const browsers = listImportableBrowsers();
  const browser = browsers.find((b) => b.id === browserId);
  if (!browser) return { imported: 0, skipped: 0, total: 0, reason: 'Unknown browser' };
  if (!browser.available) return { imported: 0, skipped: 0, total: 0, reason: 'Browser history file not found' };

  let rows: RawHistoryRow[] = [];
  try {
    rows = await readBrowserHistoryRows(browser);
  } catch (e: any) {
    return { imported: 0, skipped: 0, total: 0, reason: e?.message || 'Failed to read history' };
  }

  const entries = load();
  const existingKeys = new Set(entries.map((e) => entryKey(e.type, e.type === 'url' ? e.url : e.query)));
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
    const key = entryKey('url', row.url);
    if (existingKeys.has(key)) {
      // bump useCount + lastUsedAt if newer
      const ex = entries.find((e) => entryKey(e.type, e.type === 'url' ? e.url : e.query) === key);
      if (ex) {
        ex.useCount = Math.max(ex.useCount, row.visitCount);
        if (row.lastVisit > ex.lastUsedAt) ex.lastUsedAt = row.lastVisit;
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
    });
    existingKeys.add(key);
    imported += 1;
  }

  pruneByRetentionInPlace(entries);
  trimToCapInPlace(entries);
  cache = entries;
  save();

  return { imported, skipped, total: rows.length };
}

async function readBrowserHistoryRows(browser: ImportableBrowser): Promise<RawHistoryRow[]> {
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

    const sql = browser.id === 'safari'
      ? buildSafariQuery()
      : browser.id === 'firefox'
      ? buildFirefoxQuery()
      : buildChromiumQuery();

    const { stdout } = await execFileAsync(
      'sqlite3',
      ['-json', tempDb, sql],
      { maxBuffer: 32 * 1024 * 1024, timeout: 20_000 }
    );
    const trimmed = (stdout || '').trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r: any) => normalizeRow(browser.id, r))
      .filter((r: RawHistoryRow | null): r is RawHistoryRow => r !== null);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

function buildChromiumQuery(): string {
  // last_visit_time is microseconds since 1601-01-01.
  return `SELECT url, title, visit_count AS visitCount, last_visit_time AS lastVisitRaw
FROM urls
WHERE last_visit_time > 0
ORDER BY last_visit_time DESC
LIMIT ${MAX_IMPORT_PER_BROWSER};`;
}

function buildSafariQuery(): string {
  // visit_time is CFAbsoluteTime: seconds since 2001-01-01 UTC.
  return `SELECT i.url AS url, i.visit_count AS visitCount, MAX(v.visit_time) AS lastVisitRaw, '' AS title
FROM history_items i
JOIN history_visits v ON v.history_item = i.id
GROUP BY i.id
ORDER BY lastVisitRaw DESC
LIMIT ${MAX_IMPORT_PER_BROWSER};`;
}

function buildFirefoxQuery(): string {
  // last_visit_date is microseconds since 1970-01-01.
  return `SELECT url, title, visit_count AS visitCount, last_visit_date AS lastVisitRaw
FROM moz_places
WHERE last_visit_date IS NOT NULL
ORDER BY last_visit_date DESC
LIMIT ${MAX_IMPORT_PER_BROWSER};`;
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

export async function fetchSearchSuggestion(rawInput: string): Promise<string | null> {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(trimmed)}`;
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
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
            const body = Buffer.concat(chunks).toString('utf-8');
            const parsed = JSON.parse(body);
            if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) {
              finish(null);
              return;
            }
            const lower = trimmed.toLowerCase();
            for (const candidate of parsed[1]) {
              const s = String(candidate || '').trim();
              if (!s || s.length <= trimmed.length) continue;
              if (s.toLowerCase().startsWith(lower)) {
                finish(s);
                return;
              }
            }
            finish(null);
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
