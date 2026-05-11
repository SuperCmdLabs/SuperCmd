import { dialog, type BrowserWindow } from 'electron';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { getAiChatSnapshot, mergeAiChatSnapshot } from './ai-chat-store';
import { getAvailableCommands, invalidateCache, type CommandInfo } from './commands';
import { getExtensionPreferences, setExtensionPreferences } from './extension-preferences-store';
import { getInstalledExtensionNames, installExtension } from './extension-registry';
import { createNote, getAllNotes, updateNote } from './notes-store';
import { createQuickLink, getAllQuickLinks } from './quicklink-store';
import { discoverScriptCommands, invalidateScriptCommandsCache } from './script-command-runner';
import { loadSettings, saveSettings, type AppSettings } from './settings-store';
import { createSnippet, getAllSnippets, updateSnippet } from './snippet-store';

type RaycastQuicklinkRecord = {
  uuid?: string;
  name?: string;
  url?: string;
  isEnabled?: boolean;
};

type RaycastSnippetRecord = {
  name?: string;
  text?: string;
  keyword?: string;
  pinned?: boolean;
};

type RaycastNoteRecord = {
  title?: string;
  text?: string;
  pinned?: boolean;
};

type RaycastExtensionCommandRecord = {
  name?: string;
  enabled?: boolean;
};

type RaycastExtensionRecord = {
  name?: string;
  owner?: string;
  title?: string;
  commands?: RaycastExtensionCommandRecord[];
  prefs?: Array<{ name?: string; type?: string; value?: unknown }>;
};

type RaycastPreferencesPayload = {
  preferencesGeneral?: {
    raycastGlobalHotkey?: string;
  };
  preferencesAppearance?: {
    raycastPreferredWindowMode?: string;
  };
  preferencesAdvanced?: {
    navigationCommandStyleIdentifierKey?: string;
    popToRootTimeout?: number;
  };
};

type RaycastRootSearchRecord = {
  key?: string;
  type?: string;
  path?: string;
  hotkey?: string;
  searchTerms?: string;
};

type RaycastPinnedMenuItem = {
  key?: string;
  id?: string;
  title?: string;
  path?: string;
  type?: string;
};

type RaycastBackup = {
  raycast_version?: string;
  builtin_package_quicklinks?: {
    quicklinks?: RaycastQuicklinkRecord[];
  };
  builtin_package_snippets?: {
    snippets?: RaycastSnippetRecord[];
  };
  builtin_package_raycastNotes?: {
    notes?: RaycastNoteRecord[];
  };
  builtin_package_raycastExtensions?: {
    extensions?: RaycastExtensionRecord[];
  };
  builtin_package_raycastPreferences?: RaycastPreferencesPayload;
  builtin_package_rootSearch?: {
    rootSearch?: RaycastRootSearchRecord[];
  };
  builtin_package_navigation?: {
    pinnedMenuItems?: Array<string | RaycastPinnedMenuItem>;
  };
  'builtin_package_open-ai'?: {
    aiChats?: unknown[];
  };
  builtin_package_clipboardHistory?: {
    clipboardHistoryRecords?: unknown[];
  };
  builtin_package_scriptCommands?: {
    scriptCommandsDirectories?: string[];
    disabledCommands?: string[];
  };
  builtin_package_mcp?: {
    mcpServers?: unknown[];
  };
};

export interface RaycastImportBucketResult {
  found: number;
  imported: number;
  skipped: number;
  failed: number;
}

export interface RaycastImportResult {
  canceled: boolean;
  filePath?: string;
  raycastVersion?: string;
  settingsImported: boolean;
  disabledCommandsImported: number;
  scriptCommandFoldersImported: number;
  commandHotkeysImported: number;
  commandAliasesImported: number;
  pinnedCommandsImported: number;
  aiChats: RaycastImportBucketResult;
  quicklinks: RaycastImportBucketResult;
  snippets: RaycastImportBucketResult;
  notes: RaycastImportBucketResult;
  extensions: RaycastImportBucketResult;
  importedExtensionPreferenceExtensions: string[];
  unsupported: string[];
  warnings: string[];
}

export interface RaycastImportSelections {
  settings: boolean;
  disabledCommands: boolean;
  scriptCommandFolders: boolean;
  commandHotkeys: boolean;
  commandAliases: boolean;
  pinnedCommands: boolean;
  aiChats: boolean;
  quicklinks: boolean;
  snippets: boolean;
  notes: boolean;
  extensions: boolean;
  extensionPreferences: boolean;
}

export interface RaycastImportOptions {
  sessionId: string;
  conflictMode: 'skip' | 'overwrite';
  selections: RaycastImportSelections;
}

export interface RaycastImportPreview {
  canceled: boolean;
  sessionId?: string;
  filePath?: string;
  raycastVersion?: string;
  selections: RaycastImportSelections;
  counts: {
    settings: number;
    disabledCommands: number;
    scriptCommandFolders: number;
    commandHotkeys: number;
    commandAliases: number;
    pinnedCommands: number;
    aiChats: number;
    quicklinks: number;
    snippets: number;
    notes: number;
    extensions: number;
    extensionPreferences: number;
  };
  unsupported: string[];
  warnings: string[];
}

