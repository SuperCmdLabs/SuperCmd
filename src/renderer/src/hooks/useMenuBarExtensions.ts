/**
 * useMenuBarExtensions.ts
 *
 * Manages the lifecycle of Raycast-compatible menu-bar and background no-view extensions.
 *
 * Menu-bar extensions do NOT auto-mount on app startup. The user must explicitly run
 * each menu-bar command from the launcher to activate it for the current session.
 * This avoids running extensions with render-phase side effects (e.g. 1-click-confetti)
 * on every app launch.
 *
 * - menuBarExtensions[]: currently mounted menu-bar runners (unique key per entry so
 *   React remounts when the extension reloads)
 * - backgroundNoViewRuns[]: queued no-view extension bundles to execute in the background
 * - upsertMenuBarExtension(): add or update an entry; { remount: true } forces a full remount
 * - hideMenuBarExtension(): remove from UI
 * - remountMenuBarExtensionsForExtension(): remounts all runners for an extension name
 *   (debounced 200 ms) — triggered by sc-extension-storage-changed events
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ExtensionBundle } from '../../types/electron';

export interface MenuBarEntry {
  key: string;
  bundle: ExtensionBundle;
}

export interface BackgroundNoViewRun {
  runId: string;
  bundle: ExtensionBundle;
  launchType: 'userInitiated' | 'background';
  /** When true, execution status is mirrored to the system status-bar badge. */
  reportStatus?: boolean;
}

export interface UseMenuBarExtensionsReturn {
  menuBarExtensions: MenuBarEntry[];
  backgroundNoViewRuns: BackgroundNoViewRun[];
  setBackgroundNoViewRuns: React.Dispatch<React.SetStateAction<BackgroundNoViewRun[]>>;
  getMenuBarIdentity: (bundle: Partial<ExtensionBundle>) => {
    extName: string;
    cmdName: string;
    extId: string;
  };
  isMenuBarExtensionMounted: (bundle: Partial<ExtensionBundle>) => boolean;
  hideMenuBarExtension: (bundle: Partial<ExtensionBundle>) => void;
  upsertMenuBarExtension: (bundle: ExtensionBundle, options?: { remount?: boolean }) => void;
  remountMenuBarExtensionsForExtension: (extensionName: string) => void;
}

export function useMenuBarExtensions(): UseMenuBarExtensionsReturn {
  const [menuBarExtensions, setMenuBarExtensions] = useState<MenuBarEntry[]>([]);
  const [backgroundNoViewRuns, setBackgroundNoViewRuns] = useState<BackgroundNoViewRun[]>([]);
  const menuBarRemountTimestampsRef = useRef<Record<string, number>>({});

  const getMenuBarIdentity = useCallback((bundle: Partial<ExtensionBundle>) => {
    const extName = bundle.extName || bundle.extensionName || '';
    const cmdName = bundle.cmdName || bundle.commandName || '';
    const extId = `${bundle.extensionName || bundle.extName || ''}/${bundle.commandName || bundle.cmdName || ''}`;
    return { extName, cmdName, extId };
  }, []);

  const isMenuBarExtensionMounted = useCallback((bundle: Partial<ExtensionBundle>) => {
    const { extName, cmdName } = getMenuBarIdentity(bundle);
    if (!extName || !cmdName) return false;
    return menuBarExtensions.some(
      (entry) =>
        (entry.bundle.extName || entry.bundle.extensionName) === extName &&
        (entry.bundle.cmdName || entry.bundle.commandName) === cmdName
    );
  }, [menuBarExtensions, getMenuBarIdentity]);

  const hideMenuBarExtension = useCallback((bundle: Partial<ExtensionBundle>) => {
    const { extName, cmdName, extId } = getMenuBarIdentity(bundle);
    if (!extName || !cmdName) return;
    setMenuBarExtensions((prev) =>
      prev.filter(
        (entry) =>
          (entry.bundle.extName || entry.bundle.extensionName) !== extName ||
          (entry.bundle.cmdName || entry.bundle.commandName) !== cmdName
      )
    );
    window.electron.removeMenuBar?.(extId);
  }, [getMenuBarIdentity]);

  const upsertMenuBarExtension = useCallback((bundle: ExtensionBundle, options?: { remount?: boolean }) => {
    const remount = Boolean(options?.remount);
    const { extName, cmdName } = getMenuBarIdentity(bundle);
    if (!extName || !cmdName) return;
    setMenuBarExtensions((prev) => {
      const idx = prev.findIndex(
        (entry) =>
          (entry.bundle.extName || entry.bundle.extensionName) === extName &&
          (entry.bundle.cmdName || entry.bundle.commandName) === cmdName
      );
      if (idx === -1) {
        return [...prev, { key: `${extName}:${cmdName}:${Date.now()}`, bundle }];
      }
      const next = [...prev];
      next[idx] = {
        key: remount ? `${extName}:${cmdName}:${Date.now()}` : next[idx].key,
        bundle,
      };
      return next;
    });
  }, [getMenuBarIdentity]);

  const remountMenuBarExtensionsForExtension = useCallback((extensionName: string) => {
    const normalized = (extensionName || '').trim();
    if (!normalized) return;
    const now = Date.now();
    const lastTs = menuBarRemountTimestampsRef.current[normalized] || 0;
    if (now - lastTs < 200) return;
    menuBarRemountTimestampsRef.current[normalized] = now;
    setMenuBarExtensions((prev) => {
      let changed = false;
      const next = prev.map((entry) => {
        const entryExt = (entry.bundle.extName || entry.bundle.extensionName || '').trim();
        if (!entryExt || entryExt !== normalized) return entry;
        changed = true;
        const cmdName = entry.bundle.cmdName || entry.bundle.commandName || '';
        return {
          key: `${normalized}:${cmdName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          bundle: entry.bundle,
        };
      });
      return changed ? next : prev;
    });
  }, []);

  // Note: no auto-mount on app startup. Menu-bar extensions are per-session — the
  // user must explicitly run each command from the launcher to mount it.

  // LocalStorage changes should refresh menu-bar commands for the same extension.
  // This matches Raycast behavior where menu-bar commands observe state changes quickly.
  useEffect(() => {
    const onStorageChanged = (event: Event) => {
      const custom = event as CustomEvent<{ extensionName?: string }>;
      const extensionName = (custom.detail?.extensionName || '').trim();
      if (!extensionName) return;
      remountMenuBarExtensionsForExtension(extensionName);
    };
    window.addEventListener('sc-extension-storage-changed', onStorageChanged as EventListener);
    return () => {
      window.removeEventListener('sc-extension-storage-changed', onStorageChanged as EventListener);
    };
  }, [remountMenuBarExtensionsForExtension]);

  return {
    menuBarExtensions,
    backgroundNoViewRuns,
    setBackgroundNoViewRuns,
    getMenuBarIdentity,
    isMenuBarExtensionMounted,
    hideMenuBarExtension,
    upsertMenuBarExtension,
    remountMenuBarExtensionsForExtension,
  };
}
