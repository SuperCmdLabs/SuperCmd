/**
 * List runtime main container.
 *
 * Builds `List` including selection, filtering, detail split, and
 * action overlay behavior.
 */

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ExtractedAction } from './action-runtime';
import { createListDetailRuntime } from './list-runtime-detail';
import { groupListItems, shouldUseEmojiGrid, useListRegistry } from './list-runtime-hooks';
import { createListRenderers } from './list-runtime-renderers';
import {
  EmptyViewRegistryContext,
  ListRegistryContext,
} from './list-runtime-types';

interface ListRuntimeDeps {
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
  isEmojiOrSymbol: (value: string) => boolean;
  renderIcon: (icon: any, className?: string, assetsPath?: string) => React.ReactNode;
  resolveTintColor: (value?: string) => string | undefined;
  addHexAlpha: (hex: string, alphaHex?: string) => string | null;
  getExtensionContext: () => {
    assetsPath: string;
    extensionDisplayName?: string;
    extensionName: string;
    extensionIconDataUrl?: string;
  };
  normalizeScAssetUrl: (url: string) => string;
  toScAssetUrl: (path: string) => string;
  setClearSearchBarCallback: (callback: (() => void) | null) => void;
}

export function createListRuntime(deps: ListRuntimeDeps) {
  const {
    ExtensionInfoReactContext,
    useNavigation,
    useCollectedActions,
    ActionRegistryContext,
    ActionPanelOverlay,
    matchesShortcut,
    isMetaK,
    isEmojiOrSymbol,
    renderIcon,
    resolveTintColor,
    addHexAlpha,
    getExtensionContext,
    normalizeScAssetUrl,
    toScAssetUrl,
    setClearSearchBarCallback,
  } = deps;

  const renderers = createListRenderers({ renderIcon, resolveTintColor, addHexAlpha });
  const { ListItemComponent, ListItemRenderer, ListEmojiGridItemRenderer, ListSectionComponent, ListEmptyView, ListDropdown } = renderers;
  const { ListItemDetail } = createListDetailRuntime({ getExtensionContext, normalizeScAssetUrl, toScAssetUrl });

  function ListComponent({
    children,
    searchBarPlaceholder,
    onSearchTextChange,
    isLoading,
    searchText: controlledSearch,
    filtering,
    isShowingDetail,
    navigationTitle,
    searchBarAccessory,
    throttle,
    onSelectionChange,
    actions: listActions,
  }: any) {
    const extInfo = useContext(ExtensionInfoReactContext);
    const [internalSearch, setInternalSearch] = useState('');
    const searchText = controlledSearch ?? internalSearch;
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [showActions, setShowActions] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const { pop } = useNavigation();
    const prevSelectedSectionRef = useRef<string | undefined>(undefined);
    const { registryAPI, allItems } = useListRegistry();

    const filteredItems = useMemo(() => {
      if (onSearchTextChange || filtering === false || !searchText.trim()) return allItems;
      const query = searchText.toLowerCase();
      return allItems.filter((item) => {
        const title = (typeof item.props.title === 'string' ? item.props.title : (item.props.title as any)?.value || '').toLowerCase();
        const subtitle = (typeof item.props.subtitle === 'string' ? item.props.subtitle : (item.props.subtitle as any)?.value || '').toLowerCase();
        return title.includes(query) || subtitle.includes(query) || item.props.keywords?.some((keyword: string) => keyword.toLowerCase().includes(query));
      });
    }, [allItems, filtering, onSearchTextChange, searchText]);

    const shouldUseEmojiGridValue = useMemo(
      () => shouldUseEmojiGrid(filteredItems, isShowingDetail, isEmojiOrSymbol),
      [filteredItems, isEmojiOrSymbol, isShowingDetail],
    );

    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleSearchChange = useCallback((value: string) => {
      setInternalSearch(value);
      setSelectedIdx(0);
      if (!onSearchTextChange) return;
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (throttle !== false) searchDebounceRef.current = setTimeout(() => onSearchTextChange(value), 300);
      else onSearchTextChange(value);
    }, [onSearchTextChange, throttle]);

    useEffect(() => () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); }, []);
    useEffect(() => {
      setClearSearchBarCallback(() => () => handleSearchChange(''));
      return () => setClearSearchBarCallback(null);
    }, [handleSearchChange, setClearSearchBarCallback]);

    const selectedItem = filteredItems[selectedIdx];
    const [emptyViewProps, setEmptyViewProps] = useState<any>(null);
    const { collectedActions: selectedActions, registryAPI: actionRegistry } = useCollectedActions();
    const activeActionsElement = selectedItem?.props?.actions || (filteredItems.length === 0 ? emptyViewProps?.actions : null) || listActions;
    const primaryAction = selectedActions[0];

    const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
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

      if (event.key === 'ArrowRight' && shouldUseEmojiGridValue) setSelectedIdx((value) => Math.min(value + 1, filteredItems.length - 1));
      else if (event.key === 'ArrowLeft' && shouldUseEmojiGridValue) setSelectedIdx((value) => Math.max(value - 1, 0));
      else if (event.key === 'ArrowDown') setSelectedIdx((value) => Math.min(value + (shouldUseEmojiGridValue ? 8 : 1), filteredItems.length - 1));
      else if (event.key === 'ArrowUp') setSelectedIdx((value) => Math.max(value - (shouldUseEmojiGridValue ? 8 : 1), 0));
      else if (event.key === 'Enter' && !event.repeat) primaryAction?.execute();
      else if (event.key === 'Escape') pop();
      else return;

      event.preventDefault();
    }, [filteredItems.length, isMetaK, matchesShortcut, pop, primaryAction, selectedActions, shouldUseEmojiGridValue, showActions]);

    useEffect(() => {
      const handler = (event: KeyboardEvent) => {
        if (isMetaK(event) && !event.repeat) {
          event.preventDefault();
          event.stopPropagation();
          setShowActions((value) => !value);
          return;
        }
        if (!event.metaKey && !event.altKey && !event.ctrlKey) return;
        if (event.repeat) return;
        for (const action of selectedActions) {
          if (!action.shortcut || !matchesShortcut(event, action.shortcut)) continue;
          event.preventDefault();
          event.stopPropagation();
          setShowActions(false);
          action.execute();
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
        }
      };
      window.addEventListener('keydown', handler, true);
      return () => window.removeEventListener('keydown', handler, true);
    }, [isMetaK, matchesShortcut, selectedActions]);

    const prevFilteredItemsRef = useRef(filteredItems);
    useEffect(() => {
      const itemsChanged = prevFilteredItemsRef.current !== filteredItems;
      prevFilteredItemsRef.current = filteredItems;
      const currentItem = filteredItems[selectedIdx];

      if (itemsChanged) {
        if (selectedIdx >= filteredItems.length && filteredItems.length > 0) {
          setSelectedIdx(filteredItems.length - 1);
          return;
        }
        const previousSection = prevSelectedSectionRef.current;
        if (previousSection !== undefined && currentItem && currentItem.sectionTitle !== previousSection) {
          for (let index = selectedIdx - 1; index >= 0; index--) {
            if (filteredItems[index].sectionTitle === previousSection) {
              setSelectedIdx(index);
              return;
            }
          }
          for (let index = selectedIdx + 1; index < filteredItems.length; index++) {
            if (filteredItems[index].sectionTitle === previousSection) {
              setSelectedIdx(index);
              return;
            }
          }
        }
      }
      if (currentItem) prevSelectedSectionRef.current = currentItem.sectionTitle;
    }, [filteredItems, selectedIdx]);

    useEffect(() => { listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [selectedIdx]);
    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => { if (onSelectionChange && filteredItems[selectedIdx]) onSelectionChange(filteredItems[selectedIdx]?.props?.id || null); }, [filteredItems, onSelectionChange, selectedIdx]);

    const groupedItems = useMemo(() => groupListItems(filteredItems), [filteredItems]);

    const extensionContext = getExtensionContext();
    const footerTitle = navigationTitle || extInfo.extensionDisplayName || extensionContext.extensionDisplayName || extensionContext.extensionName || 'Extension';
    const footerIcon = extInfo.extensionIconDataUrl || extensionContext.extensionIconDataUrl;
    const detailElement = selectedItem?.props?.detail;

    const listContent = (
      <div ref={listRef} className="flex-1 overflow-y-auto py-0">
        {isLoading && filteredItems.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
        ) : filteredItems.length === 0 ? (
          emptyViewProps ? <ListEmptyView title={emptyViewProps.title} description={emptyViewProps.description} icon={emptyViewProps.icon} actions={emptyViewProps.actions} /> : <div className="flex items-center justify-center h-full text-white/40"><p className="text-sm">No results</p></div>
        ) : shouldUseEmojiGridValue ? (
          groupedItems.map((group, groupIndex) => (
            <div key={groupIndex} className="mb-2">
              {group.title && <div className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-wider text-white/30 font-medium select-none">{group.title}<span className="ml-2 text-white/40 normal-case">{group.items.length}</span></div>}
              <div className="px-2 pb-1 grid gap-2" style={{ gridTemplateColumns: `repeat(8, 1fr)` }}>
                {group.items.map(({ item, globalIdx }) => {
                  const title = typeof item.props.title === 'string' ? item.props.title : (item.props.title as any)?.value || '';
                  return <ListEmojiGridItemRenderer key={item.id} icon={item.props.icon} title={title} isSelected={globalIdx === selectedIdx} dataIdx={globalIdx} onSelect={() => setSelectedIdx(globalIdx)} onActivate={() => setSelectedIdx(globalIdx)} onContextAction={(event: React.MouseEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); setSelectedIdx(globalIdx); setShowActions(true); }} />;
                })}
              </div>
            </div>
          ))
        ) : (
          groupedItems.map((group, groupIndex) => (
            <div key={groupIndex} className="mb-0">
              {group.title && <div className="px-4 pt-0.5 pb-1 text-[11px] uppercase tracking-wider text-white/30 font-medium select-none">{group.title}</div>}
              {group.items.map(({ item, globalIdx }) => (
                <ListItemRenderer key={item.id} {...item.props} assetsPath={extInfo.assetsPath || getExtensionContext().assetsPath} isSelected={globalIdx === selectedIdx} dataIdx={globalIdx} onSelect={() => setSelectedIdx(globalIdx)} onActivate={() => setSelectedIdx(globalIdx)} onContextAction={(event: React.MouseEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); setSelectedIdx(globalIdx); setShowActions(true); }} />
              ))}
            </div>
          ))
        )}
      </div>
    );

    return (
      <ListRegistryContext.Provider value={registryAPI}>
        <div style={{ display: 'none' }}>
          <EmptyViewRegistryContext.Provider value={setEmptyViewProps}>{children}</EmptyViewRegistryContext.Provider>
          {activeActionsElement && <ActionRegistryContext.Provider value={actionRegistry}><div key={selectedItem?.id || (filteredItems.length === 0 ? '__list_empty_actions' : '__list_actions')}>{activeActionsElement}</div></ActionRegistryContext.Provider>}
        </div>

        <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
            <button onClick={pop} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg></button>
            <input ref={inputRef} type="text" placeholder={searchBarPlaceholder || 'Search…'} value={searchText} onChange={(event) => handleSearchChange(event.target.value)} className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-[14px] font-light" autoFocus />
            {searchBarAccessory && <div className="flex-shrink-0">{searchBarAccessory}</div>}
          </div>

          {isShowingDetail ? <div className="flex flex-1 overflow-hidden"><div className="w-1/3 flex flex-col overflow-hidden">{listContent}</div>{detailElement ? <div className="flex-1 border-l border-white/[0.06] overflow-y-auto"><div className="p-4">{detailElement}</div></div> : null}</div> : listContent}

          <div className="flex items-center px-4 py-3 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
            <div className="flex items-center gap-2 text-white/40 text-xs flex-1 min-w-0 font-medium">{footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}<span className="truncate">{footerTitle}</span></div>
            {primaryAction && <button type="button" onClick={() => primaryAction.execute()} className="flex items-center gap-2 mr-3 text-white hover:text-white/90 transition-colors"><span className="text-white text-xs font-semibold">{primaryAction.title}</span><kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">↩</kbd></button>}
            <button onClick={() => setShowActions(true)} className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors"><span className="text-xs font-medium">Actions</span><kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd><kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">K</kbd></button>
          </div>
        </div>

        {showActions && selectedActions.length > 0 && <ActionPanelOverlay actions={selectedActions} onClose={() => setShowActions(false)} onExecute={(action) => { setShowActions(false); action.execute(); setTimeout(() => inputRef.current?.focus(), 0); }} />}
      </ListRegistryContext.Provider>
    );
  }

  const ListItem = Object.assign(ListItemComponent, { Detail: ListItemDetail });
  const List = Object.assign(ListComponent, {
    Item: ListItem,
    Section: ListSectionComponent,
    EmptyView: ListEmptyView,
    Dropdown: ListDropdown,
  });

  return { List, ListItemDetail, ListEmptyView, ListDropdown, EmptyViewRegistryContext };
}
