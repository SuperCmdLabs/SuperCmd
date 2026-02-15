/**
 * raycast-api/menubar-runtime-shared.ts
 * Purpose: Shared types, contexts, counters, click routing, and icon serialization for MenuBarExtra.
 */

import React, { createContext } from 'react';
import { getMenuBarRuntimeDeps } from './menubar-runtime-config';

export type MenuBarActionEvent = {
  type: 'left-click' | 'right-click';
};

export type MenuBarItemProps = {
  title: string;
  alternate?: React.ReactElement<MenuBarItemProps>;
  icon?: any;
  onAction?: (event: MenuBarActionEvent) => void;
  shortcut?: any;
  subtitle?: string;
  tooltip?: string;
};

export type MenuBarSubmenuProps = {
  title: string;
  children?: React.ReactNode;
  icon?: any;
};

export type MenuBarSectionProps = {
  children?: React.ReactNode;
  title?: string;
};

export type MenuBarProps = {
  children?: React.ReactNode;
  icon?: any;
  isLoading?: boolean;
  title?: string;
  tooltip?: string;
};

export type MBItemRegistration = {
  id: string;
  type: 'item' | 'separator' | 'submenu';
  title?: string;
  subtitle?: string;
  icon?: any;
  tooltip?: string;
  onAction?: (event: MenuBarActionEvent) => void;
  alternate?: MBItemRegistration;
  sectionId?: string;
  sectionTitle?: string;
  order: number;
  children?: MBItemRegistration[];
};

export type MBRegistryAPI = {
  register: (item: MBItemRegistration) => void;
  unregister: (id: string) => void;
};

export type SerializedMenuBarIcon = {
  iconPath?: string;
  iconEmoji?: string;
};

export const MBRegistryContext = createContext<MBRegistryAPI | null>(null);
export const MBSectionIdContext = createContext<string | undefined>(undefined);
export const MBSectionTitleContext = createContext<string | undefined>(undefined);
export const MBSubmenuContext = createContext<string | null>(null);

const menuBarActions = new Map<string, Map<string, () => void>>();
let menuBarClickListenerInitialized = false;
let menuBarOrderCounter = 0;
let menuBarSectionOrderCounter = 0;

export function initMenuBarClickListener() {
  if (menuBarClickListenerInitialized) return;
  menuBarClickListenerInitialized = true;
  const electron = (window as any).electron;
  electron?.onMenuBarItemClick?.((data: { extId: string; itemId: string }) => {
    menuBarActions.get(data.extId)?.get(data.itemId)?.();
  });
}

export function setMenuBarActions(extId: string, actions: Map<string, () => void>) {
  menuBarActions.set(extId, actions);
}

export function removeMenuBarActions(extId: string) {
  menuBarActions.delete(extId);
}

export function resetMenuBarOrderCounters() {
  menuBarOrderCounter = 0;
  menuBarSectionOrderCounter = 0;
}

export function nextMenuBarOrder(): number {
  menuBarOrderCounter += 1;
  return menuBarOrderCounter;
}

export function nextMenuBarSectionOrder(): number {
  menuBarSectionOrderCounter += 1;
  return menuBarSectionOrderCounter;
}

function pickMenuBarIconSource(icon: any): string {
  if (!icon || typeof icon !== 'object') return '';
  if (icon.source !== undefined) {
    if (typeof icon.source === 'string') return icon.source;
    if (icon.source && typeof icon.source === 'object') {
      return icon.source.light || icon.source.dark || '';
    }
  }
  return icon.light || icon.dark || '';
}

export function toMenuBarIconPayload(icon: any, assetsPath: string): SerializedMenuBarIcon | undefined {
  if (!icon) return undefined;
  const deps = getMenuBarRuntimeDeps();

  const source = typeof icon === 'object' && icon !== null ? pickMenuBarIconSource(icon) : icon;
  if (typeof source !== 'string' || !source.trim()) return undefined;

  const src = source.trim();
  if (deps.isEmojiOrSymbol(src)) return { iconEmoji: src };

  if (/^file:\/\//.test(src)) {
    try {
      const filePath = decodeURIComponent(new URL(src).pathname);
      if (filePath) return { iconPath: filePath };
    } catch {
      // best-effort
    }
  }

  if (src.startsWith('sc-asset://ext-asset')) {
    const raw = src.slice('sc-asset://ext-asset'.length);
    return { iconPath: decodeURIComponent(raw) };
  }

  if (src.startsWith('/')) return { iconPath: src };
  if (/\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(src) && assetsPath) {
    return { iconPath: `${assetsPath}/${src}` };
  }

  return undefined;
}
