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

  // ─── Extension APIs (for @raycast/api compatibility) ─────────────

  // Execute shell commands
  execCommand: (
    command: string,
    args: string[],
    options?: { shell?: boolean | string; input?: string; env?: Record<string, string>; cwd?: string }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
    ipcRenderer.invoke('exec-command', command, args, options),

  // Get installed applications
  getApplications: (): Promise<Array<{ name: string; path: string; bundleId?: string }>> =>
    ipcRenderer.invoke('get-applications'),

  // Get frontmost application
  getFrontmostApplication: (): Promise<{ name: string; path: string; bundleId?: string } | null> =>
    ipcRenderer.invoke('get-frontmost-application'),

  // Run AppleScript
  runAppleScript: (script: string): Promise<string> =>
    ipcRenderer.invoke('run-applescript', script),

  // Move to trash
  moveToTrash: (paths: string[]): Promise<void> =>
    ipcRenderer.invoke('move-to-trash', paths),

  // Read file (for extensions that need filesystem access)
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('read-file', filePath),

  // Write file
  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('write-file', filePath, content),

  // Check if file exists
  fileExists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('file-exists', filePath),

  // Read directory
  readDir: (dirPath: string): Promise<string[]> =>
    ipcRenderer.invoke('read-dir', dirPath),

  // Get system appearance (dark/light)
  getAppearance: (): Promise<'dark' | 'light'> =>
    ipcRenderer.invoke('get-appearance'),

  // ─── Clipboard Manager ────────────────────────────────────────────
  clipboardGetHistory: (): Promise<any[]> =>
    ipcRenderer.invoke('clipboard-get-history'),
  clipboardSearch: (query: string): Promise<any[]> =>
    ipcRenderer.invoke('clipboard-search', query),
  clipboardClearHistory: (): Promise<void> =>
    ipcRenderer.invoke('clipboard-clear-history'),
  clipboardDeleteItem: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard-delete-item', id),
  clipboardCopyItem: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard-copy-item', id),
  clipboardSetEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('clipboard-set-enabled', enabled),
});
