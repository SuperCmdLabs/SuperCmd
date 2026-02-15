/**
 * Grid runtime shared items.
 *
 * Contains grid item registration contexts and row/cell renderers.
 */

import React, { createContext, useContext, useEffect, useRef } from 'react';

export interface GridItemRegistration {
  id: string;
  props: {
    title?: string;
    subtitle?: string;
    content?: { source?: string; tintColor?: string } | string;
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
    const getGridImageSource = (value: any): string => {
      if (!value) return '';
      if (typeof value === 'string') return resolveIconSrc(value);

      if (typeof value === 'object') {
        const directSource = value.source;
        const nestedSource = value.value?.source;
        const candidate = directSource ?? nestedSource;

        if (typeof candidate === 'string') return resolveIconSrc(candidate);
        if (candidate && typeof candidate === 'object') {
          const themed = candidate.dark || candidate.light || '';
          if (typeof themed === 'string') return resolveIconSrc(themed);
        }
      }
      return '';
    };

    const imageSource = getGridImageSource(content);

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
          {imageSource ? (
            <img
              src={typeof imageSource === 'string' ? imageSource : ''}
              alt={title || ''}
              className="max-w-full max-h-full object-contain rounded"
              loading="lazy"
            />
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
