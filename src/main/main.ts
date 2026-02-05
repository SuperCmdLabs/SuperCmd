/**
 * Main Process
 * 
 * Handles:
 * - Global shortcut registration (Cmd + Space)
 * - Window lifecycle (create, show, hide, toggle)
 * - IPC communication with renderer
 * - Command execution
 */

import * as path from 'path';
import { getAvailableCommands, executeCommand } from './commands';

const electron = require('electron');
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = electron;

// Window configuration
const WINDOW_WIDTH = 680;
const WINDOW_HEIGHT = 440;
const GLOBAL_SHORTCUT = 'Command+Space';

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let isVisible = false;

/**
 * Create the overlay window
 */
function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

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

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('blur', () => {
    if (isVisible) {
      hideWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Show the overlay window
 */
function showWindow(): void {
  if (!mainWindow) return;

  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x: displayX, y: displayY, width: displayWidth, height: displayHeight } = currentDisplay.workArea;

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

/**
 * Hide the overlay window
 */
function hideWindow(): void {
  if (!mainWindow) return;

  mainWindow.hide();
  isVisible = false;
}

/**
 * Toggle window visibility
 */
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

/**
 * App initialization
 */
app.whenReady().then(() => {
  // Get available commands (async, checks which apps exist)
  ipcMain.handle('get-commands', async () => {
    return await getAvailableCommands();
  });

  ipcMain.handle('execute-command', async (_event: any, commandId: string) => {
    const success = await executeCommand(commandId);
    if (success) {
      setTimeout(() => hideWindow(), 50);
    }
    return success;
  });

  ipcMain.handle('hide-window', () => {
    hideWindow();
  });

  createWindow();

  const registered = globalShortcut.register(GLOBAL_SHORTCUT, () => {
    toggleWindow();
  });

  if (!registered) {
    console.error(`Failed to register global shortcut: ${GLOBAL_SHORTCUT}`);
    console.error('Note: Cmd+Space may conflict with Spotlight. Try changing the shortcut.');
  } else {
    console.log(`Global shortcut registered: ${GLOBAL_SHORTCUT}`);
  }

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
