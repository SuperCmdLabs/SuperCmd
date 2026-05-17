import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BrowserSearchSource,
  BrowserSearchResultGroupSetting,
  CommandInfo,
  IndexedFileSearchResult,
  WebSearchBangUsageSetting,
} from '../../types/electron';
import type { BrowserSearchResult, useBrowserSearch } from './useBrowserSearch';
import type { CalcResult } from '../smart-calculator';
import { tryCalculate, tryCalculateAsync } from '../smart-calculator';
import { filterCommands, rankCommands } from '../utils/command-helpers';
import {
  asTildePath,
  buildFileResultCommandId,
  getFileBasename,
  getFileDirname,
  getFileResultPathFromCommand,
} from '../utils/launcher-file-results';
import { getQuickLinkIdFromCommandId, MAX_RECENT_SECTION_ITEMS } from '../utils/launcher-misc';
import type { BrowserInputResolution } from '../utils/browser-input-resolver';
import {
  BROWSER_SEARCH_OPEN_URL_ID,
  BROWSER_SEARCH_RESULT_ID_PREFIX,
} from '../utils/browser-search-commands';
import {
  type BangParseState,
  type SearchBangDefinition,
  WEB_SEARCH_ACTIVE_BANG_SUGGESTION_LIMIT,
  WEB_SEARCH_COMMAND_ID,
  WEB_SEARCH_ROOT_BANG_PREFIX,
  WEB_SEARCH_ROOT_DIRECT_ID,
  WEB_SEARCH_ROOT_SUGGESTION_PREFIX,
  getFaviconUrlForHost,
  getSearchBangByKeyFromList,
  getSortedSearchBangs,
} from '../utils/web-search-bangs';
import {
  getRootSearchCompletion,
  getRootSearchFrecencyBoost,
  normalizeRootSearchStableValue,
  normalizeRootSearchUrl,
  rankRootSearchCandidates,
  scoreRootSearchCandidate,
  scoreRootSearchFields,
  type MatchKind,
  type RootSearchCandidate,
  type RootSearchRankingState,
  type RootSearchSubtype,
} from '../utils/root-search-ranking';
import {
  assembleRootSearchSections,
  isRootResultPromotionCandidate,
} from '../utils/root-search-sections';
import type { LauncherCommandSection } from '../components/LauncherCommandList';

export type GroupedLauncherCommands = {
  contextual: CommandInfo[];
  pinned: CommandInfo[];
  recent: CommandInfo[];
  other: CommandInfo[];
  files: CommandInfo[];
};

export type UseLauncherCommandModelParams = {
  commands: CommandInfo[];
  searchQuery: string;
  commandAliases: Record<string, string>;

  homeDir: string;
  launcherFileResults: IndexedFileSearchResult[];
  launcherFileIcons: Record<string, string>;
  pinnedFiles: string[];

  pinnedCommands: string[];
  recentCommands: string[];
  recentCommandLaunchCounts: Record<string, number>;
  selectedTextSnapshot: string;

  browserSearch: ReturnType<typeof useBrowserSearch>;
  browserSearchResultGroups: BrowserSearchResultGroupSetting[];
  aiMode: boolean;
  rootSearchRanking: RootSearchRankingState;
  webSearchSuggestionsEnabled: boolean;

  rootBangState: BangParseState;
  enabledSearchBangs: SearchBangDefinition[];
  effectiveSearchBangs: SearchBangDefinition[];
  webSearchDefaultBangKey: string;
  webSearchBangUsage: Record<string, WebSearchBangUsageSetting>;
  rootWebSearchSuggestions: string[];

  selectedIndex: number;
  defaultBrowserIconDataUrl: string;
  browserAppIconDataUrls: Record<string, string>;

  t: (key: string, params?: Record<string, string | number>) => string;
};

export type UseLauncherCommandModelResult = {
  syncCalcResult: CalcResult | null;
  asyncCalcResult: CalcResult | null;
  calcResult: CalcResult | null;
  calcOffset: number;

  contextualCommands: CommandInfo[];
  filteredCommands: CommandInfo[];
  sourceCommands: CommandInfo[];
  visibleSourceCommands: CommandInfo[];
  fileResultCommands: CommandInfo[];
  pinnedFileCommands: CommandInfo[];
  groupedCommands: GroupedLauncherCommands;

  launcherInputValue: string;
  rootSearchAutoComplete: { completion: string; suffix: string } | null;
  rootRankedCandidates: RootSearchCandidate[];
  browserSearchTopResult: BrowserSearchResult | null;
  browserSearchSyntheticCommand: CommandInfo | null;
  browserSearchResultCommands: CommandInfo[];

  webSearchRootDirectCommand: CommandInfo | null;
  webSearchRootSuggestionCommands: CommandInfo[];
  rootBangCandidateCommands: CommandInfo[];

  displayCommands: CommandInfo[];
  launcherCommandSections: LauncherCommandSection[];

  selectedCommand: CommandInfo | null;
  selectedFileResultPath: string | null;
};

function inferCommandSubtype(command: CommandInfo): RootSearchSubtype {
  if (command.category === 'app') return 'app';
  if (getQuickLinkIdFromCommandId(command.id)) return 'quicklink';
  if (command.category === 'extension') return 'extension-command';
  if (command.category === 'script') return 'script-command';
  return 'system-command';
}

function coerceMatchKind(value: string | undefined, fallback: MatchKind): MatchKind {
  switch (value) {
    case 'exact':
    case 'alias-exact':
    case 'nickname-exact':
    case 'prefix':
    case 'token-prefix':
    case 'compact-prefix':
    case 'word-boundary-fuzzy':
    case 'contains':
    case 'subsequence':
    case 'description':
    case 'path':
    case 'url':
      return value;
    default:
      return fallback;
  }
}

