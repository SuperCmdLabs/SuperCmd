import type { CommandInfo } from '../../types/electron';
export type {
  RootSearchRankingEntry,
  RootSearchRankingInputHistory,
  RootSearchRankingState,
} from '../../../shared/root-search-ranking-state';
export {
  pruneRootSearchRanking,
  recordRootSearchLaunchInState,
} from '../../../shared/root-search-ranking-state';
import type { RootSearchRankingState } from '../../../shared/root-search-ranking-state';

export type RootSearchSource =
  | 'command'
  | 'file'
  | 'browser'
  | 'open-url'
  | 'direct-search';

export type RootSearchSubtype =
  | 'app'
  | 'system-command'
  | 'extension-command'
  | 'script-command'
  | 'quicklink'
  | 'file'
  | 'folder'
  | 'open-tab'
  | 'bookmark'
  | 'history'
  | 'nickname'
  | 'open-url'
  | 'direct-search';

export type MatchKind =
  | 'exact'
  | 'alias-exact'
  | 'nickname-exact'
  | 'prefix'
  | 'token-prefix'
  | 'compact-prefix'
  | 'word-boundary-fuzzy'
  | 'contains'
  | 'subsequence'
  | 'description'
  | 'path'
  | 'url';

export type RootSearchCandidate = {
  command: CommandInfo;
  source: RootSearchSource;
  subtype: RootSearchSubtype;
  stableKey: string;

  label: string;
  description?: string;
  pathOrUrl?: string;

  matchKind: MatchKind;
  matchScore: number;

  tierBoost: number;
  sourceQualityBoost: number;
  frecencyBoost: number;
  adaptiveInputBoost: number;
  freshnessBoost: number;
  pathLocationBoost: number;

  noisePenalty: number;
  depthPenalty: number;

  finalScore: number;

  isProtectedIntentMatch: boolean;
  isNicknameMatch: boolean;
  isOrganicBrowserResult: boolean;
};

export type RootSearchFieldKind = 'label' | 'alias' | 'nickname' | 'description' | 'path' | 'url';

export type RootSearchScoringField = {
  value: string | undefined;
  kind: RootSearchFieldKind;
  weight?: number;
};

export type RootSearchScoreResult = {
  matched: boolean;
  matchKind: MatchKind;
  matchScore: number;
};

export type PrecompiledRootSearchQueryTerm = {
  normalized: string;
  compact: string;
};

export type PrecompiledRootSearchQuery = {
  fullQuery: string;
  terms: PrecompiledRootSearchQueryTerm[];
};

export type PrecompiledRootSearchScoringField = {
  raw: string;
  normalized: string;
  compact: string;
  tokens: string[];
  boundaryInitials: string;
  kind: RootSearchFieldKind;
  weight: number;
  isSecondaryField: boolean;
  secondaryKind: MatchKind;
};

const SEARCH_SEPARATOR_REGEX = /[^\p{L}\p{N}]+/gu;
const COMBINING_MARK_REGEX = /\p{M}/gu;
const DAY = 24 * 60 * 60 * 1000;

export const ROOT_SEARCH_RESULTS_LIMIT = 8;
export const ROOT_SEARCH_PROMOTION_SCORE = 700;

export const TIER_BOOST: Record<RootSearchSubtype, number> = {
  app: 155,
  file: 125,
  folder: 115,
  nickname: 145,
  quicklink: 105,
  'extension-command': 85,
  'script-command': 85,
  'system-command': 75,
  'open-tab': 45,
  bookmark: 35,
  history: 0,
  'open-url': 1000,
  'direct-search': 0,
};

const MATCH_KIND_RANK: Record<MatchKind, number> = {
  exact: 12,
  'alias-exact': 12,
  'nickname-exact': 12,
  prefix: 11,
  'token-prefix': 10,
  'compact-prefix': 9,
  'word-boundary-fuzzy': 8,
  contains: 7,
  subsequence: 6,
  description: 5,
  path: 4,
  url: 4,
};

