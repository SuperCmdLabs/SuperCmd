import type {
  CommandInfo,
  IndexedFileSearchResult,
} from '../../types/electron';
import {
  normalizeRootSearchStableValue,
  scoreRootSearchCandidate,
  scoreRootSearchFields,
  type MatchKind,
  type RootSearchCandidate,
  type RootSearchRankingState,
  type RootSearchSubtype,
} from './root-search-ranking';

export function coerceRootSearchMatchKind(value: string | undefined, fallback: MatchKind): MatchKind {
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

export function buildLauncherFileResultCommandByPath(
  fileResultCommands: readonly CommandInfo[]
): Map<string, CommandInfo> {
  const commandByPath = new Map<string, CommandInfo>();
  for (const command of fileResultCommands) {
    if (typeof command.path !== 'string') continue;
    if (!commandByPath.has(command.path)) {
      commandByPath.set(command.path, command);
    }
  }
  return commandByPath;
}

export function buildLauncherFileCandidates({
  launcherFileResults,
  fileResultCommandByPath,
  searchQuery,
  rootSearchRanking,
}: {
  launcherFileResults: readonly IndexedFileSearchResult[];
  fileResultCommandByPath: ReadonlyMap<string, CommandInfo>;
  searchQuery: string;
  rootSearchRanking: RootSearchRankingState;
}): RootSearchCandidate[] {
  return launcherFileResults
    .map((result) => {
      const command = fileResultCommandByPath.get(result.path);
      if (!command) return null;
      const scored = scoreRootSearchFields(searchQuery, [
        { value: result.name, kind: 'label', weight: 1 },
        { value: result.parentPath, kind: 'path', weight: 0.72 },
        { value: result.displayPath, kind: 'path', weight: 0.72 },
        { value: result.path, kind: 'path', weight: 0.68 },
      ]);
      if (!scored.matched) return null;
      const subtype: RootSearchSubtype = result.isDirectory ? 'folder' : 'file';
      const matchKind = coerceRootSearchMatchKind(result.matchKind, scored.matchKind);
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
}