export interface RaycastImportProgress {
  sessionId: string;
  stage: 'starting' | 'category' | 'extension' | 'done';
  category?: keyof RaycastImportSelections;
  message: string;
  completedSteps: number;
  totalSteps: number;
  currentItem?: number;
  totalItems?: number;
  extensionName?: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

const PASSWORD_PROMPT_TITLE = 'Import Raycast Backup';
const PASSWORD_PROMPT_MESSAGE = 'Enter the password for the Raycast backup.';
const PASSWORD_RETRY_MESSAGE = 'Password was not valid. Try again.';
const RAYCAST_ROOT_SEARCH_PREFIX = 'extension_';
const RAYCAST_SCRIPT_COMMAND_PREFIX = 'raycastScript_';
const importSessions = new Map<string, { filePath: string; backup: RaycastBackup }>();

const RAYCAST_BUILTIN_COMMAND_ID_MAP: Record<string, string> = {
  builtin_command_clipboardHistory: 'system-clipboard-manager',
  builtin_command_createScriptCommand: 'system-create-script-command',
  builtin_command_developer_manageExtensions: 'system-open-extensions-settings',
  builtin_command_extensionStore: 'system-open-extension-store',
  builtin_command_lockScreen: 'system-lock-screen',
  builtin_command_openCamera: 'system-camera',
  builtin_command_raycastNotes_ask: 'system-search-notes',
  builtin_command_searchEmoji: 'system-emoji-picker',
};

function createImportSessionId(): string {
  return `ray-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultSelections(): RaycastImportSelections {
  return {
    settings: true,
    disabledCommands: true,
    scriptCommandFolders: true,
    commandHotkeys: true,
    commandAliases: true,
    pinnedCommands: true,
    aiChats: true,
    quicklinks: true,
    snippets: true,
    notes: true,
    extensions: true,
    extensionPreferences: true,
  };
}

const RAYCAST_KEYCODE_TO_KEY: Record<number, string> = {
  0: 'A',
  1: 'S',
  2: 'D',
  3: 'F',
  4: 'H',
  5: 'G',
  6: 'Z',
  7: 'X',
  8: 'C',
  9: 'V',
  11: 'B',
  12: 'Q',
  13: 'W',
  14: 'E',
  15: 'R',
  16: 'Y',
  17: 'T',
  18: '1',
  19: '2',
  20: '3',
  21: '4',
  22: '6',
  23: '5',
  24: '=',
  25: '9',
  26: '7',
  27: '-',
  28: '8',
  29: '0',
  30: ']',
  31: 'O',
  32: 'U',
  33: '[',
  34: 'I',
  35: 'P',
  36: 'Return',
  37: 'L',
  38: 'J',
  39: "'",
  40: 'K',
  41: ';',
  42: '\\',
  43: ',',
  44: '/',
  45: 'N',
  46: 'M',
  47: '.',
  48: 'Tab',
  49: 'Space',
  50: '`',
  51: 'Backspace',
  53: 'Escape',
  71: 'Clear',
  76: 'Enter',
  96: 'F5',
  97: 'F6',
  98: 'F7',
  99: 'F3',
  100: 'F8',
  101: 'F9',
  103: 'F11',
  105: 'F13',
  106: 'F16',
  107: 'F14',
  109: 'F10',
  111: 'F12',
  113: 'F15',
  114: 'Insert',
  115: 'Home',
  116: 'PageUp',
  117: 'Delete',
  118: 'F4',
  119: 'End',
  120: 'F2',
  121: 'PageDown',
  122: 'F1',
  123: 'Left',
  124: 'Right',
  125: 'Down',
  126: 'Up',
};

function promptForPassword(message: string): string | null {
  try {
    const response = execFileSync(
      '/usr/bin/osascript',
      [
        '-e',
        `set userInput to text returned of (display dialog "${message}" with title "${PASSWORD_PROMPT_TITLE}" default answer "" with hidden answer buttons {"Cancel", "Import"} default button "Import")`,
        '-e',
        'return userInput',
      ],
      { encoding: 'utf8' }
    );
    const password = String(response || '').trim();
    return password || null;
  } catch (error: any) {
    const messageText = `${String(error?.message || '')}\n${String(error?.stderr || '')}`.toLowerCase();
    if (messageText.includes('user canceled') || messageText.includes('(-128)')) {
      return null;
    }
    throw error;
  }
}

function parseMaybePlainJson(raw: Buffer): RaycastBackup | null {
  const trimmed = raw.toString('utf8').trim();
  if (!trimmed.startsWith('{')) return null;
  return JSON.parse(trimmed) as RaycastBackup;
}

function findGzipOffset(buffer: Buffer): number {
  for (let index = 0; index < Math.min(buffer.length - 2, 64); index += 1) {
    if (buffer[index] === 0x1f && buffer[index + 1] === 0x8b && buffer[index + 2] === 0x08) {
      return index;
    }
  }
  return -1;
}

function decryptRaycastBuffer(raw: Buffer, password: string): Buffer {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-rayconfig-'));
  const inputPath = path.join(tempDir, 'backup.rayconfig');
  try {
    fs.writeFileSync(inputPath, raw);
    const decrypted = execFileSync(
      'openssl',
      ['enc', '-d', '-aes-256-cbc', '-nosalt', '-in', inputPath, '-k', password],
      { encoding: null, stdio: ['ignore', 'pipe', 'pipe'] }
    ) as Buffer;
    const gzipOffset = findGzipOffset(decrypted);
    if (gzipOffset < 0) {
      throw new Error('Failed to read import data; password is not valid.');
    }
    return zlib.gunzipSync(decrypted.subarray(gzipOffset));
  } catch (error: any) {
    const message = `${String(error?.message || error || '')}\n${String(error?.stderr || '')}`;
    if (
      message.includes('bad decrypt') ||
      message.includes('BAD_DECRYPT') ||
      message.includes('error:1C800064') ||
      message.includes('error:1e000065')
    ) {
      throw new Error('Failed to read import data; password is not valid.');
    }
    throw error;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

function loadRaycastBackupFromFile(filePath: string, password: string | null): RaycastBackup {
  const raw = fs.readFileSync(filePath);
  const plain = parseMaybePlainJson(raw);
  if (plain) return plain;
  if (!password) {
    throw new Error('A password is required to import this Raycast backup.');
  }
  const jsonBuffer = decryptRaycastBuffer(raw, password);
  return JSON.parse(jsonBuffer.toString('utf8')) as RaycastBackup;
}

function normalizeNavigationStyle(value: unknown): AppSettings['navigationStyle'] | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'macos') return 'macos';
  if (normalized === 'vim') return 'vim';
  return null;
}

function normalizeLauncherViewMode(value: unknown): AppSettings['launcherViewMode'] | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'compact') return 'compact';
  if (normalized === 'default' || normalized === 'expanded') return 'expanded';
  return null;
}

function decodeRaycastHotkey(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw.split('-').map((part) => String(part || '').trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const keyCode = Number(parts[parts.length - 1]);
  if (!Number.isFinite(keyCode)) return null;
  const key = RAYCAST_KEYCODE_TO_KEY[keyCode];
  if (!key) return null;

  const modifiers: string[] = [];
  for (const modifier of parts.slice(0, -1)) {
    const normalized = modifier.toLowerCase();
    if (normalized === 'command' || normalized === 'cmd') {
      modifiers.push('Command');
      continue;
    }
    if (normalized === 'control' || normalized === 'ctrl') {
      modifiers.push('Control');
      continue;
    }
    if (normalized === 'option' || normalized === 'alt') {
      modifiers.push('Alt');
      continue;
    }
    if (normalized === 'shift') {
      modifiers.push('Shift');
      continue;
    }
    if (normalized === 'fn' || normalized === 'function') {
      modifiers.push('Fn');
      continue;
    }
  }

  return [...modifiers, key].join('+');
}

function normalizeAliasCandidate(searchTerms: unknown): string | null {
  const raw = String(searchTerms || '').trim().toLowerCase();
  if (!raw) return null;
  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => /^[a-z0-9][a-z0-9 -]*$/.test(token));
  if (tokens.length === 0) return null;

  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (b[0].length !== a[0].length) return b[0].length - a[0].length;
    return a[0].localeCompare(b[0]);
  });
  const [candidate, count] = ranked[0] || [];
  if (!candidate) return null;
  if (candidate.length >= 4) return candidate;
  if (candidate.length >= 3 && count >= 2) return candidate;
  return null;
}

function normalizeRaycastPath(rawPath: string): string {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('~/')) {
    return path.resolve(path.join(os.homedir(), trimmed.slice(2)));
  }
  return path.resolve(trimmed);
}

function parseRaycastExtensionCommandKey(key: string): { extensionName: string; commandName: string } | null {
  if (!key.startsWith(RAYCAST_ROOT_SEARCH_PREFIX)) return null;
  const body = key.slice(RAYCAST_ROOT_SEARCH_PREFIX.length);
  const separatorIndex = body.indexOf('.');
  if (separatorIndex <= 0) return null;
  const suffixIndex = body.indexOf('__', separatorIndex + 1);
  const extensionName = body.slice(0, separatorIndex).trim();
  const commandName = (suffixIndex >= 0 ? body.slice(separatorIndex + 1, suffixIndex) : body.slice(separatorIndex + 1)).trim();
  if (!extensionName || !commandName) return null;
  return { extensionName, commandName };
}

