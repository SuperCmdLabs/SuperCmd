import React from 'react';
import type { CommandInfo } from '../../types/electron';
import type { CalcResult } from '../smart-calculator';
import LauncherCalculatorCard from './LauncherCalculatorCard';
import LauncherCommandRow from './LauncherCommandRow';

export type LauncherCommandSection = {
  title: string;
  items: CommandInfo[];
};

const COMMAND_ROW_HEIGHT = 38;
const SECTION_HEADER_HEIGHT = 26;
const CALCULATOR_CARD_HEIGHT = 124;
const DEFAULT_VIEWPORT_HEIGHT = 420;
const VIRTUALIZATION_THRESHOLD = 120;
const VIRTUALIZATION_OVERSCAN_PX = COMMAND_ROW_HEIGHT * 6;

type LauncherVirtualEntry =
  | {
      kind: 'calculator';
      key: string;
      top: number;
      height: number;
      absoluteIndex: number;
    }
  | {
      kind: 'section';
      key: string;
      title: string;
      top: number;
      height: number;
    }
  | {
      kind: 'command';
      key: string;
      command: CommandInfo;
      flatIndex: number;
      absoluteIndex: number;
      top: number;
      height: number;
    };

type LauncherVirtualList = {
  entries: LauncherVirtualEntry[];
  totalHeight: number;
};

function buildVirtualEntries(
  sections: LauncherCommandSection[],
  calcResult: CalcResult | null,
  calcOffset: number
): LauncherVirtualList {
  const entries: LauncherVirtualEntry[] = [];
  let top = 0;
  let flatIndexCursor = 0;

  if (calcResult) {
    entries.push({
      kind: 'calculator',
      key: 'calculator',
      top,
      height: CALCULATOR_CARD_HEIGHT,
      absoluteIndex: 0,
    });
    top += CALCULATOR_CARD_HEIGHT;
  }

  sections.forEach((section, sectionIndex) => {
    const sectionStartIndex = flatIndexCursor;
    if (section.title) {
      entries.push({
        kind: 'section',
        key: `section-${sectionIndex}-${sectionStartIndex}-${section.title}`,
        title: section.title,
        top,
        height: SECTION_HEADER_HEIGHT,
      });
      top += SECTION_HEADER_HEIGHT;
    }

    section.items.forEach((command, itemIndex) => {
      const flatIndex = sectionStartIndex + itemIndex;
      entries.push({
        kind: 'command',
        key: command.id,
        command,
        flatIndex,
        absoluteIndex: flatIndex + calcOffset,
        top,
        height: COMMAND_ROW_HEIGHT,
      });
      top += COMMAND_ROW_HEIGHT;
    });
    flatIndexCursor += section.items.length;
  });

  return { entries, totalHeight: top };
}

function findEntryIndexAtOffset(entries: LauncherVirtualEntry[], offset: number): number {
  let low = 0;
  let high = entries.length - 1;
  let match = entries.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const entry = entries[mid];
    if (entry.top + entry.height >= offset) {
      match = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return Math.max(0, Math.min(match, entries.length));
}

function getEntryRangeForOffsets(
  entries: LauncherVirtualEntry[],
  startOffset: number,
  endOffset: number
): { start: number; end: number } {
  if (entries.length === 0) return { start: 0, end: 0 };
  const start = findEntryIndexAtOffset(entries, startOffset);
  let end = start;
  while (end < entries.length && entries[end].top <= endOffset) {
    end += 1;
  }
  return { start, end };
}

function mergeEntryRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const normalized = ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];

  normalized.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      return;
    }
    merged.push({ ...range });
  });

  return merged;
}

function getVirtualizedEntries(
  entries: LauncherVirtualEntry[],
  scrollTop: number,
  viewportHeight: number,
  selectedIndex: number
): LauncherVirtualEntry[] {
  const viewportStart = Math.max(0, scrollTop - VIRTUALIZATION_OVERSCAN_PX);
  const viewportEnd = scrollTop + viewportHeight + VIRTUALIZATION_OVERSCAN_PX;
  const ranges = [getEntryRangeForOffsets(entries, viewportStart, viewportEnd)];
  const selectedEntry = entries.find((entry) => entry.kind !== 'section' && entry.absoluteIndex === selectedIndex);

  if (selectedEntry && (selectedEntry.top < viewportStart || selectedEntry.top + selectedEntry.height > viewportEnd)) {
    ranges.push(
      getEntryRangeForOffsets(
        entries,
        Math.max(0, selectedEntry.top - VIRTUALIZATION_OVERSCAN_PX),
        selectedEntry.top + selectedEntry.height + VIRTUALIZATION_OVERSCAN_PX
      )
    );
  }

  return mergeEntryRanges(ranges).flatMap((range) => entries.slice(range.start, range.end));
}

