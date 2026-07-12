/**
 * Grid runtime hooks.
 *
 * Extracted registry/grouping logic for the grid runtime container.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { GridItemRegistration, GridRegistryAPI } from './grid-runtime-items';

export interface GridItemGroup {
  key: string;
  title?: string;
  subtitle?: string;
  section?: GridItemRegistration['section'];
  items: { item: GridItemRegistration; globalIdx: number }[];
}

export function useGridRegistry() {
  const registryRef = useRef(new Map<string, GridItemRegistration>());
  const [registryVersion, setRegistryVersion] = useState(0);
  const pendingRef = useRef(false);
  const lastSnapshotRef = useRef('');

  const scheduleRegistryUpdate = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    queueMicrotask(() => {
      pendingRef.current = false;
      const snapshot = Array.from(registryRef.current.values())
        .map((entry) => {
          const actionType = entry.props.actions?.type as any;
          const actionName = actionType?.name || actionType?.displayName || typeof actionType || '';
          const section = entry.section;
          return `${entry.id}:${entry.props.title || ''}:${section?.id || ''}:${section?.title || ''}:${section?.columns || ''}:${section?.aspectRatio || ''}:${section?.fit || ''}:${section?.inset || ''}:${actionName}`;
        })
        .join('|');
      if (snapshot !== lastSnapshotRef.current) {
        lastSnapshotRef.current = snapshot;
        setRegistryVersion((value) => value + 1);
      }
    });
  }, []);

  const registryAPI = useMemo<GridRegistryAPI>(
    () => ({
      set(id, data) {
        const existing = registryRef.current.get(id);
        if (existing) {
          existing.props = data.props;
          existing.section = data.section;
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
    }),
    [scheduleRegistryUpdate],
  );

  const allItems = useMemo(() => {
    return Array.from(registryRef.current.values()).sort((a, b) => a.order - b.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryVersion]);

  return { registryAPI, allItems };
}

export function groupGridItems(filteredItems: GridItemRegistration[]) {
  const groups: GridItemGroup[] = [];
  let currentSectionKey: string | undefined | null = null;
  let globalIndex = 0;

  for (const item of filteredItems) {
    const section = item.section;
    const sectionKey = section?.id || section?.title || '__default_grid_section';
    if (sectionKey !== currentSectionKey || groups.length === 0) {
      currentSectionKey = sectionKey;
      groups.push({
        key: sectionKey,
        title: section?.title,
        subtitle: section?.subtitle,
        section,
        items: [],
      });
    }
    groups[groups.length - 1].items.push({ item, globalIdx: globalIndex++ });
  }

  return groups;
}
