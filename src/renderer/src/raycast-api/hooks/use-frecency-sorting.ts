/**
 * raycast-api/hooks/use-frecency-sorting.ts
 * Purpose: useFrecencySorting hook.
 */

import { useCallback, useMemo, useState } from 'react';

interface FrecencyEntry {
  count: number;
  lastVisited: number;
}

function computeFrecencyScore(entry: FrecencyEntry): number {
  const ageHours = (Date.now() - entry.lastVisited) / (1000 * 60 * 60);
  const decay = Math.pow(0.5, ageHours / 72);
  return entry.count * decay;
}

export function useFrecencySorting<T>(
  data: T[] | undefined,
  options?: {
    key?: (item: T) => string;
    namespace?: string;
    sortUnvisited?: (a: T, b: T) => number;
  }
): {
  data: T[];
  visitItem: (item: T) => Promise<void>;
  resetRanking: (item: T) => Promise<void>;
} {
  const ns = options?.namespace || 'default';
  const storageKey = `sc-frecency-${ns}`;
  const getKey = options?.key || ((item: any) => item?.id ?? String(item));

  const [frecencyMap, setFrecencyMap] = useState<Record<string, FrecencyEntry>>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const persistMap = useCallback((map: Record<string, FrecencyEntry>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(map));
    } catch {
      // best-effort
    }
  }, [storageKey]);

  const sortedData = useMemo(() => {
    if (!data) return [];
    if (!Array.isArray(data)) {
      if (typeof data === 'object' && data !== null && 'data' in (data as any)) {
        const innerData = (data as any).data;
        if (Array.isArray(innerData)) return [...innerData];
      }
      return [];
    }

    const items = [...data];
    items.sort((a, b) => {
      const keyA = getKey(a);
      const keyB = getKey(b);
      const entryA = frecencyMap[keyA];
      const entryB = frecencyMap[keyB];

      if (entryA && entryB) return computeFrecencyScore(entryB) - computeFrecencyScore(entryA);
      if (entryA && !entryB) return -1;
      if (!entryA && entryB) return 1;
      if (options?.sortUnvisited) return options.sortUnvisited(a, b);
      return 0;
    });

    return items;
  }, [data, frecencyMap, getKey, options?.sortUnvisited]);

  const visitItem = useCallback(async (item: T) => {
    const k = getKey(item);
    setFrecencyMap((prev) => {
      const entry = prev[k];
      const updated = {
        ...prev,
        [k]: { count: (entry?.count || 0) + 1, lastVisited: Date.now() },
      };
      persistMap(updated);
      return updated;
    });
  }, [getKey, persistMap]);

  const resetRanking = useCallback(async (item: T) => {
    const k = getKey(item);
    setFrecencyMap((prev) => {
      const updated = { ...prev };
      delete updated[k];
      persistMap(updated);
      return updated;
    });
  }, [getKey, persistMap]);

  return { data: sortedData, visitItem, resetRanking };
}
