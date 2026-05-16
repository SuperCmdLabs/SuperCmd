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
}

interface UseBrowserSearchResult {
  enabled: boolean;
  getCompletion: (input: string) => BrowserSearchAutocomplete | null;
  getResults: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchResult[];
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

  const getCompletion = useCallback((rawInput: string): BrowserSearchAutocomplete | null => {
    if (!enabled) return null;
    const input = rawInput;
    if (!input.trim()) return null;
    const list = entriesRef.current;
    const tabList = tabsRef.current;

    const lower = input.toLowerCase();
    const stripped = lower.replace(/^https?:\/\//, '');
    const protocolPrefix = lower !== stripped ? input.slice(0, input.length - stripped.length) : '';

    // Pass 1: URL completion. Match against the full URL after the protocol
    // (host + path + query), so frequent deep links like `github.com/shobhit99`
    // surface instead of just the bare host. Also try the `www.`-stripped form.
    let bestUrl: { entry: BrowserSearchEntry; matched: string; score: number } | null = null;
    for (const tab of tabList) {
      const tabEntry = tabToBrowserSearchEntry(tab);
      const match = getOpenTabUrlMatch(tab, stripped, false);
      if (!match) continue;
      const score = 2000 + (tab.active ? 100 : 0) + tabFrecency(tab);
      if (!bestUrl || score > bestUrl.score) bestUrl = { entry: tabEntry, matched: match, score };
    }

    for (const entry of list) {
      if (entry.type !== 'url' && entry.type !== 'bookmark') continue;
      const match = getUrlPrefixMatch(entry, stripped);
      if (!match) continue;
      const score = frecency(entry);
      if (!bestUrl || score > bestUrl.score) bestUrl = { entry, matched: match, score };
    }
    if (bestUrl) {
      const completion = input + bestUrl.matched.slice(stripped.length);
      return {
        completion,
        suffix: completion.slice(input.length),
        entry: bestUrl.entry,
      };
    }

    // Pass 2: bookmark-title and search query prefix.
    let bestSearch: { entry: BrowserSearchEntry; score: number } | null = null;
    for (const tab of tabList) {
      const score = getOpenTabTitleMatchScore(tab, lower);
      if (score === null) continue;
      if (!bestSearch || score > bestSearch.score) {
        bestSearch = { entry: tabToBrowserSearchEntry(tab), score };
      }
    }
    for (const entry of list) {
      if (entry.type !== 'search' && entry.type !== 'bookmark') continue;
      if (entry.query.length <= input.length) continue;
      if (!entry.query.toLowerCase().startsWith(lower)) continue;
      const score = frecency(entry);
      if (!bestSearch || score > bestSearch.score) bestSearch = { entry, score };
    }
    if (bestSearch) {
      const completion = input + bestSearch.entry.query.slice(input.length);
      return {
        completion,
        suffix: completion.slice(input.length),
        entry: bestSearch.entry,
      };
    }

    return null;
  }, [enabled]);

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
    const input = rawInput.trim();
    if (input.length < 2) return [];
    const groups = normalizeResultGroups(rawGroups);
    const lower = input.toLowerCase();
    const stripped = lower.replace(/^https?:\/\//, '');

    const openTabCandidates = tabsRef.current
      .map((tab): BrowserSearchResult | null => {
        const urlMatch = getOpenTabUrlMatch(tab, stripped, true);
        const titleScore = getOpenTabTitleMatchScore(tab, lower);
        if (!urlMatch && titleScore === null) return null;
        const score =
          3000 +
          (urlMatch ? 200 : 0) +
          (titleScore || 0) +
          (tab.active ? 100 : 0) +
          tabFrecency(tab);
        return {
          id: `browser-result-open-tab:${tab.id}`,
          kind: 'open-tab',
          title: tab.title || tab.host || tab.url,
          subtitle: buildBrowserSubtitle(tab.browserName, tab.profileName, tab.host),
          url: tab.url,
          actionInput: tab.url,
          focusAvailable: true,
          score,
        };
      })
      .filter((result): result is BrowserSearchResult => Boolean(result))
      .sort((a, b) => b.score - a.score);

    const collectEntryResults = (kind: 'bookmark' | 'history'): BrowserSearchResult[] => {
      const entryType = kind === 'bookmark' ? 'bookmark' : 'url';
      const results: BrowserSearchResult[] = [];
      for (const entry of entriesRef.current) {
        if (entry.type !== entryType) continue;
        const urlMatch = getEntryUrlMatch(entry, stripped);
        const queryScore = getEntryQueryMatchScore(entry, lower);
        if (!urlMatch && queryScore === null) continue;
        const score = (kind === 'bookmark' ? 2000 : 1000) + (urlMatch ? 200 : 0) + (queryScore || 0) + frecency(entry);
        results.push({
          id: `browser-result-${kind}:${entry.id}`,
          kind,
          title: entry.query || entry.host || entry.url,
          subtitle: buildBrowserSubtitle(entry.sourceProfileName || '', '', entry.host),
          url: entry.url,
          actionInput: entry.url,
          focusAvailable: false,
          score,
        });
      }
      return results.sort((a, b) => b.score - a.score);
    };
    const candidates: Record<BrowserSearchResultKind, BrowserSearchResult[]> = {
      'open-tab': openTabCandidates,
      bookmark: collectEntryResults('bookmark'),
      history: collectEntryResults('history'),
    };

    const claimedUrls = new Set<string>();
    const orderedResults: BrowserSearchResult[] = [];
    for (const group of groups) {
      if (group.limit <= 0) continue;
      const picked: BrowserSearchResult[] = [];
      for (const result of candidates[group.kind]) {
        const normalizedUrl = normalizeBrowserUrl(result.url);
        if (normalizedUrl && claimedUrls.has(normalizedUrl)) continue;
        picked.push(result);
        if (normalizedUrl) claimedUrls.add(normalizedUrl);
        if (picked.length >= group.limit) break;
      }
      orderedResults.push(...picked);
    }
    return orderedResults;
  }, [enabled]);

  return useMemo(
    () => ({ enabled, getCompletion, getResults, getMatchKind, hasOpenTabMatch, executeBrowserSearch, resolve: resolveLocal }),
    [enabled, getCompletion, getResults, getMatchKind, hasOpenTabMatch, executeBrowserSearch]
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

const DEFAULT_RESULT_GROUPS: BrowserSearchResultGroupSetting[] = [
  { kind: 'open-tab', limit: 2 },
  { kind: 'bookmark', limit: 2 },
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
