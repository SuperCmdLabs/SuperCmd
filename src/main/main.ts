/**
 * Main Process — SuperCommand
 *
 * Handles:
 * - Global shortcut registration (configurable)
 * - Launcher window lifecycle (create, show, hide, toggle)
 * - Settings window lifecycle
 * - IPC communication with renderer
 * - Command execution
 * - Per-command hotkey registration
 */

import * as path from 'path';
import { getAvailableCommands, executeCommand, invalidateCache } from './commands';
import { loadSettings, saveSettings } from './settings-store';
import type { AppSettings } from './settings-store';
import {
  getCatalog,
  getInstalledExtensionNames,
  installExtension,
  uninstallExtension,
} from './extension-registry';
import { getExtensionBundle, buildAllCommands } from './extension-runner';

const electron = require('electron');
const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } = electron;

// ─── Window Configuration ───────────────────────────────────────────

const WINDOW_WIDTH = 680;
const WINDOW_HEIGHT = 440;

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let settingsWindow: InstanceType<typeof BrowserWindow> | null = null;
let isVisible = false;
let currentShortcut = '';
const registeredHotkeys = new Map<string, string>(); // shortcut → commandId

// ─── URL Helpers ────────────────────────────────────────────────────

function loadWindowUrl(
  win: InstanceType<typeof BrowserWindow>,
  hash = ''
): void {
  if (process.env.NODE_ENV === 'development') {
    win.loadURL(`http://localhost:5173/#${hash}`);
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
      hash,
    });
  }
}

// ─── Launcher Window ────────────────────────────────────────────────

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: Math.floor((screenWidth - WINDOW_WIDTH) / 2),
    y: Math.floor(screenHeight * 0.2),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    vibrancy: 'hud',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  loadWindowUrl(mainWindow, '/');

  // Open DevTools for debugging (detached so it doesn't resize the overlay)
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('blur', () => {
    if (isVisible) {
      hideWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow(): void {
  if (!mainWindow) return;

  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const {
    x: displayX,
    y: displayY,
    width: displayWidth,
    height: displayHeight,
  } = currentDisplay.workArea;

  const windowX = displayX + Math.floor((displayWidth - WINDOW_WIDTH) / 2);
  const windowY = displayY + Math.floor(displayHeight * 0.2);

  mainWindow.setBounds({
    x: windowX,
    y: windowY,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  });

  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  isVisible = true;

  mainWindow.webContents.send('window-shown');
}

function hideWindow(): void {
  if (!mainWindow) return;
  mainWindow.hide();
  isVisible = false;
}

function toggleWindow(): void {
  if (!mainWindow) {
    createWindow();
    mainWindow?.once('ready-to-show', () => {
      showWindow();
    });
    return;
  }

  if (isVisible) {
    hideWindow();
  } else {
    showWindow();
  }
}

// ─── Settings Window ────────────────────────────────────────────────

function openSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  if (process.platform === 'darwin') {
    app.dock.show();
  }

  settingsWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 700,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1a1a1c',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  loadWindowUrl(settingsWindow, '/settings');

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // Hide dock again when settings is closed
    if (process.platform === 'darwin') {
      app.dock.hide();
    }
  });
}

// ─── Shortcut Management ────────────────────────────────────────────

function registerGlobalShortcut(shortcut: string): boolean {
  // Unregister the previous global shortcut
  if (currentShortcut) {
    try {
      globalShortcut.unregister(currentShortcut);
    } catch {}
  }

  try {
    const success = globalShortcut.register(shortcut, () => {
      toggleWindow();
    });
    if (success) {
      currentShortcut = shortcut;
      console.log(`Global shortcut registered: ${shortcut}`);
      return true;
    } else {
      console.error(`Failed to register shortcut: ${shortcut}`);
      // Re-register old one
      if (currentShortcut && currentShortcut !== shortcut) {
        try {
          globalShortcut.register(currentShortcut, () => toggleWindow());
        } catch {}
      }
      return false;
    }
  } catch (e) {
    console.error(`Error registering shortcut: ${e}`);
    return false;
  }
}

function registerCommandHotkeys(hotkeys: Record<string, string>): void {
  // Unregister all existing command hotkeys
  for (const [shortcut] of registeredHotkeys) {
    try {
      globalShortcut.unregister(shortcut);
    } catch {}
  }
  registeredHotkeys.clear();

  for (const [commandId, shortcut] of Object.entries(hotkeys)) {
    if (!shortcut) continue;
    try {
      const success = globalShortcut.register(shortcut, async () => {
        await executeCommand(commandId);
      });
      if (success) {
        registeredHotkeys.set(shortcut, commandId);
      }
    } catch {}
  }
}

// ─── App Initialization ─────────────────────────────────────────────

