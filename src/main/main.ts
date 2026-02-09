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
import { streamAI, isAIAvailable } from './ai-provider';
import {
  getCatalog,
  getExtensionScreenshotUrls,
  getInstalledExtensionNames,
  installExtension,
  uninstallExtension,
} from './extension-registry';
import { getExtensionBundle, buildAllCommands, discoverInstalledExtensionCommands } from './extension-runner';
import {
  startClipboardMonitor,
  stopClipboardMonitor,
  getClipboardHistory,
  clearClipboardHistory,
  deleteClipboardItem,
  copyItemToClipboard,
  searchClipboardHistory,
  setClipboardMonitorEnabled,
} from './clipboard-manager';
import {
  initSnippetStore,
  getAllSnippets,
  searchSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  deleteAllSnippets,
  duplicateSnippet,
  togglePinSnippet,
  getSnippetByKeyword,
  copySnippetToClipboard,
  copySnippetToClipboardResolved,
  getSnippetDynamicFieldsById,
  renderSnippetById,
  importSnippetsFromFile,
  exportSnippetsToFile,
} from './snippet-store';

const electron = require('electron');
const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell, Menu, Tray, nativeImage, protocol, net, dialog, clipboard: systemClipboard } = electron;

// ─── Window Configuration ───────────────────────────────────────────

const WINDOW_WIDTH = 860;
const WINDOW_HEIGHT = 540;

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let settingsWindow: InstanceType<typeof BrowserWindow> | null = null;
let extensionStoreWindow: InstanceType<typeof BrowserWindow> | null = null;
let isVisible = false;
let suppressBlurHide = false; // When true, blur won't hide the window (used during file dialogs)
let currentShortcut = '';
let lastFrontmostApp: { name: string; path: string; bundleId?: string } | null = null;
const registeredHotkeys = new Map<string, string>(); // shortcut → commandId
const activeAIRequests = new Map<string, AbortController>(); // requestId → controller
const pendingOAuthCallbackUrls: string[] = [];
let snippetExpanderProcess: any = null;
let snippetExpanderStdoutBuffer = '';

function handleOAuthCallbackUrl(rawUrl: string): void {
  if (!rawUrl) return;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'supercommand:') return;
    const isOAuthCallback =
      (parsed.hostname === 'oauth' && parsed.pathname === '/callback') ||
      parsed.pathname === '/oauth/callback';
    if (!isOAuthCallback) return;

    if (!mainWindow) {
      pendingOAuthCallbackUrls.push(rawUrl);
      return;
    }

    showWindow();
    mainWindow.webContents.send('oauth-callback', rawUrl);
  } catch {
    // ignore invalid URLs
  }
}

app.on('open-url', (event: any, url: string) => {
  event.preventDefault();
  handleOAuthCallbackUrl(url);
});

// ─── Menu Bar (Tray) Management ─────────────────────────────────────

const menuBarTrays = new Map<string, InstanceType<typeof Tray>>();

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
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    hasShadow: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    vibrancy: 'fullscreen-ui',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Hide traffic light buttons on macOS
  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(false);
  }

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  loadWindowUrl(mainWindow, '/');

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingOAuthCallbackUrls.length > 0) {
      const urls = pendingOAuthCallbackUrls.splice(0, pendingOAuthCallbackUrls.length);
      for (const url of urls) {
        mainWindow?.webContents.send('oauth-callback', url);
      }
    }
  });

  // Open DevTools for debugging (detached so it doesn't resize the overlay)
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('blur', () => {
    if (isVisible && !suppressBlurHide) {
      hideWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow(): void {
  if (!mainWindow) return;

  // Capture the frontmost app BEFORE showing our window
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
    // Don't store ourselves
    if (bundleId !== 'com.supercommand' && name !== 'SuperCommand' && name !== 'Electron') {
      lastFrontmostApp = { name, path: appPath, bundleId };
    }
  } catch (e) {
    // Keep whatever was stored previously
  }

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

/**
 * Hide the launcher, re-activate the previous frontmost app, and simulate Cmd+V.
 * Used by both clipboard-paste-item and snippet-paste.
 */
async function hideAndPaste(): Promise<void> {
  // Hide the window first
  if (mainWindow && isVisible) {
    mainWindow.hide();
    isVisible = false;
  }

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  // Re-activate the previous frontmost app explicitly
  if (lastFrontmostApp?.name) {
    try {
      await execFileAsync('osascript', [
        '-e',
        `tell application "${lastFrontmostApp.name}" to activate`,
      ]);
    } catch (e) {
      // Fallback: just wait for OS to refocus
    }
  }

  // Small delay to let the target app gain focus
  await new Promise(resolve => setTimeout(resolve, 200));

  try {
    await execFileAsync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
  } catch (e) {
    console.error('Failed to simulate paste keystroke:', e);
    // Fallback with extra delay
    try {
      await new Promise(resolve => setTimeout(resolve, 200));
      await execFileAsync('osascript', ['-e', `
        delay 0.1
        tell application "System Events"
          keystroke "v" using command down
        end tell
      `]);
    } catch (e2) {
      console.error('Fallback paste also failed:', e2);
    }
  }
}

async function expandSnippetKeywordInPlace(keyword: string, delimiter: string): Promise<void> {
  try {
    console.log(`[SnippetExpander] trigger keyword="${keyword}" delimiter="${delimiter}"`);
    const snippet = getSnippetByKeyword(keyword);
    if (!snippet) return;

    const resolved = renderSnippetById(snippet.id, {});
    if (!resolved) return;

    const fullText = `${resolved}${delimiter || ''}`;
    const backspaceCount = keyword.length + (delimiter ? 1 : 0);
    if (backspaceCount <= 0) return;

    const originalClipboard = electron.clipboard.readText();
    electron.clipboard.writeText(fullText);

    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    const script = `
      tell application "System Events"
        repeat ${backspaceCount} times
          key code 51
        end repeat
        keystroke "v" using command down
      end tell
    `;

    await execFileAsync('osascript', ['-e', script]);

    // Restore user's clipboard after insertion.
    setTimeout(() => {
      electron.clipboard.writeText(originalClipboard);
    }, 80);
  } catch (error) {
    console.error('[SnippetExpander] Failed to expand keyword:', error);
  }
}

function stopSnippetExpander(): void {
  if (!snippetExpanderProcess) return;
  try {
    snippetExpanderProcess.kill();
  } catch {}
  snippetExpanderProcess = null;
  snippetExpanderStdoutBuffer = '';
}

function refreshSnippetExpander(): void {
  if (process.platform !== 'darwin') return;
  stopSnippetExpander();

  const keywords = getAllSnippets()
    .map((s) => (s.keyword || '').trim().toLowerCase())
    .filter((s) => Boolean(s));

  if (keywords.length === 0) return;

  const expanderPath = path.join(__dirname, '..', 'native', 'snippet-expander');
  const fs = require('fs');
  if (!fs.existsSync(expanderPath)) {
    try {
      const { execFileSync } = require('child_process');
      const sourcePath = path.join(app.getAppPath(), 'src', 'native', 'snippet-expander.swift');
      execFileSync('swiftc', ['-O', '-o', expanderPath, sourcePath, '-framework', 'AppKit']);
    } catch (error) {
      console.warn('[SnippetExpander] Native helper not found and compile failed:', error);
      return;
    }
  }

  const { spawn } = require('child_process');
  snippetExpanderProcess = spawn(expanderPath, [JSON.stringify(keywords)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(`[SnippetExpander] Started with ${keywords.length} keyword(s)`);

  snippetExpanderProcess.stdout.on('data', (chunk: Buffer | string) => {
    snippetExpanderStdoutBuffer += chunk.toString();
    const lines = snippetExpanderStdoutBuffer.split('\n');
    snippetExpanderStdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const payload = JSON.parse(trimmed) as { keyword?: string; delimiter?: string };
        if (payload.keyword) {
          void expandSnippetKeywordInPlace(payload.keyword, payload.delimiter || '');
        }
      } catch {
        // ignore malformed helper lines
      }
    }
  });

  snippetExpanderProcess.stderr.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString().trim();
    if (text) console.warn('[SnippetExpander]', text);
  });

  snippetExpanderProcess.on('exit', () => {
    snippetExpanderProcess = null;
    snippetExpanderStdoutBuffer = '';
  });
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

async function openLauncherAndRunSystemCommand(commandId: string): Promise<boolean> {
  if (!mainWindow) {
    createWindow();
  }
  if (!mainWindow) return false;

  const sendCommand = () => {
    showWindow();
    mainWindow?.webContents.send('run-system-command', commandId);
  };

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', () => {
      sendCommand();
    });
  } else {
    sendCommand();
  }

  return true;
}

