export type RootSearchRankingInputHistory = {
  useCount: number;
  lastUsedAt: number;
  score: number;
};

export type RootSearchRankingEntry = {
  useCount: number;
  lastUsedAt: number;
  frecencyScore: number;
  inputHistory: Record<string, RootSearchRankingInputHistory>;
};

export type RootSearchRankingState = Record<string, RootSearchRankingEntry>;

const DAY = 24 * 60 * 60 * 1000;
const SEARCH_SEPARATOR_REGEX = /[^\p{L}\p{N}]+/gu;
const COMBINING_MARK_REGEX = /\p{M}/gu;

function normalizeQueryForInputHistory(query: string): string {
  return String(query || '')
    .normalize('NFKD')
    .replace(COMBINING_MARK_REGEX, '')
    .toLowerCase()
    .replace(SEARCH_SEPARATOR_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function pruneRootSearchRanking(state: RootSearchRankingState, now = Date.now()): RootSearchRankingState {
  const next: RootSearchRankingState = {};
  for (const [key, entry] of Object.entries(state || {})) {
    const ageDays = entry.lastUsedAt ? Math.max(0, (now - entry.lastUsedAt) / DAY) : Number.MAX_SAFE_INTEGER;
    const frecency = Math.max(0, Number(entry.frecencyScore || 0)) * Math.pow(0.5, ageDays / 30);
    if (ageDays > 120 && frecency < 0.05) continue;
    next[key] = {
      useCount: Math.max(0, Number(entry.useCount || 0)),
      lastUsedAt: Number(entry.lastUsedAt || 0),
      frecencyScore: frecency,
      inputHistory: entry.inputHistory || {},
    };
  }
  return next;
}

export function recordRootSearchLaunchInState(
  state: RootSearchRankingState,
  stableKey: string,
  query: string,
  now = Date.now()
): RootSearchRankingState {
  const cleanKey = String(stableKey || '').trim();
  if (!cleanKey) return state;
  const next: RootSearchRankingState = { ...(state || {}) };
  const previous = next[cleanKey] || { useCount: 0, lastUsedAt: 0, frecencyScore: 0, inputHistory: {} };
  const ageDays = previous.lastUsedAt ? Math.max(0, (now - previous.lastUsedAt) / DAY) : 0;
  const decayedFrecency = Math.max(0, Number(previous.frecencyScore || 0)) * Math.pow(0.5, ageDays / 30);
  const inputHistory = { ...(previous.inputHistory || {}) };
  const inputKey = normalizeQueryForInputHistory(query);

  if (inputKey) {
    const previousInput = inputHistory[inputKey] || { useCount: 0, lastUsedAt: 0, score: 0 };
    const inputAgeDays = previousInput.lastUsedAt ? Math.max(0, (now - previousInput.lastUsedAt) / DAY) : 0;
    inputHistory[inputKey] = {
      useCount: Math.max(0, Number(previousInput.useCount || 0)) + 1,
      lastUsedAt: now,
      score: Math.max(0, Number(previousInput.score || 0)) * Math.pow(0.5, inputAgeDays / 14) + 1,
    };
  }

  next[cleanKey] = {
    useCount: Math.max(0, Number(previous.useCount || 0)) + 1,
    lastUsedAt: now,
    frecencyScore: decayedFrecency + 1,
    inputHistory,
  };
  return pruneRootSearchRanking(next, now);
}