function resolveRaycastCommandId(
  item: RaycastRootSearchRecord | RaycastPinnedMenuItem,
  appCommandIdByPath: Map<string, string>,
  scriptCommandIdByPath: Map<string, string>
): string | null {
  const fallbackId = 'id' in item ? String(item.id || '') : '';
  const key = String(item?.key || fallbackId).trim();
  if (key) {
    const builtinId = RAYCAST_BUILTIN_COMMAND_ID_MAP[key];
    if (builtinId) return builtinId;

    const extensionCommand = parseRaycastExtensionCommandKey(key);
    if (extensionCommand) {
      return `ext-${extensionCommand.extensionName}-${extensionCommand.commandName}`;
    }

    if (key.startsWith(RAYCAST_SCRIPT_COMMAND_PREFIX)) {
      const scriptPath = normalizeRaycastPath(key.slice(RAYCAST_SCRIPT_COMMAND_PREFIX.length));
      if (scriptPath) {
        const scriptId = scriptCommandIdByPath.get(scriptPath);
        if (scriptId) return scriptId;
      }
    }
  }

  const itemPath = normalizeRaycastPath(String(item?.path || ''));
  if (itemPath) {
    const appId = appCommandIdByPath.get(itemPath);
    if (appId) return appId;
    const scriptId = scriptCommandIdByPath.get(itemPath);
    if (scriptId) return scriptId;
  }

  return null;
}

function buildImportPreview(data: RaycastBackup): string {
  const aiChats = Array.isArray(data['builtin_package_open-ai']?.aiChats)
    ? data['builtin_package_open-ai']?.aiChats?.length || 0
    : 0;
  const quicklinks = Array.isArray(data.builtin_package_quicklinks?.quicklinks)
    ? data.builtin_package_quicklinks?.quicklinks?.length || 0
    : 0;
  const snippets = Array.isArray(data.builtin_package_snippets?.snippets)
    ? data.builtin_package_snippets?.snippets?.length || 0
    : 0;
  const notes = Array.isArray(data.builtin_package_raycastNotes?.notes)
    ? data.builtin_package_raycastNotes?.notes?.length || 0
    : 0;
  const extensions = Array.isArray(data.builtin_package_raycastExtensions?.extensions)
    ? data.builtin_package_raycastExtensions?.extensions?.length || 0
    : 0;
  const lines = [
    `Raycast version: ${String(data.raycast_version || 'unknown')}`,
    `AI chats: ${aiChats}`,
    `Quicklinks: ${quicklinks}`,
    `Snippets: ${snippets}`,
    `Notes: ${notes}`,
    `Extensions: ${extensions}`,
    '',
    'This import will only bring over categories that SuperCmd can map cleanly today.',
    'It will skip clipboard history and MCP server config.',
  ];
  return lines.join('\n');
}

function countPreviewStats(data: RaycastBackup): RaycastImportPreview['counts'] {
  const rootSearchItems = Array.isArray(data.builtin_package_rootSearch?.rootSearch)
    ? data.builtin_package_rootSearch?.rootSearch || []
    : [];
  const settingsCount =
    Number(Boolean(decodeRaycastHotkey(data.builtin_package_raycastPreferences?.preferencesGeneral?.raycastGlobalHotkey))) +
    Number(Boolean(normalizeNavigationStyle(data.builtin_package_raycastPreferences?.preferencesAdvanced?.navigationCommandStyleIdentifierKey))) +
    Number(Boolean(normalizeLauncherViewMode(data.builtin_package_raycastPreferences?.preferencesAppearance?.raycastPreferredWindowMode))) +
    Number(Number.isFinite(Number(data.builtin_package_raycastPreferences?.preferencesAdvanced?.popToRootTimeout)));

  return {
    settings: settingsCount,
    disabledCommands:
      (data.builtin_package_scriptCommands?.disabledCommands?.length || 0) +
      (data.builtin_package_raycastExtensions?.extensions || []).reduce((count, extension) => (
        count + (extension.commands || []).filter((command) => command?.enabled === false).length
      ), 0),
    scriptCommandFolders: data.builtin_package_scriptCommands?.scriptCommandsDirectories?.length || 0,
    commandHotkeys: rootSearchItems.filter((item) => Boolean(String(item?.hotkey || '').trim())).length,
    commandAliases: rootSearchItems.filter((item) => Boolean(normalizeAliasCandidate(item?.searchTerms))).length,
    pinnedCommands: data.builtin_package_navigation?.pinnedMenuItems?.length || 0,
    aiChats: data['builtin_package_open-ai']?.aiChats?.length || 0,
    quicklinks: data.builtin_package_quicklinks?.quicklinks?.length || 0,
    snippets: data.builtin_package_snippets?.snippets?.length || 0,
    notes: data.builtin_package_raycastNotes?.notes?.length || 0,
    extensions: data.builtin_package_raycastExtensions?.extensions?.length || 0,
    extensionPreferences: (data.builtin_package_raycastExtensions?.extensions || []).filter((extension) => (
      Array.isArray(extension.prefs) && extension.prefs.length > 0
    )).length,
  };
}

function collectUnsupportedCategories(data: RaycastBackup): string[] {
  const unsupported: string[] = [];
  if ((data.builtin_package_clipboardHistory?.clipboardHistoryRecords?.length || 0) > 0) unsupported.push('clipboard history');
  if ((data.builtin_package_mcp?.mcpServers?.length || 0) > 0) unsupported.push('MCP servers');
  return unsupported;
}

function createBucketResult(found = 0): RaycastImportBucketResult {
  return { found, imported: 0, skipped: 0, failed: 0 };
}

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, any>;
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e11) return Math.round(value);
    if (value > 1e9) return Math.round(value * 1000);
    if (value > 5e8) return Math.round((value + 978307200) * 1000);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) return parseTimestamp(asNumber, fallback);
      const asDate = Date.parse(trimmed);
      if (Number.isFinite(asDate)) return asDate;
    }
  }
  return fallback;
}

function extractTextChunks(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextChunks(entry, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return [];

  const directKeys = [
    'content',
    'text',
    'body',
    'message',
    'prompt',
    'response',
    'answer',
    'question',
    'markdown',
    'output',
    'summary',
    'transcript',
    'completion',
    'value',
  ];
  const chunks: string[] = [];
  for (const key of directKeys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      chunks.push(...extractTextChunks(record[key], depth + 1));
    }
  }

  if (chunks.length > 0) return chunks;

  for (const [key, child] of Object.entries(record)) {
    if (/^(id|uuid|title|name|createdAt|updatedAt|timestamp|date|role|type|model|metadata)$/i.test(key)) {
      continue;
    }
    chunks.push(...extractTextChunks(child, depth + 1));
  }

  return chunks;
}

function uniqueText(chunks: string[]): string {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const chunk of chunks) {
    const normalized = chunk.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next.join('\n\n').trim();
}

function normalizeImportedRole(value: unknown): 'user' | 'assistant' {
  const raw = String(value || '').trim().toLowerCase();
  if (
    raw === 'user' ||
    raw === 'human' ||
    raw === 'prompt' ||
    raw === 'question' ||
    raw === 'input'
  ) {
    return 'user';
  }
  return 'assistant';
}

