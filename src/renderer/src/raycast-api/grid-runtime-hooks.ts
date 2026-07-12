/**
 * Grid runtime hooks.
 *
 * Extracted registry/grouping logic for the grid runtime container.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { GridItemRegistration, GridRegistryAPI } from './grid-runtime-items';

export interface GridItemGroup {
  key: string;
  title?: string;
  subtitle?: string;
  section?: GridItemRegistration['section'];
  items: { item: GridItemRegistration; globalIdx: number }[];
}

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

function buildImageLikeSignature(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value) || React.isValidElement(value)) {
    return buildValueSignature(value);
  }
  const image = value as Record<string, unknown>;
  return [
    buildValueSignature(image.source),
    buildValueSignature(image.value),
    buildValueSignature(image.fileIcon),
    buildValueSignature(image.light),
    buildValueSignature(image.dark),
    buildValueSignature(image.color),
    buildValueSignature(image.tintColor),
    buildValueSignature(image.mask),
    buildValueSignature(image.fallback),
  ].join('\u001e');
}

function buildGridContentSignature(content: unknown): string {
  return buildImageLikeSignature(content);
}

function buildGridAccessorySignature(accessory: unknown): string {
  if (!accessory || typeof accessory !== 'object' || Array.isArray(accessory) || React.isValidElement(accessory)) {
    return buildValueSignature(accessory);
  }
  const value = accessory as Record<string, unknown>;
  return [
    buildImageLikeSignature(value.icon),
    buildValueSignature(value.tooltip),
    buildValueSignature(value.text),
    buildValueSignature(value.tag),
  ].join('\u001e');
}

function buildQuickLookSignature(quickLook: GridItemRegistration['props']['quickLook']): string {
  if (!quickLook) return '';
  return `${quickLook.name || ''}\u001e${quickLook.path || ''}`;
}

export function buildGridItemVisibleSignature(entry: GridItemRegistration): string {
  const props = entry.props;
  const section = entry.section;
  return [
    entry.id,
    String(entry.order),
    section?.id || '',
    section?.title || '',
    section?.subtitle || '',
    section?.columns || '',
    section?.aspectRatio || '',
    section?.fit || '',
    section?.inset || '',
    buildValueSignature(props.id),
    buildValueSignature(props.title),
    buildValueSignature(props.subtitle),
    buildGridContentSignature(props.content),
    buildGridAccessorySignature(props.accessory),
    props.keywords?.map((keyword) => JSON.stringify(keyword)).join('\u001d') || '',
    buildQuickLookSignature(props.quickLook),
    buildActionTypeSignature(props.actions),
  ].join('\u001f');
}

export function useGridRegistry() {
  const registryRef = useRef(new Map<string, GridItemRegistration>());
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

  const registryAPI = useMemo<GridRegistryAPI>(
    () => ({
      set(id, data) {
        const existing = registryRef.current.get(id);
        if (existing) {
          const propsChanged = existing.props !== data.props;
          const sectionChanged = existing.section !== data.section;
          const orderChanged = existing.order !== data.order;
          existing.props = data.props;
          existing.section = data.section;
          existing.order = data.order;
          if (!propsChanged && !sectionChanged && !orderChanged) return;

          const nextSignature = buildGridItemVisibleSignature(existing);
          if (visibleSignatureRef.current.get(id) === nextSignature) return;
          visibleSignatureRef.current.set(id, nextSignature);
        } else {
          const entry = { id, ...data };
          registryRef.current.set(id, entry);
          visibleSignatureRef.current.set(id, buildGridItemVisibleSignature(entry));
        }
        scheduleRegistryUpdate();
      },
      delete(id) {
        if (!registryRef.current.has(id)) return;
        registryRef.current.delete(id);
        visibleSignatureRef.current.delete(id);
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
