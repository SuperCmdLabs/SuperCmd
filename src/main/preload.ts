/**
 * Preload Script
 *
 * Exposes a secure API to the renderer process via contextBridge.
 * Used by both the launcher window and the settings window.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  // ─── Launcher ───────────────────────────────────────────────────
  getCommands: (): Promise<any[]> => ipcRenderer.invoke('get-commands'),
  executeCommand: (commandId: string): Promise<boolean> =>
    ipcRenderer.invoke('execute-command', commandId),
  hideWindow: (): Promise<void> => ipcRenderer.invoke('hide-window'),
  onWindowShown: (callback: () => void) => {
    ipcRenderer.on('window-shown', () => callback());
  },

  // ─── Settings ───────────────────────────────────────────────────
  getSettings: (): Promise<any> => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch: any): Promise<any> =>
    ipcRenderer.invoke('save-settings', patch),
  getAllCommands: (): Promise<any[]> =>
    ipcRenderer.invoke('get-all-commands'),
  updateGlobalShortcut: (shortcut: string): Promise<boolean> =>
    ipcRenderer.invoke('update-global-shortcut', shortcut),
  updateCommandHotkey: (commandId: string, hotkey: string): Promise<boolean> =>
    ipcRenderer.invoke('update-command-hotkey', commandId, hotkey),
  toggleCommandEnabled: (
    commandId: string,
    enabled: boolean
  ): Promise<boolean> =>
    ipcRenderer.invoke('toggle-command-enabled', commandId, enabled),
  openSettings: (): Promise<void> => ipcRenderer.invoke('open-settings'),

  // ─── Extension Runner ────────────────────────────────────────────
  runExtension: (extName: string, cmdName: string): Promise<any> =>
    ipcRenderer.invoke('run-extension', extName, cmdName),

  // ─── Open URL (for extensions) ────────────────────────────────────
  openUrl: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('open-url', url),

  // ─── Store ────────────────────────────────────────────────────
  getCatalog: (forceRefresh?: boolean): Promise<any[]> =>
    ipcRenderer.invoke('get-catalog', forceRefresh),
  getInstalledExtensionNames: (): Promise<string[]> =>
    ipcRenderer.invoke('get-installed-extension-names'),
  installExtension: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('install-extension', name),
  uninstallExtension: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('uninstall-extension', name),
});
