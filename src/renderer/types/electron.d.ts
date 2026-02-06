/**
 * Type definitions for the Electron API exposed via preload
 */

export interface CommandInfo {
  id: string;
  title: string;
  keywords?: string[];
  iconDataUrl?: string;
  category: 'app' | 'settings' | 'system' | 'extension';
  path?: string;
}

export interface ExtensionBundle {
  code: string;
  title: string;
  mode: string; // 'view' | 'no-view' | 'menu-bar'
  extName: string;
  cmdName: string;
}

export interface AppSettings {
  globalShortcut: string;
  disabledCommands: string[];
  commandHotkeys: Record<string, string>;
}

export interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  author: string;
  icon: string;
  iconUrl: string;
  categories: string[];
  commands: { name: string; title: string; description: string }[];
}

export interface ElectronAPI {
  // Launcher
  getCommands: () => Promise<CommandInfo[]>;
  executeCommand: (commandId: string) => Promise<boolean>;
  hideWindow: () => Promise<void>;
  onWindowShown: (callback: () => void) => void;

  // Settings
  getSettings: () => Promise<AppSettings>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  getAllCommands: () => Promise<CommandInfo[]>;
  updateGlobalShortcut: (shortcut: string) => Promise<boolean>;
  updateCommandHotkey: (
    commandId: string,
    hotkey: string
  ) => Promise<boolean>;
  toggleCommandEnabled: (
    commandId: string,
    enabled: boolean
  ) => Promise<boolean>;
  openSettings: () => Promise<void>;

  // Extension Runner
  runExtension: (extName: string, cmdName: string) => Promise<ExtensionBundle | null>;

  // Open URL
  openUrl: (url: string) => Promise<boolean>;

  // Store
  getCatalog: (forceRefresh?: boolean) => Promise<CatalogEntry[]>;
  getInstalledExtensionNames: () => Promise<string[]>;
  installExtension: (name: string) => Promise<boolean>;
  uninstallExtension: (name: string) => Promise<boolean>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
