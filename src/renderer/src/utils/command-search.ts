import { pinyin } from 'pinyin-pro';
import type { CommandInfo } from '../../types/electron';

const SEARCH_TOKEN_SPLIT_REGEX = /[^\p{L}\p{N}]+/gu;
const HAN_CHARACTER_REGEX = /\p{Script=Han}/u;

type SearchCandidate = {
  token: string;
  weight: number;
};

type CommandSearchEntry = {
  cmd: CommandInfo;
  title: string;
  subtitle: string;
  normalizedAlias: string;
  keywordTokens: string[];
  candidates: SearchCandidate[];
  hasExactAliasMatch: (query: string) => boolean;
};

export type CommandSearchIndex = {
  alwaysOnTop: CommandInfo[];
  rest: CommandInfo[];
  entries: CommandSearchEntry[];
};

function normalizeSearchText(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(SEARCH_TOKEN_SPLIT_REGEX, ' ')
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function buildPinyinSearchTokens(value: string): string[] {
  const text = String(value || '').trim();
  if (!text || !HAN_CHARACTER_REGEX.test(text)) return [];

  const full = compactSearchText(
    pinyin(text, { toneType: 'none', type: 'array' }).join('')
  );
  const initials = compactSearchText(
    pinyin(text, { toneType: 'none', pattern: 'first', type: 'array' }).join('')
  );

  const tokens = new Set<string>();
  if (full) tokens.add(full);
  if (initials) tokens.add(initials);
  return Array.from(tokens);
}

function dedupeSearchCandidates(candidates: SearchCandidate[]): SearchCandidate[] {
  const byToken = new Map<string, SearchCandidate>();
  for (const candidate of candidates) {
    if (!candidate.token) continue;
    const existing = byToken.get(candidate.token);
    if (!existing || candidate.weight > existing.weight) {
      byToken.set(candidate.token, candidate);
    }
  }
  return Array.from(byToken.values());
}

function isSubsequenceMatch(needle: string, haystack: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;

  let needleIndex = 0;
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) {
      needleIndex += 1;
    }
  }
  return needleIndex === needle.length;
}

function maxAllowedTypoDistance(termLength: number): number {
  if (termLength <= 3) return 0;
  if (termLength <= 5) return 1;
  if (termLength <= 8) return 2;
  return 3;
}

function damerauLevenshteinDistance(a: string, b: string, maxDistance: number): number {
  const aLen = a.length;
  const bLen = b.length;

  if (!aLen) return bLen;
  if (!bLen) return aLen;
  if (Math.abs(aLen - bLen) > maxDistance) {
    return maxDistance + 1;
  }

  const dp: number[][] = Array.from({ length: aLen + 1 }, () => Array<number>(bLen + 1).fill(0));
  for (let i = 0; i <= aLen; i += 1) dp[i][0] = i;
  for (let j = 0; j <= bLen; j += 1) dp[0][j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, dp[i - 2][j - 2] + 1);
      }

      dp[i][j] = distance;
    }
  }

  return dp[aLen][bLen];
}

function scoreTokenMatch(term: string, candidate: string): number {
  if (!term || !candidate) return 0;
  if (candidate === term) return 120;
  if (candidate.startsWith(term)) return 106;
  if (candidate.includes(term)) return 94;

  if (term.length >= 3 && isSubsequenceMatch(term, candidate)) {
    return 78;
  }

  const maxDistance = maxAllowedTypoDistance(term.length);
  if (maxDistance > 0 && Math.abs(candidate.length - term.length) <= maxDistance) {
    const distance = damerauLevenshteinDistance(term, candidate, maxDistance);
    if (distance <= maxDistance) {
      const similarity = 1 - distance / Math.max(term.length, candidate.length);
      if (similarity >= 0.65) {
        return Math.round(50 + similarity * 30 - distance * 8);
      }
    }
  }

  return 0;
}

function bestTermScore(term: string, candidates: SearchCandidate[]): number {
  let best = 0;
  for (const candidate of candidates) {
    const baseScore = scoreTokenMatch(term, candidate.token);
    if (baseScore <= 0) continue;
    const weighted = Math.round(baseScore * candidate.weight);
    if (weighted > best) {
      best = weighted;
    }
  }
  return best;
}

