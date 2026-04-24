/**
 * Settings Store
 *
 * Simple JSON-file persistence for app settings.
 * Stored at ~/Library/Application Support/SuperCmd/settings.json
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface AISettings {
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openai-compatible';
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  elevenlabsApiKey: string;
  supermemoryApiKey: string;
  supermemoryClient: string;
  supermemoryBaseUrl: string;
  supermemoryLocalMode: boolean;
  ollamaBaseUrl: string;
  defaultModel: string;
  speechCorrectionModel: string;
  speechToTextModel: string;
  speechLanguage: string;
  textToSpeechModel: string;
  edgeTtsVoice: string;
  speechCorrectionEnabled: boolean;
  enabled: boolean;
  llmEnabled: boolean;
  whisperEnabled: boolean;
  readEnabled: boolean;
  openaiCompatibleBaseUrl: string;
  openaiCompatibleApiKey: string;
  openaiCompatibleModel: string;
}

export type HyperKeySourceKey =
  | 'caps-lock'
  | 'left-control'
  | 'left-shift'
  | 'left-option'
  | 'left-command'
  | 'right-control'
  | 'right-shift'
  | 'right-option'
  | 'right-command';

export type HyperKeyCapsLockTapBehavior = 'escape' | 'nothing' | 'toggle';

export interface HyperKeySettings {
  enabled: boolean;
  sourceKey: HyperKeySourceKey;
  capsLockTapBehavior: HyperKeyCapsLockTapBehavior;
}

export type AppFontSize = 'extra-small' | 'small' | 'medium' | 'large' | 'extra-large';
export type AppUiStyle = 'default' | 'glassy';
export type LauncherViewMode = 'expanded' | 'compact';
export type AppNavigationStyle = 'vim' | 'macos';
export type AppLanguage =
  | 'system'
  | 'en'
  | 'zh-Hans'
  | 'zh-Hant'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru'
  | 'it';

export interface AppSettings {
  globalShortcut: string;
  openAtLogin: boolean;
  disabledCommands: string[];
  enabledCommands: string[];
  customExtensionFolders: string[];
  commandHotkeys: Record<string, string>;
  commandAliases: Record<string, string>;
  pinnedCommands: string[];
  pinnedFiles: string[];
  recentCommands: string[];
  recentCommandLaunchCounts: Record<string, number>;
  hasSeenOnboarding: boolean;
  hasSeenWhisperOnboarding: boolean;
  fileSearchProtectedRootsEnabled: boolean;
  disableFileSearchResults: boolean;
  ai: AISettings;
  commandMetadata?: Record<string, { subtitle?: string }>;
  debugMode: boolean;
  appLanguage: AppLanguage;
  fontSize: AppFontSize;
  uiStyle: AppUiStyle;
  baseColor: string;
  launcherBackgroundImagePath: string;
  launcherBackgroundImageEverywhere: boolean;
  launcherBackgroundImageBlurPercent: number;
  launcherBackgroundImageOpacityPercent: number;
  appUpdaterLastCheckedAt: number;
  updateBannerDismissedAt?: number;
  hyperKey: HyperKeySettings;
  launcherViewMode: LauncherViewMode;
  navigationStyle: AppNavigationStyle;
  // Auto-prune clipboard items older than N days. `null` = never prune.
  clipboardHistoryRetentionDays: number | null;
  // Bundle IDs of applications whose clipboard copies should NOT be saved to
  // SuperCmd's clipboard history. Clipboard content copied while one of these
  // apps is frontmost is simply ignored. The system pasteboard is untouched.
  clipboardAppBlacklist: string[];
  emojiPickerEnabled: boolean;
  emojiPickerTriggerPrefix: string;
  /**
   * Agent approval policy for tool calls that modify the system
   * (run_shell, run_applescript, write_file, apply_patch):
   *   - 'prompt' (default): always ask the user before running
   *   - 'auto-workspace': auto-approve writes confined to the current folder
   *     and its descendants; still prompt for shell/AppleScript
   *   - 'auto-all': run everything without prompting (power users)
   */
  agentApprovalMode?: 'prompt' | 'auto-workspace' | 'auto-all';
  /**
   * MCP (Model Context Protocol) servers to spawn for the agent. Each
   * keyed entry becomes a stdio subprocess whose tools are prefixed as
   * `<serverId>__<toolName>` and merged into the agent's tool list.
   * Example:
   *   "linear": { "command": "npx", "args": ["-y", "@linear/mcp"] }
   */
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }>;
}

