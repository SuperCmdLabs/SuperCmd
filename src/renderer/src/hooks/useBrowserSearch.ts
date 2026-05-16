import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BrowserSearchAutocomplete,
  BrowserSearchEntry,
  BrowserSearchNicknameSetting,
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
  faviconUrl?: string;
  source?: BrowserSearchSource;
  sourceProfileId?: string;
  browserName?: string;
  profileName?: string;
  windowId?: string;
  tabId?: string;
  tabIndex?: number;
  windowLastFocusedAt?: number;
  active?: boolean;
  bookmarkFolder?: string;
  bookmarkOrder?: number;
  lastUsedAt?: number;
  score: number;
  completion: string;
  nickname?: string;
}

export interface BrowserHistoryProfileOption {
  id: string;
  label: string;
  count: number;
}

interface UseBrowserSearchResult {
  enabled: boolean;
  getCompletion: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchAutocomplete | null;
  getTopResult: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchResult | null;
  getResults: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchResult[];
  getAllResults: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchResult[];
  getOpenTabResults: (input: string) => BrowserSearchResult[];
  getBookmarkResults: (input: string) => BrowserSearchResult[];
  getHistoryResults: (input: string, profileIds?: string[] | null, showProfileContext?: boolean) => BrowserSearchResult[];
  getHistoryProfiles: () => BrowserHistoryProfileOption[];
  refreshOpenTabs: () => void;
  refreshBrowserEntries: () => void;
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
  const [nicknames, setNicknames] = useState<BrowserSearchNicknameSetting[]>([]);
  const entriesRef = useRef<BrowserSearchEntry[]>([]);
  const tabsRef = useRef<BrowserTabEntry[]>([]);
  const nicknamesRef = useRef<BrowserSearchNicknameSetting[]>([]);
  entriesRef.current = entries;
  tabsRef.current = tabs;
  nicknamesRef.current = nicknames;

  const refreshEntries = useCallback(() => {
    window.electron.browserSearchListEntries()
      .then((entryList) => {
        setEntries(Array.isArray(entryList) ? entryList : []);
      })
      .catch(() => {
        setEntries([]);
      });
  }, []);

  const refreshTabs = useCallback(() => {
    const listTabs = window.electron.browserTabsList;
    if (!listTabs) {
      setTabs([]);
      return;
    }
    listTabs()
      .then((tabList) => {
        setTabs(Array.isArray(tabList) ? tabList : []);
      })
      .catch(() => {
        setTabs([]);
      });
  }, []);

