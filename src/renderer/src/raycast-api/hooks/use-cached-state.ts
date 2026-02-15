/**
 * raycast-api/hooks/use-cached-state.ts
 * Purpose: useCachedState hook.
 */

import { useCallback, useState } from 'react';

export function useCachedState<T>(
  key: string,
  initialValue?: T,
  config?: { cacheNamespace?: string }
): [T, (value: T | ((prev: T) => T)) => void] {
  const ns = config?.cacheNamespace ? `${config.cacheNamespace}-` : '';
  const storageKey = `sc-cache-${ns}${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : (initialValue as T);
    } catch {
      return initialValue as T;
    }
  });

  const setter = useCallback((newValue: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof newValue === 'function' ? (newValue as (prev: T) => T)(prev) : newValue;
      try {
        localStorage.setItem(storageKey, JSON.stringify(resolved));
      } catch {
        // best-effort
      }
      return resolved;
    });
  }, [storageKey]);

  return [value, setter];
}
