import * as fs from 'fs';
import * as path from 'path';

export type FileIconSizeBucket = 'small' | 'normal' | 'large';

export type FileIconImageLike = {
  isEmpty(): boolean;
  resize(options: { width: number; height: number }): { toDataURL(): string };
};

export type FileIconProvider = (
  filePath: string,
  options: { size: FileIconSizeBucket },
) => Promise<FileIconImageLike | null | undefined>;

export type AppIconResolver = (appPath: string, size: number) => string | null;
export type IconCacheTokenProvider = (sourcePath: string) => string | null | undefined;

export const FILE_ICON_DATA_URL_CACHE_MAX_ENTRIES = 512;
export const APP_ICON_DATA_URL_CACHE_MAX_ENTRIES = 256;

export class BoundedIconLruCache<Value> {
  private readonly entries = new Map<string, Value>();

  constructor(private readonly maxEntries: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): Value | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as Value;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: Value): void {
    if (this.maxEntries <= 0) return;
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  keys(): string[] {
    return Array.from(this.entries.keys());
  }
}

export function normalizeIconLogicalSize(size: unknown, fallback: number): number {
  const numeric = typeof size === 'number' ? size : Number(size);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.round(numeric));
}

export function getFileIconSizeBucket(size: number): FileIconSizeBucket {
  if (size <= 16) return 'small';
  if (size >= 64) return 'large';
  return 'normal';
}

export function normalizeIconCachePath(filePath: string): string {
  const raw = String(filePath || '');
  if (!raw) return '';
  return path.resolve(raw);
}

export function readIconPathCacheToken(filePath: string): string {
  const normalizedPath = normalizeIconCachePath(filePath);
  if (!normalizedPath) return 'empty';
  try {
    const stat = fs.statSync(normalizedPath);
    const kind = stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
    return [kind, String(stat.mtimeMs), String(stat.ctimeMs), String(stat.size), String(stat.ino)].join(':');
  } catch {
    return 'missing';
  }
}

function readProvidedIconCacheToken(
  provider: IconCacheTokenProvider | undefined,
  sourcePath: string,
): string {
  try {
    if (!provider) return readIconPathCacheToken(sourcePath);
    return String(provider(sourcePath) ?? readIconPathCacheToken(sourcePath));
  } catch {
    return 'metadata-error';
  }
}

export function buildFileIconCacheKey(
  filePath: string,
  size: unknown,
  cacheToken = readIconPathCacheToken(filePath),
): string {
  const logicalSize = normalizeIconLogicalSize(size, 20);
  return [
    normalizeIconCachePath(filePath),
    String(logicalSize),
    getFileIconSizeBucket(logicalSize),
    cacheToken,
  ].join('\0');
}

export function buildAppIconCacheKey(
  appPath: string,
  size: unknown,
  cacheToken = readIconPathCacheToken(appPath),
): string {
  const logicalSize = normalizeIconLogicalSize(size, 32);
  return [normalizeIconCachePath(appPath), String(logicalSize), cacheToken].join('\0');
}

export function createFileIconDataUrlCache(options: {
  getFileIcon: FileIconProvider;
  getFileIconCacheToken?: IconCacheTokenProvider;
  maxEntries?: number;
}) {
  const cache = new BoundedIconLruCache<string>(
    options.maxEntries ?? FILE_ICON_DATA_URL_CACHE_MAX_ENTRIES,
  );
  const inFlight = new Map<string, Promise<string | null>>();

  async function resolve(filePath: string, size: unknown = 20): Promise<string | null> {
    const logicalSize = normalizeIconLogicalSize(size, 20);
    const bucket = getFileIconSizeBucket(logicalSize);
    const cacheToken = readProvidedIconCacheToken(options.getFileIconCacheToken, filePath);
    const key = buildFileIconCacheKey(filePath, logicalSize, cacheToken);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const pending = inFlight.get(key);
    if (pending) return pending;

    const request = Promise.resolve()
      .then(async () => {
        const icon = await options.getFileIcon(filePath, { size: bucket });
        if (!icon || icon.isEmpty()) return null;
        const dataUrl = icon.resize({ width: logicalSize, height: logicalSize }).toDataURL();
        if (typeof dataUrl === 'string') cache.set(key, dataUrl);
        return typeof dataUrl === 'string' ? dataUrl : null;
      })
      .catch(() => null)
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  }

  return {
    resolve,
    clear: () => {
      cache.clear();
      inFlight.clear();
    },
    stats: () => ({
      cacheSize: cache.size,
      inFlightSize: inFlight.size,
      keys: cache.keys(),
      maxEntries: options.maxEntries ?? FILE_ICON_DATA_URL_CACHE_MAX_ENTRIES,
    }),
  };
}

export function createAppIconDataUrlCache(options: {
  resolveAppIconDataUrl: AppIconResolver;
  getAppIconCacheToken?: IconCacheTokenProvider;
  maxEntries?: number;
}) {
  const cache = new BoundedIconLruCache<string>(
    options.maxEntries ?? APP_ICON_DATA_URL_CACHE_MAX_ENTRIES,
  );
  const inFlight = new Map<string, Promise<string | null>>();

  function resolveFromSource(appPath: string, logicalSize: number, key: string): string | null {
    try {
      const dataUrl = options.resolveAppIconDataUrl(appPath, logicalSize);
      if (typeof dataUrl === 'string') cache.set(key, dataUrl);
      return typeof dataUrl === 'string' ? dataUrl : null;
    } catch {
      return null;
    }
  }

  function resolveSync(appPath: string, size: unknown = 32): string | null {
    const logicalSize = normalizeIconLogicalSize(size, 32);
    const cacheToken = readProvidedIconCacheToken(options.getAppIconCacheToken, appPath);
    const key = buildAppIconCacheKey(appPath, logicalSize, cacheToken);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    return resolveFromSource(appPath, logicalSize, key);
  }

  async function resolve(appPath: string, size: unknown = 32): Promise<string | null> {
    const logicalSize = normalizeIconLogicalSize(size, 32);
    const cacheToken = readProvidedIconCacheToken(options.getAppIconCacheToken, appPath);
    const key = buildAppIconCacheKey(appPath, logicalSize, cacheToken);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const pending = inFlight.get(key);
    if (pending) return pending;

    const request = Promise.resolve()
      .then(() => resolveFromSource(appPath, logicalSize, key))
      .catch(() => null)
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  }

  return {
    resolve,
    resolveSync,
    clear: () => {
      cache.clear();
      inFlight.clear();
    },
    stats: () => ({
      cacheSize: cache.size,
      inFlightSize: inFlight.size,
      keys: cache.keys(),
      maxEntries: options.maxEntries ?? APP_ICON_DATA_URL_CACHE_MAX_ENTRIES,
    }),
  };
}
