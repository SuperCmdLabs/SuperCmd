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
import {
  buildEmojiGridVirtualRows,
  buildItemToVirtualRowMap,
  buildListVirtualRows,
  EMOJI_GRID_CELL_HEIGHT,
  EMOJI_GRID_COLUMNS,
  EMOJI_GRID_ROW_GAP,
  getVisibleVirtualRange,
  groupListItems,
  measureVirtualRows,
  shouldUseEmojiGrid,
  useListRegistry,
} from './list-runtime-hooks';
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
      else if (event.key === 'ArrowDown') setSelectedIdx((value) => Math.min(value + (shouldUseEmojiGridValue ? EMOJI_GRID_COLUMNS : 1), filteredItems.length - 1));
      else if (event.key === 'ArrowUp') setSelectedIdx((value) => Math.max(value - (shouldUseEmojiGridValue ? EMOJI_GRID_COLUMNS : 1), 0));
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

    // ─── Viewport virtualization for list rows and emoji grid rows ─────
    // Emoji-heavy extensions can ship thousands of cells. Both layouts render
    // only the rows in view plus a buffer and use spacers to preserve scroll.
    const listRows = useMemo(() => buildListVirtualRows(groupedItems), [groupedItems]);
    const emojiGridRows = useMemo(() => buildEmojiGridVirtualRows(groupedItems), [groupedItems]);
    const virtualRows = shouldUseEmojiGridValue ? emojiGridRows : listRows;
    const rowMetrics = useMemo(() => measureVirtualRows(virtualRows), [virtualRows]);

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

    const { visibleStart, visibleEnd } = useMemo(
      () => getVisibleVirtualRange(virtualRows, rowMetrics, scrollTop, containerHeight),
      [containerHeight, rowMetrics, scrollTop, virtualRows],
    );

    // Map from filteredItems index → active virtual row index for scroll-into-view.
    const itemIdxToRowIdx = useMemo(() => {
      return buildItemToVirtualRowMap(virtualRows, filteredItems.length);
    }, [filteredItems.length, virtualRows]);

    // Stable refs so the scroll-into-view effect only fires when the user
    // moves selection — not when upstream re-renders give virtualRows/
    // rowMetrics/itemIdxToRowIdx fresh identities. Without this, scrolling the wheel
    // triggers any unrelated re-render → effect re-runs → snaps back to
    // selectedIdx.
    const virtualRowsRef = useRef(virtualRows);
    virtualRowsRef.current = virtualRows;
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
      const rowH = virtualRowsRef.current[rowIdx]?.height || 0;
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
    const rawDetail = selectedItem?.props?.detail;
    const detailElement = useMemo(() => {
      if (!rawDetail || !React.isValidElement(rawDetail)) return rawDetail;
      if (rawDetail.type !== React.Fragment) return rawDetail;
      const rawDetailElement = rawDetail as React.ReactElement<{ children?: React.ReactNode }>;
      const children = React.Children.toArray(rawDetailElement.props.children);
      let mergedMarkdown: string | undefined;
      let mergedMetadata: React.ReactElement | undefined;
      let mergedIsLoading: boolean | undefined;
      for (const child of children) {
        if (!React.isValidElement(child)) continue;
        if ((child.type as any) !== ListItemDetail) continue;
        const detailProps = child.props as {
          markdown?: string;
          metadata?: React.ReactElement;
          isLoading?: boolean;
        };
        if (detailProps.markdown !== undefined) mergedMarkdown = detailProps.markdown;
        if (detailProps.metadata !== undefined) mergedMetadata = detailProps.metadata;
        if (detailProps.isLoading !== undefined) mergedIsLoading = detailProps.isLoading;
      }
      if (mergedMarkdown === undefined && mergedMetadata === undefined) return rawDetail;
      return React.createElement(ListItemDetail, {
        markdown: mergedMarkdown,
        metadata: mergedMetadata,
        isLoading: mergedIsLoading,
      });
    }, [rawDetail]);

    const listContent = (
      <div ref={listRef} className="flex-1 overflow-y-auto py-0">
        {isLoading && filteredItems.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]"><p className="text-sm">{t('common.loading')}</p></div>
        ) : filteredItems.length === 0 ? (
          emptyViewProps ? <ListEmptyView title={emptyViewProps.title} description={emptyViewProps.description} icon={emptyViewProps.icon} actions={emptyViewProps.actions} /> : <div className="flex items-center justify-center h-full text-[var(--text-subtle)]"><p className="text-sm">{t('common.noResults')}</p></div>
        ) : shouldUseEmojiGridValue ? (
          (() => {
            const startOffset = rowMetrics.offsets[visibleStart] || 0;
            const endOffset = visibleEnd < rowMetrics.offsets.length
              ? rowMetrics.offsets[visibleEnd]
              : rowMetrics.totalHeight;
            const bottomSpacer = Math.max(0, rowMetrics.totalHeight - endOffset);
            return (
              <>
                {startOffset > 0 && <div style={{ height: startOffset }} aria-hidden="true" />}
                {emojiGridRows.slice(visibleStart, visibleEnd).map((row) => {
                  if (row.type === 'header') {
                    return (
                      <div
                        key={row.key}
                        className="px-4 pt-2 pb-1 text-[11px] tracking-[0.08em] text-[var(--text-subtle)] font-medium select-none"
                        style={{ height: row.height }}
                      >
                        {row.title}<span className="ml-2 text-[var(--text-muted)]">{row.count}</span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={row.key}
                      className="px-2 pb-2 grid gap-2"
                      style={{
                        gridTemplateColumns: `repeat(${EMOJI_GRID_COLUMNS}, minmax(0, 1fr))`,
                        gridAutoRows: `${EMOJI_GRID_CELL_HEIGHT}px`,
                        rowGap: `${EMOJI_GRID_ROW_GAP}px`,
                        height: row.height,
                      }}
                    >
                      {row.items.map(({ item, globalIdx }) => {
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
                  );
                })}
                {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} aria-hidden="true" />}
              </>
            );
          })()
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
                {listRows.slice(visibleStart, visibleEnd).map((row) => {
                  if (row.type === 'header') {
                    return (
                      <div
                        key={row.key}
                        className="px-4 pt-0.5 pb-1 text-[11px] tracking-[0.08em] text-[var(--text-subtle)] font-medium select-none"
                        style={{ height: row.height }}
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
