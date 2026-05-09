/**
 * Settings Store
 *
 * Simple JSON-file persistence for app settings.
 * Stored at ~/Library/Application Support/SuperCmd/settings.json
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getSecret, setSecret, deleteSecret } from './safe-storage';

// AI settings fields whose values should never live in plain text on disk.
// Read/written through the safe-storage vault. Legacy plain-text values still
// present in settings.json are migrated into the vault on first load.
const SENSITIVE_AI_KEYS = [
  'openaiApiKey',
  'anthropicApiKey',
  'geminiApiKey',
  'elevenlabsApiKey',
  'mistralApiKey',
  'supermemoryApiKey',
  'lmStudioApiKey',
  'openaiCompatibleApiKey',
] as const;

type SensitiveAIKey = (typeof SENSITIVE_AI_KEYS)[number];

function aiVaultKey(field: SensitiveAIKey): string {
  return `ai.${field}`;
}

function oauthVaultKey(provider: string): string {
  return `oauth.${provider}`;
}

export interface AISettings {
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openai-compatible' | 'lm-studio';
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  elevenlabsApiKey: string;
  mistralApiKey: string;
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
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  lmStudioApiKey: string;
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

export interface BrowserSearchSettings {
  /** When false, Cmd+Enter does not trigger browser search and inline ghost-text autocomplete is suppressed. */
  enabled: boolean;
  /** Auto-prune browser-search history older than N days. `null` = never prune. */
  historyRetentionDays: number | null;
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
  // Bundle IDs of applications where the inline emoji picker should NOT appear.
  // Useful for apps with their own emoji pickers (Slack, Telegram, …).
  emojiPickerExcludedAppBundleIds: string[];
  browserSearch: BrowserSearchSettings;
  // Number of seconds the launcher waits after closing before resetting the
  // active view (extension or internal view like Clipboard) back to root
  // search. `0` resets immediately on every reopen.
  popToRootSearchTimeoutSeconds: number;
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
  mistralApiKey: '',
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
  lmStudioBaseUrl: 'http://127.0.0.1:1234/v1',
  lmStudioModel: '',
  lmStudioApiKey: '',
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
  emojiPickerExcludedAppBundleIds: [],
  browserSearch: {
    enabled: true,
    historyRetentionDays: 90,
  },
  popToRootSearchTimeoutSeconds: 90,
};

let settingsCache: AppSettings | null = null;
let didMigrateAISecrets = false;

/**
 * Merge the AI settings parsed from settings.json with the encrypted vault.
 *
 * Resolution rules per field:
 *  - both empty                       → empty
 *  - vault only                       → use vault (steady state)
 *  - disk only                        → use disk (pending migration)
 *  - both set, equal                  → use either
 *  - both set, differ                 → prefer disk plaintext, since a non-empty
 *    plaintext value is evidence that an older app version (post-redaction
 *    downgrade) wrote it after the vault entry was created. Migration will
 *    forward this newer value into the vault.
 *
 * The returned object always reflects the *effective* values the app should
 * use at runtime — never empty just because something migrated.
 */
function hydrateAISettings(raw: any): AISettings {
  const merged: AISettings = { ...DEFAULT_AI_SETTINGS, ...(raw || {}) };
  for (const field of SENSITIVE_AI_KEYS) {
    const fromVault = getSecret(aiVaultKey(field));
    const fromDisk = typeof merged[field] === 'string' ? (merged[field] as string) : '';
    if (fromDisk && fromDisk !== fromVault) {
      merged[field] = fromDisk;
    } else {
      merged[field] = fromVault || fromDisk || '';
    }
  }
  return merged;
}

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