export function normalizeRootSearchText(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(COMBINING_MARK_REGEX, '')
    .toLowerCase()
    .replace(SEARCH_SEPARATOR_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactRootSearchText(value: string): string {
  return normalizeRootSearchText(value).replace(SEARCH_SEPARATOR_REGEX, '').replace(/\s+/g, '');
}

function tokenizeNormalizedRootSearchText(normalized: string): string[] {
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

export function tokenizeRootSearchQuery(value: string): string[] {
  const normalized = normalizeRootSearchText(value);
  return tokenizeNormalizedRootSearchText(normalized);
}

export function normalizeRootSearchStableValue(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\/+$/, '');
}

export function normalizeRootSearchUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return normalizeRootSearchStableValue(raw);
  }
}

export function normalizeQueryForInputHistory(query: string): string {
  return normalizeRootSearchText(query).slice(0, 120);
}

function isSubsequenceMatch(needle: string, haystack: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  let needleIndex = 0;
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) needleIndex += 1;
  }
  return needleIndex === needle.length;
}

function getRootSearchBoundaryInitials(value: string): string {
  const boundaryChars = String(value || '').match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) || [];
  const camelInitials = boundaryChars.map((part) => part[0]).join('');
  return compactRootSearchText(camelInitials);
}

export function precompileRootSearchQuery(query: string): PrecompiledRootSearchQuery {
  const fullQuery = normalizeRootSearchText(query);
  return {
    fullQuery,
    terms: tokenizeNormalizedRootSearchText(fullQuery).map((term) => ({
      normalized: normalizeRootSearchText(term),
      compact: compactRootSearchText(term),
    })),
  };
}

function getRootSearchFieldWeight(field: RootSearchScoringField): number {
  return field.weight ?? (field.kind === 'label' ? 1 : field.kind === 'alias' || field.kind === 'nickname' ? 1.04 : 0.72);
}

function getSecondaryRootSearchMatchKind(field: RootSearchScoringField): MatchKind {
  return field.kind === 'url' ? 'url' : field.kind === 'path' ? 'path' : 'description';
}

export function precompileRootSearchScoringField(field: RootSearchScoringField): PrecompiledRootSearchScoringField {
  const raw = String(field.value || '');
  const normalized = normalizeRootSearchText(raw);
  const isSecondaryField = field.kind === 'description' || field.kind === 'path' || field.kind === 'url';
  return {
    raw,
    normalized,
    compact: normalized ? compactRootSearchText(raw) : '',
    tokens: tokenizeNormalizedRootSearchText(normalized),
    boundaryInitials: raw ? getRootSearchBoundaryInitials(raw) : '',
    kind: field.kind,
    weight: getRootSearchFieldWeight(field),
    isSecondaryField,
    secondaryKind: getSecondaryRootSearchMatchKind(field),
  };
}

export function precompileRootSearchScoringFields(fields: RootSearchScoringField[]): PrecompiledRootSearchScoringField[] {
  return fields.map(precompileRootSearchScoringField);
}

function scorePrecompiledSingleField(
  term: PrecompiledRootSearchQueryTerm,
  fullQuery: string,
  field: PrecompiledRootSearchScoringField
): RootSearchScoreResult {
  if (!field.normalized) return { matched: false, matchKind: 'subsequence', matchScore: 0 };

  let kind: MatchKind | null = null;
  let baseScore = 0;

  if (field.normalized === fullQuery || field.normalized === term.normalized) {
    kind = field.kind === 'alias' ? 'alias-exact' : field.kind === 'nickname' ? 'nickname-exact' : 'exact';
    baseScore = 1000;
  } else if (field.normalized.startsWith(term.normalized)) {
    kind = 'prefix';
    baseScore = 900;
  } else if (field.tokens.some((token) => token.startsWith(term.normalized))) {
    kind = 'token-prefix';
    baseScore = 780;
  } else if (term.compact && field.compact.startsWith(term.compact)) {
    kind = 'compact-prefix';
    baseScore = 740;
  } else if (term.compact.length >= 2 && field.boundaryInitials.startsWith(term.compact)) {
    kind = 'word-boundary-fuzzy';
    const compactness = Math.max(0, 1 - Math.max(0, field.compact.length - term.compact.length) / 24);
    baseScore = 620 + Math.round(compactness * 110);
  } else if (term.normalized.length >= 2 && field.normalized.includes(term.normalized)) {
    kind = 'contains';
    baseScore = 560;
  } else if (term.compact.length >= 2 && isSubsequenceMatch(term.compact, field.compact)) {
    kind = 'subsequence';
    const density = term.compact.length / Math.max(field.compact.length, term.compact.length);
    baseScore = 380 + Math.round(Math.min(140, density * 170));
  }

  if (!kind || baseScore <= 0) return { matched: false, matchKind: 'subsequence', matchScore: 0 };

  if (field.isSecondaryField && baseScore < 900) {
    kind = field.secondaryKind;
    baseScore = Math.min(500, Math.max(260, Math.round(baseScore * 0.72)));
  }

  const compactnessBoost = kind === 'exact' || kind === 'alias-exact' || kind === 'nickname-exact' || kind === 'prefix'
    ? Math.max(0, 36 - Math.max(0, field.compact.length - term.compact.length) * 2)
    : 0;
  const weightedScore = Math.round((baseScore + compactnessBoost) * field.weight);

  return { matched: true, matchKind: kind, matchScore: weightedScore };
}