const DEFAULT_HYPER_KEY_SETTINGS: HyperKeySettings = {
  enabled: false,
  sourceKey: 'caps-lock',
  capsLockTapBehavior: 'nothing',
};

const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'openai',
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiApiKey: '',
  elevenlabsApiKey: '',
  supermemoryApiKey: '',
  supermemoryClient: '',
  supermemoryBaseUrl: 'https://api.supermemory.ai',
  supermemoryLocalMode: false,
  ollamaBaseUrl: 'http://localhost:11434',
  defaultModel: '',
  speechCorrectionModel: '',
  speechToTextModel: 'whispercpp',
  speechLanguage: 'en-US',
  textToSpeechModel: 'edge-tts',
  edgeTtsVoice: 'en-US-EricNeural',
  speechCorrectionEnabled: false,
  enabled: true,
  llmEnabled: true,
  whisperEnabled: true,
  readEnabled: true,
  openaiCompatibleBaseUrl: '',
  openaiCompatibleApiKey: '',
  openaiCompatibleModel: '',
};

const DEFAULT_SETTINGS: AppSettings = {
  globalShortcut: 'Alt+Space',
  openAtLogin: false,
  disabledCommands: [],
  enabledCommands: [],
  customExtensionFolders: [],
  commandHotkeys: {
    'system-supercmd-whisper': 'Command+Shift+W',
    'system-supercmd-whisper-speak-toggle': 'Fn',
    'system-supercmd-speak': 'Command+Shift+S',
    'system-window-management-left': 'Control+Alt+Left',
    'system-window-management-right': 'Control+Alt+Right',
    'system-window-management-top': 'Control+Alt+Up',
    'system-window-management-bottom': 'Control+Alt+Down',
    'system-window-management-top-left': 'Control+Alt+U',
    'system-window-management-top-right': 'Control+Alt+I',
    'system-window-management-bottom-left': 'Control+Alt+J',
    'system-window-management-bottom-right': 'Control+Alt+K',
    'system-window-management-first-third': 'Control+Alt+D',
    'system-window-management-center-third': 'Control+Alt+F',
    'system-window-management-last-third': 'Control+Alt+G',
    'system-window-management-first-two-thirds': 'Control+Alt+E',
    'system-window-management-center-two-thirds': 'Control+Alt+R',
    'system-window-management-last-two-thirds': 'Control+Alt+T',
    'system-window-management-center': 'Control+Alt+C',
    'system-window-management-fill': 'Control+Alt+Return',
    'system-window-management-increase-size-10': 'Control+Alt+=',
    'system-window-management-decrease-size-10': 'Control+Alt+-',
  },
  commandAliases: {},
  pinnedCommands: ['system-open-settings'],
  pinnedFiles: [],
  recentCommands: [],
  recentCommandLaunchCounts: {},
  hasSeenOnboarding: false,
  hasSeenWhisperOnboarding: false,
  fileSearchProtectedRootsEnabled: false,
  disableFileSearchResults: false,
  ai: { ...DEFAULT_AI_SETTINGS },
  debugMode: false,
  appLanguage: 'system',
  fontSize: 'medium',
  uiStyle: 'glassy',
  baseColor: '#101113',
  launcherBackgroundImagePath: '',
  launcherBackgroundImageEverywhere: false,
  launcherBackgroundImageBlurPercent: 25,
  launcherBackgroundImageOpacityPercent: 45,
  appUpdaterLastCheckedAt: 0,
  hyperKey: { ...DEFAULT_HYPER_KEY_SETTINGS },
  launcherViewMode: 'expanded',
  navigationStyle: 'vim',
  clipboardHistoryRetentionDays: null,
  clipboardAppBlacklist: [],
  emojiPickerEnabled: true,
  emojiPickerTriggerPrefix: ':',
  // Default to auto-workspace: agent can run shell commands and edit files
  // confined to the current folder without prompting; only clearly
  // destructive or out-of-workspace ops require approval.
  agentApprovalMode: 'auto-workspace',
  mcpServers: {},
};

let settingsCache: AppSettings | null = null;

function normalizeFontSize(value: any): AppFontSize {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'x-small') return 'extra-small';
  if (normalized === 'x-large') return 'extra-large';
  if (
    normalized === 'extra-small' ||
    normalized === 'small' ||
    normalized === 'medium' ||
    normalized === 'large' ||
    normalized === 'extra-large'
  ) {
    return normalized;
  }
  return 'medium';
}

