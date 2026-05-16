import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BrowserSearchAutocomplete,
  BrowserSearchEntry,
  BrowserSearchResultGroupSetting,
  BrowserSearchResultKind,
  BrowserSearchSource,
  BrowserTabEntry,
} from '../../types/electron';

export interface ResolvedBrowserInput {
  type: 'url' | 'search';
  /** Resolved URL we'll open (search engine URL for `search` type). */
  url: string;
  /** Host for URL type, empty string for search. */
  host: string;
}

export interface BrowserSearchResult {
  id: string;
  kind: 'open-tab' | 'bookmark' | 'history';
  title: string;
  subtitle: string;
  url: string;
  actionInput: string;
  focusAvailable: boolean;
  score: number;
  completion: string;
}

interface UseBrowserSearchResult {
  enabled: boolean;
  getCompletion: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchAutocomplete | null;
  getTopResult: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchResult | null;
  getResults: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchResult[];
  getAllResults: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchResult[];
  getMatchKind: (input: string, completion?: BrowserSearchAutocomplete | null) => 'open-tab' | 'history' | 'search';
  hasOpenTabMatch: (input: string) => boolean;
  executeBrowserSearch: (input: string, options?: { focusExistingTab?: boolean }) => Promise<boolean>;
  /** Synchronous URL/search detection — returns null for empty input. */
  resolve: (input: string) => ResolvedBrowserInput | null;
}

