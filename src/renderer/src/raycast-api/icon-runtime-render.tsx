/**
 * raycast-api/icon-runtime-render.tsx
 * Purpose: Main icon renderer and public Icon/Color/Image/Keyboard exports.
 */

import React, { useEffect, useState } from 'react';
import { isRaycastIconName, renderPhosphorIcon } from './icon-runtime-phosphor';
import { isEmojiOrSymbol, renderTintedAssetIcon, resolveIconSrc, resolveTintColor } from './icon-runtime-assets';
import { RAYCAST_ICON_NAMES } from './raycast-icon-enum';

type RaycastIconName = (typeof RAYCAST_ICON_NAMES)[number];

const fileIconCache = new Map<string, string | null>();

function FileIcon({ filePath, className }: { filePath: string; className: string }) {
  const [src, setSrc] = useState<string | null>(() => fileIconCache.get(filePath) ?? null);

  useEffect(() => {
    let cancelled = false;
    const cached = fileIconCache.get(filePath);
    if (cached !== undefined) {
      setSrc(cached);
      return;
    }

    (window as any).electron?.getFileIconDataUrl?.(filePath, 20)
      .then((iconSrc: string | null) => {
        if (cancelled) return;
        fileIconCache.set(filePath, iconSrc || null);
        setSrc(iconSrc || null);
      })
      .catch(() => {
        if (cancelled) return;
        fileIconCache.set(filePath, null);
        setSrc(null);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (src) return <img src={src} className={className + ' rounded'} alt="" />;

  let isDirectory = false;
  try {
    const stat = (window as any).electron?.statSync?.(filePath);
    isDirectory = Boolean(stat?.exists && stat?.isDirectory);
  } catch {
    // best-effort
  }

  return <span className="text-center" style={{ fontSize: '0.875rem' }}>{isDirectory ? '📁' : '📄'}</span>;
}

// Typed as the literal union of every Raycast icon name so consumers
// (and the parity script) can see the keys. Runtime is still a Proxy
// returning prop name as the value, so any future Raycast addition
// works without an enum bump.
export const Icon = new Proxy({} as Record<RaycastIconName, RaycastIconName>, {
  get(_target, prop: string) {
    return String(prop || '');
  },
}) as { readonly [K in RaycastIconName]: K };

function isThemeAwareSourceObject(source: unknown): source is { light?: unknown; dark?: unknown } {
  return Boolean(source && typeof source === 'object' && ('light' in (source as any) || 'dark' in (source as any)));
}

function prefersDarkMode(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true;
  } catch {
    return true;
  }
}

function normalizeFileIconPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith('file://')) {
    try {
      const filePath = decodeURIComponent(new URL(raw).pathname || '');
      return filePath || null;
    } catch {
      return null;
    }
  }
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    return raw;
  }
  return raw.startsWith('/') ? raw : null;
}

function pickFileIconPath(iconLike: unknown): string | null {
  if (!iconLike || typeof iconLike !== 'object') return null;
  const root = iconLike as Record<string, unknown>;

  const direct = normalizeFileIconPath(root.fileIcon);
  if (direct) return direct;

  if (root.source && typeof root.source === 'object') {
    const sourceFileIcon = normalizeFileIconPath((root.source as Record<string, unknown>).fileIcon);
    if (sourceFileIcon) return sourceFileIcon;
  }

  if (root.value && typeof root.value === 'object') {
    const valueFileIcon = normalizeFileIconPath((root.value as Record<string, unknown>).fileIcon);
    if (valueFileIcon) return valueFileIcon;
  }

  return null;
}

function pickImageSourceValue(source: unknown): string | null {
  if (typeof source === 'string') return source;
  if (!isThemeAwareSourceObject(source)) return null;

  const dark = typeof source.dark === 'string' ? source.dark : '';
  const light = typeof source.light === 'string' ? source.light : '';
  const selected = prefersDarkMode() ? (dark || light) : (light || dark);
  return selected || null;
}

function renderResolvedImageIcon(resolved: string, className: string, tintColor?: string, mask?: string): React.ReactNode {
  if (tintColor) return renderTintedAssetIcon(resolved, className, tintColor);
  const style: React.CSSProperties = {};
  if (mask === 'circle') {
    style.borderRadius = '9999px';
  } else if (mask === 'roundedRectangle') {
    style.borderRadius = '6px';
  }
  return <img src={resolved} className={className + ' rounded'} style={style} alt="" />;
}

