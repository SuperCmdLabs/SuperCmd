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
  launchArguments?: Record<string, any>;
  preferenceDefinitions?: Array<{
    scope: 'extension' | 'command';
    name: string;
    title?: string;
    description?: string;
    placeholder?: string;
    required?: boolean;
    type?: string;
    default?: any;
    data?: Array<{ title?: string; value?: string }>;
  }>;
  commandArgumentDefinitions?: Array<{
    name: string;
    required?: boolean;
    type?: string;
    placeholder?: string;
    title?: string;
  }>;
  error?: string;
}

export interface AISettings {
  provider: 'openai' | 'anthropic' | 'ollama';
  openaiApiKey: string;
  anthropicApiKey: string;
  ollamaBaseUrl: string;
  defaultModel: string;
  enabled: boolean;
}

export interface AppSettings {
  globalShortcut: string;
  disabledCommands: string[];
  commandHotkeys: Record<string, string>;
  ai: AISettings;
}

export interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  author: string;
  contributors: string[];
  icon: string;
  iconUrl: string;
  screenshotUrls: string[];
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

export interface Snippet {
  id: string;
  name: string;
  content: string;
  keyword?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OllamaLocalModel {
  name: string;
  size: number;
  parameterSize: string;
  quantization: string;
  modifiedAt: string;
}

export interface ElectronAPI {
  // Launcher
  getCommands: () => Promise<CommandInfo[]>;
  executeCommand: (commandId: string) => Promise<boolean>;
  hideWindow: () => Promise<void>;
  getLastFrontmostApp: () => Promise<{ name: string; path: string; bundleId?: string } | null>;
  onWindowShown: (callback: () => void) => void;
  onRunSystemCommand: (callback: (commandId: string) => void) => void;

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
  openSettingsTab: (tab: 'general' | 'ai' | 'extensions') => Promise<void>;
  openExtensionStoreWindow: () => Promise<void>;
  onSettingsTabChanged: (callback: (tab: 'general' | 'ai' | 'extensions') => void) => void;

  // Extension Runner
  runExtension: (extName: string, cmdName: string) => Promise<ExtensionBundle | null>;

  // Open URL
  openUrl: (url: string) => Promise<boolean>;

  // Store
  getCatalog: (forceRefresh?: boolean) => Promise<CatalogEntry[]>;
  getExtensionScreenshots: (extensionName: string) => Promise<string[]>;
  getInstalledExtensionNames: () => Promise<string[]>;
  installExtension: (name: string) => Promise<boolean>;
  uninstallExtension: (name: string) => Promise<boolean>;

  // Extension APIs (for @raycast/api compatibility)
  execCommand: (
    command: string,
    args: string[],
    options?: { shell?: boolean | string; input?: string; env?: Record<string, string>; cwd?: string }
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  execCommandSync: (
    command: string,
    args: string[],
    options?: { shell?: boolean | string; input?: string; env?: Record<string, string>; cwd?: string }
  ) => { stdout: string; stderr: string; exitCode: number };
  getApplications: () => Promise<Array<{ name: string; path: string; bundleId?: string }>>;
  getFrontmostApplication: () => Promise<{ name: string; path: string; bundleId?: string } | null>;
  runAppleScript: (script: string) => Promise<string>;
  moveToTrash: (paths: string[]) => Promise<void>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  fileExists: (filePath: string) => Promise<boolean>;
  readDir: (dirPath: string) => Promise<string[]>;
  getAppearance: () => Promise<'dark' | 'light'>;

  // SQLite query execution
  runSqliteQuery: (dbPath: string, query: string) => Promise<{ data: any; error: string | null }>;

  // Synchronous file operations (for extensions using readFileSync etc.)
  readFileSync: (filePath: string) => { data: string | null; error: string | null };
  fileExistsSync: (filePath: string) => boolean;
  statSync: (filePath: string) => { exists: boolean; isDirectory: boolean; isFile: boolean; size: number };

  // Clipboard Manager
  clipboardGetHistory: () => Promise<ClipboardItem[]>;
  clipboardSearch: (query: string) => Promise<ClipboardItem[]>;
  clipboardClearHistory: () => Promise<void>;
  clipboardDeleteItem: (id: string) => Promise<boolean>;
  clipboardCopyItem: (id: string) => Promise<boolean>;
  clipboardPasteItem: (id: string) => Promise<boolean>;
  clipboardSetEnabled: (enabled: boolean) => Promise<void>;

  // Snippet Manager
  snippetGetAll: () => Promise<Snippet[]>;
  snippetSearch: (query: string) => Promise<Snippet[]>;
  snippetCreate: (data: { name: string; content: string; keyword?: string }) => Promise<Snippet>;
  snippetUpdate: (id: string, data: { name?: string; content?: string; keyword?: string }) => Promise<Snippet | null>;
  snippetDelete: (id: string) => Promise<boolean>;
  snippetCopyToClipboard: (id: string) => Promise<boolean>;
  snippetPaste: (id: string) => Promise<boolean>;
  snippetImport: () => Promise<{ imported: number; skipped: number }>;
  snippetExport: () => Promise<boolean>;

  // Native helpers
  nativePickColor: () => Promise<{ red: number; green: number; blue: number; alpha: number } | null>;

  // AI
  aiAsk: (requestId: string, prompt: string, options?: { model?: string; creativity?: number; systemPrompt?: string }) => Promise<void>;
  aiCancel: (requestId: string) => Promise<void>;
  aiIsAvailable: () => Promise<boolean>;
  onAIStreamChunk: (callback: (data: { requestId: string; chunk: string }) => void) => void;
  onAIStreamDone: (callback: (data: { requestId: string }) => void) => void;
  onAIStreamError: (callback: (data: { requestId: string; error: string }) => void) => void;

  // Ollama Model Management
  ollamaStatus: () => Promise<{ running: boolean; models: OllamaLocalModel[] }>;
  ollamaPull: (requestId: string, modelName: string) => Promise<void>;
  ollamaDelete: (modelName: string) => Promise<{ success: boolean; error: string | null }>;
  ollamaOpenDownload: () => Promise<boolean>;
  onOllamaPullProgress: (callback: (data: { requestId: string; status: string; digest: string; total: number; completed: number }) => void) => void;
  onOllamaPullDone: (callback: (data: { requestId: string }) => void) => void;
  onOllamaPullError: (callback: (data: { requestId: string; error: string }) => void) => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
