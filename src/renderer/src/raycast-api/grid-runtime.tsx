/**
 * Grid runtime main container.
 *
 * Builds the `Grid` API surface with item registration, filtering,
 * keyboard navigation, and action panel integration.
 */

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ExtractedAction } from './action-runtime';
import { createGridItemsRuntime } from './grid-runtime-items';
import { groupGridItems, useGridRegistry } from './grid-runtime-hooks';

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
    const extInfo = useContext(ExtensionInfoReactContext);
    const [internalSearch, setInternalSearch] = useState('');
    const searchText = controlledSearch ?? internalSearch;
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [showActions, setShowActions] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const { pop } = useNavigation();

    const cols = columns || 5;
    const { registryAPI, allItems } = useGridRegistry();

    const filteredItems = useMemo(() => {
      if (onSearchTextChange || filtering === false || !searchText.trim()) return allItems;
      const query = searchText.toLowerCase();
      return allItems.filter((item) => {
        const title = (item.props.title || '').toLowerCase();
        const subtitle = (item.props.subtitle || '').toLowerCase();
        return title.includes(query) || subtitle.includes(query) || item.props.keywords?.some((keyword: string) => keyword.toLowerCase().includes(query));
      });
    }, [allItems, filtering, onSearchTextChange, searchText]);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleSearchChange = useCallback(
      (value: string) => {
        setInternalSearch(value);
        setSelectedIdx(0);
        if (!onSearchTextChange) return;

        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (throttle !== false) {
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
        else if (event.key === 'ArrowDown') setSelectedIdx((value) => Math.min(value + cols, filteredItems.length - 1));
        else if (event.key === 'ArrowUp') setSelectedIdx((value) => Math.max(value - cols, 0));
        else if (event.key === 'Enter' && !event.repeat) primaryAction?.execute();
        else if (event.key === 'Escape') pop();
        else return;

        event.preventDefault();
      },
      [cols, filteredItems.length, isMetaK, matchesShortcut, pop, primaryAction, selectedActions, showActions],
    );

    useEffect(() => {
      gridRef.current?.querySelector(`[data-idx="${selectedIdx}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [selectedIdx]);

    useEffect(() => {
      inputRef.current?.focus();
    }, []);

    useEffect(() => {
      if (onSelectionChange && filteredItems[selectedIdx]) {
        onSelectionChange(filteredItems[selectedIdx]?.props?.id || null);
      }
    }, [filteredItems, onSelectionChange, selectedIdx]);

    const groupedItems = useMemo(() => groupGridItems(filteredItems), [filteredItems]);

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
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
            <button onClick={pop} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <input ref={inputRef} type="text" placeholder={searchBarPlaceholder || 'Search…'} value={searchText} onChange={(event) => handleSearchChange(event.target.value)} className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-[14px] font-light" autoFocus />
            {searchBarAccessory && <div className="flex-shrink-0">{searchBarAccessory}</div>}
          </div>

          <div ref={gridRef} className="flex-1 overflow-y-auto p-2">
            {isLoading && filteredItems.length === 0 ? (
              <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
            ) : filteredItems.length === 0 ? (
              emptyViewProps ? <ListEmptyView title={emptyViewProps.title} description={emptyViewProps.description} icon={emptyViewProps.icon} actions={emptyViewProps.actions} /> : <div className="flex items-center justify-center h-full text-white/40"><p className="text-sm">No results</p></div>
            ) : (
              groupedItems.map((group, groupIndex) => (
                <div key={groupIndex} className="mb-2">
                  {group.title && <div className="px-2 pt-2 pb-1.5 text-[11px] uppercase tracking-wider text-white/25 font-medium select-none">{group.title}</div>}
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                    {group.items.map(({ item, globalIdx }) => (
                      <GridItemRenderer key={item.id} title={item.props.title} subtitle={item.props.subtitle} content={item.props.content} isSelected={globalIdx === selectedIdx} dataIdx={globalIdx} onSelect={() => setSelectedIdx(globalIdx)} onActivate={() => setSelectedIdx(globalIdx)} onContextAction={(event: React.MouseEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); setSelectedIdx(globalIdx); setShowActions(true); }} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center px-4 py-3 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
            <div className="flex items-center gap-2 text-white/40 text-xs flex-1 min-w-0 font-medium">
              {footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}
              <span className="truncate">{footerTitle}</span>
            </div>
            {primaryAction && (
              <button type="button" onClick={() => primaryAction.execute()} className="flex items-center gap-2 mr-3 text-white hover:text-white/90 transition-colors">
                <span className="text-white text-xs font-semibold">{primaryAction.title}</span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">↩</kbd>
              </button>
            )}
            <button onClick={() => setShowActions(true)} className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors">
              <span className="text-xs font-medium">Actions</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">K</kbd>
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

  const GridInset = { Small: 'small', Medium: 'medium', Large: 'large' } as const;
  const GridFit = { Contain: 'contain', Fill: 'fill' } as const;

  const Grid = Object.assign(GridComponent, {
    Item: GridItemComponent,
    Section: GridSectionComponent,
    EmptyView: ListEmptyView,
    Dropdown: ListDropdown,
    Inset: GridInset,
    Fit: GridFit,
  });
  Grid.Dropdown = ListDropdown;

  return { Grid };
}
