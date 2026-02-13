/**
 * Preload Script
 *
 * Exposes a secure API to the renderer process via contextBridge.
 * Used by both the launcher window and the settings window.
 */

import { contextBridge, ipcRenderer } from 'electron';

// In sandboxed preload, require('os') is NOT available.
// Use process.env which IS available in preload.
const _homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
const _platform = process.platform;

contextBridge.exposeInMainWorld('electron', {
  // ─── System Info ────────────────────────────────────────────────
  homeDir: _homeDir,
  platform: _platform,

  // ─── Launcher ───────────────────────────────────────────────────
  getCommands: (): Promise<any[]> => ipcRenderer.invoke('get-commands'),
  executeCommand: (commandId: string): Promise<boolean> =>
    ipcRenderer.invoke('execute-command', commandId),
  hideWindow: (): Promise<void> => ipcRenderer.invoke('hide-window'),
  closePromptWindow: (): Promise<void> => ipcRenderer.invoke('close-prompt-window'),
  setLauncherMode: (mode: 'default' | 'onboarding' | 'whisper' | 'speak' | 'prompt'): Promise<void> =>
    ipcRenderer.invoke('set-launcher-mode', mode),
  getLastFrontmostApp: (): Promise<{ name: string; path: string; bundleId?: string } | null> =>
    ipcRenderer.invoke('get-last-frontmost-app'),
  restoreLastFrontmostApp: (): Promise<boolean> =>
    ipcRenderer.invoke('restore-last-frontmost-app'),
  onWindowShown: (callback: (payload?: { mode?: 'default' | 'onboarding' | 'whisper' | 'speak' | 'prompt' }) => void) => {
    const listener = (_event: any, payload: any) => callback(payload);
    ipcRenderer.on('window-shown', listener);
    return () => {
      ipcRenderer.removeListener('window-shown', listener);
    };
  },
  onWindowHidden: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('window-hidden', listener);
    return () => {
      ipcRenderer.removeListener('window-hidden', listener);
    };
  },
  onRunSystemCommand: (callback: (commandId: string) => void) => {
    const listener = (_event: any, commandId: string) => callback(commandId);
    ipcRenderer.on('run-system-command', listener);
    return () => {
      ipcRenderer.removeListener('run-system-command', listener);
    };
  },
  setDetachedOverlayState: (overlay: 'whisper' | 'speak', visible: boolean): void => {
    ipcRenderer.send('set-detached-overlay-state', { overlay, visible });
  },
  onWhisperStopAndClose: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('whisper-stop-and-close', listener);
    return () => {
      ipcRenderer.removeListener('whisper-stop-and-close', listener);
    };
  },
  onWhisperStartListening: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('whisper-start-listening', listener);
    return () => {
      ipcRenderer.removeListener('whisper-start-listening', listener);
    };
  },
  onWhisperStopListening: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('whisper-stop-listening', listener);
    return () => {
      ipcRenderer.removeListener('whisper-stop-listening', listener);
    };
  },
  onWhisperToggleListening: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('whisper-toggle-listening', listener);
    return () => {
      ipcRenderer.removeListener('whisper-toggle-listening', listener);
    };
  },
  onOAuthCallback: (callback: (url: string) => void) => {
    ipcRenderer.on('oauth-callback', (_event, url) => callback(url));
  },
  onSpeakStatus: (callback: (payload: { state: 'idle' | 'loading' | 'speaking' | 'done' | 'error'; text: string; index: number; total: number; message?: string; wordIndex?: number }) => void) => {
    const listener = (_event: any, payload: any) => callback(payload);
    ipcRenderer.on('speak-status', listener);
    return () => {
      ipcRenderer.removeListener('speak-status', listener);
    };
  },
  speakStop: (): Promise<boolean> => ipcRenderer.invoke('speak-stop'),
  speakGetStatus: (): Promise<{ state: 'idle' | 'loading' | 'speaking' | 'done' | 'error'; text: string; index: number; total: number; message?: string; wordIndex?: number }> =>
    ipcRenderer.invoke('speak-get-status'),
  speakGetOptions: (): Promise<{ voice: string; rate: string }> =>
    ipcRenderer.invoke('speak-get-options'),
  speakUpdateOptions: (patch: { voice?: string; rate?: string; restartCurrent?: boolean }): Promise<{ voice: string; rate: string }> =>
    ipcRenderer.invoke('speak-update-options', patch),
  speakPreviewVoice: (payload: { voice: string; text?: string; rate?: string }): Promise<boolean> =>
    ipcRenderer.invoke('speak-preview-voice', payload),
  edgeTtsListVoices: (): Promise<Array<{ id: string; label: string; languageCode: string; languageLabel: string; gender: 'female' | 'male'; style?: string }>> =>
    ipcRenderer.invoke('edge-tts-list-voices'),

  // ─── Settings ───────────────────────────────────────────────────
  getSettings: (): Promise<any> => ipcRenderer.invoke('get-settings'),
  getGlobalShortcutStatus: (): Promise<{
    requestedShortcut: string;
    activeShortcut: string;
    ok: boolean;
  }> => ipcRenderer.invoke('get-global-shortcut-status'),
  saveSettings: (patch: any): Promise<any> =>
    ipcRenderer.invoke('save-settings', patch),
  getAllCommands: (): Promise<any[]> =>
    ipcRenderer.invoke('get-all-commands'),
  updateGlobalShortcut: (shortcut: string): Promise<boolean> =>
    ipcRenderer.invoke('update-global-shortcut', shortcut),
  setOpenAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('set-open-at-login', enabled),
  replaceSpotlightWithSuperCmdShortcut: (): Promise<boolean> =>
    ipcRenderer.invoke('replace-spotlight-with-supercmd'),
  updateCommandHotkey: (
    commandId: string,
    hotkey: string
  ): Promise<{ success: boolean; error?: 'duplicate' | 'unavailable' }> =>
    ipcRenderer.invoke('update-command-hotkey', commandId, hotkey),
  toggleCommandEnabled: (
    commandId: string,
    enabled: boolean
  ): Promise<boolean> =>
    ipcRenderer.invoke('toggle-command-enabled', commandId, enabled),
  openSettings: (): Promise<void> => ipcRenderer.invoke('open-settings'),
  openSettingsTab: (
    tab: 'general' | 'ai' | 'extensions',
    target?: { extensionName?: string; commandName?: string }
  ): Promise<void> =>
    ipcRenderer.invoke('open-settings-tab', { tab, target }),
  openExtensionStoreWindow: (): Promise<void> =>
    ipcRenderer.invoke('open-extension-store-window'),
  onSettingsTabChanged: (callback: (payload: any) => void) => {
    ipcRenderer.on('settings-tab-changed', (_event, payload) => callback(payload));
  },

  // ─── Extension Runner ────────────────────────────────────────────
  runExtension: (extName: string, cmdName: string): Promise<any> =>
    ipcRenderer.invoke('run-extension', extName, cmdName),
  runScriptCommand: (payload: {
    commandId: string;
    arguments?: Record<string, any>;
    background?: boolean;
  }): Promise<any> =>
    ipcRenderer.invoke('run-script-command', payload),
  getInstalledExtensionsSettingsSchema: (): Promise<any[]> =>
    ipcRenderer.invoke('get-installed-extensions-settings-schema'),

  // Launch command (for launchCommand API)
  launchCommand: (options: any): Promise<void> =>
    ipcRenderer.invoke('launch-command', options),

  // Update command metadata (for updateCommandMetadata API)
  updateCommandMetadata: (commandId: string, metadata: { subtitle?: string | null }): Promise<void> =>
    ipcRenderer.invoke('update-command-metadata', commandId, metadata),

  // ─── Open URL (for extensions) ────────────────────────────────────
  openUrl: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('open-url', url),

  // ─── Store ────────────────────────────────────────────────────
  getCatalog: (forceRefresh?: boolean): Promise<any[]> =>
    ipcRenderer.invoke('get-catalog', forceRefresh),
  getExtensionScreenshots: (extensionName: string): Promise<string[]> =>
    ipcRenderer.invoke('get-extension-screenshots', extensionName),
  getInstalledExtensionNames: (): Promise<string[]> =>
    ipcRenderer.invoke('get-installed-extension-names'),
  installExtension: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('install-extension', name),
  uninstallExtension: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('uninstall-extension', name),

  // ─── Extension APIs (for @raycast/api compatibility) ─────────────

  // HTTP request proxy (Node.js HTTP, bypasses CORS)
  httpRequest: (options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyText: string;
    url: string;
  }> => ipcRenderer.invoke('http-request', options),

  // Download a URL via Node.js (avoids renderer CORS restrictions for binary CDN downloads)
  httpDownloadBinary: (url: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('http-download-binary', url),

  // Write raw binary data to a file (used by extension download/install flows)
  fsWriteBinaryFile: (filePath: string, data: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('fs-write-binary-file', filePath, data),

  // Execute shell commands
  execCommand: (
    command: string,
    args: string[],
    options?: { shell?: boolean | string; input?: string; env?: Record<string, string>; cwd?: string }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
    ipcRenderer.invoke('exec-command', command, args, options),
  execCommandSync: (
    command: string,
    args: string[],
    options?: { shell?: boolean | string; input?: string; env?: Record<string, string>; cwd?: string }
  ): { stdout: string; stderr: string; exitCode: number } =>
    ipcRenderer.sendSync('exec-command-sync', command, args, options),

  // Streaming spawn — real-time stdout/stderr for long-running processes (generic, works for all extensions)
  spawnProcess: (file: string, args: string[], options?: { shell?: boolean | string; env?: Record<string, string>; cwd?: string }): Promise<{ pid: number }> =>
    ipcRenderer.invoke('spawn-process', file, args, options),
  killSpawnProcess: (pid: number): Promise<void> =>
    ipcRenderer.invoke('spawn-kill', pid),
  onSpawnStdout: (callback: (pid: number, data: Uint8Array) => void): (() => void) => {
    const handler = (_e: any, pid: number, data: Uint8Array) => callback(pid, data);
    ipcRenderer.on('spawn-stdout', handler);
    return () => ipcRenderer.removeListener('spawn-stdout', handler);
  },
  onSpawnStderr: (callback: (pid: number, data: Uint8Array) => void): (() => void) => {
    const handler = (_e: any, pid: number, data: Uint8Array) => callback(pid, data);
    ipcRenderer.on('spawn-stderr', handler);
    return () => ipcRenderer.removeListener('spawn-stderr', handler);
  },
  onSpawnExit: (callback: (pid: number, code: number) => void): (() => void) => {
    const handler = (_e: any, pid: number, code: number) => callback(pid, code);
    ipcRenderer.on('spawn-exit', handler);
    return () => ipcRenderer.removeListener('spawn-exit', handler);
  },
  onSpawnError: (callback: (pid: number, message: string) => void): (() => void) => {
    const handler = (_e: any, pid: number, message: string) => callback(pid, message);
    ipcRenderer.on('spawn-error', handler);
    return () => ipcRenderer.removeListener('spawn-error', handler);
  },
  onSpawnEvent: (
    callback: (event: { pid: number; seq: number; type: 'stdout' | 'stderr' | 'exit' | 'error'; data?: Uint8Array; code?: number; message?: string }) => void
  ): (() => void) => {
    const handler = (_e: any, payload: any) => callback(payload);
    ipcRenderer.on('spawn-event', handler);
    return () => ipcRenderer.removeListener('spawn-event', handler);
  },

  // Get installed applications
  getApplications: (path?: string): Promise<Array<{ name: string; path: string; bundleId?: string }>> =>
    ipcRenderer.invoke('get-applications', path),

  // Get default application for a file/URL
  getDefaultApplication: (filePath: string): Promise<{ name: string; path: string; bundleId?: string }> =>
    ipcRenderer.invoke('get-default-application', filePath),

  // Get frontmost application
  getFrontmostApplication: (): Promise<{ name: string; path: string; bundleId?: string } | null> =>
    ipcRenderer.invoke('get-frontmost-application'),

  // Run AppleScript
  runAppleScript: (script: string): Promise<string> =>
    ipcRenderer.invoke('run-applescript', script),

  // Move to trash
  moveToTrash: (paths: string[]): Promise<void> =>
    ipcRenderer.invoke('move-to-trash', paths),

  // Read file (for extensions that need filesystem access)
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('read-file', filePath),

  // Synchronous file operations (for extensions that use readFileSync etc.)
  readFileSync: (filePath: string): { data: string | null; error: string | null } =>
    ipcRenderer.sendSync('read-file-sync', filePath),
  fileExistsSync: (filePath: string): boolean =>
    ipcRenderer.sendSync('file-exists-sync', filePath),
  statSync: (filePath: string): { exists: boolean; isDirectory: boolean; isFile: boolean; size: number } =>
    ipcRenderer.sendSync('stat-sync', filePath),

  // Write file
  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('write-file', filePath, content),

  // Check if file exists
  fileExists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('file-exists', filePath),

  // Read directory
  readDir: (dirPath: string): Promise<string[]> =>
    ipcRenderer.invoke('read-dir', dirPath),

  getFileIconDataUrl: (filePath: string, size = 20): Promise<string | null> =>
    ipcRenderer.invoke('get-file-icon-data-url', filePath, size),

  // Get system appearance (dark/light)
  getAppearance: (): Promise<'dark' | 'light'> =>
    ipcRenderer.invoke('get-appearance'),

  // SQLite query execution (for extensions that use useSQL)
  runSqliteQuery: (dbPath: string, query: string): Promise<{ data: any; error: string | null }> =>
    ipcRenderer.invoke('run-sqlite-query', dbPath, query),

  // ─── Clipboard Manager ────────────────────────────────────────────
  clipboardGetHistory: (): Promise<any[]> =>
    ipcRenderer.invoke('clipboard-get-history'),
  clipboardSearch: (query: string): Promise<any[]> =>
    ipcRenderer.invoke('clipboard-search', query),
  clipboardClearHistory: (): Promise<void> =>
    ipcRenderer.invoke('clipboard-clear-history'),
  clipboardDeleteItem: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard-delete-item', id),
  clipboardCopyItem: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard-copy-item', id),
  clipboardPasteItem: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard-paste-item', id),
  clipboardSetEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('clipboard-set-enabled', enabled),
  clipboardWrite: (payload: { text?: string; html?: string }): Promise<boolean> =>
    ipcRenderer.invoke('clipboard-write', payload),
  clipboardReadText: (): Promise<string> =>
    ipcRenderer.invoke('clipboard-read-text'),
  getSelectedText: (): Promise<string> =>
    ipcRenderer.invoke('get-selected-text'),
  getSelectedTextStrict: (): Promise<string> =>
    ipcRenderer.invoke('get-selected-text-strict'),
  memoryAdd: (payload: { text: string; userId?: string; source?: string; metadata?: Record<string, any> }): Promise<{ success: boolean; memoryId?: string; error?: string }> =>
    ipcRenderer.invoke('memory-add', payload),

  // ─── Snippet Manager ────────────────────────────────────────────
  snippetGetAll: (): Promise<any[]> =>
    ipcRenderer.invoke('snippet-get-all'),
  snippetSearch: (query: string): Promise<any[]> =>
    ipcRenderer.invoke('snippet-search', query),
  snippetCreate: (data: any): Promise<any> =>
    ipcRenderer.invoke('snippet-create', data),
  snippetUpdate: (id: string, data: any): Promise<any> =>
    ipcRenderer.invoke('snippet-update', id, data),
  snippetDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('snippet-delete', id),
  snippetDeleteAll: (): Promise<number> =>
    ipcRenderer.invoke('snippet-delete-all'),
  snippetDuplicate: (id: string): Promise<any> =>
    ipcRenderer.invoke('snippet-duplicate', id),
  snippetTogglePin: (id: string): Promise<any> =>
    ipcRenderer.invoke('snippet-toggle-pin', id),
  snippetGetByKeyword: (keyword: string): Promise<any | null> =>
    ipcRenderer.invoke('snippet-get-by-keyword', keyword),
  snippetGetDynamicFields: (id: string): Promise<Array<{ key: string; name: string; defaultValue?: string }>> =>
    ipcRenderer.invoke('snippet-get-dynamic-fields', id),
  snippetRender: (id: string, dynamicValues?: Record<string, string>): Promise<string | null> =>
    ipcRenderer.invoke('snippet-render', id, dynamicValues),
  snippetCopyToClipboard: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('snippet-copy-to-clipboard', id),
  snippetCopyToClipboardResolved: (id: string, dynamicValues?: Record<string, string>): Promise<boolean> =>
    ipcRenderer.invoke('snippet-copy-to-clipboard-resolved', id, dynamicValues),
  snippetPaste: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('snippet-paste', id),
  snippetPasteResolved: (id: string, dynamicValues?: Record<string, string>): Promise<boolean> =>
    ipcRenderer.invoke('snippet-paste-resolved', id, dynamicValues),
  snippetImport: (): Promise<{ imported: number; skipped: number }> =>
    ipcRenderer.invoke('snippet-import'),
  snippetExport: (): Promise<boolean> =>
    ipcRenderer.invoke('snippet-export'),
  pasteText: (text: string): Promise<boolean> =>
    ipcRenderer.invoke('paste-text', text),
  typeTextLive: (text: string): Promise<boolean> =>
    ipcRenderer.invoke('type-text-live', text),
  whisperTypeTextLive: (
    text: string
  ): Promise<{ typed: boolean; fallbackClipboard: boolean; message?: string }> =>
    ipcRenderer.invoke('whisper-type-text-live', text),
  replaceLiveText: (previousText: string, nextText: string): Promise<boolean> =>
    ipcRenderer.invoke('replace-live-text', previousText, nextText),
  promptApplyGeneratedText: (payload: { previousText?: string; nextText: string }): Promise<boolean> =>
    ipcRenderer.invoke('prompt-apply-generated-text', payload),

  // ─── Native Helpers ─────────────────────────────────────────────
  nativePickColor: (): Promise<{ red: number; green: number; blue: number; alpha: number } | null> =>
    ipcRenderer.invoke('native-pick-color'),
  pickFiles: (options?: {
    allowMultipleSelection?: boolean;
    canChooseDirectories?: boolean;
    canChooseFiles?: boolean;
    showHiddenFiles?: boolean;
  }): Promise<string[]> =>
    ipcRenderer.invoke('pick-files', options),

  // ─── Menu Bar (Tray) Extensions ────────────────────────────────
  getMenuBarExtensions: (): Promise<any[]> =>
    ipcRenderer.invoke('get-menubar-extensions'),
  updateMenuBar: (data: any) =>
    ipcRenderer.send('menubar-update', data),
  removeMenuBar: (extId: string): void =>
    ipcRenderer.send('menubar-remove', { extId }),
  onMenuBarItemClick: (callback: (data: { extId: string; itemId: string }) => void) => {
    ipcRenderer.on('menubar-item-click', (_event: any, data: any) => callback(data));
  },

  // ─── AI ────────────────────────────────────────────────────────
  aiAsk: (requestId: string, prompt: string, options?: { model?: string; creativity?: number; systemPrompt?: string }): Promise<void> =>
    ipcRenderer.invoke('ai-ask', requestId, prompt, options),
  aiCancel: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('ai-cancel', requestId),
  aiIsAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('ai-is-available'),
  whisperRefineTranscript: (transcript: string): Promise<{ correctedText: string; source: 'ai' | 'heuristic' | 'raw' }> =>
    ipcRenderer.invoke('whisper-refine-transcript', transcript),
  whisperDebugLog: (tag: string, message: string, data?: any): void =>
    ipcRenderer.send('whisper-debug-log', { tag, message, data }),
  whisperTranscribe: (audioBuffer: ArrayBuffer, options?: { language?: string; mimeType?: string }): Promise<string> =>
    ipcRenderer.invoke('whisper-transcribe', audioBuffer, options),
  whisperStartNative: (language?: string): Promise<void> =>
    ipcRenderer.invoke('whisper-start-native', language),
  whisperStopNative: (): Promise<void> =>
    ipcRenderer.invoke('whisper-stop-native'),
  onWhisperNativeChunk: (callback: (data: { transcript?: string; isFinal?: boolean; error?: string; ready?: boolean; ended?: boolean }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('whisper-native-chunk', listener);
    return () => { ipcRenderer.removeListener('whisper-native-chunk', listener); };
  },
  onAIStreamChunk: (callback: (data: { requestId: string; chunk: string }) => void) => {
    ipcRenderer.on('ai-stream-chunk', (_event: any, data: any) => callback(data));
  },
  onAIStreamDone: (callback: (data: { requestId: string }) => void) => {
    ipcRenderer.on('ai-stream-done', (_event: any, data: any) => callback(data));
  },
  onAIStreamError: (callback: (data: { requestId: string; error: string }) => void) => {
    ipcRenderer.on('ai-stream-error', (_event: any, data: any) => callback(data));
  },

  // ─── Ollama Model Management ────────────────────────────────────
  ollamaStatus: (): Promise<{ running: boolean; models: any[] }> =>
    ipcRenderer.invoke('ollama-status'),
  ollamaPull: (requestId: string, modelName: string): Promise<void> =>
    ipcRenderer.invoke('ollama-pull', requestId, modelName),
  ollamaDelete: (modelName: string): Promise<{ success: boolean; error: string | null }> =>
    ipcRenderer.invoke('ollama-delete', modelName),
  ollamaOpenDownload: (): Promise<boolean> =>
    ipcRenderer.invoke('ollama-open-download'),
  onOllamaPullProgress: (callback: (data: { requestId: string; status: string; digest: string; total: number; completed: number }) => void) => {
    ipcRenderer.on('ollama-pull-progress', (_event: any, data: any) => callback(data));
  },
  onOllamaPullDone: (callback: (data: { requestId: string }) => void) => {
    ipcRenderer.on('ollama-pull-done', (_event: any, data: any) => callback(data));
  },
  onOllamaPullError: (callback: (data: { requestId: string; error: string }) => void) => {
    ipcRenderer.on('ollama-pull-error', (_event: any, data: any) => callback(data));
  },

  // ─── WindowManagement ────────────────────────────────────────────
  getActiveWindow: (): Promise<any> =>
    ipcRenderer.invoke('window-management-get-active-window'),
  getWindowsOnActiveDesktop: (): Promise<any[]> =>
    ipcRenderer.invoke('window-management-get-windows-on-active-desktop'),
  getDesktops: (): Promise<any[]> =>
    ipcRenderer.invoke('window-management-get-desktops'),
  setWindowBounds: (options: any): Promise<void> =>
    ipcRenderer.invoke('window-management-set-window-bounds', options),
});