function normalizeBundleIdList(value: any): string[] {
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

const ALLOWED_POP_TO_ROOT_TIMEOUTS = new Set([0, 5, 15, 30, 60, 90, 120]);

function normalizePopToRootSearchTimeoutSeconds(value: any): number {
  if (value === undefined || value === null) {
    return DEFAULT_SETTINGS.popToRootSearchTimeoutSeconds;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.popToRootSearchTimeoutSeconds;
  const int = Math.trunc(num);
  if (ALLOWED_POP_TO_ROOT_TIMEOUTS.has(int)) return int;
  return DEFAULT_SETTINGS.popToRootSearchTimeoutSeconds;
}

function normalizeClipboardHistoryRetentionDays(value: any): number | null {
  if (value === null) return null;
  if (value === undefined) return DEFAULT_SETTINGS.clipboardHistoryRetentionDays;
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.clipboardHistoryRetentionDays;
  const int = Math.trunc(num);
  if (ALLOWED_CLIPBOARD_RETENTION_DAYS.has(int)) return int;
  return DEFAULT_SETTINGS.clipboardHistoryRetentionDays;
}

const ALLOWED_BROWSER_SEARCH_RETENTION_DAYS = new Set([7, 30, 90, 180, 365]);

function normalizeBrowserSearchRetentionDays(value: any): number | null {
  if (value === null) return null;
  if (value === undefined) return DEFAULT_SETTINGS.browserSearch.historyRetentionDays;
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.browserSearch.historyRetentionDays;
  const int = Math.trunc(num);
  if (ALLOWED_BROWSER_SEARCH_RETENTION_DAYS.has(int)) return int;
  return DEFAULT_SETTINGS.browserSearch.historyRetentionDays;
}

function normalizeBrowserSearchSettings(value: any): BrowserSearchSettings {
  const fallback = DEFAULT_SETTINGS.browserSearch;
  if (!value || typeof value !== 'object') return { ...fallback };
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    historyRetentionDays: normalizeBrowserSearchRetentionDays(value.historyRetentionDays),
  };
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
      ai: hydrateAISettings(parsed.ai),
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
      clipboardAppBlacklist: normalizeBundleIdList(parsed.clipboardAppBlacklist),
      emojiPickerEnabled: typeof parsed.emojiPickerEnabled === 'boolean' ? parsed.emojiPickerEnabled : DEFAULT_SETTINGS.emojiPickerEnabled,
      emojiPickerTriggerPrefix: typeof parsed.emojiPickerTriggerPrefix === 'string' && parsed.emojiPickerTriggerPrefix.length > 0
        ? parsed.emojiPickerTriggerPrefix
        : DEFAULT_SETTINGS.emojiPickerTriggerPrefix,
      emojiPickerExcludedAppBundleIds: normalizeBundleIdList(parsed.emojiPickerExcludedAppBundleIds),
      browserSearch: normalizeBrowserSearchSettings(parsed.browserSearch),
      popToRootSearchTimeoutSeconds: normalizePopToRootSearchTimeoutSeconds(parsed.popToRootSearchTimeoutSeconds),
    };
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS };
  }

  migrateAISecretsToVaultIfNeeded();
  return { ...settingsCache };
}

/**
 * One-shot migration: lift any plain-text AI keys out of settings.json into
 * the safe-storage vault. Disk plaintext is only redacted *per field* once
 * we've confirmed the vault write succeeded — a failed vault write must not
 * destroy the only durable copy of the user's key. Any field whose vault
 * write fails stays as plaintext on disk and will be retried next launch.
 *
 * If disk plaintext differs from vault for a field, disk wins and overwrites
 * vault (downgrade-then-upgrade conflict resolution).
 *
 * The in-memory `settingsCache` keeps the decrypted values so runtime
 * behaviour is unchanged.
 */
function migrateAISecretsToVaultIfNeeded(): void {
  if (didMigrateAISecrets) return;
  didMigrateAISecrets = true;
  if (!settingsCache) return;

  const diskValues = readSensitiveAIKeysFromDisk();
  const safelyRedactable = new Set<SensitiveAIKey>();
  let needsRedaction = false;

  for (const field of SENSITIVE_AI_KEYS) {
    const fromDisk = diskValues[field] || '';
    if (!fromDisk) continue;
    needsRedaction = true;
    const fromVault = getSecret(aiVaultKey(field));
    if (fromDisk === fromVault) {
      // Already consistent — safe to redact disk without another vault write.
      safelyRedactable.add(field);
      continue;
    }
    // Disk plaintext is authoritative (newer or first-time migration).
    if (setSecret(aiVaultKey(field), fromDisk)) {
      settingsCache.ai[field] = fromDisk;
      safelyRedactable.add(field);
    } else {
      console.warn(`safe-storage: vault write failed for ai.${field}; leaving plaintext on disk.`);
    }
  }

  if (needsRedaction && safelyRedactable.size > 0) {
    redactSensitiveAIKeysOnDisk(safelyRedactable);
  }
}

