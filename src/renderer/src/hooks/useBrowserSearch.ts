import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BrowserSearchAutocomplete,
  BrowserSearchEntry,
  BrowserSearchNicknameSetting,
  BrowserOpenProfileEvent,
  BrowserProfileFilters,
  BrowserProfileSetting,
  BrowserSearchResultGroupSetting,
  BrowserSearchResultKind,
  BrowserSearchSource,
  BrowserTabEntry,
} from '../../types/electron';
import {
  resolveBrowserInput,
  type BrowserInputResolution,
} from '../utils/browser-input-resolver';
import type { MatchKind } from '../utils/root-search-ranking';

export type ResolvedBrowserInput = BrowserInputResolution;

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
  windowOrdinal?: number;
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
  nicknameMatch?: boolean;
  profileLabel?: string;
  matchKind?: MatchKind;
  rawMatchScore?: number;
}

export interface BrowserHistoryProfileOption {
  id: string;
  label: string;
  browserName?: string;
  browserId?: BrowserSearchSource;
  count: number;
}

interface UseBrowserSearchResult {
  enabled: boolean;
  alphaChromiumRootSearchEnabled: boolean;
  getCompletion: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchAutocomplete | null;
  getTopResult: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchResult | null;
  getResults: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchResult[];
  getAllResults: (input: string, resultGroups: BrowserSearchResultGroupSetting[]) => BrowserSearchResult[];
  getOpenTabResults: (input: string, limit?: number) => BrowserSearchResult[];
  getBookmarkResults: (input: string, limit?: number) => BrowserSearchResult[];
  getHistoryResults: (input: string, profileIds?: string[] | null, showProfileContext?: boolean, limit?: number) => BrowserSearchResult[];
  getHistoryProfiles: () => BrowserHistoryProfileOption[];
  getProfileFilterOptions: (kind: BrowserSearchResultKind) => BrowserHistoryProfileOption[];
  profiles: BrowserProfileSetting[];
  profileFilters: BrowserProfileFilters;
  refreshOpenTabs: () => void;
  refreshBrowserEntries: () => void;
  refreshBrowserEntriesIfStale: () => void;
  getMatchKind: (input: string, completion?: BrowserSearchAutocomplete | null) => 'open-tab' | 'history' | 'search';
  hasOpenTabMatch: (input: string) => boolean;
  executeBrowserSearch: (input: string, options?: BrowserSearchExecuteOptions) => Promise<boolean>;
  /** Synchronous URL/search detection — returns null for empty input. */
  resolve: (input: string) => ResolvedBrowserInput | null;
}

export type BrowserSearchExecuteOptions = {
  focusExistingTab?: boolean;
  event?: BrowserOpenProfileEvent;
  kind?: BrowserSearchResultKind | 'search' | 'url';
  url?: string;
  sourceProfileId?: string;
  openInSourceProfile?: boolean;
  windowId?: string | number;
  tabId?: string | number;
};

