import type {
  WebSearchBangUsageSetting,
} from '../../types/electron';

export const WEB_SEARCH_BANG_USE_COUNTS_KEY = 'supercmd:webSearchBangUseCounts';
export const WEB_SEARCH_SUGGEST_DEBOUNCE_MS = 80;
export const WEB_SEARCH_ACTIVE_BANG_SUGGESTION_LIMIT = 24;
export const WEB_SEARCH_RECENT_BANG_LIMIT = 20;
export const WEB_SEARCH_FRECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
export const WEB_SEARCH_INITIAL_VISIBLE_RESULTS = 240;
export const WEB_SEARCH_VISIBLE_RESULTS_INCREMENT = 240;
export const WEB_SEARCH_COMMAND_ID = 'system-search-web';
export const WEB_SEARCH_ROOT_DIRECT_ID = 'web-search-root:default';
export const WEB_SEARCH_ROOT_BANG_PREFIX = 'web-search-root:bang:';
export const WEB_SEARCH_ROOT_SUGGESTION_PREFIX = 'web-search-root:suggestion:';

export type WebSearchResultKind = 'search' | 'suggestion' | 'bang';

export type WebSearchResult = {
  id: string;
  kind: WebSearchResultKind;
  section: 'search' | 'recent' | 'all' | 'matching' | 'hidden';
  title: string;
  subtitle: string;
  query: string;
  bangKey?: string;
  defaultAliases?: string[];
  customAliases?: string[];
  isCustom?: boolean;
  isDisabled?: boolean;
  bang?: SearchBangDefinition;
  faviconUrl?: string;
};

export type SearchBangDefinition = {
  key: string;
  aliases: string[];
  name: string;
  host: string;
  template: string;
  category?: string;
  subcategory?: string;
  source?: 'seed' | 'duckduckgo' | 'unduck' | 'custom';
  rankHint?: number;
  defaultPopularityRank?: number;
  disabled?: boolean;
};

export const SEARCH_BANGS: SearchBangDefinition[] = [
  { key: 'g', aliases: ['google'], name: 'Google', host: 'google.com', template: 'https://www.google.com/search?q={query}', category: 'Search', source: 'seed', defaultPopularityRank: 1 },
  { key: 'ddg', aliases: ['d', 'duckduckgo'], name: 'DuckDuckGo', host: 'duckduckgo.com', template: 'https://duckduckgo.com/?q={query}', category: 'Search', source: 'seed', defaultPopularityRank: 2 },
  { key: 'yt', aliases: ['youtube'], name: 'YouTube', host: 'youtube.com', template: 'https://www.youtube.com/results?search_query={query}', category: 'Multimedia', source: 'seed', defaultPopularityRank: 3 },
  { key: 'gh', aliases: ['github'], name: 'GitHub', host: 'github.com', template: 'https://github.com/search?q={query}', category: 'Programming', source: 'seed', defaultPopularityRank: 4 },
  { key: 'npm', aliases: [], name: 'npm', host: 'npmjs.com', template: 'https://www.npmjs.com/search?q={query}', category: 'Programming', source: 'seed', defaultPopularityRank: 12 },
  { key: 'mdn', aliases: [], name: 'MDN', host: 'developer.mozilla.org', template: 'https://developer.mozilla.org/search?q={query}', category: 'Programming', source: 'seed', defaultPopularityRank: 11 },
  { key: 'maps', aliases: ['gm'], name: 'Google Maps', host: 'google.com', template: 'https://www.google.com/maps/search/{query}', category: 'Search', source: 'seed', defaultPopularityRank: 5 },
  { key: 'img', aliases: ['image', 'images', 'gi', 'gim', 'gimg', 'gimages'], name: 'Google Images', host: 'google.com', template: 'https://www.google.com/search?tbm=isch&q={query}', category: 'Search', source: 'seed', defaultPopularityRank: 6 },
  { key: 'wiki', aliases: ['w', 'wikipedia'], name: 'Wikipedia', host: 'wikipedia.org', template: 'https://en.wikipedia.org/w/index.php?search={query}', category: 'Reference', source: 'seed', defaultPopularityRank: 7 },
  { key: 'x', aliases: ['twitter'], name: 'X', host: 'x.com', template: 'https://x.com/search?q={query}', category: 'Social', source: 'seed', defaultPopularityRank: 14 },
];

const COMMON_SEARCH_BANG_ORDER = new Map(
  ['g', 'ddg', 'yt', 'gh', 'npm', 'mdn', 'maps', 'img', 'wiki', 'x'].map((key, index) => [key, index])
);