function useLatestValue<T>(value: T): React.MutableRefObject<T> {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

type LauncherCommandListProps = {
  listRef: React.RefObject<HTMLDivElement>;
  itemRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  isLoading: boolean;
  isHidden: boolean;
  displayCommands: CommandInfo[];
  sections: LauncherCommandSection[];
  calcResult: CalcResult | null;
  calcOffset: number;
  selectedIndex: number;
  commandAliases: Record<string, string>;
  commandHotkeys: Record<string, string>;
  onCalculatorCopy: () => void;
  onCommandClick: (command: CommandInfo, selectedIndex: number, event?: React.MouseEvent<HTMLDivElement>) => void | Promise<void>;
  onCommandContextMenu: (
    event: React.MouseEvent<HTMLDivElement>,
    command: CommandInfo,
    selectedIndex: number
  ) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LauncherCommandList: React.FC<LauncherCommandListProps> = ({
  listRef,
  itemRefs,
  isLoading,
  isHidden,
  displayCommands,
  sections,
  calcResult,
  calcOffset,
  selectedIndex,
  commandAliases,
  commandHotkeys,
  onCalculatorCopy,
  onCommandClick,
  onCommandContextMenu,
  t,
}) => {
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(DEFAULT_VIEWPORT_HEIGHT);
  const commandClickRef = useLatestValue(onCommandClick);
  const commandContextMenuRef = useLatestValue(onCommandContextMenu);

  const virtualList = React.useMemo(
    () => buildVirtualEntries(sections, calcResult, calcOffset),
    [calcOffset, calcResult, sections]
  );
  const shouldVirtualize = virtualList.entries.length > VIRTUALIZATION_THRESHOLD;
  const visibleEntries = React.useMemo(
    () =>
      shouldVirtualize
        ? getVirtualizedEntries(virtualList.entries, scrollTop, viewportHeight, selectedIndex)
        : virtualList.entries,
    [scrollTop, selectedIndex, shouldVirtualize, viewportHeight, virtualList.entries]
  );
  const selectedEntry = React.useMemo(
    () => virtualList.entries.find((entry) => entry.kind !== 'section' && entry.absoluteIndex === selectedIndex),
    [selectedIndex, virtualList.entries]
  );

  const registerItemRef = React.useCallback(
    (absoluteIndex: number, el: HTMLDivElement | null) => {
      itemRefs.current[absoluteIndex] = el;
    },
    [itemRefs]
  );
  const registerCalculatorRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      itemRefs.current[0] = el;
    },
    [itemRefs]
  );
  const handleCommandClick = React.useCallback(
    (command: CommandInfo, absoluteIndex: number, event?: React.MouseEvent<HTMLDivElement>) => {
      void commandClickRef.current(command, absoluteIndex, event);
    },
    [commandClickRef]
  );
  const handleCommandContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>, command: CommandInfo, absoluteIndex: number) => {
      commandContextMenuRef.current(event, command, absoluteIndex);
    },
    [commandContextMenuRef]
  );
  const handleScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  React.useEffect(() => {
    const element = listRef.current;
    if (!element || !shouldVirtualize) return;

    const updateViewportHeight = () => {
      setViewportHeight(element.clientHeight || DEFAULT_VIEWPORT_HEIGHT);
      setScrollTop(element.scrollTop);
    };
    updateViewportHeight();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewportHeight);
    resizeObserver?.observe(element);
    window.addEventListener('resize', updateViewportHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateViewportHeight);
    };
  }, [listRef, shouldVirtualize]);

  React.useEffect(() => {
    const element = listRef.current;
    if (!element || !shouldVirtualize || !selectedEntry) return;

    const currentTop = element.scrollTop;
    const currentBottom = currentTop + (element.clientHeight || viewportHeight);
    let nextTop: number | null = null;

    if (selectedEntry.top < currentTop) {
      nextTop = selectedEntry.top;
    } else if (selectedEntry.top + selectedEntry.height > currentBottom) {
      nextTop = selectedEntry.top + selectedEntry.height - (element.clientHeight || viewportHeight);
    }

    if (nextTop !== null) {
      element.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
    }
  }, [listRef, selectedEntry, shouldVirtualize, viewportHeight]);

  const renderEntry = (entry: LauncherVirtualEntry, virtualized: boolean): React.ReactNode => {
    let node: React.ReactNode;
    if (entry.kind === 'calculator') {
      node = (
        <LauncherCalculatorCard
          result={calcResult as CalcResult}
          selected={selectedIndex === 0}
          itemRef={registerCalculatorRef}
          onCopy={onCalculatorCopy}
          t={t}
        />
      );
    } else if (entry.kind === 'section') {
      node = (
        <div className="px-3 pt-2 pb-1 text-[0.6875rem] uppercase tracking-wider text-[var(--text-subtle)] font-medium">
          {entry.title}
        </div>
      );
    } else {
      const commandAlias = String(commandAliases[entry.command.id] || '').trim();
      const commandHotkey = String(commandHotkeys[entry.command.id] || '').trim();
      node = (
        <LauncherCommandRow
          command={entry.command}
          flatIndex={entry.flatIndex}
          absoluteIndex={entry.absoluteIndex}
          selected={entry.absoluteIndex === selectedIndex}
          registerItemRef={registerItemRef}
          commandAlias={commandAlias}
          commandHotkey={commandHotkey}
          onCommandClick={handleCommandClick}
          onCommandContextMenu={handleCommandContextMenu}
          t={t}
        />
      );
    }

    if (!virtualized) {
      return <React.Fragment key={entry.key}>{node}</React.Fragment>;
    }

    return (
      <div
        key={entry.key}
        style={{
          position: 'absolute',
          top: entry.top,
          left: 0,
          right: 0,
          height: entry.height,
        }}
      >
        {node}
      </div>
    );
  };

  return (
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto custom-scrollbar p-1.5 list-area"
      style={isHidden ? { display: 'none' } : undefined}
      onScroll={handleScroll}
    >
      {isLoading ? (
        <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
          <p className="text-sm">{t('launcher.status.discoveringApps')}</p>
        </div>
      ) : displayCommands.length === 0 && !calcResult ? (
        <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
          <p className="text-sm">{t('launcher.status.noMatchingResults')}</p>
        </div>
      ) : shouldVirtualize ? (
        <div className="relative" style={{ height: virtualList.totalHeight }}>
          {visibleEntries.map((entry) => renderEntry(entry, true))}
        </div>
      ) : (
        <div className="space-y-0.5">
          {visibleEntries.map((entry) => renderEntry(entry, false))}
        </div>
      )}
    </div>
  );
};

export default LauncherCommandList;
