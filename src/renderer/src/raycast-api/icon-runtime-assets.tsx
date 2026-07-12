/**
 * raycast-api/icon-runtime-assets.tsx
 * Purpose: Icon source/path resolution and tint helpers.
 */

import React from 'react';
import { getIconRuntimeContext } from './icon-runtime-config';

const LOCAL_PATH_EXISTS_CACHE_MAX = 4096;
const positiveLocalPathExistsCache = new Set<string>();
const LOCAL_PATH_MISS_CACHE_MAX = 4096;
const LOCAL_PATH_MISS_CACHE_TTL_MS = 250;
const negativeLocalPathExistsCache = new Map<string, number>();

const CSS_COLOR_CACHE_MAX = 1024;
const normalizedCssColorCache = new Map<string, string>();
const validCssColorCache = new Map<string, boolean>();
const parsedCssColorCache = new Map<string, RgbColor | null>();
const cssRgbVarCache = new Map<string, RgbColor>();
const readableTintColorCache = new Map<string, string>();
let observedThemeRoot: HTMLElement | null = null;
let themeMutationObserver: MutationObserver | null = null;
let observedThemeHead: HTMLHeadElement | null = null;
let themeStylesheetObserver: MutationObserver | null = null;
let themeCacheVersion = 0;
let lastThemeSignature = '';

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

function setBoundedCacheValue<K, V>(cache: Map<K, V>, key: K, value: V, max = CSS_COLOR_CACHE_MAX): V {
  if (!cache.has(key) && cache.size >= max) {
    cache.clear();
  }
  cache.set(key, value);
  return value;
}

export function isEmojiOrSymbol(input: unknown): boolean {
  const s = typeof input === 'string' ? input.trim() : '';
  if (!s) return false;
  if (s.startsWith('data:') || s.startsWith('http') || s.startsWith('/') || s.startsWith('.')) return false;
  if (/\p{Extended_Pictographic}/u.test(s)) return true;
  if (/^[^\w\s]{1,4}$/u.test(s)) return true;
  return false;
}

function encodeAssetPathForUrl(filePath: string): string {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  let decoded = normalized;
  try {
    decoded = decodeURIComponent(normalized);
  } catch {
    decoded = normalized;
  }

  const withLeadingSlash = decoded.startsWith('/') ? decoded : `/${decoded}`;
  const segments = withLeadingSlash.split('/');
  return segments.map((segment, index) => (index === 0 ? '' : encodeURIComponent(segment))).join('/');
}

export function toScAssetUrl(filePath: string): string {
  return `sc-asset://ext-asset${encodeAssetPathForUrl(filePath)}`;
}

function localPathExists(filePath: string): boolean {
  if (!filePath) return false;
  if (positiveLocalPathExistsCache.has(filePath)) return true;

  const nowMs = getLocalPathCacheNowMs();
  const missExpiresAt = negativeLocalPathExistsCache.get(filePath);
  if (typeof missExpiresAt === 'number') {
    if (missExpiresAt > nowMs) return false;
    negativeLocalPathExistsCache.delete(filePath);
  }

  try {
    const stat = (window as any).electron?.statSync?.(filePath);
    const exists = Boolean(stat?.exists);
    if (exists) {
      if (positiveLocalPathExistsCache.size >= LOCAL_PATH_EXISTS_CACHE_MAX) {
        positiveLocalPathExistsCache.clear();
      }
      positiveLocalPathExistsCache.add(filePath);
      negativeLocalPathExistsCache.delete(filePath);
    } else {
      cacheLocalPathMiss(filePath, nowMs);
    }
    return exists;
  } catch {
    cacheLocalPathMiss(filePath, nowMs);
    return false;
  }
}

function getLocalPathCacheNowMs(): number {
  const performanceNow = (globalThis as any).performance?.now;
  if (typeof performanceNow === 'function') return performanceNow.call((globalThis as any).performance);
  return Date.now();
}

function cacheLocalPathMiss(filePath: string, nowMs: number): void {
  if (negativeLocalPathExistsCache.size >= LOCAL_PATH_MISS_CACHE_MAX) {
    negativeLocalPathExistsCache.clear();
  }
  negativeLocalPathExistsCache.set(filePath, nowMs + LOCAL_PATH_MISS_CACHE_TTL_MS);
}

function localPathFromScAssetUrl(src: string): string | null {
  try {
    const parsed = new URL(src);
    if (parsed.protocol !== 'sc-asset:' || parsed.hostname !== 'ext-asset') return null;
    const pathname = decodeURIComponent(parsed.pathname || '');
    return pathname || null;
  } catch {
    return null;
  }
}

export function normalizeScAssetUrl(src: string): string {
  if (typeof src !== 'string' || !src.trim()) return '';
  try {
    const parsed = new URL(src.trim());
    if (parsed.protocol !== 'sc-asset:' || parsed.hostname !== 'ext-asset') return src;
    return toScAssetUrl(parsed.pathname || '');
  } catch {
    return src;
  }
}

