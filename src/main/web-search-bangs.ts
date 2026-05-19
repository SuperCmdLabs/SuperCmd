import { app } from 'electron';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

export type WebSearchBangEntry = {
  key: string;
  aliases?: string[];
  name: string;
  host: string;
  category?: string;
  subcategory?: string;
  urlTemplate: string;
  rankHint?: number;
  source?: 'duckduckgo' | 'unduck' | 'seed';
};

const BANG_LITE_URL = 'https://duckduckgo.com/bang_lite.html';
const DDG_BANG_JS_URL = 'https://duckduckgo.com/bang.js';
const UNDUCK_BANG_TS_URL = 'https://raw.githubusercontent.com/T3-Content/unduck/main/src/bang.ts';
const FETCH_TIMEOUT_MS = 5000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DDG_BANG_HOST = 'duckduckgo.com';
const DDG_BANG_TEMPLATE = 'https://duckduckgo.com/?q=!{bang}%20{query}';

const FALLBACK_BANGS: WebSearchBangEntry[] = [
  { key: 'g', aliases: ['google'], name: 'Google', host: 'google.com', category: 'Search', urlTemplate: 'https://www.google.com/search?q={query}', rankHint: 1, source: 'seed' },
  { key: 'ddg', aliases: ['d', 'duckduckgo'], name: 'DuckDuckGo', host: 'duckduckgo.com', category: 'Search', urlTemplate: 'https://duckduckgo.com/?q={query}', rankHint: 2, source: 'seed' },
  { key: 'yt', aliases: ['youtube'], name: 'YouTube', host: 'youtube.com', category: 'Multimedia', urlTemplate: 'https://www.youtube.com/results?search_query={query}', rankHint: 3, source: 'seed' },
  { key: 'gh', aliases: ['github'], name: 'GitHub', host: 'github.com', category: 'Programming', urlTemplate: 'https://github.com/search?q={query}', rankHint: 4, source: 'seed' },
  { key: 'npm', name: 'npm', host: 'npmjs.com', category: 'Programming', urlTemplate: 'https://www.npmjs.com/search?q={query}', rankHint: 12, source: 'seed' },
  { key: 'mdn', name: 'MDN', host: 'developer.mozilla.org', category: 'Programming', urlTemplate: 'https://developer.mozilla.org/search?q={query}', rankHint: 11, source: 'seed' },
  { key: 'maps', aliases: ['gm'], name: 'Google Maps', host: 'google.com', category: 'Search', urlTemplate: 'https://www.google.com/maps/search/{query}', rankHint: 5, source: 'seed' },
  { key: 'img', aliases: ['image', 'images', 'gi', 'gim', 'gimg', 'gimages'], name: 'Google Images', host: 'google.com', category: 'Search', urlTemplate: 'https://www.google.com/search?tbm=isch&q={query}', rankHint: 6, source: 'seed' },
  { key: 'wiki', aliases: ['w', 'wikipedia'], name: 'Wikipedia', host: 'wikipedia.org', category: 'Reference', urlTemplate: 'https://en.wikipedia.org/w/index.php?search={query}', rankHint: 7, source: 'seed' },
  { key: 'x', aliases: ['twitter'], name: 'X', host: 'x.com', category: 'Social', urlTemplate: 'https://x.com/search?q={query}', rankHint: 14, source: 'seed' },
];

let cachedBangs: WebSearchBangEntry[] | null = null;
let cachedBangsLoadedAt = 0;
let refreshPromise: Promise<WebSearchBangEntry[]> | null = null;

function getCachePath(): string {
  return path.join(app.getPath('userData'), 'browser-root', 'bangs.json');
}

function normalizeBangKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9.+_-]/g, '');
}

function normalizeBangName(key: string): string {
  if (!key) return '';
  if (key === 'gh' || key === 'github') return 'GitHub';
  if (key === 'yt' || key === 'youtube') return 'YouTube';
  return key;
}

function normalizeBangUrlTemplate(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return DDG_BANG_TEMPLATE;
  return raw.replace(/\{\{\{s\}\}\}/g, '{query}');
}

function normalizeBangAliases(value: any, key: string): string[] {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(new Set(
    raw
      .map((alias: unknown) => normalizeBangKey(String(alias || '')))
      .filter((alias: string) => alias && alias !== key)
  ));
}

function readCachedBangFile(): WebSearchBangEntry[] | null {
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.bangs)) return null;
    const entries = normalizeBangEntries(parsed.bangs);
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

function writeCachedBangFile(bangs: WebSearchBangEntry[]): void {
  try {
    const target = getCachePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ version: 1, fetchedAt: Date.now(), bangs }, null, 2));
  } catch {}
}