async function runCommandById(commandId: string, source: 'launcher' | 'hotkey' = 'launcher'): Promise<boolean> {
  if (commandId === 'system-open-settings') {
    openSettingsWindow();
    if (source === 'launcher') hideWindow();
    return true;
  }
  if (commandId === 'system-open-ai-settings') {
    openSettingsWindow('ai');
    if (source === 'launcher') hideWindow();
    return true;
  }
  if (commandId === 'system-open-extensions-settings') {
    openSettingsWindow('extensions');
    if (source === 'launcher') hideWindow();
    return true;
  }
  if (
    commandId === 'system-clipboard-manager' ||
    commandId === 'system-search-snippets' ||
    commandId === 'system-create-snippet' ||
    commandId === 'system-search-files' ||
    commandId === 'system-open-onboarding'
  ) {
    return await openLauncherAndRunSystemCommand(commandId);
  }
  if (commandId === 'system-import-snippets') {
    await importSnippetsFromFile(mainWindow || undefined);
    return true;
  }
  if (commandId === 'system-export-snippets') {
    await exportSnippetsToFile(mainWindow || undefined);
    return true;
  }

  const success = await executeCommand(commandId);
  if (success && source === 'launcher') {
    setTimeout(() => hideWindow(), 50);
  }
  return success;
}

// ─── Settings Window ────────────────────────────────────────────────

