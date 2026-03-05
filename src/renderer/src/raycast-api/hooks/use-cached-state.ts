/**
 * raycast-api/hooks/use-cached-state.ts
 * Purpose: useCachedState hook.
 */

import { useCallback, useState } from 'react';
import { getScopedCachedStateKeys, readScopedJsonState } from './storage-scope';

export function useCachedState<T>(
  key: string,
  initialValue?: T,
  config?: { cacheNamespace?: string }
): [T, (value: T | ((prev: T) => T)) => void] {
  const { scopedKey, legacyKeys } = getScopedCachedStateKeys(key, config?.cacheNamespace);
  const [value, setValue] = useState<T>(() => {
    return readScopedJsonState(scopedKey, legacyKeys, initialValue) as T;
  });

  const setter = useCallback((newValue: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof newValue === 'function' ? (newValue as (prev: T) => T)(prev) : newValue;
      try {
        localStorage.setItem(scopedKey, JSON.stringify(resolved));
      } catch {
        // best-effort
      }
      return resolved;
    });
  }, [scopedKey]);

  return [value, setter];
}
