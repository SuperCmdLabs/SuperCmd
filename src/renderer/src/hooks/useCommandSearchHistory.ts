import { useState, useCallback } from 'react';
import { SEARCH_HISTORY_KEY, MAX_SEARCH_HISTORY } from '../utils/constants';

export function useCommandSearchHistory() {
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });

  const [historyIndex, setHistoryIndex] = useState(-1);

  const addToHistory = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const filtered = prev.filter((q) => q !== trimmed);
      const next = [trimmed, ...filtered].slice(0, MAX_SEARCH_HISTORY);
      try {
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const resetHistoryIndex = useCallback(() => {
    setHistoryIndex(-1);
  }, []);

  // Navigate to an older (less recent) history entry.
  // Returns the query string, or null if there are no more entries.
  const navigateHistoryUp = useCallback((): string | null => {
    if (history.length === 0) return null;
    const next = historyIndex + 1;
    if (next >= history.length) return null;
    setHistoryIndex(next);
    return history[next];
  }, [history, historyIndex]);

  // Navigate to a newer (more recent) history entry, or exit history mode.
  // Returns '' when exiting history mode, or null if not currently in history mode.
  const navigateHistoryDown = useCallback((): string | null => {
    if (historyIndex < 0) return null;
    if (historyIndex === 0) {
      setHistoryIndex(-1);
      return '';
    }
    const next = historyIndex - 1;
    setHistoryIndex(next);
    return history[next];
  }, [history, historyIndex]);

  return {
    historyIndex,
    addToHistory,
    resetHistoryIndex,
    navigateHistoryUp,
    navigateHistoryDown,
  };
}
