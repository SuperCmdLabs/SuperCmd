import type { CommandInfo, BrowserSearchResultGroupSetting } from '../../types/electron';
import type { BrowserSearchResult } from '../hooks/useBrowserSearch';

export const BROWSER_SEARCH_OPEN_URL_ID = 'browser-search-action-open-url';
export const BROWSER_SEARCH_PERFORM_SEARCH_ID = 'browser-search-action-perform-search';
export const BROWSER_SEARCH_RESULT_ID_PREFIX = 'browser-search-result:';
export const BROWSER_SEARCH_SHOW_ALL_RESULTS_ID = 'browser-search-action-show-all';
export const BROWSER_SEARCH_OPEN_TABS_COMMAND_ID = 'system-search-open-tabs';
export const BROWSER_SEARCH_BOOKMARKS_COMMAND_ID = 'system-search-bookmarks';
export const BROWSER_SEARCH_HISTORY_COMMAND_ID = 'system-search-history';

export const DEFAULT_BROWSER_SEARCH_RESULT_GROUPS: BrowserSearchResultGroupSetting[] = [
  { kind: 'bookmark', limit: 2 },
  { kind: 'open-tab', limit: 2 },
  { kind: 'history', limit: 2 },
];

export type BrowserResultsViewScope = 'all' | 'open-tabs' | 'bookmarks' | 'history';

export function isBrowserSearchCommand(command: CommandInfo | null | undefined): boolean {
  const id = String(command?.id || '');
  return id === BROWSER_SEARCH_OPEN_URL_ID ||
    id === BROWSER_SEARCH_PERFORM_SEARCH_ID ||
    id === BROWSER_SEARCH_SHOW_ALL_RESULTS_ID ||
    id.startsWith('web-search-root:') ||
    id.startsWith(BROWSER_SEARCH_RESULT_ID_PREFIX);
}

export function normalizeBrowserSearchResultGroups(rawGroups: BrowserSearchResultGroupSetting[] | undefined): BrowserSearchResultGroupSetting[] {
  const seen = new Set<string>();
  const groups: BrowserSearchResultGroupSetting[] = [];
  if (Array.isArray(rawGroups)) {
    for (const group of rawGroups) {
      if (group.kind !== 'open-tab' && group.kind !== 'bookmark' && group.kind !== 'history') continue;
      if (seen.has(group.kind)) continue;
      seen.add(group.kind);
      groups.push({ kind: group.kind, limit: Math.max(0, Math.min(8, Math.floor(Number(group.limit) || 0))) });
    }
  }
  for (const fallback of DEFAULT_BROWSER_SEARCH_RESULT_GROUPS) {
    if (!seen.has(fallback.kind)) groups.push(fallback);
  }
  return groups;
}

export function normalizeBrowserCommandUrl(url: string | undefined): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return raw.toLowerCase().replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

export function formatBrowserHistoryDateSection(value: number | undefined): string {
  const date = new Date(Number(value) || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

export function normalizeBookmarkNicknameUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return String(value || '').trim().toLowerCase().replace(/\/+$/, '');
  }
}

export function normalizeBookmarkNickname(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64);
}

export function getSuggestedBookmarkNickname(result: BrowserSearchResult): string {
  const firstTitleWord = String(result.title || '').trim().split(/\s+/)[0] || '';
  return normalizeBookmarkNickname(firstTitleWord);
}

export function getBrowserResultNicknameKey(result: BrowserSearchResult): string {
  return [
    result.source || '',
    result.sourceProfileId || '',
    normalizeBookmarkNicknameUrl(result.url),
  ].join(':');
}

export function canEditBrowserResultNickname(result: BrowserSearchResult | null | undefined): result is BrowserSearchResult {
  return Boolean(result?.kind === 'bookmark' && result.url && result.source);
}