function isCacheFresh(): boolean {
  try {
    const stat = fs.statSync(getCachePath());
    return Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchText(new URL(res.headers.location, url).toString()).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

function parseBangLiteHtml(html: string): WebSearchBangEntry[] {
  const byKey = new Map<string, WebSearchBangEntry>();
  const sectionRe = /<li><h6><b>([^<]+):<\/b><\/h6>([\s\S]*?)(?=<\/li>)/g;
  let match: RegExpExecArray | null;
  while ((match = sectionRe.exec(html))) {
    const category = decodeHtml(match[1]).trim();
    const body = match[2] || '';
    const bangMatches = body.match(/![^\s<()]+/g) || [];
    for (const rawBang of bangMatches) {
      const key = normalizeBangKey(rawBang);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, {
        key,
        name: normalizeBangName(key),
        host: DDG_BANG_HOST,
        category,
        urlTemplate: DDG_BANG_TEMPLATE,
        source: 'duckduckgo',
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function parseRichBangJsonLike(text: string, source: 'duckduckgo' | 'unduck'): WebSearchBangEntry[] {
  const byKey = new Map<string, WebSearchBangEntry>();
  const objectRe = /\{\s*c:\s*"([^"]*)",\s*d:\s*"([^"]*)",\s*r:\s*(-?\d+),\s*s:\s*"([^"]*)",\s*sc:\s*"([^"]*)",\s*t:\s*"([^"]*)",\s*u:\s*"([^"]*)",?\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = objectRe.exec(text))) {
    const key = normalizeBangKey(match[6]);
    if (!key || byKey.has(key)) continue;
    const host = String(match[2] || '').trim() || DDG_BANG_HOST;
    const rankHint = Number(match[3]);
    byKey.set(key, {
      key,
      name: decodeHtml(match[4]).trim() || normalizeBangName(key),
      host,
      category: decodeHtml(match[1]).trim() || undefined,
      subcategory: decodeHtml(match[5]).trim() || undefined,
      urlTemplate: normalizeBangUrlTemplate(decodeHtml(match[7])),
      rankHint: Number.isFinite(rankHint) ? rankHint : undefined,
      source,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function decodeHtml(value: string): string {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeBangEntries(value: any): WebSearchBangEntry[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, WebSearchBangEntry>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const key = normalizeBangKey(item.key);
    if (!key || byKey.has(key)) continue;
    const host = String(item.host || DDG_BANG_HOST).trim() || DDG_BANG_HOST;
    byKey.set(key, {
      key,
      aliases: normalizeBangAliases(item.aliases, key),
      name: String(item.name || item.s || normalizeBangName(key)).trim() || key,
      host,
      category: String(item.category || item.c || '').trim() || undefined,
      subcategory: String(item.subcategory || item.sc || '').trim() || undefined,
      urlTemplate: normalizeBangUrlTemplate(String(item.urlTemplate || item.u || DDG_BANG_TEMPLATE)),
      rankHint: Number.isFinite(Number(item.rankHint ?? item.r)) ? Number(item.rankHint ?? item.r) : undefined,
      source: item.source === 'seed' || item.source === 'unduck' || item.source === 'duckduckgo' ? item.source : undefined,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}

async function refreshBangCatalog(): Promise<WebSearchBangEntry[]> {
  let parsed: WebSearchBangEntry[] = [];
  try {
    const rich = await fetchText(DDG_BANG_JS_URL);
    parsed = parseRichBangJsonLike(rich, 'duckduckgo');
  } catch {}
  if (parsed.length === 0) {
    try {
      const unduck = await fetchText(UNDUCK_BANG_TS_URL);
      parsed = parseRichBangJsonLike(unduck, 'unduck');
    } catch {}
  }
  if (parsed.length === 0) {
    const html = await fetchText(BANG_LITE_URL);
    parsed = parseBangLiteHtml(html);
  }
  if (parsed.length === 0) throw new Error('No bangs parsed');
  writeCachedBangFile(parsed);
  return parsed;
}

export async function listWebSearchBangs(): Promise<WebSearchBangEntry[]> {
  if (cachedBangs && Date.now() - cachedBangsLoadedAt < CACHE_MAX_AGE_MS) return cachedBangs;

  const local = readCachedBangFile();
  if (local && isCacheFresh()) {
    cachedBangs = mergeFallbackBangs(local);
    cachedBangsLoadedAt = Date.now();
    return cachedBangs;
  }

  if (!refreshPromise) {
    refreshPromise = refreshBangCatalog()
      .then((fresh) => {
        cachedBangs = mergeFallbackBangs(fresh);
        cachedBangsLoadedAt = Date.now();
        return cachedBangs;
      })
      .catch(() => {
        cachedBangs = mergeFallbackBangs(local || []);
        cachedBangsLoadedAt = Date.now();
        return cachedBangs;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function mergeFallbackBangs(catalog: WebSearchBangEntry[]): WebSearchBangEntry[] {
  const byKey = new Map<string, WebSearchBangEntry>();
  for (const entry of catalog) byKey.set(entry.key, entry);
  for (const entry of FALLBACK_BANGS) {
    const existing = byKey.get(entry.key);
    byKey.set(entry.key, {
      ...entry,
      ...existing,
      aliases: Array.from(new Set([...(entry.aliases || []), ...(existing?.aliases || [])])),
      urlTemplate: entry.urlTemplate || existing?.urlTemplate || DDG_BANG_TEMPLATE,
      host: entry.host || existing?.host || DDG_BANG_HOST,
      name: entry.name || existing?.name || normalizeBangName(entry.key),
      source: existing?.source || entry.source,
      rankHint: existing?.rankHint ?? entry.rankHint,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}
