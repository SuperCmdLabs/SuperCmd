/**
 * Grid runtime main container.
 *
 * Builds the `Grid` API surface with item registration, filtering,
 * keyboard navigation, and action panel integration.
 */

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ExtractedAction } from './action-runtime';
import { transliterateForSearch } from '../utils/transliterate';
import { createGridItemsRuntime } from './grid-runtime-items';
import { groupGridItems, useGridRegistry } from './grid-runtime-hooks';
import {
  GRID_DEFAULT_COLUMNS,
  buildVirtualGridLayout,
  getColumnsForItemIndex,
  getScrollTopForItemIndex,
  getVisibleVirtualRows,
  normalizeGridColumns,
} from './grid-runtime-virtualization';
import { useI18n } from '../i18n';

interface GridRuntimeDeps {
  ExtensionInfoReactContext: React.Context<any>;
  useNavigation: () => { pop: () => void };
  useCollectedActions: () => { collectedActions: ExtractedAction[]; registryAPI: any };
  ActionRegistryContext: React.Context<any>;
  ActionPanelOverlay: React.ComponentType<{
    actions: ExtractedAction[];
    onClose: () => void;
    onExecute: (action: ExtractedAction) => void;
  }>;
  matchesShortcut: (event: React.KeyboardEvent | KeyboardEvent, shortcut?: { modifiers?: string[]; key?: string }) => boolean;
  isMetaK: (event: React.KeyboardEvent | KeyboardEvent) => boolean;
  getExtensionContext: () => { extensionDisplayName?: string; extensionName: string; extensionIconDataUrl?: string };
  EmptyViewRegistryContext: React.Context<any>;
  ListEmptyView: React.ComponentType<any>;
  ListDropdown: any;
  resolveIconSrc: (src: string) => string;
}

