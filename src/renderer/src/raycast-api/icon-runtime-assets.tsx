/**
 * raycast-api/icon-runtime-assets.tsx
 * Purpose: Icon source/path resolution and tint helpers.
 */

import React from 'react';
import { getIconRuntimeContext } from './icon-runtime-config';

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

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
  try {
    const stat = (window as any).electron?.statSync?.(filePath);
    return Boolean(stat?.exists);
  } catch {
    return false;
  }
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

export function resolveTintColor(tintColor: any): string | undefined {
  if (!tintColor) return undefined;
  if (typeof tintColor === 'string') {
    const normalized = normalizeCssColor(tintColor);
    return isValidCssColor(normalized) ? normalized : undefined;
  }
  if (typeof tintColor === 'object') {
    const prefersDark = document.documentElement.classList.contains('dark');
    const raw = prefersDark
      ? (tintColor.dark || tintColor.light)
      : (tintColor.light || tintColor.dark);
    if (typeof raw !== 'string') return undefined;
    const normalized = normalizeCssColor(raw);
    return isValidCssColor(normalized) ? normalized : undefined;
  }
  return undefined;
}

function isValidCssColor(value: string): boolean {
  try {
    const el = document.createElement('span');
    el.style.color = '';
    el.style.color = value;
    return Boolean(el.style.color);
  } catch {
    return false;
  }
}

function normalizeCssColor(value: string): string {
  const v = value.trim();
  if (/^[0-9a-f]{3}$/i.test(v) || /^[0-9a-f]{6}$/i.test(v) || /^[0-9a-f]{8}$/i.test(v)) return `#${v}`;
  return v;
}

function parseCssColorToRgb(value: string): RgbColor | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const el = document.createElement('span');
  el.style.position = 'absolute';
  el.style.visibility = 'hidden';
  el.style.pointerEvents = 'none';
  el.style.color = value;
  document.body.appendChild(el);
  const computed = window.getComputedStyle(el).color;
  el.remove();

  const match = computed.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) return null;
  return {
    r: Math.max(0, Math.min(255, Math.round(parts[0]))),
    g: Math.max(0, Math.min(255, Math.round(parts[1]))),
    b: Math.max(0, Math.min(255, Math.round(parts[2]))),
  };
}

function readCssRgbVar(variableName: string, fallback: RgbColor): RgbColor {
  try {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
    const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      return {
        r: Math.max(0, Math.min(255, Math.round(parts[0]))),
        g: Math.max(0, Math.min(255, Math.round(parts[1]))),
        b: Math.max(0, Math.min(255, Math.round(parts[2]))),
      };
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
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

  const color = parseCssColorToRgb(resolved);
  if (!color) return resolved;

  const prefersDark = document.documentElement.classList.contains('dark');
  const background = readCssRgbVar('--surface-base-rgb', prefersDark
    ? { r: 30, g: 31, b: 36 }
    : { r: 247, g: 248, b: 250 });
  const minContrast = options?.minContrast ?? 4.5;

  if (contrastRatio(color, background) >= minContrast) return resolved;

  const target = prefersDark
    ? { r: 255, g: 255, b: 255 }
    : { r: 17, g: 23, b: 32 };

  for (let step = 1; step <= 12; step += 1) {
    const adjusted = mixRgb(color, target, step / 12);
    if (contrastRatio(adjusted, background) >= minContrast) {
      return formatRgb(adjusted);
    }
  }

  return formatRgb(mixRgb(color, target, 1));
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