export function scorePrecompiledRootSearchFields(
  query: PrecompiledRootSearchQuery,
  fields: PrecompiledRootSearchScoringField[]
): RootSearchScoreResult {
  if (!query.fullQuery || query.terms.length === 0) {
    return { matched: false, matchKind: 'subsequence', matchScore: 0 };
  }

  let total = 0;
  let bestKind: MatchKind = 'subsequence';

  for (const term of query.terms) {
    let bestForTerm: RootSearchScoreResult | null = null;
    for (const field of fields) {
      const scored = scorePrecompiledSingleField(term, query.fullQuery, field);
      if (!scored.matched) continue;
      if (!bestForTerm || scored.matchScore > bestForTerm.matchScore) {
        bestForTerm = scored;
      }
    }
    if (!bestForTerm) {
      return { matched: false, matchKind: 'subsequence', matchScore: 0 };
    }
    total += bestForTerm.matchScore;
    if (MATCH_KIND_RANK[bestForTerm.matchKind] > MATCH_KIND_RANK[bestKind]) {
      bestKind = bestForTerm.matchKind;
    }
  }

  return {
    matched: true,
    matchKind: bestKind,
    matchScore: Math.round(total / query.terms.length),
  };
}

export function scoreRootSearchFields(query: string, fields: RootSearchScoringField[]): RootSearchScoreResult {
  return scorePrecompiledRootSearchFields(
    precompileRootSearchQuery(query),
    precompileRootSearchScoringFields(fields)
  );
}

function getFrecencyBoost(stableKey: string, ranking: RootSearchRankingState | undefined, now: number): number {
  const entry = ranking?.[stableKey];
  if (!entry) return 0;
  const ageDays = Math.max(0, (now - Number(entry.lastUsedAt || 0)) / DAY);
  const decayed = Math.max(0, Number(entry.frecencyScore || 0)) * Math.pow(0.5, ageDays / 30);
  return Math.min(180, 70 * Math.log1p(decayed));
}

export function getRootSearchFrecencyBoost(stableKey: string, ranking: RootSearchRankingState | undefined, now = Date.now()): number {
  return getFrecencyBoost(stableKey, ranking, now);
}

function getAdaptiveInputBoost(stableKey: string, query: string, ranking: RootSearchRankingState | undefined, now: number): number {
  const entry = ranking?.[stableKey];
  const inputHistory = entry?.inputHistory;
  const currentKey = normalizeQueryForInputHistory(query);
  if (!inputHistory || !currentKey) return 0;
  let best = 0;
  for (const [inputKey, input] of Object.entries(inputHistory)) {
    if (!inputKey || (!inputKey.startsWith(currentKey) && !currentKey.startsWith(inputKey))) continue;
    const ageDays = Math.max(0, (now - Number(input.lastUsedAt || 0)) / DAY);
    const decayed = Math.max(0, Number(input.score || 0)) * Math.pow(0.5, ageDays / 14);
    best = Math.max(best, Math.min(260, 95 * decayed));
  }
  return best;
}

