/**
 * Main-process MenuBarExtra native image cache.
 *
 * Electron's NativeImage creation can decode and resize bitmap data every time
 * a menu-bar payload is accepted. This helper keeps successful decoded/resized
 * images keyed by visible icon inputs while preserving template-image state.
 */

export type MenuBarNativeImageLike = {
  isEmpty?: () => boolean;
  getSize?: () => { width: number; height: number };
  resize?: (options: { width: number; height: number; quality?: string }) => MenuBarNativeImageLike;
  setTemplateImage?: (isTemplate: boolean) => void;
};

export type MenuBarNativeImageFactory = {
  createFromBuffer: (buffer: Buffer, options?: { scaleFactor?: number }) => MenuBarNativeImageLike;
  createFromDataURL: (dataUrl: string) => MenuBarNativeImageLike;
  createFromPath: (pathValue: string) => MenuBarNativeImageLike;
};

export type MenuBarFsLike = {
  statSync: (pathValue: string) => {
    size?: number;
    mtimeMs?: number;
    isFile?: () => boolean;
  };
  readFileSync: (pathValue: string, encoding: 'utf8') => string;
};

export type MenuBarNativeImageCache = {
  getImage: (key: string) => MenuBarNativeImageLike | null;
  setImage: (key: string, image: MenuBarNativeImageLike) => void;
  getSvgDataUrl: (key: string) => string | null;
  setSvgDataUrl: (key: string, dataUrl: string) => void;
  clear: () => void;
  readonly imageSize: number;
  readonly svgDataUrlSize: number;
};

export type CreateCachedMenuBarNativeImageOptions = {
  cache: MenuBarNativeImageCache;
  nativeImage: MenuBarNativeImageFactory;
  fs: MenuBarFsLike;
  pathValue?: string;
  dataUrlValue?: string;
  bitmapScale?: number;
  size: number;
  template: boolean;
  resizeQuality?: string;
};

const DEFAULT_MAX_ENTRIES = 256;

class BoundedLruMap<T> {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, T>();

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): T | null {
    if (!this.entries.has(key)) return null;
    const value = this.entries.get(key) as T;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
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
}

class MenuBarNativeImageCacheImpl implements MenuBarNativeImageCache {
  private readonly images: BoundedLruMap<MenuBarNativeImageLike>;
  private readonly svgDataUrls: BoundedLruMap<string>;

  constructor(maxEntries: number) {
    this.images = new BoundedLruMap(maxEntries);
    this.svgDataUrls = new BoundedLruMap(maxEntries);
  }

  get imageSize(): number {
    return this.images.size;
  }

  get svgDataUrlSize(): number {
    return this.svgDataUrls.size;
  }

  getImage(key: string): MenuBarNativeImageLike | null {
    return this.images.get(key);
  }

  setImage(key: string, image: MenuBarNativeImageLike): void {
    this.images.set(key, image);
  }

  getSvgDataUrl(key: string): string | null {
    return this.svgDataUrls.get(key);
  }

  setSvgDataUrl(key: string, dataUrl: string): void {
    this.svgDataUrls.set(key, dataUrl);
  }

  clear(): void {
    this.images.clear();
    this.svgDataUrls.clear();
  }
}

export function createMenuBarNativeImageCache(maxEntries = DEFAULT_MAX_ENTRIES): MenuBarNativeImageCache {
  return new MenuBarNativeImageCacheImpl(maxEntries);
}

export function normalizeMenuBarBitmapScale(bitmapScale: unknown): number {
  const requestedScale = Number(bitmapScale);
  return Number.isFinite(requestedScale) && requestedScale >= 1 ? requestedScale : 1;
}

