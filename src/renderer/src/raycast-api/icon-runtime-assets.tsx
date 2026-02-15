/**
 * raycast-api/icon-runtime-assets.tsx
 * Purpose: Icon source/path resolution and tint helpers.
 */

import React from 'react';
import { getIconRuntimeContext } from './icon-runtime-config';

export function isEmojiOrSymbol(s: string): boolean {
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
  try {
    const parsed = new URL(src);
    if (parsed.protocol !== 'sc-asset:' || parsed.hostname !== 'ext-asset') return src;
    return toScAssetUrl(parsed.pathname || '');
  } catch {
    return src;
  }
}

export function resolveIconSrc(src: string, assetsPathOverride?: string): string {
  if (/^https?:\/\//.test(src) || src.startsWith('data:') || src.startsWith('file://')) return src;

  if (src.startsWith('sc-asset://')) {
    const normalized = normalizeScAssetUrl(src);
    const localPath = localPathFromScAssetUrl(normalized);
    if (localPath && localPathExists(localPath)) return normalized;
    return '';
  }

  if (src.startsWith('/')) {
    if (!localPathExists(src)) return '';
    return toScAssetUrl(src);
  }

  if (/\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(src)) {
    const candidateAssetsPath = assetsPathOverride || getIconRuntimeContext().assetsPath || '';
    if (!candidateAssetsPath) return '';

    const candidatePath = `${candidateAssetsPath}/${src}`;
    if (!localPathExists(candidatePath)) return '';
    return toScAssetUrl(candidatePath);
  }

  return src;
}

export function resolveTintColor(tintColor: any): string | undefined {
  const isValidCssColor = (value: string): boolean => {
    try {
      const el = document.createElement('span');
      el.style.color = '';
      el.style.color = value;
      return Boolean(el.style.color);
    } catch {
      return false;
    }
  };

  const normalizeCssColor = (value: string): string => {
    const v = value.trim();
    if (/^[0-9a-f]{3}$/i.test(v) || /^[0-9a-f]{6}$/i.test(v) || /^[0-9a-f]{8}$/i.test(v)) return `#${v}`;
    return v;
  };

  if (!tintColor) return undefined;
  if (typeof tintColor === 'string') {
    const normalized = normalizeCssColor(tintColor);
    return isValidCssColor(normalized) ? normalized : undefined;
  }
  if (typeof tintColor === 'object') {
    const raw = tintColor.dark || tintColor.light;
    if (typeof raw !== 'string') return undefined;
    const normalized = normalizeCssColor(raw);
    return isValidCssColor(normalized) ? normalized : undefined;
  }
  return undefined;
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