const DEFAULT_POPULAR_BANG_TARGETS: Array<{ rank: number; hosts: string[]; names: string[] }> = [
  { rank: 1, hosts: ['google.com'], names: ['google'] },
  { rank: 2, hosts: ['duckduckgo.com'], names: ['duckduckgo'] },
  { rank: 3, hosts: ['youtube.com'], names: ['youtube'] },
  { rank: 4, hosts: ['github.com'], names: ['github'] },
  { rank: 5, hosts: ['google.com/maps'], names: ['google maps', 'maps'] },
  { rank: 6, hosts: ['google.com'], names: ['google images', 'images'] },
  { rank: 7, hosts: ['wikipedia.org'], names: ['wikipedia'] },
  { rank: 8, hosts: ['reddit.com'], names: ['reddit'] },
  { rank: 9, hosts: ['amazon.com'], names: ['amazon'] },
  { rank: 10, hosts: ['stackoverflow.com'], names: ['stack overflow', 'stackoverflow'] },
  { rank: 11, hosts: ['developer.mozilla.org'], names: ['mdn'] },
  { rank: 12, hosts: ['npmjs.com'], names: ['npm'] },
  { rank: 13, hosts: ['imdb.com'], names: ['imdb'] },
  { rank: 14, hosts: ['x.com', 'twitter.com'], names: ['x', 'twitter'] },
  { rank: 15, hosts: ['linkedin.com'], names: ['linkedin'] },
  { rank: 16, hosts: ['spotify.com'], names: ['spotify'] },
  { rank: 17, hosts: ['translate.google.com'], names: ['google translate', 'translate'] },
  { rank: 18, hosts: ['mail.google.com'], names: ['gmail'] },
  { rank: 19, hosts: ['drive.google.com'], names: ['google drive', 'drive'] },
  { rank: 20, hosts: ['docs.google.com'], names: ['google docs', 'docs'] },
];

export type BangParseState =
  | { mode: 'none' }
  | { mode: 'selecting'; token: string; tokenIndex: number; queryWithoutToken: string }
  | { mode: 'active'; bang: SearchBangDefinition; query: string };

const SEARCH_BANGS_BY_KEY = new Map<string, SearchBangDefinition>();
for (const bang of SEARCH_BANGS) {
  SEARCH_BANGS_BY_KEY.set(bang.key, bang);
  for (const alias of bang.aliases || []) {
    SEARCH_BANGS_BY_KEY.set(alias, bang);
  }
}

export function getFaviconUrlForHost(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function buildBangSearchUrl(bang: SearchBangDefinition, query: string): string {
  return bang.template
    .replace('{bang}', encodeURIComponent(bang.key))
    .replace('{query}', encodeURIComponent(query.trim()));
}

export function normalizeBangHost(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

function getDefaultPopularityRankForBang(bang: SearchBangDefinition): number | undefined {
  if (bang.defaultPopularityRank) return bang.defaultPopularityRank;
  const host = normalizeBangHost(bang.host);
  const name = bang.name.toLowerCase();
  for (const target of DEFAULT_POPULAR_BANG_TARGETS) {
    if (target.hosts.some((candidate) => host.includes(candidate.toLowerCase().replace(/^www\./, '')))) return target.rank;
    if (target.names.some((candidate) => name === candidate || name.includes(candidate))) return target.rank;
  }
  return undefined;
}

export function normalizeBangDefinition(raw: Partial<SearchBangDefinition> & { key: string }): SearchBangDefinition {
  const key = String(raw.key || '').trim().toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9.+_-]/g, '');
  const aliases = Array.from(new Set((raw.aliases || []).map((alias) => String(alias || '').trim().toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9.+_-]/g, '')).filter((alias) => alias && alias !== key)));
  const bang: SearchBangDefinition = {
    key,
    aliases,
    name: String(raw.name || key).trim() || key,
    host: String(raw.host || 'duckduckgo.com').trim() || 'duckduckgo.com',
    template: String(raw.template || 'https://duckduckgo.com/?q=!{bang}%20{query}').trim() || 'https://duckduckgo.com/?q=!{bang}%20{query}',
    category: raw.category,
    subcategory: raw.subcategory,
    source: raw.source || 'duckduckgo',
    rankHint: raw.rankHint,
    defaultPopularityRank: raw.defaultPopularityRank,
    disabled: raw.disabled,
  };
  bang.defaultPopularityRank = getDefaultPopularityRankForBang(bang);
  return bang;
}

export function getBangUsageScore(usage: WebSearchBangUsageSetting | undefined): number {
  if (!usage) return 0;
  const elapsed = Math.max(0, Date.now() - (usage.lastUsedAt || 0));
  const decay = Math.pow(0.5, elapsed / WEB_SEARCH_FRECENCY_HALF_LIFE_MS);
  return Math.max(0, Number(usage.frecencyScore || 0) * decay);
}

