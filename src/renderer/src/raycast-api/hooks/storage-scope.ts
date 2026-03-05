import { getCurrentScopedExtensionContext } from '../context-scope-runtime';

function getExtensionStorageScope(): string {
  return String(getCurrentScopedExtensionContext()?.extensionName || '').trim() || 'global';
}

function readJsonValue(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCompatibleStoredValue(storedValue: unknown, initialValue: unknown): boolean {
  if (initialValue === undefined) return true;
  if (initialValue === null) return storedValue === null;
  if (Array.isArray(initialValue)) return Array.isArray(storedValue);

  const initialType = typeof initialValue;
  if (initialType !== 'object') return typeof storedValue === initialType;
  if (isPlainObject(initialValue)) return isPlainObject(storedValue);

  return typeof storedValue === 'object';
}

export function getScopedCachedStateKeys(key: string, cacheNamespace?: string): { scopedKey: string; legacyKeys: string[] } {
  const namespacePrefix = cacheNamespace ? `${cacheNamespace}-` : '';
  return {
    scopedKey: `sc-cache:${getExtensionStorageScope()}:${namespacePrefix}${key}`,
    legacyKeys: [`sc-cache-${namespacePrefix}${key}`],
  };
}

export function getScopedLocalStorageKeys(key: string): { scopedKey: string; legacyKeys: string[] } {
  return {
    scopedKey: `raycast:${getExtensionStorageScope()}:${key}`,
    legacyKeys: [`raycast-${key}`],
  };
}

export function readScopedJsonState<T>(
  scopedKey: string,
  legacyKeys: string[],
  initialValue?: T,
): T | undefined {
  const scopedValue = readJsonValue(localStorage.getItem(scopedKey));
  if (scopedValue !== undefined && isCompatibleStoredValue(scopedValue, initialValue)) {
    return scopedValue as T;
  }

  for (const legacyKey of legacyKeys) {
    const legacyValue = readJsonValue(localStorage.getItem(legacyKey));
    if (legacyValue === undefined || !isCompatibleStoredValue(legacyValue, initialValue)) continue;
    try {
      localStorage.setItem(scopedKey, JSON.stringify(legacyValue));
    } catch {
      // best-effort migration
    }
    return legacyValue as T;
  }

  return initialValue;
}
