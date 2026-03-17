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

export type AppFontSize = 'extra-small' | 'small' | 'medium' | 'large' | 'extra-large';
export type AppUiStyle = 'default' | 'glassy';

export interface AppSettings {
  globalShortcut: string;
  openAtLogin: boolean;
  disabledCommands: string[];
  enabledCommands: string[];
  customExtensionFolders: string[];
  commandHotkeys: Record<string, string>;
  commandAliases: Record<string, string>;
  pinnedCommands: string[];
  recentCommands: string[];
  recentCommandLaunchCounts: Record<string, number>;
  hasSeenOnboarding: boolean;
  hasSeenWhisperOnboarding: boolean;
  fileSearchProtectedRootsEnabled: boolean;
  ai: AISettings;
  commandMetadata?: Record<string, { subtitle?: string }>;
  debugMode: boolean;
  fontSize: AppFontSize;
  uiStyle: AppUiStyle;
  baseColor: string;
  launcherBackgroundImagePath: string;
  launcherBackgroundImageEverywhere: boolean;
  launcherBackgroundImageBlurPercent: number;
  launcherBackgroundImageOpacityPercent: number;
  appUpdaterLastCheckedAt: number;
}

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
  recentCommands: [],
  recentCommandLaunchCounts: {},
  hasSeenOnboarding: false,
  hasSeenWhisperOnboarding: false,
  fileSearchProtectedRootsEnabled: false,
  ai: { ...DEFAULT_AI_SETTINGS },
  debugMode: false,
  fontSize: 'medium',
  uiStyle: 'glassy',
  baseColor: '#101113',
  launcherBackgroundImagePath: '',
  launcherBackgroundImageEverywhere: false,
  launcherBackgroundImageBlurPercent: 25,
  launcherBackgroundImageOpacityPercent: 45,
  appUpdaterLastCheckedAt: 0,
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
      recentCommands: parsed.recentCommands ?? DEFAULT_SETTINGS.recentCommands,
      recentCommandLaunchCounts: normalizeRecentCommandLaunchCounts(parsed.recentCommandLaunchCounts),
      // Existing users with older settings should not be forced into onboarding.
      hasSeenOnboarding:
        parsed.hasSeenOnboarding ?? true,
      hasSeenWhisperOnboarding:
        parsed.hasSeenWhisperOnboarding ?? false,
      fileSearchProtectedRootsEnabled:
        parsed.fileSearchProtectedRootsEnabled ?? DEFAULT_SETTINGS.fileSearchProtectedRootsEnabled,
      ai: { ...DEFAULT_AI_SETTINGS, ...parsed.ai },
      commandMetadata: parsed.commandMetadata ?? {},
      debugMode: parsed.debugMode ?? DEFAULT_SETTINGS.debugMode,
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