export function useBrowserSearch(_currentQuery: string): UseBrowserSearchResult {
  const [entries, setEntries] = useState<BrowserSearchEntry[]>([]);
  const [tabs, setTabs] = useState<BrowserTabEntry[]>([]);
  const [enabled, setEnabled] = useState<boolean>(true);
  const entriesRef = useRef<BrowserSearchEntry[]>([]);
  const tabsRef = useRef<BrowserTabEntry[]>([]);
  entriesRef.current = entries;
  tabsRef.current = tabs;

  const refresh = useCallback(() => {
    Promise.all([
      window.electron.browserSearchListEntries(),
      window.electron.browserTabsList?.() ?? Promise.resolve([]),
    ])
      .then(([entryList, tabList]) => {
        setEntries(Array.isArray(entryList) ? entryList : []);
        setTabs(Array.isArray(tabList) ? tabList : []);
      })
      .catch(() => {
        setEntries([]);
        setTabs([]);
      });
  }, []);

  useEffect(() => {
    let disposed = false;
    window.electron.getSettings()
      .then((s) => {
        if (disposed) return;
        setEnabled(s?.browserSearch?.enabled ?? true);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((s) => {
      setEnabled(s?.browserSearch?.enabled ?? true);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      setTabs([]);
      return;
    }
    refresh();
    const unsubscribe = window.electron.onBrowserSearchHistoryChanged?.(() => refresh());
    const unsubscribeTabs = window.electron.onBrowserTabsChanged?.(() => refresh());
    return () => {
      try {
        unsubscribe?.();
        unsubscribeTabs?.();
      } catch {}
    };
  }, [enabled, refresh]);

  const getTopResult = useCallback((rawInput: string, rawGroups: BrowserSearchResultGroupSetting[]): BrowserSearchResult | null => {
    if (!enabled) return null;
    return getOrderedBrowserResults(rawInput, rawGroups, entriesRef.current, tabsRef.current, { limit: 1 })[0] || null;
  }, [enabled]);

  const getCompletion = useCallback((
    rawInput: string,
    rawGroups: BrowserSearchResultGroupSetting[]
  ): BrowserSearchAutocomplete | null => {
    if (!enabled) return null;
    const input = rawInput;
    if (!input.trim()) return null;
    const result = getTopResult(input, rawGroups);
    if (!result?.completion) return null;
    if (result.completion === input) return null;
    if (!result.completion.toLowerCase().startsWith(input.toLowerCase())) return null;
    return {
      completion: result.completion,
      suffix: result.completion.slice(input.length),
      entry: browserResultToEntry(result),
    };
  }, [enabled, getTopResult]);

  const executeBrowserSearch = useCallback(async (
    input: string,
    options?: { focusExistingTab?: boolean }
  ): Promise<boolean> => {
    if (!enabled) return false;
    const trimmed = input.trim();
    if (!trimmed) return false;
    try {
      if (options?.focusExistingTab) {
        const focusResult = await window.electron.browserTabsFocus?.(trimmed);
        if (focusResult?.ok) return true;
      }
      const result = await window.electron.browserSearchOpen(trimmed);
      return Boolean(result?.ok);
    } catch (e) {
      console.error('Browser search open failed:', e);
      return false;
    }
  }, [enabled]);

  const hasOpenTabMatch = useCallback((rawInput: string): boolean => {
    if (!enabled) return false;
    return Boolean(findOpenTabMatch(rawInput, tabsRef.current));
  }, [enabled]);

  const getMatchKind = useCallback((
    input: string,
    completion?: BrowserSearchAutocomplete | null
  ): 'open-tab' | 'history' | 'search' => {
    if (!enabled) return 'search';
    const completionEntryId = String(completion?.entry?.id || '');
    if (completionEntryId.startsWith('tab:')) return 'open-tab';
    if (findOpenTabMatch(input, tabsRef.current)) return 'open-tab';
    const resolved = resolveLocal(input);
    return resolved?.type === 'url' ? 'history' : 'search';
  }, [enabled]);

  const getResults = useCallback((rawInput: string, rawGroups: BrowserSearchResultGroupSetting[]): BrowserSearchResult[] => {
    if (!enabled) return [];
    return getOrderedBrowserResults(rawInput, rawGroups, entriesRef.current, tabsRef.current, { useConfiguredLimits: true });
  }, [enabled]);

  const getAllResults = useCallback((rawInput: string, rawGroups: BrowserSearchResultGroupSetting[]): BrowserSearchResult[] => {
    if (!enabled) return [];
    return getOrderedBrowserResults(rawInput, rawGroups, entriesRef.current, tabsRef.current, { limitPerGroup: 50 });
  }, [enabled]);

  return useMemo(
    () => ({ enabled, getCompletion, getTopResult, getResults, getAllResults, getMatchKind, hasOpenTabMatch, executeBrowserSearch, resolve: resolveLocal }),
    [enabled, getCompletion, getTopResult, getResults, getAllResults, getMatchKind, hasOpenTabMatch, executeBrowserSearch]
  );
}

const URL_PROTOCOL_RE = /^[a-z][\w+.\-]*:\/\//i;
const LOCALHOST_RE = /^localhost(:\d+)?(\/.*)?$/i;
const IP_RE = /^\d{1,3}(?:\.\d{1,3}){3}(:\d+)?(\/.*)?$/;
const URL_BODY_RE = /^[\w.\-:/?#[\]@!$&'()*+,;=%~]+$/;

function resolveLocal(rawInput: string): ResolvedBrowserInput | null {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;
  if (URL_PROTOCOL_RE.test(trimmed)) return { type: 'url', url: trimmed, host: extractHost(trimmed) };
  const noSpaces = !/\s/.test(trimmed);
  const looksLikeUrl =
    noSpaces &&
    URL_BODY_RE.test(trimmed) &&
    (LOCALHOST_RE.test(trimmed) || IP_RE.test(trimmed) || /^[\w-]+(\.[\w-]+)+/.test(trimmed));
  if (looksLikeUrl) {
    const url = `https://${trimmed}`;
    return { type: 'url', url, host: extractHost(url) };
  }
  return { type: 'search', url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`, host: '' };
}

function extractHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function frecency(entry: BrowserSearchEntry): number {
  const ageDays = Math.max(0, (Date.now() - entry.lastUsedAt) / (24 * 60 * 60 * 1000));
  const recencyFactor = 1 / (1 + Math.log10(1 + ageDays));
  return entry.useCount * recencyFactor;
}

function tabFrecency(tab: BrowserTabEntry): number {
  const ageSeconds = Math.max(0, (Date.now() - tab.updatedAt) / 1000);
  return 1 / (1 + Math.log10(1 + ageSeconds));
}

function findOpenTabMatch(rawInput: string, tabs: BrowserTabEntry[]): BrowserTabEntry | null {
  const input = rawInput.trim();
  if (input.length < 2) return null;
  const lower = input.toLowerCase();
  const stripped = lower.replace(/^https?:\/\//, '');
  let best: { tab: BrowserTabEntry; score: number } | null = null;
  for (const tab of tabs) {
    const urlMatch = getOpenTabUrlMatch(tab, stripped, true);
    const titleScore = getOpenTabTitleMatchScore(tab, lower);
    if (!urlMatch && titleScore === null) continue;
    const score =
      (urlMatch ? 2000 : 0) +
      (titleScore || 0) +
      (tab.active ? 100 : 0) +
      tabFrecency(tab);
    if (!best || score > best.score) best = { tab, score };
  }
  return best?.tab || null;
}

function getOpenTabUrlMatch(tab: BrowserTabEntry, strippedInput: string, allowContains: boolean): string | null {
  const sourceUrl = tab.url || tab.host;
  if (!sourceUrl) return null;
  const fullStripped = sourceUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!fullStripped) return null;
  const lowerFull = fullStripped.toLowerCase();
  const candidates = lowerFull.startsWith('www.') ? [fullStripped, fullStripped.slice(4)] : [fullStripped];
  const prefix = candidates.find((candidate) =>
    candidate.length > strippedInput.length && candidate.toLowerCase().startsWith(strippedInput)
  );
  if (prefix) return prefix;
  if (allowContains && strippedInput.length >= 3 && lowerFull.includes(strippedInput)) return fullStripped;
  return null;
}

function getOpenTabTitleMatchScore(tab: BrowserTabEntry, lowerInput: string): number | null {
  if (tab.title.length <= lowerInput.length) return null;
  const title = tab.title.toLowerCase();
  if (title.startsWith(lowerInput)) return 2000 + (tab.active ? 100 : 0) + tabFrecency(tab);
  if (lowerInput.length >= 3 && title.includes(lowerInput)) return 1200 + (tab.active ? 100 : 0) + tabFrecency(tab);
  return null;
}

function getUrlPrefixMatch(entry: BrowserSearchEntry, strippedInput: string): string | null {
  const sourceUrl = entry.url || entry.host;
  if (!sourceUrl) return null;
  const fullStripped = sourceUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!fullStripped) return null;
  const candidates = fullStripped.toLowerCase().startsWith('www.')
    ? [fullStripped, fullStripped.slice(4)]
    : [fullStripped];
  return candidates.find((candidate) =>
    candidate.length > strippedInput.length && candidate.toLowerCase().startsWith(strippedInput)
  ) || null;
}

function getEntryUrlMatch(entry: BrowserSearchEntry, strippedInput: string): string | null {
  const prefix = getUrlPrefixMatch(entry, strippedInput);
  if (prefix) return prefix;
  const sourceUrl = entry.url || entry.host;
  const fullStripped = sourceUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (strippedInput.length >= 3 && fullStripped.toLowerCase().includes(strippedInput)) return fullStripped;
  return null;
}

function getEntryQueryMatchScore(entry: BrowserSearchEntry, lowerInput: string): number | null {
  const query = String(entry.query || '').toLowerCase();
  if (query.length <= lowerInput.length) return null;
  if (query.startsWith(lowerInput)) return 300;
  if (lowerInput.length >= 3 && query.includes(lowerInput)) return 120;
  return null;
}

function buildBrowserSubtitle(partA: string, partB: string, host: string): string {
  return [partA, partB, host].map((part) => String(part || '').trim()).filter(Boolean).join(' - ');
}

type BrowserCandidateOptions = {
  useConfiguredLimits?: boolean;
  limitPerGroup?: number;
  limit?: number;
};

const DEFAULT_RESULT_GROUPS: BrowserSearchResultGroupSetting[] = [
  { kind: 'bookmark', limit: 2 },
  { kind: 'open-tab', limit: 2 },
  { kind: 'history', limit: 2 },
];

function normalizeResultGroups(rawGroups: BrowserSearchResultGroupSetting[]): BrowserSearchResultGroupSetting[] {
  const seen = new Set<BrowserSearchResultKind>();
  const groups: BrowserSearchResultGroupSetting[] = [];
  if (Array.isArray(rawGroups)) {
    for (const group of rawGroups) {
      const kind = group?.kind;
      if (kind !== 'open-tab' && kind !== 'bookmark' && kind !== 'history') continue;
      if (seen.has(kind)) continue;
      seen.add(kind);
      groups.push({ kind, limit: Math.max(0, Math.min(8, Math.floor(Number(group.limit) || 0))) });
    }
  }
  for (const fallback of DEFAULT_RESULT_GROUPS) {
    if (!seen.has(fallback.kind)) groups.push(fallback);
  }
  return groups;
}

function getOrderedBrowserResults(
  rawInput: string,
  rawGroups: BrowserSearchResultGroupSetting[],
  entries: BrowserSearchEntry[],
  tabs: BrowserTabEntry[],
  options: BrowserCandidateOptions
): BrowserSearchResult[] {
  const input = rawInput.trim();
  if (input.length < 2) return [];
  const groups = normalizeResultGroups(rawGroups);
  const candidates = buildBrowserCandidates(input, entries, tabs);
  const claimedUrls = new Set<string>();
  const orderedResults: BrowserSearchResult[] = [];

  for (const group of groups) {
    const groupLimit = options.useConfiguredLimits
      ? group.limit
      : options.limitPerGroup ?? Number.MAX_SAFE_INTEGER;
    if (groupLimit <= 0) continue;
    let pickedCount = 0;
    for (const result of candidates[group.kind]) {
      const normalizedUrl = normalizeBrowserUrl(result.url);
      if (normalizedUrl && claimedUrls.has(normalizedUrl)) continue;
      orderedResults.push(result);
      pickedCount += 1;
      if (normalizedUrl) claimedUrls.add(normalizedUrl);
      if (orderedResults.length >= (options.limit ?? Number.MAX_SAFE_INTEGER)) return orderedResults;
      if (pickedCount >= groupLimit) break;
    }
  }

  return orderedResults;
}

function buildBrowserCandidates(
  input: string,
  entries: BrowserSearchEntry[],
  tabs: BrowserTabEntry[]
): Record<BrowserSearchResultKind, BrowserSearchResult[]> {
  const lower = input.toLowerCase();
  const stripped = lower.replace(/^https?:\/\//, '');

  const openTabs = tabs
    .map((tab): BrowserSearchResult | null => {
      const urlScore = getUrlMatchScore(tab.url || tab.host, stripped, true);
      const titleScore = getTitleMatchScore(tab.title, lower);
      if (urlScore === null && titleScore === null) return null;
      const matchScore = Math.max(urlScore?.score ?? 0, titleScore ?? 0);
      const score =
        matchScore +
        windowFocusBoost(tab.windowLastFocusedAt) +
        (tab.active ? 350 : 0) +
        tabFrecency(tab) * 140;
      return {
        id: `browser-result-open-tab:${tab.id}`,
        kind: 'open-tab',
        title: tab.title || tab.host || tab.url,
        subtitle: buildBrowserSubtitle(tab.browserName, tab.profileName, tab.host),
        url: tab.url,
        actionInput: tab.url,
        focusAvailable: true,
        score,
        completion: urlScore?.completion || '',
      };
    })
    .filter((result): result is BrowserSearchResult => Boolean(result))
    .sort(compareBrowserResults);

  const collectEntries = (kind: 'bookmark' | 'history'): BrowserSearchResult[] => {
    const entryType = kind === 'bookmark' ? 'bookmark' : 'url';
    const results: BrowserSearchResult[] = [];
    for (const entry of entries) {
      if (entry.type !== entryType) continue;
      const urlScore = getUrlMatchScore(entry.url || entry.host, stripped, true);
      const titleScore = getTitleMatchScore(entry.query, lower);
      if (urlScore === null && titleScore === null) continue;
      const matchScore = Math.max(urlScore?.score ?? 0, titleScore ?? 0);
      const recencyScore = recencyBoost(entry.lastUsedAt);
      const frequencyScore = Math.min(450, Math.log1p(Math.max(0, entry.useCount)) * 120);
      const score =
        matchScore +
        recencyScore +
        frequencyScore +
        (kind === 'bookmark' ? 250 : 0);
      results.push({
        id: `browser-result-${kind}:${entry.id}`,
        kind,
        title: entry.query || entry.host || entry.url,
        subtitle: buildBrowserSubtitle(entry.sourceProfileName || '', '', entry.host),
        url: entry.url,
        actionInput: entry.url,
        focusAvailable: false,
        score,
        completion: urlScore?.completion || '',
      });
    }
    return results.sort(compareBrowserResults);
  };

  return {
    'open-tab': openTabs,
    bookmark: collectEntries('bookmark'),
    history: collectEntries('history'),
  };
}

function compareBrowserResults(a: BrowserSearchResult, b: BrowserSearchResult): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.title.localeCompare(b.title);
}

function getUrlMatchScore(sourceUrl: string, strippedInput: string, allowContains: boolean): { score: number; completion: string } | null {
  const fullStripped = normalizeUrlForCompletion(sourceUrl);
  if (!fullStripped) return null;
  const lowerFull = fullStripped.toLowerCase();
  const candidates = lowerFull.startsWith('www.') ? [fullStripped, fullStripped.slice(4)] : [fullStripped];
  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase();
    if (lowerCandidate === strippedInput) return { score: 3600, completion: candidate };
    if (candidate.length > strippedInput.length && lowerCandidate.startsWith(strippedInput)) {
      const slashIndex = lowerCandidate.indexOf('/');
      const inputInHost = slashIndex < 0 || strippedInput.length <= slashIndex;
      return { score: inputInHost ? 3400 : 3000, completion: candidate };
    }
  }
  if (allowContains && strippedInput.length >= 3) {
    const index = lowerFull.indexOf(strippedInput);
    if (index >= 0) return { score: index === 0 ? 2600 : 1700, completion: '' };
  }
  return null;
}

function getTitleMatchScore(titleValue: string, lowerInput: string): number | null {
  const title = String(titleValue || '').trim().toLowerCase();
  if (!title) return null;
  if (title === lowerInput) return 2800;
  if (title.startsWith(lowerInput)) return 2400;
  if (lowerInput.length < 3) return null;
  const tokens = title.split(/[^a-z0-9]+/g).filter(Boolean);
  if (tokens.some((token) => token.startsWith(lowerInput))) return 2000;
  if (title.includes(lowerInput)) return 1200;
  return null;
}

function recencyBoost(lastUsedAt: number): number {
  const ageHours = Math.max(0, (Date.now() - lastUsedAt) / (60 * 60 * 1000));
  return 650 / (1 + Math.log10(1 + ageHours));
}

function windowFocusBoost(windowLastFocusedAt: number): number {
  if (!windowLastFocusedAt) return 0;
  const ageMinutes = Math.max(0, (Date.now() - windowLastFocusedAt) / (60 * 1000));
  return 900 / (1 + Math.log10(1 + ageMinutes));
}

function normalizeUrlForCompletion(sourceUrl: string): string {
  return String(sourceUrl || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function browserResultToEntry(result: BrowserSearchResult): BrowserSearchEntry {
  return {
    id: result.id,
    type: result.kind === 'bookmark' ? 'bookmark' : 'url',
    query: result.title,
    url: result.url,
    host: extractHost(result.url),
    lastUsedAt: Date.now(),
    useCount: 1,
    source: 'user',
  };
}

function normalizeBrowserUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return raw.toLowerCase().replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

function tabToBrowserSearchEntry(tab: BrowserTabEntry): BrowserSearchEntry {
  return {
    id: `tab:${tab.id}`,
    type: 'url',
    query: tab.title || tab.host || tab.url,
    url: tab.url,
    host: tab.host,
    lastUsedAt: tab.updatedAt,
    useCount: tab.active ? 2 : 1,
    source: tab.browserId as BrowserSearchSource,
    sourceProfileId: tab.profileId,
    sourceProfileName: tab.profileName,
  };
}