function normalizeUiStyle(value: any): AppUiStyle {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'glassy') return 'glassy';
  return 'default';
}

function normalizeNavigationStyle(value: any): AppNavigationStyle {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'macos') return 'macos';
  return 'vim';
}

function normalizeClipboardAppBlacklist(value: any): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const normalized = String(entry || '').trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

const ALLOWED_CLIPBOARD_RETENTION_DAYS = new Set([1, 7, 30, 90, 180, 365]);

function normalizeClipboardHistoryRetentionDays(value: any): number | null {
  if (value === null) return null;
  if (value === undefined) return DEFAULT_SETTINGS.clipboardHistoryRetentionDays;
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.clipboardHistoryRetentionDays;
  const int = Math.trunc(num);
  if (ALLOWED_CLIPBOARD_RETENTION_DAYS.has(int)) return int;
  return DEFAULT_SETTINGS.clipboardHistoryRetentionDays;
}

function normalizeAppLanguage(value: any): AppLanguage {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalized || normalized === 'system' || normalized === 'auto') return 'system';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (
    normalized === 'zh' ||
    normalized === 'zh-cn' ||
    normalized === 'zh-sg' ||
    normalized === 'zh-hans' ||
    normalized.startsWith('zh-hans-')
  ) {
    return 'zh-Hans';
  }
  if (
    normalized === 'zh-tw' ||
    normalized === 'zh-hk' ||
    normalized === 'zh-mo' ||
    normalized === 'zh-hant' ||
    normalized.startsWith('zh-hant-')
  ) {
    return 'zh-Hant';
  }
  if (normalized === 'ja' || normalized === 'jp' || normalized.startsWith('ja-')) return 'ja';
  if (normalized === 'ko' || normalized === 'kr' || normalized.startsWith('ko-')) return 'ko';
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr';
  if (normalized === 'de' || normalized.startsWith('de-')) return 'de';
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es';
  if (normalized === 'ru' || normalized.startsWith('ru-')) return 'ru';
  if (normalized === 'it' || normalized.startsWith('it-')) return 'it';
  return DEFAULT_SETTINGS.appLanguage;
}

function normalizeBaseColor(value: any): string {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const short = raw.slice(1).split('').map((ch) => `${ch}${ch}`).join('');
    return `#${short}`.toLowerCase();
  }
  return DEFAULT_SETTINGS.baseColor;
}

function normalizeLauncherBackgroundImagePath(value: any): string {
  return String(value || '').trim();
}

function normalizePercentage(value: any, fallback: number): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsedValue)));
}