function extractConversationArray(record: Record<string, any>): unknown[] {
  const directKeys = [
    'messages',
    'turns',
    'entries',
    'items',
    'chatMessages',
    'conversationMessages',
    'conversation',
    'history',
    'nodes',
  ];
  for (const key of directKeys) {
    if (Array.isArray(record[key])) return record[key];
  }
  for (const value of Object.values(record)) {
    if (!Array.isArray(value)) continue;
    if (value.some((entry) => asRecord(entry))) return value;
  }
  return [];
}

function extractMessagesFromRaycastEntry(entry: unknown, index: number): Array<{
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}> {
  const fallbackTs = Date.now() + index;
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return trimmed ? [{ role: 'assistant', content: trimmed, createdAt: fallbackTs }] : [];
  }
  const record = asRecord(entry);
  if (!record) return [];

  const pairedFields: Array<[keyof typeof record, keyof typeof record]> = [
    ['prompt', 'response'],
    ['question', 'answer'],
    ['input', 'output'],
    ['userMessage', 'assistantMessage'],
    ['request', 'response'],
  ];
  for (const [userKey, assistantKey] of pairedFields) {
    const userText = uniqueText(extractTextChunks(record[userKey]));
    const assistantText = uniqueText(extractTextChunks(record[assistantKey]));
    if (!userText && !assistantText) continue;
    const createdAt = parseTimestamp(
      record.createdAt ?? record.timestamp ?? record.date,
      fallbackTs
    );
    const next: Array<{ role: 'user' | 'assistant'; content: string; createdAt: number }> = [];
    if (userText) next.push({ role: 'user', content: userText, createdAt });
    if (assistantText) next.push({ role: 'assistant', content: assistantText, createdAt: createdAt + 1 });
    return next;
  }

  const content = uniqueText(extractTextChunks(record));
  if (!content) return [];
  const role = normalizeImportedRole(
    record.role ?? record.type ?? record.authorRole ?? record.senderRole ?? record.author?.role ?? record.sender?.role
  );
  const createdAt = parseTimestamp(
    record.createdAt ?? record.updatedAt ?? record.timestamp ?? record.date,
    fallbackTs
  );
  return [{ role, content, createdAt }];
}