export function createUpdatedBangUsage(current: WebSearchBangUsageSetting | undefined): WebSearchBangUsageSetting {
  const now = Date.now();
  const elapsed = Math.max(0, now - (current?.lastUsedAt || now));
  const decay = Math.pow(0.5, elapsed / WEB_SEARCH_FRECENCY_HALF_LIFE_MS);
  return {
    useCount: Math.max(0, Math.floor(Number(current?.useCount) || 0)) + 1,
    lastUsedAt: now,
    frecencyScore: Math.max(0, Number(current?.frecencyScore || 0) * decay) + 1,
  };
}

function bangSearchText(bang: SearchBangDefinition): string {
  return [
    bang.key,
    ...(bang.aliases || []),
    bang.name,
    bang.host,
    bang.category || '',
    bang.subcategory || '',
  ].join(' ').toLowerCase();
}

export function scoreBangMatch(bang: SearchBangDefinition, rawFilter: string): number {
  const filter = String(rawFilter || '').trim().toLowerCase().replace(/^!+/, '');
  if (!filter) return 1;
  const aliases = [bang.key, ...(bang.aliases || [])];
  if (aliases.includes(filter)) return 1000;
  if (aliases.some((alias) => alias.startsWith(filter))) return 900;
  const name = bang.name.toLowerCase();
  if (name === filter) return 860;
  if (name.startsWith(filter)) return 820;
  const host = normalizeBangHost(bang.host);
  if (host === filter || host.startsWith(filter) || host.includes(`.${filter}`)) return 760;
  if (bangSearchText(bang).includes(filter)) return 620;
  const terms = filter.split(/\s+/).filter(Boolean);
  if (terms.length > 1 && terms.every((term) => bangSearchText(bang).includes(term))) return 580;
  return 0;
}

export function parseSearchBangState(input: string, bangs: SearchBangDefinition[]): BangParseState {
  const raw = String(input || '');
  const trimmed = raw.trim();
  if (!trimmed) return { mode: 'none' };
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const map = new Map<string, SearchBangDefinition>();
  for (const bang of bangs) {
    if (bang.disabled) continue;
    map.set(bang.key, bang);
    for (const alias of bang.aliases || []) map.set(alias, bang);
    const normalizedName = bang.name.toLowerCase().replace(/[^a-z0-9.+_-]/g, '');
    if (normalizedName) map.set(normalizedName, bang);
  }

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part.startsWith('!')) continue;
    const token = part.slice(1).toLowerCase();
    const bang = token ? map.get(token) : undefined;
    const queryWithoutToken = parts.filter((_, partIndex) => partIndex !== index).join(' ');
    const tokenHasTrailingSpace = new RegExp(`!${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`).test(raw);
    if (bang && (tokenHasTrailingSpace || index < parts.length - 1)) {
      return { mode: 'active', bang, query: queryWithoutToken };
    }
    return { mode: 'selecting', token, tokenIndex: index, queryWithoutToken };
  }
  return { mode: 'none' };
}

export function parseSearchBang(input: string): {
  rawQuery: string;
  query: string;
  bang: SearchBangDefinition | null;
  activeBangPrefix: string | null;
} {
  const rawQuery = String(input || '');
  const parts = rawQuery.trim().split(/\s+/).filter(Boolean);
  let bang: SearchBangDefinition | null = null;
  let activeBangPrefix: string | null = null;
  let bangIndex = -1;
  let activeBangIndex = -1;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part.startsWith('!')) continue;
    if (part.length === 1) {
      activeBangPrefix = '';
      activeBangIndex = index;
      continue;
    }
    const key = part.slice(1).toLowerCase();
    const match = SEARCH_BANGS_BY_KEY.get(key);
    if (match) {
      bang = match;
      bangIndex = index;
      break;
    }
    if (/^[a-z0-9]*$/i.test(key)) {
      activeBangPrefix = key;
      activeBangIndex = index;
    }
  }

  const omittedIndex = bangIndex >= 0 ? bangIndex : activeBangIndex;
  const query = omittedIndex >= 0
    ? parts.filter((_, index) => index !== omittedIndex).join(' ')
    : parts.join(' ');
  return { rawQuery, query, bang, activeBangPrefix };
}

export function getSearchBangByKey(key: string | undefined): SearchBangDefinition {
  return SEARCH_BANGS_BY_KEY.get(String(key || '').trim().toLowerCase().replace(/^!+/, '')) || SEARCH_BANGS_BY_KEY.get('g') || SEARCH_BANGS[0];
}

export function getSearchBangByKeyFromList(key: string | undefined, bangs: SearchBangDefinition[]): SearchBangDefinition {
  const normalized = String(key || '').trim().toLowerCase().replace(/^!+/, '');
  for (const bang of bangs) {
    if (bang.key === normalized || (bang.aliases || []).includes(normalized)) return bang;
  }
  return getSearchBangByKey(key);
}

