import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BrowserSearchAutocomplete,
  BrowserSearchEntry,
} from '../../types/electron';

export interface ResolvedBrowserInput {
  type: 'url' | 'search';
  /** Resolved URL we'll open (search engine URL for `search` type). */
  url: string;
  /** Host for URL type, empty string for search. */
  host: string;
}

interface UseBrowserSearchResult {
  enabled: boolean;
  getCompletion: (input: string) => BrowserSearchAutocomplete | null;
  executeBrowserSearch: (input: string) => Promise<boolean>;
  /** Synchronous URL/search detection — returns null for empty input. */
  resolve: (input: string) => ResolvedBrowserInput | null;
}

export function useBrowserSearch(currentQuery: string): UseBrowserSearchResult {
  const [entries, setEntries] = useState<BrowserSearchEntry[]>([]);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [liveSuggestion, setLiveSuggestion] = useState<{ query: string; suggestion: string } | null>(null);
  const entriesRef = useRef<BrowserSearchEntry[]>([]);
  entriesRef.current = entries;

  const refresh = useCallback(() => {
    window.electron.browserSearchListEntries()
      .then((list) => {
        setEntries(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        setEntries([]);
      });
  }, []);

  useEffect(() => {
    let disposed = false;
    window.electron.getSettings()
      .then((s) => {
        if (disposed) return;
        setEnabled(s?.browserSearch?.enabled ?? true);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((s) => {
      setEnabled(s?.browserSearch?.enabled ?? true);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      return;
    }
    refresh();
    const unsubscribe = window.electron.onBrowserSearchHistoryChanged?.(() => refresh());
    return () => {
      try {
        unsubscribe?.();
      } catch {}
    };
  }, [enabled, refresh]);

  // Debounced live-suggestion fetch from Google's suggest endpoint. Used as
  // a fallback when there's no history match, so users see autocomplete
  // even on queries they've never typed before.
  useEffect(() => {
    if (!enabled) {
      setLiveSuggestion(null);
      return;
    }
    const trimmed = currentQuery.trim();
    if (!trimmed) {
      setLiveSuggestion(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        const result = await window.electron.browserSearchSuggest(trimmed);
        if (cancelled) return;
        if (
          result &&
          result.length > trimmed.length &&
          result.toLowerCase().startsWith(trimmed.toLowerCase())
        ) {
          setLiveSuggestion({ query: trimmed, suggestion: result });
        } else {
          setLiveSuggestion(null);
        }
      } catch {
        if (!cancelled) setLiveSuggestion(null);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [enabled, currentQuery]);

  const getCompletion = useCallback((rawInput: string): BrowserSearchAutocomplete | null => {
    if (!enabled) return null;
    const input = rawInput;
    if (!input.trim()) return null;
    const list = entriesRef.current;

    const lower = input.toLowerCase();
    const stripped = lower.replace(/^https?:\/\//, '');
    const protocolPrefix = lower !== stripped ? input.slice(0, input.length - stripped.length) : '';

    // Pass 1: URL host completion. Match host (and host without `www.` prefix).
    let bestUrl: { entry: BrowserSearchEntry; host: string; score: number } | null = null;
    for (const entry of list) {
      if (entry.type !== 'url' || !entry.host) continue;
      const candidates = entry.host.startsWith('www.') ? [entry.host, entry.host.slice(4)] : [entry.host];
      for (const host of candidates) {
        if (host.length > stripped.length && host.startsWith(stripped)) {
          const score = frecency(entry);
          if (!bestUrl || score > bestUrl.score) bestUrl = { entry, host, score };
          break;
        }
      }
    }
    if (bestUrl) {
      const completion = protocolPrefix + input.slice(protocolPrefix.length) + bestUrl.host.slice(stripped.length);
      return {
        completion,
        suffix: completion.slice(input.length),
        entry: bestUrl.entry,
      };
    }

    // Pass 2: search query prefix.
    let bestSearch: { entry: BrowserSearchEntry; score: number } | null = null;
    for (const entry of list) {
      if (entry.type !== 'search') continue;
      if (entry.query.length <= input.length) continue;
      if (!entry.query.toLowerCase().startsWith(lower)) continue;
      const score = frecency(entry);
      if (!bestSearch || score > bestSearch.score) bestSearch = { entry, score };
    }
    if (bestSearch) {
      const completion = input + bestSearch.entry.query.slice(input.length);
      return {
        completion,
        suffix: completion.slice(input.length),
        entry: bestSearch.entry,
      };
    }

    // Pass 3: live search-engine suggestion (only if the cached suggestion
    // is keyed to *this* exact trimmed query — otherwise we'd flash a
    // stale extension when the user keeps typing).
    const trimmed = input.trim();
    if (
      liveSuggestion &&
      liveSuggestion.query === trimmed &&
      liveSuggestion.suggestion.length > input.length &&
      liveSuggestion.suggestion.toLowerCase().startsWith(lower)
    ) {
      const completion = input + liveSuggestion.suggestion.slice(input.length);
      return {
        completion,
        suffix: completion.slice(input.length),
        entry: {
          id: 'browser-search-live-suggestion',
          type: 'search',
          query: liveSuggestion.suggestion,
          url: '',
          host: '',
          lastUsedAt: Date.now(),
          useCount: 1,
          source: 'user',
        },
      };
    }

    return null;
  }, [enabled, liveSuggestion]);

  const executeBrowserSearch = useCallback(async (input: string): Promise<boolean> => {
    if (!enabled) return false;
    const trimmed = input.trim();
    if (!trimmed) return false;
    try {
      const result = await window.electron.browserSearchOpen(trimmed);
      return Boolean(result?.ok);
    } catch (e) {
      console.error('Browser search open failed:', e);
      return false;
    }
  }, [enabled]);

  return useMemo(
    () => ({ enabled, getCompletion, executeBrowserSearch, resolve: resolveLocal }),
    [enabled, getCompletion, executeBrowserSearch]
  );
}

const URL_PROTOCOL_RE = /^[a-z][\w+.\-]*:\/\//i;
const LOCALHOST_RE = /^localhost(:\d+)?(\/.*)?$/i;
const IP_RE = /^\d{1,3}(?:\.\d{1,3}){3}(:\d+)?(\/.*)?$/;
const URL_BODY_RE = /^[\w.\-:/?#[\]@!$&'()*+,;=%~]+$/;

function resolveLocal(rawInput: string): ResolvedBrowserInput | null {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;
  if (URL_PROTOCOL_RE.test(trimmed)) return { type: 'url', url: trimmed, host: extractHost(trimmed) };
  const noSpaces = !/\s/.test(trimmed);
  const looksLikeUrl =
    noSpaces &&
    URL_BODY_RE.test(trimmed) &&
    (LOCALHOST_RE.test(trimmed) || IP_RE.test(trimmed) || /^[\w-]+(\.[\w-]+)+/.test(trimmed));
  if (looksLikeUrl) {
    const url = `https://${trimmed}`;
    return { type: 'url', url, host: extractHost(url) };
  }
  return { type: 'search', url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`, host: '' };
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