function normalizeRaycastConversation(chat: unknown, index: number): Record<string, any> | null {
  const record = asRecord(chat);
  if (!record) return null;
  const rawMessages = extractConversationArray(record);
  const messages = rawMessages.flatMap((entry, messageIndex) => extractMessagesFromRaycastEntry(entry, messageIndex));
  if (messages.length === 0) {
    const fallbackContent = uniqueText(extractTextChunks(record.preview ?? record.lastMessage ?? record.summary));
    if (fallbackContent) {
      messages.push({
        role: 'assistant',
        content: fallbackContent,
        createdAt: parseTimestamp(record.updatedAt ?? record.createdAt, Date.now() + index),
      });
    }
  }
  if (messages.length === 0) return null;

  const firstUserMessage = messages.find((message) => message.role === 'user')?.content || '';
  const title = String(record.title || record.name || '').trim() || firstMeaningfulLine(firstUserMessage) || 'Imported Chat';
  const sourceConversationId = String(
    record.id ??
    record.uuid ??
    record.chatId ??
    record.conversationId ??
    record.identifier ??
    ''
  ).trim();
  const createdAt = parseTimestamp(
    record.createdAt ?? record.timestamp ?? messages[0]?.createdAt,
    messages[0]?.createdAt || Date.now() + index
  );
  const updatedAt = parseTimestamp(
    record.updatedAt ?? record.lastUpdatedAt ?? record.modifiedAt ?? messages[messages.length - 1]?.createdAt,
    messages[messages.length - 1]?.createdAt || createdAt
  );

  const metadata: Record<string, any> = {};
  for (const key of ['model', 'modelName', 'provider', 'temperature']) {
    if (record[key] !== undefined) {
      metadata[key] = record[key];
    }
  }

  return {
    id: sourceConversationId ? `raycast-${sourceConversationId}` : undefined,
    title,
    createdAt,
    updatedAt,
    source: 'raycast',
    ...(sourceConversationId ? { sourceConversationId } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    messages: messages.map((message, messageIndex) => ({
      id: `${sourceConversationId || `chat-${index}`}-msg-${messageIndex}`,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })),
  };
}

function importAiChats(data: RaycastBackup, warnings: string[]): RaycastImportBucketResult {
  const source = Array.isArray(data['builtin_package_open-ai']?.aiChats)
    ? data['builtin_package_open-ai']?.aiChats || []
    : [];
  const result = createBucketResult(source.length);
  if (source.length === 0) return result;

  const normalizedConversations = source
    .map((chat, index) => normalizeRaycastConversation(chat, index))
    .filter((conversation): conversation is Record<string, any> => Boolean(conversation));

  result.failed = source.length - normalizedConversations.length;
  if (result.failed > 0) {
    warnings.push(`Skipped ${result.failed} Raycast AI chat${result.failed === 1 ? '' : 's'} that could not be mapped cleanly.`);
  }
  if (normalizedConversations.length === 0) return result;

  const existingIds = new Set(getAiChatSnapshot().conversations.map((conversation) => conversation.id));
  for (const conversation of normalizedConversations) {
    const conversationId = String(conversation.id || '').trim();
    if (conversationId && existingIds.has(conversationId)) {
      result.skipped += 1;
      continue;
    }
    result.imported += 1;
  }

  mergeAiChatSnapshot({
    version: 1,
    conversations: normalizedConversations as any,
  });
  return result;
}

function firstMeaningfulLine(text: string): string {
  const line = String(text || '')
    .split('\n')
    .map((entry) => entry.trim())
    .find(Boolean);
  return line || 'Untitled';
}

function applySettingsFromBackup(
  data: RaycastBackup,
  options: { includeSettings: boolean; includeDisabledCommands: boolean; includeScriptCommandFolders: boolean }
): {
  settingsImported: boolean;
  disabledCommandsImported: number;
  scriptCommandFoldersImported: number;
} {
  const patch: Partial<AppSettings> = {};
  const currentSettings = loadSettings();
  const preferences = data.builtin_package_raycastPreferences;
  if (options.includeSettings) {
    const globalShortcut = decodeRaycastHotkey(preferences?.preferencesGeneral?.raycastGlobalHotkey);
    if (globalShortcut) patch.globalShortcut = globalShortcut;

    const navigationStyle = normalizeNavigationStyle(
      preferences?.preferencesAdvanced?.navigationCommandStyleIdentifierKey
    );
    if (navigationStyle) patch.navigationStyle = navigationStyle;

    const launcherViewMode = normalizeLauncherViewMode(
      preferences?.preferencesAppearance?.raycastPreferredWindowMode
    );
    if (launcherViewMode) patch.launcherViewMode = launcherViewMode;

    const popToRootTimeout = Number(preferences?.preferencesAdvanced?.popToRootTimeout);
    if (Number.isFinite(popToRootTimeout) && popToRootTimeout >= 0) {
      patch.popToRootSearchTimeoutSeconds = popToRootTimeout;
    }
  }

  let disabledCommandsImported = 0;
  const disabledCommandIds = new Set<string>();
  if (options.includeDisabledCommands) {
    for (const extension of data.builtin_package_raycastExtensions?.extensions || []) {
      const extensionName = String(extension?.name || '').trim();
      if (!extensionName) continue;
      for (const command of extension.commands || []) {
        if (!command?.name || command.enabled !== false) continue;
        disabledCommandIds.add(`ext-${extensionName}-${command.name}`);
      }
    }
  }

  const importedScriptCommandFolders = Array.isArray(data.builtin_package_scriptCommands?.scriptCommandsDirectories)
    ? data.builtin_package_scriptCommands?.scriptCommandsDirectories
        ?.map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .map((entry) => entry.startsWith('~/') ? path.join(os.homedir(), entry.slice(2)) : entry) || []
    : [];
  if (options.includeScriptCommandFolders && importedScriptCommandFolders.length > 0) {
    const merged = new Set([
      ...(currentSettings.scriptCommandFolders || []),
      ...importedScriptCommandFolders,
    ]);
    patch.scriptCommandFolders = [...merged];
  }

  if (patch.scriptCommandFolders) {
    saveSettings(patch);
  }

  const disabledScriptCommands = options.includeDisabledCommands && Array.isArray(data.builtin_package_scriptCommands?.disabledCommands)
    ? data.builtin_package_scriptCommands?.disabledCommands || []
    : [];
  if (disabledScriptCommands.length > 0) {
    invalidateScriptCommandsCache();
    const scriptCommandsByPath = new Map(
      discoverScriptCommands().map((command) => [path.resolve(command.scriptPath), command.id] as const)
    );
    for (const rawCommand of disabledScriptCommands) {
      const rawValue = String(rawCommand || '').trim();
      const scriptPath = rawValue.startsWith(RAYCAST_SCRIPT_COMMAND_PREFIX)
        ? normalizeRaycastPath(rawValue.slice(RAYCAST_SCRIPT_COMMAND_PREFIX.length))
        : '';
      if (!scriptPath) continue;
      const commandId = scriptCommandsByPath.get(scriptPath);
      if (!commandId) continue;
      disabledCommandIds.add(commandId);
    }
  }

  if (disabledCommandIds.size > 0) {
    const existing = new Set(loadSettings().disabledCommands || []);
    const beforeSize = existing.size;
    for (const commandId of disabledCommandIds) {
      existing.add(commandId);
    }
    patch.disabledCommands = [...existing];
    disabledCommandsImported = existing.size - beforeSize;
  }

  if (Object.keys(patch).length === 0) {
    return {
      settingsImported: false,
      disabledCommandsImported,
      scriptCommandFoldersImported: importedScriptCommandFolders.length,
    };
  }

  saveSettings(patch);
  return {
    settingsImported: true,
    disabledCommandsImported,
    scriptCommandFoldersImported: importedScriptCommandFolders.length,
  };
}

async function importCommandCustomizations(
  data: RaycastBackup,
  warnings: string[],
  options: {
    includeHotkeys: boolean;
    includeAliases: boolean;
    includePinnedCommands: boolean;
    conflictMode: 'skip' | 'overwrite';
  }
): Promise<{
  commandHotkeysImported: number;
  commandAliasesImported: number;
  pinnedCommandsImported: number;
}> {
  const rootSearchItems = Array.isArray(data.builtin_package_rootSearch?.rootSearch)
    ? data.builtin_package_rootSearch?.rootSearch || []
    : [];
  const pinnedMenuItems = Array.isArray(data.builtin_package_navigation?.pinnedMenuItems)
    ? data.builtin_package_navigation?.pinnedMenuItems || []
    : [];
  if (rootSearchItems.length === 0 && pinnedMenuItems.length === 0) {
    return {
      commandHotkeysImported: 0,
      commandAliasesImported: 0,
      pinnedCommandsImported: 0,
    };
  }

  invalidateScriptCommandsCache();
  invalidateCache();

  const [availableCommands, scriptCommands] = await Promise.all([
    getAvailableCommands(),
    Promise.resolve(discoverScriptCommands()),
  ]);
  const appCommandIdByPath = new Map<string, string>();
  const commandById = new Map<string, CommandInfo>();
  for (const command of availableCommands) {
    commandById.set(command.id, command);
    if (command.category === 'app' && command.path) {
      appCommandIdByPath.set(path.resolve(command.path), command.id);
    }
  }
  const scriptCommandIdByPath = new Map<string, string>();
  for (const command of scriptCommands) {
    scriptCommandIdByPath.set(path.resolve(command.scriptPath), command.id);
  }

  const settings = loadSettings();
  const nextHotkeys = { ...(settings.commandHotkeys || {}) };
  const nextAliases = { ...(settings.commandAliases || {}) };
  const nextPinnedCommands = new Set((settings.pinnedCommands || []).map((entry) => String(entry || '').trim()).filter(Boolean));

  let commandHotkeysImported = 0;
  let commandAliasesImported = 0;
  let pinnedCommandsImported = 0;
  let hotkeyConflictCount = 0;
  let hotkeyUnmappedCount = 0;
  let aliasConflictCount = 0;
  let aliasUnmappedCount = 0;
  let favoriteUnmappedCount = 0;

  for (const item of rootSearchItems) {
    const hasHotkey = options.includeHotkeys && Boolean(String(item?.hotkey || '').trim());
    const hasSearchTerms = options.includeAliases && Boolean(String(item?.searchTerms || '').trim());
    if (!hasHotkey && !hasSearchTerms) continue;

    const commandId = resolveRaycastCommandId(item, appCommandIdByPath, scriptCommandIdByPath);
    if (!commandId) {
      if (hasHotkey) hotkeyUnmappedCount += 1;
      if (hasSearchTerms) aliasUnmappedCount += 1;
      continue;
    }

    if (hasHotkey) {
      const decodedHotkey = decodeRaycastHotkey(item.hotkey);
      if (decodedHotkey) {
        const existingHotkey = String(nextHotkeys[commandId] || '').trim();
        if (!existingHotkey) {
          nextHotkeys[commandId] = decodedHotkey;
          commandHotkeysImported += 1;
        } else if (existingHotkey !== decodedHotkey && options.conflictMode === 'overwrite') {
          nextHotkeys[commandId] = decodedHotkey;
          commandHotkeysImported += 1;
        } else if (existingHotkey !== decodedHotkey) {
          hotkeyConflictCount += 1;
        }
      }
    }

    if (hasSearchTerms) {
      const aliasCandidate = normalizeAliasCandidate(item.searchTerms);
      if (!aliasCandidate) continue;
      const existingAlias = String(nextAliases[commandId] || '').trim();
      if (!existingAlias) {
        nextAliases[commandId] = aliasCandidate;
        commandAliasesImported += 1;
      } else if (existingAlias !== aliasCandidate && options.conflictMode === 'overwrite') {
        nextAliases[commandId] = aliasCandidate;
        commandAliasesImported += 1;
      } else if (existingAlias !== aliasCandidate) {
        aliasConflictCount += 1;
      }
    }
  }

  for (const rawPinnedItem of options.includePinnedCommands ? pinnedMenuItems : []) {
    const pinnedItem = typeof rawPinnedItem === 'string'
      ? { key: rawPinnedItem }
      : rawPinnedItem;
    const commandId = resolveRaycastCommandId(pinnedItem, appCommandIdByPath, scriptCommandIdByPath);
    if (!commandId) {
      favoriteUnmappedCount += 1;
      continue;
    }
    if (!commandById.has(commandId)) {
      favoriteUnmappedCount += 1;
      continue;
    }
    if (!nextPinnedCommands.has(commandId)) {
      nextPinnedCommands.add(commandId);
      pinnedCommandsImported += 1;
    }
  }

  const patch: Partial<AppSettings> = {};
  if (commandHotkeysImported > 0) {
    patch.commandHotkeys = nextHotkeys;
  }
  if (commandAliasesImported > 0) {
    patch.commandAliases = nextAliases;
  }
  if (pinnedCommandsImported > 0) {
    patch.pinnedCommands = [...nextPinnedCommands];
  }
  if (Object.keys(patch).length > 0) {
    saveSettings(patch);
  }

  if (hotkeyConflictCount > 0) {
    warnings.push(`Skipped ${hotkeyConflictCount} Raycast command hotkey${hotkeyConflictCount === 1 ? '' : 's'} because SuperCmd already has a different shortcut.`);
  }
  if (hotkeyUnmappedCount > 0) {
    warnings.push(`Skipped ${hotkeyUnmappedCount} Raycast command hotkey${hotkeyUnmappedCount === 1 ? '' : 's'} that could not be mapped to a SuperCmd command.`);
  }
  if (aliasConflictCount > 0) {
    warnings.push(`Skipped ${aliasConflictCount} Raycast alias candidate${aliasConflictCount === 1 ? '' : 's'} because SuperCmd already has a different alias.`);
  }
  if (aliasUnmappedCount > 0) {
    warnings.push(`Skipped ${aliasUnmappedCount} Raycast search alias candidate${aliasUnmappedCount === 1 ? '' : 's'} that could not be mapped to a SuperCmd command.`);
  }
  if (favoriteUnmappedCount > 0) {
    warnings.push(`Skipped ${favoriteUnmappedCount} Raycast favorite${favoriteUnmappedCount === 1 ? '' : 's'} that could not be mapped to a SuperCmd command.`);
  }

  return {
    commandHotkeysImported,
    commandAliasesImported,
    pinnedCommandsImported,
  };
}

function importQuicklinks(data: RaycastBackup, conflictMode: 'skip' | 'overwrite'): RaycastImportBucketResult {
  const source = Array.isArray(data.builtin_package_quicklinks?.quicklinks)
    ? data.builtin_package_quicklinks?.quicklinks || []
    : [];
  const result = createBucketResult(source.length);
  const existing = getAllQuickLinks();
  const existingKeys = new Set(
    existing.map((item) => `${item.name.trim().toLowerCase()}::${item.urlTemplate.trim().toLowerCase()}`)
  );

  for (const quicklink of source) {
    const name = String(quicklink?.name || '').trim();
    const url = String(quicklink?.url || '').trim();
    if (!name || !url) {
      result.failed += 1;
      continue;
    }
    const dedupeKey = `${name.toLowerCase()}::${url.toLowerCase()}`;
    if (existingKeys.has(dedupeKey) && conflictMode !== 'overwrite') {
      result.skipped += 1;
      continue;
    }
    if (existingKeys.has(dedupeKey) && conflictMode === 'overwrite') {
      const duplicate = existing.find((item) => `${item.name.trim().toLowerCase()}::${item.urlTemplate.trim().toLowerCase()}` === dedupeKey);
      if (duplicate) {
        result.skipped += 1;
        continue;
      }
    }
    createQuickLink({
      name,
      urlTemplate: url,
      icon: url.includes('{argument}') ? 'Search' : 'Globe',
    });
    existingKeys.add(dedupeKey);
    result.imported += 1;
  }

  return result;
}

function importSnippets(data: RaycastBackup, conflictMode: 'skip' | 'overwrite'): RaycastImportBucketResult {
  const source = Array.isArray(data.builtin_package_snippets?.snippets)
    ? data.builtin_package_snippets?.snippets || []
    : [];
  const result = createBucketResult(source.length);
  const existing = getAllSnippets();

  for (const snippet of source) {
    const name = String(snippet?.name || '').trim();
    const content = typeof snippet?.text === 'string' ? snippet.text : '';
    const keyword = typeof snippet?.keyword === 'string' ? snippet.keyword.trim() : undefined;
    if (!name || content.length === 0) {
      result.failed += 1;
      continue;
    }
    const duplicate = existing.find(
      (item) =>
        item.name.trim().toLowerCase() === name.toLowerCase() ||
        (keyword && item.keyword && item.keyword.trim().toLowerCase() === keyword.toLowerCase())
    );
    if (duplicate) {
      if (conflictMode === 'overwrite') {
        updateSnippet(duplicate.id, { name, content, keyword, pinned: Boolean(snippet?.pinned) });
        result.imported += 1;
        continue;
      }
      result.skipped += 1;
      continue;
    }
    const created = createSnippet({ name, content, keyword });
    if (snippet?.pinned) {
      updateSnippet(created.id, { pinned: true });
    }
    existing.push({ ...created, pinned: Boolean(snippet?.pinned) });
    result.imported += 1;
  }

  return result;
}

function importNotes(data: RaycastBackup, conflictMode: 'skip' | 'overwrite'): RaycastImportBucketResult {
  const source = Array.isArray(data.builtin_package_raycastNotes?.notes)
    ? data.builtin_package_raycastNotes?.notes || []
    : [];
  const result = createBucketResult(source.length);
  const existing = getAllNotes();

  for (const note of source) {
    const content = String(note?.text || '').trim();
    const title = String(note?.title || '').trim() || firstMeaningfulLine(content);
    if (!title && !content) {
      result.failed += 1;
      continue;
    }
    const duplicate = existing.find(
      (item) =>
        item.title.trim().toLowerCase() === title.toLowerCase() &&
        item.content.trim() === content
    );
    if (duplicate) {
      if (conflictMode === 'overwrite') {
        updateNote(duplicate.id, { title, content, pinned: Boolean(note?.pinned) });
        result.imported += 1;
        continue;
      }
      result.skipped += 1;
      continue;
    }
    const created = createNote({ title, content });
    if (note?.pinned) {
      updateNote(created.id, { pinned: true });
    }
    existing.push({ ...created, content, title, pinned: Boolean(note?.pinned) });
    result.imported += 1;
  }

  return result;
}

async function importExtensions(
  data: RaycastBackup,
  warnings: string[],
  onProgress?: (payload: {
    message: string;
    currentItem: number;
    totalItems: number;
    extensionName?: string;
    downloadedBytes?: number;
    totalBytes?: number;
  }) => void
): Promise<RaycastImportBucketResult> {
  const source = Array.isArray(data.builtin_package_raycastExtensions?.extensions)
    ? data.builtin_package_raycastExtensions?.extensions || []
    : [];
  const result = createBucketResult(source.length);
  const installed = new Set((await getInstalledExtensionNames()).map((entry) => String(entry || '').trim()));

  for (let index = 0; index < source.length; index += 1) {
    const extension = source[index];
    const extensionName = String(extension?.name || '').trim();
    onProgress?.({
      message: extensionName ? `Preparing extension ${extensionName}` : 'Preparing extension',
      currentItem: index + 1,
      totalItems: source.length,
      extensionName: extensionName || undefined,
    });
    if (!extensionName) {
      result.failed += 1;
      continue;
    }
    if (installed.has(extensionName)) {
      onProgress?.({
        message: `${extensionName} already installed`,
        currentItem: index + 1,
        totalItems: source.length,
        extensionName,
      });
      result.skipped += 1;
      continue;
    }
    try {
      onProgress?.({
        message: `Installing ${extensionName}…`,
        currentItem: index + 1,
        totalItems: source.length,
        extensionName,
      });
      const success = await installExtension(extensionName, {
        onProgress: (payload) => {
          onProgress?.({
            message: payload.message,
            currentItem: index + 1,
            totalItems: source.length,
            extensionName,
            downloadedBytes: payload.downloadedBytes,
            totalBytes: payload.totalBytes,
          });
        },
      });
      if (!success) {
        result.failed += 1;
        warnings.push(`Failed to install extension "${extensionName}".`);
        onProgress?.({
          message: `Failed to install ${extensionName}`,
          currentItem: index + 1,
          totalItems: source.length,
          extensionName,
        });
        continue;
      }
      installed.add(extensionName);
      result.imported += 1;
      onProgress?.({
        message: `Installed ${extensionName}`,
        currentItem: index + 1,
        totalItems: source.length,
        extensionName,
      });
    } catch (error: any) {
      result.failed += 1;
      warnings.push(`Failed to install extension "${extensionName}": ${String(error?.message || error || 'unknown error')}`);
      onProgress?.({
        message: `Failed to install ${extensionName}`,
        currentItem: index + 1,
        totalItems: source.length,
        extensionName,
      });
    }
  }

  return result;
}

type ImportProgressReporter = (payload: Omit<RaycastImportProgress, 'sessionId'>) => void;

function importExtensionPreferences(data: RaycastBackup, conflictMode: 'skip' | 'overwrite'): string[] {
  const importedExtensionNames = new Set<string>();
  for (const extension of data.builtin_package_raycastExtensions?.extensions || []) {
    const extensionName = String(extension?.name || '').trim();
    if (!extensionName || !Array.isArray(extension.prefs) || extension.prefs.length === 0) continue;
    const nextValues: Record<string, any> = {};
    for (const pref of extension.prefs) {
      const prefName = String(pref?.name || '').trim();
      if (!prefName) continue;
      if (!Object.prototype.hasOwnProperty.call(pref || {}, 'value')) continue;
      nextValues[prefName] = (pref as any).value;
    }
    if (Object.keys(nextValues).length === 0) continue;
    const currentValues = getExtensionPreferences(extensionName);
    if (conflictMode === 'skip') {
      for (const prefName of Object.keys(nextValues)) {
        if (currentValues[prefName] !== undefined) {
          delete nextValues[prefName];
        }
      }
      if (Object.keys(nextValues).length === 0) continue;
    }
    setExtensionPreferences(extensionName, {
      ...currentValues,
      ...nextValues,
    });
    importedExtensionNames.add(extensionName);
  }
  return [...importedExtensionNames];
}

function createEmptyImportResult(partial?: Partial<RaycastImportResult>): RaycastImportResult {
  return {
    canceled: false,
    settingsImported: false,
    disabledCommandsImported: 0,
    scriptCommandFoldersImported: 0,
    commandHotkeysImported: 0,
    commandAliasesImported: 0,
    pinnedCommandsImported: 0,
    aiChats: createBucketResult(),
    quicklinks: createBucketResult(),
    snippets: createBucketResult(),
    notes: createBucketResult(),
    extensions: createBucketResult(),
    importedExtensionPreferenceExtensions: [],
    unsupported: [],
    warnings: [],
    ...partial,
  };
}

function createEmptyPreview(partial?: Partial<RaycastImportPreview>): RaycastImportPreview {
  return {
    canceled: false,
    selections: createDefaultSelections(),
    counts: {
      settings: 0,
      disabledCommands: 0,
      scriptCommandFolders: 0,
      commandHotkeys: 0,
      commandAliases: 0,
      pinnedCommands: 0,
      aiChats: 0,
      quicklinks: 0,
      snippets: 0,
      notes: 0,
      extensions: 0,
      extensionPreferences: 0,
    },
    unsupported: [],
    warnings: [],
    ...partial,
  };
}

async function selectAndLoadRaycastBackup(parentWindow?: BrowserWindow): Promise<{
  canceled: boolean;
  filePath?: string;
  backup?: RaycastBackup;
}> {
  const dialogOptions = {
    title: 'Import Raycast Backup',
    filters: [
      { name: 'Raycast Backup', extensions: ['rayconfig', 'json'] },
    ],
    properties: ['openFile'] as Array<'openFile'>,
  };

  const selection = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (selection.canceled || selection.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = path.resolve(selection.filePaths[0]);
  let backup: RaycastBackup | null = null;
  let password: string | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      backup = loadRaycastBackupFromFile(filePath, password);
      break;
    } catch (error: any) {
      const message = String(error?.message || error || '');
      if (
        message.includes('password is not valid') ||
        message.includes('password is required')
      ) {
        const promptedPassword = promptForPassword(attempt === 0 ? PASSWORD_PROMPT_MESSAGE : PASSWORD_RETRY_MESSAGE);
        if (!promptedPassword) {
          return { canceled: true, filePath };
        }
        password = promptedPassword;
        continue;
      }
      throw error;
    }
  }

  if (!backup) {
    throw new Error('Failed to read import data; password is not valid.');
  }

  return {
    canceled: false,
    filePath,
    backup,
  };
}

