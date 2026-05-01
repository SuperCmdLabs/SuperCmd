/**
 * List runtime main container.
 *
 * Builds `List` including selection, filtering, detail split, and
 * action overlay behavior.
 */

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ExtractedAction } from './action-runtime';
import { useI18n } from '../i18n';
import { transliterateForSearch } from '../utils/transliterate';
import { createListDetailRuntime } from './list-runtime-detail';
import { groupListItems, shouldUseEmojiGrid, useListRegistry } from './list-runtime-hooks';
import { createListRenderers } from './list-runtime-renderers';
import {
  EmptyViewRegistryContext,
  ListRegistryContext,
  SelectedItemActionsContext,
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
  resolveReadableTintColor: (value?: string, options?: { minContrast?: number }) => string | undefined;
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
    resolveReadableTintColor,
    addHexAlpha,
    getExtensionContext,
    normalizeScAssetUrl,
    toScAssetUrl,
    setClearSearchBarCallback,
  } = deps;

  const renderers = createListRenderers({ renderIcon, resolveTintColor, resolveReadableTintColor, addHexAlpha });
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
    const { t } = useI18n();
    const extInfo = useContext(ExtensionInfoReactContext);
    const [internalSearch, setInternalSearch] = useState(() => controlledSearch ?? '');
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [showActions, setShowActions] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const { pop } = useNavigation();
    const prevSelectedSectionRef = useRef<string | undefined>(undefined);
    const { registryAPI, allItems } = useListRegistry();

    useEffect(() => {
      if (controlledSearch === undefined) return;
      setInternalSearch(controlledSearch);
    }, [controlledSearch]);

    const filteredItems = useMemo(() => {
      if (onSearchTextChange || filtering === false || !internalSearch.trim()) return allItems;
      const query = internalSearch.toLowerCase();
      // transliterateForSearch returns unchanged lowercase for Latin input,
      // or a phonetically-normalized Latin form for non-Latin input.
      const translitQuery = transliterateForSearch(internalSearch);
      const hasTranslitQuery = translitQuery !== query && translitQuery.length > 0;
      return allItems.filter((item) => {
        const rawTitle = typeof item.props.title === 'string' ? item.props.title : (item.props.title as any)?.value || '';
        const rawSubtitle = typeof item.props.subtitle === 'string' ? item.props.subtitle : (item.props.subtitle as any)?.value || '';
        const title = rawTitle.toLowerCase();
        const subtitle = rawSubtitle.toLowerCase();
        if (title.includes(query) || subtitle.includes(query) || item.props.keywords?.some((keyword: string) => keyword.toLowerCase().includes(query))) {
          return true;
        }
        // Non-Latin query → transliterated query vs Latin titles
        if (hasTranslitQuery && (title.includes(translitQuery) || subtitle.includes(translitQuery))) {
          return true;
        }
        // Latin query vs non-Latin titles/subtitles (e.g. pinyin "ji suan" matches "计算器")
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
      if (throttle === true) searchDebounceRef.current = setTimeout(() => onSearchTextChange(value), 300);
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
    // Actions that can only be rendered at the List level (empty view, list-level actions)
    const listLevelActionsElement = (filteredItems.length === 0 ? emptyViewProps?.actions : null) || (!selectedItem?.props?.actions ? listActions : null);
    // The selected item ID so ListItemComponent can render its own actions in-tree
    const selectedItemActionsCtx = useMemo(() => ({
      selectedItemId: selectedItem?.id || null,
      actionRegistry,
      ActionRegistryContext,
    }), [selectedItem?.id, actionRegistry, ActionRegistryContext]);
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
      else return;

      event.preventDefault();
    }, [filteredItems.length, isMetaK, matchesShortcut, primaryAction, selectedActions, shouldUseEmojiGridValue, showActions]);

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

    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => { if (onSelectionChange && filteredItems[selectedIdx]) onSelectionChange(filteredItems[selectedIdx]?.props?.id || null); }, [filteredItems, onSelectionChange, selectedIdx]);

    const groupedItems = useMemo(() => groupListItems(filteredItems), [filteredItems]);

    // ─── Viewport virtualization for the linear (non-grid) list ─────
    // Brew-style extensions ship ~5k items; rendering all of them as DOM
    // nodes is the bottleneck. We render only the slice in view (plus a
    // small buffer) and pad the scroll container with spacer divs so the
    // scrollbar still represents the full list.
    const ROW_HEIGHT = 36;
    const HEADER_HEIGHT = 24;
    const OVERSCAN = 8;

    const flatRows = useMemo(() => {
      const rows: Array<
        | { type: 'header'; title: string; key: string }
        | { type: 'item'; item: typeof filteredItems[number]; globalIdx: number; key: string }
      > = [];
      for (let g = 0; g < groupedItems.length; g += 1) {
        const group = groupedItems[g];
        if (group.title) rows.push({ type: 'header', title: group.title, key: `__h_${g}` });
        for (const entry of group.items) {
          rows.push({ type: 'item', item: entry.item, globalIdx: entry.globalIdx, key: entry.item.id });
        }
      }
      return rows;
    }, [groupedItems]);

    const rowMetrics = useMemo(() => {
      const offsets: number[] = new Array(flatRows.length);
      let cum = 0;
      for (let i = 0; i < flatRows.length; i += 1) {
        offsets[i] = cum;
        cum += flatRows[i].type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
      }
      return { offsets, totalHeight: cum };
    }, [flatRows]);

    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(0);

    useEffect(() => {
      const el = listRef.current;
      if (!el) return;
      let raf = 0;
      // rAF-throttle the scroll updates (one per frame max), but always
      // report the new position. Skipping updates within a row's worth of
      // pixels left the visible window stale and made the list appear to
      // stop scrolling; OVERSCAN already handles the "nothing changed yet"
      // case cheaply.
      const onScroll = () => {
        if (raf) return;
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          setScrollTop(el.scrollTop);
        });
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      const measure = () => setContainerHeight(el.clientHeight);
      measure();
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
      if (ro) ro.observe(el);
      return () => {
        el.removeEventListener('scroll', onScroll);
        if (raf) window.cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
      };
    }, []);

    const { visibleStart, visibleEnd } = useMemo(() => {
      if (flatRows.length === 0) return { visibleStart: 0, visibleEnd: 0 };
      const top = scrollTop;
      const bottom = scrollTop + (containerHeight || 600);
      let lo = 0;
      let hi = flatRows.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const rowH = flatRows[mid].type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
        if (rowMetrics.offsets[mid] + rowH <= top) lo = mid + 1;
        else hi = mid;
      }
      const start = Math.max(0, lo - OVERSCAN);
      let end = lo;
      while (end < flatRows.length && rowMetrics.offsets[end] < bottom) end += 1;
      end = Math.min(flatRows.length, end + OVERSCAN);
      return { visibleStart: start, visibleEnd: end };
    }, [flatRows, rowMetrics, scrollTop, containerHeight]);

    // Map from filteredItems index → flat row index for scroll-into-view.
    const itemIdxToRowIdx = useMemo(() => {
      const map: number[] = new Array(filteredItems.length);
      let itemSeen = -1;
      for (let i = 0; i < flatRows.length; i += 1) {
        if (flatRows[i].type === 'item') {
          itemSeen += 1;
          map[itemSeen] = i;
        }
      }
      return map;
    }, [flatRows, filteredItems.length]);

    // Stable refs so the scroll-into-view effect only fires when the user
    // moves selection — not when upstream re-renders give flatRows/rowMetrics/
    // itemIdxToRowIdx fresh identities. Without this, scrolling the wheel
    // triggers any unrelated re-render → effect re-runs → snaps back to
    // selectedIdx.
    const flatRowsRef = useRef(flatRows);
    flatRowsRef.current = flatRows;
    const rowMetricsRef = useRef(rowMetrics);
    rowMetricsRef.current = rowMetrics;
    const itemIdxToRowIdxRef = useRef(itemIdxToRowIdx);
    itemIdxToRowIdxRef.current = itemIdxToRowIdx;

    useEffect(() => {
      const el = listRef.current;
      if (!el) return;
      const rowIdx = itemIdxToRowIdxRef.current[selectedIdx];
      if (rowIdx == null) return;
      const top = rowMetricsRef.current.offsets[rowIdx];
      if (top == null) return;
      const rowH = flatRowsRef.current[rowIdx]?.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
      const visTop = el.scrollTop;
      const visBottom = visTop + el.clientHeight;
      // 'auto' (instant) — smooth scrolling queues animations that interrupt
      // each other when arrow-down is held, producing visible jitter.
      if (top < visTop) {
        el.scrollTo({ top, behavior: 'auto' });
      } else if (top + rowH > visBottom) {
        el.scrollTo({ top: top + rowH - el.clientHeight, behavior: 'auto' });
      }
    }, [selectedIdx]);

    const extensionContext = getExtensionContext();
    const footerTitle = navigationTitle || extInfo.extensionDisplayName || extensionContext.extensionDisplayName || extensionContext.extensionName || 'Extension';
    const footerIcon = extInfo.extensionIconDataUrl || extensionContext.extensionIconDataUrl;
    const detailElement = selectedItem?.props?.detail;

    const listContent = (
      <div ref={listRef} className="flex-1 overflow-y-auto py-0">
        {isLoading && filteredItems.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]"><p className="text-sm">{t('common.loading')}</p></div>
        ) : filteredItems.length === 0 ? (
          emptyViewProps ? <ListEmptyView title={emptyViewProps.title} description={emptyViewProps.description} icon={emptyViewProps.icon} actions={emptyViewProps.actions} /> : <div className="flex items-center justify-center h-full text-[var(--text-subtle)]"><p className="text-sm">{t('common.noResults')}</p></div>
        ) : shouldUseEmojiGridValue ? (
          groupedItems.map((group, groupIndex) => (
            <div key={groupIndex} className="mb-2">
              {group.title && <div className="px-4 pt-2 pb-1 text-[11px] tracking-[0.08em] text-[var(--text-subtle)] font-medium select-none">{group.title}<span className="ml-2 text-[var(--text-muted)]">{group.items.length}</span></div>}
              <div className="px-2 pb-1 grid gap-2" style={{ gridTemplateColumns: `repeat(8, 1fr)` }}>
                {group.items.map(({ item, globalIdx }) => {
                  const title = typeof item.props.title === 'string' ? item.props.title : (item.props.title as any)?.value || '';
                  return (
                    <ListEmojiGridItemRenderer
                      key={item.id}
                      icon={item.props.icon}
                      title={title}
                      isSelected={globalIdx === selectedIdx}
                      dataIdx={globalIdx}
                      onSelect={() => setSelectedIdx(globalIdx)}
                      onActivate={() => {
                        if (globalIdx === selectedIdx) {
                          primaryAction?.execute();
                        } else {
                          setSelectedIdx(globalIdx);
                        }
                        inputRef.current?.focus();
                      }}
                      onContextAction={(event: React.MouseEvent<HTMLDivElement>) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedIdx(globalIdx);
                        setShowActions(true);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          (() => {
            const startOffset = rowMetrics.offsets[visibleStart] || 0;
            const endOffset = visibleEnd < rowMetrics.offsets.length
              ? rowMetrics.offsets[visibleEnd]
              : rowMetrics.totalHeight;
            const bottomSpacer = Math.max(0, rowMetrics.totalHeight - endOffset);
            return (
              <>
                {startOffset > 0 && <div style={{ height: startOffset }} aria-hidden="true" />}
                {flatRows.slice(visibleStart, visibleEnd).map((row) => {
                  if (row.type === 'header') {
                    return (
                      <div
                        key={row.key}
                        className="px-4 pt-0.5 pb-1 text-[11px] tracking-[0.08em] text-[var(--text-subtle)] font-medium select-none"
                        style={{ height: HEADER_HEIGHT }}
                      >
                        {row.title}
                      </div>
                    );
                  }
                  const { item, globalIdx } = row;
                  return (
                    <ListItemRenderer
                      key={item.id}
                      {...item.props}
                      assetsPath={extInfo.assetsPath || getExtensionContext().assetsPath}
                      isSelected={globalIdx === selectedIdx}
                      dataIdx={globalIdx}
                      onSelect={() => setSelectedIdx(globalIdx)}
                      onActivate={() => {
                        if (globalIdx === selectedIdx) {
                          primaryAction?.execute();
                        } else {
                          setSelectedIdx(globalIdx);
                        }
                        inputRef.current?.focus();
                      }}
                      onContextAction={(event: React.MouseEvent<HTMLDivElement>) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedIdx(globalIdx);
                        setShowActions(true);
                      }}
                    />
                  );
                })}
                {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} aria-hidden="true" />}
              </>
            );
          })()
        )}
      </div>
    );

    return (
      <ListRegistryContext.Provider value={registryAPI}>
        <div style={{ display: 'none' }}>
          <SelectedItemActionsContext.Provider value={selectedItemActionsCtx}>
            <EmptyViewRegistryContext.Provider value={setEmptyViewProps}>{children}</EmptyViewRegistryContext.Provider>
          </SelectedItemActionsContext.Provider>
          {listLevelActionsElement && <ActionRegistryContext.Provider value={actionRegistry}><div key={filteredItems.length === 0 ? '__list_empty_actions' : '__list_actions'}>{listLevelActionsElement}</div></ActionRegistryContext.Provider>}
        </div>

        <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
          <div className="drag-region flex items-center gap-2 px-4 py-3 border-b border-[var(--ui-divider)]">
            <button onClick={pop} className="sc-back-button text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0 p-0.5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg></button>
            <input ref={inputRef} data-supercmd-search-input="true" type="text" placeholder={searchBarPlaceholder || t('common.search')} value={internalSearch} onChange={(event) => handleSearchChange(event.target.value)} className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[color:var(--text-subtle)] text-[14px] font-light" autoFocus />
            {searchBarAccessory && <div className="flex-shrink-0">{searchBarAccessory}</div>}
          </div>

          {isShowingDetail ? <div className="flex flex-1 overflow-hidden"><div className="w-1/3 flex flex-col overflow-hidden">{listContent}</div>{detailElement ? <div className="flex-1 border-l border-[var(--ui-divider)] overflow-hidden">{detailElement}</div> : null}</div> : listContent}

          <div className="sc-glass-footer flex items-center px-4 py-2.5">
            <div className="sc-footer-primary flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-normal">{footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}<span className="truncate">{footerTitle}</span></div>
            {primaryAction && <button type="button" onClick={() => primaryAction.execute()} className="flex items-center gap-2 mr-3 text-[var(--text-primary)] hover:text-[var(--text-secondary)] transition-colors"><span className="text-xs font-semibold">{primaryAction.title}</span><kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">↩</kbd></button>}
            <button onClick={() => setShowActions(true)} className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"><span className="text-xs font-normal">{t('common.actions')}</span><kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">⌘</kbd><kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">K</kbd></button>
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
