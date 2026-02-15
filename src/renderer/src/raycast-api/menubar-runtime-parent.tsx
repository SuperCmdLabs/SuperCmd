/**
 * raycast-api/menubar-runtime-parent.tsx
 * Purpose: MenuBarExtra parent component and native menu serialization/effects.
 */

import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getMenuBarRuntimeDeps } from './menubar-runtime-config';
import {
  type MBItemRegistration,
  type MBRegistryAPI,
  MBRegistryContext,
  initMenuBarClickListener,
  removeMenuBarActions,
  resetMenuBarOrderCounters,
  setMenuBarActions,
  toMenuBarIconPayload,
  type MenuBarActionEvent,
  type MenuBarProps,
} from './menubar-runtime-shared';

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

    const allItems = Array.from(registryRef.current.values()).sort((a, b) => a.order - b.order);
    const actions = new Map<string, (event: MenuBarActionEvent) => void>();
    const serialized: any[] = [];
    let prevSectionId: string | undefined | null = null;

    const withRuntimeContext = (fn: (event: MenuBarActionEvent) => void): (() => void) => {
      return () => {
        deps.setExtensionContext({ ...runtimeCtxRef.current });
        fn({ type: 'left-click' });
      };
    };

    const serializeItem = (item: MBItemRegistration): any => {
      if (item.type === 'separator') return { type: 'separator' };

      if (item.type === 'submenu') {
        const submenuChildren = (item.children || []).map(serializeItem);
        const iconPayload = toMenuBarIconPayload(item.icon, assetsPath);
        return {
          type: 'submenu',
          title: item.title || '',
          ...iconPayload,
          icon: item.icon,
          children: submenuChildren,
        };
      }

      if (item.onAction) actions.set(item.id, withRuntimeContext(item.onAction));
      const iconPayload = toMenuBarIconPayload(item.icon, assetsPath);
      const serializedItem: any = {
        type: 'item',
        id: item.id,
        title: item.title || '',
        subtitle: item.subtitle,
        tooltip: item.tooltip,
        ...iconPayload,
      };

      if (item.alternate) {
        if (item.alternate.onAction) {
          actions.set(item.alternate.id, withRuntimeContext(item.alternate.onAction));
        }
        const alternateIconPayload = toMenuBarIconPayload(item.alternate.icon, assetsPath);
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

    for (const item of allItems) {
      const sectionChanged = item.sectionId !== prevSectionId;
      if (sectionChanged && prevSectionId != null) {
        serialized.push({ type: 'separator' });
      }
      if (sectionChanged && item.sectionTitle) {
        serialized.push({ type: 'item', title: item.sectionTitle, disabled: true });
      }
      prevSectionId = item.sectionId;
      serialized.push(serializeItem(item));
    }

    setMenuBarActions(extId, actions as unknown as Map<string, () => void>);

    const trayIconPayload = toMenuBarIconPayload(icon, assetsPath) || {};
    (window as any).electron?.updateMenuBar?.({
      extId,
      iconPath: trayIconPayload.iconPath,
      iconEmoji: trayIconPayload.iconEmoji,
      title: title || '',
      tooltip: tooltip || '',
      items: serialized,
    });
  }, [assetsPath, extId, icon, isMenuBar, registryVersion, title, tooltip]);

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