export function createGridRuntime(deps: GridRuntimeDeps) {
  const {
    ExtensionInfoReactContext,
    useNavigation,
    useCollectedActions,
    ActionRegistryContext,
    ActionPanelOverlay,
    matchesShortcut,
    isMetaK,
    getExtensionContext,
    EmptyViewRegistryContext,
    ListEmptyView,
    ListDropdown,
    resolveIconSrc,
  } = deps;

  const itemsRuntime = createGridItemsRuntime(resolveIconSrc);
  const { GridRegistryContext, GridItemComponent, GridSectionComponent, GridItemRenderer } = itemsRuntime;

  function GridComponent({
    children,
    columns,
    itemSize,
    aspectRatio,
    fit,
    inset,
    isLoading,
    searchBarPlaceholder,
    onSearchTextChange,
    filtering,
    navigationTitle,
    searchBarAccessory,
    searchText: controlledSearch,
    onSelectionChange,
    throttle,
    actions: gridActions,
  }: any) {
    const { t } = useI18n();
    const extInfo = useContext(ExtensionInfoReactContext);
    const [internalSearch, setInternalSearch] = useState(() => controlledSearch ?? '');
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [showActions, setShowActions] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const { pop } = useNavigation();

    const rootColumns = useMemo(() => normalizeGridColumns(columns, GRID_DEFAULT_COLUMNS, itemSize), [columns, itemSize]);
    const [gridViewport, setGridViewport] = useState({ scrollTop: 0, viewportHeight: 0, containerWidth: 0 });
    const { registryAPI, allItems } = useGridRegistry();

    const measureGridViewport = useCallback(() => {
      const node = gridRef.current;
      if (!node) return;

      const nextViewport = {
        scrollTop: node.scrollTop,
        viewportHeight: node.clientHeight,
        containerWidth: Math.max(0, node.clientWidth - 16),
      };

      setGridViewport((current) => (
        Math.abs(current.scrollTop - nextViewport.scrollTop) < 1
        && current.viewportHeight === nextViewport.viewportHeight
        && current.containerWidth === nextViewport.containerWidth
          ? current
          : nextViewport
      ));
    }, []);

    const handleGridScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
      const node = event.currentTarget;
      setGridViewport((current) => {
        if (Math.abs(current.scrollTop - node.scrollTop) < 1) return current;
        return { ...current, scrollTop: node.scrollTop };
      });
    }, []);

    useEffect(() => {
      if (controlledSearch === undefined) return;
      setInternalSearch(controlledSearch);
    }, [controlledSearch]);

    const filteredItems = useMemo(() => {
      if (onSearchTextChange || filtering === false || !internalSearch.trim()) return allItems;
      const query = internalSearch.toLowerCase();
      const translitQuery = transliterateForSearch(internalSearch);
      const hasTranslitQuery = translitQuery !== query && translitQuery.length > 0;
      return allItems.filter((item) => {
        const rawTitle = item.props.title || '';
        const rawSubtitle = item.props.subtitle || '';
        const title = rawTitle.toLowerCase();
        const subtitle = rawSubtitle.toLowerCase();
        if (title.includes(query) || subtitle.includes(query) || item.props.keywords?.some((keyword: string) => keyword.toLowerCase().includes(query))) {
          return true;
        }
        if (hasTranslitQuery && (title.includes(translitQuery) || subtitle.includes(translitQuery))) {
          return true;
        }
        const titleTranslit = transliterateForSearch(rawTitle);
        const subtitleTranslit = transliterateForSearch(rawSubtitle);
        if (
          (titleTranslit !== title && titleTranslit.includes(query)) ||
          (subtitleTranslit !== subtitle && subtitleTranslit.includes(query))
        ) {
          return true;
        }
        return false;
      });
    }, [allItems, filtering, internalSearch, onSearchTextChange]);

    const groupedItems = useMemo(() => groupGridItems(filteredItems), [filteredItems]);
    const virtualLayout = useMemo(
      () => buildVirtualGridLayout(groupedItems, {
        defaultColumns: rootColumns,
        itemSize,
        defaultAspectRatio: aspectRatio,
        defaultFit: fit,
        defaultInset: inset,
        containerWidth: gridViewport.containerWidth,
      }),
      [aspectRatio, fit, gridViewport.containerWidth, groupedItems, inset, itemSize, rootColumns],
    );
    const visibleRows = useMemo(
      () => getVisibleVirtualRows(virtualLayout.rows, {
        scrollTop: gridViewport.scrollTop,
        viewportHeight: gridViewport.viewportHeight,
      }),
      [gridViewport.scrollTop, gridViewport.viewportHeight, virtualLayout.rows],
    );

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleSearchChange = useCallback(
      (value: string) => {
        setInternalSearch(value);
        setSelectedIdx(0);
        if (!onSearchTextChange) return;

        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (throttle === true) {
          debounceRef.current = setTimeout(() => onSearchTextChange(value), 300);
        } else {
          onSearchTextChange(value);
        }
      },
      [onSearchTextChange, throttle],
    );

    useEffect(() => {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, []);

    const selectedItem = filteredItems[selectedIdx];
    const [emptyViewProps, setEmptyViewProps] = useState<any>(null);
    const extensionContext = getExtensionContext();
    const footerTitle =
      navigationTitle ||
      extInfo.extensionDisplayName ||
      extensionContext.extensionDisplayName ||
      extensionContext.extensionName ||
      'Extension';
    const footerIcon = extInfo.extensionIconDataUrl || extensionContext.extensionIconDataUrl;

    const { collectedActions: selectedActions, registryAPI: actionRegistry } = useCollectedActions();
    const activeActionsElement = selectedItem?.props?.actions || (filteredItems.length === 0 ? emptyViewProps?.actions : null) || gridActions;
    const primaryAction = selectedActions[0];

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent) => {
        if (isMetaK(event)) {
          event.preventDefault();
          setShowActions((value) => !value);
          return;
        }

        if ((event.metaKey || event.altKey || event.ctrlKey) && !event.repeat) {
          for (const action of selectedActions) {
            if (!action.shortcut || !matchesShortcut(event, action.shortcut)) continue;
            event.preventDefault();
            event.stopPropagation();
            setShowActions(false);
            action.execute();
            setTimeout(() => inputRef.current?.focus(), 0);
            return;
          }
        }

        if (showActions) return;

        if (event.key === 'ArrowRight') setSelectedIdx((value) => Math.min(value + 1, filteredItems.length - 1));
        else if (event.key === 'ArrowLeft') setSelectedIdx((value) => Math.max(value - 1, 0));
        else if (event.key === 'ArrowDown') {
          setSelectedIdx((value) => Math.min(value + getColumnsForItemIndex(virtualLayout, value, rootColumns), filteredItems.length - 1));
        } else if (event.key === 'ArrowUp') {
          setSelectedIdx((value) => Math.max(value - getColumnsForItemIndex(virtualLayout, value, rootColumns), 0));
        } else if (event.key === 'Enter' && !event.repeat) primaryAction?.execute();
        else return;

        event.preventDefault();
      },
      [filteredItems.length, isMetaK, matchesShortcut, primaryAction, rootColumns, selectedActions, showActions, virtualLayout],
    );

    useEffect(() => {
      if (filteredItems.length === 0) {
        if (selectedIdx !== 0) setSelectedIdx(0);
        return;
      }
      if (selectedIdx >= filteredItems.length) {
        setSelectedIdx(filteredItems.length - 1);
      }
    }, [filteredItems.length, selectedIdx]);

    useEffect(() => {
      const node = gridRef.current;
      if (!node || filteredItems.length === 0) return;

      const nextScrollTop = getScrollTopForItemIndex(virtualLayout, selectedIdx, {
        currentScrollTop: node.scrollTop,
        viewportHeight: node.clientHeight || gridViewport.viewportHeight,
      });
      if (Math.abs(nextScrollTop - node.scrollTop) < 1) return;

      node.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
      requestAnimationFrame(measureGridViewport);
    }, [filteredItems.length, gridViewport.viewportHeight, measureGridViewport, selectedIdx, virtualLayout]);

    useEffect(() => {
      inputRef.current?.focus();
    }, []);

    useEffect(() => {
      measureGridViewport();
      const node = gridRef.current;
      if (!node) return;

      const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureGridViewport) : null;
      resizeObserver?.observe(node);
      window.addEventListener('resize', measureGridViewport);
      return () => {
        resizeObserver?.disconnect();
        window.removeEventListener('resize', measureGridViewport);
      };
    }, [measureGridViewport]);

    useEffect(() => {
      if (onSelectionChange && filteredItems[selectedIdx]) {
        onSelectionChange(filteredItems[selectedIdx]?.props?.id || null);
      }
    }, [filteredItems, onSelectionChange, selectedIdx]);

    return (
      <GridRegistryContext.Provider value={registryAPI}>
        <div style={{ display: 'none' }}>
          <EmptyViewRegistryContext.Provider value={setEmptyViewProps}>{children}</EmptyViewRegistryContext.Provider>
          {activeActionsElement && (
            <ActionRegistryContext.Provider value={actionRegistry}>
              <div key={selectedItem?.id || (filteredItems.length === 0 ? '__grid_empty_actions' : '__grid_actions')}>
                {activeActionsElement}
              </div>
            </ActionRegistryContext.Provider>
          )}
        </div>

        <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
          <div className="drag-region flex items-center gap-2 px-4 py-3 border-b border-[var(--ui-divider)]">
            <button onClick={pop} className="sc-back-button text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0 p-0.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <input ref={inputRef} data-supercmd-search-input="true" type="text" placeholder={searchBarPlaceholder || t('common.search')} value={internalSearch} onChange={(event) => handleSearchChange(event.target.value)} className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[color:var(--text-subtle)] text-[14px] font-light" autoFocus />
            {searchBarAccessory && <div className="flex-shrink-0">{searchBarAccessory}</div>}
          </div>

          <div ref={gridRef} className="flex-1 overflow-y-auto p-2" onScroll={handleGridScroll}>
            {isLoading && filteredItems.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[var(--text-muted)]"><p className="text-sm">{t('common.loading')}</p></div>
            ) : filteredItems.length === 0 ? (
              emptyViewProps ? <ListEmptyView title={emptyViewProps.title} description={emptyViewProps.description} icon={emptyViewProps.icon} actions={emptyViewProps.actions} /> : <div className="flex items-center justify-center h-full text-[var(--text-subtle)]"><p className="text-sm">{t('common.noResults')}</p></div>
            ) : (
              <div className="relative" style={{ height: `${virtualLayout.totalHeight}px` }}>
                {visibleRows.map((row) => (
                  row.kind === 'section' ? (
                    <div
                      key={row.key}
                      className="absolute left-0 right-0 px-2 pt-2 pb-1.5 text-[11px] uppercase tracking-wider text-[var(--text-subtle)] font-medium select-none"
                      style={{ top: `${row.top}px`, height: `${row.height}px` }}
                    >
                      <span>{row.title}</span>
                      {row.subtitle && (
                        <span className="ml-2 normal-case tracking-normal text-[var(--text-muted)]">{row.subtitle}</span>
                      )}
                    </div>
                  ) : (
                    <div
                      key={row.key}
                      className="absolute left-0 right-0 grid gap-2"
                      style={{
                        top: `${row.top}px`,
                        height: `${row.height}px`,
                        gridTemplateColumns: `repeat(${row.layout.columns}, minmax(0, 1fr))`,
                      }}
                    >
                      {row.items.map(({ item, globalIdx }) => (
                        <GridItemRenderer
                          key={item.id}
                          title={item.props.title}
                          subtitle={item.props.subtitle}
                          content={item.props.content}
                          accessory={item.props.accessory}
                          isSelected={globalIdx === selectedIdx}
                          dataIdx={globalIdx}
                          itemHeight={row.itemHeight}
                          fit={row.layout.fit}
                          inset={row.layout.inset}
                          onSelect={() => setSelectedIdx(globalIdx)}
                          onActivate={() => {
                            setSelectedIdx(globalIdx);
                            inputRef.current?.focus();
                          }}
                          onContextAction={(event: React.MouseEvent<HTMLDivElement>) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setSelectedIdx(globalIdx);
                            setShowActions(true);
                          }}
                        />
                      ))}
                    </div>
                  )
                ))}
              </div>
            )}
          </div>

          <div className="sc-glass-footer flex items-center px-4 py-2.5">
            <div className="sc-footer-primary flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-normal">
              {footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}
              <span className="truncate">{footerTitle}</span>
            </div>
            {primaryAction && (
              <button type="button" onClick={() => primaryAction.execute()} className="flex items-center gap-2 mr-3 text-[var(--text-primary)] hover:text-[var(--text-secondary)] transition-colors">
                <span className="text-xs font-semibold">{primaryAction.title}</span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">↩</kbd>
              </button>
            )}
            <button onClick={() => setShowActions(true)} className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
              <span className="text-xs font-normal">{t('common.actions')}</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">⌘</kbd>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">K</kbd>
            </button>
          </div>
        </div>

        {showActions && selectedActions.length > 0 && (
          <ActionPanelOverlay
            actions={selectedActions}
            onClose={() => setShowActions(false)}
            onExecute={(action) => {
              setShowActions(false);
              action.execute();
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          />
        )}
      </GridRegistryContext.Provider>
    );
  }

  const GridInset = { Zero: 'zero', Small: 'sm', Medium: 'md', Large: 'lg' } as const;
  const GridItemSize = { Small: 'small', Medium: 'medium', Large: 'large' } as const;
  const GridFit = { Contain: 'contain', Fill: 'fill' } as const;

  const Grid = Object.assign(GridComponent, {
    Item: GridItemComponent,
    Section: GridSectionComponent,
    EmptyView: ListEmptyView,
    Dropdown: ListDropdown,
    ItemSize: GridItemSize,
    Inset: GridInset,
    Fit: GridFit,
  });
  Grid.Dropdown = ListDropdown;

  return { Grid };
}
