/**
 * raycast-api/icon-runtime-render.tsx
 * Purpose: Main icon renderer and public Icon/Color/Image/Keyboard exports.
 */

import React, { useEffect, useState } from 'react';
import { isRaycastIconName, renderPhosphorIcon } from './icon-runtime-phosphor';
import { isEmojiOrSymbol, renderTintedAssetIcon, resolveIconSrc, resolveTintColor } from './icon-runtime-assets';

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

export const Icon: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop: string) {
    return String(prop || '');
  },
});

export function renderIcon(icon: any, className = 'w-4 h-4', assetsPathOverride?: string): React.ReactNode {
  if (!icon) return null;

  if (typeof icon === 'string') {
    if (icon.startsWith('data:') || icon.startsWith('http') || icon.startsWith('sc-asset:')) {
      return <img src={icon} className={className + ' rounded'} alt="" />;
    }

    if (/\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(icon)) {
      const resolved = resolveIconSrc(icon, assetsPathOverride);
      return <img src={resolved} className={className + ' rounded'} alt="" />;
    }

    if (icon.startsWith('/') && (icon.endsWith('.icns') || !/\.[a-z0-9]+$/i.test(icon))) {
      return <FileIcon filePath={icon} className={className} />;
    }

    const phosphor = renderPhosphorIcon(icon, className);
    if (phosphor) return phosphor;

    if (isEmojiOrSymbol(icon)) {
      return <span className="text-center" style={{ fontSize: '0.875rem' }}>{icon}</span>;
    }

    return renderPhosphorIcon('Circle', className) || <span className="opacity-50">•</span>;
  }

  if (typeof icon === 'object') {
    const source = icon.source;
    const fallback = icon.fallback;
    const tintColor = resolveTintColor(icon.tintColor);

    if (typeof source === 'string') {
      if (source.startsWith('http') || source.startsWith('data:') || source.startsWith('/')) {
        const resolved = resolveIconSrc(source, assetsPathOverride);
        if (resolved) {
          if (tintColor) return renderTintedAssetIcon(resolved, className, tintColor);
          return <img src={resolved} className={className + ' rounded'} alt="" />;
        }
      } else {
        if (source.startsWith('Icon.') || isRaycastIconName(source)) {
          const key = source.replace(/^Icon\./, '');
          const phosphor = renderPhosphorIcon(key, className, tintColor);
          if (phosphor) return phosphor;
        }

        const phosphor = renderPhosphorIcon(source, className, tintColor);
        if (phosphor) return phosphor;
      }
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

export const Color: Record<string, string> = {
  PrimaryText: '#ffffff',
  SecondaryText: 'rgba(255,255,255,0.65)',
  TertiaryText: 'rgba(255,255,255,0.45)',
  SelectionBackground: 'rgba(255,255,255,0.08)',
  Green: '#30D158',
  Red: '#FF453A',
  Orange: '#FF9F0A',
  Yellow: '#FFD60A',
  Blue: '#0A84FF',
  Purple: '#BF5AF2',
  Magenta: '#FF2D55',
};

export const Image = {
  Mask: {
    Circle: 'circle',
    RoundedRectangle: 'roundedRectangle',
  },
};

export const Keyboard = {
  Shortcut: {
    Common: {
      CopyName: { modifiers: ['cmd'], key: '.' },
      Open: { modifiers: ['cmd'], key: 'o' },
      Remove: { modifiers: ['ctrl'], key: 'x' },
      RemoveAll: { modifiers: ['ctrl', 'shift'], key: 'x' },
      Rename: { modifiers: ['cmd'], key: 'r' },
      Edit: { modifiers: ['cmd'], key: 'e' },
      New: { modifiers: ['cmd'], key: 'n' },
      Duplicate: { modifiers: ['cmd'], key: 'd' },
      Print: { modifiers: ['cmd'], key: 'p' },
      Refresh: { modifiers: ['cmd'], key: 'r' },
      ToggleQuickLook: { modifiers: ['shift'], key: 'space' },
      EmptyTrash: { modifiers: ['cmd', 'shift'], key: 'delete' },
      MoveUp: { modifiers: ['cmd', 'shift'], key: 'arrowUp' },
      MoveDown: { modifiers: ['cmd', 'shift'], key: 'arrowDown' },
      OpenWith: { modifiers: ['cmd'], key: 'return' },
    },
  },
};

export { resolveIconSrc };