export async function previewRaycastConfigImport(parentWindow?: BrowserWindow): Promise<RaycastImportPreview> {
  const loaded = await selectAndLoadRaycastBackup(parentWindow);
  if (loaded.canceled || !loaded.backup || !loaded.filePath) {
    return createEmptyPreview({
      canceled: true,
      filePath: loaded.filePath,
    });
  }

  const sessionId = createImportSessionId();
  importSessions.set(sessionId, {
    filePath: loaded.filePath,
    backup: loaded.backup,
  });

  return createEmptyPreview({
    canceled: false,
    sessionId,
    filePath: loaded.filePath,
    raycastVersion: loaded.backup.raycast_version,
    counts: countPreviewStats(loaded.backup),
    unsupported: collectUnsupportedCategories(loaded.backup),
  });
}

export async function executeRaycastConfigImport(
  options: RaycastImportOptions,
  reportProgress?: ImportProgressReporter
): Promise<RaycastImportResult> {
  const session = importSessions.get(String(options.sessionId || '').trim());
  if (!session) {
    throw new Error('Raycast import session expired. Choose the backup again.');
  }

  const backup = session.backup;
  const filePath = session.filePath;
  const warnings: string[] = [];
  const previewCounts = countPreviewStats(backup);
  const totalSteps = Math.max(
    1,
    Number(Boolean(options.selections.settings || options.selections.disabledCommands || options.selections.scriptCommandFolders)) +
      Number(Boolean(options.selections.aiChats)) +
      Number(Boolean(options.selections.quicklinks)) +
      Number(Boolean(options.selections.snippets)) +
      Number(Boolean(options.selections.notes)) +
      Number(Boolean(options.selections.extensions)) +
      Number(Boolean(options.selections.extensionPreferences)) +
      Number(Boolean(options.selections.commandHotkeys)) +
      Number(Boolean(options.selections.commandAliases)) +
      Number(Boolean(options.selections.pinnedCommands))
  );
  let completedSteps = 0;
  const emitCategoryProgress = (
    category: keyof RaycastImportSelections,
    message: string,
    currentItem?: number,
    totalItems?: number,
    extensionName?: string,
    downloadedBytes?: number,
    totalBytes?: number,
    stage: RaycastImportProgress['stage'] = extensionName ? 'extension' : 'category'
  ) => {
    reportProgress?.({
      stage,
      category,
      message,
      completedSteps,
      totalSteps,
      ...(currentItem !== undefined ? { currentItem } : {}),
      ...(totalItems !== undefined ? { totalItems } : {}),
      ...(extensionName ? { extensionName } : {}),
      ...(downloadedBytes !== undefined ? { downloadedBytes } : {}),
      ...(totalBytes !== undefined ? { totalBytes } : {}),
    });
  };
  reportProgress?.({
    stage: 'starting',
    message: 'Starting Raycast import…',
    completedSteps,
    totalSteps,
  });

  const { settingsImported, disabledCommandsImported, scriptCommandFoldersImported } = applySettingsFromBackup(backup, {
    includeSettings: options.selections.settings,
    includeDisabledCommands: options.selections.disabledCommands,
    includeScriptCommandFolders: options.selections.scriptCommandFolders,
  });
  if (options.selections.settings || options.selections.disabledCommands || options.selections.scriptCommandFolders) {
    completedSteps += 1;
    emitCategoryProgress('settings', 'Applied mapped settings and command state');
  }

  const aiChats = options.selections.aiChats ? importAiChats(backup, warnings) : createBucketResult(previewCounts.aiChats);
  if (options.selections.aiChats) {
    completedSteps += 1;
    emitCategoryProgress('aiChats', `Imported ${aiChats.imported} AI chats`);
  }

  const quicklinks = options.selections.quicklinks ? importQuicklinks(backup, options.conflictMode) : createBucketResult(previewCounts.quicklinks);
  if (options.selections.quicklinks) {
    completedSteps += 1;
    emitCategoryProgress('quicklinks', `Imported ${quicklinks.imported} quicklinks`);
  }

  const snippets = options.selections.snippets ? importSnippets(backup, options.conflictMode) : createBucketResult(previewCounts.snippets);
  if (options.selections.snippets) {
    completedSteps += 1;
    emitCategoryProgress('snippets', `Imported ${snippets.imported} snippets`);
  }

  const notes = options.selections.notes ? importNotes(backup, options.conflictMode) : createBucketResult(previewCounts.notes);
  if (options.selections.notes) {
    completedSteps += 1;
    emitCategoryProgress('notes', `Imported ${notes.imported} notes`);
  }

  const extensions = options.selections.extensions
    ? await importExtensions(backup, warnings, (payload) => {
        emitCategoryProgress(
          'extensions',
          payload.message,
          payload.currentItem,
          payload.totalItems,
          payload.extensionName,
          payload.downloadedBytes,
          payload.totalBytes,
          'extension'
        );
      })
    : createBucketResult(previewCounts.extensions);
  if (options.selections.extensions) {
    completedSteps += 1;
    emitCategoryProgress('extensions', `Processed ${extensions.found} extensions`);
  }

  const importedExtensionPreferenceExtensions = options.selections.extensionPreferences
    ? importExtensionPreferences(backup, options.conflictMode)
    : [];
  if (options.selections.extensionPreferences) {
    completedSteps += 1;
    emitCategoryProgress('extensionPreferences', `Imported prefs for ${importedExtensionPreferenceExtensions.length} extensions`);
  }

  const {
    commandHotkeysImported,
    commandAliasesImported,
    pinnedCommandsImported,
  } = await importCommandCustomizations(backup, warnings, {
    includeHotkeys: options.selections.commandHotkeys,
    includeAliases: options.selections.commandAliases,
    includePinnedCommands: options.selections.pinnedCommands,
    conflictMode: options.conflictMode,
  });
  if (options.selections.commandHotkeys) {
    completedSteps += 1;
    emitCategoryProgress('commandHotkeys', `Imported ${commandHotkeysImported} command hotkeys`);
  }
  if (options.selections.commandAliases) {
    completedSteps += 1;
    emitCategoryProgress('commandAliases', `Imported ${commandAliasesImported} aliases`);
  }
  if (options.selections.pinnedCommands) {
    completedSteps += 1;
    emitCategoryProgress('pinnedCommands', `Imported ${pinnedCommandsImported} favorites`);
  }

  importSessions.delete(options.sessionId);
  reportProgress?.({
    stage: 'done',
    message: 'Raycast import complete',
    completedSteps: totalSteps,
    totalSteps,
  });

  return createEmptyImportResult({
    canceled: false,
    filePath,
    raycastVersion: backup.raycast_version,
    settingsImported,
    disabledCommandsImported,
    scriptCommandFoldersImported,
    commandHotkeysImported,
    commandAliasesImported,
    pinnedCommandsImported,
    aiChats,
    quicklinks,
    snippets,
    notes,
    extensions,
    importedExtensionPreferenceExtensions,
    unsupported: collectUnsupportedCategories(backup),
    warnings,
  });
}

