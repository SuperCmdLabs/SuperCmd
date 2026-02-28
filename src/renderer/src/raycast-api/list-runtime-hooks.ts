/**
 * List runtime hooks.
 *
 * Extracted list registry/grouping helpers to keep List container module small.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { ItemRegistration, ListRegistryAPI } from './list-runtime-types';

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
        const title = typeof item.props.title === 'string' ? item.props.title : (item.props.title as any)?.value || '';
        const subtitle = typeof item.props.subtitle === 'string' ? item.props.subtitle : (item.props.subtitle as any)?.value || '';
        const detail = item.props.detail;
        const detailSignature = React.isValidElement(detail)
          ? `${String((detail.type as any)?.name || (detail.type as any)?.displayName || detail.type)}:${typeof (detail.props as any)?.markdown === 'string' ? (detail.props as any).markdown : ''}:${Boolean((detail.props as any)?.isLoading)}`
          : '';
        const actionType = item.props.actions?.type as any;
        const actionName = actionType?.name || actionType?.displayName || typeof actionType || '';
        return `${item.id}:${title}:${subtitle}:${item.sectionTitle || ''}:${actionName}:${detailSignature}`;
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
