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
  // Extended metadata for Raycast API compatibility
  extensionName?: string;
  commandName?: string;
  assetsPath?: string;
  supportPath?: string;
  owner?: string;
  preferences?: Record<string, any>;
  error?: string;
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

export interface ClipboardItem {
  id: string;
  type: 'text' | 'image' | 'url' | 'file';
  content: string;
  preview?: string;
  timestamp: number;
  source?: string;
  metadata?: {
    width?: number;
    height?: number;
    size?: number;
    format?: string;
    filename?: string;
  };
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

  // Extension APIs (for @raycast/api compatibility)
  execCommand: (
    command: string,
    args: string[],
    options?: { shell?: boolean | string; input?: string; env?: Record<string, string>; cwd?: string }
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  getApplications: () => Promise<Array<{ name: string; path: string; bundleId?: string }>>;
  getFrontmostApplication: () => Promise<{ name: string; path: string; bundleId?: string } | null>;
  runAppleScript: (script: string) => Promise<string>;
  moveToTrash: (paths: string[]) => Promise<void>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  fileExists: (filePath: string) => Promise<boolean>;
  readDir: (dirPath: string) => Promise<string[]>;
  getAppearance: () => Promise<'dark' | 'light'>;

  // Clipboard Manager
  clipboardGetHistory: () => Promise<ClipboardItem[]>;
  clipboardSearch: (query: string) => Promise<ClipboardItem[]>;
  clipboardClearHistory: () => Promise<void>;
  clipboardDeleteItem: (id: string) => Promise<boolean>;
  clipboardCopyItem: (id: string) => Promise<boolean>;
  clipboardPasteItem: (id: string) => Promise<boolean>;
  clipboardSetEnabled: (enabled: boolean) => Promise<void>;

  // Native helpers
  nativePickColor: () => Promise<{ red: number; green: number; blue: number; alpha: number } | null>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