function openSettingsWindow(tab?: 'general' | 'ai' | 'extensions'): void {
  if (settingsWindow) {
    if (tab) {
      settingsWindow.webContents.send('settings-tab-changed', tab);
    }
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  if (process.platform === 'darwin') {
    app.dock.show();
  }

  const { x: displayX, y: displayY, width: displayWidth, height: displayHeight } = (() => {
    if (mainWindow) {
      const b = mainWindow.getBounds();
      const center = {
        x: b.x + Math.floor(b.width / 2),
        y: b.y + Math.floor(b.height / 2),
      };
      return screen.getDisplayNearestPoint(center).workArea;
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  })();
  const settingsWidth = 900;
  const settingsHeight = 600;
  const settingsX = displayX + Math.floor((displayWidth - settingsWidth) / 2);
  const settingsY = displayY + Math.floor((displayHeight - settingsHeight) / 2);

  settingsWindow = new BrowserWindow({
    width: settingsWidth,
    height: settingsHeight,
    x: settingsX,
    y: settingsY,
    minWidth: 700,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'hud',
    visualEffectState: 'active',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const hash = tab ? `/settings?tab=${encodeURIComponent(tab)}` : '/settings';
  loadWindowUrl(settingsWindow, hash);

  settingsWindow.once('ready-to-show', () => {
    if (tab) {
      settingsWindow?.webContents.send('settings-tab-changed', tab);
    }
    settingsWindow?.show();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // Hide dock again when no settings/store windows are open
    if (process.platform === 'darwin' && !extensionStoreWindow) {
      app.dock.hide();
    }
  });
}

function openExtensionStoreWindow(): void {
  if (extensionStoreWindow) {
    extensionStoreWindow.show();
    extensionStoreWindow.focus();
    return;
  }

  if (process.platform === 'darwin') {
    app.dock.show();
  }

  const { x: displayX, y: displayY, width: displayWidth, height: displayHeight } = (() => {
    if (mainWindow) {
      const b = mainWindow.getBounds();
      const center = {
        x: b.x + Math.floor(b.width / 2),
        y: b.y + Math.floor(b.height / 2),
      };
      return screen.getDisplayNearestPoint(center).workArea;
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  })();
  const storeWidth = 980;
  const storeHeight = 700;
  const storeX = displayX + Math.floor((displayWidth - storeWidth) / 2);
  const storeY = displayY + Math.floor((displayHeight - storeHeight) / 2);

  extensionStoreWindow = new BrowserWindow({
    width: storeWidth,
    height: storeHeight,
    x: storeX,
    y: storeY,
    minWidth: 860,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'hud',
    visualEffectState: 'active',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  loadWindowUrl(extensionStoreWindow, '/extension-store');

  extensionStoreWindow.once('ready-to-show', () => {
    extensionStoreWindow?.show();
  });

  extensionStoreWindow.on('closed', () => {
    extensionStoreWindow = null;
    if (process.platform === 'darwin' && !settingsWindow) {
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
        await runCommandById(commandId, 'hotkey');
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

// Register custom protocol for serving extension assets (images etc.)
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'sc-asset', privileges: { bypassCSP: true, supportFetchAPI: true, stream: true } }
]);

app.whenReady().then(async () => {
  app.setAsDefaultProtocolClient('supercommand');

  // Register the sc-asset:// protocol handler to serve extension asset files
  protocol.handle('sc-asset', (request: any) => {
    // URL format: sc-asset://ext-asset/path/to/file
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    // Use net.fetch with file:// to serve the actual file
    return net.fetch(`file://${filePath}`);
  });

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

  // Start clipboard monitor
  startClipboardMonitor();

  // Initialize snippet store
  initSnippetStore();
  refreshSnippetExpander();

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
      return await runCommandById(commandId, 'launcher');
    }
  );

  ipcMain.handle('hide-window', () => {
    hideWindow();
  });

  ipcMain.handle('get-last-frontmost-app', () => {
    return lastFrontmostApp;
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
            await runCommandById(commandId, 'hotkey');
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

  ipcMain.handle('open-settings-tab', (_event: any, tab: 'general' | 'ai' | 'extensions') => {
    openSettingsWindow(tab);
  });

  ipcMain.handle('open-extension-store-window', () => {
    openExtensionStoreWindow();
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
          extensionDisplayName: result.extensionDisplayName,
          extensionIconDataUrl: result.extensionIconDataUrl,
          commandName: result.commandName,
          assetsPath: result.assetsPath,
          supportPath: result.supportPath,
          extensionPath: result.extensionPath,
          owner: result.owner,
          preferences: result.preferences,
          preferenceDefinitions: result.preferenceDefinitions,
          commandArgumentDefinitions: result.commandArgumentDefinitions,
        };
      } catch (e: any) {
        console.error(`run-extension error for ${extName}/${cmdName}:`, e);
        return { error: e?.message || 'Unknown error' };
      }
    }
  );

  // Launch command (for @raycast/api launchCommand)
  ipcMain.handle(
    'launch-command',
    async (_event: any, options: any) => {
      try {
        const {
          name,
          type,
          extensionName,
          ownerOrAuthorName,
          arguments: args,
          context,
          fallbackText,
          sourceExtensionName,
          sourcePreferences,
        } = options;

        // Determine which extension to launch
        // For intra-extension launches, we'd need to track the current extension context
        // For now, we require extensionName to be specified
        if (!extensionName) {
          throw new Error('extensionName is required for launchCommand. Intra-extension launches are not yet fully supported.');
        }

        // Get the extension bundle
        const result = getExtensionBundle(extensionName, name);
        if (!result) {
          throw new Error(`Command "${name}" not found in extension "${extensionName}"`);
        }

        const mergedPreferences: Record<string, any> = {
          ...(result.preferences || {}),
        };

        // Intra-extension launches should carry current extension-level preferences
        // (e.g., API keys) so commands don't regress to manifest defaults.
        if (
          sourceExtensionName &&
          sourceExtensionName === extensionName &&
          sourcePreferences &&
          typeof sourcePreferences === 'object'
        ) {
          for (const def of result.preferenceDefinitions || []) {
            if (!def?.name || def.scope !== 'extension') continue;
            if (sourcePreferences[def.name] !== undefined) {
              mergedPreferences[def.name] = sourcePreferences[def.name];
            }
          }
        }

        // Return bundle with launch context
        // The renderer will handle actually displaying the command
        return {
          success: true,
          bundle: {
            code: result.code,
            title: result.title,
            mode: result.mode,
            extName: extensionName,
            cmdName: name,
            extensionName: result.extensionName,
            extensionDisplayName: result.extensionDisplayName,
            extensionIconDataUrl: result.extensionIconDataUrl,
            commandName: result.commandName,
            assetsPath: result.assetsPath,
            supportPath: result.supportPath,
            extensionPath: result.extensionPath,
            owner: result.owner,
            preferences: mergedPreferences,
            preferenceDefinitions: result.preferenceDefinitions,
            commandArgumentDefinitions: result.commandArgumentDefinitions,
            launchArguments: args || {},
            fallbackText: fallbackText ?? null,
            launchContext: context,
            launchType: type,
          }
        };
      } catch (e: any) {
        console.error('launch-command error:', e);
        throw new Error(e?.message || 'Failed to launch command');
      }
    }
  );

  // Update command metadata (for @raycast/api updateCommandMetadata)
  ipcMain.handle(
    'update-command-metadata',
    async (_event: any, commandId: string, metadata: { subtitle?: string | null }) => {
      try {
        // Store command metadata in settings
        const settings = loadSettings();
        if (!settings.commandMetadata) {
          settings.commandMetadata = {};
        }

        if (metadata.subtitle === null) {
          // Remove custom subtitle
          delete settings.commandMetadata[commandId];
        } else {
          // Update subtitle
          settings.commandMetadata[commandId] = { subtitle: metadata.subtitle };
        }

        saveSettings({ commandMetadata: settings.commandMetadata });

        // Notify all windows to refresh command list
        invalidateCache();
        return { success: true };
      } catch (e: any) {
        console.error('update-command-metadata error:', e);
        throw new Error(e?.message || 'Failed to update command metadata');
      }
    }
  );

  // ─── IPC: Extension APIs (for @raycast/api compatibility) ────────

  // HTTP request proxy (so extensions can make Node.js HTTP requests without CORS)
  ipcMain.handle(
    'http-request',
    async (
      _event: any,
      options: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      }
    ) => {
      const http = require('http');
      const https = require('https');
      const { URL } = require('url');

      // Rewrite Google Translate API to googleapis.com (no TKK token needed)
      let requestUrl = options.url;
      try {
        const u = new URL(requestUrl);
        if (u.hostname === 'translate.google.com' && u.pathname.startsWith('/translate_a/')) {
          u.hostname = 'translate.googleapis.com';
          u.searchParams.delete('tk');
          requestUrl = u.toString();
        }
      } catch {}

      const doRequest = (url: string, method: string, headers: Record<string, string>, body: string | undefined, redirectsLeft: number): Promise<any> => {
        return new Promise((resolve) => {
          try {
            const parsedUrl = new URL(url);
            const transport = parsedUrl.protocol === 'https:' ? https : http;

            const reqOptions: any = {
              hostname: parsedUrl.hostname,
              port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
              path: parsedUrl.pathname + parsedUrl.search,
              method: method,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...headers,
              },
            };

            const req = transport.request(reqOptions, (res: any) => {
              // Follow redirects (301, 302, 303, 307, 308)
              if (redirectsLeft > 0 && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume(); // drain the response
                const redirectUrl = new URL(res.headers.location, url).toString();
                const redirectMethod = (res.statusCode === 303) ? 'GET' : method;
                const redirectBody = (res.statusCode === 303) ? undefined : body;
                resolve(doRequest(redirectUrl, redirectMethod, headers, redirectBody, redirectsLeft - 1));
                return;
              }

              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => {
                const bodyBuffer = Buffer.concat(chunks);
                const responseHeaders: Record<string, string> = {};
                for (const [key, val] of Object.entries(res.headers)) {
                  responseHeaders[key] = Array.isArray(val) ? val.join(', ') : String(val);
                }
                resolve({
                  status: res.statusCode,
                  statusText: res.statusMessage || '',
                  headers: responseHeaders,
                  bodyText: bodyBuffer.toString('utf-8'),
                  url: url,
                });
              });
            });

            req.on('error', (err: Error) => {
              resolve({
                status: 0,
                statusText: err.message,
                headers: {},
                bodyText: '',
                url: url,
              });
            });

            req.setTimeout(30000, () => {
              req.destroy();
              resolve({
                status: 0,
                statusText: 'Request timed out',
                headers: {},
                bodyText: '',
                url: url,
              });
            });

            if (body) {
              req.write(body);
            }
            req.end();
          } catch (e: any) {
            resolve({
              status: 0,
              statusText: e?.message || 'Request failed',
              headers: {},
              bodyText: '',
              url: url,
            });
          }
        });
      };

      return doRequest(requestUrl, (options.method || 'GET').toUpperCase(), options.headers || {}, options.body, 5);
    }
  );

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
      const fs = require('fs');

      return new Promise((resolve) => {
        try {
          const resolveExecutablePath = (input: string): string => {
            if (!input || typeof input !== 'string') return input;
            if (!input.includes('/') && !input.includes('\\')) return input;
            if (!input.startsWith('/')) return input;
            if (fs.existsSync(input)) return input;
            try {
              const base = input.split('/').filter(Boolean).pop() || '';
              if (!base) return input;
              const lookup = execFileSync('/bin/zsh', ['-lc', `command -v -- ${JSON.stringify(base)} 2>/dev/null || true`], { encoding: 'utf-8' }).trim();
              if (lookup && fs.existsSync(lookup)) return lookup;
            } catch {}
            return input;
          };

          const execFileSync = require('child_process').execFileSync;
          const normalizedCommand = resolveExecutablePath(command);
          const spawnOptions: any = {
            shell: options?.shell ?? false,
            env: { ...process.env, ...options?.env },
            cwd: options?.cwd || process.cwd(),
          };

          let proc: any;
          if (options?.shell) {
            // When shell is true, join command and args
            const fullCommand = [normalizedCommand, ...args].join(' ');
            proc = spawn(fullCommand, [], { ...spawnOptions, shell: true });
          } else {
            proc = spawn(normalizedCommand, args, spawnOptions);
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

  // Synchronous shell command execution (for extensions using execFileSync/execSync)
  ipcMain.on(
    'exec-command-sync',
    (
      event: any,
      command: string,
      args: string[],
      options?: { shell?: boolean | string; input?: string; env?: Record<string, string>; cwd?: string }
    ) => {
      try {
        const { spawnSync, execFileSync } = require('child_process');
        const fs = require('fs');
        const resolveExecutablePath = (input: string): string => {
          if (!input || typeof input !== 'string') return input;
          if (!input.includes('/') && !input.includes('\\')) return input;
          if (!input.startsWith('/')) return input;
          if (fs.existsSync(input)) return input;
          try {
            const base = input.split('/').filter(Boolean).pop() || '';
            if (!base) return input;
            const lookup = execFileSync('/bin/zsh', ['-lc', `command -v -- ${JSON.stringify(base)} 2>/dev/null || true`], { encoding: 'utf-8' }).trim();
            if (lookup && fs.existsSync(lookup)) return lookup;
          } catch {}
          return input;
        };
        const normalizedCommand = resolveExecutablePath(command);
        const spawnOptions: any = {
          shell: options?.shell ?? false,
          env: { ...process.env, ...options?.env },
          cwd: options?.cwd || process.cwd(),
          input: options?.input,
          encoding: 'utf-8',
          timeout: 30000,
        };

        let result: any;
        if (options?.shell) {
          const fullCommand = [normalizedCommand, ...(args || [])].join(' ');
          result = spawnSync(fullCommand, [], { ...spawnOptions, shell: true });
        } else {
          result = spawnSync(normalizedCommand, args || [], spawnOptions);
        }

        event.returnValue = {
          stdout: result?.stdout || '',
          stderr: result?.stderr || '',
          exitCode: typeof result?.status === 'number' ? result.status : 0,
        };
      } catch (e: any) {
        event.returnValue = {
          stdout: '',
          stderr: e?.message || 'Failed to execute command',
          exitCode: 1,
        };
      }
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

  // Get default application for a file/URL
  ipcMain.handle('get-default-application', async (_event: any, filePath: string) => {
    try {
      const { execSync } = require('child_process');
      // Use Launch Services via AppleScript to find default app
      const script = `
        use framework "AppKit"
        set fileURL to current application's NSURL's fileURLWithPath:"${filePath.replace(/"/g, '\\"')}"
        set appURL to current application's NSWorkspace's sharedWorkspace()'s URLForApplicationToOpenURL:fileURL
        if appURL is missing value then
          error "No default application found"
        end if
        set appPath to appURL's |path|() as text
        set appBundle to current application's NSBundle's bundleWithPath:appPath
        set appName to (appBundle's infoDictionary()'s objectForKey:"CFBundleName") as text
        set bundleId to (appBundle's bundleIdentifier()) as text
        return appName & "|||" & appPath & "|||" & bundleId
      `;
      const result = execSync(`osascript -l AppleScript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' }).trim();
      const [name, appPath, bundleId] = result.split('|||');
      return { name, path: appPath, bundleId };
    } catch (e: any) {
      console.error('get-default-application error:', e);
      throw new Error(`No default application found for: ${filePath}`);
    }
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

  // Synchronous file read for extensions that use readFileSync (e.g. emoji picker)
  ipcMain.on('read-file-sync', (event: any, filePath: string) => {
    try {
      event.returnValue = { data: fs.readFileSync(filePath, 'utf-8'), error: null };
    } catch (e: any) {
      event.returnValue = { data: null, error: e.message };
    }
  });

  // Synchronous file-exists check
  ipcMain.on('file-exists-sync', (event: any, filePath: string) => {
    try {
      event.returnValue = fs.existsSync(filePath);
    } catch {
      event.returnValue = false;
    }
  });

  // Synchronous stat check
  ipcMain.on('stat-sync', (event: any, filePath: string) => {
    try {
      const stat = fs.statSync(filePath);
      event.returnValue = { exists: true, isDirectory: stat.isDirectory(), isFile: stat.isFile(), size: stat.size };
    } catch {
      event.returnValue = { exists: false, isDirectory: false, isFile: false, size: 0 };
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

  ipcMain.handle('get-file-icon-data-url', async (_event: any, filePath: string, size = 20) => {
    try {
      const icon = await app.getFileIcon(filePath, { size: size <= 16 ? 'small' : size >= 64 ? 'large' : 'normal' });
      if (icon && !icon.isEmpty()) {
        return icon.resize({ width: size, height: size }).toDataURL();
      }
      return null;
    } catch {
      return null;
    }
  });

  // Get system appearance
  ipcMain.handle('get-appearance', () => {
    return 'dark';
  });

  // SQLite query execution (for extensions like cursor-recent-projects)
  ipcMain.handle('run-sqlite-query', async (_event: any, dbPath: string, query: string) => {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const fs = require('fs');

    console.log('[SQLite] Query request:', { dbPath, query: query.substring(0, 100), dbExists: fs.existsSync(dbPath) });

    try {
      const { stdout, stderr } = await execFileAsync('sqlite3', ['-json', dbPath, query], { maxBuffer: 10 * 1024 * 1024 });

      if (stderr) {
        console.warn('[SQLite] Query stderr:', stderr);
      }

      console.log('[SQLite] Query stdout length:', stdout.length, 'first 200 chars:', stdout.substring(0, 200));

      try {
        const parsed = JSON.parse(stdout);
        console.log('[SQLite] Successfully parsed JSON, result type:', Array.isArray(parsed) ? `array[${parsed.length}]` : typeof parsed);
        return { data: parsed, error: null };
      } catch (parseError: any) {
        // If not JSON, return raw output
        console.warn('[SQLite] Failed to parse JSON:', parseError.message, 'returning raw output');
        return { data: stdout, error: null };
      }
    } catch (e: any) {
      console.error('[SQLite] Query failed:', e.message, 'stderr:', e.stderr);
      return { data: null, error: e.message || 'SQLite query failed' };
    }
  });

  // ─── IPC: Store (Community Extensions) ──────────────────────────

  ipcMain.handle(
    'get-catalog',
    async (_event: any, forceRefresh?: boolean) => {
      return await getCatalog(forceRefresh ?? false);
    }
  );

  ipcMain.handle(
    'get-extension-screenshots',
    async (_event: any, extensionName: string) => {
      return await getExtensionScreenshotUrls(extensionName);
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

  // ─── IPC: Clipboard Manager ─────────────────────────────────────

  ipcMain.handle('clipboard-get-history', () => {
    return getClipboardHistory();
  });

  ipcMain.handle('clipboard-search', (_event: any, query: string) => {
    return searchClipboardHistory(query);
  });

  ipcMain.handle('clipboard-clear-history', () => {
    clearClipboardHistory();
  });

  ipcMain.handle('clipboard-delete-item', (_event: any, id: string) => {
    return deleteClipboardItem(id);
  });

  ipcMain.handle('clipboard-copy-item', (_event: any, id: string) => {
    return copyItemToClipboard(id);
  });

  ipcMain.handle('clipboard-paste-item', async (_event: any, id: string) => {
    const success = copyItemToClipboard(id);
    if (!success) return false;

    await hideAndPaste();
    return true;
  });

  ipcMain.handle('clipboard-set-enabled', (_event: any, enabled: boolean) => {
    setClipboardMonitorEnabled(enabled);
  });

  // Focus-safe clipboard APIs for extension/runtime shims.
  ipcMain.handle('clipboard-write', (_event: any, payload: { text?: string; html?: string }) => {
    try {
      const text = payload?.text || '';
      const html = payload?.html || '';
      if (html) {
        systemClipboard.write({ text, html });
      } else {
        systemClipboard.writeText(text);
      }
      return true;
    } catch (error) {
      console.error('clipboard-write failed:', error);
      return false;
    }
  });

  ipcMain.handle('clipboard-read-text', () => {
    try {
      return systemClipboard.readText() || '';
    } catch (error) {
      console.error('clipboard-read-text failed:', error);
      return '';
    }
  });

  // ─── IPC: Snippet Manager ─────────────────────────────────────

  ipcMain.handle('snippet-get-all', () => {
    return getAllSnippets();
  });

  ipcMain.handle('snippet-search', (_event: any, query: string) => {
    return searchSnippets(query);
  });

  ipcMain.handle('snippet-create', (_event: any, data: { name: string; content: string; keyword?: string }) => {
    const created = createSnippet(data);
    refreshSnippetExpander();
    return created;
  });

  ipcMain.handle('snippet-update', (_event: any, id: string, data: { name?: string; content?: string; keyword?: string }) => {
    const updated = updateSnippet(id, data);
    refreshSnippetExpander();
    return updated;
  });

  ipcMain.handle('snippet-delete', (_event: any, id: string) => {
    const removed = deleteSnippet(id);
    refreshSnippetExpander();
    return removed;
  });

  ipcMain.handle('snippet-delete-all', () => {
    const removed = deleteAllSnippets();
    refreshSnippetExpander();
    return removed;
  });

  ipcMain.handle('snippet-duplicate', (_event: any, id: string) => {
    return duplicateSnippet(id);
  });

  ipcMain.handle('snippet-toggle-pin', (_event: any, id: string) => {
    return togglePinSnippet(id);
  });

  ipcMain.handle('snippet-get-by-keyword', (_event: any, keyword: string) => {
    return getSnippetByKeyword(keyword);
  });

  ipcMain.handle('snippet-get-dynamic-fields', (_event: any, id: string) => {
    return getSnippetDynamicFieldsById(id);
  });

  ipcMain.handle('snippet-render', (_event: any, id: string, dynamicValues?: Record<string, string>) => {
    return renderSnippetById(id, dynamicValues);
  });

  ipcMain.handle('snippet-copy-to-clipboard', (_event: any, id: string) => {
    return copySnippetToClipboard(id);
  });

  ipcMain.handle('snippet-copy-to-clipboard-resolved', (_event: any, id: string, dynamicValues?: Record<string, string>) => {
    return copySnippetToClipboardResolved(id, dynamicValues);
  });

  ipcMain.handle('snippet-paste', async (_event: any, id: string) => {
    const success = copySnippetToClipboard(id);
    if (!success) return false;

    await hideAndPaste();
    return true;
  });

  ipcMain.handle('snippet-paste-resolved', async (_event: any, id: string, dynamicValues?: Record<string, string>) => {
    const success = copySnippetToClipboardResolved(id, dynamicValues);
    if (!success) return false;

    await hideAndPaste();
    return true;
  });

  ipcMain.handle('snippet-import', async () => {
    suppressBlurHide = true;
    try {
      const result = await importSnippetsFromFile(mainWindow || undefined);
      refreshSnippetExpander();
      return result;
    } finally {
      suppressBlurHide = false;
    }
  });

  ipcMain.handle('snippet-export', async () => {
    suppressBlurHide = true;
    try {
      return await exportSnippetsToFile(mainWindow || undefined);
    } finally {
      suppressBlurHide = false;
    }
  });

  // ─── IPC: AI ───────────────────────────────────────────────────

  ipcMain.handle(
    'ai-ask',
    async (event: any, requestId: string, prompt: string, options?: { model?: string; creativity?: number; systemPrompt?: string }) => {
      const s = loadSettings();
      if (!isAIAvailable(s.ai)) {
        event.sender.send('ai-stream-error', { requestId, error: 'AI is not configured. Please set up an API key in Settings → AI.' });
        return;
      }

      const controller = new AbortController();
      activeAIRequests.set(requestId, controller);

      try {
        const gen = streamAI(s.ai, {
          prompt,
          model: options?.model,
          creativity: options?.creativity,
          systemPrompt: options?.systemPrompt,
          signal: controller.signal,
        });

        for await (const chunk of gen) {
          if (controller.signal.aborted) break;
          event.sender.send('ai-stream-chunk', { requestId, chunk });
        }

        if (!controller.signal.aborted) {
          event.sender.send('ai-stream-done', { requestId });
        }
      } catch (e: any) {
        if (!controller.signal.aborted) {
          event.sender.send('ai-stream-error', { requestId, error: e?.message || 'AI request failed' });
        }
      } finally {
        activeAIRequests.delete(requestId);
      }
    }
  );

  ipcMain.handle('ai-cancel', (_event: any, requestId: string) => {
    const controller = activeAIRequests.get(requestId);
    if (controller) {
      controller.abort();
      activeAIRequests.delete(requestId);
    }
  });

  ipcMain.handle('ai-is-available', () => {
    const s = loadSettings();
    return isAIAvailable(s.ai);
  });

  // ─── IPC: Ollama Model Management ──────────────────────────────

  ipcMain.handle('ollama-status', async () => {
    const s = loadSettings();
    const baseUrl = s.ai.ollamaBaseUrl || 'http://localhost:11434';

    return new Promise((resolve) => {
      const url = new URL('/api/tags', baseUrl);
      const mod = url.protocol === 'https:' ? require('https') : require('http');

      const req = mod.get(url.toString(), (res: any) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              resolve({
                running: true,
                models: (data.models || []).map((m: any) => ({
                  name: m.name,
                  size: m.size,
                  parameterSize: m.details?.parameter_size || '',
                  quantization: m.details?.quantization_level || '',
                  modifiedAt: m.modified_at,
                })),
              });
            } catch {
              resolve({ running: true, models: [] });
            }
          } else {
            resolve({ running: false, models: [] });
          }
        });
      });

      req.on('error', () => {
        resolve({ running: false, models: [] });
      });

      req.setTimeout(3000, () => {
        req.destroy();
        resolve({ running: false, models: [] });
      });
    });
  });

  ipcMain.handle(
    'ollama-pull',
    async (event: any, requestId: string, modelName: string) => {
      const s = loadSettings();
      const baseUrl = s.ai.ollamaBaseUrl || 'http://localhost:11434';
      const url = new URL('/api/pull', baseUrl);
      const mod = url.protocol === 'https:' ? require('https') : require('http');

      const controller = new AbortController();
      activeAIRequests.set(requestId, controller);

      const body = JSON.stringify({ name: modelName, stream: true });

      const req = mod.request(
        {
          hostname: url.hostname,
          port: url.port ? parseInt(url.port) : undefined,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res: any) => {
          if (res.statusCode && res.statusCode >= 400) {
            let errBody = '';
            res.on('data', (chunk: Buffer) => { errBody += chunk.toString(); });
            res.on('end', () => {
              event.sender.send('ollama-pull-error', {
                requestId,
                error: `HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`,
              });
              activeAIRequests.delete(requestId);
            });
            return;
          }

          let buffer = '';
          res.on('data', (chunk: Buffer) => {
            if (controller.signal.aborted) return;
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const obj = JSON.parse(trimmed);
                event.sender.send('ollama-pull-progress', {
                  requestId,
                  status: obj.status || '',
                  digest: obj.digest || '',
                  total: obj.total || 0,
                  completed: obj.completed || 0,
                });
              } catch {}
            }
          });

          res.on('end', () => {
            if (buffer.trim()) {
              try {
                const obj = JSON.parse(buffer.trim());
                event.sender.send('ollama-pull-progress', {
                  requestId,
                  status: obj.status || '',
                  digest: obj.digest || '',
                  total: obj.total || 0,
                  completed: obj.completed || 0,
                });
              } catch {}
            }
            if (!controller.signal.aborted) {
              event.sender.send('ollama-pull-done', { requestId });
            }
            activeAIRequests.delete(requestId);
          });
        }
      );

      req.on('error', (err: Error) => {
        if (!controller.signal.aborted) {
          event.sender.send('ollama-pull-error', {
            requestId,
            error: err.message || 'Failed to pull model',
          });
        }
        activeAIRequests.delete(requestId);
      });

      if (controller.signal.aborted) {
        req.destroy();
        return;
      }
      controller.signal.addEventListener('abort', () => {
        req.destroy();
      }, { once: true });

      req.write(body);
      req.end();
    }
  );

  ipcMain.handle('ollama-delete', async (_event: any, modelName: string) => {
    const s = loadSettings();
    const baseUrl = s.ai.ollamaBaseUrl || 'http://localhost:11434';
    const url = new URL('/api/delete', baseUrl);
    const mod = url.protocol === 'https:' ? require('https') : require('http');

    return new Promise((resolve) => {
      const body = JSON.stringify({ name: modelName });
      const req = mod.request(
        {
          hostname: url.hostname,
          port: url.port ? parseInt(url.port) : undefined,
          path: url.pathname,
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        },
        (res: any) => {
          let resBody = '';
          res.on('data', (chunk: Buffer) => { resBody += chunk.toString(); });
          res.on('end', () => {
            resolve({ success: res.statusCode === 200, error: res.statusCode !== 200 ? resBody : null });
          });
        }
      );
      req.on('error', (err: Error) => {
        resolve({ success: false, error: err.message });
      });
      req.write(body);
      req.end();
    });
  });

  ipcMain.handle('ollama-open-download', async () => {
    await shell.openExternal('https://ollama.com/download');
    return true;
  });

  // ─── IPC: WindowManagement ──────────────────────────────────────

  ipcMain.handle('window-management-get-active-window', async () => {
    try {
      const { execSync } = require('child_process');
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set frontAppName to name of frontApp
          set frontWindow to window 1 of frontApp

          set windowBounds to bounds of frontWindow
          set windowId to id of frontWindow as text
          set windowTitle to name of frontWindow
          set windowPosition to {item 1 of windowBounds, item 2 of windowBounds}
          set windowSize to {(item 3 of windowBounds) - (item 1 of windowBounds), (item 4 of windowBounds) - (item 2 of windowBounds)}

          return windowId & "|" & windowTitle & "|" & (item 1 of windowPosition) & "|" & (item 2 of windowPosition) & "|" & (item 1 of windowSize) & "|" & (item 2 of windowSize) & "|" & frontAppName
        end tell
      `;

      const result = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' }).trim();
      const [id, title, x, y, width, height, appName] = result.split('|');

      return {
        id,
        active: true,
        bounds: {
          position: { x: parseInt(x), y: parseInt(y) },
          size: { width: parseInt(width), height: parseInt(height) }
        },
        desktopId: '1',
        positionable: true,
        resizable: true,
        fullScreenSettable: true,
        application: {
          name: appName,
          path: '',
          bundleId: ''
        }
      };
    } catch (error) {
      console.error('Failed to get active window:', error);
      return null;
    }
  });

  ipcMain.handle('window-management-get-windows-on-active-desktop', async () => {
    try {
      const { execSync } = require('child_process');
      const script = `
        tell application "System Events"
          set windowList to {}
          repeat with proc in (every application process where background only is false)
            try
              set procName to name of proc
              repeat with win in (every window of proc)
                set windowBounds to bounds of win
                set windowId to id of win as text
                set windowTitle to name of win
                set windowPosition to {item 1 of windowBounds, item 2 of windowBounds}
                set windowSize to {(item 3 of windowBounds) - (item 1 of windowBounds), (item 4 of windowBounds) - (item 2 of windowBounds)}

                set end of windowList to windowId & "|" & windowTitle & "|" & (item 1 of windowPosition) & "|" & (item 2 of windowPosition) & "|" & (item 1 of windowSize) & "|" & (item 2 of windowSize) & "|" & procName
              end repeat
            end try
          end repeat

          set text item delimiters to "\\n"
          return windowList as text
        end tell
      `;

      const result = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' }).trim();
      if (!result || result.trim() === '') {
        return [];
      }

      const windows = result.split('\n').map((line: string) => {
        const [id, title, x, y, width, height, appName] = line.split('|');
        return {
          id,
          active: false,
          bounds: {
            position: { x: parseInt(x), y: parseInt(y) },
            size: { width: parseInt(width), height: parseInt(height) }
          },
          desktopId: '1',
          positionable: true,
          resizable: true,
          fullScreenSettable: true,
          application: {
            name: appName,
            path: '',
            bundleId: ''
          }
        };
      });

      return windows;
    } catch (error) {
      console.error('Failed to get windows:', error);
      return [];
    }
  });

  ipcMain.handle('window-management-get-desktops', async () => {
    try {
      // macOS doesn't expose virtual desktops (Spaces) easily via AppleScript
      // Return a minimal implementation
      const { screen } = require('electron');
      const displays = screen.getAllDisplays();

      return displays.map((display: any, index: number) => ({
        id: String(index + 1),
        active: index === 0,
        screenId: String(display.id),
        size: {
          width: display.bounds.width,
          height: display.bounds.height
        },
        type: 'user'
      }));
    } catch (error) {
      console.error('Failed to get desktops:', error);
      return [];
    }
  });

  ipcMain.handle('window-management-set-window-bounds', async (_event: any, options: any) => {
    try {
      const { execSync } = require('child_process');
      const { id, bounds, desktopId } = options;

      if (bounds === 'fullscreen') {
        // Set window to fullscreen
        const script = `
          tell application "System Events"
            set targetWindow to (first window of (first application process whose (id of window 1) as text is "${id}"))
            set value of attribute "AXFullScreen" of targetWindow to true
          end tell
        `;
        execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' });
      } else {
        // Set window position/size
        const { position, size } = bounds;

        // If desktopId specifies a different display, offset position to that display
        let offsetX = 0;
        let offsetY = 0;
        if (desktopId) {
          const { screen: electronScreen } = require('electron');
          const displays = electronScreen.getAllDisplays();
          const targetIndex = parseInt(desktopId) - 1;
          if (targetIndex >= 0 && targetIndex < displays.length) {
            offsetX = displays[targetIndex].bounds.x;
            offsetY = displays[targetIndex].bounds.y;
          }
        }

        let script = 'tell application "System Events"\n';
        script += `  set targetWindow to (first window of (first application process whose (id of window 1) as text is "${id}"))\n`;

        if (position && size) {
          const x = (position.x ?? 0) + offsetX;
          const y = (position.y ?? 0) + offsetY;
          script += `  set bounds of targetWindow to {${x}, ${y}, ${x + (size.width ?? 0)}, ${y + (size.height ?? 0)}}\n`;
        } else if (position) {
          script += `  set position of targetWindow to {${(position.x ?? 0) + offsetX}, ${(position.y ?? 0) + offsetY}}\n`;
        } else if (size) {
          script += `  set size of targetWindow to {${size.width}, ${size.height}}\n`;
        }

        script += 'end tell';
        execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' });
      }
    } catch (error) {
      console.error('Failed to set window bounds:', error);
      throw error;
    }
  });

  // ─── IPC: Native Color Picker ──────────────────────────────────

  ipcMain.handle('native-pick-color', async () => {
    const { execFile } = require('child_process');
    const colorPickerPath = path.join(__dirname, '..', 'native', 'color-picker');

    // Keep the launcher open while the native picker is focused.
    suppressBlurHide = true;
    const pickedColor = await new Promise((resolve) => {
      execFile(colorPickerPath, (error: any, stdout: string) => {
        if (error) {
          console.error('Color picker failed:', error);
          resolve(null);
          return;
        }

        const trimmed = stdout.trim();
        if (trimmed === 'null' || !trimmed) {
          resolve(null);
          return;
        }

        try {
          const color = JSON.parse(trimmed);
          resolve(color);
        } catch (e) {
          console.error('Failed to parse color picker output:', e);
          resolve(null);
        }
      });
    });
    suppressBlurHide = false;
    return pickedColor;
  });

  // ─── IPC: Native File Picker (for Form.FilePicker) ───────────────
  ipcMain.handle(
    'pick-files',
    async (
      _event: any,
      options?: {
        allowMultipleSelection?: boolean;
        canChooseDirectories?: boolean;
        canChooseFiles?: boolean;
        showHiddenFiles?: boolean;
      }
    ) => {
      const canChooseFiles = options?.canChooseFiles !== false;
      const canChooseDirectories = options?.canChooseDirectories === true;
      const properties: string[] = [];

      if (canChooseFiles) properties.push('openFile');
      if (canChooseDirectories) properties.push('openDirectory');
      if (options?.allowMultipleSelection) properties.push('multiSelections');
      if (options?.showHiddenFiles) properties.push('showHiddenFiles');

      // Ensure at least one target type is selectable.
      if (!properties.includes('openFile') && !properties.includes('openDirectory')) {
        properties.push('openFile');
      }

      suppressBlurHide = true;
      try {
        const result = await dialog.showOpenDialog(mainWindow || undefined, {
          properties: properties as any,
        });
        if (result.canceled) return [];
        return result.filePaths || [];
      } catch (error: any) {
        console.error('pick-files failed:', error);
        return [];
      } finally {
        suppressBlurHide = false;
      }
    }
  );

  // ─── IPC: Menu Bar (Tray) Extensions ────────────────────────────

  // Get all menu-bar extension bundles so the renderer can run them
  ipcMain.handle('get-menubar-extensions', async () => {
    const allCmds = discoverInstalledExtensionCommands();
    const menuBarCmds = allCmds.filter((c) => c.mode === 'menu-bar');

    const bundles: any[] = [];
    for (const cmd of menuBarCmds) {
      const bundle = getExtensionBundle(cmd.extName, cmd.cmdName);
      if (bundle) {
        bundles.push({
          code: bundle.code,
          title: bundle.title,
          mode: bundle.mode,
          extName: cmd.extName,
          cmdName: cmd.cmdName,
          extensionName: bundle.extensionName,
          extensionDisplayName: bundle.extensionDisplayName,
          extensionIconDataUrl: bundle.extensionIconDataUrl,
          commandName: bundle.commandName,
          assetsPath: bundle.assetsPath,
          supportPath: bundle.supportPath,
          owner: bundle.owner,
          preferences: bundle.preferences,
          preferenceDefinitions: bundle.preferenceDefinitions,
          commandArgumentDefinitions: bundle.commandArgumentDefinitions,
        });
      }
    }
    return bundles;
  });

  // Update / create a menu-bar Tray when the renderer sends menu structure
  ipcMain.on('menubar-update', (_event: any, data: any) => {
    const { extId, iconPath, iconEmoji, title, tooltip, items } = data;

    let tray = menuBarTrays.get(extId);

    const resolveTrayIcon = () => {
      try {
        if (iconPath && require('fs').existsSync(iconPath)) {
          const img = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
          if (!img.isEmpty()) {
            img.setTemplateImage(true);
            return img;
          }
        }
      } catch {}
      return nativeImage.createEmpty();
    };

    if (!tray) {
      const icon = resolveTrayIcon();
      tray = new Tray(icon);
      menuBarTrays.set(extId, tray);
    }

    // Always refresh icon on update (first payload can be incomplete).
    tray.setImage(resolveTrayIcon());

    // Update title: if there's a text title, show it; if only emoji icon, show that
    if (title) {
      tray.setTitle(title);
    } else if (iconEmoji) {
      tray.setTitle(iconEmoji);
    } else if (!iconPath) {
      // Keep tray visible even when extension provides neither icon nor title.
      tray.setTitle('⏱');
    } else {
      tray.setTitle('');
    }
    if (tooltip) tray.setToolTip(tooltip);

    // Build native menu from serialized items
    const menuTemplate = buildMenuBarTemplate(items, extId);
    const menu = Menu.buildFromTemplate(menuTemplate);
    tray.setContextMenu(menu);
  });

  // Route native menu clicks back to the renderer
  function buildMenuBarTemplate(items: any[], extId: string): any[] {
    const template: any[] = [];
    for (const item of items) {
      switch (item.type) {
        case 'separator':
          template.push({ type: 'separator' as const });
          break;
        case 'label':
          template.push({ label: item.title || '', enabled: false });
          break;
        case 'submenu':
          template.push({
            label: item.title || '',
            submenu: buildMenuBarTemplate(item.children || [], extId),
          });
          break;
        case 'item':
        default:
          template.push({
            label: item.title || '',
            click: () => {
              mainWindow?.webContents.send('menubar-item-click', { extId, itemId: item.id });
            },
          });
          break;
      }
    }
    return template;
  }

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
  stopClipboardMonitor();
  stopSnippetExpander();
  // Clean up trays
  for (const [, tray] of menuBarTrays) {
    tray.destroy();
  }
  menuBarTrays.clear();
});