export function isProtectedRootIntentMatch(subtype: RootSearchSubtype, matchKind: MatchKind): boolean {
  return (
    subtype === 'app' ||
    subtype === 'file' ||
    subtype === 'folder' ||
    subtype === 'nickname' ||
    subtype === 'quicklink'
  ) && (
    matchKind === 'exact' ||
    matchKind === 'alias-exact' ||
    matchKind === 'nickname-exact' ||
    matchKind === 'prefix'
  );
}

export function scoreRootSearchCandidate(
  candidate: Omit<RootSearchCandidate, 'tierBoost' | 'frecencyBoost' | 'adaptiveInputBoost' | 'finalScore' | 'isProtectedIntentMatch' | 'isNicknameMatch' | 'isOrganicBrowserResult'>,
  query: string,
  ranking?: RootSearchRankingState,
  now = Date.now()
): RootSearchCandidate {
  const tierBoost = TIER_BOOST[candidate.subtype] || 0;
  const frecencyBoost = getFrecencyBoost(candidate.stableKey, ranking, now);
  const adaptiveInputBoost = getAdaptiveInputBoost(candidate.stableKey, query, ranking, now);
  const finalScore =
    candidate.matchScore +
    tierBoost +
    candidate.sourceQualityBoost +
    frecencyBoost +
    adaptiveInputBoost +
    candidate.freshnessBoost +
    candidate.pathLocationBoost -
    candidate.noisePenalty -
    candidate.depthPenalty;

  return {
    ...candidate,
    tierBoost,
    frecencyBoost,
    adaptiveInputBoost,
    finalScore,
    isProtectedIntentMatch: isProtectedRootIntentMatch(candidate.subtype, candidate.matchKind),
    isNicknameMatch: candidate.subtype === 'nickname' || candidate.matchKind === 'nickname-exact',
    isOrganicBrowserResult: candidate.source === 'browser' && candidate.subtype !== 'nickname',
  };
}

export function compareRootSearchCandidates(a: RootSearchCandidate, b: RootSearchCandidate): number {
  // Internal results (commands, apps, files, nicknames, quicklinks) ALWAYS rank
  // above organic browser results (history / open tabs / bookmarks), which have
  // their own dedicated "Browser" section. This MUST be the FIRST comparison so
  // the comparator stays a consistent total order (transitive). A previous
  // "strong browser beats a deeply-buried untrusted file" special case
  // contradicted this rule, making compareRootSearchCandidates non-transitive:
  // command < browser, browser < deepFile, deepFile < command formed a cycle, and
  // Array.sort corrupts the order on a non-transitive comparator — which leaked
  // browser rows above commands once async file results entered the candidate set.
  // Deep/untrusted files already rank low via their depth/noise score penalty
  // WITHIN the internal group, so no cross-group browser exception is needed. URL
  // navigation is handled by the separate synthetic "Open <url>" row.
  if (a.isOrganicBrowserResult !== b.isOrganicBrowserResult) {
    return a.isOrganicBrowserResult ? 1 : -1;
  }

  const browserOrder = compareOrganicBrowserCandidates(a, b);
  if (browserOrder !== 0) return browserOrder;

  if (a.isProtectedIntentMatch !== b.isProtectedIntentMatch) {
    return a.isProtectedIntentMatch ? -1 : 1;
  }

  const aTierOne = a.isProtectedIntentMatch && (a.subtype === 'app' || a.subtype === 'file' || a.subtype === 'folder' || a.subtype === 'nickname');
  const bTierOne = b.isProtectedIntentMatch && (b.subtype === 'app' || b.subtype === 'file' || b.subtype === 'folder' || b.subtype === 'nickname');
  if (a.subtype === 'history' && bTierOne) return 1;
  if (b.subtype === 'history' && aTierOne) return -1;

  const aExact = a.matchKind === 'exact' || a.matchKind === 'alias-exact' || a.matchKind === 'nickname-exact';
  const bExact = b.matchKind === 'exact' || b.matchKind === 'alias-exact' || b.matchKind === 'nickname-exact';
  if (aExact !== bExact) return aExact ? -1 : 1;

  const aLearnedBoost = a.adaptiveInputBoost + a.frecencyBoost;
  const bLearnedBoost = b.adaptiveInputBoost + b.frecencyBoost;
  const aDefaultTrust = getDefaultProtectedTrustRank(a);
  const bDefaultTrust = getDefaultProtectedTrustRank(b);
  if (aDefaultTrust !== bDefaultTrust && Math.abs(aLearnedBoost - bLearnedBoost) < 90) {
    return bDefaultTrust - aDefaultTrust;
  }

  if (Math.abs(a.finalScore - b.finalScore) >= 12) return b.finalScore - a.finalScore;

  if (a.tierBoost !== b.tierBoost) return b.tierBoost - a.tierBoost;
  if (a.adaptiveInputBoost !== b.adaptiveInputBoost) return b.adaptiveInputBoost - a.adaptiveInputBoost;
  if (a.frecencyBoost !== b.frecencyBoost) return b.frecencyBoost - a.frecencyBoost;
  if (a.label.length !== b.label.length) return a.label.length - b.label.length;
  return a.label.localeCompare(b.label);
}

