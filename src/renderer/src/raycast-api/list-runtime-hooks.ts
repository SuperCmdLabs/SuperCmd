/**
 * List runtime hooks.
 *
 * Extracted list registry/grouping helpers to keep List container module small.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { ItemRegistration, ListRegistryAPI } from './list-runtime-types';

export const LIST_ROW_HEIGHT = 36;
export const LIST_HEADER_HEIGHT = 24;
export const LIST_OVERSCAN = 8;
export const EMOJI_GRID_COLUMNS = 8;
export const EMOJI_GRID_CELL_HEIGHT = 96;
export const EMOJI_GRID_ROW_GAP = 8;
export const EMOJI_GRID_ROW_HEIGHT = EMOJI_GRID_CELL_HEIGHT + EMOJI_GRID_ROW_GAP;
export const EMOJI_GRID_HEADER_HEIGHT = 28;

export type ListItemGroup = {
  title?: string;
  items: { item: ItemRegistration; globalIdx: number }[];
};

export type ListVirtualRow =
  | { type: 'header'; title: string; key: string; height: number }
  | { type: 'item'; item: ItemRegistration; globalIdx: number; key: string; height: number };

export type EmojiGridVirtualRow =
  | { type: 'header'; title: string; count: number; key: string; height: number }
  | { type: 'emoji-row'; items: ListItemGroup['items']; key: string; height: number };

export type VirtualRow = ListVirtualRow | EmojiGridVirtualRow;

export type VirtualRowMetrics = {
  offsets: number[];
  totalHeight: number;
};

function getReactTypeName(type: any): string {
  return String(type?.displayName || type?.name || type || '');
}

function buildValueSignature(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `fn:${value.name || 'anonymous'}`;
  if (typeof value === 'symbol') return value.toString();

  if (Array.isArray(value)) {
    return `[${value.map((item) => buildValueSignature(item, seen)).join(',')}]`;
  }

  if (React.isValidElement(value)) {
    return `element:${getReactTypeName(value.type)}:${buildValueSignature((value as any).props, seen)}`;
  }

  if (typeof value === 'object') {
    if (value instanceof Date) return `date:${value.getTime()}`;
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== '_owner' && key !== '_store' && key !== 'ref' && key !== 'key')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${key}:${buildValueSignature(entryValue, seen)}`);

    return `{${entries.join(',')}}`;
  }

  return String(value);
}

function buildActionTypeSignature(actions: unknown): string {
  if (!React.isValidElement(actions)) return buildValueSignature(actions);
  return getReactTypeName((actions as React.ReactElement).type);
}

function buildListAccessorySignature(accessory: NonNullable<ItemRegistration['props']['accessories']>[number]): string {
  return [
    buildValueSignature(accessory?.text),
    buildValueSignature(accessory?.icon),
    buildValueSignature(accessory?.tag),
    buildValueSignature(accessory?.date),
    buildValueSignature(accessory?.tooltip),
  ].join('\u001e');
}

export function buildListItemVisibleSignature(item: ItemRegistration): string {
  const props = item.props;
  return [
    item.id,
    String(item.order),
    item.sectionTitle || '',
    buildValueSignature(props.id),
    buildValueSignature(props.title),
    buildValueSignature(props.subtitle),
    buildValueSignature(props.icon),
    props.accessories?.map(buildListAccessorySignature).join('\u001d') || '',
    props.keywords?.map((keyword) => JSON.stringify(keyword)).join('\u001d') || '',
    buildValueSignature(props.detail),
    buildValueSignature(props.quickLook),
    buildActionTypeSignature(props.actions),
  ].join('\u001f');
}

export function useListRegistry() {
  const registryRef = useRef(new Map<string, ItemRegistration>());
  const visibleSignatureRef = useRef(new Map<string, string>());
  const [registryVersion, setRegistryVersion] = useState(0);
  const pendingRef = useRef(false);

  const scheduleRegistryUpdate = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    queueMicrotask(() => {
      pendingRef.current = false;
      setRegistryVersion((value) => value + 1);
    });
  }, []);

  const registryAPI = useMemo<ListRegistryAPI>(() => ({
    set(id, data) {
      const existing = registryRef.current.get(id);
      if (existing) {
        // Hot path: an unrelated re-render (e.g. hover changing selection)
        // re-runs every <List.Item> render even though no content actually
        // changed. The renderOrder counter shifts uniformly so relative
        // order is preserved; just write it through and skip the costly
        // visible-signature work. Only publish when the id's visible
        // signature, section, or order actually changed.
        const propsChanged = existing.props !== data.props;
        const sectionChanged = existing.sectionTitle !== data.sectionTitle;
        const orderChanged = existing.order !== data.order;
        existing.props = data.props;
        existing.sectionTitle = data.sectionTitle;
        existing.order = data.order;
        if (!propsChanged && !sectionChanged && !orderChanged) return;

        const nextSignature = buildListItemVisibleSignature(existing);
        if (visibleSignatureRef.current.get(id) === nextSignature) return;
        visibleSignatureRef.current.set(id, nextSignature);
      } else {
        const item = { id, ...data };
        registryRef.current.set(id, item);
        visibleSignatureRef.current.set(id, buildListItemVisibleSignature(item));
      }
      scheduleRegistryUpdate();
    },
    delete(id) {
      if (!registryRef.current.has(id)) return;
      registryRef.current.delete(id);
      visibleSignatureRef.current.delete(id);
      scheduleRegistryUpdate();
    },
  }), [scheduleRegistryUpdate]);

  const allItems = useMemo(() => {
    const items = Array.from(registryRef.current.values());

    // Group by section, preserving the order each section first appeared,
    // then sort items within each section by their render order.
    // This prevents new items in a section from appearing after later sections.
    const sectionOrder = new Map<string | undefined, number>();
    for (const item of items) {
      if (!sectionOrder.has(item.sectionTitle)) {
        sectionOrder.set(item.sectionTitle, sectionOrder.size);
      }
    }

    return items.sort((a, b) => {
      const sectionA = sectionOrder.get(a.sectionTitle) ?? 0;
      const sectionB = sectionOrder.get(b.sectionTitle) ?? 0;
      if (sectionA !== sectionB) return sectionA - sectionB;
      return a.order - b.order;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryVersion]);

  return { registryAPI, allItems };
}

export function shouldUseEmojiGrid(filteredItems: ItemRegistration[], isShowingDetail: boolean, isEmojiOrSymbol: (value: string) => boolean): boolean {
  if (isShowingDetail || filteredItems.length < 24) return false;

  const iconToEmoji = (icon: any): string => {
    if (typeof icon === 'string') return icon;
    if (!icon || typeof icon !== 'object') return '';
    const source = icon.source ?? icon.light ?? icon.dark;
    if (typeof source === 'string') return source;
    if (source && typeof source === 'object') return typeof source.light === 'string' ? source.light : typeof source.dark === 'string' ? source.dark : '';
    return '';
  };

  let emojiIcons = 0;
  let iconsWithValue = 0;
  for (const item of filteredItems) {
    if ((item as any)?.props?.detail) return false;
    const emojiCandidate = iconToEmoji((item as any)?.props?.icon).trim();
    if (!emojiCandidate) continue;
    iconsWithValue += 1;
    if (isEmojiOrSymbol(emojiCandidate)) emojiIcons += 1;
  }

  if (iconsWithValue < Math.ceil(filteredItems.length * 0.95)) return false;
  return emojiIcons / Math.max(1, iconsWithValue) >= 0.95;
}

export function groupListItems(filteredItems: ItemRegistration[]): ListItemGroup[] {
  const groups: ListItemGroup[] = [];
  let currentSection: string | undefined | null = null;
  let globalIndex = 0;

  for (const item of filteredItems) {
    if (item.sectionTitle !== currentSection || groups.length === 0) {
      currentSection = item.sectionTitle;
      groups.push({ title: item.sectionTitle, items: [] });
    }
    groups[groups.length - 1].items.push({ item, globalIdx: globalIndex++ });
  }

  return groups;
}

export function buildListVirtualRows(groupedItems: ListItemGroup[]): ListVirtualRow[] {
  const rows: ListVirtualRow[] = [];
  for (let groupIndex = 0; groupIndex < groupedItems.length; groupIndex += 1) {
    const group = groupedItems[groupIndex];
    if (group.title) {
      rows.push({ type: 'header', title: group.title, key: `__h_${groupIndex}`, height: LIST_HEADER_HEIGHT });
    }
    for (const entry of group.items) {
      rows.push({
        type: 'item',
        item: entry.item,
        globalIdx: entry.globalIdx,
        key: entry.item.id,
        height: LIST_ROW_HEIGHT,
      });
    }
  }
  return rows;
}

export function buildEmojiGridVirtualRows(groupedItems: ListItemGroup[], columns = EMOJI_GRID_COLUMNS): EmojiGridVirtualRow[] {
  const rows: EmojiGridVirtualRow[] = [];
  const safeColumns = Math.max(1, Math.floor(columns));

  for (let groupIndex = 0; groupIndex < groupedItems.length; groupIndex += 1) {
    const group = groupedItems[groupIndex];
    if (group.title) {
      rows.push({
        type: 'header',
        title: group.title,
        count: group.items.length,
        key: `__eg_h_${groupIndex}`,
        height: EMOJI_GRID_HEADER_HEIGHT,
      });
    }

    for (let start = 0; start < group.items.length; start += safeColumns) {
      rows.push({
        type: 'emoji-row',
        items: group.items.slice(start, start + safeColumns),
        key: `__eg_r_${groupIndex}_${start}`,
        height: EMOJI_GRID_ROW_HEIGHT,
      });
    }
  }

  return rows;
}

export function measureVirtualRows(rows: Array<{ height: number }>): VirtualRowMetrics {
  const offsets: number[] = new Array(rows.length);
  let totalHeight = 0;
  for (let index = 0; index < rows.length; index += 1) {
    offsets[index] = totalHeight;
    totalHeight += rows[index].height;
  }
  return { offsets, totalHeight };
}

export function getVisibleVirtualRange(
  rows: Array<{ height: number }>,
  rowMetrics: VirtualRowMetrics,
  scrollTop: number,
  containerHeight: number,
  overscan = LIST_OVERSCAN,
) {
  if (rows.length === 0) return { visibleStart: 0, visibleEnd: 0 };

  const top = scrollTop;
  const bottom = scrollTop + (containerHeight || 600);
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rowMetrics.offsets[mid] + rows[mid].height <= top) lo = mid + 1;
    else hi = mid;
  }

  const visibleStart = Math.max(0, lo - overscan);
  let visibleEnd = lo;
  while (visibleEnd < rows.length && rowMetrics.offsets[visibleEnd] < bottom) visibleEnd += 1;
  visibleEnd = Math.min(rows.length, visibleEnd + overscan);
  return { visibleStart, visibleEnd };
}

export function buildItemToVirtualRowMap(rows: VirtualRow[], itemCount: number): number[] {
  const map: number[] = new Array(itemCount);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.type === 'item') {
      map[row.globalIdx] = rowIndex;
    } else if (row.type === 'emoji-row') {
      for (const entry of row.items) {
        map[entry.globalIdx] = rowIndex;
      }
    }
  }

  return map;
}