function normalizeBoolean(value: any, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeRecentCommandLaunchCounts(value: any): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const normalized: Record<string, number> = {};
  for (const [commandId, launchCount] of Object.entries(value as Record<string, any>)) {
    const id = String(commandId || '').trim();
    if (!id) continue;
    const parsedCount = Number(launchCount);
    if (!Number.isFinite(parsedCount) || parsedCount <= 0) continue;
    normalized[id] = Math.floor(parsedCount);
  }
  return normalized;
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  if (settingsCache) return { ...settingsCache };

  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const parsedHotkeys = { ...(parsed.commandHotkeys || {}) };
    const parsedAliases = { ...(parsed.commandAliases || {}) } as Record<string, any>;
    const hasParsedHotkey = (key: string) => Object.prototype.hasOwnProperty.call(parsedHotkeys, key);
    if (!hasParsedHotkey('system-supercmd-whisper-speak-toggle')) {
      if (parsedHotkeys['system-supercmd-whisper-start']) {
        parsedHotkeys['system-supercmd-whisper-speak-toggle'] = parsedHotkeys['system-supercmd-whisper-start'];
      } else if (parsedHotkeys['system-supercmd-whisper-stop']) {
        parsedHotkeys['system-supercmd-whisper-speak-toggle'] = parsedHotkeys['system-supercmd-whisper-stop'];
      }
    }
    if (hasParsedHotkey('system-supercmd-whisper-toggle')) {
      if (!hasParsedHotkey('system-supercmd-whisper-start')) {
        parsedHotkeys['system-supercmd-whisper-start'] = parsedHotkeys['system-supercmd-whisper-toggle'];
      }
      if (!hasParsedHotkey('system-supercmd-whisper')) {
        parsedHotkeys['system-supercmd-whisper'] = parsedHotkeys['system-supercmd-whisper-toggle'];
      }
    }
    delete parsedHotkeys['system-supercmd-whisper-toggle'];
    delete parsedHotkeys['system-supercmd-whisper-start'];
    delete parsedHotkeys['system-supercmd-whisper-stop'];
    const normalizedAliases: Record<string, string> = {};
    for (const [commandId, aliasValue] of Object.entries(parsedAliases)) {
      const normalizedCommandId = String(commandId || '').trim();
      const normalizedAlias = String(aliasValue || '').trim();
      if (!normalizedCommandId || !normalizedAlias) continue;
      normalizedAliases[normalizedCommandId] = normalizedAlias;
    }
    settingsCache = {
      globalShortcut: parsed.globalShortcut ?? DEFAULT_SETTINGS.globalShortcut,
      openAtLogin: parsed.openAtLogin ?? DEFAULT_SETTINGS.openAtLogin,
      disabledCommands: parsed.disabledCommands ?? DEFAULT_SETTINGS.disabledCommands,
      enabledCommands: parsed.enabledCommands ?? DEFAULT_SETTINGS.enabledCommands,
      customExtensionFolders: Array.isArray(parsed.customExtensionFolders)
        ? parsed.customExtensionFolders
            .map((value: any) => String(value || '').trim())
            .filter(Boolean)
        : DEFAULT_SETTINGS.customExtensionFolders,
      commandHotkeys: {
        ...DEFAULT_SETTINGS.commandHotkeys,
        ...parsedHotkeys,
      },
      commandAliases: {
        ...DEFAULT_SETTINGS.commandAliases,
        ...normalizedAliases,
      },
      pinnedCommands: parsed.pinnedCommands ?? DEFAULT_SETTINGS.pinnedCommands,
      pinnedFiles: Array.isArray(parsed.pinnedFiles)
        ? parsed.pinnedFiles
            .map((value: any) => String(value || '').trim())
            .filter(Boolean)
        : DEFAULT_SETTINGS.pinnedFiles,
      recentCommands: parsed.recentCommands ?? DEFAULT_SETTINGS.recentCommands,
      recentCommandLaunchCounts: normalizeRecentCommandLaunchCounts(parsed.recentCommandLaunchCounts),
      // Existing users with older settings should not be forced into onboarding.
      hasSeenOnboarding:
        parsed.hasSeenOnboarding ?? true,
      hasSeenWhisperOnboarding:
        parsed.hasSeenWhisperOnboarding ?? false,
      fileSearchProtectedRootsEnabled:
        parsed.fileSearchProtectedRootsEnabled ?? DEFAULT_SETTINGS.fileSearchProtectedRootsEnabled,
      disableFileSearchResults: normalizeBoolean(
        parsed.disableFileSearchResults,
        DEFAULT_SETTINGS.disableFileSearchResults
      ),
      ai: { ...DEFAULT_AI_SETTINGS, ...parsed.ai },
      hyperKey: { ...DEFAULT_HYPER_KEY_SETTINGS, ...parsed.hyperKey },
      commandMetadata: parsed.commandMetadata ?? {},
      debugMode: parsed.debugMode ?? DEFAULT_SETTINGS.debugMode,
      appLanguage: normalizeAppLanguage(parsed.appLanguage),
      fontSize: normalizeFontSize(parsed.fontSize),
      uiStyle: normalizeUiStyle(parsed.uiStyle),
      baseColor: normalizeBaseColor(parsed.baseColor),
      launcherBackgroundImagePath: normalizeLauncherBackgroundImagePath(parsed.launcherBackgroundImagePath),
      launcherBackgroundImageEverywhere: normalizeBoolean(
        parsed.launcherBackgroundImageEverywhere,
        DEFAULT_SETTINGS.launcherBackgroundImageEverywhere
      ),
      launcherBackgroundImageBlurPercent: normalizePercentage(
        parsed.launcherBackgroundImageBlurPercent,
        DEFAULT_SETTINGS.launcherBackgroundImageBlurPercent
      ),
      launcherBackgroundImageOpacityPercent: normalizePercentage(
        parsed.launcherBackgroundImageOpacityPercent,
        DEFAULT_SETTINGS.launcherBackgroundImageOpacityPercent
      ),
      appUpdaterLastCheckedAt: Number.isFinite(Number(parsed.appUpdaterLastCheckedAt))
        ? Math.max(0, Number(parsed.appUpdaterLastCheckedAt))
        : DEFAULT_SETTINGS.appUpdaterLastCheckedAt,
      launcherViewMode: (parsed.launcherViewMode === 'compact' ? 'compact' : 'expanded'),
      navigationStyle: normalizeNavigationStyle(parsed.navigationStyle),
      clipboardHistoryRetentionDays: normalizeClipboardHistoryRetentionDays(parsed.clipboardHistoryRetentionDays),
      clipboardAppBlacklist: normalizeClipboardAppBlacklist(parsed.clipboardAppBlacklist),
      emojiPickerEnabled: typeof parsed.emojiPickerEnabled === 'boolean' ? parsed.emojiPickerEnabled : DEFAULT_SETTINGS.emojiPickerEnabled,
      emojiPickerTriggerPrefix: typeof parsed.emojiPickerTriggerPrefix === 'string' && parsed.emojiPickerTriggerPrefix.length > 0
        ? parsed.emojiPickerTriggerPrefix
        : DEFAULT_SETTINGS.emojiPickerTriggerPrefix,
      agentApprovalMode:
        parsed.agentApprovalMode === 'auto-all' || parsed.agentApprovalMode === 'auto-workspace' || parsed.agentApprovalMode === 'prompt'
          ? parsed.agentApprovalMode
          : DEFAULT_SETTINGS.agentApprovalMode,
      mcpServers:
        parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
          ? Object.fromEntries(
              Object.entries(parsed.mcpServers as Record<string, any>)
                .filter(([, v]) => v && typeof v === 'object' && typeof (v as any).command === 'string')
                .map(([k, v]) => [
                  k,
                  {
                    command: String((v as any).command),
                    args: Array.isArray((v as any).args) ? (v as any).args.map(String) : undefined,
                    env:
                      (v as any).env && typeof (v as any).env === 'object'
                        ? Object.fromEntries(Object.entries((v as any).env).map(([ek, ev]) => [ek, String(ev)]))
                        : undefined,
                    cwd: typeof (v as any).cwd === 'string' ? (v as any).cwd : undefined,
                  },
                ])
            )
          : DEFAULT_SETTINGS.mcpServers,
    };
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS };
  }

  return { ...settingsCache };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const updated = {
    ...current,
    ...patch,
    appLanguage: normalizeAppLanguage(patch.appLanguage ?? current.appLanguage),
    launcherBackgroundImagePath: normalizeLauncherBackgroundImagePath(
      patch.launcherBackgroundImagePath ?? current.launcherBackgroundImagePath
    ),
    launcherBackgroundImageEverywhere: normalizeBoolean(
      patch.launcherBackgroundImageEverywhere ?? current.launcherBackgroundImageEverywhere,
      current.launcherBackgroundImageEverywhere
    ),
    launcherBackgroundImageBlurPercent: normalizePercentage(
      patch.launcherBackgroundImageBlurPercent ?? current.launcherBackgroundImageBlurPercent,
      current.launcherBackgroundImageBlurPercent
    ),
    launcherBackgroundImageOpacityPercent: normalizePercentage(
      patch.launcherBackgroundImageOpacityPercent ?? current.launcherBackgroundImageOpacityPercent,
      current.launcherBackgroundImageOpacityPercent
    ),
    clipboardHistoryRetentionDays: normalizeClipboardHistoryRetentionDays(
      'clipboardHistoryRetentionDays' in patch
        ? patch.clipboardHistoryRetentionDays
        : current.clipboardHistoryRetentionDays
    ),
    clipboardAppBlacklist: normalizeClipboardAppBlacklist(
      'clipboardAppBlacklist' in patch
        ? patch.clipboardAppBlacklist
        : current.clipboardAppBlacklist
    ),
    emojiPickerEnabled: typeof (patch.emojiPickerEnabled ?? current.emojiPickerEnabled) === 'boolean'
      ? (patch.emojiPickerEnabled ?? current.emojiPickerEnabled)!
      : DEFAULT_SETTINGS.emojiPickerEnabled,
    emojiPickerTriggerPrefix: typeof (patch.emojiPickerTriggerPrefix ?? current.emojiPickerTriggerPrefix) === 'string'
      && (patch.emojiPickerTriggerPrefix ?? current.emojiPickerTriggerPrefix)!.length > 0
      ? (patch.emojiPickerTriggerPrefix ?? current.emojiPickerTriggerPrefix)!
      : DEFAULT_SETTINGS.emojiPickerTriggerPrefix,
  };

  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(updated, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }

  settingsCache = updated;
  return { ...updated };
}