export async function importRaycastConfigFromFile(parentWindow?: BrowserWindow): Promise<RaycastImportResult> {
  const preview = await previewRaycastConfigImport(parentWindow);
  if (preview.canceled || !preview.sessionId) {
    return createEmptyImportResult({
      canceled: true,
      filePath: preview.filePath,
      raycastVersion: preview.raycastVersion,
      unsupported: preview.unsupported,
    });
  }

  const confirm = parentWindow
    ? await dialog.showMessageBox(parentWindow, {
        type: 'question',
        buttons: ['Cancel', 'Import'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
        title: 'Import Raycast Backup',
        message: 'Review the Raycast backup before importing.',
        detail: buildImportPreview(importSessions.get(preview.sessionId)?.backup || { raycast_version: preview.raycastVersion }),
      })
    : await dialog.showMessageBox({
        type: 'question',
        buttons: ['Cancel', 'Import'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
        title: 'Import Raycast Backup',
        message: 'Review the Raycast backup before importing.',
        detail: buildImportPreview(importSessions.get(preview.sessionId)?.backup || { raycast_version: preview.raycastVersion }),
      });

  if (confirm.response !== 1) {
    importSessions.delete(preview.sessionId);
    return createEmptyImportResult({
      canceled: true,
      filePath: preview.filePath,
      raycastVersion: preview.raycastVersion,
      unsupported: preview.unsupported,
    });
  }

  return executeRaycastConfigImport({
    sessionId: preview.sessionId,
    conflictMode: 'skip',
    selections: preview.selections,
  });
}