function compareOrganicBrowserCandidates(a: RootSearchCandidate, b: RootSearchCandidate): number {
  if (a.source !== 'browser' || b.source !== 'browser') return 0;
  if (a.subtype === 'nickname' || b.subtype === 'nickname') return 0;

  const aSearchEngine = isSearchEngineCandidate(a);
  const bSearchEngine = isSearchEngineCandidate(b);
  if (aSearchEngine !== bSearchEngine) {
    const aDestination = isDestinationBrowserCandidate(a);
    const bDestination = isDestinationBrowserCandidate(b);
    if (aDestination !== bDestination) return aDestination ? -1 : 1;
  }

  const aRank = getOrganicBrowserTrustRank(a);
  const bRank = getOrganicBrowserTrustRank(b);
  const aLearnedBoost = a.adaptiveInputBoost + a.frecencyBoost;
  const bLearnedBoost = b.adaptiveInputBoost + b.frecencyBoost;
  if (aRank !== bRank && Math.abs(aLearnedBoost - bLearnedBoost) < 90) {
    const aStrongDestination = isDestinationBrowserCandidate(a);
    const bStrongDestination = isDestinationBrowserCandidate(b);
    if (aStrongDestination !== bStrongDestination) return aStrongDestination ? -1 : 1;
    return bRank - aRank;
  }

  return 0;
}

function getOrganicBrowserTrustRank(candidate: RootSearchCandidate): number {
  if (isSearchEngineCandidate(candidate)) return 5;
  switch (candidate.subtype) {
    case 'open-tab':
      return 30;
    case 'bookmark':
      return 24;
    case 'history':
      return 10;
    default:
      return 0;
  }
}

function isDestinationBrowserCandidate(candidate: RootSearchCandidate): boolean {
  return candidate.matchKind === 'exact' || candidate.matchKind === 'url' || candidate.matchKind === 'prefix';
}

function isSearchEngineCandidate(candidate: RootSearchCandidate): boolean {
  if (candidate.subtype === 'bookmark' || candidate.subtype === 'nickname') return false;
  if (!candidate.pathOrUrl) return false;
  try {
    const parsed = new URL(candidate.pathOrUrl);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const isSearchHost =
      host === 'google.com' ||
      host.endsWith('.google.com') ||
      host === 'bing.com' ||
      host.endsWith('.bing.com') ||
      host === 'duckduckgo.com' ||
      host.endsWith('.duckduckgo.com') ||
      host === 'search.brave.com';
    if (!isSearchHost) return false;
    const label = normalizeRootSearchText(candidate.label);
    return parsed.searchParams.has('q') || parsed.pathname.includes('/search') || label.includes('google search');
  } catch {
    return false;
  }
}

function isDeepUntrustedFileCandidate(candidate: RootSearchCandidate): boolean {
  if (candidate.source !== 'file') return false;
  if (candidate.subtype !== 'file' && candidate.subtype !== 'folder') return false;
  return candidate.depthPenalty >= 120 || candidate.noisePenalty >= 70;
}