export function createCachedMenuBarNativeImage(
  options: CreateCachedMenuBarNativeImageOptions,
): MenuBarNativeImageLike | null {
  const {
    cache,
    nativeImage,
    fs,
    size,
    template,
    resizeQuality,
  } = options;
  const dataUrlValue = String(options.dataUrlValue || '').trim();
  const pathValue = String(options.pathValue || '').trim();
  const bitmapScale = normalizeMenuBarBitmapScale(options.bitmapScale);
  const resizeKey = `size=${size}|scale=${bitmapScale}|template=${template ? 1 : 0}|quality=${resizeQuality || ''}`;

  try {
    if (dataUrlValue.startsWith('data:')) {
      const key = `data:${dataUrlValue}|${resizeKey}`;
      const cached = cache.getImage(key);
      if (cached) return cached;

      let image: MenuBarNativeImageLike | null = null;
      const isRasterPng = dataUrlValue.startsWith('data:image/png');
      if (isRasterPng && bitmapScale > 1) {
        const commaIdx = dataUrlValue.indexOf(',');
        const base64Body = commaIdx >= 0 ? dataUrlValue.slice(commaIdx + 1) : '';
        const buffer = base64Body ? Buffer.from(base64Body, 'base64') : null;
        if (buffer && buffer.length > 0) {
          image = nativeImage.createFromBuffer(buffer, { scaleFactor: bitmapScale });
        }
      }
      if (isEmptyNativeImage(image)) {
        image = nativeImage.createFromDataURL(dataUrlValue);
      }
      const prepared = prepareNativeImageForMenu(image, size, bitmapScale, template, resizeQuality);
      if (!prepared) return null;
      cache.setImage(key, prepared);
      return prepared;
    }

    if (!pathValue) return null;
    const pathIdentity = getMenuBarPathIdentity(fs, pathValue);
    if (!pathIdentity) return null;

    const key = `path:${pathIdentity.cacheKey}|${resizeKey}`;
    const cached = cache.getImage(key);
    if (cached) return cached;

    let image = nativeImage.createFromPath(pathValue);
    if (isEmptyNativeImage(image) && pathIdentity.isSvg) {
      const svgDataUrl = getCachedSvgDataUrl(cache, fs, pathValue, pathIdentity.cacheKey);
      if (svgDataUrl) image = nativeImage.createFromDataURL(svgDataUrl);
    }
    const prepared = prepareNativeImageForMenu(image, size, bitmapScale, template, resizeQuality);
    if (!prepared) return null;
    cache.setImage(key, prepared);
    return prepared;
  } catch {
    return null;
  }
}

function getMenuBarPathIdentity(
  fs: MenuBarFsLike,
  pathValue: string,
): { cacheKey: string; isSvg: boolean } | null {
  try {
    const stat = fs.statSync(pathValue);
    if (typeof stat?.isFile === 'function' && !stat.isFile()) return null;
    const size = Number.isFinite(Number(stat?.size)) ? Number(stat.size) : 0;
    const mtimeMs = Number.isFinite(Number(stat?.mtimeMs)) ? Number(stat.mtimeMs) : 0;
    return {
      cacheKey: `${pathValue}|mtimeMs=${mtimeMs}|bytes=${size}`,
      isSvg: /\.svg$/i.test(pathValue),
    };
  } catch {
    return null;
  }
}

function getCachedSvgDataUrl(
  cache: MenuBarNativeImageCache,
  fs: MenuBarFsLike,
  pathValue: string,
  pathIdentityKey: string,
): string | null {
  const cached = cache.getSvgDataUrl(pathIdentityKey);
  if (cached) return cached;
  try {
    const svg = fs.readFileSync(pathValue, 'utf8');
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    cache.setSvgDataUrl(pathIdentityKey, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

function prepareNativeImageForMenu(
  image: MenuBarNativeImageLike | null | undefined,
  size: number,
  bitmapScale: number,
  template: boolean,
  resizeQuality?: string,
): MenuBarNativeImageLike | null {
  if (isEmptyNativeImage(image)) return null;
  let prepared = image as MenuBarNativeImageLike;

  const currentSize = prepared.getSize?.() || { width: 0, height: 0 };
  const shouldKeepRetinaRep =
    bitmapScale > 1 && currentSize.width === size && currentSize.height === size;
  if (!shouldKeepRetinaRep) {
    if (typeof prepared.resize !== 'function') return null;
    prepared = prepared.resize({
      width: size,
      height: size,
      ...(resizeQuality ? { quality: resizeQuality } : {}),
    });
    if (isEmptyNativeImage(prepared)) return null;
  }

  try {
    prepared.setTemplateImage?.(template);
  } catch {}
  return prepared;
}

function isEmptyNativeImage(image: MenuBarNativeImageLike | null | undefined): boolean {
  if (!image) return true;
  try {
    return Boolean(image.isEmpty?.());
  } catch {
    return true;
  }
}
