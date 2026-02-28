/**
 * Main Process — SuperCmd
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
import * as fs from 'fs';
import * as os from 'os';
import { fork, type ChildProcess } from 'child_process';
import { getAvailableCommands, executeCommand, invalidateCache } from './commands';
import { loadSettings, saveSettings, setOAuthToken, getOAuthToken, removeOAuthToken } from './settings-store';
import type { AppSettings } from './settings-store';
import { streamAI, isAIAvailable, transcribeAudio } from './ai-provider';
import { addMemory, buildMemoryContextSystemPrompt } from './memory';
import {
  createScriptCommandTemplate,
  ensureSampleScriptCommand,
  executeScriptCommand,
  getScriptCommandBySlug,
  getSuperCmdScriptCommandsDirectory,
  invalidateScriptCommandsCache,
} from './script-command-runner';
import {
  getCatalog,
  getExtensionScreenshotUrls,
  getInstalledExtensionNames,
  installExtension,
  uninstallExtension,
} from './extension-registry';
import { getExtensionBundle, buildAllCommands, discoverInstalledExtensionCommands, getInstalledExtensionsSettingsSchema } from './extension-runner';
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
import {
  initQuickLinkStore,
  getAllQuickLinks,
  searchQuickLinks,
  createQuickLink,
  updateQuickLink,
  deleteQuickLink,
  duplicateQuickLink,
  getQuickLinkById,
  getQuickLinkByCommandId,
  getQuickLinkDynamicFieldsById,
  isQuickLinkCommandId,
  resolveQuickLinkUrlTemplate,
} from './quicklink-store';
import {
  searchIndexedFiles,
  getFileSearchIndexStatus,
  rebuildFileSearchIndex,
  startFileSearchIndexing,
  stopFileSearchIndexing,
} from './file-search-index';

const electron = require('electron');
const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell, Menu, Tray, nativeImage, protocol, net, dialog, systemPreferences, clipboard: systemClipboard } = electron;
try {
  app.setName('SuperCmd');
} catch {}

// ─── Native Binary Helpers ──────────────────────────────────────────

/**
 * Resolve the path to a pre-compiled native binary in dist/native/.
 * In packaged apps the dist/native/ directory lives in app.asar.unpacked
 * (see asarUnpack in package.json), so we swap the asar path for the
 * unpacked one — child_process.spawn is not asar-aware.
 */
function resolvePackagedUnpackedPath(candidatePath: string): string {
  if (!app.isPackaged) return candidatePath;
  if (!candidatePath.includes('app.asar')) return candidatePath;
  const unpackedPath = candidatePath.replace('app.asar', 'app.asar.unpacked');
  try {
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
  } catch {}
  return candidatePath;
}

function getNativeBinaryPath(name: string): string {
  const base = path.join(__dirname, '..', 'native', name);
  return resolvePackagedUnpackedPath(base);
}

type WindowManagementLayoutItem = {
  id: string;
  bounds?: {
    position?: { x?: number; y?: number };
    size?: { width?: number; height?: number };
  };
};
type NodeWindowBounds = { x: number; y: number; width: number; height: number };
type NodeWindowInfo = {
  id?: number;
  title?: string;
  path?: string;
  processId?: number;
  bounds?: NodeWindowBounds;
  workArea?: NodeWindowBounds;
};

let cachedElectronLiquidGlassApi: any | null | undefined = undefined;
let hasLoggedLiquidGlassRuntimeIncompatibility = false;
const liquidGlassAppliedWindowIds = new Set<number>();
let windowManagerAccessRequested = false;
let windowManagementTargetWindowId: string | null = null;
let windowManagementTargetWorkArea: { x: number; y: number; width: number; height: number } | null = null;
let launcherEntryWindowManagementTargetWindowId: string | null = null;
let launcherEntryWindowManagementTargetWorkArea: { x: number; y: number; width: number; height: number } | null = null;
const WINDOW_MANAGEMENT_MUTATION_MIN_INTERVAL_MS = 6;
let windowManagementMutationQueue: Promise<void> = Promise.resolve();
let lastWindowManagementMutationAt = 0;
const WINDOW_MANAGER_WORKER_REQUEST_TIMEOUT_MS = 1400;
const WINDOW_MANAGER_WORKER_RECOVERY_BACKOFF_MS = 500;
const WINDOW_MANAGER_WORKER_CRASH_WINDOW_MS = 10000;
type WindowManagerWorkerMethod =
  | 'request-accessibility'
  | 'list-windows'
  | 'get-active-window'
  | 'get-window-by-id'
  | 'set-window-bounds';
type WindowManagerWorkerRequest = {
  id: number;
  method: WindowManagerWorkerMethod;
  payload?: any;
};
type WindowManagerWorkerResponse = {
  id: number;
  ok: boolean;
  result?: any;
  error?: string;
};
let windowManagerWorker: ChildProcess | null = null;
let windowManagerWorkerReqSeq = 0;
let windowManagerWorkerRestartTimer: ReturnType<typeof setTimeout> | null = null;
let windowManagerWorkerCrashTimestamps: number[] = [];
let appInstallWatchers: fs.FSWatcher[] = [];
let appInstallChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const windowManagerWorkerPending = new Map<number, {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

function parseMajorVersion(value: string | undefined): number | null {
  if (!value) return null;
  const major = Number.parseInt(String(value).split('.')[0], 10);
  return Number.isFinite(major) ? major : null;
}

function warnIfElectronLiquidGlassRuntimeLooksIncompatible(): void {
  const electronMajor = parseMajorVersion(process.versions?.electron);
  const nodeMajor = parseMajorVersion(process.versions?.node);
  const likelyIncompatible = (electronMajor !== null && electronMajor < 30) || (nodeMajor !== null && nodeMajor < 22);
  if (likelyIncompatible && !hasLoggedLiquidGlassRuntimeIncompatibility) {
    hasLoggedLiquidGlassRuntimeIncompatibility = true;
    console.warn(
      `[LiquidGlass] Runtime not supported (electron=${process.versions?.electron || 'unknown'}, node=${process.versions?.node || 'unknown'}). ` +
      'electron-liquid-glass is documented for Electron 30+ and Node 22+; falling back only if runtime calls fail.'
    );
  }
}

function getWindowManagerWorkerPath(): string {
  const workerPath = path.join(__dirname, 'window-manager-worker.js');
  return resolvePackagedUnpackedPath(workerPath);
}

function isWindowManagerWorkerAlive(proc: ChildProcess | null): proc is ChildProcess {
  return Boolean(proc && proc.exitCode === null && !proc.killed && proc.connected);
}

function rejectAllWindowManagerWorkerPending(errorMessage: string): void {
  for (const [id, pending] of windowManagerWorkerPending.entries()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(errorMessage));
    windowManagerWorkerPending.delete(id);
  }
}

function trackWindowManagerWorkerCrash(now: number): void {
  windowManagerWorkerCrashTimestamps = windowManagerWorkerCrashTimestamps.filter(
    (value) => now - value <= WINDOW_MANAGER_WORKER_CRASH_WINDOW_MS
  );
  windowManagerWorkerCrashTimestamps.push(now);
  if (windowManagerWorkerCrashTimestamps.length >= 4) {
    windowManagerWorkerCrashTimestamps = [];
    console.warn('[WindowManager] Worker crashed repeatedly; continuing with restart/backoff.');
  }
}

function scheduleWindowManagerWorkerRestart(): void {
  if (windowManagerWorkerRestartTimer) return;
  windowManagerWorkerRestartTimer = setTimeout(() => {
    windowManagerWorkerRestartTimer = null;
    ensureWindowManagerWorker();
  }, WINDOW_MANAGER_WORKER_RECOVERY_BACKOFF_MS);
}

function attachWindowManagerWorkerListeners(proc: ChildProcess): void {
  proc.on('message', (message: WindowManagerWorkerResponse) => {
    if (!message || typeof message !== 'object') return;
    const pending = windowManagerWorkerPending.get(Number(message.id));
    if (!pending) return;
    clearTimeout(pending.timer);
    windowManagerWorkerPending.delete(Number(message.id));
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(new Error(String(message.error || 'window manager worker request failed')));
  });

  proc.on('exit', (_code, signal) => {
    if (windowManagerWorker !== proc) return;
    windowManagerWorker = null;
    const now = Date.now();
    const reason = signal ? `signal ${signal}` : 'unknown exit';
    rejectAllWindowManagerWorkerPending(`[WindowManager] Worker exited (${reason}).`);
    trackWindowManagerWorkerCrash(now);
    scheduleWindowManagerWorkerRestart();
  });

  proc.on('error', (error) => {
    if (windowManagerWorker !== proc) return;
    rejectAllWindowManagerWorkerPending('[WindowManager] Worker error.');
    console.error('[WindowManager] Worker process error:', error);
  });
}

function ensureWindowManagerWorker(): ChildProcess | null {
  if (isWindowManagerWorkerAlive(windowManagerWorker)) return windowManagerWorker;
  try {
    const workerPath = getWindowManagerWorkerPath();
    const proc = fork(workerPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: [],
    });
    windowManagerWorker = proc;
    attachWindowManagerWorkerListeners(proc);
    return proc;
  } catch (error) {
    console.error('[WindowManager] Failed to spawn worker:', error);
    return null;
  }
}

async function callWindowManagerWorker<T>(
  method: WindowManagerWorkerMethod,
  payload?: any,
  timeoutMs: number = WINDOW_MANAGER_WORKER_REQUEST_TIMEOUT_MS
): Promise<T> {
  const sendAttempt = async (): Promise<T> => {
    const proc = ensureWindowManagerWorker();
    if (!proc || !isWindowManagerWorkerAlive(proc)) {
      throw new Error('window manager worker unavailable');
    }
    const id = ++windowManagerWorkerReqSeq;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        windowManagerWorkerPending.delete(id);
        reject(new Error(`[WindowManager] Worker request timed out (${method}).`));
      }, Math.max(250, timeoutMs));
      windowManagerWorkerPending.set(id, { resolve, reject, timer });
      const request: WindowManagerWorkerRequest = { id, method, payload };
      try {
        proc.send(request, (error?: Error | null) => {
          if (!error) return;
          const pending = windowManagerWorkerPending.get(id);
          if (!pending) return;
          clearTimeout(pending.timer);
          windowManagerWorkerPending.delete(id);
          pending.reject(error);
        });
      } catch (error) {
        clearTimeout(timer);
        windowManagerWorkerPending.delete(id);
        reject(error);
      }
    });
  };

  try {
    return await sendAttempt();
  } catch (error) {
    const message = String((error as any)?.message || error || '');
    if (!message.includes('worker unavailable')) {
      throw error;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 90));
  return await sendAttempt();
}

function normalizeNodeWindowInfo(raw: any): NodeWindowInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const idRaw = (raw as any).id;
  const id = typeof idRaw === 'number' ? idRaw : Number(idRaw);
  if (!Number.isFinite(id)) return null;
  const title = String((raw as any).title || '');
  const pathValue = String((raw as any).path || '');
  const processIdRaw = (raw as any).processId;
  const processId = typeof processIdRaw === 'number' ? processIdRaw : Number(processIdRaw);
  const boundsRaw = (raw as any).bounds;
  const workAreaRaw = (raw as any).workArea;
  let bounds: NodeWindowBounds | undefined;
  let workArea: NodeWindowBounds | undefined;
  if (boundsRaw && typeof boundsRaw === 'object') {
    const x = Number((boundsRaw as any).x);
    const y = Number((boundsRaw as any).y);
    const width = Number((boundsRaw as any).width);
    const height = Number((boundsRaw as any).height);
    if ([x, y, width, height].every((value) => Number.isFinite(value))) {
      bounds = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };
    }
  }
  if (workAreaRaw && typeof workAreaRaw === 'object') {
    const x = Number((workAreaRaw as any).x);
    const y = Number((workAreaRaw as any).y);
    const width = Number((workAreaRaw as any).width);
    const height = Number((workAreaRaw as any).height);
    if ([x, y, width, height].every((value) => Number.isFinite(value))) {
      workArea = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };
    }
  }
  return {
    id,
    title,
    path: pathValue,
    processId: Number.isFinite(processId) ? processId : undefined,
    bounds,
    workArea,
  };
}

function isTransientWindowManagerWorkerError(error: any): boolean {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('worker unavailable') ||
    message.includes('worker exited') ||
    message.includes('worker request timed out')
  );
}

function getElectronLiquidGlassApi(): any | null {
  if (cachedElectronLiquidGlassApi !== undefined) {
    return cachedElectronLiquidGlassApi;
  }
  if (process.platform !== 'darwin') {
    cachedElectronLiquidGlassApi = null;
    return cachedElectronLiquidGlassApi;
  }
  warnIfElectronLiquidGlassRuntimeLooksIncompatible();
  try {
    cachedElectronLiquidGlassApi = require('electron-liquid-glass');
    return cachedElectronLiquidGlassApi;
  } catch (error) {
    cachedElectronLiquidGlassApi = null;
    console.warn('[LiquidGlass] Failed to load electron-liquid-glass, using CSS fallback only:', error);
    return cachedElectronLiquidGlassApi;
  }
}

function applyNativeWindowGlassFallback(
  win: any,
  fallbackVibrancy: 'under-window' | 'hud' | 'fullscreen-ui' = 'under-window'
): void {
  if (process.platform !== 'darwin') return;
  try {
    if (typeof win?.setVibrancy === 'function') {
      win.setVibrancy(fallbackVibrancy);
    }
  } catch {}
  try {
    if (typeof win?.setVisualEffectState === 'function') {
      win.setVisualEffectState('active');
    }
  } catch {}
}

function isGlassyUiStyleEnabled(): boolean {
  try {
    const style = String(loadSettings().uiStyle || 'default').trim().toLowerCase();
    return style === 'glassy';
  } catch {
    return false;
  }
}

function shouldUseNativeLiquidGlass(): boolean {
  return process.platform === 'darwin' && isGlassyUiStyleEnabled() && !!getElectronLiquidGlassApi();
}

function syncNativeLiquidGlassClassOnWindow(win: any, enabled: boolean): void {
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return;
  try {
    if (win?.webContents && !win.webContents.isDestroyed() && typeof win.webContents.executeJavaScript === 'function') {
      void win.webContents.executeJavaScript(
        `(() => {
          try {
            const on = ${enabled ? 'true' : 'false'};
            document.documentElement.classList.toggle('sc-native-liquid-glass', on);
            document.body.classList.toggle('sc-native-liquid-glass', on);
          } catch {}
        })()`,
        true
      );
    }
  } catch {}
}

function applyLiquidGlassToWindow(
  win: any,
  options?: {
    cornerRadius?: number;
    fallbackVibrancy?: 'under-window' | 'hud' | 'fullscreen-ui';
    darkTint?: string;
    lightTint?: string;
    subdued?: 0 | 1;
    forceDarkTheme?: boolean;
    forceReapply?: boolean;
  }
): void {
  if (process.platform !== 'darwin') return;
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return;
  if (!isGlassyUiStyleEnabled()) {
    syncNativeLiquidGlassClassOnWindow(win, false);
    return;
  }
  const windowId = Number(win.id);
  if (Number.isFinite(windowId) && liquidGlassAppliedWindowIds.has(windowId) && !options?.forceReapply) {
    syncNativeLiquidGlassClassOnWindow(win, true);
    return;
  }

  const fallbackVibrancy = 'hud';
  const cornerRadius = Number.isFinite(Number(options?.cornerRadius)) ? Number(options?.cornerRadius) : 16;
  const darkTint = String(options?.darkTint || '#10131a42');
  const lightTint = String(options?.lightTint || '#f8fbff26');
  const subdued = options?.subdued ?? 0;
  const forceDarkTheme = options?.forceDarkTheme === true;

  const liquidGlass = getElectronLiquidGlassApi();
  if (!liquidGlass || typeof liquidGlass.addView !== 'function') {
    syncNativeLiquidGlassClassOnWindow(win, false);
    applyNativeWindowGlassFallback(win, fallbackVibrancy);
    return;
  }

  const applyEffect = async () => {
    try {
      let isDarkTheme = forceDarkTheme;
      if (!forceDarkTheme) {
        isDarkTheme = true;
        try {
          if (win?.webContents && !win.webContents.isDestroyed() && typeof win.webContents.executeJavaScript === 'function') {
            const result = await win.webContents.executeJavaScript(
              `(() => {
                try {
                  const pref = String(window.localStorage.getItem('sc-theme-preference') || '').trim().toLowerCase();
                  if (pref === 'dark') return true;
                  if (pref === 'light') return false;
                } catch {}
                return document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
              })()`,
              true
            );
            isDarkTheme = Boolean(result);
          }
        } catch {}
      }

      const glassId = liquidGlass.addView(win.getNativeWindowHandle(), {
        cornerRadius,
        opaque: false,
        // Keep native liquid glass in sync with the app theme (not just macOS appearance).
        tintColor: isDarkTheme ? darkTint : lightTint,
      });
      if (typeof glassId === 'number' && glassId >= 0 && Number.isFinite(windowId)) {
        liquidGlassAppliedWindowIds.add(windowId);
        syncNativeLiquidGlassClassOnWindow(win, true);
      }
      if (typeof glassId === 'number' && glassId >= 0 && typeof liquidGlass.unstable_setSubdued === 'function') {
        try { liquidGlass.unstable_setSubdued(glassId, subdued); } catch {}
      }
    } catch (error) {
      console.warn('[LiquidGlass] Failed to apply liquid glass to window:', error);
      applyNativeWindowGlassFallback(win, fallbackVibrancy);
    }
  };

  try {
    if (win?.webContents && !win.webContents.isDestroyed()) {
      if (typeof win.webContents.isLoadingMainFrame === 'function' && !win.webContents.isLoadingMainFrame()) {
        void applyEffect();
      } else {
        win.webContents.once('did-finish-load', () => { void applyEffect(); });
      }
    } else {
      void applyEffect();
    }
  } catch {
    void applyEffect();
  }

  if (typeof win?.once === 'function' && Number.isFinite(windowId)) {
    win.once('closed', () => {
      liquidGlassAppliedWindowIds.delete(windowId);
    });
  }
}

function applyLiquidGlassToWindowManagerPopup(win: any): void {
  applyLiquidGlassToWindow(win, {
    cornerRadius: 20,
    fallbackVibrancy: 'under-window',
    darkTint: '#16181fd0',
    lightTint: '#f4f6f8b0',
    subdued: 0,
  });
}

async function ensureWindowManagerAccess(): Promise<void> {
  if (process.platform !== 'darwin') return;
  if (windowManagerAccessRequested) return;
  try {
    await callWindowManagerWorker('request-accessibility');
    windowManagerAccessRequested = true;
  } catch (error) {
    console.warn('[WindowManager] Accessibility request failed:', error);
  }
}

function toWindowManagementWindowFromNode(info: NodeWindowInfo | null, active: boolean): any | null {
  if (!info) return null;
  if (!info.id || !info.bounds) return null;
  const x = Number(info.bounds.x);
  const y = Number(info.bounds.y);
  const width = Number(info.bounds.width);
  const height = Number(info.bounds.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  const appPath = String(info.path || '');
  const appName = appPath ? path.basename(appPath).replace(/\\.app$/i, '') : '';

  return {
    id: String(info.id),
    title: String(info.title || ''),
    active,
    bounds: {
      position: { x: Math.round(x), y: Math.round(y) },
      size: { width: Math.round(width), height: Math.round(height) },
    },
    desktopId: '1',
    positionable: true,
    resizable: true,
    fullScreenSettable: true,
    application: {
      name: appName,
      path: appPath,
      bundleId: '',
    },
  };
}

function isSelfManagedWindow(win: NodeWindowInfo | null | undefined): boolean {
  if (!win) return false;
  const processId = typeof win.processId === 'number' ? win.processId : Number(win.processId);
  if (processId && processId === process.pid) return true;
  const appPath = String(win.path || '');
  const appName = String(app.getName() || '');
  if (appPath) {
    const exePath = app.getPath('exe');
    if (appPath === exePath) return true;
    if (appName && appPath.includes(`${appName}.app`)) return true;
    if (appPath.includes('SuperCmd.app')) return true;
  }
  const title = String(win.title || '');
  if (title.toLowerCase().includes('supercmd')) return true;
  return false;
}

async function getNodeWindows(): Promise<NodeWindowInfo[]> {
  try {
    const rawWindows = await callWindowManagerWorker<any[]>('list-windows');
    const windows = Array.isArray(rawWindows)
      ? rawWindows
        .map((entry) => normalizeNodeWindowInfo(entry))
        .filter(Boolean) as NodeWindowInfo[]
      : [];
    return windows.filter((win) => !isSelfManagedWindow(win));
  } catch {
    return [];
  }
}

async function getNodeWindowById(id: string): Promise<NodeWindowInfo | null> {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  try {
    const raw = await callWindowManagerWorker<any>('get-window-by-id', { id: normalizedId });
    const info = normalizeNodeWindowInfo(raw);
    if (!info || isSelfManagedWindow(info)) return null;
    return info;
  } catch {
    return null;
  }
}

async function captureWindowManagementTargetWindow(): Promise<void> {
  let capturedWindowId: string | null = null;
  let capturedWorkArea: { x: number; y: number; width: number; height: number } | null = null;
  try {
    const raw = await callWindowManagerWorker<any>('get-active-window');
    const info = normalizeNodeWindowInfo(raw);
    if (!info || isSelfManagedWindow(info)) return;
    if (info?.id) {
      capturedWindowId = String(info.id);
    }
    capturedWorkArea = normalizeWindowManagementArea(info?.workArea);
    if (!capturedWorkArea) {
      const { screen: electronScreen } = require('electron');
      const bounds = info?.bounds;
      const normalizedBounds = bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) &&
        Number.isFinite(bounds.width) && Number.isFinite(bounds.height) &&
        bounds.width > 0 && bounds.height > 0
        ? {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.max(1, Math.round(bounds.width)),
            height: Math.max(1, Math.round(bounds.height)),
          }
        : null;
      const display = normalizedBounds
        ? electronScreen.getDisplayMatching(normalizedBounds)
        : electronScreen.getDisplayNearestPoint(electronScreen.getCursorScreenPoint());
      capturedWorkArea = normalizeWindowManagementArea(display?.workArea);
    }
  } catch (error) {
    console.warn('[WindowManager] Failed to capture target window:', error);
    return;
  }
  if (capturedWindowId) {
    windowManagementTargetWindowId = capturedWindowId;
  }
  if (capturedWorkArea) {
    windowManagementTargetWorkArea = capturedWorkArea;
  }
}

function findNodeWindowById(id: string, windows: NodeWindowInfo[]): NodeWindowInfo | null {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;
  return windows.find((win) => Number(win?.id) === numericId) || null;
}

function matchNodeWindowForFrontmost(windows: NodeWindowInfo[]): NodeWindowInfo | null {
  const appPath = String(lastFrontmostApp?.path || '').trim();
  if (appPath) {
    const match = windows.find((win) => {
      return String(win.path || '') === appPath;
    });
    if (match) return match;
  }
  const appName = String(lastFrontmostApp?.name || '').trim().toLowerCase();
  if (appName) {
    const match = windows.find((win) => {
      const title = String(win.title || '').toLowerCase();
      const pathValue = String(win.path || '').toLowerCase();
      return title.includes(appName) || pathValue.includes(appName);
    });
    if (match) return match;
  }
  return null;
}

async function getNodeSnapshot(): Promise<{ target: NodeWindowInfo | null; windows: NodeWindowInfo[] }> {
  const windows = await getNodeWindows();
  let target: NodeWindowInfo | null = null;
  if (windowManagementTargetWindowId) {
    target = findNodeWindowById(windowManagementTargetWindowId, windows);
  }
  if (!target) {
    target = matchNodeWindowForFrontmost(windows);
  }
  if (!target) {
    try {
      const activeRaw = await callWindowManagerWorker<any>('get-active-window');
      const activeInfo = normalizeNodeWindowInfo(activeRaw);
      if (activeInfo && !isSelfManagedWindow(activeInfo)) {
        target = findNodeWindowById(String(activeInfo.id || ''), windows) || activeInfo;
      }
    } catch {}
  }
  return { target, windows };
}

// ─── Window Configuration ───────────────────────────────────────────

const DEFAULT_WINDOW_WIDTH = 800;
const DEFAULT_WINDOW_HEIGHT = 500;
const ONBOARDING_WINDOW_WIDTH = 1120;
const ONBOARDING_WINDOW_HEIGHT = 740;
const CURSOR_PROMPT_WINDOW_WIDTH = 500;
const CURSOR_PROMPT_WINDOW_HEIGHT = 90;
const CURSOR_PROMPT_LEFT_OFFSET = 20;
const PROMPT_WINDOW_PREWARM_DELAY_MS = 420;
const WHISPER_WINDOW_WIDTH = 266;
const WHISPER_WINDOW_HEIGHT = 84;
const DETACHED_WHISPER_WINDOW_NAME = 'supercmd-whisper-window';
const DETACHED_WHISPER_ONBOARDING_WINDOW_NAME = 'supercmd-whisper-onboarding-window';
const DETACHED_SPEAK_WINDOW_NAME = 'supercmd-speak-window';
const DETACHED_WINDOW_MANAGER_WINDOW_NAME = 'supercmd-window-manager-window';
const DETACHED_PROMPT_WINDOW_NAME = 'supercmd-prompt-window';
const DETACHED_MEMORY_STATUS_WINDOW_NAME = 'supercmd-memory-status-window';
const DETACHED_WINDOW_QUERY_KEY = 'sc_detached';
const MEMORY_STATUS_WINDOW_WIDTH = 340;
const MEMORY_STATUS_WINDOW_HEIGHT = 60;
const MEMORY_STATUS_AUTOHIDE_MS = 3000;
type LauncherMode = 'default' | 'onboarding' | 'whisper' | 'speak' | 'prompt';

function parsePopupFeatures(rawFeatures: string): {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
} {
  const out: { width?: number; height?: number; x?: number; y?: number } = {};
  const features = String(rawFeatures || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const entry of features) {
    const [rawKey, rawValue] = entry.split('=').map((s) => String(s || '').trim());
    if (!rawKey || rawValue === '') continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    const key = rawKey.toLowerCase();
    if (key === 'width') out.width = Math.max(80, Math.round(value));
    if (key === 'height') out.height = Math.max(36, Math.round(value));
    if (key === 'left') out.x = Math.round(value);
    if (key === 'top') out.y = Math.round(value);
  }
  return out;
}

function resolveDetachedPopupName(details: any): string | null {
  const byFrameName = String(details?.frameName || '').trim();
  if (
    byFrameName === DETACHED_WHISPER_WINDOW_NAME ||
    byFrameName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME ||
    byFrameName === DETACHED_SPEAK_WINDOW_NAME ||
    byFrameName === DETACHED_WINDOW_MANAGER_WINDOW_NAME ||
    byFrameName === DETACHED_PROMPT_WINDOW_NAME ||
    byFrameName === DETACHED_MEMORY_STATUS_WINDOW_NAME ||
    byFrameName.startsWith(`${DETACHED_WHISPER_WINDOW_NAME}-`) ||
    byFrameName.startsWith(`${DETACHED_WHISPER_ONBOARDING_WINDOW_NAME}-`) ||
    byFrameName.startsWith(`${DETACHED_SPEAK_WINDOW_NAME}-`) ||
    byFrameName.startsWith(`${DETACHED_WINDOW_MANAGER_WINDOW_NAME}-`) ||
    byFrameName.startsWith(`${DETACHED_PROMPT_WINDOW_NAME}-`) ||
    byFrameName.startsWith(`${DETACHED_MEMORY_STATUS_WINDOW_NAME}-`)
  ) {
    if (byFrameName.startsWith(DETACHED_WHISPER_WINDOW_NAME)) return DETACHED_WHISPER_WINDOW_NAME;
    if (byFrameName.startsWith(DETACHED_WHISPER_ONBOARDING_WINDOW_NAME)) return DETACHED_WHISPER_ONBOARDING_WINDOW_NAME;
    if (byFrameName.startsWith(DETACHED_SPEAK_WINDOW_NAME)) return DETACHED_SPEAK_WINDOW_NAME;
    if (byFrameName.startsWith(DETACHED_WINDOW_MANAGER_WINDOW_NAME)) return DETACHED_WINDOW_MANAGER_WINDOW_NAME;
    if (byFrameName.startsWith(DETACHED_PROMPT_WINDOW_NAME)) return DETACHED_PROMPT_WINDOW_NAME;
    if (byFrameName.startsWith(DETACHED_MEMORY_STATUS_WINDOW_NAME)) return DETACHED_MEMORY_STATUS_WINDOW_NAME;
    return byFrameName;
  }
  const rawUrl = String(details?.url || '').trim();
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const byQuery = String(parsed.searchParams.get(DETACHED_WINDOW_QUERY_KEY) || '').trim();
    if (
      byQuery === DETACHED_WHISPER_WINDOW_NAME ||
      byQuery === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME ||
      byQuery === DETACHED_SPEAK_WINDOW_NAME ||
      byQuery === DETACHED_WINDOW_MANAGER_WINDOW_NAME ||
      byQuery === DETACHED_PROMPT_WINDOW_NAME ||
      byQuery === DETACHED_MEMORY_STATUS_WINDOW_NAME
    ) {
      return byQuery;
    }
  } catch {}
  return null;
}

function computeDetachedPopupPosition(
  popupName: string,
  width: number,
  height: number
): { x: number; y: number } {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const workArea = display?.workArea || screen.getPrimaryDisplay().workArea;

  if (popupName === DETACHED_SPEAK_WINDOW_NAME) {
    return {
      x: workArea.x + workArea.width - width - 20,
      y: workArea.y + 16,
    };
  }

  if (popupName === DETACHED_WINDOW_MANAGER_WINDOW_NAME) {
    return {
      x: workArea.x + workArea.width - width - 20,
      y: workArea.y + workArea.height - height - 20,
    };
  }

  if (popupName === DETACHED_MEMORY_STATUS_WINDOW_NAME) {
    return {
      x: workArea.x + workArea.width - width - 20,
      y: workArea.y + 16,
    };
  }

  if (popupName === DETACHED_PROMPT_WINDOW_NAME) {
    const caretRect = getTypingCaretRect();
    const focusedInputRect = getFocusedInputRect();
    const promptAnchorPoint = caretRect
      ? {
          x: caretRect.x,
          y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
        }
      : focusedInputRect
        ? {
            x: focusedInputRect.x + 12,
            y: focusedInputRect.y + 18,
          }
        : lastTypingCaretPoint;
    if (caretRect) {
      lastTypingCaretPoint = {
        x: caretRect.x,
        y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
      };
    } else if (focusedInputRect) {
      lastTypingCaretPoint = {
        x: focusedInputRect.x + 12,
        y: focusedInputRect.y + 18,
      };
    }
    if (!promptAnchorPoint) {
      return {
        x: workArea.x + Math.floor((workArea.width - width) / 2),
        y: workArea.y + workArea.height - height - 14,
      };
    }
    const display = screen.getDisplayNearestPoint(promptAnchorPoint);
    const area = display?.workArea || workArea;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const x = clamp(
      promptAnchorPoint.x - CURSOR_PROMPT_LEFT_OFFSET,
      area.x + 8,
      area.x + area.width - width - 8
    );
    const baseY = caretRect ? caretRect.y : focusedInputRect ? focusedInputRect.y : promptAnchorPoint.y;
    const preferred = baseY - height - 10;
    const y = preferred >= area.y + 8
      ? preferred
      : clamp(baseY + 16, area.y + 8, area.y + area.height - height - 8);
    return { x, y };
  }

  if (popupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME) {
    return {
      x: workArea.x + Math.floor((workArea.width - width) / 2),
      y: workArea.y + Math.floor((workArea.height - height) / 2),
    };
  }

  return {
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - 14,
  };
}

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let promptWindow: InstanceType<typeof BrowserWindow> | null = null;
let promptWindowPrewarmScheduled = false;
let memoryStatusWindow: InstanceType<typeof BrowserWindow> | null = null;
let memoryStatusHideTimer: NodeJS.Timeout | null = null;
let memoryStatusRenderSeq = 0;
let memoryStatusHideTimerSeq = 0;
let settingsWindow: InstanceType<typeof BrowserWindow> | null = null;
let extensionStoreWindow: InstanceType<typeof BrowserWindow> | null = null;
let isVisible = false;
let suppressBlurHide = false; // When true, blur won't hide the window (used during file dialogs)
let oauthBlurHideSuppressionDepth = 0; // Keep launcher alive while OAuth browser flow is in progress
let oauthBlurHideSuppressionTimer: NodeJS.Timeout | null = null;
const OAUTH_BLUR_SUPPRESSION_TIMEOUT_MS = 3 * 60 * 1000;
let currentShortcut = '';
const DEVTOOLS_SHORTCUT = normalizeAccelerator('CommandOrControl+Option+I');
let globalShortcutRegistrationState: {
  requestedShortcut: string;
  activeShortcut: string;
  ok: boolean;
} = {
  requestedShortcut: '',
  activeShortcut: '',
  ok: true,
};
const OPENING_SHORTCUT_SUPPRESSION_MS = 220;
let openingShortcutSuppressionUntil = 0;
let openingShortcutToSuppress = '';

function getMemoryStatusWindowHtml(
  variant: 'processing' | 'success' | 'error' = 'processing',
  text: string = ''
): string {
  const safeVariant =
    variant === 'success' || variant === 'error' ? variant : 'processing';
  const safeText = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
      -webkit-font-smoothing: antialiased;
      user-select: none;
      pointer-events: none;
    }
    .wrap {
      width: 100%;
      height: 100%;
      padding: 6px;
      box-sizing: border-box;
    }
    .card {
      height: 100%;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(12,12,14,0.78);
      box-shadow: 0 12px 32px rgba(0,0,0,0.35);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 12px;
      box-sizing: border-box;
      color: rgba(255,255,255,0.92);
    }
    .card.success {
      border-color: rgba(52, 211, 153, 0.28);
      background: rgba(2, 44, 34, 0.72);
      color: rgb(209, 250, 229);
    }
    .card.error {
      border-color: rgba(251, 113, 133, 0.3);
      background: rgba(76, 5, 25, 0.72);
      color: rgb(255, 228, 230);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: rgba(255,255,255,0.9);
      flex: 0 0 auto;
      box-shadow: 0 0 0 4px rgba(255,255,255,0.10);
    }
    .card.processing .dot {
      animation: pulse 1s ease-in-out infinite;
    }
    .card.success .dot {
      background: rgb(52, 211, 153);
      box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.18);
    }
    .card.error .dot {
      background: rgb(251, 113, 133);
      box-shadow: 0 0 0 4px rgba(251, 113, 133, 0.18);
    }
    .text {
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(0.9); opacity: 0.85; }
      50% { transform: scale(1.15); opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div id="card" class="card ${safeVariant}">
      <div class="dot"></div>
      <div id="text" class="text">${safeText}</div>
    </div>
  </div>
</body>
</html>`;
}

function clearMemoryStatusHideTimer(): void {
  if (!memoryStatusHideTimer) return;
  clearTimeout(memoryStatusHideTimer);
  memoryStatusHideTimer = null;
  memoryStatusHideTimerSeq = 0;
}

function hideMemoryStatusBar(): void {
  clearMemoryStatusHideTimer();
  memoryStatusRenderSeq += 1;
  if (!memoryStatusWindow || memoryStatusWindow.isDestroyed()) return;
  try {
    memoryStatusWindow.hide();
  } catch {}
}

async function ensureMemoryStatusWindow(): Promise<InstanceType<typeof BrowserWindow> | null> {
  if (memoryStatusWindow && !memoryStatusWindow.isDestroyed()) return memoryStatusWindow;
  memoryStatusWindow = new BrowserWindow({
    width: MEMORY_STATUS_WINDOW_WIDTH,
    height: MEMORY_STATUS_WINDOW_HEIGHT,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  try { memoryStatusWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  try { memoryStatusWindow.setIgnoreMouseEvents(true, { forward: true }); } catch {}
  if (process.platform === 'darwin') {
    try { memoryStatusWindow.setWindowButtonVisibility(false); } catch {}
  }
  memoryStatusWindow.on('closed', () => {
    memoryStatusRenderSeq += 1;
    memoryStatusWindow = null;
    clearMemoryStatusHideTimer();
  });
  try {
    await memoryStatusWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getMemoryStatusWindowHtml())}`);
  } catch (error) {
    console.warn('[MemoryStatus] Failed to load status window:', error);
    try { memoryStatusWindow.close(); } catch {}
    memoryStatusWindow = null;
    return null;
  }
  return memoryStatusWindow;
}

async function renderMemoryStatusBarContent(
  win: InstanceType<typeof BrowserWindow>,
  payload: { variant: 'processing' | 'success' | 'error'; text: string },
  renderSeq: number,
): Promise<void> {
  if (!memoryStatusWindow || memoryStatusWindow.isDestroyed()) return;
  if (renderSeq !== memoryStatusRenderSeq) return;
  if (!win.webContents || win.webContents.isDestroyed()) return;
  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        getMemoryStatusWindowHtml(payload.variant, payload.text)
      )}`
    );
  } catch (error) {
    if (renderSeq === memoryStatusRenderSeq) {
      console.warn('[MemoryStatus] Failed to render status content:', error);
    }
  }
}

async function showMemoryStatusBar(
  variant: 'processing' | 'success' | 'error',
  text: string
): Promise<void> {
  const renderSeq = ++memoryStatusRenderSeq;
  const win = await ensureMemoryStatusWindow();
  if (!win) return;
  clearMemoryStatusHideTimer();
  const pos = computeDetachedPopupPosition(
    DETACHED_MEMORY_STATUS_WINDOW_NAME,
    MEMORY_STATUS_WINDOW_WIDTH,
    MEMORY_STATUS_WINDOW_HEIGHT
  );
  try {
    win.setBounds({
      x: pos.x,
      y: pos.y,
      width: MEMORY_STATUS_WINDOW_WIDTH,
      height: MEMORY_STATUS_WINDOW_HEIGHT,
    });
  } catch {}
  try {
    if (win.webContents && !win.webContents.isDestroyed()) {
      await renderMemoryStatusBarContent(win, { variant, text: String(text || '') }, renderSeq);
    }
  } catch {}
  if (renderSeq !== memoryStatusRenderSeq) return;
  try {
    if (!win.isVisible()) {
      if (typeof (win as any).showInactive === 'function') (win as any).showInactive();
      else win.show();
    } else {
      win.show();
    }
    win.moveTop();
  } catch {}

  if (variant !== 'processing') {
    if (renderSeq !== memoryStatusRenderSeq) return;
    memoryStatusHideTimerSeq = renderSeq;
    memoryStatusHideTimer = setTimeout(() => {
      if (memoryStatusHideTimerSeq !== renderSeq) return;
      hideMemoryStatusBar();
    }, MEMORY_STATUS_AUTOHIDE_MS);
  }
}
type AppUpdaterState =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';
type AppUpdaterStatusSnapshot = {
  state: AppUpdaterState;
  supported: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseDate?: string;
  progressPercent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  message?: string;
};
let appUpdaterConfigured = false;
let appUpdater: any | null = null;
let appUpdaterCheckPromise: Promise<void> | null = null;
let appUpdaterDownloadPromise: Promise<void> | null = null;
const APP_UPDATER_AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let appUpdaterAutoCheckTimer: NodeJS.Timeout | null = null;
let appUpdaterStatusSnapshot: AppUpdaterStatusSnapshot = {
  state: 'idle',
  supported: false,
  currentVersion: app.getVersion(),
  progressPercent: 0,
  transferredBytes: 0,
  totalBytes: 0,
  bytesPerSecond: 0,
};

function readAppUpdaterLastCheckedAt(): number {
  const raw = Number((loadSettings() as any).appUpdaterLastCheckedAt || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

function persistAppUpdaterLastCheckedAt(timestampMs: number): void {
  const safeValue = Math.max(0, Math.floor(Number(timestampMs) || 0));
  const current = readAppUpdaterLastCheckedAt();
  if (safeValue <= 0 || current === safeValue) return;
  saveSettings({ appUpdaterLastCheckedAt: safeValue } as Partial<AppSettings>);
}

function clearAppUpdaterAutoCheckTimer(): void {
  if (appUpdaterAutoCheckTimer) {
    clearTimeout(appUpdaterAutoCheckTimer);
    appUpdaterAutoCheckTimer = null;
  }
}

function scheduleNextAppUpdaterAutoCheck(lastCheckedAtMs: number): void {
  clearAppUpdaterAutoCheckTimer();
  if (!app.isPackaged) return;
  const ageMs = Math.max(0, Date.now() - Math.max(0, lastCheckedAtMs));
  const delayMs = Math.max(60_000, APP_UPDATER_AUTO_CHECK_INTERVAL_MS - ageMs);
  appUpdaterAutoCheckTimer = setTimeout(() => {
    appUpdaterAutoCheckTimer = null;
    void runBackgroundAppUpdaterCheck();
  }, delayMs);
}
type FrontmostAppContext = { name: string; path: string; bundleId?: string };
let lastFrontmostApp: FrontmostAppContext | null = null;
let launcherEntryFrontmostApp: FrontmostAppContext | null = null;
const registeredHotkeys = new Map<string, string>(); // shortcut → commandId
const activeAIRequests = new Map<string, AbortController>(); // requestId → controller
const pendingOAuthCallbackUrls: string[] = [];
const AUTO_OPEN_DEVTOOLS_ON_START = process.env.SC_OPEN_DEVTOOLS_ON_START !== '0';
let snippetExpanderProcess: any = null;
let snippetExpanderStdoutBuffer = '';
let nativeSpeechProcess: any = null;
let nativeSpeechStdoutBuffer = '';
let nativeColorPickerPromise: Promise<any> | null = null;
let whisperHoldWatcherProcess: any = null;
let whisperHoldWatcherStdoutBuffer = '';
let whisperHoldRequestSeq = 0;
let whisperHoldReleasedSeq = 0;
let whisperHoldWatcherSeq = 0;
let fnSpeakToggleWatcherProcess: any = null;
let fnSpeakToggleWatcherStdoutBuffer = '';
let fnSpeakToggleWatcherRestartTimer: NodeJS.Timeout | null = null;
let fnSpeakToggleWatcherEnabled = false;
const fnCommandWatcherProcesses = new Map<string, any>();
const fnCommandWatcherStdoutBuffers = new Map<string, string>();
const fnCommandWatcherRestartTimers = new Map<string, NodeJS.Timeout>();
const fnCommandWatcherConfigs = new Map<string, string>();
// When true, the Fn watcher is allowed to start even during onboarding (step 4 — Dictation test).
let fnWatcherOnboardingOverride = false;
let fnSpeakToggleLastPressedAt = 0;
let fnSpeakToggleIsPressed = false;
type LocalSpeakBackend = 'edge-tts' | 'system-say';
let edgeTtsConstructorResolved = false;
let edgeTtsConstructor: any | null = null;
let edgeTtsConstructorError = '';
type SpeakChunkPrepared = {
  index: number;
  text: string;
  audioPath: string;
  wordCues: Array<{ start: number; end: number; wordIndex: number }>;
  durationMs?: number;
};
type SpeakRuntimeOptions = {
  voice: string;
  rate: string;
};
type EdgeTtsVoiceCatalogEntry = {
  id: string;
  label: string;
  languageCode: string;
  languageLabel: string;
  gender: 'female' | 'male';
  style?: string;
};
let speakStatusSnapshot: {
  state: 'idle' | 'loading' | 'speaking' | 'done' | 'error';
  text: string;
  index: number;
  total: number;
  message?: string;
  wordIndex?: number;
} = { state: 'idle', text: '', index: 0, total: 0 };
let speakRuntimeOptions: SpeakRuntimeOptions = {
  voice: 'en-US-EricNeural',
  rate: '+0%',
};

function setLauncherOverlayTopmost(enabled: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setAlwaysOnTop(Boolean(enabled));
  } catch {}
  try {
    if (enabled) {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } else {
      mainWindow.setVisibleOnAllWorkspaces(false);
    }
  } catch {}
}

function clearOAuthBlurHideSuppression(): void {
  oauthBlurHideSuppressionDepth = 0;
  if (oauthBlurHideSuppressionTimer) {
    clearTimeout(oauthBlurHideSuppressionTimer);
    oauthBlurHideSuppressionTimer = null;
  }
  setLauncherOverlayTopmost(true);
}

function setOAuthBlurHideSuppression(active: boolean): void {
  if (active) {
    oauthBlurHideSuppressionDepth += 1;
    setLauncherOverlayTopmost(false);
    try {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
        mainWindow.blur();
      }
    } catch {}
  } else {
    oauthBlurHideSuppressionDepth = Math.max(0, oauthBlurHideSuppressionDepth - 1);
  }
  if (oauthBlurHideSuppressionDepth > 0) {
    if (oauthBlurHideSuppressionTimer) {
      clearTimeout(oauthBlurHideSuppressionTimer);
    }
    oauthBlurHideSuppressionTimer = setTimeout(() => {
      clearOAuthBlurHideSuppression();
    }, OAUTH_BLUR_SUPPRESSION_TIMEOUT_MS);
    return;
  }
  if (oauthBlurHideSuppressionTimer) {
    clearTimeout(oauthBlurHideSuppressionTimer);
    oauthBlurHideSuppressionTimer = null;
  }
  setLauncherOverlayTopmost(true);
}
let edgeVoiceCatalogCache: { expiresAt: number; voices: EdgeTtsVoiceCatalogEntry[] } | null = null;
let speakSessionCounter = 0;
let activeSpeakSession: {
  id: number;
  stopRequested: boolean;
  playbackGeneration: number;
  currentIndex: number;
  chunks: string[];
  tmpDir: string;
  chunkPromises: Map<string, Promise<SpeakChunkPrepared>>;
  afplayProc: any | null;
  ttsProcesses: Set<any>;
  restartFrom: (index: number) => void;
} | null = null;
let launcherMode: LauncherMode = 'default';
let lastWhisperToggleAt = 0;
let lastWhisperShownAt = 0;
const INTERNAL_CLIPBOARD_PROBE_REGEX = /^__supercmd_[a-z0-9_]+_probe__\d+_[a-z0-9]+$/i;
const WINDOW_MANAGEMENT_PRESET_COMMAND_IDS = new Set<string>([
  'system-window-management-left',
  'system-window-management-right',
  'system-window-management-top',
  'system-window-management-bottom',
  'system-window-management-center',
  'system-window-management-center-80',
  'system-window-management-fill',
  'system-window-management-top-left',
  'system-window-management-top-right',
  'system-window-management-bottom-left',
  'system-window-management-bottom-right',
  'system-window-management-first-third',
  'system-window-management-center-third',
  'system-window-management-last-third',
  'system-window-management-first-two-thirds',
  'system-window-management-center-two-thirds',
  'system-window-management-last-two-thirds',
  'system-window-management-first-fourth',
  'system-window-management-second-fourth',
  'system-window-management-third-fourth',
  'system-window-management-last-fourth',
  'system-window-management-first-three-fourths',
  'system-window-management-center-three-fourths',
  'system-window-management-last-three-fourths',
  'system-window-management-top-left-sixth',
  'system-window-management-top-center-sixth',
  'system-window-management-top-right-sixth',
  'system-window-management-bottom-left-sixth',
  'system-window-management-bottom-center-sixth',
  'system-window-management-bottom-right-sixth',
  'system-window-management-auto-organize',
  'system-window-management-increase-size-10',
  'system-window-management-decrease-size-10',
  'system-window-management-increase-left-10',
  'system-window-management-increase-right-10',
  'system-window-management-increase-top-10',
  'system-window-management-increase-bottom-10',
  'system-window-management-decrease-left-10',
  'system-window-management-decrease-right-10',
  'system-window-management-decrease-top-10',
  'system-window-management-decrease-bottom-10',
  'system-window-management-move-up-10',
  'system-window-management-move-down-10',
  'system-window-management-move-left-10',
  'system-window-management-move-right-10',
]);
const WINDOW_MANAGEMENT_FINE_TUNE_COMMAND_IDS = new Set<string>([
  'system-window-management-increase-size-10',
  'system-window-management-decrease-size-10',
  'system-window-management-increase-left-10',
  'system-window-management-increase-right-10',
  'system-window-management-increase-top-10',
  'system-window-management-increase-bottom-10',
  'system-window-management-decrease-left-10',
  'system-window-management-decrease-right-10',
  'system-window-management-decrease-top-10',
  'system-window-management-decrease-bottom-10',
  'system-window-management-move-up-10',
  'system-window-management-move-down-10',
  'system-window-management-move-left-10',
  'system-window-management-move-right-10',
]);
const WINDOW_MANAGEMENT_LAYOUT_COMMAND_IDS = new Set<string>([
  'system-window-management-left',
  'system-window-management-right',
  'system-window-management-top',
  'system-window-management-bottom',
  'system-window-management-center',
  'system-window-management-center-80',
  'system-window-management-fill',
  'system-window-management-top-left',
  'system-window-management-top-right',
  'system-window-management-bottom-left',
  'system-window-management-bottom-right',
  'system-window-management-first-third',
  'system-window-management-center-third',
  'system-window-management-last-third',
  'system-window-management-first-two-thirds',
  'system-window-management-center-two-thirds',
  'system-window-management-last-two-thirds',
  'system-window-management-first-fourth',
  'system-window-management-second-fourth',
  'system-window-management-third-fourth',
  'system-window-management-last-fourth',
  'system-window-management-first-three-fourths',
  'system-window-management-center-three-fourths',
  'system-window-management-last-three-fourths',
  'system-window-management-top-left-sixth',
  'system-window-management-top-center-sixth',
  'system-window-management-top-right-sixth',
  'system-window-management-bottom-left-sixth',
  'system-window-management-bottom-center-sixth',
  'system-window-management-bottom-right-sixth',
]);
const WINDOW_MANAGEMENT_FINE_TUNE_RATIO = 0.1;
const WINDOW_MANAGEMENT_FINE_TUNE_MIN_WIDTH = 120;
const WINDOW_MANAGEMENT_FINE_TUNE_MIN_HEIGHT = 60;
const WINDOW_MANAGEMENT_FINE_TUNE_COMMAND_PREFIX = 'system-window-management-';
let nativeWindowFineTuneSupport: boolean | null = null;
type QueuedWindowMutation = { id: string; x: number; y: number; width: number; height: number };
const WINDOW_MANAGEMENT_MUTATION_BATCH_MS = 6;
const WINDOW_MANAGEMENT_PRESET_HOTKEY_MIN_INTERVAL_MS = 18;
let pendingWindowMutationsById = new Map<string, QueuedWindowMutation>();
let windowMutationBatchTimer: ReturnType<typeof setTimeout> | null = null;
let windowMutationBatchInFlight = false;
let windowMutationFlushWaiters: Array<(value: boolean) => void> = [];
let lastWindowManagementPresetHotkeyAt = 0;

function isWindowManagementSystemCommand(commandId: string): boolean {
  const normalized = String(commandId || '').trim();
  return normalized === 'system-window-management' || WINDOW_MANAGEMENT_PRESET_COMMAND_IDS.has(normalized);
}

function isWindowManagementFineTuneCommand(commandId: string): boolean {
  const normalized = String(commandId || '').trim();
  return WINDOW_MANAGEMENT_FINE_TUNE_COMMAND_IDS.has(normalized);
}

function isWindowManagementLayoutCommand(commandId: string): boolean {
  const normalized = String(commandId || '').trim();
  return WINDOW_MANAGEMENT_LAYOUT_COMMAND_IDS.has(normalized);
}

function clampWindowManagementFineTuneValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max <= min) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeWindowManagementArea(
  raw: { x?: number; y?: number; width?: number; height?: number } | null | undefined
): { x: number; y: number; width: number; height: number } | null {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  const width = Number(raw?.width);
  const height = Number(raw?.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function getNativeWindowFineTuneAction(commandId: string): string | null {
  const normalized = String(commandId || '').trim();
  if (!normalized.startsWith(WINDOW_MANAGEMENT_FINE_TUNE_COMMAND_PREFIX)) return null;
  const action = normalized.slice(WINDOW_MANAGEMENT_FINE_TUNE_COMMAND_PREFIX.length);
  if (!action) return null;
  if (!WINDOW_MANAGEMENT_FINE_TUNE_COMMAND_IDS.has(`${WINDOW_MANAGEMENT_FINE_TUNE_COMMAND_PREFIX}${action}`)) {
    return null;
  }
  return action;
}

function getNativeWindowLayoutAction(commandId: string): string | null {
  const normalized = String(commandId || '').trim();
  if (!normalized.startsWith(WINDOW_MANAGEMENT_FINE_TUNE_COMMAND_PREFIX)) return null;
  if (!WINDOW_MANAGEMENT_LAYOUT_COMMAND_IDS.has(normalized)) return null;
  const action = normalized.slice(WINDOW_MANAGEMENT_FINE_TUNE_COMMAND_PREFIX.length);
  return action || null;
}

async function executeNativeWindowAdjustByAction(
  action: string,
  targetHint?: {
    bundleId?: string;
    appPath?: string;
    windowId?: string;
    workArea?: { x: number; y: number; width: number; height: number } | null;
  }
): Promise<boolean | null> {
  if (process.platform !== 'darwin') return null;
  const normalizedAction = String(action || '').trim();
  if (!normalizedAction) return null;
  if (nativeWindowFineTuneSupport === false) return null;

  const fsNative = require('fs');
  const helperPath = getNativeBinaryPath('window-adjust');
  const nativeAdjustTimeoutMs = app.isPackaged ? 1500 : 600;
  if (nativeWindowFineTuneSupport === null && !fsNative.existsSync(helperPath)) {
    nativeWindowFineTuneSupport = false;
    return null;
  }

  try {
    const { execFile } = require('child_process');
    const args = [normalizedAction];
    const hintedBundleId = String(targetHint?.bundleId || '').trim();
    const hintedAppPath = String(targetHint?.appPath || '').trim();
    const hintedWindowId = Math.trunc(Number(targetHint?.windowId));
    const hintedWorkArea = cloneWorkArea(targetHint?.workArea || null);
    if (hintedBundleId && hintedBundleId !== 'com.supercmd.app' && hintedBundleId !== 'com.supercmd') {
      args.push('--bundle-id', hintedBundleId);
    }
    if (hintedAppPath && !hintedAppPath.includes('/SuperCmd.app')) {
      args.push('--app-path', hintedAppPath);
    }
    if (Number.isFinite(hintedWindowId) && hintedWindowId > 0) {
      args.push('--window-id', String(hintedWindowId));
    }
    if (hintedWorkArea) {
      args.push(
        '--area-x', String(hintedWorkArea.x),
        '--area-y', String(hintedWorkArea.y),
        '--area-width', String(hintedWorkArea.width),
        '--area-height', String(hintedWorkArea.height)
      );
    }
    const parsed = await new Promise<{ ok: boolean; error?: string } | null>((resolve) => {
      execFile(
        helperPath,
        args,
        { encoding: 'utf-8', timeout: nativeAdjustTimeoutMs },
        (error: Error | null, stdout: string, _stderr: string) => {
          const raw = String(stdout || '').trim();
          if (!raw) {
            const errorMessage = String((error as any)?.message || '');
            if (errorMessage.includes('ENOENT')) {
              nativeWindowFineTuneSupport = false;
            } else if (errorMessage) {
              console.warn(`[WindowManager] Native window helper failed (${normalizedAction}):`, errorMessage);
            }
            resolve(null);
            return;
          }
          try {
            const payloadLine = raw
              .split(/\r?\n/)
              .map((line) => String(line || '').trim())
              .filter(Boolean)
              .reverse()
              .find((line) => line.startsWith('{') && line.endsWith('}'));
            if (!payloadLine) {
              resolve(null);
              return;
            }
            const payload = JSON.parse(payloadLine);
            if (typeof payload?.ok !== 'boolean') {
              resolve(null);
              return;
            }
            resolve({
              ok: Boolean(payload.ok),
              error: typeof payload?.error === 'string' ? payload.error : undefined,
            });
          } catch {
            resolve(null);
          }
        }
      );
    });

    if (!parsed) return null;
    nativeWindowFineTuneSupport = true;
    return parsed.ok;
  } catch (error: any) {
    if (String(error?.message || '').includes('ENOENT')) {
      nativeWindowFineTuneSupport = false;
    }
    return null;
  }
}

async function executeNativeWindowFineTune(
  commandId: string,
  targetHint?: {
    bundleId?: string;
    appPath?: string;
    windowId?: string;
    workArea?: { x: number; y: number; width: number; height: number } | null;
  }
): Promise<boolean | null> {
  const action = getNativeWindowFineTuneAction(commandId);
  if (!action) return null;
  return await executeNativeWindowAdjustByAction(action, targetHint);
}

async function executeNativeWindowLayout(
  commandId: string,
  targetHint?: {
    bundleId?: string;
    appPath?: string;
    windowId?: string;
    workArea?: { x: number; y: number; width: number; height: number } | null;
  }
): Promise<boolean | null> {
  const action = getNativeWindowLayoutAction(commandId);
  if (!action) return null;
  return await executeNativeWindowAdjustByAction(action, targetHint);
}

function computeWindowManagementFineTuneBounds(
  commandId: string,
  base: NodeWindowBounds,
  area: { x: number; y: number; width: number; height: number }
): NodeWindowBounds | null {
  const normalized = String(commandId || '').trim();
  const areaRight = area.x + area.width;
  const areaBottom = area.y + area.height;
  const stepX = Math.max(1, Math.round(base.width * WINDOW_MANAGEMENT_FINE_TUNE_RATIO));
  const stepY = Math.max(1, Math.round(base.height * WINDOW_MANAGEMENT_FINE_TUNE_RATIO));
  let next: NodeWindowBounds = { ...base };

  switch (normalized) {
    case 'system-window-management-increase-size-10':
      next = {
        x: base.x - Math.round(stepX / 2),
        y: base.y - Math.round(stepY / 2),
        width: base.width + stepX,
        height: base.height + stepY,
      };
      break;
    case 'system-window-management-decrease-size-10':
      next = {
        x: base.x + Math.round(stepX / 2),
        y: base.y + Math.round(stepY / 2),
        width: Math.max(WINDOW_MANAGEMENT_FINE_TUNE_MIN_WIDTH, base.width - stepX),
        height: Math.max(WINDOW_MANAGEMENT_FINE_TUNE_MIN_HEIGHT, base.height - stepY),
      };
      break;
    case 'system-window-management-increase-left-10': {
      const rightEdge = base.x + base.width;
      const leftEdge = base.x - stepX;
      next = {
        x: leftEdge,
        y: base.y,
        width: rightEdge - leftEdge,
        height: base.height,
      };
      break;
    }
    case 'system-window-management-increase-right-10':
      next = {
        x: base.x,
        y: base.y,
        width: base.width + stepX,
        height: base.height,
      };
      break;
    case 'system-window-management-increase-top-10': {
      const bottomEdge = base.y + base.height;
      const topEdge = base.y - stepY;
      next = {
        x: base.x,
        y: topEdge,
        width: base.width,
        height: bottomEdge - topEdge,
      };
      break;
    }
    case 'system-window-management-increase-bottom-10':
      next = {
        x: base.x,
        y: base.y,
        width: base.width,
        height: base.height + stepY,
      };
      break;
    case 'system-window-management-decrease-left-10': {
      const rightEdge = base.x + base.width;
      const width = Math.max(WINDOW_MANAGEMENT_FINE_TUNE_MIN_WIDTH, base.width - stepX);
      next = {
        x: rightEdge - width,
        y: base.y,
        width,
        height: base.height,
      };
      break;
    }
    case 'system-window-management-decrease-right-10':
      next = {
        x: base.x,
        y: base.y,
        width: Math.max(WINDOW_MANAGEMENT_FINE_TUNE_MIN_WIDTH, base.width - stepX),
        height: base.height,
      };
      break;
    case 'system-window-management-decrease-top-10': {
      const bottomEdge = base.y + base.height;
      const height = Math.max(WINDOW_MANAGEMENT_FINE_TUNE_MIN_HEIGHT, base.height - stepY);
      next = {
        x: base.x,
        y: bottomEdge - height,
        width: base.width,
        height,
      };
      break;
    }
    case 'system-window-management-decrease-bottom-10':
      next = {
        x: base.x,
        y: base.y,
        width: base.width,
        height: Math.max(WINDOW_MANAGEMENT_FINE_TUNE_MIN_HEIGHT, base.height - stepY),
      };
      break;
    case 'system-window-management-move-up-10':
      next = { ...base, y: base.y - stepY };
      break;
    case 'system-window-management-move-down-10':
      next = { ...base, y: base.y + stepY };
      break;
    case 'system-window-management-move-left-10':
      next = { ...base, x: base.x - stepX };
      break;
    case 'system-window-management-move-right-10':
      next = { ...base, x: base.x + stepX };
      break;
    default:
      return null;
  }

  next.width = clampWindowManagementFineTuneValue(
    Math.round(next.width),
    WINDOW_MANAGEMENT_FINE_TUNE_MIN_WIDTH,
    area.width
  );
  next.height = clampWindowManagementFineTuneValue(
    Math.round(next.height),
    WINDOW_MANAGEMENT_FINE_TUNE_MIN_HEIGHT,
    area.height
  );
  next.x = clampWindowManagementFineTuneValue(Math.round(next.x), area.x, areaRight - next.width);
  next.y = clampWindowManagementFineTuneValue(Math.round(next.y), area.y, areaBottom - next.height);
  return next;
}

function doesWindowIntersectArea(
  bounds: NodeWindowBounds | null | undefined,
  area: { x: number; y: number; width: number; height: number }
): boolean {
  if (!bounds) return false;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const areaRight = area.x + area.width;
  const areaBottom = area.y + area.height;
  return right > area.x && bounds.x < areaRight && bottom > area.y && bounds.y < areaBottom;
}

function sortNodeWindowsForLayout(windows: NodeWindowInfo[]): NodeWindowInfo[] {
  return [...windows].sort((a, b) => {
    const ay = Number(a.bounds?.y || 0);
    const by = Number(b.bounds?.y || 0);
    if (ay !== by) return ay - by;
    const ax = Number(a.bounds?.x || 0);
    const bx = Number(b.bounds?.x || 0);
    if (ax !== bx) return ax - bx;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function computeWindowManagementLayoutBounds(
  commandId: string,
  area: { x: number; y: number; width: number; height: number }
): NodeWindowBounds | null {
  const normalized = String(commandId || '').trim();
  const halfWidthLeft = Math.max(1, Math.floor(area.width / 2));
  const halfWidthRight = Math.max(1, area.width - halfWidthLeft);
  const halfHeightTop = Math.max(1, Math.floor(area.height / 2));
  const halfHeightBottom = Math.max(1, area.height - halfHeightTop);
  const areaRight = area.x + area.width;
  const areaBottom = area.y + area.height;
  const oneThirdX = area.x + Math.floor(area.width / 3);
  const twoThirdX = area.x + Math.floor((area.width * 2) / 3);
  const oneFourthX = area.x + Math.floor(area.width / 4);
  const halfX = area.x + Math.floor(area.width / 2);
  const threeFourthX = area.x + Math.floor((area.width * 3) / 4);
  const oneEighthX = area.x + Math.floor(area.width / 8);
  const sevenEighthX = area.x + Math.floor((area.width * 7) / 8);
  const oneSixthX = area.x + Math.floor(area.width / 6);
  const fiveSixthX = area.x + Math.floor((area.width * 5) / 6);
  const topHalfBottom = area.y + halfHeightTop;

  switch (normalized) {
    case 'system-window-management-left':
      return {
        x: area.x,
        y: area.y,
        width: halfWidthLeft,
        height: area.height,
      };
    case 'system-window-management-right':
      return {
        x: area.x + halfWidthLeft,
        y: area.y,
        width: halfWidthRight,
        height: area.height,
      };
    case 'system-window-management-top':
      return {
        x: area.x,
        y: area.y,
        width: area.width,
        height: halfHeightTop,
      };
    case 'system-window-management-bottom':
      return {
        x: area.x,
        y: area.y + halfHeightTop,
        width: area.width,
        height: halfHeightBottom,
      };
    case 'system-window-management-fill':
      return {
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
      };
    case 'system-window-management-center': {
      const width = clampWindowManagementFineTuneValue(
        Math.round(area.width * 0.6),
        WINDOW_MANAGEMENT_FINE_TUNE_MIN_WIDTH,
        area.width
      );
      const height = clampWindowManagementFineTuneValue(
        Math.round(area.height * 0.6),
        WINDOW_MANAGEMENT_FINE_TUNE_MIN_HEIGHT,
        area.height
      );
      return {
        x: area.x + Math.round((area.width - width) / 2),
        y: area.y + Math.round((area.height - height) / 2),
        width,
        height,
      };
    }
    case 'system-window-management-center-80': {
      const width = clampWindowManagementFineTuneValue(
        Math.round(area.width * 0.8),
        WINDOW_MANAGEMENT_FINE_TUNE_MIN_WIDTH,
        area.width
      );
      const height = clampWindowManagementFineTuneValue(
        Math.round(area.height * 0.8),
        WINDOW_MANAGEMENT_FINE_TUNE_MIN_HEIGHT,
        area.height
      );
      return {
        x: area.x + Math.round((area.width - width) / 2),
        y: area.y + Math.round((area.height - height) / 2),
        width,
        height,
      };
    }
    case 'system-window-management-top-left':
      return {
        x: area.x,
        y: area.y,
        width: halfWidthLeft,
        height: halfHeightTop,
      };
    case 'system-window-management-top-right':
      return {
        x: area.x + halfWidthLeft,
        y: area.y,
        width: halfWidthRight,
        height: halfHeightTop,
      };
    case 'system-window-management-bottom-left':
      return {
        x: area.x,
        y: area.y + halfHeightTop,
        width: halfWidthLeft,
        height: halfHeightBottom,
      };
    case 'system-window-management-bottom-right':
      return {
        x: area.x + halfWidthLeft,
        y: area.y + halfHeightTop,
        width: halfWidthRight,
        height: halfHeightBottom,
      };
    case 'system-window-management-first-third':
      return {
        x: area.x,
        y: area.y,
        width: Math.max(1, oneThirdX - area.x),
        height: area.height,
      };
    case 'system-window-management-center-third':
      return {
        x: oneThirdX,
        y: area.y,
        width: Math.max(1, twoThirdX - oneThirdX),
        height: area.height,
      };
    case 'system-window-management-last-third':
      return {
        x: twoThirdX,
        y: area.y,
        width: Math.max(1, areaRight - twoThirdX),
        height: area.height,
      };
    case 'system-window-management-first-two-thirds':
      return {
        x: area.x,
        y: area.y,
        width: Math.max(1, twoThirdX - area.x),
        height: area.height,
      };
    case 'system-window-management-center-two-thirds':
      return {
        x: oneSixthX,
        y: area.y,
        width: Math.max(1, fiveSixthX - oneSixthX),
        height: area.height,
      };
    case 'system-window-management-last-two-thirds':
      return {
        x: oneThirdX,
        y: area.y,
        width: Math.max(1, areaRight - oneThirdX),
        height: area.height,
      };
    case 'system-window-management-first-fourth':
      return {
        x: area.x,
        y: area.y,
        width: Math.max(1, oneFourthX - area.x),
        height: area.height,
      };
    case 'system-window-management-second-fourth':
      return {
        x: oneFourthX,
        y: area.y,
        width: Math.max(1, halfX - oneFourthX),
        height: area.height,
      };
    case 'system-window-management-third-fourth':
      return {
        x: halfX,
        y: area.y,
        width: Math.max(1, threeFourthX - halfX),
        height: area.height,
      };
    case 'system-window-management-last-fourth':
      return {
        x: threeFourthX,
        y: area.y,
        width: Math.max(1, areaRight - threeFourthX),
        height: area.height,
      };
    case 'system-window-management-first-three-fourths':
      return {
        x: area.x,
        y: area.y,
        width: Math.max(1, threeFourthX - area.x),
        height: area.height,
      };
    case 'system-window-management-center-three-fourths':
      return {
        x: oneEighthX,
        y: area.y,
        width: Math.max(1, sevenEighthX - oneEighthX),
        height: area.height,
      };
    case 'system-window-management-last-three-fourths':
      return {
        x: oneFourthX,
        y: area.y,
        width: Math.max(1, areaRight - oneFourthX),
        height: area.height,
      };
    case 'system-window-management-top-left-sixth':
      return {
        x: area.x,
        y: area.y,
        width: Math.max(1, oneThirdX - area.x),
        height: Math.max(1, topHalfBottom - area.y),
      };
    case 'system-window-management-top-center-sixth':
      return {
        x: oneThirdX,
        y: area.y,
        width: Math.max(1, twoThirdX - oneThirdX),
        height: Math.max(1, topHalfBottom - area.y),
      };
    case 'system-window-management-top-right-sixth':
      return {
        x: twoThirdX,
        y: area.y,
        width: Math.max(1, areaRight - twoThirdX),
        height: Math.max(1, topHalfBottom - area.y),
      };
    case 'system-window-management-bottom-left-sixth':
      return {
        x: area.x,
        y: topHalfBottom,
        width: Math.max(1, oneThirdX - area.x),
        height: Math.max(1, areaBottom - topHalfBottom),
      };
    case 'system-window-management-bottom-center-sixth':
      return {
        x: oneThirdX,
        y: topHalfBottom,
        width: Math.max(1, twoThirdX - oneThirdX),
        height: Math.max(1, areaBottom - topHalfBottom),
      };
    case 'system-window-management-bottom-right-sixth':
      return {
        x: twoThirdX,
        y: topHalfBottom,
        width: Math.max(1, areaRight - twoThirdX),
        height: Math.max(1, areaBottom - topHalfBottom),
      };
    default:
      return null;
  }
}

function buildWindowManagementAutoOrganizeMutations(
  windows: NodeWindowInfo[],
  area: { x: number; y: number; width: number; height: number }
): QueuedWindowMutation[] {
  const targets = windows
    .filter((win) => win?.id && win?.bounds)
    .slice(0, 4);
  if (targets.length === 0) return [];

  const halfWidthLeft = Math.max(1, Math.floor(area.width / 2));
  const halfWidthRight = Math.max(1, area.width - halfWidthLeft);
  const halfHeightTop = Math.max(1, Math.floor(area.height / 2));
  const halfHeightBottom = Math.max(1, area.height - halfHeightTop);
  const full = { x: area.x, y: area.y, width: area.width, height: area.height };
  const left = { x: area.x, y: area.y, width: halfWidthLeft, height: area.height };
  const right = { x: area.x + halfWidthLeft, y: area.y, width: halfWidthRight, height: area.height };
  const rightTop = { x: area.x + halfWidthLeft, y: area.y, width: halfWidthRight, height: halfHeightTop };
  const rightBottom = { x: area.x + halfWidthLeft, y: area.y + halfHeightTop, width: halfWidthRight, height: halfHeightBottom };
  const topLeft = { x: area.x, y: area.y, width: halfWidthLeft, height: halfHeightTop };
  const bottomLeft = { x: area.x, y: area.y + halfHeightTop, width: halfWidthLeft, height: halfHeightBottom };
  const topRight = { x: area.x + halfWidthLeft, y: area.y, width: halfWidthRight, height: halfHeightTop };
  const bottomRight = { x: area.x + halfWidthLeft, y: area.y + halfHeightTop, width: halfWidthRight, height: halfHeightBottom };

  const assign = (entry: NodeWindowInfo, rect: { x: number; y: number; width: number; height: number }): QueuedWindowMutation => ({
    id: String(entry.id),
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  });

  if (targets.length === 1) {
    return [assign(targets[0], full)];
  }
  if (targets.length === 2) {
    return [assign(targets[0], left), assign(targets[1], right)];
  }
  if (targets.length === 3) {
    return [assign(targets[0], left), assign(targets[1], rightTop), assign(targets[2], rightBottom)];
  }
  return [
    assign(targets[0], topLeft),
    assign(targets[1], bottomLeft),
    assign(targets[2], topRight),
    assign(targets[3], bottomRight),
  ];
}

function scheduleWindowManagementFocusRestore(): void {
  [50, 180, 360].forEach((delayMs) => {
    setTimeout(() => {
      if (isVisible) return;
      void activateLastFrontmostApp();
    }, delayMs);
  });
}

async function executeWindowManagementFineTuneCommand(
  commandId: string,
  options?: {
    preferNative?: boolean;
    nativeTargetHint?: {
      bundleId?: string;
      appPath?: string;
      windowId?: string;
      workArea?: { x: number; y: number; width: number; height: number } | null;
    };
  }
): Promise<boolean> {
  const normalized = String(commandId || '').trim();
  if (!WINDOW_MANAGEMENT_FINE_TUNE_COMMAND_IDS.has(normalized)) return false;

  if (options?.preferNative) {
    const nativeResult = await executeNativeWindowFineTune(normalized, options.nativeTargetHint);
    if (nativeResult === true) return true;
  }

  try {
    await ensureWindowManagerAccess();
    await captureWindowManagementTargetWindow();

    let target: NodeWindowInfo | null = null;
    if (windowManagementTargetWindowId) {
      target = await getNodeWindowById(windowManagementTargetWindowId);
    }
    if (!target) {
      try {
        const activeRaw = await callWindowManagerWorker<any>('get-active-window');
        const activeInfo = normalizeNodeWindowInfo(activeRaw);
        if (activeInfo && !isSelfManagedWindow(activeInfo)) {
          target = activeInfo;
        }
      } catch {}
    }
    if (!target) {
      const snapshot = await getNodeSnapshot();
      target = snapshot.target;
    }
    if (!target?.id || !target.bounds) {
      return false;
    }
    windowManagementTargetWindowId = String(target.id);

    let area =
      normalizeWindowManagementArea(target.workArea) ||
      normalizeWindowManagementArea(windowManagementTargetWorkArea);
    if (!area) {
      const center = {
        x: target.bounds.x + target.bounds.width / 2,
        y: target.bounds.y + target.bounds.height / 2,
      };
      area = normalizeWindowManagementArea(screen.getDisplayNearestPoint(center)?.workArea);
    }
    if (!area) {
      area = normalizeWindowManagementArea(
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint())?.workArea || screen.getPrimaryDisplay()?.workArea
      );
    }
    if (!area) return false;
    windowManagementTargetWorkArea = area;

    const next = computeWindowManagementFineTuneBounds(normalized, target.bounds, area);
    if (!next) return false;
    return await queueWindowMutations([
      {
        id: String(target.id),
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
      },
    ]);
  } catch (error) {
    console.error('Failed to execute fine-tune window command:', error);
    return false;
  }
}

async function executeWindowManagementLayoutCommand(
  commandId: string,
  options?: {
    preferNative?: boolean;
    nativeTargetHint?: {
      bundleId?: string;
      appPath?: string;
      windowId?: string;
      workArea?: { x: number; y: number; width: number; height: number } | null;
    };
  }
): Promise<boolean> {
  const normalized = String(commandId || '').trim();
  if (!WINDOW_MANAGEMENT_LAYOUT_COMMAND_IDS.has(normalized)) return false;
  if (options?.preferNative) {
    const nativeResult = await executeNativeWindowLayout(normalized, options.nativeTargetHint);
    if (nativeResult === true) return true;
  }

  try {
    await ensureWindowManagerAccess();
    await captureWindowManagementTargetWindow();

    let target: NodeWindowInfo | null = null;
    if (windowManagementTargetWindowId) {
      target = await getNodeWindowById(windowManagementTargetWindowId);
    }
    if (!target) {
      try {
        const activeRaw = await callWindowManagerWorker<any>('get-active-window');
        const activeInfo = normalizeNodeWindowInfo(activeRaw);
        if (activeInfo && !isSelfManagedWindow(activeInfo)) {
          target = activeInfo;
        }
      } catch {}
    }
    if (!target) {
      const snapshot = await getNodeSnapshot();
      target = snapshot.target;
    }
    if (!target?.id || !target.bounds) return false;
    windowManagementTargetWindowId = String(target.id);

    let area =
      normalizeWindowManagementArea(target.workArea) ||
      normalizeWindowManagementArea(windowManagementTargetWorkArea);
    if (!area) {
      const center = {
        x: target.bounds.x + target.bounds.width / 2,
        y: target.bounds.y + target.bounds.height / 2,
      };
      area = normalizeWindowManagementArea(screen.getDisplayNearestPoint(center)?.workArea);
    }
    if (!area) {
      area = normalizeWindowManagementArea(
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint())?.workArea || screen.getPrimaryDisplay()?.workArea
      );
    }
    if (!area) return false;
    windowManagementTargetWorkArea = area;

    if (normalized === 'system-window-management-auto-organize') {
      const allWindows = await getNodeWindows();
      const deduped = new Map<string, NodeWindowInfo>();
      if (target?.id && target?.bounds && doesWindowIntersectArea(target.bounds, area)) {
        deduped.set(String(target.id), target);
      }
      for (const win of sortNodeWindowsForLayout(allWindows)) {
        if (!win?.id || !win?.bounds) continue;
        if (!doesWindowIntersectArea(win.bounds, area)) continue;
        const key = String(win.id);
        if (!deduped.has(key)) {
          deduped.set(key, win);
        }
      }
      const entries = buildWindowManagementAutoOrganizeMutations(Array.from(deduped.values()), area);
      if (entries.length === 0) return false;
      return await queueWindowMutations(entries);
    }

    const next = computeWindowManagementLayoutBounds(normalized, area);
    if (!next) return false;
    return await queueWindowMutations([
      {
        id: String(target.id),
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
      },
    ]);
  } catch (error) {
    console.error('Failed to execute window layout command:', error);
    return false;
  }
}

function enqueueWindowManagementMutation<T>(task: () => Promise<T> | T): Promise<T> {
  const run = async (): Promise<T> => {
    const elapsed = Date.now() - lastWindowManagementMutationAt;
    if (elapsed < WINDOW_MANAGEMENT_MUTATION_MIN_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, WINDOW_MANAGEMENT_MUTATION_MIN_INTERVAL_MS - elapsed));
    }
    try {
      return await task();
    } finally {
      lastWindowManagementMutationAt = Date.now();
    }
  };
  const queued = windowManagementMutationQueue.then(run, run);
  windowManagementMutationQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function queueWindowMutations(entries: QueuedWindowMutation[]): Promise<boolean> {
  if (!Array.isArray(entries) || entries.length === 0) {
    return Promise.resolve(false);
  }
  for (const entry of entries) {
    pendingWindowMutationsById.set(entry.id, entry);
  }
  const completion = new Promise<boolean>((resolve) => {
    windowMutationFlushWaiters.push(resolve);
  });
  if (windowMutationBatchTimer || windowMutationBatchInFlight) return completion;
  windowMutationBatchTimer = setTimeout(() => {
    windowMutationBatchTimer = null;
    void flushQueuedWindowMutations();
  }, WINDOW_MANAGEMENT_MUTATION_BATCH_MS);
  return completion;
}

async function flushQueuedWindowMutations(): Promise<void> {
  if (windowMutationBatchInFlight) return;
  if (pendingWindowMutationsById.size === 0) return;
  windowMutationBatchInFlight = true;
  const batch = Array.from(pendingWindowMutationsById.values());
  const waiters = windowMutationFlushWaiters;
  windowMutationFlushWaiters = [];
  pendingWindowMutationsById = new Map<string, QueuedWindowMutation>();
  let success = true;
  try {
    await enqueueWindowManagementMutation(async () => {
      await ensureWindowManagerAccess();
      for (let index = 0; index < batch.length; index += 1) {
        const entry = batch[index];
        try {
          await callWindowManagerWorker(
            'set-window-bounds',
            {
              id: entry.id,
              bounds: {
                x: entry.x,
                y: entry.y,
                width: entry.width,
                height: entry.height,
              },
            },
            1800
          );
        } catch (error) {
          success = false;
          console.warn('[WindowManager] Failed setBounds for window:', entry.id, error);
        }
        if (index < batch.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }
    });
  } catch (error) {
    success = false;
    console.error('Failed to flush queued window mutations:', error);
  } finally {
    for (const resolve of waiters) {
      try {
        resolve(success);
      } catch {}
    }
    windowMutationBatchInFlight = false;
    if (pendingWindowMutationsById.size > 0 && !windowMutationBatchTimer) {
      windowMutationBatchTimer = setTimeout(() => {
        windowMutationBatchTimer = null;
        void flushQueuedWindowMutations();
      }, WINDOW_MANAGEMENT_MUTATION_BATCH_MS);
    }
  }
}

function isWindowShownRoutedSystemCommand(commandId: string): boolean {
  return (
    commandId === 'system-clipboard-manager' ||
    commandId === 'system-search-snippets' ||
    commandId === 'system-create-snippet' ||
    commandId === 'system-search-quicklinks' ||
    commandId === 'system-create-quicklink' ||
    commandId === 'system-search-files' ||
    commandId === 'system-camera' ||
    commandId === 'system-open-onboarding'
  );
}

function scrubInternalClipboardProbe(reason: string): void {
  try {
    const current = String(systemClipboard.readText() || '').trim();
    if (!INTERNAL_CLIPBOARD_PROBE_REGEX.test(current)) return;
    systemClipboard.writeText('');
    console.warn(`[Clipboard] Cleared internal probe token (${reason}).`);
  } catch (error) {
    console.warn('[Clipboard] Failed to clear internal probe token:', error);
  }
}

type OnboardingPermissionTarget = 'accessibility' | 'input-monitoring' | 'microphone' | 'speech-recognition' | 'home-folder';
type OnboardingPermissionResult = {
  granted: boolean;
  requested: boolean;
  mode: 'prompted' | 'already-granted' | 'manual';
  status?: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
  canPrompt?: boolean;
  error?: string;
};

type MicrophoneAccessStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
type MicrophonePermissionResult = {
  granted: boolean;
  requested: boolean;
  status: MicrophoneAccessStatus;
  canPrompt: boolean;
  error?: string;
};
type HomeFolderAccessProbeResult = {
  granted: boolean;
  deniedPaths: string[];
};

function describeMicrophoneStatus(status: MicrophoneAccessStatus): string {
  if (status === 'denied') {
    return 'Microphone access is denied. Enable SuperCmd in System Settings -> Privacy & Security -> Microphone.';
  }
  if (status === 'restricted') {
    return 'Microphone access is restricted on this device.';
  }
  if (status === 'not-determined') {
    return 'Microphone access is not determined yet. Press request again to trigger the prompt.';
  }
  return 'Failed to request microphone access.';
}

function readMicrophoneAccessStatus(): MicrophoneAccessStatus {
  if (process.platform !== 'darwin') return 'granted';
  try {
    const raw = String(systemPreferences.getMediaAccessStatus('microphone') || '').toLowerCase();
    if (
      raw === 'granted' ||
      raw === 'denied' ||
      raw === 'restricted' ||
      raw === 'not-determined'
    ) {
      return raw;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function formatHomeScopedPath(candidatePath: string, homeDir: string): string {
  if (!candidatePath) return '';
  if (candidatePath === homeDir) return '~';
  if (candidatePath.startsWith(`${homeDir}${path.sep}`)) {
    return `~${candidatePath.slice(homeDir.length)}`;
  }
  return candidatePath;
}

async function probeHomeFolderAccess(): Promise<HomeFolderAccessProbeResult> {
  if (process.platform !== 'darwin') {
    return { granted: true, deniedPaths: [] };
  }

  const homeDir = app.getPath('home');
  const targets = [homeDir];
  for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures']) {
    const targetPath = path.join(homeDir, name);
    if (fs.existsSync(targetPath)) {
      targets.push(targetPath);
    }
  }

  const deniedPaths: string[] = [];
  for (const targetPath of targets) {
    try {
      await fs.promises.readdir(targetPath);
    } catch (error: any) {
      const code = String(error?.code || '').toUpperCase();
      if (code === 'EACCES' || code === 'EPERM') {
        deniedPaths.push(targetPath);
      }
    }
  }

  return {
    granted: deniedPaths.length === 0,
    deniedPaths,
  };
}

async function promptForHomeFolderAccess(): Promise<{ requested: boolean; selectedHomeFolder: boolean; error?: string }> {
  const homeDir = app.getPath('home');
  try {
    const hostWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const result = await dialog.showOpenDialog(hostWindow, {
      title: 'Allow Home Folder Access',
      message: 'Select your Home folder to let SuperCmd index files for Search Files.',
      defaultPath: homeDir,
      buttonLabel: 'Select Home Folder',
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    if (result.canceled || !result.filePaths?.length) {
      return { requested: false, selectedHomeFolder: false };
    }
    const selectedPath = path.resolve(String(result.filePaths[0] || ''));
    const selectedHomeFolder = selectedPath === path.resolve(homeDir);
    if (selectedHomeFolder) {
      return { requested: true, selectedHomeFolder: true };
    }
    return {
      requested: true,
      selectedHomeFolder: false,
      error: 'Please select your Home folder to grant file search access.',
    };
  } catch (error: any) {
    return {
      requested: false,
      selectedHomeFolder: false,
      error: String(error?.message || error || 'Failed to request Home folder access.'),
    };
  }
}

async function requestMicrophoneAccessViaNative(prompt: boolean): Promise<MicrophonePermissionResult | null> {
  if (process.platform !== 'darwin') return null;
  const fs = require('fs');
  const binaryPath = getNativeBinaryPath('microphone-access');
  if (!fs.existsSync(binaryPath)) return null;

  return await new Promise<MicrophonePermissionResult | null>((resolve) => {
    const { spawn } = require('child_process');
    const args = prompt ? ['--prompt'] : [];
    const proc = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk || '');
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk || '');
    });

    proc.on('error', () => {
      resolve(null);
    });

    proc.on('close', () => {
      const lines = stdout
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          const payload = JSON.parse(lines[i]);
          const status = normalizePermissionStatus(payload?.status);
          const granted = Boolean(payload?.granted) || status === 'granted';
          const requested = Boolean(payload?.requested);
          const canPrompt = typeof payload?.canPrompt === 'boolean'
            ? Boolean(payload.canPrompt)
            : status === 'not-determined' || status === 'unknown';
          const result: MicrophonePermissionResult = {
            granted,
            requested,
            status,
            canPrompt,
            error: granted
              ? undefined
              : String(payload?.error || '').trim() || (stderr.trim() || undefined),
          };
          resolve(result);
          return;
        } catch {}
      }
      resolve(null);
    });
  });
}

async function ensureMicrophoneAccess(prompt = true): Promise<MicrophonePermissionResult> {
  if (process.platform !== 'darwin') {
    return {
      granted: true,
      requested: false,
      status: 'granted',
      canPrompt: false,
    };
  }

  const before = readMicrophoneAccessStatus();
  if (before === 'granted') {
    return {
      granted: true,
      requested: false,
      status: before,
      canPrompt: false,
    };
  }

  if (!prompt) {
    const nativeResult = await requestMicrophoneAccessViaNative(false);
    if (nativeResult) return nativeResult;
    const canPrompt = before === 'not-determined' || before === 'unknown';
    return {
      granted: false,
      requested: false,
      status: before,
      canPrompt,
    };
  }

  // Request from the Electron app process first so macOS registers SuperCmd
  // itself in Privacy & Security -> Microphone.
  let requested = false;
  let electronError = '';
  try {
    try {
      app.focus({ steal: true });
    } catch {}
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        }
      }
    } catch {}
    const granted = await systemPreferences.askForMediaAccess('microphone');
    requested = true;
    const after = readMicrophoneAccessStatus();
    if (Boolean(granted) || after === 'granted') {
      return {
        granted: true,
        requested,
        status: 'granted',
        canPrompt: false,
      };
    }
    if (after === 'denied' || after === 'restricted' || after === 'not-determined') {
      return {
        granted: false,
        requested,
        status: after,
        canPrompt: after === 'not-determined',
        error: describeMicrophoneStatus(after),
      };
    }
  } catch (error: any) {
    electronError = String(error?.message || error || '').trim();
  }

  // Fallback to native helper for additional status/error detail only.
  // Keep prompt disabled here so the helper process never owns the TCC request.
  const nativeResult = await requestMicrophoneAccessViaNative(false);
  const after = readMicrophoneAccessStatus();
  const status = nativeResult?.status && nativeResult.status !== 'unknown'
    ? nativeResult.status
    : after;
  const granted = Boolean(nativeResult?.granted) || after === 'granted' || status === 'granted';
  const canPrompt = status === 'not-determined' || status === 'unknown';
  return {
    granted,
    requested: requested || Boolean(nativeResult?.requested),
    status,
    canPrompt,
    error: granted
      ? undefined
      : nativeResult?.error || electronError || describeMicrophoneStatus(status),
  };
}

function ensureInputMonitoringRequestBinary(): string | null {
  const fs = require('fs') as typeof import('fs');
  const binaryPath = getNativeBinaryPath('input-monitoring-request');
  if (fs.existsSync(binaryPath)) return binaryPath;
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const sourceCandidates = [
      path.join(app.getAppPath(), 'src', 'native', 'input-monitoring-request.swift'),
      path.join(process.cwd(), 'src', 'native', 'input-monitoring-request.swift'),
      path.join(__dirname, '..', '..', 'src', 'native', 'input-monitoring-request.swift'),
    ];
    const sourcePath = sourceCandidates.find((candidate) => fs.existsSync(candidate));
    if (!sourcePath) return null;
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    execFileSync('swiftc', [
      '-O',
      '-o',
      binaryPath,
      sourcePath,
      '-framework',
      'CoreGraphics',
    ]);
    return binaryPath;
  } catch {
    return null;
  }
}

async function checkInputMonitoringAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  const binaryPath = ensureInputMonitoringRequestBinary();
  if (!binaryPath) return false;
  const { spawn } = require('child_process') as typeof import('child_process');
  return await new Promise<boolean>((resolve) => {
    const proc = spawn(binaryPath, ['--check'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timeout = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      settle(false);
    }, 1400);

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk || '');
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      settle(false);
    });

    proc.on('close', () => {
      clearTimeout(timeout);
      const lines = stdout
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          const payload = JSON.parse(lines[i]);
          if (typeof payload?.granted === 'boolean') {
            settle(Boolean(payload.granted));
            return;
          }
        } catch {}
      }
      settle(false);
    });
  });
}

async function requestOnboardingPermissionAccess(target: OnboardingPermissionTarget): Promise<OnboardingPermissionResult> {
  if (process.platform !== 'darwin') {
    if (target === 'home-folder') {
      saveSettings({ fileSearchProtectedRootsEnabled: true });
      startFileSearchIndexing({
        homeDir: app.getPath('home'),
        includeProtectedHomeRoots: true,
      });
      return {
        granted: true,
        requested: false,
        mode: 'already-granted',
        status: 'granted',
        canPrompt: false,
      };
    }
    if (target === 'microphone' || target === 'speech-recognition') {
      return { granted: true, requested: false, mode: 'already-granted', status: 'granted', canPrompt: false };
    }
    return { granted: false, requested: false, mode: 'manual' };
  }

  if (target === 'home-folder') {
    const before = await probeHomeFolderAccess();
    if (before.granted) {
      saveSettings({ fileSearchProtectedRootsEnabled: true });
      startFileSearchIndexing({
        homeDir: app.getPath('home'),
        includeProtectedHomeRoots: true,
      });
      return {
        granted: true,
        requested: false,
        mode: 'already-granted',
        status: 'granted',
        canPrompt: false,
      };
    }

    const promptResult = await promptForHomeFolderAccess();
    const after = await probeHomeFolderAccess();
    if (after.granted) {
      saveSettings({ fileSearchProtectedRootsEnabled: true });
      startFileSearchIndexing({
        homeDir: app.getPath('home'),
        includeProtectedHomeRoots: true,
      });
      void rebuildFileSearchIndex('home-folder-permission').catch(() => {});
      return {
        granted: true,
        requested: promptResult.requested || promptResult.selectedHomeFolder,
        mode: promptResult.requested ? 'prompted' : 'already-granted',
        status: 'granted',
        canPrompt: false,
      };
    }

    const homeDir = app.getPath('home');
    const deniedSummary = after.deniedPaths
      .slice(0, 3)
      .map((candidate) => formatHomeScopedPath(candidate, homeDir))
      .join(', ');
    const deniedMessage = deniedSummary ? `Blocked folders: ${deniedSummary}. ` : '';

    return {
      granted: false,
      requested: promptResult.requested,
      mode: promptResult.requested ? 'prompted' : 'manual',
      status: 'not-determined',
      canPrompt: true,
      error:
        promptResult.error ||
        `${deniedMessage}Allow SuperCmd in System Settings -> Privacy & Security -> Files and Folders, then request again.`,
    };
  }

  if (target === 'accessibility') {
    try {
      const before = systemPreferences.isTrustedAccessibilityClient(false);
      if (before) {
        return { granted: true, requested: true, mode: 'already-granted' };
      }
      const after = systemPreferences.isTrustedAccessibilityClient(true);
      return { granted: Boolean(after), requested: true, mode: 'prompted' };
    } catch {
      return { granted: false, requested: true, mode: 'prompted' };
    }
  }

  if (target === 'speech-recognition') {
    const result = await ensureSpeechRecognitionAccess(true);
    const speechStatus = normalizePermissionStatus(result.speechStatus);
    const canPrompt = speechStatus === 'not-determined' || speechStatus === 'unknown';
    if (result.granted) {
      return {
        granted: true,
        requested: result.requested,
        mode: result.requested ? 'prompted' : 'already-granted',
        status: speechStatus,
        canPrompt,
      };
    }
    return {
      granted: false,
      requested: result.requested,
      mode: result.requested ? 'prompted' : 'manual',
      status: speechStatus,
      canPrompt,
      error: result.error,
    };
  }

  if (target === 'microphone') {
    const result = await ensureMicrophoneAccess(true);
    if (result.granted) {
      return {
        granted: true,
        requested: result.requested,
        mode: result.requested ? 'prompted' : 'already-granted',
        status: result.status,
        canPrompt: result.canPrompt,
      };
    }
    return {
      granted: false,
      requested: result.requested,
      mode: result.requested ? 'prompted' : 'manual',
      status: result.status,
      canPrompt: result.canPrompt,
      error: result.error,
    };
  }

  // Input Monitoring: first check whether access is already granted.
  // If not, launch the helper detached so macOS can add SuperCmd to the
  // Input Monitoring list and the user can manually enable it.
  const alreadyGranted = await checkInputMonitoringAccess();
  if (alreadyGranted) {
    return {
      granted: true,
      requested: false,
      mode: 'already-granted',
      status: 'granted',
      canPrompt: false,
    };
  }
  const binaryPath = ensureInputMonitoringRequestBinary();
  if (binaryPath) {
    try {
      const { spawn } = require('child_process') as typeof import('child_process');
      // Detached — exits on its own (0.5 s on success, 3.5 s on failure).
      spawn(binaryPath, [], { stdio: ['ignore', 'ignore', 'ignore'], detached: true }).unref();
    } catch {}
  }
  return {
    granted: false,
    requested: Boolean(binaryPath),
    mode: 'manual',
    status: 'not-determined',
    canPrompt: true,
    error: binaryPath
      ? undefined
      : 'Could not prepare Input Monitoring helper. Open System Settings -> Privacy & Security -> Input Monitoring and add SuperCmd manually.',
  };
}
let lastTypingCaretPoint: { x: number; y: number } | null = null;
let lastCursorPromptSelection = '';
let lastLauncherSelectionSnapshot = '';
let lastLauncherSelectionSnapshotAt = 0;
let whisperEscapeRegistered = false;
let whisperOverlayVisible = false;
let speakOverlayVisible = false;
let whisperChildWindow: InstanceType<typeof BrowserWindow> | null = null;
const LAUNCHER_SELECTION_SNAPSHOT_TTL_MS = 15_000;

function registerWhisperEscapeShortcut(): void {
  if (whisperEscapeRegistered) return;
  try {
    const success = globalShortcut.register('Escape', () => {
      if (isVisible && launcherMode === 'whisper') {
        mainWindow?.webContents.send('whisper-stop-and-close');
      }
    });
    whisperEscapeRegistered = success;
  } catch {
    whisperEscapeRegistered = false;
  }
}

function unregisterWhisperEscapeShortcut(): void {
  if (!whisperEscapeRegistered) return;
  try {
    globalShortcut.unregister('Escape');
  } catch {}
  whisperEscapeRegistered = false;
}

function emitWindowHidden(): void {
  try {
    mainWindow?.webContents.send('window-hidden');
  } catch {}
}

function setSpeakStatus(status: {
  state: 'idle' | 'loading' | 'speaking' | 'done' | 'error';
  text: string;
  index: number;
  total: number;
  message?: string;
  wordIndex?: number;
}): void {
  speakStatusSnapshot = status;
  try {
    mainWindow?.webContents.send('speak-status', status);
  } catch {}
}

function splitTextIntoSpeakChunks(input: string): string[] {
  const normalized = String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  // Keep chunks sentence-aligned. We do NOT split a sentence mid-way.
  const maxChunkWords = 50;
  const sentenceRegex = /[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g;
  const baseSentences = (normalized.match(sentenceRegex) || [])
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/[.!?]["')\]]*$/.test(s) ? s : `${s}.`));

  const countWords = (text: string): number => {
    const t = text.trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  };

  const chunks: string[] = [];
  for (let i = 0; i < baseSentences.length; i += 1) {
    const first = baseSentences[i];
    const second = baseSentences[i + 1];
    if (second) {
      const pair = `${first} ${second}`;
      if (countWords(pair) <= maxChunkWords) {
        chunks.push(pair);
        i += 1;
        continue;
      }
    }
    chunks.push(first);
  }

  return chunks;
}

function parseCueTimeMs(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Math.max(0, Math.round(Number(raw)));
  }
  // Accept formats like "00:00:01.230" or "00:01.230"
  const parts = raw.split(':').map((p) => p.trim());
  if (parts.length >= 2) {
    const secPart = parts.pop() || '0';
    const minPart = parts.pop() || '0';
    const hrPart = parts.pop() || '0';
    const sec = Number(secPart);
    const min = Number(minPart);
    const hr = Number(hrPart);
    if (Number.isFinite(sec) && Number.isFinite(min) && Number.isFinite(hr)) {
      return Math.max(0, Math.round(((hr * 3600) + (min * 60) + sec) * 1000));
    }
  }
  return 0;
}

function probeAudioDurationMs(audioPath: string): number | null {
  const target = String(audioPath || '').trim();
  if (!target) return null;
  if (process.platform !== 'darwin') return null;
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('/usr/bin/afinfo', [target], {
      encoding: 'utf-8',
      timeout: 4000,
    });
    const output = `${String(result?.stdout || '')}\n${String(result?.stderr || '')}`;
    const secMatch = /estimated duration:\s*([0-9]+(?:\.[0-9]+)?)\s*sec/i.exec(output);
    const seconds = secMatch ? Number(secMatch[1]) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }
  } catch {}
  return null;
}

function normalizePermissionStatus(raw: any): MicrophoneAccessStatus {
  const value = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
  if (value === 'authorized') return 'granted';
  if (value === 'notdetermined') return 'not-determined';
  if (
    value === 'granted' ||
    value === 'denied' ||
    value === 'restricted' ||
    value === 'not-determined'
  ) {
    return value;
  }
  return 'unknown';
}

function resolveEdgeTtsConstructor(): any | null {
  if (edgeTtsConstructorResolved) return edgeTtsConstructor;
  edgeTtsConstructorResolved = true;
  try {
    const mod = require('node-edge-tts');
    const ctor = mod?.EdgeTTS || mod?.default?.EdgeTTS || mod?.default || mod;
    if (typeof ctor === 'function') {
      edgeTtsConstructor = ctor;
      edgeTtsConstructorError = '';
      return edgeTtsConstructor;
    }
    edgeTtsConstructor = null;
    edgeTtsConstructorError = 'node-edge-tts module did not expose EdgeTTS.';
    return null;
  } catch (error: any) {
    edgeTtsConstructor = null;
    edgeTtsConstructorError = String(error?.message || error || 'Failed to load node-edge-tts.');
    return null;
  }
}

function resolveLocalSpeakBackend(): LocalSpeakBackend | null {
  if (resolveEdgeTtsConstructor()) return 'edge-tts';
  if (process.platform === 'darwin') return 'system-say';
  return null;
}

async function synthesizeWithEdgeTts(opts: {
  text: string;
  audioPath: string;
  voice: string;
  lang: string;
  rate: string;
  saveSubtitles: boolean;
  timeoutMs: number;
}): Promise<void> {
  const EdgeTTS = resolveEdgeTtsConstructor();
  if (!EdgeTTS) {
    throw new Error(edgeTtsConstructorError || 'node-edge-tts is unavailable.');
  }
  const tts = new EdgeTTS({
    voice: opts.voice,
    lang: opts.lang,
    rate: opts.rate,
    saveSubtitles: Boolean(opts.saveSubtitles),
    timeout: Math.max(5000, opts.timeoutMs || 45000),
  });
  await tts.ttsPromise(opts.text, opts.audioPath);
}

function parseSayRateWordsPerMinute(rate: string): string {
  const raw = String(rate || '').trim();
  const pctMatch = /^([+-]?\d+)%$/.exec(raw);
  const pct = pctMatch ? Number(pctMatch[1]) : 0;
  const wpm = Math.max(90, Math.min(420, Math.round(175 * (1 + (Number.isFinite(pct) ? pct : 0) / 100))));
  return String(wpm);
}

function resolveSystemSayVoice(language: string): string | null {
  const normalized = String(language || '').toLowerCase();
  if (normalized.startsWith('en-gb')) return 'Daniel';
  if (normalized.startsWith('en-au')) return 'Karen';
  if (normalized.startsWith('en-us') || normalized.startsWith('en')) return 'Samantha';
  if (normalized.startsWith('es')) return 'Monica';
  if (normalized.startsWith('fr')) return 'Thomas';
  if (normalized.startsWith('de')) return 'Anna';
  if (normalized.startsWith('it')) return 'Alice';
  if (normalized.startsWith('pt')) return 'Luciana';
  if (normalized.startsWith('ja')) return 'Kyoko';
  if (normalized.startsWith('hi')) return 'Veena';
  return null;
}

function runSystemSay(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn('/usr/bin/say', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk || '');
    });
    proc.on('error', (error: Error) => {
      reject(error);
    });
    proc.on('close', (code: number | null) => {
      if (code && code !== 0) {
        reject(new Error(stderr.trim() || `say exited with ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function synthesizeWithSystemSay(opts: {
  text: string;
  audioPath: string;
  lang: string;
  rate: string;
}): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('System speech fallback is only available on macOS.');
  }
  const rate = parseSayRateWordsPerMinute(opts.rate);
  const voice = resolveSystemSayVoice(opts.lang);
  const baseArgs = ['-o', opts.audioPath, '-r', rate];
  if (voice) {
    try {
      await runSystemSay([...baseArgs, '-v', voice, opts.text]);
      return;
    } catch {}
  }
  await runSystemSay([...baseArgs, opts.text]);
}

type SpeechRecognitionPermissionResult = {
  granted: boolean;
  requested: boolean;
  speechStatus: MicrophoneAccessStatus;
  microphoneStatus: MicrophoneAccessStatus;
  error?: string;
};

async function ensureSpeechRecognitionAccess(prompt = true): Promise<SpeechRecognitionPermissionResult> {
  if (process.platform !== 'darwin') {
    return {
      granted: true,
      requested: false,
      speechStatus: 'granted',
      microphoneStatus: 'granted',
    };
  }

  if (!prompt) {
    return {
      granted: false,
      requested: false,
      speechStatus: 'unknown',
      microphoneStatus: readMicrophoneAccessStatus(),
    };
  }

  const fs = require('fs');
  const binaryPath = getNativeBinaryPath('speech-recognizer');
  if (!fs.existsSync(binaryPath)) {
    return {
      granted: false,
      requested: false,
      speechStatus: 'unknown',
      microphoneStatus: readMicrophoneAccessStatus(),
      error: 'Speech recognizer helper is missing. Reinstall SuperCmd and retry.',
    };
  }

  const settings = loadSettings();
  const language = String(settings.ai?.speechLanguage || 'en-US').trim() || 'en-US';

  return await new Promise<SpeechRecognitionPermissionResult>((resolve) => {
    const { spawn } = require('child_process');
    const proc = spawn(binaryPath, [language, '--auth-only'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let helperError = '';
    let speechStatus: MicrophoneAccessStatus = 'unknown';
    let microphoneStatus: MicrophoneAccessStatus = readMicrophoneAccessStatus();
    let timeout: NodeJS.Timeout | null = null;

    const finalize = (result: SpeechRecognitionPermissionResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };

    const parseLine = (line: string) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      try {
        const payload = JSON.parse(trimmed) as any;
        if (payload?.speechStatus !== undefined) {
          speechStatus = normalizePermissionStatus(payload.speechStatus);
        }
        if (payload?.microphoneStatus !== undefined) {
          microphoneStatus = normalizePermissionStatus(payload.microphoneStatus);
        }
        if (payload?.authorized === true) {
          speechStatus = 'granted';
          if (microphoneStatus === 'unknown') {
            microphoneStatus = 'granted';
          }
        }
        if (payload?.error) {
          helperError = String(payload.error || '').trim();
        }
      } catch {}
    };

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += String(chunk || '');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        parseLine(line);
      }
    });

    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderrBuffer += String(chunk || '');
    });

    proc.on('error', (error: Error) => {
      finalize({
        granted: false,
        requested: false,
        speechStatus,
        microphoneStatus,
        error: error.message || 'Failed to request speech recognition access.',
      });
    });

    proc.on('close', (code: number | null) => {
      if (stdoutBuffer.trim()) {
        parseLine(stdoutBuffer.trim());
      }
      const finalMicStatus = microphoneStatus === 'unknown'
        ? readMicrophoneAccessStatus()
        : microphoneStatus;
      const granted = speechStatus === 'granted';
      let error = helperError || '';
      if (!granted && !error) {
        const stderr = stderrBuffer.trim();
        if (stderr) {
          error = stderr;
        } else if (code && code !== 0) {
          error = `Speech recognition permission check exited with code ${code}.`;
        } else {
          error = 'Speech recognition permission is required for Whisper.';
        }
      }
      finalize({
        granted,
        requested: true,
        speechStatus,
        microphoneStatus: finalMicStatus,
        error: error || undefined,
      });
    });

    timeout = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      finalize({
        granted: speechStatus === 'granted',
        requested: true,
        speechStatus,
        microphoneStatus: readMicrophoneAccessStatus(),
        error: helperError || 'Speech permission prompt timed out. Please allow access and retry.',
      });
    }, 15000);
  });
}

function resolveEdgeVoice(language?: string): string {
  const lang = String(language || 'en-US').toLowerCase();
  if (lang.startsWith('en-in')) return 'en-IN-NeerjaNeural';
  if (lang.startsWith('en-gb')) return 'en-GB-SoniaNeural';
  if (lang.startsWith('en-au')) return 'en-AU-NatashaNeural';
  if (lang.startsWith('es')) return 'es-ES-ElviraNeural';
  if (lang.startsWith('fr')) return 'fr-FR-DeniseNeural';
  if (lang.startsWith('de')) return 'de-DE-KatjaNeural';
  if (lang.startsWith('it')) return 'it-IT-ElsaNeural';
  if (lang.startsWith('pt')) return 'pt-BR-FranciscaNeural';
  return 'en-US-EricNeural';
}

function resolveElevenLabsSttModel(model: string): string {
  const raw = String(model || '').trim().toLowerCase();
  if (raw.includes('scribe_v2') || raw.includes('scribe-v2')) return 'scribe_v2';
  if (raw.includes('scribe')) return 'scribe_v1';
  const noPrefix = raw.replace(/^elevenlabs-/, '');
  if (!noPrefix) return 'scribe_v1';
  return noPrefix.replace(/-/g, '_');
}

function normalizeApiKey(raw: any): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  // Handle accidental surrounding quotes from copy/paste.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function getElevenLabsApiKey(settings: AppSettings): string {
  const fromSettings = normalizeApiKey(settings.ai?.elevenlabsApiKey);
  if (fromSettings) return fromSettings;
  return normalizeApiKey(process.env.ELEVENLABS_API_KEY);
}

const DEFAULT_ELEVENLABS_TTS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

function resolveElevenLabsTtsConfig(selectedModel: string): { modelId: string; voiceId: string } {
  const raw = String(selectedModel || '').trim();
  const explicitVoiceRaw = /@([A-Za-z0-9]{8,})$/.exec(raw)?.[1];
  const explicitVoice = explicitVoiceRaw === 'EXAVITQu4vr4xnSDxMa'
    ? 'EXAVITQu4vr4xnSDxMaL'
    : explicitVoiceRaw;
  const modelSource = explicitVoice ? raw.replace(/@[A-Za-z0-9]{8,}$/, '') : raw;
  const normalized = modelSource.toLowerCase();
  const modelRaw = normalized.replace(/^elevenlabs-/, '');
  let modelId = modelRaw.replace(/-/g, '_');
  if (modelId === 'multilingual_v2' || modelId === 'multilingual-v2') {
    modelId = 'eleven_multilingual_v2';
  }
  if (modelId === 'flash_v2_5' || modelId === 'flash-v2-5') {
    modelId = 'eleven_flash_v2_5';
  }
  if (modelId === 'turbo_v2_5' || modelId === 'turbo-v2-5') {
    modelId = 'eleven_turbo_v2_5';
  }
  if (modelId === 'v3') {
    modelId = 'eleven_v3';
  }
  if (!modelId) {
    modelId = 'eleven_multilingual_v2';
  }
  // Allow an optional explicit voice id suffix: "elevenlabs-model@voiceId"
  const voiceId = explicitVoice || DEFAULT_ELEVENLABS_TTS_VOICE_ID;
  return { modelId, voiceId };
}

function transcribeAudioWithElevenLabs(opts: {
  audioBuffer: Buffer;
  apiKey: string;
  model: string;
  language?: string;
  mimeType?: string;
}): Promise<string> {
  const boundary = `----SuperCmdBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];
  const normalized = String(opts.mimeType || '').toLowerCase();
  const filename = normalized.includes('wav')
    ? 'audio.wav'
    : normalized.includes('mpeg') || normalized.includes('mp3')
      ? 'audio.mp3'
      : normalized.includes('mp4') || normalized.includes('m4a')
        ? 'audio.m4a'
        : normalized.includes('ogg') || normalized.includes('oga')
          ? 'audio.ogg'
          : normalized.includes('flac')
            ? 'audio.flac'
            : 'audio.webm';
  const contentType = normalized || 'audio/webm';

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  ));
  parts.push(opts.audioBuffer);
  parts.push(Buffer.from('\r\n'));

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\n${opts.model}\r\n`
  ));

  if (opts.language) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language_code"\r\n\r\n${opts.language}\r\n`
    ));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  return new Promise<string>((resolve, reject) => {
    try {
      const https = require('https');
      const req = https.request(
        {
          hostname: 'api.elevenlabs.io',
          path: '/v1/speech-to-text',
          method: 'POST',
          headers: {
            'xi-api-key': opts.apiKey,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
        },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const responseBody = Buffer.concat(chunks).toString('utf-8');
            if (res.statusCode && res.statusCode >= 400) {
              if (res.statusCode === 401 && responseBody.includes('detected_unusual_activity')) {
                reject(new Error('ElevenLabs rejected this key due to account restrictions (detected_unusual_activity). Verify plan/account status in ElevenLabs dashboard.'));
                return;
              }
              reject(new Error(`ElevenLabs STT HTTP ${res.statusCode}: ${responseBody.slice(0, 500)}`));
              return;
            }
            try {
              const parsed = JSON.parse(responseBody || '{}');
              const text = String(parsed?.text || parsed?.transcript || '').trim();
              if (!text) {
                reject(new Error('ElevenLabs STT returned an empty transcript.'));
                return;
              }
              resolve(text);
            } catch {
              const text = responseBody.trim();
              if (!text) {
                reject(new Error('ElevenLabs STT returned an empty response.'));
                return;
              }
              resolve(text);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

function synthesizeElevenLabsToFile(opts: {
  text: string;
  apiKey: string;
  modelId: string;
  voiceId: string;
  audioPath: string;
  timeoutMs?: number;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      const https = require('https');
      const fs = require('fs');
      const req = https.request(
        {
          hostname: 'api.elevenlabs.io',
          path: `/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`,
          method: 'POST',
          headers: {
            'xi-api-key': opts.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
        },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              const responseText = Buffer.concat(chunks).toString('utf-8');
              if (res.statusCode === 401 && responseText.includes('detected_unusual_activity')) {
                reject(new Error('ElevenLabs rejected this key due to account restrictions (detected_unusual_activity). Verify plan/account status in ElevenLabs dashboard.'));
                return;
              }
              reject(new Error(`ElevenLabs TTS HTTP ${res.statusCode}: ${responseText.slice(0, 500)}`));
              return;
            }
            const audio = Buffer.concat(chunks);
            if (!audio.length) {
              reject(new Error('ElevenLabs TTS returned empty audio.'));
              return;
            }
            fs.writeFile(opts.audioPath, audio, (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      );

      req.on('error', reject);
      req.setTimeout(Math.max(5000, opts.timeoutMs || 45000), () => {
        req.destroy(new Error('ElevenLabs TTS timed out.'));
      });
      req.write(JSON.stringify({
        text: opts.text,
        model_id: opts.modelId,
      }));
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

function fetchElevenLabsVoices(apiKey: string): Promise<{ voices: Array<{ id: string; name: string; category: string; description?: string; labels?: Record<string, string>; previewUrl?: string }>; error?: string }> {
  return new Promise((resolve) => {
    try {
      const https = require('https');
      const req = https.request(
        {
          hostname: 'api.elevenlabs.io',
          path: '/v1/voices',
          method: 'GET',
          headers: {
            'xi-api-key': apiKey,
            'Accept': 'application/json',
          },
        },
        (res: any) => {
          let body = '';
          res.on('data', (chunk: Buffer | string) => { body += String(chunk || ''); });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              if (res.statusCode === 401) {
                resolve({ voices: [], error: 'Invalid API key. Please check your ElevenLabs API key.' });
              } else {
                resolve({ voices: [], error: `ElevenLabs API error: HTTP ${res.statusCode}` });
              }
              return;
            }
            try {
              const parsed = JSON.parse(body);
              const voices = Array.isArray(parsed.voices) ? parsed.voices : [];
              const mapped = voices
                .map((v: any) => ({
                  id: String(v?.voice_id || ''),
                  name: String(v?.name || 'Unknown'),
                  category: String(v?.category || 'premade'),
                  description: v?.description ? String(v.description) : undefined,
                  labels: v?.labels && typeof v.labels === 'object' ? v.labels : undefined,
                  previewUrl: v?.preview_url ? String(v.preview_url) : undefined,
                }))
                .filter((v: any) => v.id);
              resolve({ voices: mapped });
            } catch (e) {
              resolve({ voices: [], error: 'Failed to parse ElevenLabs voice list.' });
            }
          });
        }
      );
      req.on('error', () => {
        resolve({ voices: [], error: 'Network error while fetching voices.' });
      });
      req.setTimeout(15000, () => {
        req.destroy();
        resolve({ voices: [], error: 'Request timed out.' });
      });
      req.end();
    } catch {
      resolve({ voices: [], error: 'Failed to fetch voices.' });
    }
  });
}

function formatEdgeLocaleLabel(locale: string, rawLabel?: string): string {
  const map: Record<string, string> = {
    'en-US': 'English (US)',
    'en-GB': 'English (UK)',
    'pt-BR': 'Portuguese (Brazil)',
    'es-ES': 'Spanish (Spain)',
    'es-MX': 'Spanish (Mexico)',
    'fr-FR': 'French (France)',
    'fr-CA': 'French (Canada)',
    'zh-CN': 'Chinese (Mandarin)',
  };
  if (map[locale]) return map[locale];
  if (rawLabel && typeof rawLabel === 'string') {
    return rawLabel
      .replace(/\bUnited States\b/i, 'US')
      .replace(/\bUnited Kingdom\b/i, 'UK');
  }
  return locale;
}

function formatEdgeVoiceLabel(shortName: string): string {
  const cleaned = String(shortName || '').replace(/Neural$/i, '');
  const parts = cleaned.split('-');
  if (parts.length >= 3) {
    return parts.slice(2).join('-');
  }
  return cleaned;
}

function fetchEdgeTtsVoiceCatalog(timeoutMs = 12000): Promise<EdgeTtsVoiceCatalogEntry[]> {
  return new Promise((resolve, reject) => {
    try {
      const https = require('https');
      const drm = require('node-edge-tts/dist/drm.js');
      const token = String(drm?.TRUSTED_CLIENT_TOKEN || '').trim();
      const version = String(drm?.CHROMIUM_FULL_VERSION || '').trim();
      const secMsGec = typeof drm?.generateSecMsGecToken === 'function'
        ? String(drm.generateSecMsGecToken() || '')
        : '';

      if (!token || !version || !secMsGec) {
        reject(new Error('Failed to initialize Edge TTS DRM values.'));
        return;
      }

      const major = version.split('.')[0] || '120';
      const url = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${token}`;

      const req = https.request(url, {
        method: 'GET',
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
          'Accept': 'application/json',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'Referer': 'https://edge.microsoft.com/',
          'Sec-MS-GEC': secMsGec,
          'Sec-MS-GEC-Version': `1-${version}`,
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
        },
      }, (res: any) => {
        let body = '';
        res.on('data', (chunk: Buffer | string) => { body += String(chunk || ''); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Voice catalog HTTP ${res.statusCode}`));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            if (!Array.isArray(parsed)) {
              reject(new Error('Voice catalog response was not an array.'));
              return;
            }
            const mapped = parsed
              .map((entry: any): EdgeTtsVoiceCatalogEntry | null => {
                const shortName = String(entry?.ShortName || entry?.Name || '').trim();
                if (!shortName) return null;
                const locale = String(entry?.Locale || shortName.split('-').slice(0, 2).join('-') || '').trim();
                if (!locale) return null;
                const rawGender = String(entry?.Gender || '').toLowerCase();
                const gender: 'female' | 'male' = rawGender === 'male' ? 'male' : 'female';
                const personalities = Array.isArray(entry?.VoiceTag?.VoicePersonalities)
                  ? entry.VoiceTag.VoicePersonalities
                  : [];
                const style = personalities.length > 0 ? String(personalities[0]) : '';
                return {
                  id: shortName,
                  label: formatEdgeVoiceLabel(shortName),
                  languageCode: locale,
                  languageLabel: formatEdgeLocaleLabel(locale, String(entry?.LocaleName || '')),
                  gender,
                  style: style || undefined,
                };
              })
              .filter(Boolean) as EdgeTtsVoiceCatalogEntry[];

            mapped.sort((a, b) => {
              const langCmp = a.languageLabel.localeCompare(b.languageLabel);
              if (langCmp !== 0) return langCmp;
              const genderCmp = a.gender.localeCompare(b.gender);
              if (genderCmp !== 0) return genderCmp;
              return a.label.localeCompare(b.label);
            });
            resolve(mapped);
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error: Error) => reject(error));
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Voice catalog request timed out.'));
      });
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function getSelectedTextForSpeak(options?: { allowClipboardFallback?: boolean; clipboardWaitMs?: number }): Promise<string> {
  const allowClipboardFallback = options?.allowClipboardFallback !== false;
  const clipboardWaitMs = Math.max(0, Number(options?.clipboardWaitMs ?? 380) || 380);
  const fromAccessibility = await (async () => {
    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);
      const script = `
        tell application "System Events"
          try
            set frontApp to first application process whose frontmost is true
            set focusedElement to value of attribute "AXFocusedUIElement" of frontApp
            if focusedElement is missing value then return ""
            set selectedText to value of attribute "AXSelectedText" of focusedElement
            return selectedText
          on error
            return ""
          end try
        end tell
      `;
      const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script]);
      return String(stdout || '').trim();
    } catch {
      return '';
    }
  })();
  if (fromAccessibility) return fromAccessibility;
  if (!allowClipboardFallback) return '';

  const previousClipboard = systemClipboard.readText();
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('/usr/bin/osascript', [
      '-e',
      'tell application "System Events" to keystroke "c" using command down',
    ]);
    // Wait briefly for apps that populate clipboard asynchronously, but avoid
    // injecting probe text into the user's clipboard.
    const waitUntil = Date.now() + clipboardWaitMs;
    let latest = '';
    while (Date.now() < waitUntil) {
      latest = String(systemClipboard.readText() || '');
      if (latest !== String(previousClipboard || '')) break;
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    const captured = String(latest || systemClipboard.readText() || '').trim();
    if (!captured || captured === String(previousClipboard || '').trim()) return '';
    return captured;
  } catch {
    return '';
  } finally {
    try {
      systemClipboard.writeText(previousClipboard);
    } catch {}
  }
}

function rememberSelectionSnapshot(text: string): void {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    lastLauncherSelectionSnapshot = '';
    lastLauncherSelectionSnapshotAt = 0;
    return;
  }
  lastLauncherSelectionSnapshot = raw;
  lastLauncherSelectionSnapshotAt = Date.now();
  lastCursorPromptSelection = raw;
}

function getRecentSelectionSnapshot(): string {
  if (!lastLauncherSelectionSnapshot) return '';
  if (Date.now() - lastLauncherSelectionSnapshotAt > LAUNCHER_SELECTION_SNAPSHOT_TTL_MS) {
    lastLauncherSelectionSnapshot = '';
    lastLauncherSelectionSnapshotAt = 0;
    return '';
  }
  return lastLauncherSelectionSnapshot;
}

async function captureSelectionSnapshotBeforeShow(options?: { allowClipboardFallback?: boolean }): Promise<string> {
  if (launcherMode !== 'default') {
    rememberSelectionSnapshot('');
    return '';
  }
  const allowClipboardFallback = options?.allowClipboardFallback === true;
  try {
    const selected = String(
      await getSelectedTextForSpeak({ allowClipboardFallback, clipboardWaitMs: 90 }) || ''
    );
    rememberSelectionSnapshot(selected);
    return getRecentSelectionSnapshot();
  } catch {
    rememberSelectionSnapshot('');
    return '';
  }
}

function stopSpeakSession(options?: { resetStatus?: boolean; cleanupWindow?: boolean }): void {
  const session = activeSpeakSession;
  if (!session) {
    if (options?.resetStatus) {
      setSpeakStatus({ state: 'idle', text: '', index: 0, total: 0 });
    }
    if (options?.cleanupWindow) {
      try {
        mainWindow?.webContents.send('run-system-command', 'system-supercmd-speak-close');
      } catch {}
    }
    return;
  }

  session.stopRequested = true;
  if (session.afplayProc) {
    try { session.afplayProc.kill('SIGTERM'); } catch {}
    session.afplayProc = null;
  }
  for (const proc of session.ttsProcesses) {
    try { proc.kill('SIGTERM'); } catch {}
  }
  session.ttsProcesses.clear();

  // Delay temp dir cleanup slightly so any in-flight synthesizer workers that
  // were just interrupted do not race on removed chunk paths.
  const tmpDirToCleanup = session.tmpDir;
  setTimeout(() => {
    try {
      const fs = require('fs');
      fs.rmSync(tmpDirToCleanup, { recursive: true, force: true });
    } catch {}
  }, 2500);

  if (activeSpeakSession?.id === session.id) {
    activeSpeakSession = null;
  }
  if (options?.resetStatus !== false) {
    setSpeakStatus({ state: 'idle', text: '', index: 0, total: 0 });
  }
  if (options?.cleanupWindow) {
    try {
      mainWindow?.webContents.send('run-system-command', 'system-supercmd-speak-close');
    } catch {}
  }
}

function parseSpeakRateInput(input: any): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '+0%';
  if (/^[+-]?\d+%$/.test(raw)) {
    return raw.startsWith('+') || raw.startsWith('-') ? raw : `+${raw}`;
  }
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) {
    const pct = Math.max(-70, Math.min(150, Math.round((asNum - 1) * 100)));
    return `${pct >= 0 ? '+' : ''}${pct}%`;
  }
  return '+0%';
}

function normalizeAccelerator(shortcut: string): string {
  const raw = String(shortcut || '').trim();
  if (!raw) return raw;
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return raw;
  const key = parts[parts.length - 1];
  const modifierTokens = parts.slice(0, -1).map((part) => String(part || '').trim().toLowerCase());

  const normalizedModifiers = {
    command: false,
    control: false,
    alt: false,
    shift: false,
    fn: false,
  };

  // Hyper support temporarily disabled. Keep raw accelerator to avoid
  // accidentally downgrading "Hyper+X" to plain "X".
  const hasHyper = modifierTokens.some((token) => token === 'hyper' || token === '✦');
  if (hasHyper) {
    return raw;
  }

  for (const token of modifierTokens) {
    if (token === 'commandorcontrol' || token === 'cmdorctrl') {
      if (process.platform === 'darwin') normalizedModifiers.command = true;
      else normalizedModifiers.control = true;
      continue;
    }
    if (token === 'cmd' || token === 'command' || token === 'meta' || token === 'super') {
      normalizedModifiers.command = true;
      continue;
    }
    if (token === 'ctrl' || token === 'control') {
      normalizedModifiers.control = true;
      continue;
    }
    if (token === 'alt' || token === 'option') {
      normalizedModifiers.alt = true;
      continue;
    }
    if (token === 'shift') {
      normalizedModifiers.shift = true;
      continue;
    }
    if (token === 'fn' || token === 'function') {
      normalizedModifiers.fn = true;
      continue;
    }
  }

  // Keep punctuation keys as punctuation for Electron accelerator parsing.
  if (/^period$/i.test(key)) {
    parts[parts.length - 1] = '.';
  }

  const keyPart = parts[parts.length - 1];
  const output: string[] = [];
  if (normalizedModifiers.command) output.push('Command');
  if (normalizedModifiers.control) output.push('Control');
  if (normalizedModifiers.alt) output.push('Alt');
  if (normalizedModifiers.shift) output.push('Shift');
  if (normalizedModifiers.fn) output.push('Fn');
  output.push(keyPart);
  return output.join('+');
}

function normalizeShortcutKeyToken(token: string): string {
  const value = String(token || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'space' || value === 'spacebar') return 'space';
  if (value === 'period') return '.';
  return value;
}

function normalizeInputKeyToken(input: any): string {
  const rawKey = String(input?.key || '').toLowerCase();
  if (rawKey === ' ' || rawKey === 'spacebar') return 'space';
  if (rawKey) return rawKey;
  const rawCode = String(input?.code || '').toLowerCase();
  if (rawCode === 'space') return 'space';
  return '';
}

function markOpeningShortcutForSuppression(shortcut: string): void {
  openingShortcutToSuppress = normalizeAccelerator(shortcut);
  openingShortcutSuppressionUntil = Date.now() + OPENING_SHORTCUT_SUPPRESSION_MS;
}

function shouldSuppressOpeningShortcutInput(input: any): boolean {
  if (Date.now() > openingShortcutSuppressionUntil) return false;
  const shortcut = String(openingShortcutToSuppress || '').trim();
  if (!shortcut) return false;
  const parts = shortcut.split('+').map((part) => String(part || '').trim()).filter(Boolean);
  if (parts.length === 0) return false;
  const keyToken = normalizeShortcutKeyToken(parts[parts.length - 1]);
  if (!keyToken) return false;
  const mods = new Set(parts.slice(0, -1).map((part) => String(part || '').trim().toLowerCase()));
  const expectMeta = mods.has('command') || mods.has('cmd') || mods.has('meta') || mods.has('super') || mods.has('commandorcontrol') || mods.has('cmdorctrl');
  const expectCtrl = mods.has('control') || mods.has('ctrl') || (process.platform !== 'darwin' && (mods.has('commandorcontrol') || mods.has('cmdorctrl')));
  const expectAlt = mods.has('alt') || mods.has('option');
  const expectShift = mods.has('shift');
  const actualKey = normalizeInputKeyToken(input);
  const actualMeta = Boolean(input?.meta);
  const actualCtrl = Boolean(input?.control);
  const actualAlt = Boolean(input?.alt);
  const actualShift = Boolean(input?.shift);
  if (actualKey !== keyToken) return false;
  if (actualMeta !== expectMeta) return false;
  if (actualCtrl !== expectCtrl) return false;
  if (actualAlt !== expectAlt) return false;
  if (actualShift !== expectShift) return false;
  return true;
}

function unregisterShortcutVariants(shortcut: string): void {
  const raw = String(shortcut || '').trim();
  if (!raw) return;
  const normalized = normalizeAccelerator(raw);
  try { globalShortcut.unregister(raw); } catch {}
  if (normalized !== raw) {
    try { globalShortcut.unregister(normalized); } catch {}
  }
}

function isFnOnlyShortcut(shortcut: string): boolean {
  const normalized = normalizeAccelerator(shortcut).trim().toLowerCase();
  return normalized === 'fn' || normalized === 'function';
}

function isFnShortcut(shortcut: string): boolean {
  const config = parseHoldShortcutConfig(shortcut);
  return Boolean(config?.fn);
}

function parseHoldShortcutConfig(shortcut: string): {
  keyCode: number;
  cmd: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  fn: boolean;
} | null {
  const raw = normalizeAccelerator(shortcut);
  if (!raw) return null;
  const parts = raw.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return null;
  const keyToken = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const map: Record<string, number> = {
    a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9,
    b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, '1': 18, '2': 19,
    '3': 20, '4': 21, '6': 22, '5': 23, '=': 24, '9': 25, '7': 26, '-': 27,
    '8': 28, '0': 29, ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35,
    l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44,
    n: 45, m: 46, '.': 47, '`': 50,
    period: 47, comma: 43, slash: 44, semicolon: 41, quote: 39,
    tab: 48, space: 49, return: 36, enter: 36, escape: 53, fn: 63, function: 63,
  };
  const keyCode = map[keyToken];
  if (!Number.isFinite(keyCode)) return null;
  const fnAsModifier = mods.has('fn') || mods.has('function');
  return {
    keyCode,
    cmd: mods.has('command') || mods.has('cmd') || mods.has('meta'),
    ctrl: mods.has('control') || mods.has('ctrl'),
    alt: mods.has('alt') || mods.has('option'),
    shift: mods.has('shift'),
    fn: fnAsModifier || keyToken === 'fn' || keyToken === 'function',
  };
}

function stopWhisperHoldWatcher(): void {
  if (!whisperHoldWatcherProcess) return;
  try { whisperHoldWatcherProcess.kill('SIGTERM'); } catch {}
  whisperHoldWatcherProcess = null;
  whisperHoldWatcherStdoutBuffer = '';
  whisperHoldWatcherSeq = 0;
}

function stopFnSpeakToggleWatcher(): void {
  fnSpeakToggleWatcherEnabled = false;
  fnSpeakToggleIsPressed = false;
  if (fnSpeakToggleWatcherRestartTimer) {
    clearTimeout(fnSpeakToggleWatcherRestartTimer);
    fnSpeakToggleWatcherRestartTimer = null;
  }
  if (!fnSpeakToggleWatcherProcess) return;
  try { fnSpeakToggleWatcherProcess.kill('SIGTERM'); } catch {}
  fnSpeakToggleWatcherProcess = null;
  fnSpeakToggleWatcherStdoutBuffer = '';
}

function stopFnCommandWatcher(commandId: string): void {
  const timer = fnCommandWatcherRestartTimers.get(commandId);
  if (timer) {
    clearTimeout(timer);
    fnCommandWatcherRestartTimers.delete(commandId);
  }
  const proc = fnCommandWatcherProcesses.get(commandId);
  if (proc) {
    try { proc.kill('SIGTERM'); } catch {}
    fnCommandWatcherProcesses.delete(commandId);
  }
  fnCommandWatcherStdoutBuffers.delete(commandId);
}

function stopAllFnCommandWatchers(): void {
  for (const commandId of Array.from(fnCommandWatcherProcesses.keys())) {
    stopFnCommandWatcher(commandId);
  }
  fnCommandWatcherConfigs.clear();
}

function startFnCommandWatcher(commandId: string, shortcut: string): void {
  const configuredShortcut = String(fnCommandWatcherConfigs.get(commandId) || '').trim();
  if (!configuredShortcut || configuredShortcut !== String(shortcut || '').trim()) return;
  if (fnCommandWatcherProcesses.has(commandId)) return;
  const config = parseHoldShortcutConfig(shortcut);
  if (!config || !config.fn) return;
  const binaryPath = ensureWhisperHoldWatcherBinary();
  if (!binaryPath) return;

  const { spawn } = require('child_process');
  const proc = spawn(
    binaryPath,
    [
      String(config.keyCode),
      config.cmd ? '1' : '0',
      config.ctrl ? '1' : '0',
      config.alt ? '1' : '0',
      config.shift ? '1' : '0',
      config.fn ? '1' : '0',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  fnCommandWatcherProcesses.set(commandId, proc);
  fnCommandWatcherStdoutBuffers.set(commandId, '');

  proc.stdout.on('data', (chunk: Buffer | string) => {
    const prev = fnCommandWatcherStdoutBuffers.get(commandId) || '';
    const next = `${prev}${chunk.toString()}`;
    const lines = next.split('\n');
    fnCommandWatcherStdoutBuffers.set(commandId, lines.pop() || '');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const payload = JSON.parse(trimmed);
        if (payload?.pressed) {
          void runCommandById(commandId, 'hotkey');
        }
      } catch {}
    }
  });

  proc.stderr.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString().trim();
    if (text) console.warn('[Hotkey][fn-watcher]', text);
  });

  const scheduleRestart = () => {
    if (!fnCommandWatcherConfigs.has(commandId)) return;
    const restartTimer = setTimeout(() => {
      fnCommandWatcherRestartTimers.delete(commandId);
      const desired = fnCommandWatcherConfigs.get(commandId);
      if (!desired) return;
      startFnCommandWatcher(commandId, desired);
    }, 120);
    fnCommandWatcherRestartTimers.set(commandId, restartTimer);
  };

  proc.on('error', () => {
    fnCommandWatcherProcesses.delete(commandId);
    fnCommandWatcherStdoutBuffers.delete(commandId);
    scheduleRestart();
  });

  proc.on('exit', () => {
    fnCommandWatcherProcesses.delete(commandId);
    fnCommandWatcherStdoutBuffers.delete(commandId);
    scheduleRestart();
  });
}

function startFnSpeakToggleWatcher(): void {
  if (fnSpeakToggleWatcherProcess || !fnSpeakToggleWatcherEnabled) return;
  const config = parseHoldShortcutConfig('Fn');
  if (!config) return;
  const binaryPath = ensureWhisperHoldWatcherBinary();
  if (!binaryPath) return;

  const { spawn } = require('child_process');
  fnSpeakToggleWatcherProcess = spawn(
    binaryPath,
    [
      String(config.keyCode),
      config.cmd ? '1' : '0',
      config.ctrl ? '1' : '0',
      config.alt ? '1' : '0',
      config.shift ? '1' : '0',
      config.fn ? '1' : '0',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  fnSpeakToggleWatcherStdoutBuffer = '';

  fnSpeakToggleWatcherProcess.stdout.on('data', (chunk: Buffer | string) => {
    fnSpeakToggleWatcherStdoutBuffer += chunk.toString();
    const lines = fnSpeakToggleWatcherStdoutBuffer.split('\n');
    fnSpeakToggleWatcherStdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const payload = JSON.parse(trimmed);
        if (payload?.pressed) {
          const currentSettings = loadSettings();
          if (isAIDisabledInSettings(currentSettings) || currentSettings.ai?.whisperEnabled === false) {
            continue;
          }
          const now = Date.now();
          if (now - fnSpeakToggleLastPressedAt < 180) continue;
          fnSpeakToggleLastPressedAt = now;
          fnSpeakToggleIsPressed = true;
          void (async () => {
            if (whisperOverlayVisible) {
              captureFrontmostAppContext();
              if (whisperChildWindow && !whisperChildWindow.isDestroyed()) {
                const bounds = whisperChildWindow.getBounds();
                const pos = computeDetachedPopupPosition(DETACHED_WHISPER_WINDOW_NAME, bounds.width, bounds.height);
                whisperChildWindow.setPosition(pos.x, pos.y);
              }
              mainWindow?.webContents.send('whisper-start-listening');
              return;
            }
            await openLauncherAndRunSystemCommand('system-supercmd-whisper', {
              showWindow: false,
              mode: launcherMode === 'onboarding' ? 'onboarding' : 'default',
              preserveFocusWhenHidden: launcherMode !== 'onboarding',
            });
            lastWhisperShownAt = Date.now();
            const startDelays = [180, 340, 520];
            startDelays.forEach((delay) => {
              setTimeout(() => {
                if (!fnSpeakToggleIsPressed) return;
                mainWindow?.webContents.send('whisper-start-listening');
              }, delay);
            });
          })();
        }
        if (payload?.released) {
          fnSpeakToggleIsPressed = false;
          mainWindow?.webContents.send('whisper-stop-listening');
        }
      } catch {}
    }
  });

  fnSpeakToggleWatcherProcess.stderr.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString().trim();
    if (text) console.warn('[Whisper][fn-watcher]', text);
  });

  fnSpeakToggleWatcherProcess.on('error', () => {
    fnSpeakToggleWatcherProcess = null;
    fnSpeakToggleWatcherStdoutBuffer = '';
    if (!fnSpeakToggleWatcherEnabled) return;
    fnSpeakToggleWatcherRestartTimer = setTimeout(() => {
      fnSpeakToggleWatcherRestartTimer = null;
      startFnSpeakToggleWatcher();
    }, 280);
  });

  fnSpeakToggleWatcherProcess.on('exit', () => {
    fnSpeakToggleWatcherProcess = null;
    fnSpeakToggleWatcherStdoutBuffer = '';
    if (!fnSpeakToggleWatcherEnabled) return;
    fnSpeakToggleWatcherRestartTimer = setTimeout(() => {
      fnSpeakToggleWatcherRestartTimer = null;
      startFnSpeakToggleWatcher();
    }, 120);
  });
}

function syncFnSpeakToggleWatcher(hotkeys: Record<string, string>): void {
  // Do not start the CGEventTap-based Fn watcher during onboarding.
  // The tap requires Input Monitoring (and sometimes Accessibility) permission,
  // which would trigger system dialogs before the user reaches the Grant Access step.
  // Exception: fnWatcherOnboardingOverride is set when the user reaches the Dictation
  // test step (step 4) so they can actually test the Fn key during setup.
  if (!loadSettings().hasSeenOnboarding && !fnWatcherOnboardingOverride) {
    stopFnSpeakToggleWatcher();
    return;
  }
  const currentSettings = loadSettings();
  if (isAIDisabledInSettings(currentSettings) || currentSettings.ai?.whisperEnabled === false) {
    stopFnSpeakToggleWatcher();
    return;
  }
  const speakToggle = String(hotkeys?.['system-supercmd-whisper-speak-toggle'] || '').trim();
  const shouldEnable = isFnOnlyShortcut(speakToggle);
  if (!shouldEnable) {
    stopFnSpeakToggleWatcher();
    return;
  }
  fnSpeakToggleWatcherEnabled = true;
  startFnSpeakToggleWatcher();
}

function syncFnCommandWatchers(hotkeys: Record<string, string>): void {
  const desired = new Map<string, string>();
  for (const [commandId, shortcutRaw] of Object.entries(hotkeys || {})) {
    const shortcut = String(shortcutRaw || '').trim();
    if (!shortcut) continue;
    const normalized = normalizeAccelerator(shortcut);
    const isFnSpeakToggle = commandId === 'system-supercmd-whisper-speak-toggle' && isFnOnlyShortcut(normalized);
    if (isFnSpeakToggle) continue;
    if (!isFnShortcut(normalized)) continue;
    desired.set(commandId, normalized);
  }

  for (const existingCommandId of Array.from(fnCommandWatcherConfigs.keys())) {
    const nextShortcut = desired.get(existingCommandId);
    const currentShortcut = fnCommandWatcherConfigs.get(existingCommandId);
    if (!nextShortcut || nextShortcut !== currentShortcut) {
      fnCommandWatcherConfigs.delete(existingCommandId);
      stopFnCommandWatcher(existingCommandId);
    }
  }

  for (const [commandId, shortcut] of desired.entries()) {
    const current = fnCommandWatcherConfigs.get(commandId);
    if (current !== shortcut) {
      fnCommandWatcherConfigs.set(commandId, shortcut);
      stopFnCommandWatcher(commandId);
    }
    startFnCommandWatcher(commandId, shortcut);
  }
}

function ensureWhisperHoldWatcherBinary(): string | null {
  const fs = require('fs');
  const binaryPath = getNativeBinaryPath('hotkey-hold-monitor');
  if (fs.existsSync(binaryPath)) return binaryPath;
  try {
    const { execFileSync } = require('child_process');
    const sourceCandidates = [
      path.join(app.getAppPath(), 'src', 'native', 'hotkey-hold-monitor.swift'),
      path.join(process.cwd(), 'src', 'native', 'hotkey-hold-monitor.swift'),
      path.join(__dirname, '..', '..', 'src', 'native', 'hotkey-hold-monitor.swift'),
    ];
    const sourcePath = sourceCandidates.find((candidate) => fs.existsSync(candidate));
    if (!sourcePath) {
      console.warn('[Whisper][hold] Source file not found for hotkey-hold-monitor.swift');
      return null;
    }
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    execFileSync('swiftc', [
      '-O',
      '-o', binaryPath,
      sourcePath,
      '-framework', 'CoreGraphics',
      '-framework', 'AppKit',
      '-framework', 'Carbon',
    ]);
    return binaryPath;
  } catch (error) {
    console.warn('[Whisper][hold] Failed to compile hotkey hold monitor:', error);
    return null;
  }
}

function startWhisperHoldWatcher(shortcut: string, holdSeq: number): void {
  if (whisperHoldWatcherProcess) return;
  const config = parseHoldShortcutConfig(shortcut);
  if (!config) {
    console.warn('[Whisper][hold] Unsupported shortcut for hold-to-talk:', shortcut);
    return;
  }
  const binaryPath = ensureWhisperHoldWatcherBinary();
  if (!binaryPath) {
    console.warn('[Whisper][hold] Hold monitor binary unavailable');
    return;
  }

  const { spawn } = require('child_process');
  whisperHoldWatcherProcess = spawn(
    binaryPath,
    [
      String(config.keyCode),
      config.cmd ? '1' : '0',
      config.ctrl ? '1' : '0',
      config.alt ? '1' : '0',
      config.shift ? '1' : '0',
      config.fn ? '1' : '0',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  whisperHoldWatcherSeq = holdSeq;
  whisperHoldWatcherStdoutBuffer = '';

  whisperHoldWatcherProcess.stdout.on('data', (chunk: Buffer | string) => {
    whisperHoldWatcherStdoutBuffer += chunk.toString();
    const lines = whisperHoldWatcherStdoutBuffer.split('\n');
    whisperHoldWatcherStdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const payload = JSON.parse(trimmed);
        if (payload?.released) {
          whisperHoldReleasedSeq = Math.max(whisperHoldReleasedSeq, holdSeq);
          mainWindow?.webContents.send('whisper-stop-listening');
          stopWhisperHoldWatcher();
          return;
        }
      } catch {}
    }
  });

  whisperHoldWatcherProcess.stderr.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString().trim();
    if (text) console.warn('[Whisper][hold]', text);
  });

  whisperHoldWatcherProcess.on('error', (error: any) => {
    console.warn('[Whisper][hold] Monitor process error:', error);
    whisperHoldWatcherProcess = null;
    whisperHoldWatcherStdoutBuffer = '';
    whisperHoldWatcherSeq = 0;
  });

  whisperHoldWatcherProcess.on('exit', () => {
    whisperHoldWatcherProcess = null;
    whisperHoldWatcherStdoutBuffer = '';
    if (whisperHoldWatcherSeq === holdSeq) {
      whisperHoldWatcherSeq = 0;
    }
  });
}

function handleOAuthCallbackUrl(rawUrl: string): void {
  if (!rawUrl) return;
  console.log('[OAuth] handleOAuthCallbackUrl called with:', rawUrl);
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'supercmd:') return;
    const isOAuthCallback =
      (parsed.hostname === 'oauth' && parsed.pathname === '/callback') ||
      parsed.pathname === '/oauth/callback' ||
      (parsed.hostname === 'auth' && parsed.pathname === '/callback') ||
      parsed.pathname === '/auth/callback';
    if (!isOAuthCallback) return;
    // OAuth callback received: release temporary blur suppression immediately.
    clearOAuthBlurHideSuppression();

    // Persist the token immediately so it survives window resets and app restarts.
    const provider = parsed.searchParams.get('provider') || '';
    const accessToken = parsed.searchParams.get('access_token') || '';
    const tokenType = parsed.searchParams.get('token_type') || 'Bearer';
    const expiresIn = parseInt(parsed.searchParams.get('expires_in') || '0', 10) || undefined;
    const scope = parsed.searchParams.get('scope') || '';
    if (provider && accessToken) {
      console.log('[OAuth] Persisting token for provider:', provider);
      setOAuthToken(provider, {
        accessToken,
        tokenType,
        scope,
        expiresIn,
        obtainedAt: new Date().toISOString(),
      });
    }

    if (!mainWindow) {
      pendingOAuthCallbackUrls.push(rawUrl);
      return;
    }

    // Focus the existing window without resetting app state —
    // the extension view with the OAuth prompt must stay mounted.
    // Set isVisible = true so that the app.on('activate') handler
    // (triggered by macOS when the deep link brings the app forward)
    // skips calling openLauncherFromUserEntry().
    isVisible = true;
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
    mainWindow.webContents.send('oauth-callback', rawUrl);
  } catch {
    // ignore invalid URLs
  }
}

app.on('open-url', (event: any, url: string) => {
  event.preventDefault();
  console.log('[OAuth] open-url event received:', url);
  handleOAuthCallbackUrl(url);
});

// ─── Menu Bar (Tray) Management ─────────────────────────────────────

const menuBarTrays = new Map<string, InstanceType<typeof Tray>>();
let appTray: InstanceType<typeof Tray> | null = null;

function loadAppTrayIcon(): any {
  const fs = require('fs');
  const candidates = [
    path.join(process.cwd(), 'supercmd.png'),
    path.join(app.getAppPath(), 'supercmd.png'),
    path.join(process.resourcesPath || '', 'supercmd.png'),
    path.join(process.resourcesPath || '', 'supercmd.icns'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const icon = nativeImage.createFromPath(candidate);
      if (!icon || icon.isEmpty()) continue;
      const resized = icon.resize({ width: 18, height: 18 });
      // Use template rendering on macOS so the icon adapts to light/dark menu bar.
      if (process.platform === 'darwin') {
        try { resized.setTemplateImage(true); } catch {}
      }
      return resized;
    } catch {}
  }

  return nativeImage.createEmpty();
}

function ensureAppTray(): void {
  if (appTray) return;

  try {
    const icon = loadAppTrayIcon();
    appTray = new Tray(icon);
    appTray.setToolTip('SuperCmd');
    appTray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Open SuperCmd',
          click: () => {
            void openLauncherFromUserEntry();
          },
        },
        { type: 'separator' },
        {
          label: 'Quit SuperCmd',
          click: () => {
            app.quit();
          },
        },
      ])
    );

  } catch (error) {
    console.warn('[Tray] Failed to create app tray:', error);
    appTray = null;
  }
}

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

function shouldAutoOpenDevToolsOnStartup(): boolean {
  const raw = String(process.env.SUPERCMD_OPEN_DEVTOOLS_ON_STARTUP || '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }
  return false;
}

function parseJsonObjectParam(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseScriptArgumentsFromQuery(parsed: URL): string[] {
  const values = parsed.searchParams.getAll('arguments').map((v) => String(v || ''));
  if (values.length > 0) return values;

  const legacyObject = parseJsonObjectParam(parsed.searchParams.get('arguments'));
  if (!legacyObject || Object.keys(legacyObject).length === 0) return [];

  const out: string[] = [];
  for (const value of Object.values(legacyObject)) {
    out.push(String(value ?? ''));
  }
  return out;
}

function parseExtensionCommandPath(pathValue: string): { extensionName: string; commandName: string } | null {
  const raw = String(pathValue || '').trim();
  const separatorIndex = raw.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) return null;

  const extensionName = raw.slice(0, separatorIndex).trim();
  const commandName = raw.slice(separatorIndex + 1).trim();
  if (!extensionName || !commandName) return null;

  return { extensionName, commandName };
}

type ParsedRaycastDeepLink =
  | {
      type: 'extension';
      ownerOrAuthorName?: string;
      extensionName: string;
      commandName: string;
      launchType?: string;
      arguments: Record<string, any>;
      fallbackText?: string | null;
    }
  | {
      type: 'scriptCommand';
      commandName: string;
      arguments: string[];
    };

function parseRaycastDeepLink(url: string): ParsedRaycastDeepLink | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'raycast:') return null;

    const parts = parsed.pathname.split('/').filter(Boolean).map((v) => decodeURIComponent(v));

    if (parsed.hostname === 'extensions') {
      let ownerOrAuthorName = '';
      let extensionName = '';
      let commandName = '';

      if (parts.length >= 3) {
        ownerOrAuthorName = parts[0] || '';
        extensionName = parts[1] || '';
        commandName = parts.slice(2).join('/').trim();
      } else if (parts.length >= 2) {
        extensionName = parts[0] || '';
        commandName = parts.slice(1).join('/').trim();
      }

      if (!extensionName || !commandName) return null;
      return {
        type: 'extension',
        ownerOrAuthorName,
        extensionName,
        commandName,
        launchType: parsed.searchParams.get('launchType') || undefined,
        arguments: parseJsonObjectParam(parsed.searchParams.get('arguments')),
        fallbackText: parsed.searchParams.get('fallbackText'),
      };
    }

    if (parsed.hostname === 'script-commands') {
      const commandName = parts.join('/').trim();
      if (!commandName) return null;
      return {
        type: 'scriptCommand',
        commandName,
        arguments: parseScriptArgumentsFromQuery(parsed),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeOpenTarget(rawTarget: string): {
  normalizedTarget: string;
  launchTarget: string;
  externalTarget: string;
} {
  const normalizedTarget = (() => {
    if (rawTarget.startsWith('file://')) {
      try {
        return decodeURIComponent(new URL(rawTarget).pathname);
      } catch {
        return rawTarget;
      }
    }
    if (rawTarget.startsWith('~/')) return path.join(os.homedir(), rawTarget.slice(2));
    if (rawTarget === '~') return os.homedir();
    return rawTarget;
  })();

  const launchTarget = path.isAbsolute(normalizedTarget) ? normalizedTarget : rawTarget;
  const externalTarget = rawTarget.includes(' ') ? encodeURI(rawTarget) : rawTarget;
  return { normalizedTarget, launchTarget, externalTarget };
}

async function openTargetWithApplication(target: string, application?: string): Promise<boolean> {
  const rawTarget = String(target || '').trim();
  if (!rawTarget) return false;
  const appName = String(application || '').trim();
  const { normalizedTarget, launchTarget, externalTarget } = normalizeOpenTarget(rawTarget);

  if (appName) {
    try {
      const { spawn } = require('child_process');
      const exitCode = await new Promise<number>((resolve) => {
        const proc = spawn('open', ['-a', appName, launchTarget], { shell: false });
        let stderr = '';

        proc.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code: number | null) => {
          const resolved = code ?? 1;
          if (resolved !== 0) {
            console.error(`Failed to open target with ${appName}: ${launchTarget}`, stderr.trim() || `exit code ${resolved}`);
          }
          resolve(resolved);
        });

        proc.on('error', (err: Error) => {
          console.error(`Failed to open target with ${appName}: ${launchTarget}`, err);
          resolve(1);
        });
      });
      return exitCode === 0;
    } catch (error) {
      console.error(`Failed to open target with ${appName}: ${launchTarget}`, error);
      return false;
    }
  }

  if (path.isAbsolute(normalizedTarget)) {
    try {
      const openPathError = await shell.openPath(normalizedTarget);
      if (openPathError) {
        console.error(`Failed to open path: ${normalizedTarget}`, openPathError);
        return false;
      }
      return true;
    } catch (error) {
      console.error(`Failed to open path: ${normalizedTarget}`, error);
      return false;
    }
  }

  try {
    await shell.openExternal(externalTarget);
    return true;
  } catch (error) {
    if (externalTarget !== rawTarget) {
      try {
        await shell.openExternal(rawTarget);
        return true;
      } catch {}
    }
    console.error(`Failed to open URL: ${rawTarget}`, error);
    return false;
  }
}

async function openQuickLinkById(id: string, dynamicValues?: Record<string, string>): Promise<boolean> {
  const quickLinkId = String(id || '').trim();
  if (!quickLinkId) return false;

  const quickLink = getQuickLinkById(quickLinkId);
  if (!quickLink) {
    console.warn(`[QuickLinks] Quick link not found: ${quickLinkId}`);
    return false;
  }

  const resolvedTarget = resolveQuickLinkUrlTemplate(quickLink.urlTemplate, dynamicValues);
  if (!resolvedTarget) {
    console.warn(`[QuickLinks] Resolved URL is empty for: ${quickLink.name}`);
    return false;
  }

  return await openTargetWithApplication(resolvedTarget, quickLink.applicationName);
}

async function buildLaunchBundle(options: {
  extensionName: string;
  commandName: string;
  args?: Record<string, any>;
  type?: string;
  fallbackText?: string | null;
  context?: any;
  sourceExtensionName?: string;
  sourcePreferences?: Record<string, any>;
}) {
  const {
    extensionName,
    commandName,
    args,
    type,
    fallbackText,
    context,
    sourceExtensionName,
    sourcePreferences,
  } = options;
  const result = await getExtensionBundle(extensionName, commandName);
  if (!result) {
    throw new Error(`Command "${commandName}" not found in extension "${extensionName}"`);
  }

  const mergedPreferences: Record<string, any> = {
    ...(result.preferences || {}),
  };

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

  return {
    code: result.code,
    title: result.title,
    mode: result.mode,
    extName: extensionName,
    cmdName: commandName,
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
  };
}

// ─── Launcher Window ────────────────────────────────────────────────

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    x: Math.floor((screenWidth - DEFAULT_WINDOW_WIDTH) / 2),
    y: Math.floor(screenHeight * 0.2),
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    vibrancy: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.setWindowButtonVisibility(true);
  applyLiquidGlassToWindow(mainWindow, {
    cornerRadius: 16,
    fallbackVibrancy: 'under-window',
  });

  // Allow renderer getUserMedia requests so Chromium can surface native prompts.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc: any, permission: any, callback: any) => {
    if (permission === 'media' || permission === 'microphone') {
      callback(true);
      return;
    }
    callback(true);
  });

  // Swallow the exact shortcut event that opened the launcher. Without this,
  // macOS can emit the invalid-action beep when the key-equivalent lands on the
  // newly focused window while the key is still held.
  mainWindow.webContents.on('before-input-event', (event: any, input: any) => {
    const inputType = String(input?.type || '').toLowerCase();
    if (inputType !== 'keydown') return;
    if (!shouldSuppressOpeningShortcutInput(input)) return;
    event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler((details: any) => {
    const detachedPopupName = resolveDetachedPopupName(details);
    if (!detachedPopupName) {
      return { action: 'allow' };
    }

    const useNativeVibrancyForWindowManager =
      isGlassyUiStyleEnabled() &&
      detachedPopupName === DETACHED_WINDOW_MANAGER_WINDOW_NAME &&
      !getElectronLiquidGlassApi();

    const popupBounds = parsePopupFeatures(details?.features || '');
    const defaultWidth = detachedPopupName === DETACHED_WHISPER_WINDOW_NAME
      ? 272
      : detachedPopupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME
        ? 920
      : detachedPopupName === DETACHED_WINDOW_MANAGER_WINDOW_NAME
        ? 320
      : detachedPopupName === DETACHED_PROMPT_WINDOW_NAME
        ? CURSOR_PROMPT_WINDOW_WIDTH
      : detachedPopupName === DETACHED_MEMORY_STATUS_WINDOW_NAME
        ? 340
        : 520;
    const defaultHeight = detachedPopupName === DETACHED_WHISPER_WINDOW_NAME
      ? 52
      : detachedPopupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME
        ? 640
      : detachedPopupName === DETACHED_WINDOW_MANAGER_WINDOW_NAME
        ? 276
      : detachedPopupName === DETACHED_PROMPT_WINDOW_NAME
        ? CURSOR_PROMPT_WINDOW_HEIGHT
      : detachedPopupName === DETACHED_MEMORY_STATUS_WINDOW_NAME
        ? 60
        : 112;
    const finalWidth = typeof popupBounds.width === 'number' ? popupBounds.width : defaultWidth;
    const finalHeight = typeof popupBounds.height === 'number' ? popupBounds.height : defaultHeight;
    const popupPos = computeDetachedPopupPosition(detachedPopupName, finalWidth, finalHeight);

    return {
      action: 'allow',
      outlivesOpener: true,
      overrideBrowserWindowOptions: {
        width: finalWidth,
        height: finalHeight,
        x: popupPos.x,
        y: popupPos.y,
        title:
          detachedPopupName === DETACHED_WHISPER_WINDOW_NAME
            ? 'SuperCmd Whisper'
            : detachedPopupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME
            ? 'SuperCmd Whisper Onboarding'
            : detachedPopupName === DETACHED_PROMPT_WINDOW_NAME
              ? 'SuperCmd Prompt'
              : detachedPopupName === DETACHED_WINDOW_MANAGER_WINDOW_NAME
                ? 'SuperCmd Window Manager'
              : detachedPopupName === DETACHED_MEMORY_STATUS_WINDOW_NAME
                ? 'SuperCmd Status'
              : 'SuperCmd Read',
        frame: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        transparent: true,
        backgroundColor: '#00000000',
        vibrancy: detachedPopupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME
          ? 'fullscreen-ui'
          : useNativeVibrancyForWindowManager
            ? 'under-window'
            : undefined,
        visualEffectState:
          detachedPopupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME || useNativeVibrancyForWindowManager
            ? 'active'
            : undefined,
        hasShadow: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable:
          detachedPopupName !== DETACHED_WHISPER_WINDOW_NAME &&
          detachedPopupName !== DETACHED_MEMORY_STATUS_WINDOW_NAME,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: true,
        acceptFirstMouse: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js'),
        },
      },
    };
  });

  mainWindow.webContents.on('did-create-window', (childWindow: any, details: any) => {
    const detachedPopupName = resolveDetachedPopupName(details);
    if (!detachedPopupName) return;

    const hideWindowButtons = () => {
      if (process.platform !== 'darwin') return;
      try {
        childWindow.setWindowButtonVisibility(false);
      } catch {}
    };

    hideWindowButtons();
    childWindow.once('ready-to-show', hideWindowButtons);
    childWindow.on('focus', hideWindowButtons);

    try { childWindow.setMenuBarVisibility(false); } catch {}
    try { childWindow.setSkipTaskbar(true); } catch {}
    try { childWindow.setAlwaysOnTop(true); } catch {}
    try { childWindow.setHasShadow(false); } catch {}

    if (detachedPopupName === DETACHED_WHISPER_WINDOW_NAME) {
      whisperChildWindow = childWindow;
      try { childWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
      // Ignore mouse events by default so clicks pass through; widget will re-enable on hover
      try { childWindow.setIgnoreMouseEvents(true, { forward: true }); } catch {}
      childWindow.on('closed', () => {
        if (whisperChildWindow === childWindow) whisperChildWindow = null;
      });
      return;
    }

    if (detachedPopupName === DETACHED_WINDOW_MANAGER_WINDOW_NAME && isGlassyUiStyleEnabled()) {
      applyLiquidGlassToWindowManagerPopup(childWindow);
    }

    if (detachedPopupName === DETACHED_MEMORY_STATUS_WINDOW_NAME) {
      try { childWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
      try { childWindow.setIgnoreMouseEvents(true, { forward: true }); } catch {}
    }
  });

  // Hide traffic light buttons on macOS
  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(false);
  }

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // NOTE: Do NOT call app.dock.hide() here. Hiding the dock before the window
  // is loaded and shown prevents macOS from granting the app foreground status,
  // causing the window to never appear on first launch from Launchpad/Finder.
  // The dock is hidden later in openLauncherFromUserEntry() after the window
  // is confirmed loaded, or deferred until onboarding completes for fresh installs.

  loadWindowUrl(mainWindow, '/');

  mainWindow.webContents.once('did-finish-load', () => {
    if (shouldAutoOpenDevToolsOnStartup()) {
      try {
        mainWindow?.webContents.openDevTools({ mode: 'detach', activate: true });
      } catch (error) {
        console.warn('[DevTools] Failed auto-opening startup devtools:', error);
      }
    }

    if (pendingOAuthCallbackUrls.length > 0) {
      const urls = pendingOAuthCallbackUrls.splice(0, pendingOAuthCallbackUrls.length);
      for (const url of urls) {
        mainWindow?.webContents.send('oauth-callback', url);
      }
    }
    if (AUTO_OPEN_DEVTOOLS_ON_START) {
      setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.openDevTools({ mode: 'detach', activate: true });
          }
        } catch (error) {
          console.warn('[DevTools] Failed opening startup devtools:', error);
        }
      }, 120);
    }
  });

  mainWindow.on('blur', () => {
    if (
      isVisible &&
      !suppressBlurHide &&
      oauthBlurHideSuppressionDepth === 0 &&
      launcherMode !== 'whisper' &&
      launcherMode !== 'speak' &&
      launcherMode !== 'onboarding'
    ) {
      hideWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function computePromptWindowBounds(
  preCapturedCaretRect?: { x: number; y: number; width: number; height: number } | null,
  preCapturedInputRect?: { x: number; y: number; width: number; height: number } | null,
): { x: number; y: number; width: number; height: number } {
  const rawCaretRect = preCapturedCaretRect !== undefined ? preCapturedCaretRect : getTypingCaretRect();
  const rawFocusedInputRect = preCapturedInputRect !== undefined ? preCapturedInputRect : getFocusedInputRect();

  const frontWindowRect = (() => {
    try {
      const { execFileSync } = require('child_process');
      const script = `
        tell application "System Events"
          try
            set frontApp to first application process whose frontmost is true
            set frontWindow to first window of frontApp
            set b to bounds of frontWindow
            set x1 to item 1 of b
            set y1 to item 2 of b
            set x2 to item 3 of b
            set y2 to item 4 of b
            return (x1 as string) & "," & (y1 as string) & "," & ((x2 - x1) as string) & "," & ((y2 - y1) as string)
          on error
            return ""
          end try
        end tell
      `;
      const out = String(
        execFileSync('/usr/bin/osascript', ['-e', script], {
          encoding: 'utf-8',
          timeout: 220,
        }) || ''
      ).trim();
      if (!out) return null;
      const [rawX, rawY, rawW, rawH] = out.split(',').map((part) => Number(String(part || '').trim()));
      if (![rawX, rawY, rawW, rawH].every((n) => Number.isFinite(n))) return null;
      return {
        x: Math.round(rawX),
        y: Math.round(rawY),
        width: Math.max(1, Math.round(rawW)),
        height: Math.max(1, Math.round(rawH)),
      };
    } catch {
      return null;
    }
  })();

  const normalizeRectToScreenSpace = (
    rect: { x: number; y: number; width: number; height: number } | null
  ): { x: number; y: number; width: number; height: number } | null => {
    if (!rect) return null;
    if (!frontWindowRect) return rect;
    const margin = 48;
    const looksLocalToWindow =
      rect.x >= -margin &&
      rect.y >= -margin &&
      rect.x <= frontWindowRect.width + margin &&
      rect.y <= frontWindowRect.height + margin;
    const looksOutsideGlobalWindow =
      rect.x < frontWindowRect.x - margin ||
      rect.y < frontWindowRect.y - margin ||
      rect.x > frontWindowRect.x + frontWindowRect.width + margin ||
      rect.y > frontWindowRect.y + frontWindowRect.height + margin;
    if (looksLocalToWindow && looksOutsideGlobalWindow) {
      return {
        x: rect.x + frontWindowRect.x,
        y: rect.y + frontWindowRect.y,
        width: rect.width,
        height: rect.height,
      };
    }
    return rect;
  };

  const focusedInputRect = normalizeRectToScreenSpace(rawFocusedInputRect);
  let caretRect = rawCaretRect;
  caretRect = normalizeRectToScreenSpace(caretRect);
  const width = CURSOR_PROMPT_WINDOW_WIDTH;
  const height = CURSOR_PROMPT_WINDOW_HEIGHT;

  // In Chromium-based apps (e.g. GitHub in Arc/Chrome), AX caret bounds can
  // occasionally refer to stale page selection while focus is in a different
  // editable control. Prefer the focused input rect when they conflict.
  if (caretRect && focusedInputRect) {
    const display = screen.getDisplayNearestPoint({ x: focusedInputRect.x, y: focusedInputRect.y });
    const area = display?.workArea || screen.getPrimaryDisplay().workArea;
    const focusedArea = focusedInputRect.width * focusedInputRect.height;
    const workAreaSize = area.width * area.height;
    const focusedIsHuge =
      focusedInputRect.width >= Math.floor(area.width * 0.9) &&
      focusedInputRect.height >= Math.floor(area.height * 0.72) &&
      focusedArea >= Math.floor(workAreaSize * 0.6);

    if (!focusedIsHuge) {
      const margin = 26;
      const caretInsideFocused =
        caretRect.x >= focusedInputRect.x - margin &&
        caretRect.y >= focusedInputRect.y - margin &&
        caretRect.x + caretRect.width <= focusedInputRect.x + focusedInputRect.width + margin &&
        caretRect.y + caretRect.height <= focusedInputRect.y + focusedInputRect.height + margin;
      if (!caretInsideFocused) {
        caretRect = null;
      }
    }
  }

  const promptAnchorPoint = caretRect
    ? {
        x: caretRect.x,
        y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
      }
    : focusedInputRect
      ? {
          x: focusedInputRect.x + 12,
          y: focusedInputRect.y + 18,
        }
      : lastTypingCaretPoint;

  if (caretRect) {
    lastTypingCaretPoint = {
      x: caretRect.x,
      y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
    };
  } else if (focusedInputRect) {
    lastTypingCaretPoint = {
      x: focusedInputRect.x + 12,
      y: focusedInputRect.y + 18,
    };
  }

  if (!promptAnchorPoint) {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: area.x + Math.floor((area.width - width) / 2),
      y: area.y + Math.floor(area.height * 0.28),
      width,
      height,
    };
  }

  const display = screen.getDisplayNearestPoint(promptAnchorPoint);
  const area = display?.workArea || screen.getPrimaryDisplay().workArea;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const x = clamp(
    promptAnchorPoint.x - CURSOR_PROMPT_LEFT_OFFSET,
    area.x + 8,
    area.x + area.width - width - 8
  );
  const baseY = caretRect ? caretRect.y : focusedInputRect ? focusedInputRect.y : promptAnchorPoint.y;
  const preferred = baseY - height - 10;
  const y = preferred >= area.y + 8
    ? preferred
    : clamp(baseY + 16, area.y + 8, area.y + area.height - height - 8);
  return { x, y, width, height };
}

function getDefaultPromptWindowBounds(): { x: number; y: number; width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + Math.floor((area.width - CURSOR_PROMPT_WINDOW_WIDTH) / 2),
    y: area.y + Math.floor(area.height * 0.28),
    width: CURSOR_PROMPT_WINDOW_WIDTH,
    height: CURSOR_PROMPT_WINDOW_HEIGHT,
  };
}

function createPromptWindow(initialBounds?: { x: number; y: number; width: number; height: number }): void {
  if (promptWindow && !promptWindow.isDestroyed()) return;
  const useNativeLiquidGlass = shouldUseNativeLiquidGlass();
  const bounds = initialBounds || getDefaultPromptWindowBounds();
  promptWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    transparent: true,
    backgroundColor: '#10101400',
    vibrancy: useNativeLiquidGlass ? false : 'fullscreen-ui',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (process.platform === 'darwin') {
    try { promptWindow.setWindowButtonVisibility(false); } catch {}
  }
  applyLiquidGlassToWindow(promptWindow, {
    cornerRadius: 16,
    fallbackVibrancy: 'fullscreen-ui',
  });
  promptWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadWindowUrl(promptWindow, '/prompt');
  promptWindow.on('blur', () => {
    hidePromptWindow();
  });
  promptWindow.on('closed', () => {
    promptWindow = null;
  });
}

function schedulePromptWindowPrewarm(): void {
  if (promptWindowPrewarmScheduled) return;
  promptWindowPrewarmScheduled = true;
  setTimeout(() => {
    try {
      createPromptWindow(getDefaultPromptWindowBounds());
    } catch {}
  }, PROMPT_WINDOW_PREWARM_DELAY_MS);
}

function showPromptWindow(
  preCapturedCaretRect?: { x: number; y: number; width: number; height: number } | null,
  preCapturedInputRect?: { x: number; y: number; width: number; height: number } | null,
): void {
  if (!promptWindow || promptWindow.isDestroyed()) {
    createPromptWindow(getDefaultPromptWindowBounds());
  }
  if (!promptWindow) return;
  const bounds = computePromptWindowBounds(preCapturedCaretRect, preCapturedInputRect);
  promptWindow.setBounds(bounds);
  promptWindow.show();
  promptWindow.focus();
  promptWindow.moveTop();
  promptWindow.webContents.focus();
  const selectedTextSnapshot = String(getRecentSelectionSnapshot() || lastCursorPromptSelection || '').trim();
  promptWindow.webContents.send('window-shown', {
    mode: 'prompt',
    selectedTextSnapshot,
  });
}

function hidePromptWindow(): void {
  if (!promptWindow || promptWindow.isDestroyed()) return;
  lastCursorPromptSelection = '';
  try {
    promptWindow.hide();
  } catch {
    try {
      promptWindow.close();
    } catch {}
  }
}

function getLauncherSize(mode: LauncherMode) {
  if (mode === 'prompt') {
    return { width: CURSOR_PROMPT_WINDOW_WIDTH, height: CURSOR_PROMPT_WINDOW_HEIGHT, topFactor: 0.2 };
  }
  if (mode === 'whisper') {
    return { width: WHISPER_WINDOW_WIDTH, height: WHISPER_WINDOW_HEIGHT, topFactor: 0.28 };
  }
  if (mode === 'speak') {
    return { width: 530, height: 300, topFactor: 0.03 };
  }
  if (mode === 'onboarding') {
    return { width: ONBOARDING_WINDOW_WIDTH, height: ONBOARDING_WINDOW_HEIGHT, topFactor: 0.12 };
  }
  return { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT, topFactor: 0.2 };
}

function getTypingCaretRect():
  | { x: number; y: number; width: number; height: number }
  | null {
  try {
    const { execFileSync } = require('child_process');
    const script = `
      ObjC.import('ApplicationServices');

      function copyAttributeValue(element, attribute) {
        const valueRef = Ref();
        const error = $.AXUIElementCopyAttributeValue(element, attribute, valueRef);
        if (error !== 0) return null;
        return valueRef[0];
      }

      function copyParameterizedAttributeValue(element, attribute, parameter) {
        const valueRef = Ref();
        const error = $.AXUIElementCopyParameterizedAttributeValue(element, attribute, parameter, valueRef);
        if (error !== 0) return null;
        return valueRef[0];
      }

      function decodeCFRange(axValue) {
        const rangeRef = Ref();
        rangeRef[0] = $.CFRangeMake(0, 0);
        const ok = $.AXValueGetValue(axValue, $.kAXValueCFRangeType, rangeRef);
        if (!ok) return null;
        return rangeRef[0];
      }

      function decodeCGRect(axValue) {
        const rectRef = Ref();
        rectRef[0] = $.CGRectMake(0, 0, 0, 0);
        const ok = $.AXValueGetValue(axValue, $.kAXValueCGRectType, rectRef);
        if (!ok) return null;
        return rectRef[0];
      }

      function main() {
        const systemWide = $.AXUIElementCreateSystemWide();
        if (!systemWide) return '';

        const focusedElement = copyAttributeValue(systemWide, $.kAXFocusedUIElementAttribute);
        if (!focusedElement) return '';

        const selectedRangeValue = copyAttributeValue(focusedElement, $.kAXSelectedTextRangeAttribute);
        if (!selectedRangeValue) return '';

        const selectedRange = decodeCFRange(selectedRangeValue);
        if (!selectedRange) return '';

        const caretRange = $.CFRangeMake(selectedRange.location + selectedRange.length, 0);
        const caretRangeValue = $.AXValueCreate($.kAXValueCFRangeType, caretRange);
        if (!caretRangeValue) return '';

        const caretBoundsValue = copyParameterizedAttributeValue(
          focusedElement,
          $.kAXBoundsForRangeParameterizedAttribute,
          caretRangeValue
        );
        if (!caretBoundsValue) return '';

        const caretRect = decodeCGRect(caretBoundsValue);
        if (!caretRect) return '';

        return [
          String(caretRect.origin.x),
          String(caretRect.origin.y),
          String(caretRect.size.width),
          String(caretRect.size.height),
        ].join(',');
      }

      try {
        const result = main();
        if (result) console.log(result);
      } catch (_) {
        console.log('');
      }
    `;
    const out = String(
      execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
        encoding: 'utf-8',
        timeout: 320,
      }) || ''
    ).trim();
    if (!out) return null;
    const [rawX, rawY, rawW, rawH] = out.split(',').map((part) => Number(String(part || '').trim()));
    if (![rawX, rawY, rawW, rawH].every((n) => Number.isFinite(n))) return null;
    return {
      x: Math.round(rawX),
      y: Math.round(rawY),
      width: Math.max(1, Math.round(rawW)),
      height: Math.max(1, Math.round(rawH)),
    };
  } catch {
    return null;
  }
}

function getFocusedInputRect():
  | { x: number; y: number; width: number; height: number }
  | null {
  try {
    const { execFileSync } = require('child_process');
    const script = `
      tell application "System Events"
        try
          set frontApp to first application process whose frontmost is true
          set focusedElement to value of attribute "AXFocusedUIElement" of frontApp
          if focusedElement is missing value then return ""
          set pos to value of attribute "AXPosition" of focusedElement
          set siz to value of attribute "AXSize" of focusedElement
          if pos is missing value or siz is missing value then return ""
          set ex to item 1 of pos
          set ey to item 2 of pos
          set ew to item 1 of siz
          set eh to item 2 of siz
          return (ex as string) & "," & (ey as string) & "," & (ew as string) & "," & (eh as string)
        on error
          return ""
        end try
      end tell
    `;
    const out = String(
      execFileSync('/usr/bin/osascript', ['-e', script], {
        encoding: 'utf-8',
        timeout: 220,
      }) || ''
    ).trim();
    if (!out) return null;
    const [rawX, rawY, rawW, rawH] = out.split(',').map((part) => Number(String(part || '').trim()));
    if (![rawX, rawY, rawW, rawH].every((n) => Number.isFinite(n))) return null;
    return {
      x: Math.round(rawX),
      y: Math.round(rawY),
      width: Math.max(1, Math.round(rawW)),
      height: Math.max(1, Math.round(rawH)),
    };
  } catch {
    return null;
  }
}

function applyLauncherBounds(mode: LauncherMode): void {
  if (!mainWindow) return;
  const cursorPoint = screen.getCursorScreenPoint();
  const caretRect = mode === 'prompt' ? getTypingCaretRect() : null;
  const focusedInputRect = mode === 'prompt' ? getFocusedInputRect() : null;
  if (caretRect) {
    lastTypingCaretPoint = {
      x: caretRect.x,
      y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
    };
  } else if (focusedInputRect) {
    lastTypingCaretPoint = {
      x: focusedInputRect.x + 12,
      y: focusedInputRect.y + 18,
    };
  }
  const promptAnchorPoint = caretRect
    ? {
        x: caretRect.x,
        y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
      }
    : focusedInputRect
      ? {
          x: focusedInputRect.x + 12,
          y: focusedInputRect.y + 18,
        }
      : (mode === 'prompt' && lastTypingCaretPoint)
        ? lastTypingCaretPoint
        : null;
  const currentDisplay = mode === 'prompt'
    ? (promptAnchorPoint
      ? screen.getDisplayNearestPoint(promptAnchorPoint)
      : screen.getPrimaryDisplay())
    : screen.getDisplayNearestPoint(cursorPoint);
  const {
    x: displayX,
    y: displayY,
    width: displayWidth,
    height: displayHeight,
  } = currentDisplay.workArea;
  const size = getLauncherSize(mode);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const promptFallbackX = displayX + Math.floor((displayWidth - size.width) / 2);
  const promptFallbackY = displayY + Math.floor(displayHeight * 0.32);
  const windowX = mode === 'speak'
    ? displayX + displayWidth - size.width - 20
    : mode === 'prompt'
      ? clamp(
          (promptAnchorPoint?.x ?? promptFallbackX) - CURSOR_PROMPT_LEFT_OFFSET,
          displayX + 8,
          displayX + displayWidth - size.width - 8
        )
      : displayX + Math.floor((displayWidth - size.width) / 2);
  const windowY = mode === 'whisper'
    ? displayY + displayHeight - size.height - 18
    : mode === 'speak'
      ? displayY + 16
      : mode === 'prompt'
        ? (() => {
            const baseY = caretRect
              ? caretRect.y
              : focusedInputRect
                ? focusedInputRect.y
                : (promptAnchorPoint?.y ?? promptFallbackY);
            const preferred = baseY - size.height - 10;
            if (preferred >= displayY + 8) return preferred;
            return clamp(baseY + 16, displayY + 8, displayY + displayHeight - size.height - 8);
          })()
        : displayY + Math.floor(displayHeight * size.topFactor);
  mainWindow.setBounds({
    x: windowX,
    y: windowY,
    width: size.width,
    height: size.height,
  });
}

function setLauncherMode(mode: LauncherMode): void {
  const prevMode = launcherMode;
  launcherMode = mode;
  if (mainWindow) {
    try {
      if (process.platform === 'darwin') {
        if (mode === 'whisper' || mode === 'speak') {
          mainWindow.setVibrancy(null as any);
          mainWindow.setHasShadow(false);
          mainWindow.setFocusable(true);
          mainWindow.setBackgroundColor('#00000000');
        } else {
          mainWindow.setVibrancy('fullscreen-ui');
          mainWindow.setHasShadow(true);
          mainWindow.setFocusable(true);
          mainWindow.setBackgroundColor('#10101400');
        }
      }
      if (mode === 'onboarding') {
        mainWindow.setAlwaysOnTop(false);
        mainWindow.setVisibleOnAllWorkspaces(false);
      } else {
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
    } catch {}
    const onboardingTintChanged = (prevMode === 'onboarding') !== (mode === 'onboarding');
    applyLiquidGlassToWindow(mainWindow, {
      cornerRadius: 16,
      fallbackVibrancy: 'under-window',
      forceDarkTheme: mode === 'onboarding',
      forceReapply: onboardingTintChanged,
    });
  }
  if (mainWindow && isVisible && prevMode !== mode) {
    applyLauncherBounds(mode);
  }
  if (isVisible) {
    if (mode === 'whisper') {
      registerWhisperEscapeShortcut();
    } else {
      unregisterWhisperEscapeShortcut();
    }
  }
}

function cloneFrontmostAppContext(value: FrontmostAppContext | null | undefined): FrontmostAppContext | null {
  if (!value) return null;
  const name = String(value.name || '').trim();
  const pathValue = String(value.path || '').trim();
  const bundleId = String(value.bundleId || '').trim();
  if (!name && !pathValue && !bundleId) return null;
  return {
    name: name || (bundleId ? bundleId : 'Unknown'),
    path: pathValue,
    ...(bundleId ? { bundleId } : {}),
  };
}

function resolveLauncherEntryFrontmostApp(): FrontmostAppContext | null {
  const captured = cloneFrontmostAppContext(launcherEntryFrontmostApp);
  if (captured) return captured;
  return cloneFrontmostAppContext(lastFrontmostApp);
}

function cloneWorkArea(
  value: { x: number; y: number; width: number; height: number } | null | undefined
): { x: number; y: number; width: number; height: number } | null {
  if (!value) return null;
  return {
    x: Math.round(Number(value.x) || 0),
    y: Math.round(Number(value.y) || 0),
    width: Math.max(1, Math.round(Number(value.width) || 1)),
    height: Math.max(1, Math.round(Number(value.height) || 1)),
  };
}

function resolveLauncherEntryTargetWindowId(): string | null {
  const normalized = String(launcherEntryWindowManagementTargetWindowId || '').trim();
  if (normalized) return normalized;
  const fallback = String(windowManagementTargetWindowId || '').trim();
  return fallback || null;
}

function captureFrontmostAppContext(): void {
  if (process.platform !== 'darwin') return;
  try {
    const { execFileSync } = require('child_process');
    const asn = String(execFileSync('/usr/bin/lsappinfo', ['front'], { encoding: 'utf-8' }) || '').trim();
    if (asn) {
      const info = String(
        execFileSync('/usr/bin/lsappinfo', ['info', '-only', 'bundleid,name,path', asn], { encoding: 'utf-8' }) || ''
      );
      const bundleId =
        info.match(/"CFBundleIdentifier"\s*=\s*"([^"]*)"/)?.[1]?.trim() ||
        info.match(/"bundleid"\s*=\s*"([^"]*)"/i)?.[1]?.trim() ||
        '';
      const name =
        info.match(/"LSDisplayName"\s*=\s*"([^"]*)"/)?.[1]?.trim() ||
        info.match(/"name"\s*=\s*"([^"]*)"/i)?.[1]?.trim() ||
        '';
      const appPath = info.match(/"path"\s*=\s*"([^"]*)"/)?.[1]?.trim() || '';
      if (bundleId !== 'com.supercmd.app' && bundleId !== 'com.supercmd' && name !== 'SuperCmd' && name !== 'Electron') {
        if (bundleId || name || appPath) {
          lastFrontmostApp = {
            name: name || (bundleId ? bundleId : 'Unknown'),
            path: appPath || '',
            ...(bundleId ? { bundleId } : {}),
          };
          return;
        }
      }
    }
  } catch {
    // Fallback below.
  }

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
    if (bundleId !== 'com.supercmd' && name !== 'SuperCmd' && name !== 'Electron') {
      lastFrontmostApp = { name, path: appPath, bundleId };
    }
  } catch {
    // keep previously captured value
  }
}

async function showWindow(options?: { systemCommandId?: string }): Promise<void> {
  if (!mainWindow) return;
  setLauncherOverlayTopmost(true);
  let selectionSnapshotPromise: Promise<string> | null = null;

  // Capture the frontmost app BEFORE showing our window.
  // Skip during onboarding to avoid any focus-stealing side effects during setup.
  if (launcherMode !== 'onboarding') {
    captureFrontmostAppContext();
    launcherEntryFrontmostApp = cloneFrontmostAppContext(lastFrontmostApp);
    await captureWindowManagementTargetWindow();
    launcherEntryWindowManagementTargetWindowId = String(windowManagementTargetWindowId || '').trim() || null;
    launcherEntryWindowManagementTargetWorkArea = cloneWorkArea(windowManagementTargetWorkArea);
    // Keep launcher open path fast: avoid clipboard fallback (synthetic Cmd+C)
    // on window open because it can interfere with immediate typing.
    selectionSnapshotPromise = captureSelectionSnapshotBeforeShow({ allowClipboardFallback: false });
  } else {
    launcherEntryFrontmostApp = null;
    launcherEntryWindowManagementTargetWindowId = null;
    launcherEntryWindowManagementTargetWorkArea = null;
  }

  applyLauncherBounds(launcherMode);
  const initialSelectionSnapshot = getRecentSelectionSnapshot();

  const windowShownPayload = {
    mode: launcherMode,
    systemCommandId: options?.systemCommandId,
    selectedTextSnapshot: initialSelectionSnapshot,
  };

  // Notify renderer before showing the window so it can finalize view state
  // (including contextual command list) before first paint.
  mainWindow.webContents.send('window-shown', windowShownPayload);

  if (selectionSnapshotPromise) {
    void selectionSnapshotPromise.then((snapshot) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const nextSnapshot = String(snapshot || '').trim();
      const prevSnapshot = String(initialSelectionSnapshot || '').trim();
      if (nextSnapshot === prevSnapshot) return;
      mainWindow.webContents.send('selection-snapshot-updated', { selectedTextSnapshot: nextSnapshot });
    });
  }

  try {
    app.focus({ steal: true });
  } catch {}
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  isVisible = true;

  // First launch after app reopen can race with macOS activation; retry once.
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) return;
    try {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
      isVisible = true;
    } catch {}
  }, 140);

  // For onboarding, keep re-raising the window at multiple intervals.
  // Permission dialogs and the Launchpad close animation can push the window
  // behind other apps; these retries guarantee it stays in front.
  if (launcherMode === 'onboarding') {
    [300, 700, 1500].forEach((delay) => {
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || !isVisible) return;
        if (launcherMode !== 'onboarding') return;
        try { app.focus({ steal: true }); } catch {}
        try { mainWindow.show(); } catch {}
        try { mainWindow.focus(); } catch {}
        try { mainWindow.moveTop(); } catch {}
      }, delay);
    });
  }

  if (launcherMode === 'whisper') {
    registerWhisperEscapeShortcut();
  } else {
    unregisterWhisperEscapeShortcut();
  }

  if (launcherMode === 'whisper') {
    lastWhisperShownAt = Date.now();
  }
}

function hideWindow(): void {
  if (!mainWindow) return;
  emitWindowHidden();
  mainWindow.hide();
  isVisible = false;
  launcherEntryFrontmostApp = null;
  launcherEntryWindowManagementTargetWindowId = null;
  launcherEntryWindowManagementTargetWorkArea = null;
  unregisterWhisperEscapeShortcut();
  try {
    mainWindow.setFocusable(true);
  } catch {}
  setLauncherMode('default');
}

function openPreferredDevTools(): boolean {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const candidates = [
    focusedWindow,
    mainWindow,
    settingsWindow,
    extensionStoreWindow,
    promptWindow,
  ];
  const seen = new Set<number>();

  for (const win of candidates) {
    if (!win || win.isDestroyed()) continue;
    if (seen.has(win.id)) continue;
    seen.add(win.id);
    try {
      if (!win.isVisible()) {
        win.show();
      }
    } catch {}
    try {
      win.webContents.openDevTools({ mode: 'detach', activate: true });
      return true;
    } catch (error) {
      console.warn('[DevTools] Failed opening devtools for window:', error);
    }
  }

  return false;
}

async function activateLastFrontmostApp(): Promise<boolean> {
  if (!lastFrontmostApp) return false;
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    if (lastFrontmostApp.bundleId) {
      await execFileAsync('osascript', [
        '-e',
        `tell application id "${lastFrontmostApp.bundleId}" to activate`,
      ]);
      return true;
    }
  } catch {}

  try {
    if (lastFrontmostApp.name) {
      await execFileAsync('osascript', [
        '-e',
        `tell application "${lastFrontmostApp.name}" to activate`,
      ]);
      return true;
    }
  } catch {}

  try {
    if (lastFrontmostApp.path) {
      await execFileAsync('open', ['-a', lastFrontmostApp.path]);
      return true;
    }
  } catch {}

  try {
    if (lastFrontmostApp.bundleId) {
      await execFileAsync('open', ['-b', lastFrontmostApp.bundleId]);
      return true;
    }
  } catch {}

  return false;
}

async function typeTextDirectly(text: string): Promise<boolean> {
  const value = String(text || '');
  if (!value) return false;

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\\n');

  try {
    await execFileAsync('osascript', [
      '-e',
      `tell application "System Events" to keystroke "${escaped}"`,
    ]);
    return true;
  } catch (error) {
    console.error('Direct keystroke fallback failed:', error);
    return false;
  }
}

async function pasteTextToActiveApp(text: string): Promise<boolean> {
  const value = String(text || '');
  if (!value) return false;

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const previousClipboardText = systemClipboard.readText();

  try {
    systemClipboard.writeText(value);
    await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to keystroke "v" using command down',
    ]);
    setTimeout(() => {
      try {
        systemClipboard.writeText(previousClipboardText);
      } catch {}
    }, 250);
    return true;
  } catch (error) {
    console.error('pasteTextToActiveApp failed:', error);
    return false;
  }
}

async function replaceTextDirectly(previousText: string, nextText: string): Promise<boolean> {
  const prev = String(previousText || '');
  const next = String(nextText || '');

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    if (prev.length > 0) {
      const script = `
        tell application "System Events"
          repeat ${prev.length} times
            key code 51
          end repeat
        end tell
      `;
      await execFileAsync('osascript', ['-e', script]);
    }
    if (next.length > 0) {
      return await typeTextDirectly(next);
    }
    return true;
  } catch (error) {
    console.error('replaceTextDirectly failed:', error);
    return false;
  }
}

async function replaceTextViaBackspaceAndPaste(previousText: string, nextText: string): Promise<boolean> {
  const prev = String(previousText || '');
  const next = String(nextText || '');

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    if (prev.length > 0) {
      const script = `
        tell application "System Events"
          repeat ${prev.length} times
            key code 51
          end repeat
        end tell
      `;
      await execFileAsync('osascript', ['-e', script]);
      await new Promise((resolve) => setTimeout(resolve, 18));
    }
    if (next.length > 0) {
      return await pasteTextToActiveApp(next);
    }
    return true;
  } catch (error) {
    console.error('replaceTextViaBackspaceAndPaste failed:', error);
    return false;
  }
}

/**
 * Hide the launcher, re-activate the previous frontmost app, and simulate Cmd+V.
 * Used by both clipboard-paste-item and snippet-paste.
 */
async function hideAndPaste(): Promise<boolean> {
  scrubInternalClipboardProbe('before hideAndPaste');

  // Hide the window first
  if (mainWindow && isVisible) {
    emitWindowHidden();
    mainWindow.hide();
    isVisible = false;
    setLauncherMode('default');
  }

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  // Re-activate the previous frontmost app explicitly
  await activateLastFrontmostApp();

  // Small delay to let the target app gain focus
  await new Promise(resolve => setTimeout(resolve, 200));

  try {
    await execFileAsync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    return true;
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
      return true;
    } catch (e2) {
      console.error('Fallback paste also failed:', e2);
      return false;
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

  const expanderPath = getNativeBinaryPath('snippet-expander');
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
  try {
    snippetExpanderProcess = spawn(expanderPath, [JSON.stringify(keywords)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    console.warn('[SnippetExpander] Failed to spawn native helper:', error);
    return;
  }
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
      void openLauncherFromUserEntry();
    });
    return;
  }

  if (isVisible && launcherMode === 'whisper') {
    void openLauncherFromUserEntry();
    return;
  }

  if (isVisible && launcherMode === 'onboarding') {
    try {
      mainWindow?.webContents.send('onboarding-hotkey-pressed');
    } catch {}
    // If renderer completes onboarding in response to this signal, ensure the
    // launcher becomes visible in default mode immediately.
    setTimeout(() => {
      if (launcherMode !== 'default') return;
      if (isVisible) return;
      void showWindow();
    }, 90);
    return;
  }

  if (isVisible) {
    hideWindow();
  } else {
    void openLauncherFromUserEntry();
  }
}

async function openLauncherFromUserEntry(): Promise<void> {
  const settings = loadSettings();
  if (!settings.hasSeenOnboarding) {
    // Fresh install — route directly into onboarding.
    await openLauncherAndRunSystemCommand('system-open-onboarding', {
      showWindow: true,
      mode: 'onboarding',
      preserveFocusWhenHidden: false,
    });
    return;
  }

  // Returning user — hide dock for overlay-only behaviour, then show window.
  if (process.platform === 'darwin') {
    app.dock.hide();
  }
  setLauncherMode('default');
  await showWindow();
}

async function openLauncherAndRunSystemCommand(
  commandId: string,
  options?: {
    showWindow?: boolean;
    mode?: LauncherMode;
    preserveFocusWhenHidden?: boolean;
  }
): Promise<boolean> {
  if (!mainWindow) {
    createWindow();
  }
  if (!mainWindow) return false;

  const showLauncher = options?.showWindow !== false;
  const preserveFocusWhenHidden = options?.preserveFocusWhenHidden ?? !showLauncher;

  if (isWindowManagementSystemCommand(commandId)) {
    const launcherTargetWindowId = resolveLauncherEntryTargetWindowId();
    const launcherTargetWorkArea = cloneWorkArea(launcherEntryWindowManagementTargetWorkArea);
    if (isVisible && (launcherTargetWindowId || launcherTargetWorkArea)) {
      windowManagementTargetWindowId = launcherTargetWindowId;
      windowManagementTargetWorkArea = launcherTargetWorkArea;
    } else {
      await captureWindowManagementTargetWindow();
    }
  }
  if (preserveFocusWhenHidden) {
    captureFrontmostAppContext();
  }
  setLauncherMode(options?.mode || 'default');

  const sendCommand = async () => {
    const routedViaWindowShown =
      showLauncher && isWindowShownRoutedSystemCommand(commandId);

    if (showLauncher) {
      await showWindow({
        systemCommandId: routedViaWindowShown ? commandId : undefined,
      });
    }
    if (routedViaWindowShown) {
      // Fallback dispatch after show. This avoids missing onboarding on first
      // app-open when renderer listeners are still attaching.
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('run-system-command', commandId);
      }, 180);
    } else {
      mainWindow?.webContents.send('run-system-command', commandId);
    }
    if (preserveFocusWhenHidden && !showLauncher) {
      // Detached overlays can temporarily activate SuperCmd; restore the editor app.
      [50, 180, 360].forEach((delayMs) => {
        setTimeout(() => {
          if (isVisible) return;
          void activateLastFrontmostApp();
        }, delayMs);
      });
    }
  };

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', () => {
      void sendCommand();
    });
  } else {
    await sendCommand();
  }

  return true;
}

async function dispatchRendererCustomEvent(eventName: string, detail: any): Promise<boolean> {
  if (!mainWindow) {
    createWindow();
  }
  if (!mainWindow) return false;

  if (mainWindow.webContents.isLoadingMainFrame()) {
    await new Promise<void>((resolve) => {
      mainWindow?.webContents.once('did-finish-load', () => resolve());
    });
  }

  const eventNameLiteral = JSON.stringify(String(eventName || '').trim());
  const detailLiteral = JSON.stringify(detail ?? {});
  await mainWindow.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent(${eventNameLiteral}, { detail: ${detailLiteral} }));`,
    true
  );
  return true;
}

const AI_DISABLED_SYSTEM_COMMANDS = new Set<string>([
  'system-cursor-prompt',
  'system-add-to-memory',
  'system-supercmd-whisper',
  'system-supercmd-whisper-toggle',
  'system-supercmd-whisper-speak-toggle',
  'system-supercmd-speak',
]);

function isAIDisabledInSettings(settings?: AppSettings): boolean {
  const resolved = settings || loadSettings();
  return resolved.ai?.enabled === false;
}

function isAIDependentSystemCommand(commandId: string): boolean {
  return AI_DISABLED_SYSTEM_COMMANDS.has(String(commandId || '').trim());
}

function isAISectionDisabledForCommand(commandId: string, settings?: AppSettings): boolean {
  const resolved = settings || loadSettings();
  const id = String(commandId || '').trim();
  if (!id) return false;
  if (id === 'system-supercmd-speak') return resolved.ai?.readEnabled === false;
  if (id === 'system-supercmd-whisper' || id === 'system-supercmd-whisper-toggle' || id === 'system-supercmd-whisper-speak-toggle') {
    return resolved.ai?.whisperEnabled === false;
  }
  if (id === 'system-cursor-prompt' || id === 'system-add-to-memory') return resolved.ai?.llmEnabled === false;
  return false;
}

async function runCommandById(commandId: string, source: 'launcher' | 'hotkey' | 'widget' = 'launcher'): Promise<boolean> {
  if (isAIDependentSystemCommand(commandId) && isAIDisabledInSettings()) {
    return false;
  }
  if (isAISectionDisabledForCommand(commandId)) {
    return false;
  }
  if (source === 'hotkey' && WINDOW_MANAGEMENT_PRESET_COMMAND_IDS.has(String(commandId || '').trim())) {
    const now = Date.now();
    if (now - lastWindowManagementPresetHotkeyAt < WINDOW_MANAGEMENT_PRESET_HOTKEY_MIN_INTERVAL_MS) {
      return true;
    }
    lastWindowManagementPresetHotkeyAt = now;
  }

  const isWhisperOpenCommand =
    commandId === 'system-supercmd-whisper' ||
    commandId === 'system-supercmd-whisper-toggle';
  const isWhisperSpeakToggleCommand = commandId === 'system-supercmd-whisper-speak-toggle';
  const isWhisperCommand = isWhisperOpenCommand || isWhisperSpeakToggleCommand;
  const isSpeakCommand = commandId === 'system-supercmd-speak';
  const isCursorPromptCommand = commandId === 'system-cursor-prompt';

  if (isWhisperOpenCommand && source === 'hotkey') {
    const now = Date.now();
    if (now - lastWhisperToggleAt < 450) {
      return true;
    }
    lastWhisperToggleAt = now;
  }

  if (isWhisperSpeakToggleCommand) {
    const speakToggleHotkey = String(loadSettings().commandHotkeys?.['system-supercmd-whisper-speak-toggle'] || 'Fn');
    const holdSeq = ++whisperHoldRequestSeq;
    if (whisperOverlayVisible) {
      captureFrontmostAppContext();
      // Reposition whisper window to the current cursor's screen
      if (whisperChildWindow && !whisperChildWindow.isDestroyed()) {
        const bounds = whisperChildWindow.getBounds();
        const pos = computeDetachedPopupPosition(DETACHED_WHISPER_WINDOW_NAME, bounds.width, bounds.height);
        whisperChildWindow.setPosition(pos.x, pos.y);
      }
      startWhisperHoldWatcher(speakToggleHotkey, holdSeq);
      mainWindow?.webContents.send('whisper-start-listening');
      return true;
    }
    startWhisperHoldWatcher(speakToggleHotkey, holdSeq);
    await openLauncherAndRunSystemCommand('system-supercmd-whisper', {
      showWindow: false,
      mode: launcherMode === 'onboarding' ? 'onboarding' : 'default',
      preserveFocusWhenHidden: launcherMode !== 'onboarding',
    });
    lastWhisperShownAt = Date.now();
    // Opening detached whisper can race with renderer listener binding;
    // send explicit "start listening" with short retries.
    const startDelays = [180, 340, 520];
    startDelays.forEach((delay) => {
      setTimeout(() => {
        if (holdSeq !== whisperHoldRequestSeq) return;
        if (whisperHoldReleasedSeq >= holdSeq) return;
        mainWindow?.webContents.send('whisper-start-listening');
      }, delay);
    });
    return true;
  }

  if (isSpeakCommand) {
    if (activeSpeakSession || speakOverlayVisible) {
      stopSpeakSession({ resetStatus: true, cleanupWindow: true });
      return true;
    }
    const started = await startSpeakFromSelection();
    if (!started) return false;
    await openLauncherAndRunSystemCommand('system-supercmd-speak', {
      showWindow: false,
      mode: launcherMode === 'onboarding' ? 'onboarding' : 'default',
      preserveFocusWhenHidden: launcherMode !== 'onboarding',
    });
    return started;
  }

  if (
    isWhisperOpenCommand &&
    source === 'hotkey' &&
    whisperOverlayVisible
  ) {
    const now = Date.now();
    if (now - lastWhisperShownAt < 650) {
      return true;
    }
    mainWindow?.webContents.send('whisper-stop-and-close');
    whisperHoldRequestSeq += 1;
    stopWhisperHoldWatcher();
    return true;
  }
  if (isCursorPromptCommand) {
    const selectedBeforeOpenRaw = String(
      await getSelectedTextForSpeak({ allowClipboardFallback: true }) || getRecentSelectionSnapshot() || ''
    );
    const selectedBeforeOpen = selectedBeforeOpenRaw.trim();
    if (selectedBeforeOpen) {
      rememberSelectionSnapshot(selectedBeforeOpenRaw);
      lastCursorPromptSelection = selectedBeforeOpenRaw;
    } else {
      lastCursorPromptSelection = String(getRecentSelectionSnapshot() || '');
    }
    captureFrontmostAppContext();
    // Capture caret/input anchor before prompt focus changes active UI element.
    const earlyCaretRect = getTypingCaretRect();
    const earlyInputRect = earlyCaretRect ? null : getFocusedInputRect();
    if (source === 'hotkey' && isVisible && launcherMode === 'prompt') {
      hideWindow();
      return true;
    }
    if (isVisible) hideWindow();
    if (promptWindow && promptWindow.isVisible()) {
      hidePromptWindow();
      return true;
    }
    // Open anchored to the captured typing caret (not mouse pointer).
    showPromptWindow(earlyCaretRect, earlyInputRect);
    // Refresh selection in the background for AX-compatible apps.
    void getSelectedTextForSpeak({ allowClipboardFallback: false, clipboardWaitMs: 0 })
      .then((selectedBeforeOpen) => {
        const selected = String(selectedBeforeOpen || '').trim();
        if (!selected) return;
        lastCursorPromptSelection = selected;
      })
      .catch(() => {});
    return true;
  }
  if (commandId === 'system-add-to-memory') {
    const selectedTextRaw = String(
      await getSelectedTextForSpeak({
        allowClipboardFallback: source !== 'launcher',
      }) || getRecentSelectionSnapshot() || ''
    );
    const selectedText = selectedTextRaw.trim();
    if (!selectedText) {
      void showMemoryStatusBar('error', 'No selected text found.');
      return false;
    }
    rememberSelectionSnapshot(selectedTextRaw);
    void showMemoryStatusBar('processing', 'Adding to memory...');
    const result = await addMemory(loadSettings(), {
      text: selectedText,
      source: source === 'hotkey' ? 'hotkey' : 'launcher',
    });
    if (!result.success) {
      console.warn('[Supermemory] add memory failed:', result.error || 'Unknown error');
      void showMemoryStatusBar('error', result.error || 'Failed to add to memory.');
      return false;
    }
    void showMemoryStatusBar('success', 'Added to memory.');
    if (source === 'launcher') {
      setTimeout(() => hideWindow(), 50);
    }
    return true;
  }

  if (commandId === 'system-open-settings') {
    openSettingsWindow();
    if (source === 'launcher') hideWindow();
    return true;
  }
  if (commandId === 'system-open-ai-settings') {
    openSettingsWindow({ tab: 'ai' });
    if (source === 'launcher') hideWindow();
    return true;
  }
  if (commandId === 'system-open-extensions-settings') {
    openSettingsWindow({ tab: 'extensions' });
    if (source === 'launcher') hideWindow();
    return true;
  }
  if (
    commandId === 'system-clipboard-manager' ||
    commandId === 'system-search-snippets' ||
    commandId === 'system-create-snippet' ||
    commandId === 'system-search-quicklinks' ||
    commandId === 'system-create-quicklink' ||
    commandId === 'system-search-files' ||
    commandId === 'system-camera'
  ) {
    return await openLauncherAndRunSystemCommand(commandId, {
      showWindow: true,
      mode: 'default',
    });
  }
  if (commandId === 'system-whisper-onboarding') {
    return await openLauncherAndRunSystemCommand('system-open-onboarding', {
      showWindow: true,
      mode: 'onboarding',
    });
  }
  if (commandId === 'system-open-onboarding') {
    return await openLauncherAndRunSystemCommand(commandId, {
      showWindow: true,
      mode: 'onboarding',
    });
  }
  if (isWhisperOpenCommand) {
    lastWhisperShownAt = Date.now();
    whisperHoldRequestSeq += 1;
    stopWhisperHoldWatcher();
    return await openLauncherAndRunSystemCommand('system-supercmd-whisper', {
      showWindow: source === 'launcher',
      mode: launcherMode === 'onboarding' ? 'onboarding' : 'default',
    });
  }
  if (isWindowManagementLayoutCommand(commandId)) {
    const shouldPreserveFocusWhenHidden = source === 'launcher' || isVisible;
    const shouldCaptureTargetHint = source === 'hotkey' || !isVisible;
    if (shouldCaptureTargetHint) {
      captureFrontmostAppContext();
      await captureWindowManagementTargetWindow();
    }
    const preferredFrontmostApp = source === 'launcher' && isVisible
      ? resolveLauncherEntryFrontmostApp()
      : cloneFrontmostAppContext(lastFrontmostApp);
    const preferredTargetWindowId = source === 'launcher' && isVisible
      ? resolveLauncherEntryTargetWindowId()
      : (String(windowManagementTargetWindowId || '').trim() || null);
    const preferredTargetWorkArea = source === 'launcher' && isVisible
      ? cloneWorkArea(launcherEntryWindowManagementTargetWorkArea)
      : cloneWorkArea(windowManagementTargetWorkArea);
    if (source === 'launcher' && isVisible) {
      windowManagementTargetWindowId = preferredTargetWindowId;
      windowManagementTargetWorkArea = preferredTargetWorkArea;
    }
    if (preferredFrontmostApp) {
      lastFrontmostApp = preferredFrontmostApp;
    }
    const hintedBundleId = String(preferredFrontmostApp?.bundleId || '').trim();
    const hintedAppPath = String(preferredFrontmostApp?.path || '').trim();
    const hintedWindowId = String(preferredTargetWindowId || '').trim();
    const hasNativeTargetHint = Boolean(
      hintedBundleId || hintedAppPath || hintedWindowId || preferredTargetWorkArea
    );
    const nativeTargetHint = hasNativeTargetHint
      ? {
          bundleId: hintedBundleId,
          appPath: hintedAppPath,
          windowId: hintedWindowId,
          workArea: preferredTargetWorkArea,
        }
      : undefined;
    const success = await executeWindowManagementLayoutCommand(commandId, {
      preferNative: true,
      nativeTargetHint,
    });
    if (success && source === 'launcher') {
      setTimeout(() => hideWindow(), 25);
    }
    if (success && shouldPreserveFocusWhenHidden) {
      scheduleWindowManagementFocusRestore();
    }
    if (success) return true;
    return await openLauncherAndRunSystemCommand(commandId, {
      showWindow: false,
      mode: launcherMode === 'onboarding' ? 'onboarding' : 'default',
      preserveFocusWhenHidden: source !== 'widget',
    });
  }
  if (isWindowManagementFineTuneCommand(commandId)) {
    const shouldPreserveFocusWhenHidden = source === 'launcher' || isVisible;
    const shouldCaptureTargetHint = source === 'hotkey' || !isVisible;
    if (shouldCaptureTargetHint) {
      captureFrontmostAppContext();
      await captureWindowManagementTargetWindow();
    }
    const preferredFrontmostApp = source === 'launcher' && isVisible
      ? resolveLauncherEntryFrontmostApp()
      : cloneFrontmostAppContext(lastFrontmostApp);
    const preferredTargetWindowId = source === 'launcher' && isVisible
      ? resolveLauncherEntryTargetWindowId()
      : (String(windowManagementTargetWindowId || '').trim() || null);
    const preferredTargetWorkArea = source === 'launcher' && isVisible
      ? cloneWorkArea(launcherEntryWindowManagementTargetWorkArea)
      : cloneWorkArea(windowManagementTargetWorkArea);
    if (source === 'launcher' && isVisible) {
      windowManagementTargetWindowId = preferredTargetWindowId;
      windowManagementTargetWorkArea = preferredTargetWorkArea;
    }
    if (preferredFrontmostApp) {
      lastFrontmostApp = preferredFrontmostApp;
    }
    const hintedBundleId = String(preferredFrontmostApp?.bundleId || '').trim();
    const hintedAppPath = String(preferredFrontmostApp?.path || '').trim();
    const hintedWindowId = String(preferredTargetWindowId || '').trim();
    const hasNativeTargetHint = Boolean(
      hintedBundleId || hintedAppPath || hintedWindowId || preferredTargetWorkArea
    );
    const nativeTargetHint = hasNativeTargetHint
      ? {
          bundleId: hintedBundleId,
          appPath: hintedAppPath,
          windowId: hintedWindowId,
          workArea: preferredTargetWorkArea,
        }
      : undefined;
    const success = await executeWindowManagementFineTuneCommand(commandId, {
      preferNative: !isVisible || hasNativeTargetHint,
      nativeTargetHint,
    });
    if (success && source === 'launcher') {
      setTimeout(() => hideWindow(), 25);
    }
    if (success && shouldPreserveFocusWhenHidden) {
      scheduleWindowManagementFocusRestore();
    }
    if (success) {
      return true;
    }
    return await openLauncherAndRunSystemCommand(commandId, {
      showWindow: false,
      mode: launcherMode === 'onboarding' ? 'onboarding' : 'default',
      preserveFocusWhenHidden: source !== 'widget',
    });
  }
  if (isWindowManagementSystemCommand(commandId)) {
    return await openLauncherAndRunSystemCommand(commandId, {
      showWindow: false,
      mode: launcherMode === 'onboarding' ? 'onboarding' : 'default',
      // Keep focus in SuperCmd only for the panel command: detached window manager
      // closes itself on blur. Preset commands should restore app focus normally.
      preserveFocusWhenHidden: commandId !== 'system-window-management',
    });
  }
  if (commandId === 'system-import-snippets') {
    await importSnippetsFromFile(mainWindow || undefined);
    return true;
  }
  if (commandId === 'system-export-snippets') {
    await exportSnippetsToFile(mainWindow || undefined);
    return true;
  }
  if (commandId === 'system-create-script-command') {
    try {
      const created = createScriptCommandTemplate();
      invalidateScriptCommandsCache();
      invalidateCache();
      try {
        await shell.openPath(created.scriptPath);
      } catch {}
      console.log(`[ScriptCommand] Created: ${path.basename(created.scriptPath)}`);
      if (source === 'launcher') {
        setTimeout(() => hideWindow(), 50);
      }
      return true;
    } catch (error: any) {
      console.error('Failed to create script command:', error);
      console.error('[ScriptCommand] Failed to create script command.');
      return false;
    }
  }
  if (commandId === 'system-open-script-commands') {
    try {
      const dir = getSuperCmdScriptCommandsDirectory();
      await shell.openPath(dir);
      if (source === 'launcher') {
        setTimeout(() => hideWindow(), 50);
      }
      return true;
    } catch (error: any) {
      console.error('Failed to open script command directory:', error);
      console.error('[ScriptCommand] Failed to open script commands folder.');
      return false;
    }
  }
  if (isQuickLinkCommandId(commandId)) {
    const quickLink = getQuickLinkByCommandId(commandId);
    if (!quickLink) {
      console.warn(`[QuickLinks] Command not found: ${commandId}`);
      return false;
    }
    const opened = await openQuickLinkById(quickLink.id);
    if (opened && source === 'launcher') {
      setTimeout(() => hideWindow(), 50);
    }
    return opened;
  }

  const allCommands = await getAvailableCommands();
  const command = allCommands.find((item) => item.id === commandId);
  if (command?.category === 'extension' && command.path) {
    const parsedPath = parseExtensionCommandPath(command.path);
    if (!parsedPath) return false;
    const { extensionName: extName, commandName: cmdName } = parsedPath;
    try {
      const bundle = await buildLaunchBundle({
        extensionName: extName,
        commandName: cmdName,
        type: 'userInitiated',
      });
      await showWindow();
      return await dispatchRendererCustomEvent('sc-launch-extension-bundle', {
        bundle,
        launchOptions: { type: bundle.launchType || 'userInitiated' },
        source: {
          commandMode: source,
          extensionName: bundle.extensionName,
          commandName: bundle.commandName,
        },
      });
    } catch (error) {
      console.error(`Failed to launch extension command via hotkey: ${commandId}`, error);
      return false;
    }
  }

  if (command?.category === 'script') {
    try {
      await showWindow();
      return await dispatchRendererCustomEvent('sc-run-script-command', {
        commandId: command.id,
        arguments: [],
      });
    } catch (error) {
      console.error(`Failed to launch script command via hotkey: ${commandId}`, error);
      return false;
    }
  }

  if (commandId === 'system-check-for-updates') {
    try {
      ensureAppUpdaterConfigured();
      if (!appUpdater) {
        console.warn('[Updater] Not available in development mode');
        void showMemoryStatusBar('error', 'Updater not available.');
        return false;
      }
      void showMemoryStatusBar('processing', 'Checking for updates...');
      const checkStatus = await checkForAppUpdates();
      if (checkStatus.state === 'not-available') {
        console.log('[Updater] Already on latest version');
        void showMemoryStatusBar('success', 'Already on latest version.');
        return true;
      }
      if (checkStatus.state === 'error') {
        void showMemoryStatusBar('error', checkStatus.message || 'Failed to check for updates.');
        return false;
      }
      if (checkStatus.state === 'available') {
        void showMemoryStatusBar('processing', 'Downloading update...');
        const downloadStatus = await downloadAppUpdate();
        if (downloadStatus.state === 'error') {
          console.error('[Updater] Download failed:', downloadStatus.message);
          void showMemoryStatusBar('error', downloadStatus.message || 'Failed to download update.');
          return false;
        }
      }
      if (appUpdaterStatusSnapshot.state === 'downloaded') {
        void showMemoryStatusBar('processing', 'Restarting to install update...');
        const installed = restartAndInstallAppUpdate();
        if (installed) {
          return true;
        }
        void showMemoryStatusBar('error', 'Failed to restart for update installation.');
      }
      if (appUpdaterStatusSnapshot.state !== 'downloaded') {
        void showMemoryStatusBar('success', checkStatus.message || 'Update check complete.');
      }
      return true;
    } catch (error) {
      console.error('[Updater] Update flow failed:', error);
      void showMemoryStatusBar('error', 'Update flow failed.');
      return false;
    }
  }

  const success = await executeCommand(commandId);
  if (success && source === 'launcher') {
    setTimeout(() => hideWindow(), 50);
  }
  return success;
}

async function startSpeakFromSelection(): Promise<boolean> {
  stopSpeakSession({ resetStatus: true });
  setSpeakStatus({ state: 'loading', text: '', index: 0, total: 0, message: 'Getting selected text...' });

  const selectedText = await getSelectedTextForSpeak();
  const chunks = splitTextIntoSpeakChunks(selectedText);
  if (chunks.length === 0) {
    setSpeakStatus({
      state: 'error',
      text: '',
      index: 0,
      total: 0,
      message: 'No selected text found.',
    });
    return false;
  }

  const settings = loadSettings();
  const selectedTtsModel = String(settings.ai?.textToSpeechModel || 'edge-tts');
  const usingElevenLabsTts = selectedTtsModel.startsWith('elevenlabs-');
  const elevenLabsApiKey = getElevenLabsApiKey(settings);
  if (usingElevenLabsTts && !elevenLabsApiKey) {
    setSpeakStatus({
      state: 'error',
      text: '',
      index: 0,
      total: chunks.length,
      message: 'ElevenLabs API key not configured. Set it in Settings -> AI (or ELEVENLABS_API_KEY env var).',
    });
    return false;
  }
  const elevenLabsTts = usingElevenLabsTts ? resolveElevenLabsTtsConfig(selectedTtsModel) : null;
  const configuredEdgeVoice = String(settings.ai?.edgeTtsVoice || '').trim();
  if (!usingElevenLabsTts && configuredEdgeVoice) {
    speakRuntimeOptions.voice = configuredEdgeVoice;
  }

  const localSpeakBackend = usingElevenLabsTts ? null : resolveLocalSpeakBackend();
  if (!usingElevenLabsTts) {
    if (!localSpeakBackend) {
      setSpeakStatus({
        state: 'error',
        text: '',
        index: 0,
        total: chunks.length,
        message: 'No local speech runtime is available. Reinstall SuperCmd and retry.',
      });
      return false;
    }
  }

  const fs = require('fs');
  const os = require('os');
  const pathMod = require('path');
  const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'supercmd-speak-'));
  const sessionId = ++speakSessionCounter;
  const session = {
    id: sessionId,
    stopRequested: false,
    playbackGeneration: 0,
    currentIndex: 0,
    chunks,
    tmpDir,
    chunkPromises: new Map<string, Promise<SpeakChunkPrepared>>(),
    afplayProc: null as any,
    ttsProcesses: new Set<any>(),
    restartFrom: (_index: number) => {},
  };
  activeSpeakSession = session;

  const configuredVoice = String(speakRuntimeOptions.voice || '');
  const voiceLangMatch = /^([a-z]{2}-[A-Z]{2})-/.exec(configuredVoice);
  const fallbackLanguage = String(settings.ai?.speechLanguage || 'en-US');
  const lang = voiceLangMatch?.[1] || (fallbackLanguage.includes('-') ? fallbackLanguage : `${fallbackLanguage}-US`);
  if (!usingElevenLabsTts && !speakRuntimeOptions.voice) {
    speakRuntimeOptions.voice = resolveEdgeVoice(settings.ai?.speechLanguage || 'en-US');
  }

  const ensureChunkPrepared = (index: number, generation: number): Promise<SpeakChunkPrepared> => {
    if (index < 0 || index >= chunks.length) {
      return Promise.reject(new Error('Chunk index out of range'));
    }
    const cacheKey = `${generation}:${index}`;
    const existing = session.chunkPromises.get(cacheKey);
    if (existing) return existing;

    const promise = new Promise<SpeakChunkPrepared>((resolve, reject) => {
      if (session.stopRequested) {
        reject(new Error('Speak session stopped'));
        return;
      }
      const outputExtension = !usingElevenLabsTts && localSpeakBackend === 'system-say' ? 'aiff' : 'mp3';
      // Use generation-scoped chunk paths so quick restarts (voice/rate changes)
      // never overlap on the same file path.
      const audioPath = pathMod.join(tmpDir, `chunk-${generation}-${index}.${outputExtension}`);
      const synthesizeChunkWithRetry = async (): Promise<void> => {
        const maxAttempts = 3;
        let lastErr: Error | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (session.stopRequested) {
            throw new Error('Speak session stopped');
          }

          const attemptError = await new Promise<Error | null>((attemptResolve) => {
            if (usingElevenLabsTts) {
              if (!elevenLabsTts || !elevenLabsApiKey) {
                attemptResolve(new Error('ElevenLabs TTS configuration is missing.'));
                return;
              }
              // Use runtime voice if set, otherwise fall back to config
              const runtimeVoiceId = String(speakRuntimeOptions.voice || '').trim();
              const voiceId = runtimeVoiceId || elevenLabsTts.voiceId;
              synthesizeElevenLabsToFile({
                text: session.chunks[index],
                audioPath,
                apiKey: elevenLabsApiKey,
                modelId: elevenLabsTts.modelId,
                voiceId,
                timeoutMs: 45000,
              }).then(() => attemptResolve(null)).catch((err: any) => {
                const message = String(err?.message || err || 'ElevenLabs TTS failed');
                attemptResolve(new Error(message));
              });
              return;
            }

            if (!localSpeakBackend) {
              attemptResolve(new Error('No local speech backend is available.'));
              return;
            }
            const synthPromise = localSpeakBackend === 'edge-tts'
              ? synthesizeWithEdgeTts({
                  text: session.chunks[index],
                  audioPath,
                  voice: speakRuntimeOptions.voice,
                  lang,
                  rate: speakRuntimeOptions.rate,
                  saveSubtitles: true,
                  timeoutMs: 45000,
                })
              : synthesizeWithSystemSay({
                  text: session.chunks[index],
                  audioPath,
                  lang,
                  rate: speakRuntimeOptions.rate,
                });

            synthPromise.then(() => {
              if (session.stopRequested) {
                attemptResolve(new Error('Speak session stopped'));
                return;
              }
              attemptResolve(null);
            }).catch((err: any) => {
              const text = String(err?.message || err || 'Speech synthesis failed');
              attemptResolve(new Error(text));
            });
          });

          if (!attemptError) return;
          lastErr = attemptError;

          const isTimeout = /timed out|timeout/i.test(String(attemptError.message || ''));
          const canRetry = attempt < maxAttempts;
          if (!canRetry || !isTimeout) {
            break;
          }

          const waitMs = 450 * attempt;
          await new Promise((r) => setTimeout(r, waitMs));
        }

        throw lastErr || new Error('Speech synthesis failed');
      };

      synthesizeChunkWithRetry().then(() => {
        let wordCues: Array<{ start: number; end: number; wordIndex: number }> = [];
        if (localSpeakBackend === 'edge-tts') {
          try {
            const subtitleCandidates = [
              audioPath.replace(/\.mp3$/i, '.json'),
              `${audioPath}.json`,
              audioPath.replace(/\.[a-z0-9]+$/i, '.json'),
            ];
            for (const subtitlePath of subtitleCandidates) {
              if (!fs.existsSync(subtitlePath)) continue;
              const raw = fs.readFileSync(subtitlePath, 'utf-8');
              const parsed = JSON.parse(raw);
              if (!Array.isArray(parsed)) continue;
              let wordIndex = 0;
              for (const entry of parsed) {
                const part = String(entry?.part || '').trim();
                const start = parseCueTimeMs(entry?.start);
                const endRaw = parseCueTimeMs(entry?.end);
                const end = Math.max(start + 1, endRaw);
                const words = part.split(/\s+/g).filter(Boolean);
                if (words.length === 0) continue;
                const span = Math.max(1, end - start);
                const step = span / words.length;
                for (let i = 0; i < words.length; i += 1) {
                  wordCues.push({
                    start: Math.max(0, Math.round(start + i * step)),
                    end: Math.max(1, Math.round(start + (i + 1) * step)),
                    wordIndex,
                  });
                  wordIndex += 1;
                }
              }
              if (wordCues.length > 0) break;
            }
          } catch {}
        }
        const durationMsFromCues =
          wordCues.length > 0
            ? Math.max(...wordCues.map((cue) => cue.end))
            : null;
        const durationMs = durationMsFromCues || probeAudioDurationMs(audioPath) || undefined;
        resolve({ index, text: session.chunks[index], audioPath, wordCues, durationMs });
      }).catch((err: any) => {
        const message = String(err?.message || err || 'Speech synthesis failed');
        if (/timed out|timeout/i.test(message)) {
          reject(new Error('Speech request timed out. Please try again.'));
          return;
        }
        reject(err instanceof Error ? err : new Error(message));
      });
    });

    session.chunkPromises.set(cacheKey, promise);
    return promise;
  };

  const playAudioFile = (prepared: SpeakChunkPrepared): Promise<void> =>
    new Promise((resolve, reject) => {
      if (session.stopRequested) {
        resolve();
        return;
      }
      const { spawn } = require('child_process');
      const proc = spawn('/usr/bin/afplay', [prepared.audioPath], { stdio: ['ignore', 'ignore', 'pipe'] });
      session.afplayProc = proc;
      let stderr = '';
      const startedAt = Date.now();
      let lastWordIndex = -1;
      const wordsInText = prepared.text.split(/\s+/g).filter(Boolean).length;
      const fallbackWpm = Number(parseSayRateWordsPerMinute(speakRuntimeOptions.rate || '+0%')) || 175;
      const fallbackMsPerWord = wordsInText > 0
        ? Math.max(
            120,
            Math.min(
              1200,
              Math.round(
                (
                  (typeof prepared.durationMs === 'number' && Number.isFinite(prepared.durationMs) && prepared.durationMs > 0)
                    ? prepared.durationMs / wordsInText
                    : (60000 / Math.max(90, fallbackWpm))
                )
              )
            )
          )
        : 0;
      const cueTimer = setInterval(() => {
        if (session.stopRequested || activeSpeakSession?.id !== sessionId) return;
        const elapsed = Date.now() - startedAt;
        let nextWordIndex = -1;
        if (prepared.wordCues.length > 0) {
          for (const cue of prepared.wordCues) {
            if (elapsed >= cue.start && elapsed <= cue.end) {
              nextWordIndex = cue.wordIndex;
              break;
            }
            if (elapsed > cue.end) {
              nextWordIndex = cue.wordIndex;
            }
          }
        } else if (wordsInText > 0) {
          nextWordIndex = Math.min(wordsInText - 1, Math.floor(elapsed / fallbackMsPerWord));
        }
        if (nextWordIndex !== lastWordIndex && nextWordIndex >= 0) {
          lastWordIndex = nextWordIndex;
          setSpeakStatus({
            state: 'speaking',
            text: prepared.text,
            index: prepared.index + 1,
            total: session.chunks.length,
            message: '',
            wordIndex: nextWordIndex,
          });
        }
      }, 70);
      proc.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk || '');
      });
      proc.on('error', (err: Error) => {
        clearInterval(cueTimer);
        if (session.afplayProc === proc) session.afplayProc = null;
        reject(err);
      });
      proc.on('close', (code: number | null) => {
        clearInterval(cueTimer);
        if (session.afplayProc === proc) session.afplayProc = null;
        if (session.stopRequested) {
          resolve();
          return;
        }
        if (code && code !== 0) {
          reject(new Error(stderr.trim() || `afplay exited with ${code}`));
          return;
        }
        resolve();
      });
    });

  setSpeakStatus({ state: 'loading', text: '', index: 0, total: session.chunks.length, message: 'Preparing speech...' });

  const runPlayback = (startIndex: number) => {
    const generation = ++session.playbackGeneration;
    const safeStart = Math.max(0, Math.min(startIndex, session.chunks.length - 1));
    session.currentIndex = safeStart;
    session.chunkPromises.clear();
    if (session.afplayProc) {
      try { session.afplayProc.kill('SIGTERM'); } catch {}
      session.afplayProc = null;
    }
    for (const proc of session.ttsProcesses) {
      try { proc.kill('SIGTERM'); } catch {}
    }
    session.ttsProcesses.clear();
    setSpeakStatus({
      state: 'loading',
      text: '',
      index: safeStart + 1,
      total: session.chunks.length,
      message: 'Preparing speech...',
      wordIndex: undefined,
    });

    // Prime first and second chunks for lower startup latency.
    void ensureChunkPrepared(safeStart, generation).catch(() => {});
    if (safeStart + 1 < session.chunks.length) {
      void ensureChunkPrepared(safeStart + 1, generation).catch(() => {});
    }

    (async () => {
    try {
      for (let index = safeStart; index < session.chunks.length; index += 1) {
        if (
          generation !== session.playbackGeneration ||
          session.stopRequested ||
          activeSpeakSession?.id !== sessionId
        ) return;
        session.currentIndex = index;
        const prepared = await ensureChunkPrepared(index, generation);
        if (
          generation !== session.playbackGeneration ||
          session.stopRequested ||
          activeSpeakSession?.id !== sessionId
        ) return;

        const nextIndex = index + 1;
        if (nextIndex < session.chunks.length) {
          // Prefetch the next chunk while current chunk is being played.
          void ensureChunkPrepared(nextIndex, generation).catch(() => {});
        }

        setSpeakStatus({
          state: 'speaking',
          text: prepared.text,
          index: index + 1,
          total: session.chunks.length,
          message: '',
          wordIndex: 0,
        });
        await playAudioFile(prepared);
      }

      if (
        generation !== session.playbackGeneration ||
        session.stopRequested ||
        activeSpeakSession?.id !== sessionId
      ) return;
      setSpeakStatus({
        state: 'done',
        text: '',
        index: session.chunks.length,
        total: session.chunks.length,
        message: 'Done',
      });
      setTimeout(() => {
        if (
          generation === session.playbackGeneration &&
          !session.stopRequested &&
          activeSpeakSession?.id === sessionId
        ) {
          stopSpeakSession({ resetStatus: true, cleanupWindow: true });
        }
      }, 520);
    } catch (error: any) {
      if (
        generation !== session.playbackGeneration ||
        session.stopRequested ||
        activeSpeakSession?.id !== sessionId
      ) return;
      setSpeakStatus({
        state: 'error',
        text: '',
        index: 0,
        total: session.chunks.length,
        message: error?.message || 'Speech playback failed.',
      });
    }
    })();
  };

  session.restartFrom = (index: number) => {
    if (session.stopRequested || activeSpeakSession?.id !== sessionId) return;
    runPlayback(index);
  };

  runPlayback(0);

  return true;
}

function normalizeTranscriptText(input: string): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/^[`"'“”]+|[`"'“”]+$/g, '')
    .trim();
}

function extractRefinedTranscriptOnly(raw: string): string {
  let cleaned = String(raw || '').trim();
  if (!cleaned) return '';

  // Remove markdown fences if the model wraps the answer.
  cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/g, '').replace(/```$/g, '').trim();

  // Strip common prefixes the model may add despite instructions.
  cleaned = cleaned.replace(/^(?:final(?:\s+answer)?|output|corrected(?:\s+sentence)?|rewritten)\s*:\s*/i, '').trim();
  cleaned = cleaned.replace(/^[-*]\s+/g, '').trim();

  // Keep only the first non-empty line if the model returns extras.
  const firstLine = cleaned
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  cleaned = firstLine || cleaned;

  // If wrapped in quotes, unwrap once.
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '').trim();

  return normalizeTranscriptText(cleaned);
}

function applyWhisperHeuristicCorrection(input: string): string {
  const normalized = normalizeTranscriptText(input);
  if (!normalized) return '';

  const correctionPattern = /\b(?:no|i mean|actually|sorry|correction|rather|make that)\b\s+(.+)$/i;
  const match = correctionPattern.exec(normalized);
  if (!match || typeof match.index !== 'number') return normalized;

  const correction = normalizeTranscriptText(match[1]);
  if (!correction) return normalized;

  const before = normalizeTranscriptText(
    normalized
      .slice(0, match.index)
      .replace(/[,:;\-]+$/g, '')
  );
  if (!before) return correction;

  const prepMatch = /\b(for|at|on|in|to|from|with)\s+([^\s]+(?:\s+[^\s]+)?)$/i.exec(before);
  if (prepMatch && typeof prepMatch.index === 'number') {
    const preposition = prepMatch[1];
    const stem = normalizeTranscriptText(before.slice(0, prepMatch.index));
    const correctionHasPrep = new RegExp(`^${preposition}\\b`, 'i').test(correction);
    return normalizeTranscriptText(`${stem} ${correctionHasPrep ? correction : `${preposition} ${correction}`}`);
  }

  const beforeWords = before.split(/\s+/);
  const correctionWords = correction.split(/\s+/);
  const dropCount = Math.min(4, Math.max(1, correctionWords.length));
  const prefix = beforeWords.slice(0, Math.max(0, beforeWords.length - dropCount)).join(' ');
  return normalizeTranscriptText(`${prefix} ${correction}`) || normalized;
}

async function refineWhisperTranscript(input: string): Promise<{ correctedText: string; source: 'ai' | 'heuristic' | 'raw' }> {
  const normalized = normalizeTranscriptText(input);
  if (!normalized) {
    return { correctedText: '', source: 'raw' };
  }

  const settings = loadSettings();
  if (settings.ai.speechCorrectionEnabled && isAIAvailable(settings.ai)) {
    try {
      let corrected = '';
      const systemPrompt = [
        'You are a transcript post-processor for dictated user text.',
        'Your job is to rewrite noisy speech-to-text into one clean final sentence while preserving the user intent.',
        'Rules:',
        '1) Preserve original meaning and tense; do not add new facts.',
        '2) Apply explicit self-corrections in the utterance. Example: "3am no 5am" => "5am".',
        '3) Remove filler/disfluencies: uh, um, uhh, er, like (when filler), you know, i mean (if filler), repeated stutters.',
        '4) Resolve immediate restarts/repetitions and keep the latest valid phrase.',
        '5) Keep wording natural and concise; fix basic grammar/punctuation only when needed for readability.',
        '6) Keep first-person voice if present.',
        '7) Output exactly one cleaned sentence only.',
        '8) Output plain text only. No quotes, no markdown, no labels, no explanations.',
      ].join(' ');
      const prompt = [
        'Raw transcript:',
        normalized,
        '',
        'Return exactly one cleaned sentence.',
      ].join('\n');
      const gen = streamAI(settings.ai, {
        prompt,
        model: settings.ai.speechCorrectionModel || undefined,
        creativity: 0,
        systemPrompt,
      });
      for await (const chunk of gen) {
        corrected += chunk;
      }
      const cleaned = extractRefinedTranscriptOnly(corrected);
      if (cleaned) {
        return { correctedText: cleaned, source: 'ai' };
      }
    } catch (error) {
      console.warn('[Whisper] AI transcript correction failed:', error);
      const message = String((error as any)?.message || '').toLowerCase();
      if (message.includes('econnrefused') || message.includes('connection refused')) {
        return { correctedText: normalized, source: 'raw' };
      }
    }
  }

  const heuristicallyCorrected = applyWhisperHeuristicCorrection(normalized);
  if (heuristicallyCorrected) {
    return { correctedText: heuristicallyCorrected, source: 'heuristic' };
  }

  return { correctedText: normalized, source: 'raw' };
}

// ─── Settings Window ────────────────────────────────────────────────

type SettingsTabId = 'general' | 'ai' | 'extensions' | 'advanced';
type SettingsPanelTarget = {
  extensionName?: string;
  commandName?: string;
};
type SettingsNavigationPayload = {
  tab: SettingsTabId;
  target?: SettingsPanelTarget;
};

function normalizeSettingsTabId(input: any): SettingsTabId | undefined {
  if (input === 'general' || input === 'ai' || input === 'extensions' || input === 'advanced') return input;
  return undefined;
}

function normalizeSettingsTarget(input: any): SettingsPanelTarget | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const extensionName = typeof input.extensionName === 'string' ? input.extensionName.trim() : '';
  const commandName = typeof input.commandName === 'string' ? input.commandName.trim() : '';
  if (!extensionName && !commandName) return undefined;
  return {
    ...(extensionName ? { extensionName } : {}),
    ...(commandName ? { commandName } : {}),
  };
}

function resolveSettingsNavigationPayload(
  input: any,
  maybeTarget?: any
): SettingsNavigationPayload | undefined {
  if (typeof input === 'string') {
    const tab = normalizeSettingsTabId(input);
    if (!tab) return undefined;
    return {
      tab,
      target: normalizeSettingsTarget(maybeTarget),
    };
  }
  if (input && typeof input === 'object') {
    const tab = normalizeSettingsTabId(input.tab);
    if (!tab) return undefined;
    return {
      tab,
      target: normalizeSettingsTarget(input.target),
    };
  }
  return undefined;
}

function buildSettingsHash(payload?: SettingsNavigationPayload): string {
  if (!payload) return '/settings';
  const params = new URLSearchParams();
  params.set('tab', payload.tab);
  if (payload.target?.extensionName) {
    params.set('extension', payload.target.extensionName);
  }
  if (payload.target?.commandName) {
    params.set('command', payload.target.commandName);
  }
  const query = params.toString();
  return query ? `/settings?${query}` : '/settings';
}

function isCloseWindowShortcutInput(input: any): boolean {
  const inputType = String(input?.type || '').toLowerCase();
  if (inputType !== 'keydown') return false;

  const key = String(input?.key || '').toLowerCase();
  const code = String(input?.code || '').toLowerCase();
  if (key !== 'w' && code !== 'keyw') return false;

  if (process.platform === 'darwin') {
    return Boolean(input.meta) && !input.control && !input.alt;
  }

  return Boolean(input.control) && !input.meta && !input.alt;
}

function isEscapeInput(input: any): boolean {
  const inputType = String(input?.type || '').toLowerCase();
  if (inputType !== 'keydown') return false;
  const key = String(input?.key || '').toLowerCase();
  const code = String(input?.code || '').toLowerCase();
  return key === 'escape' || code === 'escape';
}

function registerCloseWindowShortcut(
  win: InstanceType<typeof BrowserWindow>,
  options?: { closeOnEscape?: boolean }
): void {
  win.webContents.on('before-input-event', (event: any, input: any) => {
    if (!isCloseWindowShortcutInput(input) && !(options?.closeOnEscape && isEscapeInput(input))) return;
    event.preventDefault();
    if (!win.isDestroyed()) {
      win.close();
    }
  });
}

function openSettingsWindow(payload?: SettingsNavigationPayload): void {
  if (settingsWindow) {
    if (payload) {
      settingsWindow.webContents.send('settings-tab-changed', payload);
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
  const settingsWidth = Math.max(1120, Math.min(1360, displayWidth - 96));
  const settingsHeight = Math.max(720, Math.min(860, displayHeight - 96));
  const settingsX = displayX + Math.floor((displayWidth - settingsWidth) / 2);
  const settingsY = displayY + Math.floor((displayHeight - settingsHeight) / 2);
  const useNativeLiquidGlass = shouldUseNativeLiquidGlass();

  settingsWindow = new BrowserWindow({
    width: settingsWidth,
    height: settingsHeight,
    x: settingsX,
    y: settingsY,
    minWidth: 1120,
    minHeight: 720,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: useNativeLiquidGlass ? false : 'hud',
    visualEffectState: 'active',
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  applyLiquidGlassToWindow(settingsWindow, {
    cornerRadius: 14,
    fallbackVibrancy: 'hud',
  });
  registerCloseWindowShortcut(settingsWindow, { closeOnEscape: true });

  const hash = buildSettingsHash(payload);
  loadWindowUrl(settingsWindow, hash);

  settingsWindow.once('ready-to-show', () => {
    if (payload) {
      settingsWindow?.webContents.send('settings-tab-changed', payload);
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
  const useNativeLiquidGlass = shouldUseNativeLiquidGlass();

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
    vibrancy: useNativeLiquidGlass ? false : 'hud',
    visualEffectState: 'active',
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  applyLiquidGlassToWindow(extensionStoreWindow, {
    cornerRadius: 14,
    fallbackVibrancy: 'hud',
  });
  registerCloseWindowShortcut(extensionStoreWindow, { closeOnEscape: true });

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

function getDialogParentWindow(event?: { sender?: any }): InstanceType<typeof BrowserWindow> | undefined {
  try {
    const sender = event?.sender;
    if (sender) {
      const senderWindow = BrowserWindow.fromWebContents(sender);
      if (senderWindow && !senderWindow.isDestroyed()) {
        return senderWindow;
      }
    }
  } catch {}

  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    return settingsWindow;
  }

  if (extensionStoreWindow && !extensionStoreWindow.isDestroyed()) {
    return extensionStoreWindow;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  return undefined;
}

function sendAppUpdaterStatusToRenderers(): void {
  const payload = { ...appUpdaterStatusSnapshot };
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      window.webContents.send('app-updater-status', payload);
    } catch {}
  }
}

function broadcastExtensionsUpdated(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      window.webContents.send('extensions-updated');
    } catch {}
  }
}

function broadcastCommandsUpdated(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      window.webContents.send('commands-updated');
    } catch {}
  }
}

function scheduleInstalledAppsRefresh(reason: string): void {
  if (appInstallChangeDebounceTimer) {
    clearTimeout(appInstallChangeDebounceTimer);
  }
  appInstallChangeDebounceTimer = setTimeout(() => {
    appInstallChangeDebounceTimer = null;
    console.log(`[Commands] Invalidating cache due to app change: ${reason}`);
    invalidateCache();
    broadcastCommandsUpdated();
  }, 1200);
}

function startInstalledAppsWatchers(): void {
  const appDirs = [
    '/Applications',
    '/Applications/Utilities',
    '/System/Applications',
    '/System/Applications/Utilities',
    path.join(process.env.HOME || '', 'Applications'),
  ]
    .filter((dir) => Boolean(dir))
    .filter((dir, idx, all) => all.indexOf(dir) === idx);

  for (const dir of appDirs) {
    if (!dir) continue;
    if (!fs.existsSync(dir)) continue;
    try {
      const watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
        const changedName = String(filename || '').toLowerCase();
        if (!changedName || changedName.endsWith('.app') || changedName.includes('.app/')) {
          scheduleInstalledAppsRefresh(`filesystem event in ${dir}`);
        }
      });
      watcher.on('error', (error) => {
        console.warn(`[Commands] App watcher error on ${dir}:`, error);
      });
      appInstallWatchers.push(watcher);
    } catch (error) {
      console.warn(`[Commands] Failed to watch ${dir}:`, error);
    }
  }
}

function stopInstalledAppsWatchers(): void {
  for (const watcher of appInstallWatchers) {
    try {
      watcher.close();
    } catch {}
  }
  appInstallWatchers = [];
  if (appInstallChangeDebounceTimer) {
    clearTimeout(appInstallChangeDebounceTimer);
    appInstallChangeDebounceTimer = null;
  }
}

function updateAppUpdaterStatus(patch: Partial<AppUpdaterStatusSnapshot>): void {
  appUpdaterStatusSnapshot = {
    ...appUpdaterStatusSnapshot,
    ...patch,
  };
  sendAppUpdaterStatusToRenderers();
}

function parseGithubRepository(input: string): { owner: string; repo: string } | null {
  const value = String(input || '').trim();
  if (!value) return null;
  const direct = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(value);
  if (direct) {
    return { owner: direct[1], repo: direct[2] };
  }
  const match = /github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/|$)/i.exec(value);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
  };
}

function readAppPackageJson(): Record<string, any> | null {
  const fs = require('fs');
  const candidatePaths = [
    path.join(app.getAppPath(), 'package.json'),
    path.join(process.cwd(), 'package.json'),
  ];

  for (const filePath of candidatePaths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {}
  }

  return null;
}

function resolveAppUpdaterFeedConfig(): Record<string, any> | null {
  const pkg = readAppPackageJson();
  if (!pkg || typeof pkg !== 'object') return null;

  const publishFromRoot = Array.isArray((pkg as any).publish) ? (pkg as any).publish[0] : (pkg as any).publish;
  const publishFromBuild = Array.isArray((pkg as any).build?.publish) ? (pkg as any).build?.publish[0] : (pkg as any).build?.publish;
  const publish = (publishFromRoot && typeof publishFromRoot === 'object')
    ? publishFromRoot
    : (publishFromBuild && typeof publishFromBuild === 'object' ? publishFromBuild : null);
  if (!publish) return null;

  const provider = String((publish as any).provider || '').trim().toLowerCase();
  if (provider !== 'github') {
    return publish;
  }

  const repositoryRaw = typeof (pkg as any).repository === 'string'
    ? (pkg as any).repository
    : String((pkg as any).repository?.url || '');
  const parsedRepo = parseGithubRepository(repositoryRaw);
  const owner = String((publish as any).owner || parsedRepo?.owner || '').trim();
  const repo = String((publish as any).repo || parsedRepo?.repo || '').trim();
  if (!owner || !repo) {
    return null;
  }

  return {
    ...publish,
    provider: 'github',
    owner,
    repo,
  };
}

function ensureAppUpdaterConfigured(): void {
  if (appUpdaterConfigured) return;
  appUpdaterConfigured = true;

  updateAppUpdaterStatus({
    currentVersion: app.getVersion(),
    progressPercent: 0,
    transferredBytes: 0,
    totalBytes: 0,
    bytesPerSecond: 0,
  });

  if (!app.isPackaged) {
    updateAppUpdaterStatus({
      state: 'unsupported',
      supported: false,
      message: 'Updates are available in packaged builds.',
    });
    return;
  }

  try {
    const { autoUpdater } = require('electron-updater');
    appUpdater = autoUpdater;
  } catch (error: any) {
    appUpdater = null;
    updateAppUpdaterStatus({
      state: 'unsupported',
      supported: false,
      message: String(error?.message || error || 'electron-updater is unavailable.'),
    });
    return;
  }

  if (!appUpdater) {
    updateAppUpdaterStatus({
      state: 'unsupported',
      supported: false,
      message: 'electron-updater is unavailable.',
    });
    return;
  }

  try {
    appUpdater.autoDownload = false;
    appUpdater.autoInstallOnAppQuit = false;
  } catch {}

  try {
    appUpdater.logger = console;
  } catch {}

  const feedConfig = resolveAppUpdaterFeedConfig();
  if (feedConfig) {
    try {
      appUpdater.setFeedURL(feedConfig);
    } catch (error) {
      console.warn('[Updater] Failed to set feed URL from package.json:', error);
    }
  } else {
    console.warn('[Updater] No publish/repository config found for auto updates.');
  }

  appUpdater.on('checking-for-update', () => {
    updateAppUpdaterStatus({
      state: 'checking',
      supported: true,
      message: 'Checking for updates...',
      progressPercent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
    });
  });

  appUpdater.on('update-available', (info: any) => {
    updateAppUpdaterStatus({
      state: 'available',
      supported: true,
      latestVersion: String(info?.version || '').trim() || undefined,
      releaseName: String(info?.releaseName || '').trim() || undefined,
      releaseDate: info?.releaseDate ? String(info.releaseDate) : undefined,
      message: 'Update available.',
      progressPercent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
    });
  });

  appUpdater.on('update-not-available', (info: any) => {
    updateAppUpdaterStatus({
      state: 'not-available',
      supported: true,
      latestVersion: String(info?.version || '').trim() || app.getVersion(),
      message: 'You are up to date.',
      progressPercent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
    });
  });

  appUpdater.on('download-progress', (progress: any) => {
    updateAppUpdaterStatus({
      state: 'downloading',
      supported: true,
      progressPercent: Number(progress?.percent || 0),
      transferredBytes: Number(progress?.transferred || 0),
      totalBytes: Number(progress?.total || 0),
      bytesPerSecond: Number(progress?.bytesPerSecond || 0),
      message: 'Downloading update...',
    });
  });

  appUpdater.on('update-downloaded', (info: any) => {
    updateAppUpdaterStatus({
      state: 'downloaded',
      supported: true,
      latestVersion: String(info?.version || '').trim() || appUpdaterStatusSnapshot.latestVersion,
      releaseName: String(info?.releaseName || '').trim() || appUpdaterStatusSnapshot.releaseName,
      releaseDate: info?.releaseDate ? String(info.releaseDate) : appUpdaterStatusSnapshot.releaseDate,
      progressPercent: 100,
      message: 'Update ready. Restart to install.',
    });
  });

  appUpdater.on('error', (error: any) => {
    updateAppUpdaterStatus({
      state: 'error',
      supported: true,
      message: String(error?.message || error || 'Failed to update.'),
    });
  });

  updateAppUpdaterStatus({
    state: 'idle',
    supported: true,
    message: '',
  });
}

async function checkForAppUpdates(): Promise<AppUpdaterStatusSnapshot> {
  ensureAppUpdaterConfigured();
  if (!appUpdater) {
    return { ...appUpdaterStatusSnapshot };
  }

  if (appUpdaterCheckPromise) {
    await appUpdaterCheckPromise;
    return { ...appUpdaterStatusSnapshot };
  }

  if (appUpdaterDownloadPromise) {
    return { ...appUpdaterStatusSnapshot };
  }

  appUpdaterCheckPromise = Promise.resolve()
    .then(async () => {
      await appUpdater.checkForUpdates();
    })
    .catch((error: any) => {
      updateAppUpdaterStatus({
        state: 'error',
        supported: true,
        message: String(error?.message || error || 'Failed to check for updates.'),
      });
    })
    .finally(() => {
      appUpdaterCheckPromise = null;
    });

  await appUpdaterCheckPromise;
  const checkedAt = Date.now();
  persistAppUpdaterLastCheckedAt(checkedAt);
  scheduleNextAppUpdaterAutoCheck(checkedAt);
  return { ...appUpdaterStatusSnapshot };
}

async function runBackgroundAppUpdaterCheck(): Promise<void> {
  if (!app.isPackaged) return;
  ensureAppUpdaterConfigured();
  if (!appUpdater || appUpdaterStatusSnapshot.supported === false) return;

  const lastCheckedAt = readAppUpdaterLastCheckedAt();
  const now = Date.now();
  if (lastCheckedAt > 0 && (now - lastCheckedAt) < APP_UPDATER_AUTO_CHECK_INTERVAL_MS) {
    scheduleNextAppUpdaterAutoCheck(lastCheckedAt);
    return;
  }

  try {
    await checkForAppUpdates();
  } catch {
    // Keep background checks non-fatal.
  } finally {
    const latestCheckedAt = readAppUpdaterLastCheckedAt();
    scheduleNextAppUpdaterAutoCheck(latestCheckedAt || Date.now());
  }
}

async function downloadAppUpdate(): Promise<AppUpdaterStatusSnapshot> {
  ensureAppUpdaterConfigured();
  if (!appUpdater) {
    return { ...appUpdaterStatusSnapshot };
  }

  if (appUpdaterCheckPromise) {
    await appUpdaterCheckPromise;
  }

  if (appUpdaterDownloadPromise) {
    await appUpdaterDownloadPromise;
    return { ...appUpdaterStatusSnapshot };
  }

  const canDownload = appUpdaterStatusSnapshot.state === 'available' || appUpdaterStatusSnapshot.state === 'downloading';
  if (!canDownload) {
    updateAppUpdaterStatus({
      state: 'error',
      supported: true,
      message: 'No update is ready to download. Check for updates first.',
    });
    return { ...appUpdaterStatusSnapshot };
  }

  appUpdaterDownloadPromise = Promise.resolve()
    .then(async () => {
      updateAppUpdaterStatus({
        state: 'downloading',
        supported: true,
        message: 'Downloading update...',
      });
      await appUpdater.downloadUpdate();
    })
    .catch((error: any) => {
      updateAppUpdaterStatus({
        state: 'error',
        supported: true,
        message: String(error?.message || error || 'Failed to download update.'),
      });
    })
    .finally(() => {
      appUpdaterDownloadPromise = null;
    });

  await appUpdaterDownloadPromise;
  return { ...appUpdaterStatusSnapshot };
}

function restartAndInstallAppUpdate(): boolean {
  ensureAppUpdaterConfigured();
  if (!appUpdater) return false;
  if (appUpdaterStatusSnapshot.state !== 'downloaded') return false;
  try {
    setTimeout(() => {
      try {
        appUpdater.quitAndInstall(false, true);
      } catch {}
    }, 40);
    return true;
  } catch (error) {
    console.warn('[Updater] Failed to quit and install update:', error);
    return false;
  }
}

// ─── Shortcut Management ────────────────────────────────────────────

function applyOpenAtLogin(enabled: boolean): boolean {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: true,
    });
    return true;
  } catch (error) {
    console.warn('[LoginItems] Failed to update open-at-login:', error);
    return false;
  }
}

function disableMacSpotlightShortcuts(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    const { execFileSync } = require('child_process');
    const os = require('os');
    const plistPath = `${os.homedir()}/Library/Preferences/com.apple.symbolichotkeys.plist`;
    let applied = false;
    // Keys: 64 = Spotlight search (Cmd+Space), 65 = Spotlight window (Cmd+Option+Space)
    for (const key of ['64', '65']) {
      try {
        // Try PlistBuddy first — modifies only the `enabled` field, preserving the
        // rest of the entry so macOS can re-enable it correctly later.
        execFileSync('/usr/libexec/PlistBuddy', [
          '-c', `Set :AppleSymbolicHotKeys:${key}:enabled false`,
          plistPath,
        ]);
        applied = true;
      } catch {
        // PlistBuddy Set fails when the key path doesn't yet exist.
        // Fall back to defaults write with the full standard structure so macOS
        // can parse the entry properly (a bare `{enabled = 0;}` dict may be ignored).
        try {
          const fullValue = key === '64'
            ? '{ enabled = 0; value = { parameters = (32, 49, 1048576); type = standard; }; }'
            : '{ enabled = 0; value = { parameters = (32, 49, 1572864); type = standard; }; }';
          execFileSync('/usr/bin/defaults', [
            'write',
            'com.apple.symbolichotkeys',
            'AppleSymbolicHotKeys',
            '-dict-add',
            key,
            fullValue,
          ]);
          applied = true;
        } catch (error) {
          console.warn(`[Spotlight] Failed to disable macOS symbolic hotkey ${key}:`, error);
        }
      }
    }
    try { execFileSync('/usr/bin/killall', ['cfprefsd']); } catch {}
    try { execFileSync('/usr/bin/killall', ['SystemUIServer']); } catch {}
    return applied;
  } catch (error) {
    console.warn('[Spotlight] Failed to disable Spotlight shortcuts:', error);
    return false;
  }
}

async function replaceSpotlightWithSuperCmdShortcut(): Promise<boolean> {
  const disabled = disableMacSpotlightShortcuts();
  const targetShortcut = 'Command+Space';
  const delaysMs = [0, 140, 340];
  let registered = false;
  for (const delay of delaysMs) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    registered = registerGlobalShortcut(targetShortcut);
    if (registered) break;
  }

  if (!registered) {
    if (disabled && process.platform === 'darwin') {
      // Symbolic hotkey changes can take a moment to propagate. Persist now and retry soon.
      saveSettings({ globalShortcut: targetShortcut });
      setTimeout(() => {
        try { registerGlobalShortcut(targetShortcut); } catch {}
      }, 1000);
      return true;
    }
    return false;
  }

  saveSettings({ globalShortcut: targetShortcut });
  if (!disabled && process.platform === 'darwin') {
    console.warn('[Spotlight] Spotlight shortcut might still be enabled.');
  }
  return true;
}

function registerGlobalShortcut(shortcut: string): boolean {
  const normalizedShortcut = normalizeAccelerator(shortcut);
  globalShortcutRegistrationState.requestedShortcut = normalizedShortcut;
  // Unregister the previous global shortcut
  if (currentShortcut) {
    try {
      unregisterShortcutVariants(currentShortcut);
    } catch {}
  }

  try {
    const success = globalShortcut.register(normalizedShortcut, () => {
      markOpeningShortcutForSuppression(normalizedShortcut);
      toggleWindow();
    });
    if (success) {
      currentShortcut = normalizedShortcut;
      globalShortcutRegistrationState.activeShortcut = normalizedShortcut;
      globalShortcutRegistrationState.ok = true;
      console.log(`Global shortcut registered: ${normalizedShortcut}`);
      return true;
    } else {
      console.error(`Failed to register shortcut: ${normalizedShortcut}`);
      // Re-register old one
      if (currentShortcut && currentShortcut !== normalizedShortcut) {
        try {
          const restoredShortcut = currentShortcut;
          globalShortcut.register(restoredShortcut, () => {
            markOpeningShortcutForSuppression(restoredShortcut);
            toggleWindow();
          });
        } catch {}
      }
      globalShortcutRegistrationState.ok = false;
      return false;
    }
  } catch (e) {
    console.error(`Error registering shortcut: ${e}`);
    globalShortcutRegistrationState.ok = false;
    return false;
  }
}

function registerCommandHotkeys(hotkeys: Record<string, string>): void {
  // Unregister all existing command hotkeys
  for (const [shortcut] of registeredHotkeys) {
    try {
      unregisterShortcutVariants(shortcut);
    } catch {}
  }
  registeredHotkeys.clear();

  for (const [commandId, shortcut] of Object.entries(hotkeys)) {
    if (!shortcut) continue;
    const normalizedShortcut = normalizeAccelerator(shortcut);
    if (commandId === 'system-supercmd-whisper-speak-toggle' && isFnOnlyShortcut(normalizedShortcut)) {
      continue;
    }
    if (isFnShortcut(normalizedShortcut)) {
      continue;
    }
    try {
      const success = globalShortcut.register(normalizedShortcut, async () => {
        await runCommandById(commandId, 'hotkey');
      });
      if (success) {
        registeredHotkeys.set(normalizedShortcut, commandId);
      }
    } catch {}
  }

  syncFnSpeakToggleWatcher(hotkeys);
  syncFnCommandWatchers(hotkeys);
}

function registerDevToolsShortcut(): void {
  try {
    unregisterShortcutVariants(DEVTOOLS_SHORTCUT);
  } catch {}

  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  try {
    const success = globalShortcut.register(DEVTOOLS_SHORTCUT, () => {
      const opened = openPreferredDevTools();
      if (!opened) {
        console.warn('[DevTools] No window available to open developer tools.');
      }
    });
    if (!success) {
      console.warn(`[DevTools] Failed to register shortcut: ${DEVTOOLS_SHORTCUT}`);
    }
  } catch (error) {
    console.warn(`[DevTools] Error registering shortcut: ${DEVTOOLS_SHORTCUT}`, error);
  }
}

// ─── App Initialization ─────────────────────────────────────────────

async function rebuildExtensions() {
  const installed = Array.from(
    new Set(getInstalledExtensionsSettingsSchema().map((schema) => schema.extName))
  );
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
  app.setAsDefaultProtocolClient('supercmd');
  scrubInternalClipboardProbe('app startup');
  // Warm the worker so the first window-management action does not race spawn.
  setTimeout(() => { ensureWindowManagerWorker(); }, 0);

  // Register the sc-asset:// protocol handler to serve extension asset files
  protocol.handle('sc-asset', (request: any) => {
    // URL format: sc-asset://ext-asset/path/to/file
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'ext-asset') {
        return new Response('Not Found', { status: 404 });
      }

      let filePath = decodeURIComponent(url.pathname || '');
      if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath)) {
        filePath = filePath.slice(1);
      }
      if (!filePath) {
        return new Response('Bad Request', { status: 400 });
      }

      const { pathToFileURL } = require('url');
      // Convert via pathToFileURL so spaces/special chars are encoded correctly.
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
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
          {
            label: 'Preferences...',
            accelerator: 'Cmd+,',
            click: () => openSettingsWindow(),
          },
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
  ensureAppTray();

  const settings = loadSettings();
  applyOpenAtLogin(Boolean((settings as any).openAtLogin));
  ensureAppUpdaterConfigured();
  startFileSearchIndexing({
    homeDir: app.getPath('home'),
    includeProtectedHomeRoots: Boolean(settings.fileSearchProtectedRootsEnabled),
  });
  // Daily background update check (once every 24h).
  void runBackgroundAppUpdaterCheck();

  // Start clipboard monitor only after onboarding is complete.
  // On macOS Sonoma+, reading the clipboard at startup can trigger an
  // Automation permission dialog for whichever app last wrote to the clipboard,
  // which should not appear while the user is on the onboarding screen.
  if (settings.hasSeenOnboarding) {
    startClipboardMonitor();
  }

  // Initialize snippet store
  initSnippetStore();
  try { refreshSnippetExpander(); } catch (e) {
    console.warn('[SnippetExpander] Failed to start:', e);
  }
  initQuickLinkStore();

  // Rebuilding all extensions on every startup can stall app launch if one
  // extension build hangs. Keep startup fast by default; allow opt-in.
  if (process.env.SUPERCMD_REBUILD_EXTENSIONS_ON_STARTUP === '1') {
    rebuildExtensions().catch(console.error);
  } else {
    console.log('Skipping startup extension rebuild (set SUPERCMD_REBUILD_EXTENSIONS_ON_STARTUP=1 to enable).');
  }

  // ─── IPC: Launcher ──────────────────────────────────────────────

  ipcMain.handle('get-commands', async () => {
    const s = loadSettings();
    const commands = await getAvailableCommands();
    const disabled = new Set(s.disabledCommands || []);
    const enabled = new Set((s as any).enabledCommands || []);
    const aiDisabled = isAIDisabledInSettings(s);
    return commands.filter((c: any) => {
      const commandId = String(c?.id || '');
      if (aiDisabled && isAIDependentSystemCommand(commandId)) return false;
      if (isAISectionDisabledForCommand(commandId, s)) return false;
      if (disabled.has(c.id)) return false;
      if (c?.disabledByDefault && !enabled.has(c.id)) return false;
      return true;
    });
  });

  ipcMain.handle(
    'execute-command',
    async (_event: any, commandId: string) => {
      return await runCommandById(commandId, 'launcher');
    }
  );

  ipcMain.handle(
    'execute-command-as-hotkey',
    async (_event: any, commandId: string) => {
      return await runCommandById(commandId, 'hotkey');
    }
  );

  ipcMain.handle(
    'execute-command-from-widget',
    async (_event: any, commandId: string) => {
      return await runCommandById(commandId, 'widget');
    }
  );

  ipcMain.handle('hide-window', () => {
    hideWindow();
  });

  ipcMain.handle('open-devtools', () => {
    return openPreferredDevTools();
  });

  ipcMain.handle('close-prompt-window', () => {
    hidePromptWindow();
  });

  ipcMain.handle('set-launcher-mode', (_event: any, mode: LauncherMode) => {
    if (mode !== 'default' && mode !== 'onboarding' && mode !== 'whisper' && mode !== 'speak' && mode !== 'prompt') return;
    setLauncherMode(mode);
  });

  ipcMain.on('set-detached-overlay-state', (_event: any, payload?: { overlay?: 'whisper' | 'speak'; visible?: boolean }) => {
    const overlay = payload?.overlay;
    const visible = Boolean(payload?.visible);
    if (overlay === 'whisper') {
      whisperOverlayVisible = visible;
      if (visible) {
        lastWhisperShownAt = Date.now();
      } else {
        whisperHoldRequestSeq += 1;
        stopWhisperHoldWatcher();
      }
      return;
    }
    if (overlay === 'speak') {
      speakOverlayVisible = visible;
    }
  });

  ipcMain.on('whisper-ignore-mouse-events', (_event: any, payload?: { ignore?: boolean }) => {
    const ignore = Boolean(payload?.ignore);
    if (whisperChildWindow && !whisperChildWindow.isDestroyed()) {
      whisperChildWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  ipcMain.handle('get-last-frontmost-app', () => {
    return lastFrontmostApp;
  });

  ipcMain.handle('restore-last-frontmost-app', async () => {
    return await activateLastFrontmostApp();
  });

  ipcMain.handle('speak-stop', () => {
    stopSpeakSession({ resetStatus: true, cleanupWindow: true });
    return true;
  });

  ipcMain.handle('speak-get-status', () => {
    return speakStatusSnapshot;
  });

  ipcMain.handle('speak-get-options', () => {
    return { ...speakRuntimeOptions };
  });

  ipcMain.handle(
    'speak-update-options',
    (_event: any, patch: { voice?: string; rate?: string; restartCurrent?: boolean }) => {
      if (patch?.voice && typeof patch.voice === 'string') {
        speakRuntimeOptions.voice = patch.voice.trim() || speakRuntimeOptions.voice;
      }
      if (patch?.rate !== undefined) {
        speakRuntimeOptions.rate = parseSpeakRateInput(patch.rate);
      }

      if (patch?.restartCurrent && activeSpeakSession) {
        const currentIdx = Math.max(0, activeSpeakSession.currentIndex || 0);
        activeSpeakSession.restartFrom(currentIdx);
      }

      return { ...speakRuntimeOptions };
    }
  );

  ipcMain.handle(
    'speak-preview-voice',
    async (_event: any, payload?: { voice: string; text?: string; rate?: string; provider?: 'edge-tts' | 'elevenlabs'; model?: string }) => {
      const settings = loadSettings();
      if (isAIDisabledInSettings(settings)) return false;
      if (settings.ai?.readEnabled === false) return false;
      const provider = payload?.provider || (String(settings.ai?.textToSpeechModel || '').startsWith('elevenlabs-') ? 'elevenlabs' : 'edge-tts');
      const voice = String(payload?.voice || speakRuntimeOptions.voice || 'en-US-EricNeural').trim();
      const rate = parseSpeakRateInput(payload?.rate ?? speakRuntimeOptions.rate);
      const sampleTextRaw = String(payload?.text || 'Hi, this is my voice in SuperCmd.');
      const sampleText = sampleTextRaw.trim().slice(0, 240) || 'Hi, this is my voice in SuperCmd.';

      const fs = require('fs');
      const os = require('os');
      const pathMod = require('path');
      const { spawn } = require('child_process');
      const localSpeakBackend = provider === 'edge-tts' ? resolveLocalSpeakBackend() : null;

      const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'supercmd-voice-preview-'));
      const previewExtension = provider === 'elevenlabs' || localSpeakBackend === 'edge-tts' ? 'mp3' : 'aiff';
      const audioPath = pathMod.join(tmpDir, `preview.${previewExtension}`);

      try {
        if (provider === 'elevenlabs') {
          const apiKey = getElevenLabsApiKey(settings);
          if (!apiKey) return false;
          const configuredModel = String(payload?.model || settings.ai?.textToSpeechModel || 'elevenlabs-multilingual-v2');
          const ttsConfig = resolveElevenLabsTtsConfig(configuredModel);
          const voiceId = voice || ttsConfig.voiceId;
          await synthesizeElevenLabsToFile({
            text: sampleText,
            apiKey,
            modelId: ttsConfig.modelId,
            voiceId,
            audioPath,
            timeoutMs: 45000,
          });
        } else {
          if (!localSpeakBackend) return false;
          const langMatch = /^([a-z]{2}-[A-Z]{2})-/.exec(voice);
          const lang = langMatch?.[1] || String(settings.ai?.speechLanguage || 'en-US');
          if (localSpeakBackend === 'edge-tts') {
            await synthesizeWithEdgeTts({
              text: sampleText,
              audioPath,
              voice,
              lang,
              rate,
              saveSubtitles: false,
              timeoutMs: 45000,
            });
          } else {
            await synthesizeWithSystemSay({
              text: sampleText,
              audioPath,
              lang,
              rate,
            });
          }
        }

        const playErr = await new Promise<Error | null>((resolve) => {
          const proc = spawn('/usr/bin/afplay', [audioPath], { stdio: ['ignore', 'ignore', 'pipe'] });
          let stderr = '';
          proc.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk || ''); });
          proc.on('error', (err: Error) => resolve(err));
          proc.on('close', (code: number | null) => {
            if (code && code !== 0) {
              resolve(new Error(stderr.trim() || `afplay exited with ${code}`));
              return;
            }
            resolve(null);
          });
        });

        if (playErr) throw playErr;
        return true;
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    }
  );

  ipcMain.handle('edge-tts-list-voices', async () => {
    const now = Date.now();
    if (edgeVoiceCatalogCache && edgeVoiceCatalogCache.expiresAt > now) {
      return edgeVoiceCatalogCache.voices;
    }

    try {
      const voices = await fetchEdgeTtsVoiceCatalog(12000);
      if (voices.length > 0) {
        edgeVoiceCatalogCache = {
          voices,
          expiresAt: now + (1000 * 60 * 60 * 12),
        };
      }
      return voices;
    } catch (error) {
      if (edgeVoiceCatalogCache?.voices?.length) {
        return edgeVoiceCatalogCache.voices;
      }
      console.warn('[Speak] Failed to fetch Edge voice catalog:', error);
      return [];
    }
  });

  ipcMain.handle('elevenlabs-list-voices', async () => {
    const settings = loadSettings();
    const apiKey = getElevenLabsApiKey(settings);
    if (!apiKey) {
      return { voices: [], error: 'ElevenLabs API key not configured.' };
    }
    return fetchElevenLabsVoices(apiKey);
  });

  // ─── IPC: Settings ──────────────────────────────────────────────

  ipcMain.handle('get-settings', () => {
    return loadSettings();
  });

  ipcMain.handle('get-global-shortcut-status', () => {
    return { ...globalShortcutRegistrationState };
  });

  ipcMain.handle('app-updater-get-status', () => {
    ensureAppUpdaterConfigured();
    return { ...appUpdaterStatusSnapshot };
  });

  ipcMain.handle('app-updater-check-for-updates', async () => {
    return await checkForAppUpdates();
  });

  ipcMain.handle('app-updater-download-update', async () => {
    return await downloadAppUpdate();
  });

  ipcMain.handle('app-updater-quit-and-install', () => {
    return restartAndInstallAppUpdate();
  });

  // Full update flow: check → download → restart
  ipcMain.handle('app-updater-check-and-install', async () => {
    ensureAppUpdaterConfigured();
    if (!appUpdater) {
      void showMemoryStatusBar('error', 'Updater not available.');
      return { success: false, error: 'Updater not available' };
    }

    try {
      // Step 1: Check for updates
      void showMemoryStatusBar('processing', 'Checking for updates...');
      const checkStatus = await checkForAppUpdates();
      if (checkStatus.state === 'not-available') {
        void showMemoryStatusBar('success', 'Already on latest version.');
        return { success: true, message: 'Already on latest version', state: checkStatus.state };
      }
      if (checkStatus.state === 'error') {
        void showMemoryStatusBar('error', checkStatus.message || 'Failed to check for updates');
        return { success: false, error: checkStatus.message || 'Failed to check for updates' };
      }

      // Step 2: Download if available
      if (checkStatus.state === 'available') {
        void showMemoryStatusBar('processing', 'Downloading update...');
        const downloadStatus = await downloadAppUpdate();
        if (downloadStatus.state === 'error') {
          void showMemoryStatusBar('error', downloadStatus.message || 'Failed to download update');
          return { success: false, error: downloadStatus.message || 'Failed to download update' };
        }
      }

      // Step 3: Restart if downloaded
      if (appUpdaterStatusSnapshot.state === 'downloaded') {
        void showMemoryStatusBar('processing', 'Restarting to install update...');
        const installed = restartAndInstallAppUpdate();
        if (installed) {
          return { success: true, message: 'Restarting to install update...', state: 'restarting' };
        }
        void showMemoryStatusBar('error', 'Failed to restart for update installation');
        return { success: false, error: 'Failed to restart for update installation' };
      }

      void showMemoryStatusBar('success', checkStatus.message || 'Update check complete');
      return { success: true, message: checkStatus.message || 'Update check complete', state: checkStatus.state };
    } catch (error: any) {
      void showMemoryStatusBar('error', String(error?.message || error || 'Update flow failed'));
      return { success: false, error: String(error?.message || error || 'Update flow failed') };
    }
  });

  ipcMain.handle(
    'save-settings',
    async (_event: any, patch: Partial<AppSettings>) => {
      const result = saveSettings(patch);
      const windowsToNotify = [mainWindow, settingsWindow, extensionStoreWindow, promptWindow]
        .filter(Boolean) as Array<InstanceType<typeof BrowserWindow>>;
      for (const win of windowsToNotify) {
        if (win.isDestroyed()) continue;
        try {
          win.webContents.send('settings-updated', result);
        } catch {}
      }
      if (patch.uiStyle !== undefined) {
        const nextStyle = String(result.uiStyle || 'default').trim().toLowerCase();
        const shouldEnableGlassy = nextStyle === 'glassy';
        if (!shouldEnableGlassy) {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win || win.isDestroyed()) continue;
            syncNativeLiquidGlassClassOnWindow(win, false);
          }
        } else {
          if (mainWindow && !mainWindow.isDestroyed()) {
            applyLiquidGlassToWindow(mainWindow, {
              cornerRadius: 16,
              fallbackVibrancy: 'under-window',
            });
          }
          if (promptWindow && !promptWindow.isDestroyed()) {
            applyLiquidGlassToWindow(promptWindow, {
              cornerRadius: 16,
              fallbackVibrancy: 'fullscreen-ui',
            });
          }
          if (settingsWindow && !settingsWindow.isDestroyed()) {
            applyLiquidGlassToWindow(settingsWindow, {
              cornerRadius: 14,
              fallbackVibrancy: 'hud',
            });
          }
          if (extensionStoreWindow && !extensionStoreWindow.isDestroyed()) {
            applyLiquidGlassToWindow(extensionStoreWindow, {
              cornerRadius: 14,
              fallbackVibrancy: 'hud',
            });
          }
        }
      }
      if (patch.commandAliases !== undefined) {
        invalidateCache();
      }
      if (patch.customExtensionFolders !== undefined) {
        invalidateCache();
        try {
          await rebuildExtensions();
        } catch (error) {
          console.error('Failed to rebuild extensions after updating custom folders:', error);
        }
      }
      if (patch.fileSearchProtectedRootsEnabled !== undefined) {
        startFileSearchIndexing({
          homeDir: app.getPath('home'),
          includeProtectedHomeRoots: Boolean(result.fileSearchProtectedRootsEnabled),
        });
      }
      if (patch.openAtLogin !== undefined) {
        applyOpenAtLogin(Boolean(patch.openAtLogin));
      }
      // Hyper runtime wiring is temporarily disabled.
      // if (patch.hyperKeyIncludeShift !== undefined) {
      //   try {
      //     registerGlobalShortcut(result.globalShortcut);
      //   } catch {}
      //   try {
      //     registerCommandHotkeys(result.commandHotkeys);
      //   } catch {}
      // }
      // When onboarding completes: hide dock, then start services that were
      // deferred to avoid triggering permission dialogs during onboarding.
      if (patch.hasSeenOnboarding === true) {
        fnWatcherOnboardingOverride = false;
        if (process.platform === 'darwin') {
          app.dock.hide();
        }
        startClipboardMonitor();
        syncFnSpeakToggleWatcher(loadSettings().commandHotkeys);
        syncFnCommandWatchers(loadSettings().commandHotkeys);
      }
      const aiEnabledPatch = patch.ai?.enabled;
      if (aiEnabledPatch === false) {
        stopSpeakSession({ resetStatus: true, cleanupWindow: true });
        mainWindow?.webContents.send('whisper-stop-listening');
        mainWindow?.webContents.send('whisper-stop-and-close');
        whisperHoldRequestSeq += 1;
        stopWhisperHoldWatcher();
        stopFnSpeakToggleWatcher();
        if (nativeSpeechProcess) {
          try { nativeSpeechProcess.kill('SIGTERM'); } catch {}
          nativeSpeechProcess = null;
          nativeSpeechStdoutBuffer = '';
        }
      } else if (aiEnabledPatch === true) {
        syncFnSpeakToggleWatcher(loadSettings().commandHotkeys);
        syncFnCommandWatchers(loadSettings().commandHotkeys);
      }
      return result;
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

  ipcMain.handle('set-open-at-login', (_event: any, enabled: boolean) => {
    const applied = applyOpenAtLogin(Boolean(enabled));
    if (applied) {
      saveSettings({ openAtLogin: Boolean(enabled) } as Partial<AppSettings>);
    }
    return applied;
  });

  ipcMain.handle('replace-spotlight-with-supercmd', async () => {
    return await replaceSpotlightWithSuperCmdShortcut();
  });

  ipcMain.handle('onboarding-request-permission', async (_event: any, target: OnboardingPermissionTarget) => {
    return await requestOnboardingPermissionAccess(target);
  });
  ipcMain.handle('whisper-ensure-microphone-access', async (_event: any, options?: { prompt?: boolean }) => {
    const prompt = options?.prompt !== false;
    return await ensureMicrophoneAccess(prompt);
  });
  ipcMain.handle('whisper-ensure-speech-recognition-access', async (_event: any, options?: { prompt?: boolean }) => {
    const prompt = options?.prompt !== false;
    return await ensureSpeechRecognitionAccess(prompt);
  });

  // ─── IPC: Check permission statuses without triggering dialogs ──────
  // Used by the onboarding screen to refresh green/amber badges when the user
  // returns from System Settings after granting a permission.
  ipcMain.handle('check-onboarding-permissions', async () => {
    const statuses: Record<string, boolean> = {};
    if (process.platform === 'darwin') {
      statuses['home-folder'] = Boolean(loadSettings().fileSearchProtectedRootsEnabled);
      try {
        statuses['accessibility'] = systemPreferences.isTrustedAccessibilityClient(false);
      } catch {}
      try {
        statuses['input-monitoring'] = await checkInputMonitoringAccess();
      } catch {}
      try {
        const micResult = await ensureMicrophoneAccess(false);
        statuses['microphone'] = Boolean(micResult.granted);
      } catch {}
      try {
        const srResult = await ensureSpeechRecognitionAccess(false);
        statuses['speech-recognition'] = Boolean(srResult.granted);
      } catch {}
    }
    return statuses;
  });

  // ─── IPC: Fn watcher override for onboarding dictation test (step 4) ─
  ipcMain.handle('enable-fn-watcher-for-onboarding', () => {
    fnWatcherOnboardingOverride = true;
    syncFnSpeakToggleWatcher(loadSettings().commandHotkeys);
    syncFnCommandWatchers(loadSettings().commandHotkeys);
  });
  ipcMain.handle('disable-fn-watcher-for-onboarding', () => {
    fnWatcherOnboardingOverride = false;
    if (!loadSettings().hasSeenOnboarding) {
      stopFnSpeakToggleWatcher();
      stopAllFnCommandWatchers();
    }
  });

  ipcMain.handle(
    'update-command-hotkey',
    async (_event: any, commandId: string, hotkey: string) => {
      const s = loadSettings();
      const hotkeys = { ...s.commandHotkeys };
      const normalizedHotkey = hotkey ? normalizeAccelerator(hotkey) : '';

      // Unregister old hotkey for this command
      const oldHotkey = hotkeys[commandId];
      if (oldHotkey) {
        try {
          unregisterShortcutVariants(oldHotkey);
          registeredHotkeys.delete(normalizeAccelerator(oldHotkey));
        } catch {}
      }

      if (hotkey) {
        // Prevent two commands from sharing the same accelerator.
        for (const [otherCommandId, otherHotkey] of Object.entries(hotkeys)) {
          if (otherCommandId === commandId) continue;
          if (normalizeAccelerator(otherHotkey) === normalizedHotkey) {
            return { success: false, error: 'duplicate' as const, conflictCommandId: otherCommandId };
          }
        }

        const isFnSpeakToggle =
          commandId === 'system-supercmd-whisper-speak-toggle' &&
          isFnOnlyShortcut(normalizedHotkey);
        const isFnHotkey = isFnShortcut(normalizedHotkey);

        // Register the new one
        try {
          let success = false;
          if (isFnSpeakToggle) {
            success = true;
          } else if (isFnHotkey) {
            const fnConfig = parseHoldShortcutConfig(normalizedHotkey);
            const binaryPath = ensureWhisperHoldWatcherBinary();
            success = Boolean(fnConfig && fnConfig.fn && binaryPath);
          } else {
            success = globalShortcut.register(normalizedHotkey, async () => {
              await runCommandById(commandId, 'hotkey');
            });
          }
          if (!success) {
            // Attempt to restore old mapping if the new one failed.
            if (oldHotkey && !isFnHotkey) {
              const normalizedOldHotkey = normalizeAccelerator(oldHotkey);
              try {
                const restored = globalShortcut.register(normalizedOldHotkey, async () => {
                  await runCommandById(commandId, 'hotkey');
                });
                if (restored) {
                  registeredHotkeys.set(normalizedOldHotkey, commandId);
                }
              } catch {}
            }
            return { success: false, error: 'unavailable' as const };
          }
          hotkeys[commandId] = hotkey;
          if (!isFnSpeakToggle && !isFnHotkey) {
            registeredHotkeys.set(normalizedHotkey, commandId);
          }
        } catch {
          return { success: false, error: 'unavailable' as const };
        }
      } else {
        delete hotkeys[commandId];
      }

      saveSettings({ commandHotkeys: hotkeys });
      syncFnSpeakToggleWatcher(hotkeys);
      syncFnCommandWatchers(hotkeys);
      return { success: true as const };
    }
  );

  ipcMain.handle(
    'toggle-command-enabled',
    (_event: any, commandId: string, enabled: boolean) => {
      const s = loadSettings();
      let disabled = [...s.disabledCommands];
      let explicitlyEnabled = [...(s.enabledCommands || [])];

      if (enabled) {
        disabled = disabled.filter((id) => id !== commandId);
        if (!explicitlyEnabled.includes(commandId)) {
          explicitlyEnabled.push(commandId);
        }
      } else {
        if (!disabled.includes(commandId)) {
          disabled.push(commandId);
        }
        explicitlyEnabled = explicitlyEnabled.filter((id) => id !== commandId);
      }

      saveSettings({ disabledCommands: disabled, enabledCommands: explicitlyEnabled });
      return true;
    }
  );

  ipcMain.handle('open-settings', () => {
    openSettingsWindow();
  });

  ipcMain.handle('open-settings-tab', (_event: any, payloadOrTab: any, maybeTarget?: any) => {
    const payload = resolveSettingsNavigationPayload(payloadOrTab, maybeTarget);
    if (!payload) {
      openSettingsWindow({ tab: 'general' });
      return;
    }
    openSettingsWindow(payload);
  });

  ipcMain.handle('open-extension-store-window', () => {
    openExtensionStoreWindow();
  });

  ipcMain.handle('open-custom-scripts-folder', async () => {
    try {
      const ensured = ensureSampleScriptCommand();
      await shell.openPath(ensured.scriptsDir);
      return {
        success: true,
        folderPath: ensured.scriptsDir,
        createdSample: ensured.created,
      };
    } catch (error: any) {
      console.error('Failed to open custom scripts folder:', error);
      return {
        success: false,
        folderPath: '',
        createdSample: false,
      };
    }
  });

  // ─── IPC: OAuth Token Store ──────────────────────────────────────

  ipcMain.handle('oauth-get-token', (_event: any, provider: string) => {
    return getOAuthToken(provider);
  });

  ipcMain.handle('oauth-set-token', (_event: any, provider: string, token: { accessToken: string; tokenType?: string; scope?: string; expiresIn?: number; obtainedAt: string }) => {
    setOAuthToken(provider, token);
  });

  ipcMain.handle('oauth-remove-token', (_event: any, provider: string) => {
    removeOAuthToken(provider);
  });

  ipcMain.handle('oauth-logout', (_event: any, provider: string) => {
    removeOAuthToken(provider);
    // Notify the main launcher window to clear the in-memory token and reset the extension view
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oauth-logout', provider);
    }
  });

  ipcMain.handle('oauth-set-flow-active', (_event: any, active: boolean) => {
    setOAuthBlurHideSuppression(Boolean(active));
  });

  // ─── IPC: Open URL (for extensions) ─────────────────────────────

  ipcMain.handle('open-url', async (_event: any, target: string, application?: string) => {
    if (!target) return false;
    const rawTarget = String(target).trim();
    if (!rawTarget) return false;
    const appName = typeof application === 'string' ? application.trim() : '';

    if (rawTarget.startsWith('raycast://')) {
      const deepLink = parseRaycastDeepLink(rawTarget);
      if (!deepLink) {
        console.warn(`Unsupported Raycast deep link: ${rawTarget}`);
        return false;
      }

      if (deepLink.type === 'scriptCommand') {
        const script = getScriptCommandBySlug(deepLink.commandName);
        if (!script) {
          console.warn(`Script command deeplink target not found: ${deepLink.commandName}`);
          return false;
        }
        try {
          await showWindow();
          const payload = JSON.stringify({
            commandId: script.id,
            arguments: deepLink.arguments || [],
            source: 'deeplink',
          });
          await mainWindow?.webContents.executeJavaScript(
            `window.dispatchEvent(new CustomEvent('sc-run-script-command', { detail: ${payload} }));`,
            true
          );
          return true;
        } catch (e) {
          console.error(`Failed to launch script command deeplink: ${rawTarget}`, e);
          return false;
        }
      }

      try {
        const bundle = await buildLaunchBundle({
          extensionName: deepLink.extensionName,
          commandName: deepLink.commandName,
          args: deepLink.arguments,
          type: deepLink.launchType || 'userInitiated',
          fallbackText: deepLink.fallbackText || null,
        });
        await showWindow();
        const payload = JSON.stringify({
          bundle,
          launchOptions: { type: bundle.launchType || 'userInitiated' },
          source: {
            commandMode: 'deeplink',
            extensionName: bundle.extensionName,
            commandName: bundle.commandName,
          },
        });
        await mainWindow?.webContents.executeJavaScript(
          `window.dispatchEvent(new CustomEvent('sc-launch-extension-bundle', { detail: ${payload} }));`,
          true
        );
        return true;
      } catch (e) {
        console.error(`Failed to launch Raycast deep link: ${rawTarget}`, e);
        return false;
      }
    }

    return await openTargetWithApplication(rawTarget, appName);
  });

  // ─── IPC: Extension Runner ───────────────────────────────────────

  ipcMain.handle(
    'run-extension',
    async (_event: any, extName: string, cmdName: string) => {
      try {
        // Read the pre-built bundle (built at install time), or build on-demand
        const result = await getExtensionBundle(extName, cmdName);
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
        const errorMsg = e?.message || 'Unknown error';
        const stack = e?.stack || '';
        console.error(`run-extension error for ${extName}/${cmdName}:`, e);
        const settings = loadSettings();
        return {
          error: settings.debugMode
            ? `[${extName}/${cmdName}] ${errorMsg}\n\n${stack}`
            : `Extension load failed: ${errorMsg}`,
        };
      }
    }
  );

  // Run Raycast-style script command.
  ipcMain.handle(
    'run-script-command',
    async (
      _event: any,
      payload: {
        commandId: string;
        arguments?: Record<string, any>;
        background?: boolean;
      }
    ) => {
      try {
        const commandId = String(payload?.commandId || '').trim();
        if (!commandId) {
          return { success: false, error: 'commandId is required' };
        }

        const argumentValues =
          payload?.arguments && typeof payload.arguments === 'object'
            ? payload.arguments
            : {};
        const background = Boolean(payload?.background);

        const executed = await executeScriptCommand(commandId, argumentValues);
        if ('missingArguments' in executed) {
          return {
            success: false,
            needsArguments: true,
            commandId,
            argumentDefinitions: executed.command.arguments.map((arg) => ({
              name: arg.name,
              required: arg.required,
              type: arg.type,
              placeholder: arg.placeholder,
              title: arg.placeholder,
              data: arg.data,
            })),
            missingArguments: executed.missingArguments.map((arg) => arg.name),
            mode: executed.command.mode,
            title: executed.command.title,
          };
        }

        if (executed.mode === 'inline') {
          const settings = loadSettings();
          const metadata = { ...(settings.commandMetadata || {}) } as Record<string, { subtitle?: string }>;
          const subtitle =
            executed.exitCode === 0
              ? String(executed.firstLine || '').trim()
              : String(executed.lastLine || '').trim() || 'Script failed';
          if (subtitle) {
            metadata[executed.commandId] = { subtitle };
          } else {
            delete metadata[executed.commandId];
          }
          saveSettings({ commandMetadata: metadata });
          invalidateCache();
        }

        if (!background && (executed.mode === 'compact' || executed.mode === 'silent')) {
          const fallback = executed.exitCode === 0 ? 'Script finished.' : 'Script failed.';
          const message = executed.message || fallback;
          console.log(`[ScriptCommand] ${executed.title}: ${message}`);
        }

        return {
          success: executed.exitCode === 0,
          ...executed,
        };
      } catch (error: any) {
        console.error('run-script-command error:', error);
        return {
          success: false,
          error: error?.message || 'Failed to run script command',
        };
      }
    }
  );

  // Get parsed extension manifest settings schema (preferences + commands)
  ipcMain.handle('get-installed-extensions-settings-schema', () => {
    return getInstalledExtensionsSettingsSchema();
  });

  // Launch command (for @raycast/api launchCommand)
  ipcMain.handle(
    'launch-command',
    async (_event: any, options: any) => {
      try {
        const {
          name,
          type,
          extensionName,
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

        const bundle = await buildLaunchBundle({
          extensionName,
          commandName: name,
          args: args || {},
          context,
          fallbackText: fallbackText ?? null,
          sourceExtensionName,
          sourcePreferences,
          type,
        });

        return {
          success: true,
          bundle
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
                const contentEncoding = String(res.headers['content-encoding'] || '').toLowerCase();
                let decodedBuffer = bodyBuffer;
                try {
                  const zlib = require('zlib');
                  if (contentEncoding.includes('br')) {
                    decodedBuffer = zlib.brotliDecompressSync(bodyBuffer);
                  } else if (contentEncoding.includes('gzip')) {
                    decodedBuffer = zlib.gunzipSync(bodyBuffer);
                  } else if (contentEncoding.includes('deflate')) {
                    decodedBuffer = zlib.inflateSync(bodyBuffer);
                  }
                } catch {
                  // If decompression fails, keep raw buffer to avoid hard-failing requests.
                  decodedBuffer = bodyBuffer;
                }
                const responseHeaders: Record<string, string> = {};
                for (const [key, val] of Object.entries(res.headers)) {
                  responseHeaders[key] = Array.isArray(val) ? val.join(', ') : String(val);
                }
                resolve({
                  status: res.statusCode,
                  statusText: res.statusMessage || '',
                  headers: responseHeaders,
                  bodyText: decodedBuffer.toString('utf-8'),
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
          // Augment PATH so extensions can find brew, npm, nvm, etc. even when
          // the app is launched from the Dock (where macOS strips the login PATH).
          const extraPaths = [
            '/opt/homebrew/bin', '/opt/homebrew/sbin',
            '/usr/local/bin', '/usr/local/sbin',
            '/usr/bin', '/usr/sbin', '/bin', '/sbin',
          ];
          const currentPath = (options?.env?.PATH ?? process.env.PATH ?? '');
          const augmentedPath = [
            ...extraPaths,
            ...currentPath.split(':').filter(Boolean),
          ].filter((v, i, a) => a.indexOf(v) === i).join(':');
          const spawnOptions: any = {
            shell: options?.shell ?? false,
            env: { ...process.env, ...options?.env, PATH: augmentedPath },
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

          // Timeout after 5 minutes — allows long-running commands (brew install, npm install, etc.)
          setTimeout(() => {
            try {
              proc.kill();
            } catch {}
            resolve({ stdout, stderr: stderr || 'Command timed out', exitCode: 124 });
          }, 300000);
        } catch (e: any) {
          resolve({ stdout: '', stderr: e?.message || 'Failed to execute command', exitCode: 1 });
        }
      });
    }
  );

  // Streaming spawn — runs a process and pushes stdout/stderr chunks to the renderer in real-time.
  // This is the generic fix for any extension that uses child_process.spawn with progressive output
  // (e.g. speedtest CLI outputting JSON lines, ffmpeg progress, etc.)
  {
    const spawnedProcesses = new Map<number, any>();

    ipcMain.handle(
      'spawn-process',
      (event: any, file: string, args: string[], options?: { shell?: boolean | string; env?: Record<string, string>; cwd?: string }) => {
        const { spawn } = require('child_process');
        const fs = require('fs');

        const resolveExecutablePath = (input: string): string => {
          if (!input || typeof input !== 'string') return input;
          if (!input.startsWith('/')) return input;
          if (fs.existsSync(input)) return input;
          return input;
        };

        const extraPaths = [
          '/opt/homebrew/bin', '/opt/homebrew/sbin',
          '/usr/local/bin', '/usr/local/sbin',
          '/usr/bin', '/usr/sbin', '/bin', '/sbin',
        ];
        const currentPath = (options?.env?.PATH ?? process.env.PATH ?? '');
        const augmentedPath = [
          ...extraPaths,
          ...currentPath.split(':').filter(Boolean),
        ].filter((v, i, a) => a.indexOf(v) === i).join(':');

        const resolvedFile = resolveExecutablePath(file);
        const spawnOpts: any = {
          shell: options?.shell ?? false,
          env: { ...process.env, ...options?.env, PATH: augmentedPath },
          cwd: options?.cwd || process.cwd(),
        };

        const proc = options?.shell
          ? spawn([resolvedFile, ...(args || [])].join(' '), [], { ...spawnOpts, shell: true })
          : spawn(resolvedFile, args || [], spawnOpts);

        const pid: number = proc.pid ?? -1;
        if (pid !== -1) spawnedProcesses.set(pid, proc);

        const sender = event.sender;
        const safeSend = (channel: string, ...sendArgs: any[]) => {
          try { if (!sender.isDestroyed()) sender.send(channel, ...sendArgs); } catch {}
        };
        let finalized = false;
        let sequence = 0;
        const nextSeq = () => sequence++;
        const safeSendSpawnEvent = (payload: Record<string, any>) => {
          safeSend('spawn-event', payload);
        };
        const finalize = () => {
          if (finalized) return false;
          finalized = true;
          return true;
        };

        proc.stdout?.on('data', (data: Buffer) => {
          const bytes = new Uint8Array(data);
          const seq = nextSeq();
          safeSendSpawnEvent({ pid, seq, type: 'stdout', data: bytes });
          // Legacy channels kept for compatibility with older renderer code.
          safeSend('spawn-stdout', pid, bytes);
        });
        proc.stderr?.on('data', (data: Buffer) => {
          const bytes = new Uint8Array(data);
          const seq = nextSeq();
          safeSendSpawnEvent({ pid, seq, type: 'stderr', data: bytes });
          // Legacy channels kept for compatibility with older renderer code.
          safeSend('spawn-stderr', pid, bytes);
        });
        proc.on('close', (code: number | null) => {
          if (!finalize()) return;
          spawnedProcesses.delete(pid);
          const exitCode = code ?? 0;
          const seq = nextSeq();
          safeSendSpawnEvent({ pid, seq, type: 'exit', code: exitCode });
          // Legacy channels kept for compatibility with older renderer code.
          safeSend('spawn-exit', pid, exitCode);
        });
        proc.on('error', (err: Error) => {
          if (!finalize()) return;
          spawnedProcesses.delete(pid);
          const message = err.message;
          const seq = nextSeq();
          safeSendSpawnEvent({ pid, seq, type: 'error', message });
          // Legacy channels kept for compatibility with older renderer code.
          safeSend('spawn-error', pid, message);
        });

        return { pid };
      }
    );

    ipcMain.handle('spawn-kill', (_event: any, pid: number) => {
      const proc = spawnedProcesses.get(pid);
      if (proc) {
        try { proc.kill(); } catch {}
        spawnedProcesses.delete(pid);
      }
    });
  }

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
        const extraPaths = [
          '/opt/homebrew/bin', '/opt/homebrew/sbin',
          '/usr/local/bin', '/usr/local/sbin',
          '/usr/bin', '/usr/sbin', '/bin', '/sbin',
        ];
        const currentPath = (options?.env?.PATH ?? process.env.PATH ?? '');
        const augmentedPath = [
          ...extraPaths,
          ...currentPath.split(':').filter(Boolean),
        ].filter((v, i, a) => a.indexOf(v) === i).join(':');
        const spawnOptions: any = {
          shell: options?.shell ?? false,
          env: { ...process.env, ...options?.env, PATH: augmentedPath },
          cwd: options?.cwd || process.cwd(),
          input: options?.input,
          encoding: 'utf-8',
          timeout: 60000, // 60 s for sync operations (longer ops should use async exec)
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

  // Download a URL to a binary buffer via Node.js (bypasses CORS — renderer fetch cannot
  // download from CDNs that don't send CORS headers, but Node.js has no such restriction).
  // Returns a Uint8Array which IPC transmits via structured clone without encoding overhead.
  ipcMain.handle('http-download-binary', async (_event: any, url: string) => {
    const https = require('https');
    const http = require('http');
    const { execFile } = require('child_process');
    const REQUEST_TIMEOUT_MS = 30_000;

    const downloadUrl = async (targetUrl: string, redirectCount = 0): Promise<Uint8Array> => {
      if (redirectCount > 10) throw new Error('Too many redirects');
      const parsed = new URL(targetUrl);

      return new Promise((resolve, reject) => {
        const client = parsed.protocol === 'https:' ? https : http;
        const req = client.get(
          parsed.toString(),
          {
            headers: {
              'User-Agent': 'SuperCmd/1.0 (+https://github.com/raycast/extensions)',
              Accept: '*/*',
            },
          },
          (res: any) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              const redirectUrl = new URL(res.headers.location, parsed).toString();
              downloadUrl(redirectUrl, redirectCount + 1).then(resolve, reject);
              return;
            }
            if (res.statusCode !== 200) {
              res.resume();
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
            res.on('error', reject);
          }
        );

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
          req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
        });
        req.on('error', reject);
      });
    };

    const downloadWithCurlFallback = async (): Promise<Uint8Array> => {
      try {
        return await downloadUrl(url);
      } catch (primaryErr: any) {
        const curlOutput = await new Promise<Uint8Array>((resolve, reject) => {
          execFile(
            '/usr/bin/curl',
            [
              '-fsSL',
              '--connect-timeout',
              '10',
              '--max-time',
              '60',
              url,
            ],
            { encoding: null, maxBuffer: 100 * 1024 * 1024 },
            (err: Error | null, stdout: Buffer, stderr: Buffer | string) => {
              if (err) {
                const stderrText = typeof stderr === 'string' ? stderr : String(stderr || '');
                reject(
                  new Error(
                    `HTTP download failed (${primaryErr?.message || 'unknown'}) and curl fallback failed (${stderrText || err.message})`
                  )
                );
                return;
              }
              resolve(new Uint8Array(stdout));
            }
          );
        });
        return curlOutput;
      }
    };

    return downloadWithCurlFallback();
  });

  // Write raw binary data to a real file path (extensions use this for CLI tool downloads)
  ipcMain.handle('fs-write-binary-file', async (_event: any, filePath: string, data: Uint8Array) => {
    const fs = require('fs');
    const nodePath = require('path');
    await fs.promises.mkdir(nodePath.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, Buffer.from(data));
  });

  // Get installed applications
  ipcMain.handle('get-applications', async (_event: any, targetPath?: string) => {
    const { execFileSync } = require('child_process');
    const fsNative = require('fs');

    const resolveBundleId = (appPath: string): string | undefined => {
      try {
        const plistPath = path.join(appPath, 'Contents', 'Info.plist');
        if (!fsNative.existsSync(plistPath)) return undefined;
        const out = execFileSync(
          '/usr/bin/plutil',
          ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plistPath],
          { encoding: 'utf-8' }
        ).trim();
        return out || undefined;
      } catch {
        try {
          const out = execFileSync(
            '/usr/bin/mdls',
            ['-name', 'kMDItemCFBundleIdentifier', '-raw', appPath],
            { encoding: 'utf-8' }
          ).trim();
          if (!out || out === '(null)') return undefined;
          return out;
        } catch {
          return undefined;
        }
      }
    };

    const commands = await getAvailableCommands();
    let apps = commands
      .filter((c) => c.category === 'app')
      .map((c) => ({
        name: c.title,
        path: c.path || '',
        bundleId: c.path ? resolveBundleId(c.path) : undefined,
        iconDataUrl: typeof c.iconDataUrl === 'string' ? c.iconDataUrl : undefined,
      }));

    // Raycast API compatibility: if path is provided, return only apps that can open it.
    if (targetPath && typeof targetPath === 'string') {
      try {
        const appPath = execFileSync(
          '/usr/bin/osascript',
          [
            '-l',
            'AppleScript',
            '-e',
            `use framework "AppKit"
set fileURL to current application's NSURL's fileURLWithPath:"${targetPath.replace(/"/g, '\\"')}"
set appURL to current application's NSWorkspace's sharedWorkspace()'s URLForApplicationToOpenURL:fileURL
if appURL is missing value then return ""
return appURL's |path|() as text`,
          ],
          { encoding: 'utf-8' }
        ).trim();

        if (appPath) {
          apps = apps.filter((a) => a.path === appPath);
        } else {
          apps = [];
        }
      } catch {
        apps = [];
      }
    }

    return apps;
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
      return { name: 'SuperCmd', path: '', bundleId: 'com.supercmd' };
    }
  });

  // Run AppleScript
  ipcMain.handle('run-applescript', async (_event: any, script: string) => {
    try {
      const { spawnSync } = require('child_process');
      const proc = spawnSync('/usr/bin/osascript', ['-l', 'AppleScript'], {
        input: script,
        encoding: 'utf-8',
      });

      if (proc.status !== 0) {
        const stderr = (proc.stderr || '').trim() || 'AppleScript execution failed';
        throw new Error(stderr);
      }

      const result = proc.stdout || '';
      return result.trim();
    } catch (e: any) {
      console.error('AppleScript error:', e);
      throw new Error(e?.message || 'AppleScript execution failed');
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
      event.returnValue = {
        exists: true,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        size: stat.size,
        mode: stat.mode,
        uid: stat.uid,
        gid: stat.gid,
        dev: stat.dev,
        ino: stat.ino,
        nlink: stat.nlink,
        atimeMs: stat.atimeMs,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        birthtimeMs: stat.birthtimeMs,
      };
    } catch {
      event.returnValue = {
        exists: false,
        isDirectory: false,
        isFile: false,
        size: 0,
        mode: 0,
        uid: 0,
        gid: 0,
        dev: 0,
        ino: 0,
        nlink: 0,
        atimeMs: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        birthtimeMs: 0,
      };
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

  ipcMain.handle('file-search-query', async (_event: any, query: string, options?: { limit?: number }) => {
    return await searchIndexedFiles(query, { limit: Number(options?.limit) || undefined });
  });

  ipcMain.handle('file-search-status', () => {
    return getFileSearchIndexStatus();
  });

  ipcMain.handle('file-search-refresh', async (_event: any, reason?: string) => {
    await rebuildFileSearchIndex(String(reason || 'manual'));
    return getFileSearchIndexStatus();
  });

  // Get system appearance
  ipcMain.handle('get-appearance', () => {
    try {
      return electron.nativeTheme?.shouldUseDarkColors ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
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
      if (!success) {
        throw new Error(`Failed to install extension "${name}". Check SuperCmd main-process logs for details.`);
      }
      // Invalidate command cache so new extensions appear in the launcher
      invalidateCache();
      broadcastExtensionsUpdated();
      return true;
    }
  );

  ipcMain.handle(
    'uninstall-extension',
    async (_event: any, name: string) => {
      const success = await uninstallExtension(name);
      if (success) {
        // Invalidate command cache so removed extensions disappear
        invalidateCache();
        broadcastExtensionsUpdated();
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

    return await hideAndPaste();
  });

  ipcMain.handle('clipboard-set-enabled', (_event: any, enabled: boolean) => {
    setClipboardMonitorEnabled(enabled);
  });

  // ── Helper: write a GIF file to macOS pasteboard with proper UTIs ──
  // Uses Swift to access NSPasteboard directly and write:
  //  1. File URL (public.file-url) — apps like Twitter/Slack/Discord detect
  //     a .gif file and upload it with animation preserved.
  //  2. Raw GIF data (com.compuserve.gif) — for apps that read image data.
  //  3. TIFF fallback (public.tiff) — for apps that only support static images.
  function writeGifToClipboard(filePath: string): boolean {
    try {
      const { execFileSync } = require('child_process') as typeof import('child_process');
      const swift = `
import Cocoa
let filePath = CommandLine.arguments[1]
let fileUrl = URL(fileURLWithPath: filePath)
guard let gifData = try? Data(contentsOf: fileUrl) else { exit(1) }
let image = NSImage(data: gifData)
let pb = NSPasteboard.general
pb.clearContents()
pb.writeObjects([fileUrl as NSURL])
pb.addTypes([NSPasteboard.PasteboardType("com.compuserve.gif"), .tiff], owner: nil)
pb.setData(gifData, forType: NSPasteboard.PasteboardType("com.compuserve.gif"))
if let tiff = image?.tiffRepresentation {
    pb.setData(tiff, forType: .tiff)
}
`;
      execFileSync('swift', ['-e', swift, filePath], { stdio: 'ignore', timeout: 10_000 });
      return true;
    } catch (e) {
      console.error('writeGifToClipboard swift failed:', e);
      return false;
    }
  }

  // Focus-safe clipboard APIs for extension/runtime shims.
  ipcMain.handle('clipboard-write', (_event: any, payload: { text?: string; html?: string; file?: string }) => {
    try {
      const text = payload?.text || '';
      const html = payload?.html || '';
      const file = String(payload?.file || '').trim();
      if (file) {
        const fs = require('fs') as typeof import('fs');
        let normalizedFile = file;
        if (normalizedFile.startsWith('file://')) {
          try {
            const { fileURLToPath } = require('url') as typeof import('url');
            normalizedFile = fileURLToPath(normalizedFile);
          } catch {}
        }
        if (normalizedFile.startsWith('~')) {
          normalizedFile = path.join(app.getPath('home'), normalizedFile.slice(1));
        }
        normalizedFile = path.resolve(normalizedFile);

        if (fs.existsSync(normalizedFile)) {
          const ext = path.extname(normalizedFile).toLowerCase();
          const IMAGE_EXTENSIONS: Record<string, string> = {
            '.gif': 'com.compuserve.gif',
            '.png': 'public.png',
            '.jpg': 'public.jpeg',
            '.jpeg': 'public.jpeg',
            '.webp': 'org.webmproject.webp',
            '.bmp': 'com.microsoft.bmp',
            '.tiff': 'public.tiff',
            '.tif': 'public.tiff',
            '.heic': 'public.heic',
          };
          const imageUti = IMAGE_EXTENSIONS[ext];

          if (imageUti && process.platform === 'darwin') {
            // For image files, write the raw image data to the clipboard
            // so pasting works in chat apps, editors, etc.
            try {
              // GIFs need special handling: write both com.compuserve.gif and
              // public.tiff via NSPasteboard so GIF-aware apps get animation
              // and other apps get a static frame.
              if (ext === '.gif') {
                if (writeGifToClipboard(normalizedFile)) return true;
              }
              const rawData = fs.readFileSync(normalizedFile);
              systemClipboard.clear();
              systemClipboard.writeBuffer(imageUti, rawData);
              // For non-GIF images, also write a PNG fallback.
              if (ext !== '.gif') {
                const fallbackImage = nativeImage.createFromPath(normalizedFile);
                if (!fallbackImage.isEmpty()) {
                  systemClipboard.writeBuffer('public.png', fallbackImage.toPNG());
                }
              }
              return true;
            } catch (imgErr) {
              console.error('clipboard-write image buffer failed, falling back:', imgErr);
            }
          }

          if (process.platform === 'darwin') {
            // Non-image files: copy as file reference
            try {
              const { execFileSync } = require('child_process') as typeof import('child_process');
              const script = `set the clipboard to (POSIX file ${JSON.stringify(normalizedFile)})`;
              execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
              return true;
            } catch {
              try {
                const { pathToFileURL } = require('url') as typeof import('url');
                const fileUrl = pathToFileURL(normalizedFile).toString();
                systemClipboard.clear();
                systemClipboard.writeBuffer('public.file-url', Buffer.from(`${fileUrl}\0`, 'utf8'));
                return true;
              } catch {}
            }
          }

          const image = nativeImage.createFromPath(normalizedFile);
          if (!image.isEmpty()) {
            systemClipboard.writeImage(image);
          } else if (html) {
            systemClipboard.write({ text: text || normalizedFile, html });
          } else {
            systemClipboard.writeText(text || normalizedFile);
          }
          return true;
        }
      }

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

  ipcMain.handle('get-selected-text', async () => {
    const fresh = String(await getSelectedTextForSpeak() || '');
    if (fresh.trim().length > 0) {
      rememberSelectionSnapshot(fresh);
      return fresh;
    }
    const recent = getRecentSelectionSnapshot();
    if (recent.trim().length > 0) return recent;
    return String(lastCursorPromptSelection || '');
  });

  ipcMain.handle('get-selected-text-strict', async () => {
    const fresh = String(await getSelectedTextForSpeak() || '');
    if (fresh.trim().length > 0) {
      rememberSelectionSnapshot(fresh);
      return fresh;
    }
    return String(getRecentSelectionSnapshot() || '');
  });

  ipcMain.handle(
    'memory-add',
    async (
      _event: any,
      payload: { text: string; userId?: string; source?: string; metadata?: Record<string, any> }
    ) => {
      const text = String(payload?.text || '').trim();
      if (!text) {
        void showMemoryStatusBar('error', 'No selected text found.');
        return { success: false, error: 'No selected text found.' };
      }
      void showMemoryStatusBar('processing', 'Adding to memory...');
      return await addMemory(loadSettings(), {
        text,
        userId: payload?.userId,
        source: payload?.source || 'launcher-selection',
        metadata: payload?.metadata,
      }).then((result) => {
        if (result?.success) {
          void showMemoryStatusBar('success', 'Added to memory.');
        } else {
          void showMemoryStatusBar('error', result?.error || 'Failed to add to memory.');
        }
        return result;
      });
    }
  );

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

    return await hideAndPaste();
  });

  ipcMain.handle('snippet-paste-resolved', async (_event: any, id: string, dynamicValues?: Record<string, string>) => {
    const success = copySnippetToClipboardResolved(id, dynamicValues);
    if (!success) return false;

    return await hideAndPaste();
  });

  ipcMain.handle('snippet-import', async (event: any) => {
    suppressBlurHide = true;
    try {
      const result = await importSnippetsFromFile(getDialogParentWindow(event));
      refreshSnippetExpander();
      return result;
    } finally {
      suppressBlurHide = false;
    }
  });

  ipcMain.handle('snippet-export', async (event: any) => {
    suppressBlurHide = true;
    try {
      return await exportSnippetsToFile(getDialogParentWindow(event));
    } finally {
      suppressBlurHide = false;
    }
  });

  // ─── IPC: Quick Link Manager ───────────────────────────────────

  ipcMain.handle('quicklink-get-all', () => {
    return getAllQuickLinks();
  });

  ipcMain.handle('quicklink-search', (_event: any, query: string) => {
    return searchQuickLinks(query);
  });

  ipcMain.handle('quicklink-get-dynamic-fields', (_event: any, id: string) => {
    return getQuickLinkDynamicFieldsById(id);
  });

  ipcMain.handle('quicklink-create', (_event: any, data: any) => {
    const created = createQuickLink(data || {});
    invalidateCache();
    broadcastCommandsUpdated();
    return created;
  });

  ipcMain.handle('quicklink-update', (_event: any, id: string, data: any) => {
    const updated = updateQuickLink(id, data || {});
    if (updated) {
      invalidateCache();
      broadcastCommandsUpdated();
    }
    return updated;
  });

  ipcMain.handle('quicklink-delete', (_event: any, id: string) => {
    const removed = deleteQuickLink(id);
    if (removed) {
      invalidateCache();
      broadcastCommandsUpdated();
    }
    return removed;
  });

  ipcMain.handle('quicklink-duplicate', (_event: any, id: string) => {
    const duplicated = duplicateQuickLink(id);
    if (duplicated) {
      invalidateCache();
      broadcastCommandsUpdated();
    }
    return duplicated;
  });

  ipcMain.handle('quicklink-open', async (_event: any, id: string, dynamicValues?: Record<string, string>) => {
    return await openQuickLinkById(id, dynamicValues);
  });

  ipcMain.handle('paste-text', async (_event: any, text: string) => {
    const nextText = String(text || '');
    if (!nextText) return false;

    const previousClipboardText = systemClipboard.readText();
    try {
      systemClipboard.writeText(nextText);
      let pasted = await hideAndPaste();
      if (!pasted) {
        await activateLastFrontmostApp();
        await new Promise((resolve) => setTimeout(resolve, 120));
        pasted = await typeTextDirectly(nextText);
      }
      setTimeout(() => {
        try {
          systemClipboard.writeText(previousClipboardText);
        } catch {}
      }, 500);
      return pasted;
    } catch (error) {
      console.error('paste-text failed:', error);
      return false;
    }
  });

  // Paste a file (image/GIF) into the previously focused app.
  // Writes file data to clipboard, hides SuperCmd, and simulates Cmd+V,
  // then restores the previous clipboard contents.
  ipcMain.handle('paste-file', async (_event: any, filePath: string) => {
    const fs = require('fs') as typeof import('fs');
    const normalizedFile = path.resolve(String(filePath || ''));
    if (!normalizedFile || !fs.existsSync(normalizedFile)) return false;

    // Save previous clipboard state to restore after pasting
    const previousText = systemClipboard.readText();
    const previousImage = systemClipboard.readImage();
    const hadImage = !previousImage.isEmpty();

    // Pause clipboard monitor so the temporary clipboard writes
    // (file data → paste → restore) don't create duplicate history entries.
    setClipboardMonitorEnabled(false);

    try {
      const ext = path.extname(normalizedFile).toLowerCase();
      const IMAGE_EXTENSIONS: Record<string, string> = {
        '.gif': 'com.compuserve.gif',
        '.png': 'public.png',
        '.jpg': 'public.jpeg',
        '.jpeg': 'public.jpeg',
        '.webp': 'org.webmproject.webp',
      };
      const imageUti = IMAGE_EXTENSIONS[ext];

      if (ext === '.gif') {
        writeGifToClipboard(normalizedFile);
      } else if (imageUti) {
        const rawData = fs.readFileSync(normalizedFile);
        systemClipboard.clear();
        systemClipboard.writeBuffer(imageUti, rawData);
        const fallbackImage = nativeImage.createFromPath(normalizedFile);
        if (!fallbackImage.isEmpty()) {
          systemClipboard.writeBuffer('public.png', fallbackImage.toPNG());
        }
      } else {
        const { execFileSync } = require('child_process') as typeof import('child_process');
        const script = `set the clipboard to (POSIX file ${JSON.stringify(normalizedFile)})`;
        execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
      }

      const pasted = await hideAndPaste();

      // Restore previous clipboard after a short delay, then re-enable monitor
      setTimeout(() => {
        try {
          if (hadImage) {
            systemClipboard.writeImage(previousImage);
          } else {
            systemClipboard.writeText(previousText);
          }
        } catch {}
        // Re-enable after another short delay so the restore isn't picked up
        setTimeout(() => setClipboardMonitorEnabled(true), 500);
      }, 500);

      return pasted;
    } catch (error) {
      console.error('paste-file failed:', error);
      setClipboardMonitorEnabled(true);
      return false;
    }
  });

  ipcMain.handle('type-text-live', async (_event: any, text: string) => {
    const nextText = String(text || '');
    if (!nextText) return false;
    console.log('[Whisper][type-live]', JSON.stringify(nextText));
    await activateLastFrontmostApp();
    await new Promise((resolve) => setTimeout(resolve, 70));
    let typed = await typeTextDirectly(nextText);
    if (!typed) {
      typed = await pasteTextToActiveApp(nextText);
    }
    return typed;
  });

  ipcMain.handle('whisper-type-text-live', async (_event: any, text: string) => {
    const nextText = String(text || '');
    if (!nextText) {
      return { typed: false, fallbackClipboard: false };
    }

    await activateLastFrontmostApp();
    await new Promise((resolve) => setTimeout(resolve, 70));
    let typed = await pasteTextToActiveApp(nextText);
    if (!typed) {
      typed = await typeTextDirectly(nextText);
    }
    if (typed) {
      return { typed: true, fallbackClipboard: false };
    }
    return { typed: false, fallbackClipboard: false };
  });

  ipcMain.handle('replace-live-text', async (_event: any, previousText: string, nextText: string) => {
    console.log('[Whisper][replace-live]', JSON.stringify(previousText), '=>', JSON.stringify(nextText));
    await activateLastFrontmostApp();
    await new Promise((resolve) => setTimeout(resolve, 70));
    let replaced = await replaceTextDirectly(previousText, nextText);
    if (!replaced) {
      replaced = await replaceTextViaBackspaceAndPaste(previousText, nextText);
    }
    return replaced;
  });

  ipcMain.handle('prompt-apply-generated-text', async (_event: any, payload: { previousText?: string; nextText: string }) => {
    const previousText = String(payload?.previousText || '');
    const nextText = String(payload?.nextText || '');
    if (!nextText.trim()) return false;

    // Ensure prompt window is closed before typing/replacing so text is not inserted back into prompt UI.
    hidePromptWindow();
    await activateLastFrontmostApp();
    await new Promise((resolve) => setTimeout(resolve, 70));

    if (previousText.trim()) {
      // Use paste-based replacement first to preserve all newlines exactly.
      let replaced = await replaceTextViaBackspaceAndPaste(previousText, nextText);
      if (!replaced) {
        replaced = await replaceTextDirectly(previousText, nextText);
      }
      return replaced;
    }

    // Paste first so multiline responses keep exact line breaks.
    let typed = await pasteTextToActiveApp(nextText);
    if (!typed) {
      typed = await typeTextDirectly(nextText);
    }
    return typed;
  });

  ipcMain.on('whisper-debug-log', (_event: any, payload: { tag?: string; message?: string; data?: any }) => {
    const tag = String(payload?.tag || 'event');
    const message = String(payload?.message || '');
    const data = payload?.data;
    if (typeof data === 'undefined') {
      console.log(`[Whisper][${tag}] ${message}`);
      return;
    }
    console.log(`[Whisper][${tag}] ${message}`, data);
  });

  // ─── IPC: AI ───────────────────────────────────────────────────

  ipcMain.handle(
    'ai-ask',
    async (event: any, requestId: string, prompt: string, options?: { model?: string; creativity?: number; systemPrompt?: string }) => {
      const s = loadSettings();
      if (s.ai?.llmEnabled === false) {
        event.sender.send('ai-stream-error', { requestId, error: 'LLM is disabled in Settings → AI.' });
        return;
      }
      if (!isAIAvailable(s.ai)) {
        event.sender.send('ai-stream-error', { requestId, error: 'AI is not configured. Please set up an API key in Settings → AI.' });
        return;
      }

      const controller = new AbortController();
      activeAIRequests.set(requestId, controller);

      try {
        const memoryContextSystemPrompt = await buildMemoryContextSystemPrompt(
          s,
          String(prompt || ''),
          { limit: 6 }
        );
        const mergedSystemPrompt = [options?.systemPrompt, memoryContextSystemPrompt]
          .filter((part) => typeof part === 'string' && part.trim().length > 0)
          .join('\n\n');

        const gen = streamAI(s.ai, {
          prompt,
          model: options?.model,
          creativity: options?.creativity,
          systemPrompt: mergedSystemPrompt || undefined,
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
    if (s.ai?.llmEnabled === false) return false;
    return isAIAvailable(s.ai);
  });

  ipcMain.handle('whisper-refine-transcript', async (_event: any, transcript: string) => {
    const s = loadSettings();
    if (isAIDisabledInSettings(s) || s.ai?.llmEnabled === false || s.ai?.whisperEnabled === false) {
      return { correctedText: String(transcript || ''), source: 'raw' as const };
    }
    return await refineWhisperTranscript(transcript);
  });

  ipcMain.handle(
    'whisper-transcribe',
    async (_event: any, audioArrayBuffer: ArrayBuffer, options?: { language?: string; mimeType?: string }) => {
      const s = loadSettings();
      if (isAIDisabledInSettings(s)) {
        throw new Error('AI is disabled. Enable AI in Settings -> AI to use Whisper.');
      }
      if (s.ai?.whisperEnabled === false) {
        throw new Error('SuperCmd Whisper is disabled in Settings -> AI.');
      }

      // Parse speechToTextModel to a concrete provider model.
      let provider: 'openai' | 'elevenlabs' = 'openai';
      let model = 'gpt-4o-transcribe';
      const sttModel = s.ai.speechToTextModel || '';
      if (!sttModel || sttModel === 'default') {
        provider = 'openai';
        model = 'gpt-4o-transcribe';
      } else if (sttModel === 'native') {
        // Renderer should not call cloud transcription in native mode.
        // Return empty transcript instead of surfacing an IPC error.
        return '';
      } else if (sttModel.startsWith('openai-')) {
        provider = 'openai';
        model = sttModel.slice('openai-'.length);
      } else if (sttModel.startsWith('elevenlabs-')) {
        provider = 'elevenlabs';
        model = resolveElevenLabsSttModel(sttModel);
      } else if (sttModel) {
        model = sttModel;
      }

      if (provider === 'openai' && !s.ai.openaiApiKey) {
        throw new Error('OpenAI API key not configured. Go to Settings -> AI to set it up.');
      }
      const elevenLabsApiKey = getElevenLabsApiKey(s);
      if (provider === 'elevenlabs' && !elevenLabsApiKey) {
        throw new Error('ElevenLabs API key not configured. Set it in Settings -> AI (or ELEVENLABS_API_KEY env var).');
      }

      // Convert BCP-47 (e.g. 'en-US') to ISO-639-1 (e.g. 'en')
      const rawLang = options?.language || s.ai.speechLanguage || 'en-US';
      const language = rawLang.split('-')[0].toLowerCase() || 'en';
      const mimeType = options?.mimeType;

      const audioBuffer = Buffer.from(audioArrayBuffer);

      console.log(`[Whisper] Transcribing ${audioBuffer.length} bytes, provider=${provider}, model=${model}, lang=${language}, mime=${mimeType || 'unknown'}`);

      const text = provider === 'elevenlabs'
        ? await transcribeAudioWithElevenLabs({
            audioBuffer,
            apiKey: elevenLabsApiKey,
            model,
            language,
            mimeType,
          })
        : await transcribeAudio({
            audioBuffer,
            apiKey: s.ai.openaiApiKey,
            model,
            language,
            mimeType,
          });

      console.log(`[Whisper] Transcription result: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);
      return text;
    }
  );

  // ─── IPC: Native Speech Recognition (macOS SFSpeechRecognizer) ──

  ipcMain.handle(
    'whisper-start-native',
    async (
      event: any,
      language?: string,
      options?: {
        singleUtterance?: boolean;
      }
    ) => {
    if (isAIDisabledInSettings()) {
      throw new Error('AI is disabled. Enable AI in Settings -> AI to use Whisper.');
    }
    // Kill any existing process
    if (nativeSpeechProcess) {
      try { nativeSpeechProcess.kill('SIGTERM'); } catch {}
      nativeSpeechProcess = null;
      nativeSpeechStdoutBuffer = '';
    }

    const lang = language || loadSettings().ai.speechLanguage || 'en-US';
    const binaryPath = getNativeBinaryPath('speech-recognizer');
    const fs = require('fs');

    // Compile on demand (same pattern as color-picker / snippet-expander)
    if (!fs.existsSync(binaryPath)) {
      try {
        const { execFileSync } = require('child_process');
        const sourcePath = path.join(app.getAppPath(), 'src', 'native', 'speech-recognizer.swift');
        execFileSync('swiftc', [
          '-O', '-o', binaryPath, sourcePath,
          '-framework', 'Speech',
          '-framework', 'AVFoundation',
        ]);
        console.log('[Whisper][native] Compiled speech-recognizer binary');
      } catch (error) {
        console.error('[Whisper][native] Compile failed:', error);
        throw new Error('Failed to compile native speech recognizer. Ensure Xcode Command Line Tools are installed.');
      }
    }

    const { spawn } = require('child_process');
    const args: string[] = [lang];
    if (options?.singleUtterance) {
      args.push('--single-utterance');
    }

    nativeSpeechProcess = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    nativeSpeechStdoutBuffer = '';
    console.log(`[Whisper][native] Started speech-recognizer (lang=${lang})`);

    nativeSpeechProcess.stdout.on('data', (chunk: Buffer | string) => {
      nativeSpeechStdoutBuffer += chunk.toString();
      const lines = nativeSpeechStdoutBuffer.split('\n');
      nativeSpeechStdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const payload = JSON.parse(trimmed);
          // Forward to renderer
          event.sender.send('whisper-native-chunk', payload);
        } catch {
          // ignore malformed lines
        }
      }
    });

    nativeSpeechProcess.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim();
      if (text) console.warn('[Whisper][native]', text);
    });

    nativeSpeechProcess.on('exit', (code: number | null) => {
      console.log(`[Whisper][native] Process exited (code=${code})`);
      nativeSpeechProcess = null;
      nativeSpeechStdoutBuffer = '';
      // Notify renderer that native recognition ended
      try { event.sender.send('whisper-native-chunk', { ended: true }); } catch {}
    });
    }
  );

  ipcMain.handle('whisper-stop-native', async () => {
    if (nativeSpeechProcess) {
      try { nativeSpeechProcess.kill('SIGTERM'); } catch {}
      nativeSpeechProcess = null;
      nativeSpeechStdoutBuffer = '';
    }
  });

  // ─── IPC: Ollama Model Management ──────────────────────────────

  function resolveOllamaBaseUrl(raw?: string): string {
    const fallback = 'http://localhost:11434';
    const input = (raw || fallback).trim();
    try {
      const normalized = new URL(input);
      return normalized.toString();
    } catch {
      return fallback;
    }
  }

  ipcMain.handle('ollama-status', async () => {
    const s = loadSettings();
    const configured = resolveOllamaBaseUrl(s.ai.ollamaBaseUrl);
    const candidates = Array.from(
      new Set([configured, 'http://127.0.0.1:11434', 'http://localhost:11434'])
    );

    const requestJson = (url: URL): Promise<{ statusCode: number; body: string } | null> =>
      new Promise((resolve) => {
        const mod = url.protocol === 'https:' ? require('https') : require('http');
        const req = mod.get(url.toString(), (res: any) => {
          let body = '';
          res.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
        });
        req.on('error', () => resolve(null));
        req.setTimeout(2500, () => {
          req.destroy();
          resolve(null);
        });
      });

    for (const baseUrl of candidates) {
      const tagsUrl = new URL('/api/tags', baseUrl);
      const tagsResult = await requestJson(tagsUrl);
      if (tagsResult && tagsResult.statusCode === 200) {
        try {
          const data = JSON.parse(tagsResult.body || '{}');
          return {
            running: true,
            models: (data.models || []).map((m: any) => ({
              name: m.name,
              size: m.size,
              parameterSize: m.details?.parameter_size || '',
              quantization: m.details?.quantization_level || '',
              modifiedAt: m.modified_at,
            })),
          };
        } catch {
          return { running: true, models: [] };
        }
      }

      const versionUrl = new URL('/api/version', baseUrl);
      const versionResult = await requestJson(versionUrl);
      if (versionResult && versionResult.statusCode === 200) {
        return { running: true, models: [] };
      }
    }

    return { running: false, models: [] };
  });

  ipcMain.handle(
    'ollama-pull',
    async (event: any, requestId: string, modelName: string) => {
      const s = loadSettings();
      const baseUrl = resolveOllamaBaseUrl(s.ai.ollamaBaseUrl);
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
    const baseUrl = resolveOllamaBaseUrl(s.ai.ollamaBaseUrl);
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
      const raw = await callWindowManagerWorker<any>('get-active-window');
      const win = normalizeNodeWindowInfo(raw);
      if (!win || isSelfManagedWindow(win)) return null;
      return toWindowManagementWindowFromNode(win, true);
    } catch (error) {
      if (!isTransientWindowManagerWorkerError(error)) {
        console.error('Failed to get active window:', error);
      }
      return null;
    }
  });

  ipcMain.handle('window-management-get-target-window', async () => {
    try {
      const snapshot = await getNodeSnapshot();
      if (snapshot.target) {
        return toWindowManagementWindowFromNode(snapshot.target, true);
      }
      return null;
    } catch (error) {
      if (!isTransientWindowManagerWorkerError(error)) {
        console.error('Failed to get target window:', error);
      }
      return null;
    }
  });

  ipcMain.handle('window-management-get-context', async () => {
    try {
      const snapshot = await getNodeSnapshot();
      const targetNode = snapshot.target;
      const target = targetNode ? toWindowManagementWindowFromNode(targetNode, true) : null;
      const { screen: electronScreen } = require('electron');
      let workArea = normalizeWindowManagementArea(targetNode?.workArea) || cloneWorkArea(windowManagementTargetWorkArea);
      const targetBounds = targetNode?.bounds;
      if (!workArea && targetBounds) {
        const normalizedBounds =
          Number.isFinite(targetBounds.x) &&
          Number.isFinite(targetBounds.y) &&
          Number.isFinite(targetBounds.width) &&
          Number.isFinite(targetBounds.height) &&
          targetBounds.width > 0 &&
          targetBounds.height > 0
            ? {
                x: Math.round(targetBounds.x),
                y: Math.round(targetBounds.y),
                width: Math.max(1, Math.round(targetBounds.width)),
                height: Math.max(1, Math.round(targetBounds.height)),
              }
            : null;
        if (normalizedBounds) {
          workArea = normalizeWindowManagementArea(
            electronScreen.getDisplayMatching(normalizedBounds)?.workArea
          );
        }
      }
      if (!workArea) {
        const fallbackDisplay = electronScreen.getDisplayNearestPoint(electronScreen.getCursorScreenPoint());
        workArea = normalizeWindowManagementArea(fallbackDisplay?.workArea);
      }
      if (targetNode?.id) {
        windowManagementTargetWindowId = String(targetNode.id);
      }
      windowManagementTargetWorkArea = cloneWorkArea(workArea);
      return { target, workArea };
    } catch (error) {
      if (!isTransientWindowManagerWorkerError(error)) {
        console.error('Failed to get window management context:', error);
      }
      return { target: null, workArea: null };
    }
  });

  ipcMain.handle('window-management-get-windows-on-active-desktop', async () => {
    try {
      const windows = await getNodeWindows();
      return windows.map((win) => toWindowManagementWindowFromNode(win, false)).filter(Boolean);
    } catch (error) {
      if (!isTransientWindowManagerWorkerError(error)) {
        console.error('Failed to get windows:', error);
      }
      return [];
    }
  });

  ipcMain.handle('window-management-snapshot', async () => {
    try {
      const snapshot = await getNodeSnapshot();
      const target = snapshot.target ? toWindowManagementWindowFromNode(snapshot.target, true) : null;
      const windows = snapshot.windows.map((win) => toWindowManagementWindowFromNode(win, false)).filter(Boolean);
      return { target, windows };
    } catch (error) {
      if (!isTransientWindowManagerWorkerError(error)) {
        console.error('Failed to get window snapshot:', error);
      }
      return { target: null, windows: [] };
    }
  });

  ipcMain.handle('window-management-get-desktops', async () => {
    try {
      // macOS doesn't expose virtual desktops (Spaces) easily via AppleScript
      // Return a minimal implementation
      const { screen } = require('electron');
      const displays = screen.getAllDisplays();
      const cursorPoint = screen.getCursorScreenPoint();
      const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);

      return displays.map((display: any, index: number) => ({
        id: String(index + 1),
        active: display.id === activeDisplay?.id,
        screenId: String(display.id),
        bounds: {
          x: Number(display.bounds?.x || 0),
          y: Number(display.bounds?.y || 0),
          width: Number(display.bounds?.width || 0),
          height: Number(display.bounds?.height || 0),
        },
        workArea: {
          x: Number(display.workArea?.x || display.bounds?.x || 0),
          y: Number(display.workArea?.y || display.bounds?.y || 0),
          width: Number(display.workArea?.width || display.bounds?.width || 0),
          height: Number(display.workArea?.height || display.bounds?.height || 0),
        },
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
      const { id, bounds, desktopId } = options || {};
      const normalizedId = String(id || '').trim();
      if (!normalizedId) return false;
      await ensureWindowManagerAccess();

      let nextEntry: QueuedWindowMutation | null = null;
      if (bounds === 'fullscreen') {
        const { screen: electronScreen } = require('electron');
        const display = electronScreen.getDisplayNearestPoint(electronScreen.getCursorScreenPoint());
        const area = display?.workArea || electronScreen.getPrimaryDisplay().workArea;
        nextEntry = {
          id: normalizedId,
          x: Math.round(Number(area?.x || 0)),
          y: Math.round(Number(area?.y || 0)),
          width: Math.max(1, Math.round(Number(area?.width || 1))),
          height: Math.max(1, Math.round(Number(area?.height || 1))),
        };
      } else {
        const position = bounds?.position || {};
        const size = bounds?.size || {};

        // If desktopId specifies a different display, offset position to that display.
        let offsetX = 0;
        let offsetY = 0;
        if (desktopId) {
          const { screen: electronScreen } = require('electron');
          const displays = electronScreen.getAllDisplays();
          const targetIndex = parseInt(desktopId, 10) - 1;
          if (targetIndex >= 0 && targetIndex < displays.length) {
            offsetX = displays[targetIndex].bounds.x;
            offsetY = displays[targetIndex].bounds.y;
          }
        }

        const win = await getNodeWindowById(normalizedId);
        const currentBounds = win?.bounds || null;
        const baseX = Number(currentBounds?.x ?? 0);
        const baseY = Number(currentBounds?.y ?? 0);
        const baseWidth = Number(currentBounds?.width ?? 400);
        const baseHeight = Number(currentBounds?.height ?? 300);

        const x = Number(position?.x ?? baseX) + offsetX;
        const y = Number(position?.y ?? baseY) + offsetY;
        const width = Number(size?.width ?? baseWidth);
        const height = Number(size?.height ?? baseHeight);

        if (![x, y, width, height].every((v) => Number.isFinite(v))) return false;
        nextEntry = {
          id: normalizedId,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
        };
      }

      if (!nextEntry) return false;
      return await queueWindowMutations([nextEntry]);
    } catch (error) {
      console.error('Failed to set window bounds:', error);
      return false;
    }
  });

  ipcMain.handle('window-management-set-window-layout', async (_event: any, items: WindowManagementLayoutItem[]) => {
    try {
      await ensureWindowManagerAccess();
      const normalized = (Array.isArray(items) ? items : [])
        .map((entry) => {
          const id = String(entry?.id || '').trim();
          const x = Number(entry?.bounds?.position?.x);
          const y = Number(entry?.bounds?.position?.y);
          const width = Number(entry?.bounds?.size?.width);
          const height = Number(entry?.bounds?.size?.height);
          if (!id) return null;
          if (![x, y, width, height].every((v) => Number.isFinite(v))) return null;
          return {
            id,
            x: Math.round(x),
            y: Math.round(y),
            width: Math.max(1, Math.round(width)),
            height: Math.max(1, Math.round(height)),
          };
        })
        .filter(Boolean) as QueuedWindowMutation[];

      if (normalized.length === 0) return false;
      return await queueWindowMutations(normalized);
    } catch (error) {
      console.error('Failed to set window layout:', error);
      return false;
    }
  });

  // ─── IPC: Native Color Picker ──────────────────────────────────

  ipcMain.handle('native-pick-color', async () => {
    if (nativeColorPickerPromise) {
      return nativeColorPickerPromise;
    }

    nativeColorPickerPromise = (async () => {
    const { execFile, execFileSync } = require('child_process');
    const fsNative = require('fs');
    const colorPickerPath = getNativeBinaryPath('color-picker');

    // Build on demand in development when binary artifacts are missing.
    if (!fsNative.existsSync(colorPickerPath)) {
      try {
        const sourceCandidates = [
          path.join(app.getAppPath(), 'src', 'native', 'color-picker.swift'),
          path.join(process.cwd(), 'src', 'native', 'color-picker.swift'),
          path.join(__dirname, '..', '..', 'src', 'native', 'color-picker.swift'),
        ];
        const sourcePath = sourceCandidates.find((candidate: string) => fsNative.existsSync(candidate));
        if (!sourcePath) {
          console.warn('[ColorPicker] Binary and source file not found.');
          return null;
        }
        fsNative.mkdirSync(path.dirname(colorPickerPath), { recursive: true });
        execFileSync('swiftc', ['-O', '-o', colorPickerPath, sourcePath, '-framework', 'AppKit']);
      } catch (error) {
        console.error('[ColorPicker] Failed to compile native helper:', error);
        return null;
      }
    }

    // Keep the launcher open while the native picker is focused.
    suppressBlurHide = true;
    try {
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
            const parsedColor = JSON.parse(trimmed);
            if (!parsedColor || typeof parsedColor !== 'object') {
              resolve(null);
              return;
            }

            const toUnitRange = (value: unknown): number | null => {
              const numeric = Number(value);
              if (!Number.isFinite(numeric)) return null;
              if (numeric > 1) {
                const normalized = numeric / 255;
                return Math.max(0, Math.min(1, normalized));
              }
              return Math.max(0, Math.min(1, numeric));
            };

            const red = toUnitRange((parsedColor as any).red);
            const green = toUnitRange((parsedColor as any).green);
            const blue = toUnitRange((parsedColor as any).blue);
            const alpha = toUnitRange((parsedColor as any).alpha ?? 1);
            if (red === null || green === null || blue === null || alpha === null) {
              resolve(null);
              return;
            }

            const colorSpace = typeof (parsedColor as any).colorSpace === 'string' && (parsedColor as any).colorSpace.trim()
              ? String((parsedColor as any).colorSpace)
              : 'srgb';

            resolve({ red, green, blue, alpha, colorSpace });
          } catch (e) {
            console.error('Failed to parse color picker output:', e);
            resolve(null);
          }
        });
      });
      return pickedColor;
    } finally {
      suppressBlurHide = false;
    }
    })();

    try {
      return await nativeColorPickerPromise;
    } finally {
      nativeColorPickerPromise = null;
    }
  });

  // ─── IPC: Native File Picker (for Form.FilePicker) ───────────────
  ipcMain.handle(
    'pick-files',
    async (
      event: any,
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
        const result = await dialog.showOpenDialog(getDialogParentWindow(event), {
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
      const bundle = await getExtensionBundle(cmd.extName, cmd.cmdName);
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
    const { extId, iconPath, iconDataUrl, iconEmoji, iconTemplate, fallbackIconDataUrl, title, tooltip, items } = data;

    let tray = menuBarTrays.get(extId);

    const createNativeImageFromMenuIcon = (payload: { pathValue?: string; dataUrlValue?: string }, size: number) => {
      try {
        const fs = require('fs');
        let image: any;
        const dataUrlValue = String(payload?.dataUrlValue || '').trim();
        const pathValue = String(payload?.pathValue || '').trim();
        if (dataUrlValue.startsWith('data:')) {
          image = nativeImage.createFromDataURL(dataUrlValue);
        } else {
          if (!pathValue || !fs.existsSync(pathValue)) return null;
          image = nativeImage.createFromPath(pathValue);
          if ((!image || image.isEmpty()) && /\.svg$/i.test(pathValue)) {
            const svg = fs.readFileSync(pathValue, 'utf8');
            const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
            image = nativeImage.createFromDataURL(svgDataUrl);
          }
        }
        if (!image || image.isEmpty()) return null;
        return image.resize({ width: size, height: size });
      } catch {
        return null;
      }
    };

    let lastResolvedTrayIconOk = false;
    const resolveTrayIcon = () => {
      const primaryImg = createNativeImageFromMenuIcon({ pathValue: iconPath, dataUrlValue: iconDataUrl }, 18);
      const usingPrimary = Boolean(primaryImg);
      const img =
        primaryImg ||
        createNativeImageFromMenuIcon({ dataUrlValue: fallbackIconDataUrl }, 18);
      lastResolvedTrayIconOk = Boolean(img);
      if (img) {
        // Raycast icon tokens are serialized as data URLs and should be template images
        // so macOS can adapt them to menu bar foreground contrast.
        const isGeneratedDataUrl = typeof iconDataUrl === 'string' && iconDataUrl.startsWith('data:');
        // Keep template rendering for bitmap assets (classic menubar style).
        // For SVG asset paths, preserve source appearance (e.g., explicit light/dark icon variants).
        const isSvg = /\.svg$/i.test(iconPath || '');
        const shouldTemplate =
          !usingPrimary
            ? false
            : (
                typeof iconTemplate === 'boolean'
                  ? iconTemplate
                  : (isGeneratedDataUrl ? true : !isSvg)
              );
        try {
          img.setTemplateImage(shouldTemplate);
        } catch {}
        return img;
      }
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
    } else if (!lastResolvedTrayIconOk) {
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

  ipcMain.on('menubar-remove', (_event: any, data: any) => {
    const extId = String(data?.extId || '').trim();
    if (!extId) return;
    const tray = menuBarTrays.get(extId);
    if (!tray) return;
    try {
      tray.destroy();
    } catch {}
    menuBarTrays.delete(extId);
  });

  // Route native menu clicks back to the renderer
  function buildMenuBarTemplate(items: any[], extId: string): any[] {
    const resolveMenuItemIcon = (item: any) => {
      const iconDataUrl = typeof item?.iconDataUrl === 'string' ? item.iconDataUrl.trim() : '';
      const iconPath = typeof item?.iconPath === 'string' ? item.iconPath : '';
      const explicitTemplate = typeof item?.iconTemplate === 'boolean' ? item.iconTemplate : undefined;
      try {
        let img: any;
        if (iconDataUrl.startsWith('data:')) {
          img = nativeImage.createFromDataURL(iconDataUrl);
        } else {
          if (!iconPath) return undefined;
          const fs = require('fs');
          if (!fs.existsSync(iconPath)) return undefined;
          img = nativeImage.createFromPath(iconPath);
          if ((!img || img.isEmpty()) && /\.svg$/i.test(iconPath)) {
            const svg = fs.readFileSync(iconPath, 'utf8');
            const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
            img = nativeImage.createFromDataURL(svgDataUrl);
          }
        }
        if (!img || img.isEmpty()) return undefined;
        const shouldTemplate =
          explicitTemplate ?? (iconDataUrl.startsWith('data:image/svg+xml') ? true : false);
        const resized = img.resize({ width: 16, height: 16 });
        try {
          resized.setTemplateImage(shouldTemplate);
        } catch {}
        return resized;
      } catch {}
      return undefined;
    };

    const labelWithEmoji = (item: any) => {
      const title = String(item?.title || '');
      const subtitle = String(item?.subtitle || '').trim();
      const text = [title, subtitle].filter(Boolean).join(' ').trim();
      const emoji = typeof item?.iconEmoji === 'string' ? item.iconEmoji.trim() : '';
      if (!emoji || emoji === '•') return text || title;
      if (!text) return emoji;
      return `${emoji} ${text}`;
    };

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
          const submenuIcon = resolveMenuItemIcon(item);
          template.push({
            label: labelWithEmoji(item),
            ...(submenuIcon ? { icon: submenuIcon } : {}),
            submenu: buildMenuBarTemplate(item.children || [], extId),
          });
          break;
        case 'item':
        default:
          const menuItemIcon = resolveMenuItemIcon(item);
          const disabled = Boolean(item?.disabled);
          template.push({
            label: labelWithEmoji(item),
            ...(menuItemIcon ? { icon: menuItemIcon } : {}),
            ...(disabled
              ? { enabled: false }
              : {
                  click: () => {
                    mainWindow?.webContents.send('menubar-item-click', { extId, itemId: item.id });
                  },
                }),
          });
          break;
      }
    }
    return template;
  }

  // ─── Window + Shortcuts ─────────────────────────────────────────

  createWindow();
  startInstalledAppsWatchers();
  schedulePromptWindowPrewarm();
  registerGlobalShortcut(settings.globalShortcut);
  registerCommandHotkeys(settings.commandHotkeys);
  registerDevToolsShortcut();

  // Fallback: when another SuperCmd window gains focus (e.g. Settings),
  // close the launcher in default mode even if a native blur event was missed.
  app.on('browser-window-focus', (_event: any, focusedWindow: InstanceType<typeof BrowserWindow>) => {
    if (!mainWindow || !isVisible) return;
    if (focusedWindow === mainWindow) return;
    if (suppressBlurHide) return;
    if (oauthBlurHideSuppressionDepth > 0) return;
    if (launcherMode !== 'default') return;
    hideWindow();
  });

  // Wait for the renderer to finish loading before showing the window.
  // Showing before load completes results in a blank/transparent frame.
  if (mainWindow && mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', () => {
      void openLauncherFromUserEntry();
    });
  } else {
    void openLauncherFromUserEntry();
  }

  app.on('activate', () => {
    // During onboarding the window is shown but may lose visual focus to a system
    // permission dialog (e.g. "SuperCmd wants access to control System Events").
    // When the user dismisses the dialog, macOS activates SuperCmd and we get this
    // event. Bring the onboarding window back to the front so setup can continue.
    if (isVisible && launcherMode === 'onboarding' && mainWindow && !mainWindow.isDestroyed()) {
      try { app.focus({ steal: true }); } catch {}
      try { mainWindow.show(); } catch {}
      try { mainWindow.focus(); } catch {}
      try { mainWindow.moveTop(); } catch {}
      return;
    }

    // If the launcher is already visible (e.g. brought back by an OAuth
    // callback deep link), don't reset it.
    if (isVisible) return;

    const visibleNonLauncherWindow = BrowserWindow
      .getAllWindows()
      .find((win: InstanceType<typeof BrowserWindow>) => !win.isDestroyed() && win.isVisible() && win !== mainWindow);
    if (visibleNonLauncherWindow) {
      if (!visibleNonLauncherWindow.isFocused()) {
        visibleNonLauncherWindow.focus();
      }
      return;
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      // New window — wait for content to load before showing.
      if (mainWindow && mainWindow.webContents.isLoadingMainFrame()) {
        mainWindow.webContents.once('did-finish-load', () => {
          void openLauncherFromUserEntry();
        });
        return;
      }
    }
    void openLauncherFromUserEntry();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  stopInstalledAppsWatchers();
  globalShortcut.unregisterAll();
  if (windowManagerWorkerRestartTimer) {
    clearTimeout(windowManagerWorkerRestartTimer);
    windowManagerWorkerRestartTimer = null;
  }
  rejectAllWindowManagerWorkerPending('[WindowManager] App is quitting.');
  if (windowManagerWorker) {
    try { windowManagerWorker.kill('SIGKILL'); } catch {}
    windowManagerWorker = null;
  }
  clearAppUpdaterAutoCheckTimer();
  stopWhisperHoldWatcher();
  stopFnSpeakToggleWatcher();
  stopAllFnCommandWatchers();
  stopSpeakSession({ resetStatus: false });
  stopClipboardMonitor();
  stopSnippetExpander();
  stopFileSearchIndexing();
  if (appTray) {
    try { appTray.destroy(); } catch {}
    appTray = null;
  }
  // Clean up trays
  for (const [, tray] of menuBarTrays) {
    tray.destroy();
  }
  menuBarTrays.clear();
});