export function resetSettingsCache(): void {
  settingsCache = null;
}

// ─── OAuth Token Store ────────────────────────────────────────────
// Stores OAuth tokens per provider in a separate JSON file so they
// persist across app restarts and window resets.

interface OAuthTokenEntry {
  accessToken: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
  obtainedAt: string;
}

let oauthTokensCache: Record<string, OAuthTokenEntry> | null = null;

function getOAuthTokensPath(): string {
  return path.join(app.getPath('userData'), 'oauth-tokens.json');
}

function loadOAuthTokens(): Record<string, OAuthTokenEntry> {
  if (oauthTokensCache) return oauthTokensCache;
  try {
    const raw = fs.readFileSync(getOAuthTokensPath(), 'utf-8');
    oauthTokensCache = JSON.parse(raw) || {};
  } catch {
    oauthTokensCache = {};
  }
  return oauthTokensCache!;
}

function saveOAuthTokens(tokens: Record<string, OAuthTokenEntry>): void {
  oauthTokensCache = tokens;
  try {
    fs.writeFileSync(getOAuthTokensPath(), JSON.stringify(tokens, null, 2));
  } catch (e) {
    console.error('Failed to save OAuth tokens:', e);
  }
}

export function setOAuthToken(provider: string, token: OAuthTokenEntry): void {
  const tokens = loadOAuthTokens();
  tokens[provider] = token;
  saveOAuthTokens(tokens);
}