function readSensitiveAIKeysFromDisk(): Partial<Record<SensitiveAIKey, string>> {
  const out: Partial<Record<SensitiveAIKey, string>> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
    for (const field of SENSITIVE_AI_KEYS) {
      const value = parsed?.ai?.[field];
      if (typeof value === 'string' && value.length > 0) out[field] = value;
    }
  } catch {
    // missing or malformed file — nothing to migrate
  }
  return out;
}

/**
 * Rewrite settings.json with the given sensitive fields blanked out. Reads
 * the current file as-is (rather than serialising `settingsCache`) so we
 * never overwrite unrelated fields written by a concurrent process.
 */
function redactSensitiveAIKeysOnDisk(fields: Set<SensitiveAIKey>): void {
  if (fields.size === 0) return;
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  parsed.ai = parsed.ai || {};
  for (const field of fields) parsed.ai[field] = '';
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.error('Failed to redact sensitive keys on disk:', e);
  }
}

/**
 * Write settings to disk. Sensitive AI fields whose vault writes succeeded
 * (`safelyRedactable`) are blanked on disk; any others retain their
 * plaintext value as a durable fallback.
 */
function persistSettingsToDisk(
  settings: AppSettings,
  safelyRedactable: Set<SensitiveAIKey>
): void {
  const onDisk: AppSettings = {
    ...settings,
    ai: { ...settings.ai },
  };
  for (const field of SENSITIVE_AI_KEYS) {
    if (safelyRedactable.has(field)) onDisk.ai[field] = '';
  }
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(onDisk, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
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
    clipboardAppBlacklist: normalizeBundleIdList(
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
    emojiPickerExcludedAppBundleIds: normalizeBundleIdList(
      'emojiPickerExcludedAppBundleIds' in patch
        ? patch.emojiPickerExcludedAppBundleIds
        : current.emojiPickerExcludedAppBundleIds
    ),
    browserSearch: normalizeBrowserSearchSettings(
      'browserSearch' in patch ? patch.browserSearch : current.browserSearch
    ),
    popToRootSearchTimeoutSeconds: normalizePopToRootSearchTimeoutSeconds(
      'popToRootSearchTimeoutSeconds' in patch
        ? patch.popToRootSearchTimeoutSeconds
        : current.popToRootSearchTimeoutSeconds
    ),
  };

  const safelyRedactable = new Set<SensitiveAIKey>();
  for (const field of SENSITIVE_AI_KEYS) {
    if (setSecret(aiVaultKey(field), updated.ai[field] || '')) {
      safelyRedactable.add(field);
    } else {
      console.warn(`safe-storage: vault write failed for ai.${field}; keeping plaintext on disk.`);
    }
  }

  persistSettingsToDisk(updated, safelyRedactable);

  settingsCache = updated;
  return { ...updated };
}

export function resetSettingsCache(): void {
  settingsCache = null;
}

// ─── OAuth Token Store ────────────────────────────────────────────
// Tokens are encrypted per-provider in the safe-storage vault under
// `oauth.<provider>`. `oauth-tokens.json` is kept as a provider-name index
// (no secrets) so we can still enumerate providers without decrypting, and
// so legacy plain-text token files from previous versions are automatically
// migrated into the vault on first load.

interface OAuthTokenEntry {
  accessToken: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
  obtainedAt: string;
}

let oauthTokensCache: Record<string, OAuthTokenEntry> | null = null;
let oauthIndexCache: string[] | null = null;
// Providers whose vault writes failed; we keep their plaintext entries on
// disk verbatim until a future write succeeds. Callers must NOT rewrite
// oauth-tokens.json without merging this map back in.
let unmigratedOAuthCache: Record<string, OAuthTokenEntry> | null = null;

function getOAuthTokensPath(): string {
  return path.join(app.getPath('userData'), 'oauth-tokens.json');
}

function decodeOAuthSecret(serialized: string): OAuthTokenEntry | null {
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized);
    if (parsed && typeof parsed === 'object' && typeof parsed.accessToken === 'string') {
      return parsed as OAuthTokenEntry;
    }
  } catch {
    // fall through
  }
  return null;
}

function isLegacyPlainTextEntry(value: unknown): value is OAuthTokenEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as OAuthTokenEntry).accessToken === 'string' &&
    (value as OAuthTokenEntry).accessToken.length > 0
  );
}

