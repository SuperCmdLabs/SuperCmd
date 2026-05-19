import type { CommandInfo } from '../../types/electron';
import { MAX_LAUNCHER_FILE_RESULTS } from './launcher-file-results';
import {
  ROOT_SEARCH_PROMOTION_SCORE,
  ROOT_SEARCH_RESULTS_LIMIT,
  normalizeRootSearchText,
  rankRootSearchCandidates,
  tokenizeRootSearchQuery,
  type RootSearchCandidate,
} from './root-search-ranking';

export type RootSearchSectionAssemblyInput = {
  hasSearchQuery: boolean;
  rootBangMode: 'none' | 'selecting' | 'active';
  browserSearchSyntheticCommand: CommandInfo | null;
  rootRankedCandidates: RootSearchCandidate[];
  browserCandidates: RootSearchCandidate[];
  fileCandidates: RootSearchCandidate[];
  webSearchRootDirectCommand: CommandInfo | null;
  webSearchRootSuggestionCommands: CommandInfo[];
  rootBangCandidateCommands: CommandInfo[];
  webSearchSuggestionsEnabled: boolean;
  searchQuery: string;
  t: (key: string) => string;
};

export type RootSearchSection = {
  title: string;
  items: CommandInfo[];
};

export type RootSearchSectionAssemblyResult = {
  queryResultCommands: CommandInfo[];
  queryBrowserSectionCommands: CommandInfo[];
  querySearchSectionCommands: CommandInfo[];
  queryFileSectionCommands: CommandInfo[];
  displayCommands: CommandInfo[];
  launcherCommandSections: RootSearchSection[];
};

const BROAD_FILE_PATH_QUERY_TERMS = new Set([
  'desktop',
  'documents',
  'downloads',
  'users',
  'user',
  'home',
  'library',
  'application',
  'support',
]);

function isFocusedFilePathCandidate(candidate: RootSearchCandidate, query: string): boolean {
  if (candidate.source !== 'file' || !candidate.pathOrUrl) return false;
  if (candidate.subtype !== 'file' && candidate.subtype !== 'folder') return false;
  const terms = tokenizeRootSearchQuery(query).filter((term) =>
    term.length >= 3 && !BROAD_FILE_PATH_QUERY_TERMS.has(term)
  );
  const normalizedLabel = normalizeRootSearchText(candidate.label);
  if (terms.length < 2 && !terms.some((term) => !normalizedLabel.includes(term))) return false;

  const normalizedPath = normalizeRootSearchText(candidate.pathOrUrl);
  const hasPathNarrowingTerm = terms.some((term) =>
    !normalizedLabel.includes(term) && normalizedPath.includes(term)
  );
  if (!hasPathNarrowingTerm) return false;

  return (
    candidate.finalScore >= 600 &&
    candidate.depthPenalty <= 180 &&
    candidate.noisePenalty <= 140
  );
}

function isSearchEngineHistoryCandidate(candidate: RootSearchCandidate): boolean {
  if (candidate.subtype !== 'history' || !candidate.pathOrUrl) return false;
  try {
    const host = new URL(candidate.pathOrUrl).hostname.replace(/^www\./i, '').toLowerCase();
    return (
      host === 'google.com' ||
      host.endsWith('.google.com') ||
      host === 'bing.com' ||
      host.endsWith('.bing.com') ||
      host === 'duckduckgo.com' ||
      host.endsWith('.duckduckgo.com') ||
      host === 'search.brave.com'
    );
  } catch {
    return false;
  }
}

export function isRootResultPromotionCandidate(candidate: RootSearchCandidate, query = ''): boolean {
  const focusedFilePathCandidate = isFocusedFilePathCandidate(candidate, query);
  if (candidate.finalScore < (focusedFilePathCandidate ? 600 : ROOT_SEARCH_PROMOTION_SCORE)) return false;

  if (candidate.subtype === 'nickname') return true;

  if (candidate.subtype === 'app' || candidate.subtype === 'quicklink') {
    return candidate.matchKind !== 'contains' && candidate.matchKind !== 'subsequence' && candidate.matchKind !== 'description';
  }

  if (candidate.subtype === 'file' || candidate.subtype === 'folder') {
    if (candidate.matchKind === 'exact') return true;
    if (focusedFilePathCandidate) return true;
    if (candidate.matchKind === 'prefix' || candidate.matchKind === 'token-prefix' || candidate.matchKind === 'compact-prefix') {
      if (candidate.subtype === 'folder' && candidate.depthPenalty === 0 && candidate.noisePenalty === 0) return true;
      return candidate.depthPenalty <= 60 && candidate.noisePenalty === 0 && candidate.finalScore >= 760;
    }
    return false;
  }

  if (candidate.subtype === 'open-tab' || candidate.subtype === 'bookmark') {
    return candidate.finalScore >= 820 && (
      candidate.matchKind === 'exact' ||
      candidate.matchKind === 'prefix' ||
      candidate.matchKind === 'token-prefix' ||
      candidate.matchKind === 'url'
    );
  }

  if (candidate.subtype === 'history') {
    if (candidate.finalScore >= 620 && (candidate.matchKind === 'exact' || candidate.matchKind === 'url')) return true;
    return candidate.finalScore >= 820 && !isSearchEngineHistoryCandidate(candidate) && (
      candidate.matchKind === 'prefix' ||
      candidate.matchKind === 'token-prefix'
    );
  }

  return candidate.finalScore >= 780 && (
    candidate.matchKind === 'exact' ||
    candidate.matchKind === 'alias-exact' ||
    candidate.matchKind === 'prefix' ||
    candidate.matchKind === 'token-prefix'
  );
}