export function parseSearchBangFromList(input: string, bangs: SearchBangDefinition[]): {
  rawQuery: string;
  query: string;
  bang: SearchBangDefinition | null;
  activeBangPrefix: string | null;
} {
  const map = new Map<string, SearchBangDefinition>();
  for (const bang of bangs) {
    map.set(bang.key, bang);
    for (const alias of bang.aliases || []) map.set(alias, bang);
  }
  const rawQuery = String(input || '');
  const parts = rawQuery.trim().split(/\s+/).filter(Boolean);
  let bang: SearchBangDefinition | null = null;
  let activeBangPrefix: string | null = null;
  let bangIndex = -1;
  let activeBangIndex = -1;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part.startsWith('!')) continue;
    if (part.length === 1) {
      activeBangPrefix = '';
      activeBangIndex = index;
      continue;
    }
    const key = part.slice(1).toLowerCase();
    const match = map.get(key);
    if (match) {
      bang = match;
      bangIndex = index;
      break;
    }
    if (/^[a-z0-9.+_-]*$/i.test(key)) {
      activeBangPrefix = key;
      activeBangIndex = index;
    }
  }

  const omittedIndex = bangIndex >= 0 ? bangIndex : activeBangIndex;
  const query = omittedIndex >= 0
    ? parts.filter((_, index) => index !== omittedIndex).join(' ')
    : parts.join(' ');
  return { rawQuery, query, bang, activeBangPrefix };
}

export function getSortedSearchBangs(
  bangs: SearchBangDefinition[],
  prefix: string | null,
  usage: Record<string, WebSearchBangUsageSetting>,
  limit = bangs.length
): SearchBangDefinition[] {
  const normalized = String(prefix || '').toLowerCase();
  const matches = normalized
    ? bangs.filter((bang) => scoreBangMatch(bang, normalized) > 0)
    : bangs;
  return [...matches]
    .sort((a, b) => {
      const matchDelta = scoreBangMatch(b, normalized) - scoreBangMatch(a, normalized);
      if (matchDelta !== 0) return matchDelta;
      const usageDelta = getBangUsageScore(usage[b.key]) - getBangUsageScore(usage[a.key]);
      if (Math.abs(usageDelta) > 0.0001) return usageDelta > 0 ? 1 : -1;
      if (!normalized) {
        const commonDelta = (a.defaultPopularityRank ?? COMMON_SEARCH_BANG_ORDER.get(a.key) ?? Number.POSITIVE_INFINITY) -
          (b.defaultPopularityRank ?? COMMON_SEARCH_BANG_ORDER.get(b.key) ?? Number.POSITIVE_INFINITY);
        if (commonDelta !== 0) return commonDelta;
        const rankDelta = (a.rankHint ?? Number.POSITIVE_INFINITY) - (b.rankHint ?? Number.POSITIVE_INFINITY);
        if (rankDelta !== 0) return rankDelta;
      }
      return a.key.localeCompare(b.key);
    })
    .slice(0, Math.max(0, limit));
}

export function normalizeWebSearchBangAliasList(value: string): string[] {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map((alias) => alias.trim().toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9.+_-]/g, ''))
      .filter(Boolean)
  ));
}

export function formatWebSearchBangAliases(aliases: string[]): string {
  return aliases.map((alias) => `!${alias}`).join(', ');
}

export function formatWebSearchBangAliasSummary(aliases: string[]): string {
  const normalized = normalizeWebSearchBangAliasList(formatWebSearchBangAliases(aliases));
  if (normalized.length <= 1) return '';
  const visible = normalized.slice(0, 5).map((alias) => `!${alias}`).join(', ');
  return normalized.length > 5 ? `${visible}, +${normalized.length - 5}` : visible;
}

export function getWebSearchBangSection(
  bang: SearchBangDefinition,
  filter: string,
  usage: Record<string, WebSearchBangUsageSetting>
): WebSearchResult['section'] {
  if (filter.trim()) return 'matching';
  if (bang.disabled) return 'hidden';
  if (getBangUsageScore(usage[bang.key]) > 0) return 'recent';
  return 'all';
}

export function getWebSearchBangSectionTitleKey(section: WebSearchResult['section']): string {
  switch (section) {
    case 'search':
      return 'launcher.categories.search';
    case 'recent':
      return 'launcher.browserSearch.bangSections.used';
    case 'matching':
      return 'launcher.browserSearch.bangSections.matching';
    case 'hidden':
      return 'launcher.browserSearch.bangSections.hidden';
    case 'all':
    default:
      return 'launcher.browserSearch.bangSections.all';
  }
}