app.whenReady().then(() => {
  const settings = loadSettings();

  // ─── IPC: Launcher ──────────────────────────────────────────────

  ipcMain.handle('get-commands', async () => {
    const s = loadSettings();
    const commands = await getAvailableCommands();
    return commands.filter((c) => !s.disabledCommands.includes(c.id));
  });

  ipcMain.handle(
    'execute-command',
    async (_event: any, commandId: string) => {
      if (commandId === 'system-open-settings') {
        openSettingsWindow();
        hideWindow();
        return true;
      }
      const success = await executeCommand(commandId);
      if (success) {
        setTimeout(() => hideWindow(), 50);
      }
      return success;
    }
  );

  ipcMain.handle('hide-window', () => {
    hideWindow();
  });

  // ─── IPC: Settings ──────────────────────────────────────────────

  ipcMain.handle('get-settings', () => {
    return loadSettings();
  });

  ipcMain.handle(
    'save-settings',
    (_event: any, patch: Partial<AppSettings>) => {
      return saveSettings(patch);
    }
  );

  ipcMain.handle('get-all-commands', async () => {
    // Return ALL commands (ignoring disabled filter) for the settings page
    return await getAvailableCommands();
  });

  ipcMain.handle(
    'update-global-shortcut',
    (_event: any, newShortcut: string) => {
      const success = registerGlobalShortcut(newShortcut);
      if (success) {
        saveSettings({ globalShortcut: newShortcut });
      }
      return success;
    }
  );

  ipcMain.handle(
    'update-command-hotkey',
    async (_event: any, commandId: string, hotkey: string) => {
      const s = loadSettings();
      const hotkeys = { ...s.commandHotkeys };

      // Unregister old hotkey for this command
      const oldHotkey = hotkeys[commandId];
      if (oldHotkey) {
        try {
          globalShortcut.unregister(oldHotkey);
          registeredHotkeys.delete(oldHotkey);
        } catch {}
      }

      if (hotkey) {
        hotkeys[commandId] = hotkey;
        // Register the new one
        try {
          const success = globalShortcut.register(hotkey, async () => {
            await executeCommand(commandId);
          });
          if (success) {
            registeredHotkeys.set(hotkey, commandId);
          }
        } catch {}
      } else {
        delete hotkeys[commandId];
      }

      saveSettings({ commandHotkeys: hotkeys });
      return true;
    }
  );

  ipcMain.handle(
    'toggle-command-enabled',
    (_event: any, commandId: string, enabled: boolean) => {
      const s = loadSettings();
      let disabled = [...s.disabledCommands];

      if (enabled) {
        disabled = disabled.filter((id) => id !== commandId);
      } else {
        if (!disabled.includes(commandId)) {
          disabled.push(commandId);
        }
      }

      saveSettings({ disabledCommands: disabled });
      return true;
    }
  );

  ipcMain.handle('open-settings', () => {
    openSettingsWindow();
  });

  // ─── IPC: Open URL (for extensions) ─────────────────────────────

  ipcMain.handle('open-url', async (_event: any, url: string) => {
    if (!url) return false;
    // Ignore Raycast-internal deep links
    if (url.startsWith('raycast://')) {
      console.log(`Ignoring Raycast deep link: ${url}`);
      return true;
    }
    try {
      await shell.openExternal(url);
      return true;
    } catch (e) {
      console.error(`Failed to open URL: ${url}`, e);
      return false;
    }
  });

  // ─── IPC: Extension Runner ───────────────────────────────────────

  ipcMain.handle(
    'run-extension',
    (_event: any, extName: string, cmdName: string) => {
      try {
        // Just read the pre-built bundle (built at install time)
        const result = getExtensionBundle(extName, cmdName);
        if (!result) {
          return { error: `No pre-built bundle for ${extName}/${cmdName}. Try reinstalling the extension.` };
        }
        return {
          code: result.code,
          title: result.title,
          mode: result.mode,
          extName,
          cmdName,
        };
      } catch (e: any) {
        console.error(`run-extension error for ${extName}/${cmdName}:`, e);
        return { error: e?.message || 'Unknown error' };
      }
    }
  );

  // ─── IPC: Store (Community Extensions) ──────────────────────────

  ipcMain.handle(
    'get-catalog',
    async (_event: any, forceRefresh?: boolean) => {
      return await getCatalog(forceRefresh ?? false);
    }
  );

  ipcMain.handle('get-installed-extension-names', () => {
    return getInstalledExtensionNames();
  });

  ipcMain.handle(
    'install-extension',
    async (_event: any, name: string) => {
      const success = await installExtension(name);
      if (success) {
        // Invalidate command cache so new extensions appear in the launcher
        invalidateCache();
      }
      return success;
    }
  );

  ipcMain.handle(
    'uninstall-extension',
    async (_event: any, name: string) => {
      const success = await uninstallExtension(name);
      if (success) {
        // Invalidate command cache so removed extensions disappear
        invalidateCache();
      }
      return success;
    }
  );

  // ─── Window + Shortcuts ─────────────────────────────────────────

  createWindow();
  registerGlobalShortcut(settings.globalShortcut);
  registerCommandHotkeys(settings.commandHotkeys);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