function getCommandStableKey(command: CommandInfo): string {
  return String(command.rootSearchStableKey || command.id || '');
}

function assembleQueryResults(input: RootSearchSectionAssemblyInput): CommandInfo[] {
  if (!input.hasSearchQuery || input.rootBangMode !== 'none') return [];
  if (input.browserSearchSyntheticCommand) {
    const openUrlKey = getCommandStableKey(input.browserSearchSyntheticCommand);
    return [
      input.browserSearchSyntheticCommand,
      ...input.rootRankedCandidates
        .filter((candidate) => candidate.stableKey !== openUrlKey)
        .filter((candidate) => isRootResultPromotionCandidate(candidate, input.searchQuery))
        .slice(0, ROOT_SEARCH_RESULTS_LIMIT - 1)
        .map((candidate) => candidate.command),
    ];
  }

  const resultKeys = new Set<string>();
  const results: CommandInfo[] = [];
  const addResult = (candidate: RootSearchCandidate) => {
    if (resultKeys.has(candidate.stableKey)) return;
    results.push(candidate.command);
    resultKeys.add(candidate.stableKey);
  };
  input.rootRankedCandidates
    .filter((candidate) => isRootResultPromotionCandidate(candidate, input.searchQuery))
    .slice(0, ROOT_SEARCH_RESULTS_LIMIT - (input.webSearchRootDirectCommand ? 1 : 0))
    .forEach(addResult);
  if (input.webSearchRootDirectCommand) {
    results.push(input.webSearchRootDirectCommand);
  }
  return results;
}

export function assembleRootSearchSections(input: RootSearchSectionAssemblyInput): RootSearchSectionAssemblyResult {
  const queryResultCommands = assembleQueryResults(input);
  const promotedKeys = new Set(queryResultCommands.map(getCommandStableKey).filter(Boolean));
  const queryBrowserSectionCommands =
    input.hasSearchQuery && input.rootBangMode === 'none'
      ? rankRootSearchCandidates(input.browserCandidates)
          .filter((candidate) => !promotedKeys.has(candidate.stableKey))
          .slice(0, MAX_LAUNCHER_FILE_RESULTS)
          .map((candidate) => candidate.command)
      : [];
  const queryFileSectionCommands =
    input.hasSearchQuery && input.rootBangMode === 'none'
      ? rankRootSearchCandidates(input.fileCandidates)
          .filter((candidate) => !promotedKeys.has(candidate.stableKey))
          .slice(0, MAX_LAUNCHER_FILE_RESULTS)
          .map((candidate) => candidate.command)
      : [];
  const querySearchSectionCommands =
    input.hasSearchQuery && input.rootBangMode === 'none' && input.webSearchSuggestionsEnabled
      ? input.webSearchRootSuggestionCommands.slice(0, MAX_LAUNCHER_FILE_RESULTS)
      : [];

  if (input.rootBangMode === 'selecting') {
    const displayCommands = input.webSearchSuggestionsEnabled ? input.rootBangCandidateCommands : [];
    return {
      queryResultCommands,
      queryBrowserSectionCommands,
      querySearchSectionCommands,
      queryFileSectionCommands,
      displayCommands,
      launcherCommandSections: input.webSearchSuggestionsEnabled
        ? [{ title: input.t('launcher.browserSearch.bangSections.matching'), items: displayCommands }].filter((section) => section.items.length > 0)
        : [],
    };
  }

  if (input.rootBangMode === 'active') {
    const displayCommands = [
      ...(input.webSearchRootDirectCommand ? [input.webSearchRootDirectCommand] : []),
      ...(input.webSearchSuggestionsEnabled ? input.webSearchRootSuggestionCommands : []),
    ];
    return {
      queryResultCommands,
      queryBrowserSectionCommands,
      querySearchSectionCommands,
      queryFileSectionCommands,
      displayCommands,
      launcherCommandSections: [
        { title: '', items: input.webSearchRootDirectCommand ? [input.webSearchRootDirectCommand] : [] },
        { title: input.t('launcher.categories.search'), items: input.webSearchSuggestionsEnabled ? input.webSearchRootSuggestionCommands : [] },
      ].filter((section) => section.items.length > 0),
    };
  }

  const displayCommands = input.hasSearchQuery
    ? [
        ...queryResultCommands,
        ...queryBrowserSectionCommands,
        ...querySearchSectionCommands,
        ...queryFileSectionCommands,
      ]
    : [];
  return {
    queryResultCommands,
    queryBrowserSectionCommands,
    querySearchSectionCommands,
    queryFileSectionCommands,
    displayCommands,
    launcherCommandSections: input.hasSearchQuery
      ? [
          { title: input.t('launcher.sections.results'), items: queryResultCommands },
          { title: input.t('launcher.categories.browser'), items: queryBrowserSectionCommands },
          { title: input.t('launcher.categories.search'), items: querySearchSectionCommands },
          { title: input.t('launcher.categories.files'), items: queryFileSectionCommands },
        ].filter((section) => section.items.length > 0)
      : [],
  };
}
