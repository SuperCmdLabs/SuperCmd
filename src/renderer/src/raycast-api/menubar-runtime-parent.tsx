/**
 * raycast-api/menubar-runtime-parent.tsx
 * Purpose: MenuBarExtra parent component and native menu serialization/effects.
 */

import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getMenuBarRuntimeDeps } from './menubar-runtime-config';
import {
  createMenuBarVisiblePayloadHashCache,
  shouldSendMenuBarVisiblePayload,
  type SerializedMenuBarVisiblePayload,
} from './menubar-runtime-payload-cache';
import {
  type MBItemRegistration,
  type MBRegistryAPI,
  MBRegistryContext,
  initMenuBarClickListener,
  removeMenuBarActions,
  resetMenuBarOrderCounters,
  setMenuBarActions,
  toMenuBarIconPayloadAsync,
  type MenuBarActionEvent,
  type MenuBarProps,
} from './menubar-runtime-shared';

type SerializedMenuBarItemsCache = {
  registryVersion: number;
  assetsPath: string;
  items: any[];
  actions: Map<string, () => void>;
};

export function MenuBarExtraComponent({ children, icon, title, tooltip, isLoading }: MenuBarProps) {
  const deps = getMenuBarRuntimeDeps();
  const extInfo = useContext(deps.ExtensionInfoReactContext);
  const extensionContext = deps.getExtensionContext();

  const extId = extInfo.extId || `${extensionContext.extensionName}/${extensionContext.commandName}`;
  const assetsPath = extInfo.assetsPath || extensionContext.assetsPath;
  const isMenuBar = (extInfo.commandMode || extensionContext.commandMode) === 'menu-bar';
  const runtimeCtxRef = useRef<any>({ ...extensionContext });

  const registryRef = useRef(new Map<string, MBItemRegistration>());
  const [registryVersion, setRegistryVersion] = useState(0);
  const pendingRef = useRef(false);
  const serializedItemsCacheRef = useRef<SerializedMenuBarItemsCache | null>(null);
  const visiblePayloadHashCacheRef = useRef(createMenuBarVisiblePayloadHashCache());

  resetMenuBarOrderCounters();

  useEffect(() => {
    if (isMenuBar) initMenuBarClickListener();
  }, [isMenuBar]);

  const registryAPI = useMemo<MBRegistryAPI>(() => ({
    register: (item: MBItemRegistration) => {
      registryRef.current.set(item.id, item);
      if (!pendingRef.current) {
        pendingRef.current = true;
        queueMicrotask(() => {
          pendingRef.current = false;
          setRegistryVersion((v) => v + 1);
        });
      }
    },
    unregister: (id: string) => {
      registryRef.current.delete(id);
      if (!pendingRef.current) {
        pendingRef.current = true;
        queueMicrotask(() => {
          pendingRef.current = false;
          setRegistryVersion((v) => v + 1);
        });
      }
    },
  }), []);

  useEffect(() => {
    if (!isMenuBar) return;
    let cancelled = false;

    const syncMenuBar = async () => {
      const withRuntimeContext = (fn: (event: MenuBarActionEvent) => void): (() => void) => {
        return () => {
          deps.setExtensionContext({ ...runtimeCtxRef.current });
          fn({ type: 'left-click' });
        };
      };

      const serializeItem = async (item: MBItemRegistration): Promise<any> => {
        if (item.type === 'separator') return { type: 'separator' };

        if (item.type === 'submenu') {
          const submenuChildren = await Promise.all((item.children || []).map(serializeItem));
          const iconPayload = await toMenuBarIconPayloadAsync(item.icon, assetsPath);
          return {
            type: 'submenu',
            title: item.title || '',
            ...iconPayload,
            children: submenuChildren,
          };
        }

        if (item.onAction) actions.set(item.id, withRuntimeContext(item.onAction));
        const iconPayload = await toMenuBarIconPayloadAsync(item.icon, assetsPath);
        const serializedItem: any = {
          type: 'item',
          id: item.id,
          title: item.title || '',
          subtitle: item.subtitle,
          tooltip: item.tooltip,
          // Raycast convention: a MenuBarExtra.Item without onAction is a
          // dimmed informational label (e.g. "Click running stopwatch to
          // pause"). Native NSMenu renders `enabled: false` items as greyed
          // out and non-interactive, matching that appearance.
          disabled: !item.onAction,
          ...iconPayload,
        };

        if (item.alternate) {
          if (item.alternate.onAction) {
            actions.set(item.alternate.id, withRuntimeContext(item.alternate.onAction));
          }
          const alternateIconPayload = await toMenuBarIconPayloadAsync(item.alternate.icon, assetsPath);
          serializedItem.alternate = {
            id: item.alternate.id,
            title: item.alternate.title,
            subtitle: item.alternate.subtitle,
            tooltip: item.alternate.tooltip,
            ...alternateIconPayload,
          };
        }

        return serializedItem;
      };

      const cachedItems = serializedItemsCacheRef.current;
      const canReuseSerializedItems =
        cachedItems?.registryVersion === registryVersion &&
        cachedItems.assetsPath === assetsPath;

      let actions: Map<string, () => void>;
      let dividedSerialized: any[];

      if (canReuseSerializedItems) {
        actions = cachedItems.actions;
        dividedSerialized = cachedItems.items;
      } else {
        const allItems = Array.from(registryRef.current.values()).sort((a, b) => a.order - b.order);
        actions = new Map<string, () => void>();
        const serialized: any[] = [];
        let prevSectionId: string | undefined | null = null;

        for (const item of allItems) {
          const sectionChanged = item.sectionId !== prevSectionId;
          if (sectionChanged && item.sectionTitle) {
            // Section title — dimmed, non-interactive label.
            serialized.push({ type: 'item', title: item.sectionTitle, disabled: true });
          } else if (sectionChanged && prevSectionId != null) {
            // Untitled section boundary — plain separator.
            serialized.push({ type: 'separator' });
          }
          prevSectionId = item.sectionId;
          serialized.push(await serializeItem(item));
        }

        // Insert a thin separator wherever a dimmed item is immediately followed
        // by an enabled item. This produces Raycast's layout for both section
        // titles and bare informational labels — title/label on top, divider,
        // then the section's actionable items.
        dividedSerialized = [];
        for (let i = 0; i < serialized.length; i += 1) {
          const cur = serialized[i];
          const next = serialized[i + 1];
          dividedSerialized.push(cur);
          const curIsDimmedItem = cur?.type === 'item' && cur?.disabled === true;
          const nextIsEnabledItem = next?.type === 'item' && next?.disabled !== true;
          if (curIsDimmedItem && nextIsEnabledItem) {
            dividedSerialized.push({ type: 'separator' });
          }
        }

        serializedItemsCacheRef.current = {
          registryVersion,
          assetsPath,
          actions,
          items: dividedSerialized,
        };
      }

      const trayIconPayload =
        (await toMenuBarIconPayloadAsync(icon, assetsPath)) ||
        (extInfo.extensionIconDataUrl ? { iconDataUrl: extInfo.extensionIconDataUrl, iconTemplate: false } : {});

      if (cancelled) return;
      setMenuBarActions(extId, actions as unknown as Map<string, () => void>);
      const payload: SerializedMenuBarVisiblePayload = {
        extId,
        iconPath: trayIconPayload.iconPath,
        iconDataUrl: trayIconPayload.iconDataUrl,
        iconEmoji: trayIconPayload.iconEmoji,
        iconTemplate: trayIconPayload.iconTemplate,
        iconBitmapScale: trayIconPayload.iconBitmapScale,
        fallbackIconDataUrl: extInfo.extensionIconDataUrl || '',
        title: title || '',
        tooltip: tooltip || '',
        items: dividedSerialized,
      };

      if (!shouldSendMenuBarVisiblePayload(visiblePayloadHashCacheRef.current, payload)) {
        return;
      }

      (window as any).electron?.updateMenuBar?.(payload);
    };

    syncMenuBar().catch((error) => {
      console.error('Failed to serialize menu bar payload:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [assetsPath, extId, extInfo.extensionIconDataUrl, icon, isMenuBar, registryVersion, title, tooltip]);

  useEffect(() => {
    return () => {
      removeMenuBarActions(extId);
      if (isMenuBar) {
        (window as any).electron?.removeMenuBar?.(extId);
      }
    };
  }, [extId, isMenuBar]);

  if (isMenuBar) {
    return (
      <MBRegistryContext.Provider value={registryAPI}>
        <div style={{ display: 'none' }}>{children}</div>
      </MBRegistryContext.Provider>
    );
  }

  return (
    <MBRegistryContext.Provider value={registryAPI}>
      <div className="flex flex-col h-full p-2">{children}</div>
    </MBRegistryContext.Provider>
  );
}
