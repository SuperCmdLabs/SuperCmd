/**
 * raycast-api/menubar-runtime-config.ts
 * Purpose: Runtime dependency injection for MenuBarExtra components.
 */

import React from 'react';

export type MenuBarExtensionInfo = {
  extId: string;
  assetsPath: string;
  commandMode: 'view' | 'no-view' | 'menu-bar';
  extensionDisplayName?: string;
  extensionIconDataUrl?: string;
};

export type MenuBarExtensionContext = {
  extensionName: string;
  commandName: string;
  assetsPath: string;
  commandMode: 'view' | 'no-view' | 'menu-bar';
};

export type MenuBarRuntimeDeps = {
  ExtensionInfoReactContext: React.Context<MenuBarExtensionInfo>;
  getExtensionContext: () => MenuBarExtensionContext;
  setExtensionContext: (ctx: any) => void;
  isEmojiOrSymbol: (value: string) => boolean;
};

const fallbackContext = React.createContext<MenuBarExtensionInfo>({
  extId: '',
  assetsPath: '',
  commandMode: 'view',
  extensionDisplayName: '',
  extensionIconDataUrl: '',
});

let deps: MenuBarRuntimeDeps = {
  ExtensionInfoReactContext: fallbackContext,
  getExtensionContext: () => ({ extensionName: '', commandName: '', assetsPath: '', commandMode: 'view' }),
  setExtensionContext: () => {},
  isEmojiOrSymbol: () => false,
};

export function configureMenuBarRuntime(nextDeps: Partial<MenuBarRuntimeDeps>) {
  deps = {
    ...deps,
    ...nextDeps,
  };
}

export function getMenuBarRuntimeDeps(): MenuBarRuntimeDeps {
  return deps;
}