export function buildCommandSearchIndex(
  commands: CommandInfo[],
  aliasLookup: Record<string, string> = {}
): CommandSearchIndex {
  const entries = commands
    .map((cmd) => {
      const title = normalizeSearchText(cmd.title);
      const subtitle = normalizeSearchText(String(cmd.subtitle || ''));
      const normalizedAlias = normalizeSearchText(aliasLookup[cmd.id] || '');
      const aliasTokens = normalizedAlias ? tokenizeSearchText(normalizedAlias) : [];
      const aliasPinyinTokens = buildPinyinSearchTokens(aliasLookup[cmd.id] || '');
      const keywordTokens = (cmd.keywords || []).flatMap((keyword) => tokenizeSearchText(keyword));
      const keywordPinyinTokens = (cmd.keywords || []).flatMap((keyword) => buildPinyinSearchTokens(keyword));
      const titleTokens = tokenizeSearchText(cmd.title);
      const titlePinyinTokens = buildPinyinSearchTokens(cmd.title);
      const subtitleTokens = tokenizeSearchText(String(cmd.subtitle || ''));
      const subtitlePinyinTokens = buildPinyinSearchTokens(String(cmd.subtitle || ''));

      const candidates = dedupeSearchCandidates([
        ...aliasTokens.map((token) => ({ token, weight: 1.08 })),
        ...aliasPinyinTokens.map((token) => ({ token, weight: 1.04 })),
        ...titleTokens.map((token) => ({ token, weight: 1 })),
        ...titlePinyinTokens.map((token) => ({ token, weight: 0.98 })),
        ...keywordTokens.map((token) => ({ token, weight: 0.92 })),
        ...keywordPinyinTokens.map((token) => ({ token, weight: 0.9 })),
        ...subtitleTokens.map((token) => ({ token, weight: 0.76 })),
        ...subtitlePinyinTokens.map((token) => ({ token, weight: 0.72 })),
      ]);

      if (candidates.length === 0) {
        return null;
      }

      return {
        cmd,
        title,
        subtitle,
        normalizedAlias,
        keywordTokens,
        candidates,
        hasExactAliasMatch: (query: string) => Boolean(normalizedAlias) && normalizedAlias === query,
      };
    })
    .filter((entry): entry is CommandSearchEntry => entry !== null);

  return {
    alwaysOnTop: commands.filter((command) => command.alwaysOnTop),
    rest: commands.filter((command) => !command.alwaysOnTop),
    entries,
  };
}

export function filterIndexedCommands(index: CommandSearchIndex, query: string): CommandInfo[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return [...index.alwaysOnTop, ...index.rest];
  }

  const queryTerms = tokenizeSearchText(normalizedQuery);

  const scored = index.entries
    .map((entry) => {
      const { cmd, title, subtitle, normalizedAlias, keywordTokens, candidates } = entry;
      let score = 0;

      if (entry.hasExactAliasMatch(normalizedQuery)) {
        score += 1200;
      } else if (title === normalizedQuery) {
        score += 420;
      } else if (title.startsWith(normalizedQuery)) {
        score += 320;
      } else if (title.includes(normalizedQuery)) {
        score += 260;
      } else if (normalizedAlias && normalizedAlias.startsWith(normalizedQuery)) {
        score += 240;
      } else if (normalizedAlias && normalizedAlias.includes(normalizedQuery)) {
        score += 200;
      } else if (keywordTokens.includes(normalizedQuery)) {
        score += 225;
      } else if (keywordTokens.some((keyword) => keyword.includes(normalizedQuery))) {
        score += 180;
      } else if (subtitle.includes(normalizedQuery)) {
        score += 145;
      }

      let termScoreSum = 0;
      for (const term of queryTerms) {
        const termScore = bestTermScore(term, candidates);
        if (termScore <= 0) {
          return null;
        }
        termScoreSum += termScore;
      }

      score += termScoreSum;

      if (normalizedQuery.length >= 3) {
        const compactQuery = normalizedQuery.replace(/\s+/g, '');
        const compactTitle = title.replace(/\s+/g, '');
        if (compactQuery && compactTitle && isSubsequenceMatch(compactQuery, compactTitle)) {
          score += 18;
        }
      }

      score += Math.max(0, 12 - Math.max(0, title.length - normalizedQuery.length));

      return {
        cmd,
        score,
        title,
        hasExactAliasMatch: entry.hasExactAliasMatch(normalizedQuery),
      };
    })
    .filter(
      (
        entry
      ): entry is { cmd: CommandInfo; score: number; title: string; hasExactAliasMatch: boolean } =>
        entry !== null && entry.score > 0
    )
    .sort((a, b) => {
      if (a.hasExactAliasMatch !== b.hasExactAliasMatch) {
        return Number(b.hasExactAliasMatch) - Number(a.hasExactAliasMatch);
      }
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title);
    });

  const matchedTop = scored.filter(({ cmd }) => cmd.alwaysOnTop).map(({ cmd }) => cmd);
  const matchedRest = scored.filter(({ cmd }) => !cmd.alwaysOnTop).map(({ cmd }) => cmd);
  return [...matchedTop, ...matchedRest];
}

export function filterCommands(
  commands: CommandInfo[],
  query: string,
  aliasLookup: Record<string, string> = {}
): CommandInfo[] {
  return filterIndexedCommands(buildCommandSearchIndex(commands, aliasLookup), query);
}