export function resolveIconSrc(src: string, assetsPathOverride?: string): string {
  if (typeof src !== 'string') return '';
  const raw = src.trim();
  if (!raw) return '';
  if (/^https?:\/\//.test(raw) || raw.startsWith('data:') || raw.startsWith('file://')) return raw;

  if (raw.startsWith('sc-asset://')) {
    const normalized = normalizeScAssetUrl(raw);
    const localPath = localPathFromScAssetUrl(normalized);
    if (localPath && localPathExists(localPath)) return normalized;
    return '';
  }

  if (raw.startsWith('/')) {
    if (!localPathExists(raw)) return '';
    return toScAssetUrl(raw);
  }

  if (/\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(raw)) {
    const candidateAssetsPath = assetsPathOverride || getIconRuntimeContext().assetsPath || '';
    if (!candidateAssetsPath) return '';

    const candidatePath = `${candidateAssetsPath}/${raw}`;
    if (!localPathExists(candidatePath)) return '';
    return toScAssetUrl(candidatePath);
  }

  return raw;
}

function getDocumentElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement || null;
}

function getDocumentHead(): HTMLHeadElement | null {
  if (typeof document === 'undefined') return null;
  return document.head || null;
}

function readPrefersDark(): boolean {
  return Boolean(getDocumentElement()?.classList?.contains('dark'));
}

function invalidateThemeColorCaches(): void {
  themeCacheVersion += 1;
  parsedCssColorCache.clear();
  cssRgbVarCache.clear();
  readableTintColorCache.clear();
}

function getThemeSignature(root: HTMLElement, prefersDark: boolean): string {
  const className = typeof root.className === 'string'
    ? root.className
    : (root.getAttribute?.('class') || '');
  const styleAttribute = root.getAttribute?.('style') || '';
  return `${prefersDark ? 'dark' : 'light'}|${className}|${styleAttribute}`;
}

function ensureThemeObserver(root: HTMLElement): void {
  const head = getDocumentHead();
  if (observedThemeRoot === root && observedThemeHead === head) return;
  try {
    themeMutationObserver?.disconnect();
    themeStylesheetObserver?.disconnect();
  } catch {
    // Ignore observer cleanup failures.
  }

  observedThemeRoot = root;
  observedThemeHead = head;
  themeMutationObserver = null;
  themeStylesheetObserver = null;

  if (typeof MutationObserver === 'undefined') return;

  try {
    themeMutationObserver = new MutationObserver(() => {
      invalidateThemeColorCaches();
    });
    themeMutationObserver.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  } catch {
    themeMutationObserver = null;
  }

  if (!head) return;
  try {
    themeStylesheetObserver = new MutationObserver(() => {
      invalidateThemeColorCaches();
    });
    themeStylesheetObserver.observe(head, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['href', 'media', 'disabled'],
    });
  } catch {
    themeStylesheetObserver = null;
  }
}

function getThemeCacheKey(): string {
  const root = getDocumentElement();
  if (!root) return `no-document:${themeCacheVersion}`;

  ensureThemeObserver(root);
  const prefersDark = readPrefersDark();
  const signature = getThemeSignature(root, prefersDark);
  if (signature !== lastThemeSignature) {
    lastThemeSignature = signature;
    invalidateThemeColorCaches();
  }

  return `${prefersDark ? 'dark' : 'light'}:${themeCacheVersion}`;
}

function resolveTintColorString(raw: string): string | undefined {
  const normalized = normalizeCssColor(raw);
  return isValidCssColor(normalized) ? normalized : undefined;
}

