/**
 * Grid runtime shared items.
 *
 * Contains grid item registration contexts and row/cell renderers.
 */

import React, { createContext, useContext, useEffect, useRef } from 'react';
import { resolveTintColor } from './icon-runtime-assets';
import { renderIcon } from './icon-runtime-render';

export interface GridItemRegistration {
  id: string;
  props: {
    title?: string;
    subtitle?: string;
    content?: any;
    actions?: React.ReactElement;
    keywords?: string[];
    id?: string;
    accessory?: any;
    quickLook?: { name?: string; path: string };
  };
  sectionTitle?: string;
  order: number;
}

export interface GridRegistryAPI {
  set: (id: string, data: Omit<GridItemRegistration, 'id'>) => void;
  delete: (id: string) => void;
}

export function createGridItemsRuntime(resolveIconSrc: (src: string) => string) {
  let gridItemOrderCounter = 0;

  const GridRegistryContext = createContext<GridRegistryAPI>({
    set: () => {},
    delete: () => {},
  });
  const GridSectionTitleContext = createContext<string | undefined>(undefined);

  function GridItemComponent(props: any) {
    const registry = useContext(GridRegistryContext);
    const sectionTitle = useContext(GridSectionTitleContext);
    const stableId = useRef(props.id || `__gi_${++gridItemOrderCounter}`).current;
    const order = ++gridItemOrderCounter;

    registry.set(stableId, { props, sectionTitle, order });

    useEffect(() => {
      return () => registry.delete(stableId);
    }, [registry, stableId]);

    return null;
  }

  function GridSectionComponent({ children, title }: { children?: React.ReactNode; title?: string }) {
    return <GridSectionTitleContext.Provider value={title}>{children}</GridSectionTitleContext.Provider>;
  }

  function GridItemRenderer({ title, subtitle, content, isSelected, dataIdx, onSelect, onActivate, onContextAction }: any) {
    const isImageLikeSourceString = (value: string): boolean => {
      const source = String(value || '').trim();
      if (!source) return false;
      if (
        source.startsWith('http') ||
        source.startsWith('data:') ||
        source.startsWith('sc-asset:') ||
        source.startsWith('file://') ||
        source.startsWith('/') ||
        /^[a-zA-Z]:[\\/]/.test(source) ||
        source.startsWith('\\\\')
      ) {
        return true;
      }
      return /\.(svg|png|jpe?g|gif|webp|ico|tiff?)(\?.*)?$/i.test(source);
    };

    const getGridColor = (value: any): string | null => {
      if (!value || typeof value !== 'object') return null;
      const hasVisualSource = value.source !== undefined || value.value !== undefined || value.fileIcon !== undefined;
      if (hasVisualSource) return null;
      return resolveTintColor(value.color) || null;
    };

    const normalizeSourceString = (value: string): string => {
      const source = String(value || '').trim();
      if (!source) return '';
      const resolved = resolveIconSrc(source);
      return resolved || source;
    };

    const toRenderableContent = (value: any): any => {
      if (!value) return null;
      if (typeof value === 'string') {
        const normalized = normalizeSourceString(value);
        return normalized || null;
      }

      if (typeof value !== 'object') return null;

      if (typeof value.fileIcon === 'string' && value.fileIcon.trim()) {
        return { fileIcon: value.fileIcon.trim() };
      }

      if (value.source !== undefined) {
        const sourceValue = value.source;
        if (typeof sourceValue === 'string') {
          const normalizedSource = normalizeSourceString(sourceValue);
          if (!normalizedSource) return null;
          const sourceTint =
            value.tintColor
            || (!isImageLikeSourceString(normalizedSource) ? value.color : undefined);
          return {
            source: normalizedSource,
            tintColor: sourceTint,
            mask: value.mask,
            fallback: value.fallback,
          };
        }
        if (sourceValue && typeof sourceValue === 'object') {
          return {
            source: sourceValue,
            tintColor: value.tintColor,
            mask: value.mask,
            fallback: value.fallback,
          };
        }
      }

      if (value.value !== undefined) {
        const nestedValue = value.value;
        if (typeof nestedValue === 'string') {
          const normalizedNested = normalizeSourceString(nestedValue);
          if (!normalizedNested) return null;
          const nestedTint =
            !isImageLikeSourceString(normalizedNested) ? value.color : undefined;
          return nestedTint
            ? { source: normalizedNested, tintColor: nestedTint }
            : normalizedNested;
        }
        if (nestedValue && typeof nestedValue === 'object') {
          if (typeof nestedValue.fileIcon === 'string' && nestedValue.fileIcon.trim()) {
            return { fileIcon: nestedValue.fileIcon.trim() };
          }

          if (nestedValue.source !== undefined) {
            return nestedValue;
          }

          if (nestedValue.light !== undefined || nestedValue.dark !== undefined) {
            return { source: nestedValue };
          }
        }
      }

      return null;
    };

    const swatchColor = getGridColor(content);
    const renderableContent = swatchColor ? null : toRenderableContent(content);

    return (
      <div
        data-idx={dataIdx}
        className={`relative rounded-lg cursor-pointer transition-all overflow-hidden flex flex-col ${
          isSelected ? 'ring-2 ring-blue-500 bg-white/[0.08]' : 'hover:bg-white/[0.04]'
        }`}
        style={{ height: '160px' }}
        onClick={onActivate}
        onMouseMove={onSelect}
        onContextMenu={onContextAction}
      >
        <div className="flex-1 flex items-center justify-center overflow-hidden p-1.5 min-h-0">
          {swatchColor ? (
            <div className="w-full h-full rounded" style={{ backgroundColor: swatchColor }} />
          ) : renderableContent ? (
            <div className="w-full h-full flex items-center justify-center">
              {renderIcon(renderableContent, 'w-full h-full object-contain')}
            </div>
          ) : (
            <div className="w-full h-full bg-white/[0.03] rounded flex items-center justify-center text-white/20 text-2xl">
              {title ? title.charAt(0) : '?'}
            </div>
          )}
        </div>
        {title && (
          <div className="px-2 pb-2 pt-1 flex-shrink-0">
            <p className="truncate text-[11px] text-white/70 text-center">{title}</p>
            {subtitle && <p className="truncate text-[9px] text-white/30 text-center">{subtitle}</p>}
          </div>
        )}
      </div>
    );
  }

  return {
    GridRegistryContext,
    GridItemComponent,
    GridSectionComponent,
    GridItemRenderer,
  };
}