function isStrongBrowserCandidate(candidate: RootSearchCandidate): boolean {
  if (candidate.source !== 'browser') return false;
  if (candidate.subtype !== 'open-tab' && candidate.subtype !== 'bookmark' && candidate.subtype !== 'history') return false;
  if (candidate.finalScore < (candidate.subtype === 'open-tab' ? 560 : 620)) return false;
  return (
    candidate.matchKind === 'exact' ||
    candidate.matchKind === 'prefix' ||
    candidate.matchKind === 'token-prefix' ||
    candidate.matchKind === 'url'
  );
}

function getDefaultProtectedTrustRank(candidate: RootSearchCandidate): number {
  if (!candidate.isProtectedIntentMatch) return 0;
  switch (candidate.subtype) {
    case 'app':
      return 50;
    case 'nickname':
      return 45;
    case 'quicklink':
      return 42;
    case 'file':
      return 35;
    case 'folder':
      return 25;
    default:
      return 0;
  }
}

export function rankRootSearchCandidates(candidates: RootSearchCandidate[]): RootSearchCandidate[] {
  const bestByKey = new Map<string, RootSearchCandidate>();
  for (const candidate of candidates) {
    const existing = bestByKey.get(candidate.stableKey);
    if (!existing || compareRootSearchCandidates(candidate, existing) < 0) {
      bestByKey.set(candidate.stableKey, candidate);
    }
  }
  return Array.from(bestByKey.values()).sort(compareRootSearchCandidates);
}

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  let prefix = values[0] || '';
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i].toLowerCase() === value[i].toLowerCase()) {
      i += 1;
    }
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

export function getRootSearchCompletionText(candidate: RootSearchCandidate, query = ''): string {
  if (candidate.subtype === 'nickname' && candidate.command.browserNickname) return candidate.command.browserNickname;
  if (candidate.pathOrUrl && (candidate.subtype === 'open-tab' || candidate.subtype === 'bookmark' || candidate.subtype === 'history')) {
    const titleCompletion = getBrowserTitleCompletion(candidate.label, query);
    if (titleCompletion) return titleCompletion;
    try {
      const parsed = new URL(candidate.pathOrUrl);
      return parsed.hostname.replace(/^www\./i, '');
    } catch {
      return candidate.pathOrUrl.replace(/^https?:\/\//i, '');
    }
  }
  return candidate.label;
}

function getBrowserTitleCompletion(label: string, query: string): string | null {
  const rawQuery = String(query || '').trim();
  const rawLabel = String(label || '').trim();
  if (!rawQuery || !rawLabel) return null;
  const lowerQuery = rawQuery.toLowerCase();
  const directIndex = rawLabel.toLowerCase().indexOf(lowerQuery);
  if (directIndex < 0) return null;
  const startsAtBoundary = directIndex === 0 || /[^a-z0-9]/i.test(rawLabel[directIndex - 1] || '');
  if (!startsAtBoundary) return null;
  const afterMatch = rawLabel.slice(directIndex + rawQuery.length);
  const tokenRemainder = afterMatch.match(/^[\p{L}\p{N}'._-]*/u)?.[0] || '';
  const completion = rawLabel.slice(directIndex, directIndex + rawQuery.length + tokenRemainder.length);
  return completion.length > rawQuery.length ? completion : null;
}

export function getSharedRootCompletion(query: string, candidates: RootSearchCandidate[]): string | null {
  const rawQuery = String(query || '');
  if (!rawQuery.trim() || /\s$/.test(rawQuery)) return null;
  const completions = candidates
    .filter((candidate) =>
      (candidate.finalScore >= 650 && !candidate.isOrganicBrowserResult) || (
        candidate.finalScore >= 720 &&
        (candidate.matchKind === 'exact' || candidate.matchKind === 'prefix' || candidate.matchKind === 'url')
      )
    )
    .map((candidate) => getRootSearchCompletionText(candidate, rawQuery))
    .filter((text) => text && text.toLowerCase().startsWith(rawQuery.toLowerCase()));
  const prefix = longestCommonPrefix(completions);
  if (prefix.length >= rawQuery.length + 1) return prefix;
  const firstCompletion = completions[0] || '';
  return firstCompletion.length >= rawQuery.length + 1 ? firstCompletion : null;
}

export function getRootSearchCompletion(query: string, candidates: RootSearchCandidate[]): string | null {
  return getSharedRootCompletion(query, candidates);
}
