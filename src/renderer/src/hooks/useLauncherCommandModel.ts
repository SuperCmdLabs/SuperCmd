import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BrowserSearchResultGroupSetting,
  CommandInfo,
  IndexedFileSearchResult,
  WebSearchBangUsageSetting,
} from '../../types/electron';
import type { BrowserSearchResult, useBrowserSearch } from './useBrowserSearch';
import type { CalcResult } from '../smart-calculator';
import { tryCalculate, tryCalculateAsync } from '../smart-calculator';
import { filterCommands } from '../utils/command-helpers';
import {
  asTildePath,
  buildFileResultCommandId,
  getFileBasename,
  getFileDirname,
  getFileResultPathFromCommand,
} from '../utils/launcher-file-results';
import { MAX_RECENT_SECTION_ITEMS } from '../utils/launcher-misc';
import type { BrowserInputResolution } from '../utils/browser-input-resolver';
import {
  BROWSER_SEARCH_OPEN_URL_ID,
  BROWSER_SEARCH_RESULT_ID_PREFIX,
  BROWSER_SEARCH_SHOW_ALL_RESULTS_ID,
  normalizeBrowserCommandUrl,
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
  browserSearchAutoComplete: { completion: string } | null;
  browserSearchSkipAutoComplete: boolean;
  aiMode: boolean;

  rootBangState: BangParseState;
  enabledSearchBangs: SearchBangDefinition[];
  effectiveSearchBangs: SearchBangDefinition[];
  webSearchDefaultBangKey: string;
  webSearchBangUsage: Record<string, WebSearchBangUsageSetting>;
  rootWebSearchSuggestions: string[];
  webSearchSuggestionLimit: number;

  selectedIndex: number;
  launcherInputValue: string;
  defaultBrowserIconDataUrl: string;

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
  browserSearchAutoComplete,
  aiMode,
  rootBangState,
  enabledSearchBangs,
  effectiveSearchBangs,
  webSearchDefaultBangKey,
  webSearchBangUsage,
  rootWebSearchSuggestions,
  selectedIndex,
  launcherInputValue,
  defaultBrowserIconDataUrl,
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
  }, [hasSearchQuery, visibleSourceCommands, pinnedCommands, pinnedFileCommands, recentCommands, recentCommandLaunchCounts, selectedTextSnapshot, fileResultCommands]);

  const browserSearchTopResult = useMemo<BrowserSearchResult | null>(() => {
    if (!browserSearch.enabled) return null;
    if (aiMode) return null;
    if (!searchQuery.trim()) return null;
    if (rootBangState.mode !== 'none') return null;
    return browserSearch.getTopResult(searchQuery, browserSearchResultGroups);
  }, [browserSearch, browserSearchResultGroups, searchQuery, aiMode, rootBangState]);

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
    const subject = launcherInputValue.trim();
    if (!subject) return null;
    const resolved = rootResolvedBrowserInput;
    if (resolved?.type === 'url') {
      const typedSubject = searchQuery.trim();
      const browserMatchKind = browserSearch.getMatchKind(
        typedSubject,
        browserSearchAutoComplete as Parameters<typeof browserSearch.getMatchKind>[1]
      );
      const hasOpenTabMatch = browserMatchKind === 'open-tab';
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
      };
    }
    if (browserSearchTopResult) {
      return {
        id: BROWSER_SEARCH_OPEN_URL_ID,
        title: browserSearchTopResult.title,
        subtitle: browserSearchTopResult.subtitle,
        category: 'system',
        keywords: [browserSearchTopResult.title, browserSearchTopResult.subtitle, browserSearchTopResult.url],
        alwaysOnTop: true,
        browserMatchKind: browserSearchTopResult.kind === 'open-tab' ? 'open-tab' : 'history',
        browserResultKind: browserSearchTopResult.kind,
        browserFaviconUrl: browserSearchTopResult.faviconUrl,
        browserActionInput: browserSearchTopResult.actionInput,
        browserFocusAvailable: browserSearchTopResult.focusAvailable,
      };
    }
    return null;
  }, [browserSearch, browserSearchAutoComplete, browserSearchTopResult, rootResolvedBrowserInput, searchQuery, launcherInputValue, defaultBrowserIconDataUrl, aiMode, t]);

  const browserSearchResultCommands = useMemo<CommandInfo[]>(() => {
    if (!browserSearch.enabled) return [];
    if (aiMode) return [];
    if (rootBangState.mode !== 'none') return [];
    const subject = searchQuery;
    if (!subject.trim()) return [];
    const topUrl = rootResolvedBrowserInput?.type === 'url'
      ? normalizeBrowserCommandUrl(rootResolvedBrowserInput.url)
      : browserSearchTopResult
        ? normalizeBrowserCommandUrl(browserSearchTopResult.url)
        : '';
    const limitedResults = browserSearch
      .getResults(subject, browserSearchResultGroups)
      .filter((result) => normalizeBrowserCommandUrl(result.url) !== topUrl);
    const allCount = browserSearch.getAllResults(subject, browserSearchResultGroups).length;
    const commands: CommandInfo[] = limitedResults.map((result, index): CommandInfo => ({
      id: `${BROWSER_SEARCH_RESULT_ID_PREFIX}${result.kind}:${index}:${result.id}`,
      title: result.title,
      subtitle: result.subtitle,
      category: 'system',
      keywords: [result.title, result.subtitle, result.url],
      browserMatchKind: result.kind === 'open-tab' ? 'open-tab' : 'history',
      browserResultKind: result.kind,
      browserFaviconUrl: result.faviconUrl,
      browserActionInput: result.actionInput,
      browserFocusAvailable: result.focusAvailable,
    }));
    if (allCount > 0) {
      commands.push({
        id: BROWSER_SEARCH_SHOW_ALL_RESULTS_ID,
        title: t('launcher.browserSearch.showAll'),
        subtitle: t('launcher.browserSearch.showAllSubtitle', { count: String(allCount) }),
        category: 'system',
        keywords: [subject, 'browser', 'results'],
        browserActionInput: subject,
      });
    }
    return commands;
  }, [browserSearch, browserSearchResultGroups, browserSearchTopResult, rootResolvedBrowserInput, searchQuery, aiMode, rootBangState, t]);

  const webSearchRootDirectCommand = useMemo<CommandInfo | null>(() => {
    if (aiMode) return null;
    if (rootBangState.mode === 'none' && rootResolvedBrowserInput?.type === 'url') return null;
    const subject = rootBangState.mode === 'active'
      ? rootBangState.query.trim()
      : launcherInputValue.trim();
    if (!subject) return null;
    const defaultBang = getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
    const activeBang = rootBangState.mode === 'active' ? rootBangState.bang : null;
    const searchSubject = subject.trim();
    if (!searchSubject) return null;
    const provider = activeBang || defaultBang;
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
    };
  }, [aiMode, launcherInputValue, rootBangState, rootResolvedBrowserInput, t, webSearchDefaultBangKey, effectiveSearchBangs]);

  const webSearchRootSuggestionCommands = useMemo<CommandInfo[]>(() => {
    if (aiMode) return [];
    if (rootBangState.mode === 'none' && rootResolvedBrowserInput?.type === 'url') return [];
    const subject = rootBangState.mode === 'active'
      ? rootBangState.query.trim()
      : launcherInputValue.trim();
    if (!subject) return [];
    const defaultBang = getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
    const activeBang = rootBangState.mode === 'active' ? rootBangState.bang : null;
    const searchSubject = subject.trim();
    if (!searchSubject) return [];
    const provider = activeBang || defaultBang;
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
      });
    }
    return commands;
  }, [aiMode, launcherInputValue, rootBangState, rootResolvedBrowserInput, rootWebSearchSuggestions, t, webSearchDefaultBangKey, effectiveSearchBangs]);

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

  const displayCommands = useMemo(() => {
    if (rootBangState.mode === 'selecting') {
      return rootBangCandidateCommands;
    }
    if (rootBangState.mode === 'active') {
      return [
        ...(webSearchRootDirectCommand ? [webSearchRootDirectCommand] : []),
        ...webSearchRootSuggestionCommands,
      ];
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
  }, [webSearchRootDirectCommand, webSearchRootSuggestionCommands, rootBangCandidateCommands, browserSearchResultCommands, groupedCommands, browserSearchSyntheticCommand, rootBangState]);

  const launcherCommandSections = useMemo<LauncherCommandSection[]>(() => {
    if (rootBangState.mode === 'selecting') {
      return [
        { title: t('launcher.browserSearch.bangSections.matching'), items: displayCommands },
      ];
    }

    if (rootBangState.mode === 'active') {
      return [
        { title: '', items: webSearchRootDirectCommand ? [webSearchRootDirectCommand] : [] },
        { title: t('launcher.categories.search'), items: webSearchRootSuggestionCommands },
      ].filter((section) => section.items.length > 0);
    }

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
    rootBangState,
    t,
    webSearchRootDirectCommand,
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
