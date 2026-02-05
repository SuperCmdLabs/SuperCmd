/**
 * Type definitions for the Electron API exposed via preload
 */

export interface CommandInfo {
  id: string;
  title: string;
  keywords?: string[];
  iconDataUrl?: string;
  category: 'app' | 'settings' | 'system';
  path?: string;
}

export interface AppSettings {
  globalShortcut: string;
  disabledCommands: string[];
  commandHotkeys: Record<string, string>;
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
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