  useEffect(() => {
    let disposed = false;
    window.electron.getSettings()
      .then((s) => {
        if (disposed) return;
        setEnabled(s?.browserSearch?.enabled ?? true);
        setNicknames(Array.isArray(s?.browserSearch?.nicknames) ? s.browserSearch.nicknames : []);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((s) => {
      setEnabled(s?.browserSearch?.enabled ?? true);
      setNicknames(Array.isArray(s?.browserSearch?.nicknames) ? s.browserSearch.nicknames : []);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    refreshTabs();
    const unsubscribeTabs = window.electron.onBrowserTabsChanged?.(() => refreshTabs());
    return () => {
      try {
        unsubscribeTabs?.();
      } catch {}
    };
  }, [refreshTabs]);

  useEffect(() => {
    refreshEntries();
    const unsubscribe = window.electron.onBrowserSearchHistoryChanged?.(() => refreshEntries());
    return () => {
      try {
        unsubscribe?.();
      } catch {}
    };
  }, [refreshEntries]);

  const getTopResult = useCallback((rawInput: string, rawGroups: BrowserSearchResultGroupSetting[]): BrowserSearchResult | null => {
    if (!enabled) return null;
    return getRankedBrowserResults(rawInput, rawGroups, entriesRef.current, tabsRef.current, nicknamesRef.current, MAX_TOP_BROWSER_RESULTS)[0] || null;
  }, [enabled]);

  const getCompletion = useCallback((
    rawInput: string,
    rawGroups: BrowserSearchResultGroupSetting[]
  ): BrowserSearchAutocomplete | null => {
    if (!enabled) return null;
    const input = rawInput;
    if (!input.trim()) return null;
    if (/\s$/.test(input)) return null;
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
  }, []);

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
    return getOrderedBrowserResults(rawInput, rawGroups, entriesRef.current, tabsRef.current, nicknamesRef.current, { useConfiguredLimits: true });
  }, [enabled]);

  const getAllResults = useCallback((rawInput: string, rawGroups: BrowserSearchResultGroupSetting[]): BrowserSearchResult[] => {
    if (!enabled) return [];
    return getRankedBrowserResults(rawInput, rawGroups, entriesRef.current, tabsRef.current, nicknamesRef.current, MAX_ALL_BROWSER_RESULTS);
  }, [enabled]);

  const getOpenTabResults = useCallback((rawInput: string): BrowserSearchResult[] => {
    return getOpenTabCandidates(rawInput, tabsRef.current, { preserveBrowserOrder: true }).slice(0, MAX_SCOPED_OPEN_TAB_RESULTS);
  }, []);

  const getBookmarkResults = useCallback((rawInput: string): BrowserSearchResult[] => {
    return getBrowserEntryCandidates('bookmark', rawInput, entriesRef.current, {
      preserveBookmarkOrder: !rawInput.trim(),
      limit: MAX_SCOPED_BOOKMARK_RESULTS,
      nicknames: nicknamesRef.current,
    });
  }, []);

  const getHistoryResults = useCallback((
    rawInput: string,
    profileIds?: string[] | null,
    showProfileContext = false
  ): BrowserSearchResult[] => {
    return getBrowserEntryCandidates('history', rawInput, entriesRef.current, {
      preserveHistoryChronology: true,
      includeHistoryTimestamp: true,
      showHistoryProfileContext: showProfileContext,
      profileIds,
      limit: MAX_SCOPED_HISTORY_RESULTS,
    });
  }, []);

  const getHistoryProfiles = useCallback((): BrowserHistoryProfileOption[] => {
    const profileCounts = new Map<string, BrowserHistoryProfileOption>();
    for (const entry of entriesRef.current) {
      if (entry.type !== 'url') continue;
      const id = getEntryProfileKey(entry);
      const existing = profileCounts.get(id);
      if (existing) {
        existing.count += 1;
        continue;
      }
      profileCounts.set(id, {
        id,
        label: getEntryProfileLabel(entry),
        count: 1,
      });
    }
    return Array.from(profileCounts.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  return useMemo(
    () => ({ enabled, getCompletion, getTopResult, getResults, getAllResults, getOpenTabResults, getBookmarkResults, getHistoryResults, getHistoryProfiles, refreshOpenTabs: refreshTabs, refreshBrowserEntries: refreshEntries, getMatchKind, hasOpenTabMatch, executeBrowserSearch, resolve: resolveLocal }),
    [enabled, getCompletion, getTopResult, getResults, getAllResults, getOpenTabResults, getBookmarkResults, getHistoryResults, getHistoryProfiles, refreshTabs, refreshEntries, getMatchKind, hasOpenTabMatch, executeBrowserSearch]
  );
}

const MAX_SCOPED_HISTORY_RESULTS = 500;
const MAX_SCOPED_BOOKMARK_RESULTS = 500;
const MAX_SCOPED_OPEN_TAB_RESULTS = 500;
const MAX_TOP_BROWSER_RESULTS = 1;
const MAX_ALL_BROWSER_RESULTS = 100;
const PROVIDER_PRIORITY_SCORE_STEP = 120;
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

function tabFrecency(tab: BrowserTabEntry): number {
  const ageSeconds = Math.max(0, (Date.now() - tab.updatedAt) / 1000);
  return 1 / (1 + Math.log10(1 + ageSeconds));
}

function findOpenTabMatch(rawInput: string, tabs: BrowserTabEntry[]): BrowserTabEntry | null {
  const input = rawInput.trim();
  if (input.length < 2) return null;
  const lower = input.toLowerCase();
  const stripped = lower.replace(/^https?:\/\//, '');
  const queryTokens = getSearchTokens(input);
  let best: { tab: BrowserTabEntry; score: number } | null = null;
  for (const tab of tabs) {
    const urlMatch = getOpenTabUrlMatch(tab, stripped, true);
    const titleScore = getOpenTabTitleMatchScore(tab, lower);
    const tokenScore = getTokenMatchScore(queryTokens, getOpenTabSearchFields(tab));
    if (!urlMatch && titleScore === null && tokenScore === null) continue;
    const score =
      (urlMatch ? 2000 : 0) +
      (titleScore || 0) +
      (tokenScore || 0) +
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
  nicknames: BrowserSearchNicknameSetting[],
  options: BrowserCandidateOptions
): BrowserSearchResult[] {
  const input = rawInput.trim();
  if (input.length < 2) return [];
  const groups = normalizeResultGroups(rawGroups);
  const candidates = buildBrowserCandidates(input, entries, tabs, getActiveBookmarkNicknames(rawInput, nicknames));
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

function getRankedBrowserResults(
  rawInput: string,
  rawGroups: BrowserSearchResultGroupSetting[],
  entries: BrowserSearchEntry[],
  tabs: BrowserTabEntry[],
  nicknames: BrowserSearchNicknameSetting[],
  limit: number
): BrowserSearchResult[] {
  const input = rawInput.trim();
  if (input.length < 2) return [];
  const groups = normalizeResultGroups(rawGroups);
  const candidates = buildBrowserCandidates(input, entries, tabs, getActiveBookmarkNicknames(rawInput, nicknames));
  const priorityBoosts = getProviderPriorityBoosts(groups);
  const bestByUrl = new Map<string, { result: BrowserSearchResult; rankScore: number }>();

  for (const kind of Object.keys(candidates) as BrowserSearchResultKind[]) {
    for (const result of candidates[kind]) {
      const normalizedUrl = normalizeBrowserUrl(result.url) || result.id;
      const rankScore = result.score + (priorityBoosts.get(kind) || 0);
      const existing = bestByUrl.get(normalizedUrl);
      if (!existing || rankScore > existing.rankScore) {
        bestByUrl.set(normalizedUrl, { result, rankScore });
      }
    }
  }

  return Array.from(bestByUrl.values())
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      return compareBrowserResults(a.result, b.result);
    })
    .slice(0, limit)
    .map((item) => item.result);
}

function getProviderPriorityBoosts(groups: BrowserSearchResultGroupSetting[]): Map<BrowserSearchResultKind, number> {
  const boosts = new Map<BrowserSearchResultKind, number>();
  groups.forEach((group, index) => {
    boosts.set(group.kind, Math.max(0, groups.length - index - 1) * PROVIDER_PRIORITY_SCORE_STEP);
  });
  return boosts;
}

function getActiveBookmarkNicknames(rawInput: string, nicknames: BrowserSearchNicknameSetting[]): BrowserSearchNicknameSetting[] {
  const value = String(rawInput || '');
  if (/\s/.test(value.trim()) || /\s$/.test(value)) return [];
  return nicknames;
}

function buildBrowserCandidates(
  input: string,
  entries: BrowserSearchEntry[],
  tabs: BrowserTabEntry[],
  nicknames: BrowserSearchNicknameSetting[]
): Record<BrowserSearchResultKind, BrowserSearchResult[]> {
  const openTabs = getOpenTabCandidates(input, tabs);

  return {
    'open-tab': openTabs,
    bookmark: getBrowserEntryCandidates('bookmark', input, entries, { nicknames }),
    history: getBrowserEntryCandidates('history', input, entries),
  };
}

function getBrowserEntryCandidates(
  kind: 'bookmark' | 'history',
  input: string,
  entries: BrowserSearchEntry[],
  options: {
    preserveBookmarkOrder?: boolean;
    preserveHistoryChronology?: boolean;
    includeHistoryTimestamp?: boolean;
    showHistoryProfileContext?: boolean;
    profileIds?: string[] | null;
    limit?: number;
    nicknames?: BrowserSearchNicknameSetting[];
  } = {}
): BrowserSearchResult[] {
  const trimmed = input.trim();
  const hasQuery = trimmed.length > 0;
  const entryType = kind === 'bookmark' ? 'bookmark' : 'url';
  const profileFilter = options.profileIds ? new Set(options.profileIds) : null;
  const results: BrowserSearchResult[] = [];
  for (const entry of entries) {
    if (entry.type !== entryType) continue;
    if (kind === 'history' && profileFilter && !profileFilter.has(getEntryProfileKey(entry))) continue;
    const savedNickname = kind === 'bookmark'
      ? findBookmarkNickname(entry, options.nicknames || [])
      : '';
    const nicknameMatch = kind === 'bookmark' && hasQuery && !/\s/.test(trimmed)
      ? getBookmarkNicknameMatch(entry, trimmed, options.nicknames || [])
      : null;
    const searchInput = nicknameMatch ? nicknameMatch.remainingInput : trimmed;
    const lower = searchInput.toLowerCase();
    const stripped = lower.replace(/^https?:\/\//, '');
    const queryTokens = getSearchTokens(searchInput);
    const hasSearchInput = searchInput.length > 0;
    const urlScore = hasSearchInput ? getUrlMatchScore(entry.url || entry.host, stripped, true) : { score: 0, completion: '' };
    const titleScore = hasSearchInput ? getTitleMatchScore(entry.query, lower) : 0;
    const tokenScore = hasSearchInput ? getTokenMatchScore(queryTokens, getBrowserEntrySearchFields(entry)) : 0;
    if (!nicknameMatch && urlScore === null && titleScore === null && tokenScore === null) continue;
    if (nicknameMatch?.remainingInput && urlScore === null && titleScore === null && tokenScore === null) continue;
    const matchScore = Math.max(urlScore?.score ?? 0, titleScore ?? 0, tokenScore ?? 0);
    const nicknameScore = nicknameMatch
      ? nicknameMatch.remainingInput
        ? 4200 + matchScore * 0.2
        : 7000
      : 0;
    const matchQuality = getMatchQuality(urlScore?.score ?? 0, titleScore ?? 0, tokenScore ?? 0);
    const freshnessFactor = kind === 'history' ? getHistoryFreshnessFactor(entry.lastUsedAt) : 1;
    const adjustedMatchScore = getFreshnessAdjustedMatchScore(matchScore, matchQuality, freshnessFactor);
    const recencyScore = kind === 'history' ? freshnessFactor * 650 : 0;
    const frequencyScore = kind === 'history' ? getHistoryFrequencyScore(entry.useCount, freshnessFactor) : 0;
    const score =
      Math.max(adjustedMatchScore, nicknameScore) +
      recencyScore +
      frequencyScore +
      (kind === 'bookmark' ? 250 : 0);
    results.push({
      id: `browser-result-${kind}:${entry.id}`,
      kind,
      title: entry.query || entry.host || entry.url,
      subtitle: options.includeHistoryTimestamp && kind === 'history'
        ? buildHistorySubtitle(entry, Boolean(options.showHistoryProfileContext))
        : buildBrowserSubtitle(entry.sourceProfileName || '', '', entry.host),
      url: entry.url,
      actionInput: entry.url,
      focusAvailable: false,
      faviconUrl: getFaviconUrlForUrl(entry.url),
      source: entry.source,
      sourceProfileId: entry.sourceProfileId,
      browserName: getBrowserSourceLabel(entry.source),
      profileName: entry.sourceProfileName || entry.sourceProfileId,
      bookmarkFolder: entry.bookmarkFolder,
      bookmarkOrder: entry.bookmarkOrder,
      lastUsedAt: entry.lastUsedAt,
      score,
      completion: nicknameMatch?.completion || urlScore?.completion || '',
      nickname: nicknameMatch?.nickname || savedNickname,
    });
  }
  const sorted = options.preserveHistoryChronology
    ? results.sort(compareHistoryByTime)
    : results.sort(options.preserveBookmarkOrder ? compareBookmarksByBrowserOrder : compareBrowserResults);
  return options.limit && options.limit > 0 ? sorted.slice(0, options.limit) : sorted;
}

function compareBookmarksByBrowserOrder(a: BrowserSearchResult, b: BrowserSearchResult): number {
  const aOrder = Number.isFinite(Number(a.bookmarkOrder)) ? Number(a.bookmarkOrder) : Number.MAX_SAFE_INTEGER;
  const bOrder = Number.isFinite(Number(b.bookmarkOrder)) ? Number(b.bookmarkOrder) : Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.title.localeCompare(b.title);
}

function compareHistoryByTime(a: BrowserSearchResult, b: BrowserSearchResult): number {
  const aTime = Number.isFinite(Number(a.lastUsedAt)) ? Number(a.lastUsedAt) : 0;
  const bTime = Number.isFinite(Number(b.lastUsedAt)) ? Number(b.lastUsedAt) : 0;
  if (bTime !== aTime) return bTime - aTime;
  return a.title.localeCompare(b.title);
}

function buildHistorySubtitle(entry: BrowserSearchEntry, showProfileContext: boolean): string {
  const time = formatHistoryDateTime(entry.lastUsedAt);
  const context = showProfileContext
    ? buildBrowserSubtitle(entry.sourceProfileName || getBrowserSourceLabel(entry.source), '', entry.host)
    : entry.host;
  return context ? `${time} - ${context}` : time;
}

function formatHistoryDateTime(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function getBrowserSourceLabel(source: BrowserSearchSource): string {
  switch (source) {
    case 'helium': return 'Helium';
    case 'chrome': return 'Google Chrome';
    case 'arc': return 'Arc';
    case 'brave': return 'Brave';
    case 'edge': return 'Microsoft Edge';
    case 'vivaldi': return 'Vivaldi';
    case 'safari': return 'Safari';
    case 'firefox': return 'Firefox';
    default: return 'Browser';
  }
}

function getEntryProfileKey(entry: BrowserSearchEntry): string {
  return [
    entry.source || 'user',
    entry.sourceProfileId || entry.sourceProfileName || 'default',
  ].join(':');
}

function getEntryProfileLabel(entry: BrowserSearchEntry): string {
  const browserName = getBrowserSourceLabel(entry.source);
  const profileName = entry.sourceProfileName || entry.sourceProfileId;
  if (!profileName || profileName === 'default') return browserName;
  return `${browserName} - ${profileName}`;
}

function getOpenTabCandidates(
  input: string,
  tabs: BrowserTabEntry[],
  options: { preserveBrowserOrder?: boolean } = {}
): BrowserSearchResult[] {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  const stripped = lower.replace(/^https?:\/\//, '');
  const queryTokens = getSearchTokens(trimmed);
  const hasQuery = trimmed.length > 0;
  return tabs
    .map((tab): BrowserSearchResult | null => {
      const urlScore = hasQuery ? getUrlMatchScore(tab.url || tab.host, stripped, true) : { score: 0, completion: '' };
      const titleScore = hasQuery ? getTitleMatchScore(tab.title, lower) : 0;
      const tokenScore = hasQuery ? getTokenMatchScore(queryTokens, getOpenTabSearchFields(tab)) : 0;
      if (urlScore === null && titleScore === null && tokenScore === null) return null;
      const matchScore = Math.max(urlScore?.score ?? 0, titleScore ?? 0, tokenScore ?? 0);
      const matchQuality = getMatchQuality(urlScore?.score ?? 0, titleScore ?? 0, tokenScore ?? 0);
      const focusScore = windowFocusBoost(tab.windowLastFocusedAt);
      const tabFreshness = tabFrecency(tab);
      const freshnessFactor = Math.max(getOpenTabFocusFactor(tab.windowLastFocusedAt), tabFreshness);
      const adjustedMatchScore = getFreshnessAdjustedMatchScore(matchScore, matchQuality, freshnessFactor);
      const score =
        adjustedMatchScore +
        focusScore +
        (tab.active ? 350 : 0) +
        tabFreshness * 140;
      return {
        id: `browser-result-open-tab:${tab.id}`,
        kind: 'open-tab',
        title: tab.title || tab.host || tab.url,
        subtitle: buildBrowserSubtitle(tab.browserName, tab.profileName, tab.host),
        url: tab.url,
        actionInput: tab.url,
        focusAvailable: true,
        faviconUrl: normalizeFaviconUrl(tab.favIconUrl, tab.url),
        browserName: tab.browserName,
        profileName: tab.profileName,
        windowId: tab.windowId,
        tabId: tab.tabId,
        tabIndex: tab.tabIndex,
        windowLastFocusedAt: tab.windowLastFocusedAt,
        active: tab.active,
        score,
        completion: urlScore?.completion || '',
      };
    })
    .filter((result): result is BrowserSearchResult => Boolean(result))
    .sort(options.preserveBrowserOrder ? compareOpenTabsByBrowserOrder : compareBrowserResults);
}

function compareOpenTabsByBrowserOrder(a: BrowserSearchResult, b: BrowserSearchResult): number {
  const aFocusedAt = a.windowLastFocusedAt || 0;
  const bFocusedAt = b.windowLastFocusedAt || 0;
  if (bFocusedAt !== aFocusedAt) return bFocusedAt - aFocusedAt;
  const browserCompare = String(a.browserName || '').localeCompare(String(b.browserName || ''));
  if (browserCompare !== 0) return browserCompare;
  const profileCompare = String(a.profileName || '').localeCompare(String(b.profileName || ''));
  if (profileCompare !== 0) return profileCompare;
  const windowCompare = compareIdentifier(String(a.windowId || ''), String(b.windowId || ''));
  if (windowCompare !== 0) return windowCompare;
  const aIndex = Number.isFinite(Number(a.tabIndex)) ? Number(a.tabIndex) : 0;
  const bIndex = Number.isFinite(Number(b.tabIndex)) ? Number(b.tabIndex) : 0;
  if (aIndex !== bIndex) return aIndex - bIndex;
  return compareIdentifier(String(a.tabId || ''), String(b.tabId || ''));
}

function compareIdentifier(a: string, b: string): number {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
    return aNumber - bNumber;
  }
  return a.localeCompare(b);
}

function normalizeFaviconUrl(faviconUrl: string | undefined, pageUrl: string): string {
  const clean = String(faviconUrl || '').trim();
  if (/^(https?:|data:image\/)/i.test(clean)) return clean;
  return getFaviconUrlForUrl(pageUrl);
}

function getFaviconUrlForUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`;
  } catch {
    return '';
  }
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

type TokenSearchField = {
  value: string | undefined;
  weight: number;
};

type BookmarkNicknameMatch = {
  nickname: string;
  completion: string;
  remainingInput: string;
};

function getBookmarkNicknameMatch(
  entry: BrowserSearchEntry,
  input: string,
  nicknames: BrowserSearchNicknameSetting[]
): BookmarkNicknameMatch | null {
  const parsed = parseNicknameQuery(input);
  if (!parsed.firstToken) return null;
  const nickname = findBookmarkNickname(entry, nicknames);
  if (!nickname) return null;
  const normalizedNickname = normalizeNicknameToken(nickname);
  const normalizedToken = normalizeNicknameToken(parsed.firstToken);
  if (!normalizedNickname.startsWith(normalizedToken)) return null;
  return {
    nickname,
    completion: parsed.remainingInput ? '' : nickname,
    remainingInput: parsed.remainingInput,
  };
}

function findBookmarkNickname(entry: BrowserSearchEntry, nicknames: BrowserSearchNicknameSetting[]): string {
  const entrySource = String(entry.source || '');
  const entryProfileId = String(entry.sourceProfileId || '');
  const entryUrl = normalizeNicknameUrl(entry.url);
  const match = nicknames.find((item) =>
    String(item.source || '') === entrySource &&
    String(item.sourceProfileId || '') === entryProfileId &&
    normalizeNicknameUrl(item.url) === entryUrl
  );
  return String(match?.nickname || '').trim();
}

function parseNicknameQuery(input: string): { firstToken: string; remainingInput: string } {
  const trimmed = String(input || '').trim();
  if (!trimmed) return { firstToken: '', remainingInput: '' };
  const match = trimmed.match(/^(\S+)(?:\s+(.*))?$/);
  return {
    firstToken: match?.[1] || '',
    remainingInput: String(match?.[2] || '').trim(),
  };
}

function normalizeNicknameToken(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeNicknameUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return String(value || '').trim().toLowerCase().replace(/\/+$/, '');
  }
}

function getBrowserEntrySearchFields(entry: BrowserSearchEntry): TokenSearchField[] {
  return [
    { value: entry.query, weight: 1.15 },
    { value: entry.url, weight: 1 },
    { value: entry.host, weight: 1 },
    { value: entry.bookmarkFolder, weight: 0.65 },
    { value: entry.sourceProfileName || entry.sourceProfileId, weight: 0.35 },
    { value: getBrowserSourceLabel(entry.source), weight: 0.3 },
  ];
}

function getOpenTabSearchFields(tab: BrowserTabEntry): TokenSearchField[] {
  return [
    { value: tab.title, weight: 1.15 },
    { value: tab.url, weight: 1 },
    { value: tab.host, weight: 1 },
    { value: tab.profileName, weight: 0.35 },
    { value: tab.browserName, weight: 0.3 },
  ];
}

function getSearchTokens(input: string): string[] {
  const normalized = normalizeForTokenSearch(input.replace(/^https?:\/\//i, ''));
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of normalized.split(' ')) {
    if (token.length < 2 || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function getTokenMatchScore(queryTokens: string[], fields: TokenSearchField[]): number | null {
  if (queryTokens.length === 0) return null;
  let total = 0;
  for (const queryToken of queryTokens) {
    let bestTokenScore = 0;
    for (const field of fields) {
      const fieldValue = normalizeForTokenSearch(field.value || '');
      if (!fieldValue) continue;
      const score = getSingleTokenMatchScore(queryToken, fieldValue);
      const weightedScore = score * field.weight;
      if (weightedScore > bestTokenScore) bestTokenScore = weightedScore;
    }
    if (bestTokenScore <= 0) return null;
    total += bestTokenScore;
  }
  return Math.min(2300, total + queryTokens.length * 180);
}

function getSingleTokenMatchScore(queryToken: string, fieldValue: string): number {
  if (fieldValue === queryToken) return 1350;
  if (fieldValue.startsWith(`${queryToken} `)) return 1200;
  if (fieldValue.startsWith(queryToken)) return 1050;
  const boundaryIndex = fieldValue.indexOf(` ${queryToken}`);
  if (boundaryIndex >= 0) {
    const afterToken = fieldValue[boundaryIndex + queryToken.length + 1];
    return afterToken === undefined || afterToken === ' ' ? 1000 : 800;
  }
  if (queryToken.length >= 3 && fieldValue.includes(queryToken)) return 620;
  return 0;
}

function normalizeForTokenSearch(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\bwww\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMatchQuality(urlScore: number, titleScore: number, tokenScore: number): number {
  const bestScore = Math.max(urlScore, titleScore, tokenScore);
  if (bestScore >= 3000) return 1;
  if (bestScore >= 2400) return 0.94;
  if (bestScore >= 2000) return 0.84;
  if (bestScore >= 1700) return 0.74;
  if (bestScore >= 1200) return 0.62;
  return 0.5;
}

function getFreshnessAdjustedMatchScore(matchScore: number, matchQuality: number, freshnessFactor: number): number {
  const freshness = clampNumber(freshnessFactor, 0.1, 1);
  if (matchQuality >= 0.9) return matchScore;
  const staleFloor = 0.58 + matchQuality * 0.24;
  return matchScore * (staleFloor + (1 - staleFloor) * freshness);
}

function getHistoryFreshnessFactor(lastUsedAt: number): number {
  if (!lastUsedAt) return 0.1;
  const ageDays = Math.max(0, (Date.now() - lastUsedAt) / (24 * 60 * 60 * 1000));
  if (ageDays <= 4) return 1;
  if (ageDays <= 14) return interpolate(ageDays, 4, 14, 1, 0.7);
  if (ageDays <= 31) return interpolate(ageDays, 14, 31, 0.7, 0.5);
  if (ageDays <= 90) return interpolate(ageDays, 31, 90, 0.5, 0.3);
  if (ageDays <= 365) return interpolate(ageDays, 90, 365, 0.3, 0.1);
  return 0.1;
}

function getHistoryFrequencyScore(useCount: number, freshnessFactor: number): number {
  const frequency = Math.max(0, useCount);
  const recencyWeightedCount = Math.log1p(frequency) * (0.45 + 0.55 * clampNumber(freshnessFactor, 0.1, 1));
  return Math.min(550, recencyWeightedCount * 150);
}

function getOpenTabFocusFactor(windowLastFocusedAt: number): number {
  if (!windowLastFocusedAt) return 0.25;
  const ageMinutes = Math.max(0, (Date.now() - windowLastFocusedAt) / (60 * 1000));
  if (ageMinutes <= 10) return 1;
  if (ageMinutes <= 60) return interpolate(ageMinutes, 10, 60, 1, 0.75);
  if (ageMinutes <= 24 * 60) return interpolate(ageMinutes, 60, 24 * 60, 0.75, 0.35);
  if (ageMinutes <= 7 * 24 * 60) return interpolate(ageMinutes, 24 * 60, 7 * 24 * 60, 0.35, 0.15);
  return 0.15;
}

function interpolate(value: number, minValue: number, maxValue: number, minScore: number, maxScore: number): number {
  if (maxValue <= minValue) return maxScore;
  const progress = clampNumber((value - minValue) / (maxValue - minValue), 0, 1);
  return minScore + (maxScore - minScore) * progress;
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
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
