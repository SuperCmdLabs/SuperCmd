/**
 * List runtime hooks.
 *
 * Extracted list registry/grouping helpers to keep List container module small.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { ItemRegistration, ListRegistryAPI } from './list-runtime-types';

function getReactTypeName(type: any): string {
  return String(type?.displayName || type?.name || type || '');
}

function buildSnapshotSignature(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `fn:${value.name || 'anonymous'}`;
  if (typeof value === 'symbol') return value.toString();

  if (Array.isArray(value)) {
    return `[${value.map((item) => buildSnapshotSignature(item, seen)).join(',')}]`;
  }

  if (React.isValidElement(value)) {
    return `element:${getReactTypeName(value.type)}:${buildSnapshotSignature((value as any).props, seen)}`;
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== '_owner' && key !== '_store' && key !== 'ref' && key !== 'key')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${key}:${buildSnapshotSignature(entryValue, seen)}`);

    return `{${entries.join(',')}}`;
  }

  return String(value);
}

export function useListRegistry() {
  const registryRef = useRef(new Map<string, ItemRegistration>());
  const [registryVersion, setRegistryVersion] = useState(0);
  const pendingRef = useRef(false);
  const lastSnapshotRef = useRef('');

  const scheduleRegistryUpdate = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    queueMicrotask(() => {
      pendingRef.current = false;
      const snapshot = Array.from(registryRef.current.values()).map((item) => {
        const actionType = item.props.actions?.type as any;
        const actionName = actionType?.name || actionType?.displayName || typeof actionType || '';
        return buildSnapshotSignature({
          actionName,
          accessories: item.props.accessories,
          detail: item.props.detail,
          icon: item.props.icon,
          id: item.id,
          keywords: item.props.keywords,
          order: item.order,
          sectionTitle: item.sectionTitle || '',
          subtitle: item.props.subtitle,
          title: item.props.title,
        });
      }).join('|');
      if (snapshot !== lastSnapshotRef.current) {
        lastSnapshotRef.current = snapshot;
        setRegistryVersion((value) => value + 1);
      }
    });
  }, []);

  const registryAPI = useMemo<ListRegistryAPI>(() => ({
    set(id, data) {
      const existing = registryRef.current.get(id);
      if (existing) {
        existing.props = data.props;
        existing.sectionTitle = data.sectionTitle;
        existing.order = data.order;
      } else {
        registryRef.current.set(id, { id, ...data });
      }
      scheduleRegistryUpdate();
    },
    delete(id) {
      if (!registryRef.current.has(id)) return;
      registryRef.current.delete(id);
      scheduleRegistryUpdate();
    },
  }), [scheduleRegistryUpdate]);

  const allItems = useMemo(() => {
    return Array.from(registryRef.current.values()).sort((a, b) => a.order - b.order);
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

export function groupListItems(filteredItems: ItemRegistration[]) {
  const groups: { title?: string; items: { item: ItemRegistration; globalIdx: number }[] }[] = [];
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