function canCacheResolvedCssColor(value: string): boolean {
  return !/(var\(|env\(|light-dark\(|currentcolor|inherit|initial|revert|unset)/i.test(value);
}

export function resolveTintColor(tintColor: any): string | undefined {
  if (!tintColor) return undefined;
  if (typeof tintColor === 'string') {
    return resolveTintColorString(tintColor);
  }
  if (typeof tintColor === 'object') {
    const prefersDark = readPrefersDark();
    const raw = prefersDark
      ? (tintColor.dark || tintColor.light)
      : (tintColor.light || tintColor.dark);
    if (typeof raw !== 'string') return undefined;
    return resolveTintColorString(raw);
  }
  return undefined;
}

function isValidCssColor(value: string): boolean {
  if (!value) return false;
  const cached = validCssColorCache.get(value);
  if (cached !== undefined) return cached;
  if (typeof document === 'undefined') return false;

  let isValid = false;
  try {
    const el = document.createElement('span');
    el.style.color = '';
    el.style.color = value;
    isValid = Boolean(el.style.color);
  } catch {
    isValid = false;
  }
  return setBoundedCacheValue(validCssColorCache, value, isValid);
}

function normalizeCssColor(value: string): string {
  const cached = normalizedCssColorCache.get(value);
  if (cached !== undefined) return cached;

  const v = value.trim();
  const normalized = /^[0-9a-f]{3}$/i.test(v) || /^[0-9a-f]{6}$/i.test(v) || /^[0-9a-f]{8}$/i.test(v)
    ? `#${v}`
    : v;
  return setBoundedCacheValue(normalizedCssColorCache, value, normalized);
}

function parseCssColorToRgb(value: string, themeKey: string): RgbColor | null {
  const canCache = canCacheResolvedCssColor(value);
  const cacheKey = `${themeKey}|${value}`;
  if (canCache && parsedCssColorCache.has(cacheKey)) return parsedCssColorCache.get(cacheKey) || null;
  if (typeof document === 'undefined' || !document.body) return null;

  let parsed: RgbColor | null = null;
  let el: HTMLElement | null = null;
  try {
    el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
    el.style.color = value;
    document.body.appendChild(el);
    const computed = window.getComputedStyle(el).color;

    const match = computed.match(/rgba?\(([^)]+)\)/i);
    if (match) {
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
      if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
        parsed = {
          r: Math.max(0, Math.min(255, Math.round(parts[0]))),
          g: Math.max(0, Math.min(255, Math.round(parts[1]))),
          b: Math.max(0, Math.min(255, Math.round(parts[2]))),
        };
      }
    }
  } catch {
    parsed = null;
  } finally {
    el?.remove();
  }

  return canCache ? setBoundedCacheValue(parsedCssColorCache, cacheKey, parsed) : parsed;
}

function readCssRgbVar(variableName: string, fallback: RgbColor, themeKey: string): RgbColor {
  const cacheKey = `${themeKey}|${variableName}|${fallback.r},${fallback.g},${fallback.b}`;
  const cached = cssRgbVarCache.get(cacheKey);
  if (cached) return cached;

  let resolved = fallback;
  try {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
    const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      resolved = {
        r: Math.max(0, Math.min(255, Math.round(parts[0]))),
        g: Math.max(0, Math.min(255, Math.round(parts[1]))),
        b: Math.max(0, Math.min(255, Math.round(parts[2]))),
      };
    }
  } catch {
    // fall through to fallback
  }
  return setBoundedCacheValue(cssRgbVarCache, cacheKey, resolved);
}

function mixRgb(base: RgbColor, target: RgbColor, amount: number): RgbColor {
  return {
    r: Math.round(base.r + (target.r - base.r) * amount),
    g: Math.round(base.g + (target.g - base.g) * amount),
    b: Math.round(base.b + (target.b - base.b) * amount),
  };
}

function srgbToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RgbColor): number {
  return (0.2126 * srgbToLinear(color.r)) + (0.7152 * srgbToLinear(color.g)) + (0.0722 * srgbToLinear(color.b));
}

function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function formatRgb(color: RgbColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

export function resolveReadableTintColor(tintColor: any, options?: { minContrast?: number }): string | undefined {
  const resolved = resolveTintColor(tintColor);
  if (!resolved) return undefined;

  const themeKey = getThemeCacheKey();
  const minContrast = options?.minContrast ?? 4.5;
  const canCache = canCacheResolvedCssColor(resolved);
  const readableCacheKey = `${themeKey}|${resolved}|${minContrast}`;
  const cached = canCache ? readableTintColorCache.get(readableCacheKey) : undefined;
  if (cached) return cached;

  const color = parseCssColorToRgb(resolved, themeKey);
  if (!color) {
    return canCache ? setBoundedCacheValue(readableTintColorCache, readableCacheKey, resolved) : resolved;
  }

  const prefersDark = readPrefersDark();
  const background = readCssRgbVar('--surface-base-rgb', prefersDark
    ? { r: 30, g: 31, b: 36 }
    : { r: 247, g: 248, b: 250 }, themeKey);

  if (contrastRatio(color, background) >= minContrast) {
    return canCache ? setBoundedCacheValue(readableTintColorCache, readableCacheKey, resolved) : resolved;
  }

  const target = prefersDark
    ? { r: 255, g: 255, b: 255 }
    : { r: 17, g: 23, b: 32 };

  for (let step = 1; step <= 12; step += 1) {
    const adjusted = mixRgb(color, target, step / 12);
    if (contrastRatio(adjusted, background) >= minContrast) {
      const readable = formatRgb(adjusted);
      return canCache ? setBoundedCacheValue(readableTintColorCache, readableCacheKey, readable) : readable;
    }
  }

  const readable = formatRgb(mixRgb(color, target, 1));
  return canCache ? setBoundedCacheValue(readableTintColorCache, readableCacheKey, readable) : readable;
}

export function addHexAlpha(color: string, alphaHex: string): string | undefined {
  const m = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${hex}${alphaHex}`;
}

export function renderTintedAssetIcon(resolvedSrc: string, className: string, tint: string): React.ReactNode {
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        backgroundColor: tint,
        WebkitMask: `url("${resolvedSrc}") center / contain no-repeat`,
        mask: `url("${resolvedSrc}") center / contain no-repeat`,
      }}
    />
  );
}
