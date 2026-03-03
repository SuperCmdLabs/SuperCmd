/**
 * raycast-api/hooks/use-local-storage.ts
 * Purpose: useLocalStorage hook.
 */

import { useCallback, useState } from 'react';
import { emitExtensionStorageChanged } from '../storage-events';
import { getScopedLocalStorageKeys, readScopedJsonState } from './storage-scope';

export function useLocalStorage<T>(
  key: string,
  initialValue?: T
): {
  value: T | undefined;
  setValue: (value: T) => Promise<void>;
  removeValue: () => Promise<void>;
  isLoading: boolean;
} {
  const { scopedKey, legacyKeys } = getScopedLocalStorageKeys(key);
  const [value, setValueState] = useState<T | undefined>(() => {
    return readScopedJsonState(scopedKey, legacyKeys, initialValue);
  });
  const [isLoading] = useState(false);

  const setValue = useCallback(async (newValue: T) => {
    setValueState(newValue);
    try {
      localStorage.setItem(scopedKey, JSON.stringify(newValue));
    } catch {
      // best-effort
    }
    emitExtensionStorageChanged();
  }, [scopedKey]);

  const removeValue = useCallback(async () => {
    setValueState(undefined);
    try {
      localStorage.removeItem(scopedKey);
      for (const legacyKey of legacyKeys) {
        localStorage.removeItem(legacyKey);
      }
    } catch {
      // best-effort
    }
    emitExtensionStorageChanged();
  }, [legacyKeys, scopedKey]);

  return { value, setValue, removeValue, isLoading };
}
