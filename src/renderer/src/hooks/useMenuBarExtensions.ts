import { useState, useRef, useCallback, useEffect } from 'react';
import type { ExtensionBundle } from '../../types/electron';
import { HIDDEN_MENUBAR_CMDS_KEY } from '../utils/constants';
import {
  readJsonObject,
  writeJsonObject,
  getMenuBarCommandKey,
  hydrateExtensionBundlePreferences,
  getMissingRequiredPreferences,
  getMissingRequiredArguments,
} from '../utils/extension-preferences';

export interface MenuBarEntry {
  key: string;
  bundle: ExtensionBundle;
}

export interface BackgroundNoViewRun {
  runId: string;
  bundle: ExtensionBundle;
}

export interface UseMenuBarExtensionsReturn {
  menuBarExtensions: MenuBarEntry[];
  backgroundNoViewRuns: BackgroundNoViewRun[];
  setBackgroundNoViewRuns: React.Dispatch<React.SetStateAction<BackgroundNoViewRun[]>>;
  getMenuBarIdentity: (bundle: Partial<ExtensionBundle>) => {
    extName: string;
    cmdName: string;
    extId: string;
    storageKey: string;
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
    const storageKey = getMenuBarCommandKey(extName, cmdName);
    return { extName, cmdName, extId, storageKey };
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
    const { extName, cmdName, extId, storageKey } = getMenuBarIdentity(bundle);
    if (!extName || !cmdName) return;
    setMenuBarExtensions((prev) =>
      prev.filter(
        (entry) =>
          (entry.bundle.extName || entry.bundle.extensionName) !== extName ||
          (entry.bundle.cmdName || entry.bundle.commandName) !== cmdName
      )
    );
    const hidden = readJsonObject(HIDDEN_MENUBAR_CMDS_KEY);
    hidden[storageKey] = true;
    writeJsonObject(HIDDEN_MENUBAR_CMDS_KEY, hidden);
    window.electron.removeMenuBar?.(extId);
  }, [getMenuBarIdentity]);

  const upsertMenuBarExtension = useCallback((bundle: ExtensionBundle, options?: { remount?: boolean }) => {
    const remount = Boolean(options?.remount);
    const { extName, cmdName, storageKey } = getMenuBarIdentity(bundle);
    if (!extName || !cmdName) return;
    const hidden = readJsonObject(HIDDEN_MENUBAR_CMDS_KEY);
    if (hidden[storageKey]) {
      delete hidden[storageKey];
      writeJsonObject(HIDDEN_MENUBAR_CMDS_KEY, hidden);
    }
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

  // Load and run menu-bar extensions in the background
  useEffect(() => {
    (window as any).electron?.getMenuBarExtensions?.().then((exts: any[]) => {
      if (exts && exts.length > 0) {
        console.log(`[MenuBar] Loading ${exts.length} menu-bar extension(s)`);
        const hidden = readJsonObject(HIDDEN_MENUBAR_CMDS_KEY);
        const runnable = exts
          .map((ext) => hydrateExtensionBundlePreferences(ext))
          .filter((ext) => {
            const missingPrefs = getMissingRequiredPreferences(ext);
            const missingArgs = getMissingRequiredArguments(ext);
            return missingPrefs.length === 0 && missingArgs.length === 0;
          })
          .filter((bundle) => {
            const extName = bundle.extName || bundle.extensionName || '';
            const cmdName = bundle.cmdName || bundle.commandName || '';
            const storageKey = getMenuBarCommandKey(extName, cmdName);
            return !hidden[storageKey];
          })
          .map((bundle) => ({
            key: `${bundle.extName || bundle.extensionName}:${bundle.cmdName || bundle.commandName}:initial`,
            bundle,
          }));
        setMenuBarExtensions(runnable);
      }
    }).catch((err: any) => {
      console.error('[MenuBar] Failed to load menu-bar extensions:', err);
    });
  }, []);

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