export function getOAuthToken(provider: string): OAuthTokenEntry | null {
  const tokens = loadOAuthTokens();
  return tokens[provider] || null;
}

export function removeOAuthToken(provider: string): void {
  const tokens = loadOAuthTokens();
  delete tokens[provider];
  saveOAuthTokens(tokens);
}

// ─── Window State Store ───────────────────────────────────────────
// Stores the last known position of the launcher window so it can be
// restored on the next open. Kept separate from AppSettings because
// it updates on every move and should never be part of user-facing
// settings sync.

export interface LauncherWindowState {
  /** Last saved X position of the launcher window. */
  x: number;
  /** Last saved Y position of the launcher window. */
  y: number;
}

let windowStateCache: LauncherWindowState | null | undefined = undefined; // undefined = not loaded yet

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

export function loadWindowState(): LauncherWindowState | null {
  if (windowStateCache !== undefined) return windowStateCache;
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      windowStateCache = { x: Math.round(x), y: Math.round(y) };
    } else {
      windowStateCache = null;
    }
  } catch {
    windowStateCache = null;
  }
  return windowStateCache;
}

export function saveWindowState(state: LauncherWindowState): void {
  windowStateCache = state;
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save window state:', e);
  }
}

export function clearWindowState(): void {
  windowStateCache = null;
  try {
    const p = getWindowStatePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.error('Failed to clear window state:', e);
  }
}

// ─── Notes window state ────────────────────────────────────────────
// Separate from LauncherWindowState because Notes persists width/height as
// well as position. Stored in its own JSON file so migrating/clearing one
// doesn't affect the other.

export interface NotesWindowState {
  /** Last saved X position of the notes window. */
  x: number;
  /** Last saved Y position of the notes window. */
  y: number;
  /** Last saved width of the notes window. */
  width: number;
  /** Last saved height of the notes window. */
  height: number;
}

let notesWindowStateCache: NotesWindowState | null | undefined = undefined;

function getNotesWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'notes-window-state.json');
}

export function loadNotesWindowState(): NotesWindowState | null {
  if (notesWindowStateCache !== undefined) return notesWindowStateCache;
  try {
    const raw = fs.readFileSync(getNotesWindowStatePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    const width = Number(parsed?.width);
    const height = Number(parsed?.height);
    if (
      [x, y, width, height].every(Number.isFinite) &&
      width > 0 &&
      height > 0
    ) {
      notesWindowStateCache = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      };
    } else {
      notesWindowStateCache = null;
    }
  } catch {
    notesWindowStateCache = null;
  }
  return notesWindowStateCache;
}

export function saveNotesWindowState(state: NotesWindowState): void {
  notesWindowStateCache = state;
  try {
    fs.writeFileSync(getNotesWindowStatePath(), JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save notes window state:', e);
  }
}
