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
const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell, Menu } = electron;

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

async function rebuildExtensions() {
  const installed = getInstalledExtensionNames();
  if (installed.length > 0) {
    console.log(`Checking ${installed.length} installed extensions for rebuilds...`);
    for (const name of installed) {
      // We can't easily check if it needs rebuild here without fs access logic
      // but buildAllCommands is fast enough if we just run it.
      // Or we can rely on buildAllCommands to handle caching?
      // For now, let's just trigger it. It will overwrite existing builds.
      // This ensures we always have fresh builds on startup.
      console.log(`Rebuilding extension: ${name}`);
      try {
        await buildAllCommands(name);
      } catch (e) {
        console.error(`Failed to rebuild ${name}:`, e);
      }
    }
    console.log('Extensions rebuild complete.');
    invalidateCache();
  }
}

app.whenReady().then(async () => {
  // Set a minimal application menu that only keeps essential Edit commands
  // (copy/paste/undo). Without this, Electron's default menu can intercept
  // keyboard shortcuts (⌘D, ⌘T, etc.) at the native level before the
  // renderer's JavaScript keydown handlers see them.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ])
  );

  const settings = loadSettings();

  // Rebuild extensions in background
  rebuildExtensions().catch(console.error);

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
          // Additional metadata for @raycast/api
          extensionName: result.extensionName,
          commandName: result.commandName,
          assetsPath: result.assetsPath,
          supportPath: result.supportPath,
          owner: result.owner,
          preferences: result.preferences,
        };
      } catch (e: any) {
        console.error(`run-extension error for ${extName}/${cmdName}:`, e);
        return { error: e?.message || 'Unknown error' };
      }
    }
  );

  // ─── IPC: Extension APIs (for @raycast/api compatibility) ────────

  // Shell command execution
  ipcMain.handle(
    'exec-command',
    async (
      _event: any,
      command: string,
      args: string[],
      options?: { shell?: boolean | string; input?: string; env?: Record<string, string>; cwd?: string }
    ) => {
      const { spawn, execFile } = require('child_process');

      return new Promise((resolve) => {
        try {
          const spawnOptions: any = {
            shell: options?.shell ?? false,
            env: { ...process.env, ...options?.env },
            cwd: options?.cwd || process.cwd(),
          };

          let proc: any;
          if (options?.shell) {
            // When shell is true, join command and args
            const fullCommand = [command, ...args].join(' ');
            proc = spawn(fullCommand, [], { ...spawnOptions, shell: true });
          } else {
            proc = spawn(command, args, spawnOptions);
          }

          let stdout = '';
          let stderr = '';

          proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          proc.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          if (options?.input && proc.stdin) {
            proc.stdin.write(options.input);
            proc.stdin.end();
          }

          proc.on('close', (code: number | null) => {
            resolve({ stdout, stderr, exitCode: code ?? 0 });
          });

          proc.on('error', (err: Error) => {
            resolve({ stdout, stderr: err.message, exitCode: 1 });
          });

          // Timeout after 30 seconds
          setTimeout(() => {
            try {
              proc.kill();
            } catch {}
            resolve({ stdout, stderr: stderr || 'Command timed out', exitCode: 124 });
          }, 30000);
        } catch (e: any) {
          resolve({ stdout: '', stderr: e?.message || 'Failed to execute command', exitCode: 1 });
        }
      });
    }
  );

  // Get installed applications
  ipcMain.handle('get-applications', async () => {
    const commands = await getAvailableCommands();
    return commands
      .filter((c) => c.category === 'app')
      .map((c) => ({
        name: c.title,
        path: c.path || '',
        bundleId: c.path?.match(/([^/]+)\.app/)?.[1] || undefined,
      }));
  });

  // Get frontmost application
  ipcMain.handle('get-frontmost-application', async () => {
    try {
      const { execSync } = require('child_process');
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp
          set appPath to POSIX path of (file of frontApp as alias)
          set appId to bundle identifier of frontApp
          return appName & "|||" & appPath & "|||" & appId
        end tell
      `;
      const result = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' }).trim();
      const [name, appPath, bundleId] = result.split('|||');
      return { name, path: appPath, bundleId };
    } catch (e) {
      return { name: 'SuperCommand', path: '', bundleId: 'com.supercommand' };
    }
  });

  // Run AppleScript
  ipcMain.handle('run-applescript', async (_event: any, script: string) => {
    try {
      const { execSync } = require('child_process');
      const result = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' });
      return result.trim();
    } catch (e: any) {
      console.error('AppleScript error:', e);
      return '';
    }
  });

  // Move to trash
  ipcMain.handle('move-to-trash', async (_event: any, paths: string[]) => {
    for (const p of paths) {
      try {
        await shell.trashItem(p);
      } catch (e) {
        console.error(`Failed to trash ${p}:`, e);
      }
    }
  });

  // File system operations for extensions
  const fs = require('fs');
  const fsPromises = require('fs/promises');

  ipcMain.handle('read-file', async (_event: any, filePath: string) => {
    try {
      return await fsPromises.readFile(filePath, 'utf-8');
    } catch (e) {
      return '';
    }
  });

  ipcMain.handle('write-file', async (_event: any, filePath: string, content: string) => {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(filePath, content, 'utf-8');
    } catch (e) {
      console.error('write-file error:', e);
    }
  });

  ipcMain.handle('file-exists', async (_event: any, filePath: string) => {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('read-dir', async (_event: any, dirPath: string) => {
    try {
      return await fsPromises.readdir(dirPath);
    } catch {
      return [];
    }
  });

  // Get system appearance
  ipcMain.handle('get-appearance', () => {
    const { nativeTheme } = require('electron');
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });

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