function getFileFreshnessBoost(result: IndexedFileSearchResult): number {
  const touched = Math.max(Number(result.mtimeMs || 0), Number(result.birthtimeMs || 0));
  if (!touched) return 0;
  const ageHours = Math.max(0, (Date.now() - touched) / (60 * 60 * 1000));
  const ageDays = ageHours / 24;
  if (ageHours <= 24) return 120;
  if (ageDays <= 7) return 90;
  if (ageDays <= 30) return 45;
  if (ageDays <= 90) return 15;
  return 0;
}

function getFileLocationBoost(result: IndexedFileSearchResult): number {
  const topLevelRoot = String(result.topLevelRoot || '').trim();
  const depth = Number(result.homeRelativeDepth || result.depth || 0);
  const protectedRoot = topLevelRoot === 'Desktop' || topLevelRoot === 'Documents' || topLevelRoot === 'Downloads';
  if (!protectedRoot) return 20;
  return 120 - Math.min(90, Math.max(0, depth - 2) * 18);
}

function getFileDepthPenalty(result: IndexedFileSearchResult): number {
  const depth = Math.max(0, Number(result.homeRelativeDepth || result.depth || 0));
  if (depth <= 2) return 0;
  if (depth <= 4) return (depth - 2) * 25;
  return Math.min(260, 50 + (depth - 4) * 35);
}

type BrowserLauncherProfile = {
  id?: string;
  browserId?: BrowserSearchSource | string;
  displayName: string;
  detectedName?: string;
  profileId: string;
};

function getBrowserProfileDisplayName(profile: BrowserLauncherProfile | null | undefined): string {
  return profile ? (profile.displayName || profile.detectedName || profile.profileId) : '';
}

function getBrowserProfileById(
  browserSearch: { profiles?: BrowserLauncherProfile[] },
  profileId?: string
): BrowserLauncherProfile | null {
  const normalized = String(profileId || '').trim();
  if (!normalized) return null;
  return browserSearch.profiles?.find((profile) =>
    profile.id === normalized ||
    `${profile.browserId || ''}:${profile.profileId || ''}` === normalized ||
    profile.profileId === normalized
  ) || null;
}

function getNicknameAlternateBrowserProfile(
  browserSearch: { profiles?: BrowserLauncherProfile[] },
  sourceProfile: BrowserLauncherProfile | null,
  fallbackAlternate: BrowserLauncherProfile | null
): BrowserLauncherProfile | null {
  if (!sourceProfile) return fallbackAlternate;
  const defaultProfile = getDefaultBrowserProfile(browserSearch);
  if (defaultProfile && defaultProfile.id !== sourceProfile.id) return defaultProfile;
  return fallbackAlternate && fallbackAlternate.id !== sourceProfile.id ? fallbackAlternate : null;
}

function buildBrowserCommand(
  result: BrowserSearchResult,
  index: number,
  targetProfile: BrowserLauncherProfile | null,
  alternateProfile: BrowserLauncherProfile | null,
  profileCount: number,
  browserAppIconDataUrls: Record<string, string>
): CommandInfo {
  const normalizedUrl = normalizeRootSearchUrl(result.url);
  const subtype: RootSearchSubtype = result.nicknameMatch ? 'nickname' : result.kind;
  const stableKey = result.nicknameMatch
    ? `nickname:${result.source || 'browser'}:${result.sourceProfileId || 'default'}:${normalizedUrl}:${normalizeRootSearchStableValue(result.nickname || '')}`
    : `browser:${normalizedUrl || result.id}`;
  return {
    id: `${BROWSER_SEARCH_RESULT_ID_PREFIX}${result.kind}:${index}:${result.id}`,
    title: result.title,
    subtitle: result.subtitle,
    category: 'system',
    keywords: [result.title, result.subtitle, result.url, result.nickname || ''],
    browserMatchKind: result.kind === 'open-tab' ? 'open-tab' : 'history',
    browserResultKind: result.kind,
    browserFaviconUrl: result.faviconUrl,
    browserActionInput: result.actionInput,
    browserUrl: result.url,
    browserSourceProfileId: result.sourceProfileId,
    browserTargetProfileLabel: getBrowserProfileDisplayName(targetProfile),
    browserTargetProfileBrowserId: targetProfile?.browserId,
    browserTargetProfileIconDataUrl: targetProfile?.browserId ? browserAppIconDataUrls[String(targetProfile.browserId)] : undefined,
    browserAlternateProfileLabel: getBrowserProfileDisplayName(alternateProfile),
    browserAlternateProfileBrowserId: alternateProfile?.browserId,
    browserAlternateProfileIconDataUrl: alternateProfile?.browserId ? browserAppIconDataUrls[String(alternateProfile.browserId)] : undefined,
    browserProfileCount: profileCount,
    browserWindowId: result.windowId,
    browserTabId: result.tabId,
    browserFocusAvailable: result.focusAvailable,
    browserNickname: result.nickname,
    browserNicknameMatch: result.nicknameMatch,
    rootSearchStableKey: stableKey,
    rootSearchSource: 'browser',
    rootSearchSubtype: subtype,
  };
}

function getDefaultBrowserProfile(browserSearch: { profiles?: BrowserLauncherProfile[] }) {
  const profile = browserSearch.profiles?.[0];
  return profile || null;
}