function loadOAuthTokens(): Record<string, OAuthTokenEntry> {
  if (oauthTokensCache) return oauthTokensCache;

  const tokens: Record<string, OAuthTokenEntry> = {};
  const providers = new Set<string>();
  const unmigrated: Record<string, OAuthTokenEntry> = {};
  let needsIndexRewrite = false;

  let parsedFile: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(getOAuthTokensPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      parsedFile = parsed as Record<string, unknown>;
    }
  } catch {
    // missing file is fine
  }

  for (const [provider, value] of Object.entries(parsedFile)) {
    if (!provider) continue;
    if (isLegacyPlainTextEntry(value)) {
      // Plaintext on disk is authoritative — overwrite any existing vault
      // entry (downgrade-then-upgrade conflict). Only redact disk after
      // a confirmed vault write.
      const ok = setSecret(oauthVaultKey(provider), JSON.stringify(value));
      tokens[provider] = value;
      if (ok) {
        providers.add(provider);
        needsIndexRewrite = true;
      } else {
        console.warn(`safe-storage: vault write failed for oauth.${provider}; leaving plaintext on disk.`);
        unmigrated[provider] = value;
      }
    } else if (value && typeof value === 'object') {
      // New-style index entry: just remember the provider name.
      providers.add(provider);
    }
  }

  // Pull anything in the vault that isn't in the index (e.g. previous run
  // wrote to vault but index file was lost) so we never silently lose a token.
  for (const provider of providers) {
    if (tokens[provider]) continue;
    const decoded = decodeOAuthSecret(getSecret(oauthVaultKey(provider)));
    if (decoded) tokens[provider] = decoded;
  }

  oauthTokensCache = tokens;
  oauthIndexCache = [...providers];
  unmigratedOAuthCache = unmigrated;

  if (needsIndexRewrite) writeOAuthIndex();

  return oauthTokensCache;
}

/**
 * Rewrites oauth-tokens.json. Index entries (no secrets) are written for
 * providers whose tokens live in the vault; entries that failed migration
 * are written verbatim as plaintext so they remain durable until the next
 * successful vault write.
 */
function writeOAuthIndex(): void {
  const providers = oauthIndexCache || [];
  const unmigrated = unmigratedOAuthCache || {};
  const out: Record<string, unknown> = {};
  for (const provider of providers) {
    const token = oauthTokensCache?.[provider];
    out[provider] = token?.obtainedAt ? { obtainedAt: token.obtainedAt } : {};
  }
  for (const [provider, token] of Object.entries(unmigrated)) {
    if (provider in out) continue;
    out[provider] = token;
  }
  try {
    fs.writeFileSync(getOAuthTokensPath(), JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('Failed to save OAuth tokens index:', e);
  }
}

export function setOAuthToken(provider: string, token: OAuthTokenEntry): void {
  loadOAuthTokens();
  oauthTokensCache![provider] = token;
  const ok = setSecret(oauthVaultKey(provider), JSON.stringify(token));
  if (ok) {
    if (!oauthIndexCache!.includes(provider)) oauthIndexCache!.push(provider);
    delete unmigratedOAuthCache![provider];
  } else {
    // Vault write failed — preserve as plaintext on disk and keep it OUT of
    // the index so the next loadOAuthTokens() retries the migration.
    console.warn(`safe-storage: vault write failed for oauth.${provider}; preserving plaintext.`);
    unmigratedOAuthCache![provider] = token;
    oauthIndexCache = oauthIndexCache!.filter((p) => p !== provider);
  }
  writeOAuthIndex();
}

export function getOAuthToken(provider: string): OAuthTokenEntry | null {
  const tokens = loadOAuthTokens();
  if (tokens[provider]) return tokens[provider];
  const decoded = decodeOAuthSecret(getSecret(oauthVaultKey(provider)));
  if (decoded) {
    tokens[provider] = decoded;
    if (!oauthIndexCache!.includes(provider)) {
      oauthIndexCache!.push(provider);
      writeOAuthIndex();
    }
  }
  return decoded;
}

export function removeOAuthToken(provider: string): void {
  loadOAuthTokens();
  deleteSecret(oauthVaultKey(provider));
  delete oauthTokensCache![provider];
  delete unmigratedOAuthCache![provider];
  oauthIndexCache = oauthIndexCache!.filter((p) => p !== provider);
  writeOAuthIndex();
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
