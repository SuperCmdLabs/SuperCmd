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

export interface ElectronAPI {
  getCommands: () => Promise<CommandInfo[]>;
  executeCommand: (commandId: string) => Promise<boolean>;
  hideWindow: () => Promise<void>;
  onWindowShown: (callback: () => void) => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