export function renderIcon(icon: any, className = 'w-4 h-4', assetsPathOverride?: string): React.ReactNode {
  if (!icon) return null;

  if (typeof icon === 'string') {
    if (icon.startsWith('data:') || icon.startsWith('http') || icon.startsWith('sc-asset:')) {
      return <img src={icon} className={className + ' rounded'} alt="" />;
    }

    if (/\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(icon)) {
      const resolved = resolveIconSrc(icon, assetsPathOverride);
      if (resolved) {
        return <img src={resolved} className={className + ' rounded'} alt="" />;
      }
    }

    const absolutePath = normalizeFileIconPath(icon);
    if (absolutePath) {
      return <FileIcon filePath={absolutePath} className={className} />;
    }

    const phosphor = renderPhosphorIcon(icon, className);
    if (phosphor) return phosphor;

    if (isEmojiOrSymbol(icon)) {
      return <span className="text-center" style={{ fontSize: '0.875rem' }}>{icon}</span>;
    }

    return renderPhosphorIcon('Circle', className) || <span className="opacity-50">•</span>;
  }

  if (typeof icon === 'object') {
    const fileIconPath = pickFileIconPath(icon);
    if (fileIconPath) {
      return <FileIcon filePath={fileIconPath} className={className} />;
    }

    const source = icon.source;
    const fallback = icon.fallback;
    const tintColor = resolveTintColor(icon.tintColor);
    const mask = typeof icon.mask === 'string' ? icon.mask : undefined;
    const sourceValue = pickImageSourceValue(source);

    if (typeof sourceValue === 'string') {
      if (sourceValue.startsWith('http') || sourceValue.startsWith('data:') || sourceValue.startsWith('/') || /\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(sourceValue)) {
        const resolved = resolveIconSrc(sourceValue, assetsPathOverride);
        if (resolved) return renderResolvedImageIcon(resolved, className, tintColor, mask);
      }

      if (sourceValue.startsWith('Icon.') || isRaycastIconName(sourceValue)) {
        const key = sourceValue.replace(/^Icon\./, '');
        const phosphor = renderPhosphorIcon(key, className, tintColor);
        if (phosphor) return phosphor;
      }

      const phosphor = renderPhosphorIcon(sourceValue, className, tintColor);
      if (phosphor) return phosphor;
    }

    if (typeof fallback === 'string') {
      if (fallback.startsWith('Icon.') || isRaycastIconName(fallback)) {
        const key = fallback.replace(/^Icon\./, '');
        const phosphor = renderPhosphorIcon(key, className, tintColor);
        if (phosphor) return phosphor;
      }

      const phosphor = renderPhosphorIcon(fallback, className, tintColor);
      if (phosphor) return phosphor;

      if (isEmojiOrSymbol(fallback)) {
        return <span className="text-center" style={{ fontSize: '0.875rem' }}>{fallback}</span>;
      }
    }

    return renderPhosphorIcon('Circle', className, tintColor) || <span className="opacity-50">•</span>;
  }

  return renderPhosphorIcon('Circle', className) || <span className="opacity-50">•</span>;
}

export const Color = {
  Blue: '#0A84FF',
  Brown: '#A2845E',
  Green: '#30D158',
  Magenta: '#FF2D55',
  Orange: '#FF9F0A',
  Purple: '#BF5AF2',
  Red: '#FF453A',
  Yellow: '#FFD60A',
  PrimaryText: '#ffffff',
  SecondaryText: 'rgba(255,255,255,0.65)',
  // Extras kept for SuperCmd-internal styling; not in spec.
  TertiaryText: 'rgba(255,255,255,0.45)',
  SelectionBackground: 'rgba(255,255,255,0.08)',
} as const;

// Declaration-merge type members so `Color.ColorLike`, `Color.Dynamic`,
// `Color.Raw` are addressable on the namespace, matching spec.
export namespace Color {
  export type ColorLike = import('@raycast/api').Color.ColorLike;
  export type Dynamic = import('@raycast/api').Color.Dynamic;
  export type Raw = import('@raycast/api').Color.Raw;
}

export const Image = {
  Mask: {
    Circle: 'circle',
    RoundedRectangle: 'roundedRectangle',
  },
} as const;

export namespace Image {
  export type ImageLike = import('@raycast/api').Image.ImageLike;
  export type Source = import('@raycast/api').Image.Source;
  export type URL = import('@raycast/api').Image.URL;
  export type Mask = import('@raycast/api').Image.Mask;
  export type Asset = import('@raycast/api').Image.Asset;
  export type Fallback = import('@raycast/api').Image.Fallback;
}

export const Keyboard = {
  Shortcut: {
    Common: {
      Copy: { modifiers: ['cmd', 'shift'], key: 'c' },
      CopyDeeplink: { modifiers: ['cmd', 'shift'], key: 'l' },
      CopyName: { modifiers: ['cmd', 'shift'], key: '.' },
      CopyPath: { modifiers: ['cmd', 'shift'], key: ',' },
      Duplicate: { modifiers: ['cmd'], key: 'd' },
      Edit: { modifiers: ['cmd'], key: 'e' },
      MoveDown: { modifiers: ['cmd', 'shift'], key: 'arrowDown' },
      MoveUp: { modifiers: ['cmd', 'shift'], key: 'arrowUp' },
      New: { modifiers: ['cmd'], key: 'n' },
      Open: { modifiers: ['cmd'], key: 'o' },
      OpenWith: { modifiers: ['cmd'], key: 'return' },
      Pin: { modifiers: ['cmd', 'shift'], key: 'p' },
      Refresh: { modifiers: ['cmd'], key: 'r' },
      Remove: { modifiers: ['ctrl'], key: 'x' },
      RemoveAll: { modifiers: ['ctrl', 'shift'], key: 'x' },
      Save: { modifiers: ['cmd'], key: 's' },
      ToggleQuickLook: { modifiers: ['shift'], key: 'space' },
      // Extras kept for backwards-compat with existing SuperCmd extensions
      // that referenced these names; spec doesn't define them.
      Rename: { modifiers: ['cmd'], key: 'r' },
      Print: { modifiers: ['cmd'], key: 'p' },
      EmptyTrash: { modifiers: ['cmd', 'shift'], key: 'delete' },
    },
  },
};

// Declaration-merge namespace types so `Keyboard.KeyEquivalent` /
// `Keyboard.KeyModifier` / `Keyboard.Shortcut` are accessible as types.
// These mirror the spec exactly; importing from `@raycast/api` keeps us
// in lockstep with whatever version is installed.
export namespace Keyboard {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type KeyEquivalent = import('@raycast/api').Keyboard.KeyEquivalent;
  export type KeyModifier = import('@raycast/api').Keyboard.KeyModifier;
  export type Shortcut = import('@raycast/api').Keyboard.Shortcut;
}

export { resolveIconSrc };
