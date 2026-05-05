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

export function useBrowserSearch(_currentQuery: string): UseBrowserSearchResult {
  const [entries, setEntries] = useState<BrowserSearchEntry[]>([]);
  const [enabled, setEnabled] = useState<boolean>(true);
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

  const getCompletion = useCallback((rawInput: string): BrowserSearchAutocomplete | null => {
    if (!enabled) return null;
    const input = rawInput;
    if (!input.trim()) return null;
    const list = entriesRef.current;

    const lower = input.toLowerCase();
    const stripped = lower.replace(/^https?:\/\//, '');
    const protocolPrefix = lower !== stripped ? input.slice(0, input.length - stripped.length) : '';

    // Pass 1: URL completion. Match against the full URL after the protocol
    // (host + path + query), so frequent deep links like `github.com/shobhit99`
    // surface instead of just the bare host. Also try the `www.`-stripped form.
    let bestUrl: { entry: BrowserSearchEntry; matched: string; score: number } | null = null;
    for (const entry of list) {
      if (entry.type !== 'url') continue;
      const sourceUrl = entry.url || entry.host;
      if (!sourceUrl) continue;
      const fullStripped = sourceUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      if (!fullStripped) continue;
      const candidates = fullStripped.toLowerCase().startsWith('www.')
        ? [fullStripped, fullStripped.slice(4)]
        : [fullStripped];
      for (const candidate of candidates) {
        if (candidate.length > stripped.length && candidate.toLowerCase().startsWith(stripped)) {
          const score = frecency(entry);
          if (!bestUrl || score > bestUrl.score) bestUrl = { entry, matched: candidate, score };
          break;
        }
      }
    }
    if (bestUrl) {
      const completion = input + bestUrl.matched.slice(stripped.length);
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

    return null;
  }, [enabled]);

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