function getAlternateBrowserProfile(browserSearch: { profiles?: BrowserLauncherProfile[] }) {
  return browserSearch.profiles && browserSearch.profiles.length > 1 ? browserSearch.profiles[1] : null;
}

function getBrowserIcon(browserAppIconDataUrls: Record<string, string>, browserId?: BrowserSearchSource | string) {
  return browserId ? browserAppIconDataUrls[String(browserId)] : undefined;
}

export function useLauncherCommandModel({
  commands,
  searchQuery,
  commandAliases,
  homeDir,
  launcherFileResults,
  launcherFileIcons,
  pinnedFiles,
  pinnedCommands,
  recentCommands,
  recentCommandLaunchCounts,
  selectedTextSnapshot,
  browserSearch,
  browserSearchResultGroups,
  aiMode,
  rootSearchRanking,
  webSearchSuggestionsEnabled,
  rootBangState,
  enabledSearchBangs,
  effectiveSearchBangs,
  webSearchDefaultBangKey,
  webSearchBangUsage,
  rootWebSearchSuggestions,
  selectedIndex,
  defaultBrowserIconDataUrl,
  browserAppIconDataUrls,
  t,
}: UseLauncherCommandModelParams): UseLauncherCommandModelResult {
  const calcRequestSeqRef = useRef(0);
  const syncCalcResult = useMemo(() => {
    return searchQuery ? tryCalculate(searchQuery) : null;
  }, [searchQuery]);
  const [asyncCalcResult, setAsyncCalcResult] = useState<CalcResult | null>(null);
  useEffect(() => {
    calcRequestSeqRef.current += 1;
    const requestSeq = calcRequestSeqRef.current;

    if (!searchQuery || syncCalcResult) {
      setAsyncCalcResult(null);
      return;
    }

    const timer = window.setTimeout(() => {
      void tryCalculateAsync(searchQuery)
        .then((result) => {
          if (calcRequestSeqRef.current !== requestSeq) return;
          setAsyncCalcResult(result);
        })
        .catch(() => {
          if (calcRequestSeqRef.current !== requestSeq) return;
          setAsyncCalcResult(null);
        });
    }, 200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchQuery, syncCalcResult]);
  const calcResult = syncCalcResult ?? asyncCalcResult;
  const calcOffset = calcResult ? 1 : 0;
  const contextualCommands = commands;
  const filteredCommands = useMemo(
    () => filterCommands(contextualCommands, searchQuery, commandAliases),
    [contextualCommands, searchQuery, commandAliases]
  );

  // When calculator is showing but no commands match, show unfiltered list below.
  // alwaysOnTop commands are always present in filteredCommands regardless of query,
  // so exclude them from the "nothing matched" check.
  const sourceCommands =
    calcResult && filteredCommands.filter((c) => !c.alwaysOnTop).length === 0
      ? contextualCommands
      : filteredCommands;
  const hiddenListOnlyCommandIds = useMemo(
    () => new Set(['system-add-to-memory', 'system-cursor-prompt', 'system-emoji-picker']),
    []
  );
  const hasSearchQuery = searchQuery.trim().length > 0;
  const visibleSourceCommands = useMemo(
    () => sourceCommands
      .filter((cmd) => !hiddenListOnlyCommandIds.has(cmd.id) || hasSearchQuery)
      .map((cmd) => {
        if (cmd.id !== WEB_SEARCH_COMMAND_ID) return cmd;
        const provider = getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
        return {
          ...cmd,
          subtitle: t('launcher.categories.search'),
          browserResultKind: 'search',
          browserFaviconUrl: getFaviconUrlForHost(provider.host),
        } as CommandInfo;
      }),
    [sourceCommands, hiddenListOnlyCommandIds, hasSearchQuery, t, webSearchDefaultBangKey, effectiveSearchBangs]
  );

  const fileResultCommands = useMemo<CommandInfo[]>(
    () =>
      launcherFileResults.map((result) => {
        const displayParent = result.displayPath || asTildePath(result.parentPath, homeDir);
        return {
          id: buildFileResultCommandId(result.path),
          title: result.name,
          subtitle: displayParent,
          keywords: [result.name, result.parentPath, result.displayPath],
          iconDataUrl: launcherFileIcons[result.path] || undefined,
          category: 'system',
          path: result.path,
          rootSearchStableKey: `file:${normalizeRootSearchStableValue(result.path)}`,
          rootSearchSource: 'file',
          rootSearchSubtype: result.isDirectory ? 'folder' : 'file',
        };
      }),
    [launcherFileResults, launcherFileIcons, homeDir]
  );

  const pinnedFileCommands = useMemo<CommandInfo[]>(
    () =>
      pinnedFiles.map((filePath) => {
        const name = getFileBasename(filePath);
        const parentPath = getFileDirname(filePath);
        return {
          id: buildFileResultCommandId(filePath),
          title: name || filePath,
          subtitle: asTildePath(parentPath, homeDir),
          keywords: [name, parentPath, filePath],
          iconDataUrl: launcherFileIcons[filePath] || undefined,
          category: 'system',
          path: filePath,
          rootSearchStableKey: `file:${normalizeRootSearchStableValue(filePath)}`,
          rootSearchSource: 'file',
          rootSearchSubtype: 'file',
        };
      }),
    [pinnedFiles, launcherFileIcons, homeDir]
  );

  const groupedCommands = useMemo<GroupedLauncherCommands>(() => {
    if (hasSearchQuery) {
      return {
        contextual: [],
        pinned: [],
        recent: [],
        other: visibleSourceCommands,
        files: fileResultCommands,
      };
    }

    const sourceMap = new Map(visibleSourceCommands.map((cmd) => [cmd.id, cmd]));
    const hasSelection = selectedTextSnapshot.trim().length > 0;
    const contextual = hasSelection
      ? (sourceMap.get('system-add-to-memory') ? [sourceMap.get('system-add-to-memory') as CommandInfo] : [])
      : [];
    const contextualIds = new Set(contextual.map((c) => c.id));

    const pinnedFromCommands = pinnedCommands
      .map((id) => sourceMap.get(id))
      .filter((cmd): cmd is CommandInfo => Boolean(cmd) && !contextualIds.has((cmd as CommandInfo).id));
    const pinned = [...pinnedFromCommands, ...pinnedFileCommands];
    const pinnedSet = new Set(pinned.map((c) => c.id));

    const recentRecencyRank = new Map(recentCommands.map((id, index) => [id, index]));
    const recent = recentCommands
      .map((id) => sourceMap.get(id))
      .filter(
        (c): c is CommandInfo =>
          Boolean(c) &&
          !pinnedSet.has((c as CommandInfo).id) &&
          !contextualIds.has((c as CommandInfo).id)
      )
      .sort((a, b) => {
        const rootScoreA = getRootSearchFrecencyBoost(`command:${a.id}`, rootSearchRanking);
        const rootScoreB = getRootSearchFrecencyBoost(`command:${b.id}`, rootSearchRanking);
        if (Math.abs(rootScoreB - rootScoreA) >= 1) return rootScoreB - rootScoreA;
        const countA = recentCommandLaunchCounts[a.id] || 0;
        const countB = recentCommandLaunchCounts[b.id] || 0;
        if (countB !== countA) return countB - countA;
        return (recentRecencyRank.get(a.id) ?? Number.MAX_SAFE_INTEGER)
          - (recentRecencyRank.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      })
      .slice(0, MAX_RECENT_SECTION_ITEMS);
    const recentSet = new Set(recent.map((c) => c.id));

    const other = visibleSourceCommands.filter(
      (c) => !pinnedSet.has(c.id) && !recentSet.has(c.id) && !contextualIds.has(c.id)
    );

    return { contextual, pinned, recent, files: fileResultCommands, other };
  }, [hasSearchQuery, visibleSourceCommands, pinnedCommands, pinnedFileCommands, recentCommands, recentCommandLaunchCounts, rootSearchRanking, selectedTextSnapshot, fileResultCommands]);

  const browserSearchTopResult = null;

  const rootResolvedBrowserInput = useMemo<BrowserInputResolution | null>(() => {
    if (!browserSearch.enabled) return null;
    if (aiMode) return null;
    if (rootBangState.mode !== 'none') return null;
    const subject = searchQuery.trim();
    if (!subject) return null;
    return browserSearch.resolve(subject);
  }, [browserSearch, searchQuery, aiMode, rootBangState]);

  const browserSearchSyntheticCommand = useMemo<CommandInfo | null>(() => {
    if (!browserSearch.enabled) return null;
    if (aiMode) return null;
    const subject = searchQuery.trim();
    if (!subject) return null;
    const resolved = rootResolvedBrowserInput;
    if (resolved?.type === 'url') {
      const typedSubject = searchQuery.trim();
      const browserMatchKind = browserSearch.getMatchKind(typedSubject, null);
      const hasOpenTabMatch = browserMatchKind === 'open-tab';
      const defaultProfile = getDefaultBrowserProfile(browserSearch);
      const alternateProfile = getAlternateBrowserProfile(browserSearch);
      const stableKey = `open-url:${normalizeRootSearchStableValue(resolved.host || resolved.url)}`;
      return {
        id: BROWSER_SEARCH_OPEN_URL_ID,
        title: t('launcher.browserSearch.openUrl', { url: resolved.display || typedSubject || subject }),
        subtitle: t('launcher.categories.browser'),
        category: 'system',
        keywords: [typedSubject, resolved.url, resolved.host],
        iconDataUrl: defaultBrowserIconDataUrl || undefined,
        alwaysOnTop: true,
        browserMatchKind,
        browserResultKind: undefined,
        browserActionInput: typedSubject || resolved.url,
        browserFocusAvailable: hasOpenTabMatch,
        browserTargetProfileLabel: defaultProfile ? (defaultProfile.displayName || defaultProfile.detectedName || defaultProfile.profileId) : '',
        browserTargetProfileBrowserId: defaultProfile?.browserId,
        browserTargetProfileIconDataUrl: getBrowserIcon(browserAppIconDataUrls, defaultProfile?.browserId) || defaultBrowserIconDataUrl || undefined,
        browserAlternateProfileLabel: alternateProfile?.displayName || alternateProfile?.detectedName || alternateProfile?.profileId || '',
        browserAlternateProfileBrowserId: alternateProfile?.browserId,
        browserAlternateProfileIconDataUrl: getBrowserIcon(browserAppIconDataUrls, alternateProfile?.browserId) || defaultBrowserIconDataUrl || undefined,
        browserProfileCount: browserSearch.profiles?.length || 0,
        rootSearchStableKey: stableKey,
        rootSearchSource: 'open-url',
        rootSearchSubtype: 'open-url',
        rootSearchScore: 10_000,
      };
    }
    return null;
  }, [browserSearch, rootResolvedBrowserInput, searchQuery, defaultBrowserIconDataUrl, browserAppIconDataUrls, aiMode, t]);

  const browserSearchResultCommands = useMemo<CommandInfo[]>(() => [], []);

  const commandCandidates = useMemo<RootSearchCandidate[]>(() => {
    if (!hasSearchQuery || aiMode || rootBangState.mode !== 'none') return [];
    const searchableCommands = contextualCommands.filter((cmd) =>
      cmd.id !== WEB_SEARCH_COMMAND_ID &&
      (!hiddenListOnlyCommandIds.has(cmd.id) || hasSearchQuery)
    );
    return rankCommands(searchableCommands, searchQuery, commandAliases)
      .map(({ command }) => {
        const alias = commandAliases[command.id] || '';
        const scored = scoreRootSearchFields(searchQuery, [
          { value: command.title, kind: 'label', weight: 1 },
          { value: alias, kind: 'alias', weight: 1.08 },
          { value: command.subtitle, kind: 'description', weight: 0.74 },
          ...(command.keywords || []).map((keyword) => ({ value: keyword, kind: 'description' as const, weight: 0.68 })),
        ]);
        if (!scored.matched) return null;
        const subtype = inferCommandSubtype(command);
        const stableKey = `command:${command.id}`;
        return scoreRootSearchCandidate({
          command: {
            ...command,
            rootSearchStableKey: stableKey,
            rootSearchSource: 'command',
            rootSearchSubtype: subtype,
          },
          source: 'command',
          subtype,
          stableKey,
          label: command.title,
          description: command.subtitle,
          pathOrUrl: command.path,
          matchKind: scored.matchKind,
          matchScore: scored.matchScore,
          sourceQualityBoost: command.alwaysOnTop ? 80 : 0,
          freshnessBoost: 0,
          pathLocationBoost: 0,
          noisePenalty: 0,
          depthPenalty: 0,
        }, searchQuery, rootSearchRanking);
      })
      .filter((candidate): candidate is RootSearchCandidate => Boolean(candidate));
  }, [hasSearchQuery, aiMode, rootBangState, contextualCommands, hiddenListOnlyCommandIds, searchQuery, commandAliases, rootSearchRanking]);

  const fileCandidates = useMemo<RootSearchCandidate[]>(() => {
    if (!hasSearchQuery || aiMode || rootBangState.mode !== 'none') return [];
    return launcherFileResults
      .map((result) => {
        const command = fileResultCommands.find((item) => item.path === result.path);
        if (!command) return null;
        const scored = scoreRootSearchFields(searchQuery, [
          { value: result.name, kind: 'label', weight: 1 },
          { value: result.parentPath, kind: 'path', weight: 0.72 },
          { value: result.displayPath, kind: 'path', weight: 0.72 },
          { value: result.path, kind: 'path', weight: 0.68 },
        ]);
        if (!scored.matched) return null;
        const subtype: RootSearchSubtype = result.isDirectory ? 'folder' : 'file';
        const matchKind = coerceMatchKind(result.matchKind, scored.matchKind);
        const weakFolderMatch = subtype === 'folder' && (matchKind === 'contains' || matchKind === 'subsequence' || matchKind === 'path');
        const stableKey = `file:${normalizeRootSearchStableValue(result.path)}`;
        return scoreRootSearchCandidate({
          command: {
            ...command,
            rootSearchStableKey: stableKey,
            rootSearchSource: 'file',
            rootSearchSubtype: subtype,
          },
          source: 'file',
          subtype,
          stableKey,
          label: result.name,
          description: result.displayPath,
          pathOrUrl: result.path,
          matchKind,
          matchScore: scored.matchScore,
          sourceQualityBoost: subtype === 'file' ? 8 : weakFolderMatch ? -10 : 0,
          freshnessBoost: getFileFreshnessBoost(result),
          pathLocationBoost: getFileLocationBoost(result),
          noisePenalty: Math.max(0, Number(result.noisyPathSegmentCount || 0)) * 70,
          depthPenalty: getFileDepthPenalty(result),
        }, searchQuery, rootSearchRanking);
      })
      .filter((candidate): candidate is RootSearchCandidate => Boolean(candidate));
  }, [hasSearchQuery, aiMode, rootBangState, launcherFileResults, fileResultCommands, searchQuery, rootSearchRanking]);

  const browserCandidates = useMemo<RootSearchCandidate[]>(() => {
    if (!browserSearch.enabled || !browserSearch.alphaChromiumRootSearchEnabled || !hasSearchQuery || aiMode || rootBangState.mode !== 'none') return [];
    return browserSearch.getAllResults(searchQuery, browserSearchResultGroups)
      .map((result, index) => {
        const defaultProfile = getDefaultBrowserProfile(browserSearch);
        const sourceProfile = result.nicknameMatch ? getBrowserProfileById(browserSearch, result.sourceProfileId) : null;
        const targetProfile = sourceProfile || defaultProfile;
        const alternateProfile = result.nicknameMatch
          ? getNicknameAlternateBrowserProfile(browserSearch, sourceProfile, getAlternateBrowserProfile(browserSearch))
          : getAlternateBrowserProfile(browserSearch);
        const command = buildBrowserCommand(result, index, targetProfile, alternateProfile, browserSearch.profiles?.length || 0, browserAppIconDataUrls);
        const nicknameMatched = Boolean(result.nicknameMatch);
        const fields = nicknameMatched
          ? [
              { value: result.nickname, kind: 'nickname' as const, weight: 1.08 },
              { value: result.title, kind: 'label' as const, weight: 0.85 },
              { value: result.url, kind: 'url' as const, weight: 0.72 },
            ]
          : [
              { value: result.title, kind: 'label' as const, weight: 1 },
              { value: result.url, kind: 'url' as const, weight: 0.82 },
              { value: result.subtitle, kind: 'description' as const, weight: 0.62 },
            ];
        const scored = scoreRootSearchFields(searchQuery, fields);
        if (!scored.matched) return null;
        const subtype: RootSearchSubtype = nicknameMatched ? 'nickname' : result.kind;
        const stableKey = command.rootSearchStableKey || `browser:${normalizeRootSearchUrl(result.url) || result.id}`;
        let sourceQualityBoost = 0;
        let matchKind = nicknameMatched
          ? coerceMatchKind(result.matchKind, scored.matchKind)
          : coerceMatchKind(result.matchKind, scored.matchKind);

        if (
          !nicknameMatched &&
          matchKind === 'contains' &&
          searchQuery.trim().length >= 3
        ) {
          try {
            const host = new URL(result.url).hostname.replace(/^www\./i, '').toLowerCase();
            const normalizedQuery = searchQuery.trim().toLowerCase();
            if (host === normalizedQuery || host.startsWith(`${normalizedQuery}.`) || host.startsWith(normalizedQuery)) {
              matchKind = 'url';
            }
          } catch {}
        }

        if (result.kind === 'open-tab') {
          sourceQualityBoost += 90;
          const ageMinutes = result.windowLastFocusedAt ? Math.max(0, (Date.now() - result.windowLastFocusedAt) / 60_000) : 240;
          sourceQualityBoost += Math.max(0, 90 - Math.log10(1 + ageMinutes) * 35);
          if (result.active) sourceQualityBoost += 35;
        }
        if (result.kind === 'bookmark') sourceQualityBoost += 65;
        sourceQualityBoost += Math.min(130, Math.log1p(Math.max(0, result.score || result.rawMatchScore || 0)) * 14);
        let noisePenalty = 0;
        if (result.kind === 'history' && (matchKind === 'contains' || matchKind === 'subsequence')) noisePenalty += 120;
        if (result.kind === 'bookmark' && !nicknameMatched && (matchKind === 'contains' || matchKind === 'subsequence')) noisePenalty += 60;
        return scoreRootSearchCandidate({
          command: {
            ...command,
            rootSearchScore: result.score,
          },
          source: 'browser',
          subtype,
          stableKey,
          label: nicknameMatched && result.nickname ? result.nickname : result.title,
          description: result.subtitle,
          pathOrUrl: result.url,
          matchKind,
          matchScore: scored.matchScore,
          sourceQualityBoost,
          freshnessBoost: 0,
          pathLocationBoost: 0,
          noisePenalty,
          depthPenalty: 0,
        }, searchQuery, rootSearchRanking);
      })
      .filter((candidate): candidate is RootSearchCandidate => Boolean(candidate));
  }, [browserSearch, browserSearchResultGroups, hasSearchQuery, searchQuery, aiMode, rootBangState, rootSearchRanking, browserAppIconDataUrls]);

  const rootRankedCandidates = useMemo<RootSearchCandidate[]>(
    () => rankRootSearchCandidates([...commandCandidates, ...fileCandidates, ...browserCandidates]),
    [commandCandidates, fileCandidates, browserCandidates]
  );

  const rootSearchAutoComplete = useMemo(() => {
    if (!hasSearchQuery || aiMode || rootBangState.mode !== 'none') return null;
    if (browserSearch.enabled && !browserSearch.alphaChromiumRootSearchEnabled) {
      const legacyCompletion = browserSearch.getCompletion(searchQuery, browserSearchResultGroups);
      if (legacyCompletion?.completion && legacyCompletion.completion !== searchQuery) {
        return {
          completion: legacyCompletion.completion,
          suffix: legacyCompletion.suffix,
        };
      }
    }
    const completionCandidates = rootRankedCandidates.filter((candidate) =>
      isRootResultPromotionCandidate(candidate, searchQuery)
    );
    const completion = getRootSearchCompletion(searchQuery, completionCandidates);
    if (!completion || completion === searchQuery) return null;
    if (!completion.toLowerCase().startsWith(searchQuery.toLowerCase())) return null;
    const suffix = completion.slice(searchQuery.length);
    return { completion: `${searchQuery}${suffix}`, suffix };
  }, [hasSearchQuery, aiMode, rootBangState, searchQuery, rootRankedCandidates, browserSearch, browserSearchResultGroups]);

  const launcherInputValue = searchQuery;

  const webSearchRootDirectCommand = useMemo<CommandInfo | null>(() => {
    if (aiMode) return null;
    if (rootBangState.mode === 'none' && rootResolvedBrowserInput?.type === 'url') return null;
    const subject = rootBangState.mode === 'active'
      ? rootBangState.query.trim()
      : searchQuery.trim();
    if (!subject) return null;
    const defaultBang = getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
    const activeBang = rootBangState.mode === 'active' ? rootBangState.bang : null;
    const searchSubject = subject.trim();
    if (!searchSubject) return null;
    const provider = activeBang || defaultBang;
    const defaultProfile = getDefaultBrowserProfile(browserSearch);
    const alternateProfile = getAlternateBrowserProfile(browserSearch);
    return {
      id: WEB_SEARCH_ROOT_DIRECT_ID,
      title: activeBang
        ? t('launcher.browserSearch.searchProviderFor', { provider: provider.name, query: searchSubject })
        : t('launcher.browserSearch.searchFor', { query: searchSubject }),
      subtitle: activeBang
        ? t('launcher.browserSearch.bangSubtitle', { bang: activeBang.key })
        : t('launcher.browserSearch.defaultSearch'),
      category: 'system',
      keywords: [searchSubject, provider.name, provider.host, 'search'],
      browserMatchKind: 'search',
      browserResultKind: 'search',
      browserFaviconUrl: getFaviconUrlForHost(provider.host),
      browserActionInput: activeBang ? `${searchSubject} !${activeBang.key}` : searchSubject,
      browserTargetProfileLabel: defaultProfile ? (defaultProfile.displayName || defaultProfile.detectedName || defaultProfile.profileId) : '',
      browserTargetProfileBrowserId: defaultProfile?.browserId,
      browserTargetProfileIconDataUrl: getBrowserIcon(browserAppIconDataUrls, defaultProfile?.browserId) || defaultBrowserIconDataUrl || undefined,
      browserAlternateProfileLabel: alternateProfile?.displayName || alternateProfile?.detectedName || alternateProfile?.profileId || '',
      browserAlternateProfileBrowserId: alternateProfile?.browserId,
      browserAlternateProfileIconDataUrl: getBrowserIcon(browserAppIconDataUrls, alternateProfile?.browserId) || defaultBrowserIconDataUrl || undefined,
      browserProfileCount: browserSearch.profiles?.length || 0,
      rootSearchStableKey: `direct-search:${provider.key}`,
      rootSearchSource: 'direct-search',
      rootSearchSubtype: 'direct-search',
    };
  }, [aiMode, searchQuery, rootBangState, rootResolvedBrowserInput, t, webSearchDefaultBangKey, effectiveSearchBangs, browserSearch, browserAppIconDataUrls, defaultBrowserIconDataUrl]);

  const webSearchRootSuggestionCommands = useMemo<CommandInfo[]>(() => {
    if (aiMode) return [];
    if (rootBangState.mode === 'none' && rootResolvedBrowserInput?.type === 'url') return [];
    const subject = rootBangState.mode === 'active'
      ? rootBangState.query.trim()
      : searchQuery.trim();
    if (!subject) return [];
    const defaultBang = getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
    const activeBang = rootBangState.mode === 'active' ? rootBangState.bang : null;
    const searchSubject = subject.trim();
    if (!searchSubject) return [];
    const provider = activeBang || defaultBang;
    const defaultProfile = getDefaultBrowserProfile(browserSearch);
    const alternateProfile = getAlternateBrowserProfile(browserSearch);
    const commands: CommandInfo[] = [];
    for (const suggestion of rootWebSearchSuggestions) {
      const normalized = String(suggestion || '').trim();
      if (!normalized || normalized.toLowerCase() === searchSubject.toLowerCase()) continue;
      commands.push({
        id: `${WEB_SEARCH_ROOT_SUGGESTION_PREFIX}${normalized}`,
        title: normalized,
        subtitle: activeBang
          ? t('launcher.browserSearch.bangSubtitle', { bang: activeBang.key })
          : t('launcher.browserSearch.defaultSearch'),
        category: 'system',
        keywords: [normalized, provider.name, provider.host, 'suggestion'],
        browserMatchKind: 'search',
        browserResultKind: 'search',
        browserFaviconUrl: getFaviconUrlForHost(provider.host),
        browserActionInput: activeBang ? `${normalized} !${activeBang.key}` : normalized,
        browserTargetProfileLabel: defaultProfile ? (defaultProfile.displayName || defaultProfile.detectedName || defaultProfile.profileId) : '',
        browserTargetProfileBrowserId: defaultProfile?.browserId,
        browserTargetProfileIconDataUrl: getBrowserIcon(browserAppIconDataUrls, defaultProfile?.browserId) || defaultBrowserIconDataUrl || undefined,
        browserAlternateProfileLabel: alternateProfile?.displayName || alternateProfile?.detectedName || alternateProfile?.profileId || '',
        browserAlternateProfileBrowserId: alternateProfile?.browserId,
        browserAlternateProfileIconDataUrl: getBrowserIcon(browserAppIconDataUrls, alternateProfile?.browserId) || defaultBrowserIconDataUrl || undefined,
        browserProfileCount: browserSearch.profiles?.length || 0,
      });
    }
    return commands;
  }, [aiMode, searchQuery, rootBangState, rootResolvedBrowserInput, rootWebSearchSuggestions, t, webSearchDefaultBangKey, effectiveSearchBangs, browserSearch, browserAppIconDataUrls, defaultBrowserIconDataUrl]);

  const rootBangCandidateCommands = useMemo<CommandInfo[]>(() => {
    if (rootBangState.mode !== 'selecting') return [];
    return getSortedSearchBangs(enabledSearchBangs, rootBangState.token, webSearchBangUsage, WEB_SEARCH_ACTIVE_BANG_SUGGESTION_LIMIT)
      .map((bang): CommandInfo => ({
        id: `${WEB_SEARCH_ROOT_BANG_PREFIX}${bang.key}`,
        title: `!${bang.key} ${bang.name}`,
        subtitle: [bang.category, bang.subcategory, bang.host].filter(Boolean).join(' - '),
        category: 'system',
        keywords: [bang.key, ...(bang.aliases || []), bang.name, bang.host, bang.category || '', bang.subcategory || ''],
        browserMatchKind: 'search',
        browserResultKind: 'search',
        browserFaviconUrl: getFaviconUrlForHost(bang.host),
        browserActionInput: bang.key,
      }));
  }, [enabledSearchBangs, rootBangState, webSearchBangUsage]);

  const rootSearchSectionAssembly = useMemo(() => assembleRootSearchSections({
    hasSearchQuery,
    rootBangMode: rootBangState.mode,
    browserSearchSyntheticCommand,
    rootRankedCandidates,
    browserCandidates,
    fileCandidates,
    webSearchRootDirectCommand,
    webSearchRootSuggestionCommands,
    rootBangCandidateCommands,
    webSearchSuggestionsEnabled,
    searchQuery,
    t,
  }), [
    browserCandidates,
    browserSearchSyntheticCommand,
    fileCandidates,
    hasSearchQuery,
    rootBangCandidateCommands,
    rootBangState.mode,
    rootRankedCandidates,
    searchQuery,
    t,
    webSearchRootDirectCommand,
    webSearchRootSuggestionCommands,
    webSearchSuggestionsEnabled,
  ]);

  const {
    queryResultCommands,
    queryBrowserSectionCommands,
    querySearchSectionCommands,
    queryFileSectionCommands,
  } = rootSearchSectionAssembly;

  const displayCommands = useMemo(() => {
    if (rootBangState.mode === 'selecting') return rootSearchSectionAssembly.displayCommands;
    if (rootBangState.mode === 'active') return rootSearchSectionAssembly.displayCommands;
    if (hasSearchQuery) {
      return rootSearchSectionAssembly.displayCommands;
    }
    const all = [
      ...browserSearchResultCommands,
      ...webSearchRootSuggestionCommands,
      ...groupedCommands.contextual,
      ...groupedCommands.pinned,
      ...groupedCommands.recent,
      ...groupedCommands.other,
      ...groupedCommands.files,
    ];
    // alwaysOnTop commands (e.g. update banner) must be the very first items,
    // above pinned, contextual, and everything else.
    const top = all.filter((c) => c.alwaysOnTop);
    const rest = all.filter((c) => !c.alwaysOnTop);
    const ordered = [...top, ...rest];
    if (browserSearchSyntheticCommand) {
      return [
        browserSearchSyntheticCommand,
        ...(webSearchRootDirectCommand ? [webSearchRootDirectCommand] : []),
        ...ordered,
      ];
    }
    if (webSearchRootDirectCommand) {
      if (ordered.length === 0) return [webSearchRootDirectCommand];
      return [ordered[0], webSearchRootDirectCommand, ...ordered.slice(1)];
    }
    return ordered;
  }, [
    webSearchRootDirectCommand,
    webSearchRootSuggestionCommands,
    browserSearchResultCommands,
    groupedCommands,
    browserSearchSyntheticCommand,
    rootBangState.mode,
    hasSearchQuery,
    rootSearchSectionAssembly,
  ]);

  const launcherCommandSections = useMemo<LauncherCommandSection[]>(() => {
    if (rootBangState.mode === 'selecting') return rootSearchSectionAssembly.launcherCommandSections;
    if (rootBangState.mode === 'active') return rootSearchSectionAssembly.launcherCommandSections;
    if (hasSearchQuery) return rootSearchSectionAssembly.launcherCommandSections;

    const topCommandIds = new Set(displayCommands.filter((command) => command.alwaysOnTop).map((command) => command.id));
    const directSearchIndex = displayCommands.findIndex((command) => command.id === WEB_SEARCH_ROOT_DIRECT_ID);

    if (directSearchIndex >= 0) {
      topCommandIds.add(WEB_SEARCH_ROOT_DIRECT_ID);
      if (directSearchIndex === 1 && displayCommands[0]) {
        topCommandIds.add(displayCommands[0].id);
      }
    }

    const allTopItems = displayCommands.filter((command) => topCommandIds.has(command.id));
    const topIds = new Set(allTopItems.map((command) => command.id));
    const strip = (items: CommandInfo[]) => items.filter((command) => !topIds.has(command.id));

    return [
      { title: '', items: allTopItems },
      { title: t('launcher.categories.browser'), items: strip(browserSearchResultCommands) },
      { title: t('launcher.categories.search'), items: strip(webSearchRootSuggestionCommands) },
      { title: t('launcher.sections.selectedText'), items: strip(groupedCommands.contextual) },
      { title: t('launcher.sections.pinned'), items: strip(groupedCommands.pinned) },
      { title: t('launcher.categories.recent'), items: strip(groupedCommands.recent) },
      { title: t('launcher.sections.results'), items: strip(groupedCommands.other) },
      { title: t('launcher.categories.files'), items: strip(groupedCommands.files) },
    ].filter((section) => section.items.length > 0);
  }, [
    browserSearchResultCommands,
    displayCommands,
    groupedCommands,
    hasSearchQuery,
    rootBangState.mode,
    rootSearchSectionAssembly,
    t,
    webSearchRootSuggestionCommands,
  ]);

  const selectedCommand =
    selectedIndex >= calcOffset
      ? displayCommands[selectedIndex - calcOffset]
      : null;
  const selectedFileResultPath = useMemo(
    () => getFileResultPathFromCommand(selectedCommand),
    [selectedCommand]
  );

  return {
    syncCalcResult,
    asyncCalcResult,
    calcResult,
    calcOffset,
    contextualCommands,
    filteredCommands,
    sourceCommands,
    visibleSourceCommands,
    fileResultCommands,
    pinnedFileCommands,
    groupedCommands,
    launcherInputValue,
    rootSearchAutoComplete,
    rootRankedCandidates,
    browserSearchTopResult,
    browserSearchSyntheticCommand,
    browserSearchResultCommands,
    webSearchRootDirectCommand,
    webSearchRootSuggestionCommands,
    rootBangCandidateCommands,
    displayCommands,
    launcherCommandSections,
    selectedCommand,
    selectedFileResultPath,
  };
}
