export type ExtensionWrapperFunction = (...args: any[]) => any;

export const EXTENSION_WRAPPER_ARGUMENTS = [
  'exports',
  'require',
  'module',
  '__filename',
  '__dirname',
  'process',
  'Buffer',
  'global',
  'globalThis',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'window',
  'document',
  'navigator',
  '__scDynamicImport',
] as const;

const MAX_COMPILED_EXTENSION_WRAPPERS = 32;

interface CacheEntry {
  wrapper: ExtensionWrapperFunction;
  codeLength: number;
  codeHash: string;
}

interface CodeFingerprint {
  code: string;
  codeLength: number;
  codeHash: string;
}

interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
  wrapperCreationCount: number;
  wrapperCreationMs: number;
}

const compiledWrapperCache = new Map<string, CacheEntry>();
const codeFingerprintCache = new Map<string, CodeFingerprint>();
const cacheStats: CacheStats = {
  entries: 0,
  hits: 0,
  misses: 0,
  evictions: 0,
  wrapperCreationCount: 0,
  wrapperCreationMs: 0,
};

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function hashExtensionCodeForCache(code: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    hash ^= code.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function createExtensionWrapperCacheKey(extensionIdentity: string, code: string): string {
  const identity = extensionIdentity || 'unknown-extension';
  return `${identity}\0${code.length}\0${hashExtensionCodeForCache(code)}`;
}

function createExtensionWrapperCacheKeyFromFingerprint(
  extensionIdentity: string,
  fingerprint: CodeFingerprint
): string {
  return `${extensionIdentity}\0${fingerprint.codeLength}\0${fingerprint.codeHash}`;
}

function getCodeFingerprint(extensionIdentity: string, code: string): CodeFingerprint {
  const cached = codeFingerprintCache.get(extensionIdentity);
  if (cached?.code === code) {
    codeFingerprintCache.delete(extensionIdentity);
    codeFingerprintCache.set(extensionIdentity, cached);
    return cached;
  }

  const fingerprint = {
    code,
    codeLength: code.length,
    codeHash: hashExtensionCodeForCache(code),
  };
  codeFingerprintCache.set(extensionIdentity, fingerprint);

  if (codeFingerprintCache.size > MAX_COMPILED_EXTENSION_WRAPPERS) {
    const oldestKey = codeFingerprintCache.keys().next().value;
    if (oldestKey) codeFingerprintCache.delete(oldestKey);
  }

  return fingerprint;
}

export function getCompiledExtensionWrapper(options: {
  extensionIdentity: string;
  code: string;
  executableCode?: string;
}): {
  wrapper: ExtensionWrapperFunction;
  cacheHit: boolean;
  cacheKey: string;
  codeLength: number;
  codeHash: string;
  wrapperCreationMs: number;
} {
  const extensionIdentity = options.extensionIdentity || 'unknown-extension';
  const executableCode = String(options.executableCode ?? options.code ?? '');
  const sourceCode = executableCode;
  const fingerprint = getCodeFingerprint(extensionIdentity, sourceCode);
  const cacheKey = createExtensionWrapperCacheKeyFromFingerprint(extensionIdentity, fingerprint);
  const cached = compiledWrapperCache.get(cacheKey);

  if (cached) {
    cacheStats.hits++;
    compiledWrapperCache.delete(cacheKey);
    compiledWrapperCache.set(cacheKey, cached);
    return {
      wrapper: cached.wrapper,
      cacheHit: true,
      cacheKey,
      codeLength: cached.codeLength,
      codeHash: cached.codeHash,
      wrapperCreationMs: 0,
    };
  }

  cacheStats.misses++;
  const start = nowMs();
  const wrapper = new Function(
    ...EXTENSION_WRAPPER_ARGUMENTS,
    executableCode
  ) as ExtensionWrapperFunction;
  const wrapperCreationMs = nowMs() - start;

  cacheStats.wrapperCreationCount++;
  cacheStats.wrapperCreationMs += wrapperCreationMs;

  compiledWrapperCache.set(cacheKey, {
    wrapper,
    codeLength: fingerprint.codeLength,
    codeHash: fingerprint.codeHash,
  });

  if (compiledWrapperCache.size > MAX_COMPILED_EXTENSION_WRAPPERS) {
    const oldestKey = compiledWrapperCache.keys().next().value;
    if (oldestKey) {
      compiledWrapperCache.delete(oldestKey);
      cacheStats.evictions++;
    }
  }

  cacheStats.entries = compiledWrapperCache.size;

  return {
    wrapper,
    cacheHit: false,
    cacheKey,
    codeLength: fingerprint.codeLength,
    codeHash: fingerprint.codeHash,
    wrapperCreationMs,
  };
}

export function getCompiledExtensionWrapperCacheStats(): CacheStats {
  return {
    ...cacheStats,
    entries: compiledWrapperCache.size,
  };
}

export function clearCompiledExtensionWrapperCache(): void {
  compiledWrapperCache.clear();
  codeFingerprintCache.clear();
  cacheStats.entries = 0;
  cacheStats.hits = 0;
  cacheStats.misses = 0;
  cacheStats.evictions = 0;
  cacheStats.wrapperCreationCount = 0;
  cacheStats.wrapperCreationMs = 0;
}