export function useBrowserSearch(_currentQuery: string): UseBrowserSearchResult {
  const [entries, setEntries] = useState<BrowserSearchEntry[]>([]);
  const [tabs, setTabs] = useState<BrowserTabEntry[]>([]);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [alphaChromiumRootSearchEnabled, setAlphaChromiumRootSearchEnabled] = useState<boolean>(false);
  const [nicknames, setNicknames] = useState<BrowserSearchNicknameSetting[]>([]);
  const [profiles, setProfiles] = useState<BrowserProfileSetting[]>([]);
  const [profileFilters, setProfileFilters] = useState<BrowserProfileFilters>({});
  const entriesRef = useRef<BrowserSearchEntry[]>([]);
  const tabsRef = useRef<BrowserTabEntry[]>([]);
  const nicknamesRef = useRef<BrowserSearchNicknameSetting[]>([]);
  const profilesRef = useRef<BrowserProfileSetting[]>([]);
  const profileFiltersRef = useRef<BrowserProfileFilters>({});
  const entryIndexRef = useRef<BrowserEntryIndex | null>(null);
  const entriesRevisionRef = useRef<number | null>(null);
  entriesRef.current = entries;
  tabsRef.current = tabs;
  nicknamesRef.current = nicknames;
  profilesRef.current = profiles;
  profileFiltersRef.current = profileFilters;
  entryIndexRef.current = useMemo(() => buildBrowserEntryIndex(entries), [entries]);

  const applyBrowserEntryPayload = useCallback((payload: BrowserSearchEntry[] | { revision?: number; entries?: BrowserSearchEntry[] }) => {
    const nextRevision = Array.isArray(payload) ? null : Number(payload?.revision);
    const nextEntries = Array.isArray(payload) ? payload : Array.isArray(payload?.entries) ? payload.entries : [];
    if (Number.isFinite(nextRevision)) {
      if (entriesRevisionRef.current === nextRevision) return;
      entriesRevisionRef.current = nextRevision;
    }
    setEntries(nextEntries);
  }, []);

  const refreshEntries = useCallback(() => {
    window.electron.browserSearchListEntries()
      .then((entryList) => {
        applyBrowserEntryPayload(entryList);
      })
      .catch(() => {
        setEntries([]);
      });
  }, [applyBrowserEntryPayload]);

  const refreshEntriesIfStale = useCallback(() => {
    const getRevision = window.electron.browserSearchRevision;
    if (!getRevision) {
      refreshEntries();
      return;
    }
    getRevision()
      .then((revision) => {
        if (entriesRevisionRef.current === revision) return;
        refreshEntries();
      })
      .catch(() => {
        refreshEntries();
      });
  }, [refreshEntries]);

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
        setAlphaChromiumRootSearchEnabled(Boolean(s?.browserSearch?.alphaChromiumRootSearchEnabled));
        setNicknames(Array.isArray(s?.browserSearch?.nicknames) ? s.browserSearch.nicknames : []);
        setProfiles(normalizeBrowserProfiles(s?.browserSearch?.profiles));
        setProfileFilters(s?.browserSearch?.profileFilters || {});
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((s) => {
      setEnabled(s?.browserSearch?.enabled ?? true);
      setAlphaChromiumRootSearchEnabled(Boolean(s?.browserSearch?.alphaChromiumRootSearchEnabled));
      setNicknames(Array.isArray(s?.browserSearch?.nicknames) ? s.browserSearch.nicknames : []);
      setProfiles(normalizeBrowserProfiles(s?.browserSearch?.profiles));
      setProfileFilters(s?.browserSearch?.profileFilters || {});
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
    const unsubscribe = window.electron.onBrowserSearchHistoryChanged?.(() => refreshEntriesIfStale());
    return () => {
      try {
        unsubscribe?.();
      } catch {}
    };
  }, [refreshEntries, refreshEntriesIfStale]);

  const getTopResult = useCallback((rawInput: string, rawGroups: BrowserSearchResultGroupSetting[]): BrowserSearchResult | null => {
    if (!enabled || !alphaChromiumRootSearchEnabled) return null;
    return filterBrowserResults(
      decorateBrowserResults(getRankedBrowserResults(rawInput, rawGroups, entriesRef.current, entryIndexRef.current, tabsRef.current, nicknamesRef.current, MAX_TOP_BROWSER_RESULTS), profilesRef.current),
      profileFiltersRef.current,
      profilesRef.current
    )[0] || null;
  }, [enabled, alphaChromiumRootSearchEnabled]);

  const getCompletion = useCallback((
    rawInput: string,
    rawGroups: BrowserSearchResultGroupSetting[]
  ): BrowserSearchAutocomplete | null => {
    if (!enabled) return null;
    const input = rawInput;
    if (!input.trim()) return null;
    if (!alphaChromiumRootSearchEnabled) return getLegacyCompletion(input, entriesRef.current);
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
  }, [enabled, alphaChromiumRootSearchEnabled, getTopResult]);

  const executeBrowserSearch = useCallback(async (
    input: string,
    options?: BrowserSearchExecuteOptions
  ): Promise<boolean> => {
    const trimmed = input.trim();
    if (!trimmed) return false;
    try {
      if (!alphaChromiumRootSearchEnabled) {
        const result = await window.electron.browserSearchOpen(trimmed);
        return Boolean(result?.ok);
      }
      if (options?.focusExistingTab && options.sourceProfileId && options.windowId !== undefined && options.tabId !== undefined) {
        const focusResult = await window.electron.browserTabsFocusTarget?.({
          profileSourceId: options.sourceProfileId,
          windowId: options.windowId,
          tabId: options.tabId,
        });
        if (focusResult?.ok) return true;
      }
      if (options?.focusExistingTab) {
        const focusResult = await window.electron.browserTabsFocus?.(trimmed);
        if (focusResult?.ok) return true;
      }
      if (options?.url) {
        const result = await window.electron.browserTabsOpenUrlProfile?.(options.url, {
          event: options.event,
          sourceProfileId: options.openInSourceProfile ? options.sourceProfileId : null,
        });
        return Boolean(result?.ok);
      }
      const result = await window.electron.browserSearchOpenProfile?.(trimmed, {
        event: options?.event,
        sourceProfileId: options?.openInSourceProfile ? options.sourceProfileId : null,
      }) ?? await window.electron.browserSearchOpen(trimmed);
      return Boolean(result?.ok);
    } catch (e) {
      console.error('Browser search open failed:', e);
      return false;
    }
  }, [alphaChromiumRootSearchEnabled]);

  const hasOpenTabMatch = useCallback((rawInput: string): boolean => {
    if (!enabled || !alphaChromiumRootSearchEnabled) return false;
    return Boolean(findOpenTabMatch(rawInput, tabsRef.current));
  }, [enabled, alphaChromiumRootSearchEnabled]);

  const getMatchKind = useCallback((
    input: string,
    completion?: BrowserSearchAutocomplete | null
  ): 'open-tab' | 'history' | 'search' => {
    if (!enabled) return 'search';
    const completionEntryId = String(completion?.entry?.id || '');
    if (alphaChromiumRootSearchEnabled) {
      if (completionEntryId.startsWith('tab:')) return 'open-tab';
      if (findOpenTabMatch(input, tabsRef.current)) return 'open-tab';
    }
    const resolved = resolveLocal(input);
    return resolved?.type === 'url' ? 'history' : 'search';
  }, [enabled, alphaChromiumRootSearchEnabled]);

  const getResults = useCallback((rawInput: string, rawGroups: BrowserSearchResultGroupSetting[]): BrowserSearchResult[] => {
    if (!enabled || !alphaChromiumRootSearchEnabled) return [];
    return filterBrowserResults(
      decorateBrowserResults(getOrderedBrowserResults(rawInput, rawGroups, entriesRef.current, entryIndexRef.current, tabsRef.current, nicknamesRef.current, { useConfiguredLimits: true }), profilesRef.current),
      profileFiltersRef.current,
      profilesRef.current
    );
  }, [enabled, alphaChromiumRootSearchEnabled]);

  const getAllResults = useCallback((rawInput: string, rawGroups: BrowserSearchResultGroupSetting[]): BrowserSearchResult[] => {
    if (!enabled || !alphaChromiumRootSearchEnabled) return [];
    return filterBrowserResults(
      decorateBrowserResults(getRankedBrowserResults(rawInput, rawGroups, entriesRef.current, entryIndexRef.current, tabsRef.current, nicknamesRef.current, MAX_ALL_BROWSER_RESULTS), profilesRef.current),
      profileFiltersRef.current,
      profilesRef.current
    );
  }, [enabled, alphaChromiumRootSearchEnabled]);

  const getOpenTabResults = useCallback((rawInput: string, limit = MAX_SCOPED_OPEN_TAB_RESULTS): BrowserSearchResult[] => {
    const candidates = getOpenTabCandidates(rawInput, tabsRef.current, { preserveBrowserOrder: true });
    const boundedCandidates = limit > 0 ? candidates.slice(0, limit) : candidates;
    return filterBrowserResultsForKind(
      'open-tab',
      decorateBrowserResults(boundedCandidates, profilesRef.current),
      profileFiltersRef.current,
      profilesRef.current
    );
  }, []);

  const getBookmarkResults = useCallback((rawInput: string, limit = MAX_SCOPED_BOOKMARK_RESULTS): BrowserSearchResult[] => {
    const index = entryIndexRef.current;
    return filterBrowserResultsForKind('bookmark', decorateBrowserResults(getBrowserEntryCandidates('bookmark', rawInput, entriesRef.current, {
      preserveBookmarkOrder: !rawInput.trim(),
      limit,
      nicknames: nicknamesRef.current,
      candidateEntryIds: rawInput.trim() ? undefined : index?.bookmarksByBrowserOrderEntryIds,
    }), profilesRef.current), profileFiltersRef.current, profilesRef.current);
  }, []);

  const getHistoryResults = useCallback((
    rawInput: string,
    profileIds?: string[] | null,
    showProfileContext = false,
    limit = MAX_SCOPED_HISTORY_RESULTS
  ): BrowserSearchResult[] => {
    const index = entryIndexRef.current;
    return filterBrowserResultsForKind('history', decorateBrowserResults(getBrowserEntryCandidates('history', rawInput, entriesRef.current, {
      preserveHistoryChronology: true,
      includeHistoryTimestamp: true,
      showHistoryProfileContext: showProfileContext,
      profileIds,
      limit,
      candidateEntryIds: rawInput.trim() ? undefined : index?.historyByTimeEntryIds,
    }), profilesRef.current), profileFiltersRef.current, profilesRef.current);
  }, []);

  const getHistoryProfiles = useCallback((): BrowserHistoryProfileOption[] => {
    const counts = entryIndexRef.current?.profileCountsByKind.history || new Map<string, number>();
    return profilesRef.current
      .map((profile) => ({
        id: profile.id,
        label: getProfileLabel(profile),
        browserName: profile.browserName,
        browserId: profile.browserId,
        count: counts.get(profile.id) || 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const getProfileFilterOptions = useCallback((kind: BrowserSearchResultKind): BrowserHistoryProfileOption[] => {
    const counts = new Map<string, number>();
    if (kind === 'open-tab') {
      for (const tab of tabsRef.current) {
        if (!tab.profileSourceId) continue;
        counts.set(tab.profileSourceId, (counts.get(tab.profileSourceId) || 0) + 1);
      }
    } else {
      const indexCounts = kind === 'bookmark'
        ? entryIndexRef.current?.profileCountsByKind.bookmark
        : entryIndexRef.current?.profileCountsByKind.history;
      if (indexCounts) {
        for (const [id, count] of indexCounts) counts.set(id, count);
      }
    }
    const configured: BrowserHistoryProfileOption[] = profilesRef.current.map((profile) => ({
      id: profile.id,
      label: getProfileLabel(profile),
      browserName: profile.browserName,
      browserId: profile.browserId,
      count: counts.get(profile.id) || 0,
    }));
    return configured.sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  return useMemo(
    () => ({ enabled, alphaChromiumRootSearchEnabled, getCompletion, getTopResult, getResults, getAllResults, getOpenTabResults, getBookmarkResults, getHistoryResults, getHistoryProfiles, getProfileFilterOptions, profiles, profileFilters, refreshOpenTabs: refreshTabs, refreshBrowserEntries: refreshEntries, refreshBrowserEntriesIfStale: refreshEntriesIfStale, getMatchKind, hasOpenTabMatch, executeBrowserSearch, resolve: resolveLocal }),
    [enabled, alphaChromiumRootSearchEnabled, getCompletion, getTopResult, getResults, getAllResults, getOpenTabResults, getBookmarkResults, getHistoryResults, getHistoryProfiles, getProfileFilterOptions, profiles, profileFilters, refreshTabs, refreshEntries, refreshEntriesIfStale, getMatchKind, hasOpenTabMatch, executeBrowserSearch]
  );
}

const MAX_SCOPED_HISTORY_RESULTS = 160;
const MAX_SCOPED_BOOKMARK_RESULTS = 160;
const MAX_SCOPED_OPEN_TAB_RESULTS = 160;
const MAX_TOP_BROWSER_RESULTS = 1;
const MAX_ALL_BROWSER_RESULTS = 60;

function resolveLocal(rawInput: string): ResolvedBrowserInput | null {
  return resolveBrowserInput(rawInput);
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

function getLegacyCompletion(rawInput: string, entries: BrowserSearchEntry[]): BrowserSearchAutocomplete | null {
  const input = rawInput;
  if (!input.trim()) return null;
  const lower = input.toLowerCase();
  const stripped = lower.replace(/^https?:\/\//, '');

  let bestUrl: { entry: BrowserSearchEntry; matched: string; score: number } | null = null;
  for (const entry of entries) {
    if (entry.type !== 'url') continue;
    const sourceUrl = entry.url || entry.host;
    if (!sourceUrl) continue;
    const fullStripped = sourceUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!fullStripped) continue;
    const candidates = fullStripped.toLowerCase().startsWith('www.')
      ? [fullStripped, fullStripped.slice(4)]
      : [fullStripped];
    for (const candidate of candidates) {
      if (candidate.length > stripped.length && candidate.toLowerCase().startsWith(stripped)) {
        const score = frecency(entry);
        if (!bestUrl || score > bestUrl.score) bestUrl = { entry, matched: candidate, score };
        break;
      }
    }
  }
  if (bestUrl) {
    const completion = input + bestUrl.matched.slice(stripped.length);
    return {
      completion,
      suffix: completion.slice(input.length),
      entry: bestUrl.entry,
    };
  }

  let bestSearch: { entry: BrowserSearchEntry; score: number } | null = null;
  for (const entry of entries) {
    if (entry.type !== 'search') continue;
    if (entry.query.length <= input.length) continue;
    if (!entry.query.toLowerCase().startsWith(lower)) continue;
    const score = frecency(entry);
    if (!bestSearch || score > bestSearch.score) bestSearch = { entry, score };
  }
  if (!bestSearch) return null;
  const completion = input + bestSearch.entry.query.slice(input.length);
  return {
    completion,
    suffix: completion.slice(input.length),
    entry: bestSearch.entry,
  };
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

function normalizeBrowserProfiles(profiles: BrowserProfileSetting[] | undefined): BrowserProfileSetting[] {
  return Array.isArray(profiles)
    ? profiles.slice().sort((a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName))
    : [];
}

function getProfileLabel(profile: BrowserProfileSetting): string {
  return profile.displayName || profile.detectedName || profile.profileId;
}

function getProfileById(id: string | undefined, profiles: BrowserProfileSetting[]): BrowserProfileSetting | undefined {
  if (!id) return undefined;
  return profiles.find((candidate) => candidate.id === id);
}

function getProfileLabelById(id: string | undefined, profiles: BrowserProfileSetting[]): string {
  const profile = getProfileById(id, profiles);
  return profile ? getProfileLabel(profile) : '';
}

function getEnabledProfileIds(
  kind: BrowserSearchResultKind,
  filters: BrowserProfileFilters,
  profiles: BrowserProfileSetting[]
): string[] {
  const saved = filters?.[kind];
  return saved === undefined ? profiles.map((profile) => profile.id) : saved;
}

function filterBrowserResults(
  results: BrowserSearchResult[],
  filters: BrowserProfileFilters,
  profiles: BrowserProfileSetting[]
): BrowserSearchResult[] {
  return results.filter((result) => {
    if (!result.sourceProfileId) return true;
    const enabled = new Set(getEnabledProfileIds(result.kind, filters, profiles));
    return enabled.has(result.sourceProfileId);
  });
}

function filterBrowserResultsForKind(
  kind: BrowserSearchResultKind,
  results: BrowserSearchResult[],
  filters: BrowserProfileFilters,
  profiles: BrowserProfileSetting[]
): BrowserSearchResult[] {
  const enabled = new Set(getEnabledProfileIds(kind, filters, profiles));
  return results.filter((result) =>
    !result.sourceProfileId ||
    enabled.has(result.sourceProfileId)
  );
}

function decorateBrowserResults(results: BrowserSearchResult[], profiles: BrowserProfileSetting[]): BrowserSearchResult[] {
  return results.map((result) => {
    const profileLabel = getProfileLabelById(result.sourceProfileId, profiles) || result.profileLabel || '';
    if (!profileLabel) return result;
    const host = extractHost(result.url);
    const subtitle = result.kind === 'history' && result.lastUsedAt
      ? [formatHistoryDateTime(result.lastUsedAt), profileLabel, host].filter(Boolean).join(' - ')
      : buildBrowserSubtitle(profileLabel, '', host);
    return {
      ...result,
      profileLabel,
      subtitle,
    };
  });
}

type BrowserCandidateOptions = {
  useConfiguredLimits?: boolean;
  limitPerGroup?: number;
  limit?: number;
};

type BrowserEntrySearchIndex = {
  normalizedQuery: string;
  normalizedUrl: string;
  searchBlob: string;
  searchFields: TokenSearchField[];
  faviconUrl: string;
  browserLabel: string;
};

type BrowserEntryIndex = {
  historyPrefixToEntryIds: Map<string, number[]>;
  bookmarkPrefixToEntryIds: Map<string, number[]>;
  historyContainsToEntryIds: Map<string, number[]>;
  bookmarkContainsToEntryIds: Map<string, number[]>;
  historyByTimeEntryIds: number[];
  bookmarksByBrowserOrderEntryIds: number[];
  profileCountsByKind: {
    history: Map<string, number>;
    bookmark: Map<string, number>;
  };
};

const BROWSER_ENTRY_INDEX_MAX_PREFIX_LENGTH = 24;
const BROWSER_ENTRY_INDEX_MAX_TOKEN_LENGTH = 128;
const BROWSER_ENTRY_INDEX_MAX_URL_CHARS = 4096;
const browserEntrySearchIndexCache = new Map<string, { fingerprint: string; index: BrowserEntrySearchIndex }>();

function buildBrowserEntryIndex(entries: BrowserSearchEntry[]): BrowserEntryIndex {
  const historyPrefixToEntryIds = new Map<string, number[]>();
  const bookmarkPrefixToEntryIds = new Map<string, number[]>();
  const historyContainsToEntryIds = new Map<string, number[]>();
  const bookmarkContainsToEntryIds = new Map<string, number[]>();
  const historyByTimeEntryIds: number[] = [];
  const bookmarksByBrowserOrderEntryIds: number[] = [];
  const historyProfileCounts = new Map<string, number>();
  const bookmarkProfileCounts = new Map<string, number>();
  entries.forEach((entry, entryId) => {
    if (entry.type !== 'url' && entry.type !== 'bookmark') return;
    if (entry.type === 'url') {
      historyByTimeEntryIds.push(entryId);
      if (entry.sourceProfileId) {
        const key = getEntryProfileKey(entry);
        historyProfileCounts.set(key, (historyProfileCounts.get(key) || 0) + 1);
      }
    } else {
      bookmarksByBrowserOrderEntryIds.push(entryId);
      if (entry.sourceProfileId) {
        const key = getEntryProfileKey(entry);
        bookmarkProfileCounts.set(key, (bookmarkProfileCounts.get(key) || 0) + 1);
      }
    }
    const prefixTarget = entry.type === 'bookmark' ? bookmarkPrefixToEntryIds : historyPrefixToEntryIds;
    const containsTarget = entry.type === 'bookmark' ? bookmarkContainsToEntryIds : historyContainsToEntryIds;
    const searchIndex = getBrowserEntrySearchIndex(entry);
    const seenPrefixes = new Set<string>();
    const seenContains = new Set<string>();
    for (const token of searchIndex.searchBlob.split(/\s+/)) {
      if (token.length < 2) continue;
      const maxLength = Math.min(BROWSER_ENTRY_INDEX_MAX_PREFIX_LENGTH, token.length);
      for (let length = 2; length <= maxLength; length += 1) {
        seenPrefixes.add(token.slice(0, length));
      }
      if (token.length >= 3) {
        for (let index = 0; index <= token.length - 3; index += 1) {
          seenContains.add(token.slice(index, index + 3));
        }
      }
    }
    for (const key of seenPrefixes) {
      addBrowserEntryIndexValue(prefixTarget, key, entryId);
    }
    for (const key of seenContains) {
      addBrowserEntryIndexValue(containsTarget, key, entryId);
    }
  });
  historyByTimeEntryIds.sort((a, b) => compareHistoryEntriesByTime(entries[a], entries[b]));
  bookmarksByBrowserOrderEntryIds.sort((a, b) => compareBookmarkEntriesByBrowserOrder(entries[a], entries[b]));
  return {
    historyPrefixToEntryIds,
    bookmarkPrefixToEntryIds,
    historyContainsToEntryIds,
    bookmarkContainsToEntryIds,
    historyByTimeEntryIds,
    bookmarksByBrowserOrderEntryIds,
    profileCountsByKind: {
      history: historyProfileCounts,
      bookmark: bookmarkProfileCounts,
    },
  };
}

function compareHistoryEntriesByTime(a: BrowserSearchEntry, b: BrowserSearchEntry): number {
  const aTime = Number.isFinite(Number(a?.lastUsedAt)) ? Number(a.lastUsedAt) : 0;
  const bTime = Number.isFinite(Number(b?.lastUsedAt)) ? Number(b.lastUsedAt) : 0;
  if (bTime !== aTime) return bTime - aTime;
  return String(a?.query || '').localeCompare(String(b?.query || ''));
}

function compareBookmarkEntriesByBrowserOrder(a: BrowserSearchEntry, b: BrowserSearchEntry): number {
  const aOrder = Number.isFinite(Number(a?.bookmarkOrder)) ? Number(a.bookmarkOrder) : Number.MAX_SAFE_INTEGER;
  const bOrder = Number.isFinite(Number(b?.bookmarkOrder)) ? Number(b.bookmarkOrder) : Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return String(a?.query || '').localeCompare(String(b?.query || ''));
}

function addBrowserEntryIndexValue(target: Map<string, number[]>, key: string, entryId: number): void {
  const bucket = target.get(key);
  if (bucket) {
    bucket.push(entryId);
  } else {
    target.set(key, [entryId]);
  }
}

function resolveBrowserEntryCandidateIds(
  index: BrowserEntryIndex | null,
  kind: 'bookmark' | 'history',
  input: string
): number[] | null {
  if (!index) return null;
  const tokens = getSearchTokens(input);
  if (tokens.length === 0) return null;
  const prefixSource = kind === 'bookmark' ? index.bookmarkPrefixToEntryIds : index.historyPrefixToEntryIds;
  const containsSource = kind === 'bookmark' ? index.bookmarkContainsToEntryIds : index.historyContainsToEntryIds;
  const lists: number[][] = [];
  for (const token of tokens) {
    const key = token.slice(0, Math.min(BROWSER_ENTRY_INDEX_MAX_PREFIX_LENGTH, token.length));
    const prefixMatches = prefixSource.get(key) || [];
    const containsMatches = token.length >= 3 ? containsSource.get(token.slice(0, 3)) || [] : [];
    const matches = unionSortedBrowserEntryIds(prefixMatches, containsMatches);
    if (!matches || matches.length === 0) return [];
    lists.push(matches);
  }
  return intersectBrowserEntryIdLists(lists);
}

function unionSortedBrowserEntryIds(a: number[], b: number[]): number[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of a) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  for (const value of b) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function intersectBrowserEntryIdLists(lists: number[][]): number[] {
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0];
  const [first, ...rest] = [...lists].sort((a, b) => a.length - b.length);
  const candidates = new Set(first);
  for (const list of rest) {
    if (candidates.size === 0) break;
    const allowed = new Set(list);
    for (const entryId of candidates) {
      if (!allowed.has(entryId)) candidates.delete(entryId);
    }
  }
  return [...candidates];
}

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
  entryIndex: BrowserEntryIndex | null,
  tabs: BrowserTabEntry[],
  nicknames: BrowserSearchNicknameSetting[],
  options: BrowserCandidateOptions
): BrowserSearchResult[] {
  const input = rawInput.trim();
  if (input.length < 2) return [];
  const groups = normalizeResultGroups(rawGroups);
  const candidates = buildBrowserCandidates(input, entries, entryIndex, tabs, getActiveBookmarkNicknames(rawInput, nicknames), {
    limitPerKind: MAX_ALL_BROWSER_RESULTS,
  });
  const claimedKeys = new Set<string>();
  const orderedResults: BrowserSearchResult[] = [];

  for (const group of groups) {
    const groupLimit = options.useConfiguredLimits
      ? group.limit
      : options.limitPerGroup ?? Number.MAX_SAFE_INTEGER;
    if (groupLimit <= 0) continue;
    let pickedCount = 0;
    for (const result of candidates[group.kind]) {
      const dedupeKey = getBrowserResultDedupeKey(result);
      if (dedupeKey && claimedKeys.has(dedupeKey)) continue;
      orderedResults.push(result);
      pickedCount += 1;
      if (dedupeKey) claimedKeys.add(dedupeKey);
      if (orderedResults.length >= (options.limit ?? Number.MAX_SAFE_INTEGER)) return orderedResults;
      if (pickedCount >= groupLimit) break;
    }
  }

  return orderedResults;
}

function getRankedBrowserResults(
  rawInput: string,
  _rawGroups: BrowserSearchResultGroupSetting[],
  entries: BrowserSearchEntry[],
  entryIndex: BrowserEntryIndex | null,
  tabs: BrowserTabEntry[],
  nicknames: BrowserSearchNicknameSetting[],
  limit: number
): BrowserSearchResult[] {
  const input = rawInput.trim();
  if (input.length < 2) return [];
  const candidates = buildBrowserCandidates(input, entries, entryIndex, tabs, getActiveBookmarkNicknames(rawInput, nicknames), {
    limitPerKind: Math.max(200, limit * 6),
  });
  const bestByKey = new Map<string, { result: BrowserSearchResult; rankScore: number }>();

  for (const kind of Object.keys(candidates) as BrowserSearchResultKind[]) {
    for (const result of candidates[kind]) {
      const dedupeKey = getBrowserResultDedupeKey(result) || result.id;
      const rankScore = result.score;
      const existing = bestByKey.get(dedupeKey);
      if (
        !existing ||
        getBrowserDedupeKindRank(result) > getBrowserDedupeKindRank(existing.result) ||
        (
          getBrowserDedupeKindRank(result) === getBrowserDedupeKindRank(existing.result) &&
          rankScore > existing.rankScore
        )
      ) {
        bestByKey.set(dedupeKey, { result, rankScore });
      }
    }
  }

  return Array.from(bestByKey.values())
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      return compareBrowserResults(a.result, b.result);
    })
    .slice(0, limit)
    .map((item) => item.result);
}

function getBrowserDedupeKindRank(result: BrowserSearchResult): number {
  if (result.nicknameMatch) return 4;
  switch (result.kind) {
    case 'open-tab':
      return 3;
    case 'bookmark':
      return 2;
    case 'history':
      return 1;
    default:
      return 0;
  }
}

function getActiveBookmarkNicknames(rawInput: string, nicknames: BrowserSearchNicknameSetting[]): BrowserSearchNicknameSetting[] {
  const value = String(rawInput || '');
  if (/\s/.test(value.trim()) || /\s$/.test(value)) return [];
  return nicknames;
}

function buildBrowserCandidates(
  input: string,
  entries: BrowserSearchEntry[],
  entryIndex: BrowserEntryIndex | null,
  tabs: BrowserTabEntry[],
  nicknames: BrowserSearchNicknameSetting[],
  options: { limitPerKind?: number } = {}
): Record<BrowserSearchResultKind, BrowserSearchResult[]> {
  const openTabs = getOpenTabCandidates(input, tabs);

  return {
    'open-tab': openTabs,
    bookmark: getBrowserEntryCandidates('bookmark', input, entries, {
      candidateEntryIds: resolveBrowserEntryCandidateIds(entryIndex, 'bookmark', input),
      nicknames,
      limit: options.limitPerKind,
    }),
    history: getBrowserEntryCandidates('history', input, entries, {
      candidateEntryIds: resolveBrowserEntryCandidateIds(entryIndex, 'history', input),
      limit: options.limitPerKind,
    }),
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
    candidateEntryIds?: number[] | null;
  } = {}
): BrowserSearchResult[] {
  const trimmed = input.trim();
  const hasQuery = trimmed.length > 0;
  const entryType = kind === 'bookmark' ? 'bookmark' : 'url';
  const profileFilter = options.profileIds ? new Set(options.profileIds) : null;
  const lowerInput = trimmed.toLowerCase();
  const strippedInput = lowerInput.replace(/^https?:\/\//, '');
  const queryTokens = getSearchTokens(trimmed);
  const shouldBoundResults = Boolean(options.limit && options.limit > 0 && !options.preserveBookmarkOrder && !options.preserveHistoryChronology);
  const workingLimit = shouldBoundResults ? Math.max(Number(options.limit) * 3, Number(options.limit) + 80) : 0;
  const results: BrowserSearchResult[] = [];
  if (!hasQuery && options.limit && options.limit > 0 && options.candidateEntryIds) {
    for (const entryId of options.candidateEntryIds) {
      const entry = entries[entryId];
      if (!entry) continue;
      if (entry.type !== entryType) continue;
      if (kind === 'history' && profileFilter && !profileFilter.has(getEntryProfileKey(entry))) continue;
      const index = getBrowserEntrySearchIndex(entry);
      const savedNickname = kind === 'bookmark'
        ? findBookmarkNickname(entry, options.nicknames || [])
        : '';
      const freshnessFactor = kind === 'history' ? getHistoryFreshnessFactor(entry.lastUsedAt) : 1;
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
        faviconUrl: index.faviconUrl,
        source: entry.source,
        sourceProfileId: entry.sourceProfileId ? getEntryProfileKey(entry) : undefined,
        browserName: index.browserLabel,
        profileName: entry.sourceProfileName || entry.sourceProfileId,
        bookmarkFolder: entry.bookmarkFolder,
        bookmarkOrder: entry.bookmarkOrder,
        lastUsedAt: entry.lastUsedAt,
        score: kind === 'history'
          ? freshnessFactor * 650 + getHistoryFrequencyScore(entry.useCount, freshnessFactor)
          : 250,
        completion: '',
        nickname: savedNickname,
        nicknameMatch: false,
        matchKind: 'subsequence',
        rawMatchScore: 0,
      });
      if (results.length >= options.limit) break;
    }
    return results;
  }
  const candidateEntries = options.candidateEntryIds
    ? options.candidateEntryIds.map((entryId) => entries[entryId]).filter((entry): entry is BrowserSearchEntry => Boolean(entry))
    : entries;
  for (const entry of candidateEntries) {
    if (entry.type !== entryType) continue;
    if (kind === 'history' && profileFilter && !profileFilter.has(getEntryProfileKey(entry))) continue;
    const index = getBrowserEntrySearchIndex(entry);
    const savedNickname = kind === 'bookmark'
      ? findBookmarkNickname(entry, options.nicknames || [])
      : '';
    const nicknameMatch = kind === 'bookmark' && hasQuery && !/\s/.test(trimmed)
      ? getBookmarkNicknameMatch(entry, trimmed, options.nicknames || [])
      : null;
    const searchInput = nicknameMatch ? nicknameMatch.remainingInput : trimmed;
    const hasSearchInput = searchInput.length > 0;
    const activeLowerInput = nicknameMatch ? searchInput.toLowerCase() : lowerInput;
    const activeStrippedInput = nicknameMatch ? activeLowerInput.replace(/^https?:\/\//, '') : strippedInput;
    const activeQueryTokens = nicknameMatch ? getSearchTokens(searchInput) : queryTokens;
    if (!nicknameMatch && hasSearchInput && activeQueryTokens.length > 0) {
      let tokenMatched = true;
      for (const token of activeQueryTokens) {
        if (!index.searchBlob.includes(token)) {
          tokenMatched = false;
          break;
        }
      }
      if (!tokenMatched) continue;
    }
    const urlScore = hasSearchInput ? getUrlMatchScoreFromNormalized(index.normalizedUrl, activeStrippedInput, true) : { score: 0, completion: '' };
    const titleScore = hasSearchInput ? getTitleMatchScoreFromNormalized(index.normalizedQuery, activeLowerInput) : 0;
    const tokenScore = hasSearchInput ? getTokenMatchScoreFromNormalizedFields(activeQueryTokens, index.searchFields) : 0;
    if (!nicknameMatch && urlScore === null && titleScore === null && tokenScore === null) continue;
    if (nicknameMatch?.remainingInput && urlScore === null && titleScore === null && tokenScore === null) continue;
    const matchScore = Math.max(urlScore?.score ?? 0, titleScore ?? 0, tokenScore ?? 0);
    const rawMatchKind = getBrowserResultMatchKind(urlScore?.score ?? 0, titleScore ?? 0, tokenScore ?? 0);
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
      faviconUrl: index.faviconUrl,
      source: entry.source,
      sourceProfileId: entry.sourceProfileId ? getEntryProfileKey(entry) : undefined,
      browserName: index.browserLabel,
      profileName: entry.sourceProfileName || entry.sourceProfileId,
      bookmarkFolder: entry.bookmarkFolder,
      bookmarkOrder: entry.bookmarkOrder,
      lastUsedAt: entry.lastUsedAt,
      score,
      completion: nicknameMatch?.completion || urlScore?.completion || '',
      nickname: nicknameMatch?.nickname || savedNickname,
      nicknameMatch: Boolean(nicknameMatch),
      matchKind: nicknameMatch && !nicknameMatch.remainingInput
        ? (normalizeNicknameToken(nicknameMatch.nickname) === normalizeNicknameToken(trimmed) ? 'nickname-exact' : 'prefix')
        : rawMatchKind,
      rawMatchScore: matchScore,
    });
    if (workingLimit && results.length > workingLimit * 2) {
      results.sort(compareBrowserResults);
      results.length = workingLimit;
    }
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
  const profile = String(entry.sourceProfileId || entry.sourceProfileName || 'default');
  if (profile.includes(':')) return profile;
  return [
    entry.source || 'user',
    profile,
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
      const rawMatchKind = getBrowserResultMatchKind(urlScore?.score ?? 0, titleScore ?? 0, tokenScore ?? 0);
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
        source: tab.browserId as BrowserSearchSource,
        sourceProfileId: tab.profileSourceId,
        browserName: tab.browserName,
        profileName: tab.profileName,
        windowId: tab.windowId,
        windowOrdinal: tab.windowOrdinal,
        tabId: tab.tabId,
        tabIndex: tab.tabIndex,
        windowLastFocusedAt: tab.windowLastFocusedAt,
        active: tab.active,
        score,
        completion: urlScore?.completion || '',
        matchKind: rawMatchKind,
        rawMatchScore: matchScore,
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
  return getUrlMatchScoreFromNormalized(fullStripped, strippedInput, allowContains);
}

function getUrlMatchScoreFromNormalized(fullStripped: string, strippedInput: string, allowContains: boolean): { score: number; completion: string } | null {
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
  return getTitleMatchScoreFromNormalized(title, lowerInput);
}

function getTitleMatchScoreFromNormalized(title: string, lowerInput: string): number | null {
  if (!title) return null;
  if (title === lowerInput) return 2800;
  if (title.startsWith(lowerInput)) return 2400;
  if (lowerInput.length < 3) return null;
  const tokens = title.split(/[^a-z0-9]+/g).filter(Boolean);
  if (tokens.some((token) => token.startsWith(lowerInput))) return 2000;
  if (title.includes(lowerInput)) return 1200;
  return null;
}

function getBrowserResultMatchKind(urlScore: number, titleScore: number, tokenScore: number): MatchKind {
  const bestScore = Math.max(urlScore, titleScore, tokenScore);
  if (urlScore > 0 && urlScore === bestScore) {
    if (urlScore >= 3600) return 'exact';
    if (urlScore >= 2600) return 'url';
    return 'contains';
  }
  if (titleScore > 0 && titleScore === bestScore) {
    if (titleScore >= 2800) return 'exact';
    if (titleScore >= 2400) return 'prefix';
    if (titleScore >= 2000) return 'token-prefix';
    return 'contains';
  }
  if (tokenScore >= 1800) return 'token-prefix';
  if (tokenScore > 0) return 'contains';
  return 'subsequence';
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
  const entryFullProfileId = getEntryProfileKey(entry);
  const entryUrl = normalizeNicknameUrl(entry.url);
  const match = nicknames.find((item) =>
    String(item.source || '') === entrySource &&
    (String(item.sourceProfileId || '') === entryProfileId || String(item.sourceProfileId || '') === entryFullProfileId) &&
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

function getBrowserEntrySearchIndex(entry: BrowserSearchEntry): BrowserEntrySearchIndex {
  const cacheKey = String(entry.id || `${entry.source}:${entry.sourceProfileId || ''}:${entry.type}:${entry.url}`);
  const fingerprint = getBrowserEntrySearchFingerprint(entry);
  const cached = browserEntrySearchIndexCache.get(cacheKey);
  if (cached?.fingerprint === fingerprint) return cached.index;
  const browserLabel = getBrowserSourceLabel(entry.source);
  const searchFields: TokenSearchField[] = [
    { value: normalizeForTokenSearch(entry.query), weight: 1.15 },
    { value: normalizeForTokenSearch(entry.url, BROWSER_ENTRY_INDEX_MAX_URL_CHARS), weight: 1 },
    { value: normalizeForTokenSearch(entry.host), weight: 1 },
    { value: normalizeForTokenSearch(entry.bookmarkFolder || ''), weight: 0.65 },
    { value: normalizeForTokenSearch(entry.sourceProfileName || entry.sourceProfileId || ''), weight: 0.35 },
    { value: normalizeForTokenSearch(browserLabel), weight: 0.3 },
  ];
  const searchBlob = Array.from(new Set(searchFields.map((field) => field.value).filter(Boolean))).join(' ');
  const index: BrowserEntrySearchIndex = {
    normalizedQuery: String(entry.query || '').trim().toLowerCase(),
    normalizedUrl: normalizeUrlForCompletion(entry.url || entry.host, BROWSER_ENTRY_INDEX_MAX_URL_CHARS),
    searchBlob,
    searchFields,
    faviconUrl: getFaviconUrlForUrl(entry.url),
    browserLabel,
  };
  browserEntrySearchIndexCache.set(cacheKey, { fingerprint, index });
  return index;
}

function getBrowserEntrySearchFingerprint(entry: BrowserSearchEntry): string {
  return [
    entry.type,
    entry.source,
    entry.sourceProfileId || '',
    compactFingerprintPart(entry.query),
    compactFingerprintPart(entry.url),
    compactFingerprintPart(entry.host),
    compactFingerprintPart(entry.bookmarkFolder || ''),
    compactFingerprintPart(entry.sourceProfileName || ''),
    String(entry.bookmarkOrder ?? ''),
  ].join('\0');
}

function compactFingerprintPart(value: string | undefined): string {
  const text = String(value || '');
  if (text.length <= 256) return text;
  return `${text.length}:${text.slice(0, 128)}:${text.slice(-128)}`;
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
  return getTokenMatchScoreFromNormalizedFields(
    queryTokens,
    fields.map((field) => ({ ...field, value: normalizeForTokenSearch(field.value || '') }))
  );
}

function getTokenMatchScoreFromNormalizedFields(queryTokens: string[], fields: TokenSearchField[]): number | null {
  if (queryTokens.length === 0) return null;
  let total = 0;
  for (const queryToken of queryTokens) {
    let bestTokenScore = 0;
    for (const field of fields) {
      const fieldValue = field.value || '';
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

function normalizeForTokenSearch(value: string, maxChars = Number.MAX_SAFE_INTEGER): string {
  return String(value || '')
    .slice(0, maxChars)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\bwww\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length <= BROWSER_ENTRY_INDEX_MAX_TOKEN_LENGTH)
    .join(' ');
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

function normalizeUrlForCompletion(sourceUrl: string, maxChars = Number.MAX_SAFE_INTEGER): string {
  return String(sourceUrl || '').slice(0, maxChars).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
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

function getBrowserResultDedupeKey(result: BrowserSearchResult): string {
  const normalizedUrl = normalizeBrowserUrl(result.url);
  let host = '';
  try {
    host = new URL(result.url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {}
  const normalizedTitle = normalizeForTokenSearch(result.title || '').replace(/\s+/g, ' ').trim();
  if (host && normalizedTitle) return `page:${host}:${normalizedTitle}`;
  return normalizedUrl;
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
