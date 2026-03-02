/**
 * raycast-api/hooks/use-local-storage.ts
 * Purpose: useLocalStorage hook.
 */

import { useCallback, useState } from 'react';
import { emitExtensionStorageChanged } from '../storage-events';

export function useLocalStorage<T>(
  key: string,
  initialValue?: T
): {
  value: T | undefined;
  setValue: (value: T) => Promise<void>;
  removeValue: () => Promise<void>;
  isLoading: boolean;
} {
  const [value, setValueState] = useState<T | undefined>(() => {
    try {
      const stored = localStorage.getItem(`raycast-${key}`);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });
  const [isLoading] = useState(false);

  const setValue = useCallback(async (newValue: T) => {
    setValueState(newValue);
    try {
      localStorage.setItem(`raycast-${key}`, JSON.stringify(newValue));
    } catch {
      // best-effort
    }
    emitExtensionStorageChanged();
  }, [key]);

  const removeValue = useCallback(async () => {
    setValueState(undefined);
    try {
      localStorage.removeItem(`raycast-${key}`);
    } catch {
      // best-effort
    }
    emitExtensionStorageChanged();
  }, [key]);

  return { value, setValue, removeValue, isLoading };
}
