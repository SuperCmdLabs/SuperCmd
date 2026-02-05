/**
 * Preload Script
 * 
 * Exposes a secure API to the renderer process via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

interface CommandInfo {
  id: string;
  title: string;
  keywords?: string[];
  iconDataUrl?: string;
  category: 'app' | 'settings' | 'system';
  path?: string;
}

contextBridge.exposeInMainWorld('electron', {
  getCommands: (): Promise<CommandInfo[]> => ipcRenderer.invoke('get-commands'),
  executeCommand: (commandId: string): Promise<boolean> => 
    ipcRenderer.invoke('execute-command', commandId),
  hideWindow: (): Promise<void> => ipcRenderer.invoke('hide-window'),
  onWindowShown: (callback: () => void) => {
    ipcRenderer.on('window-shown', () => callback());
  },
});
