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
  provider: 'openai' | 'anthropic' | 'ollama';
  openaiApiKey: string;
  anthropicApiKey: string;
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
}

export interface AppSettings {
  globalShortcut: string;
  openAtLogin: boolean;
  disabledCommands: string[];
  enabledCommands: string[];
  customExtensionFolders: string[];
  commandHotkeys: Record<string, string>;
  pinnedCommands: string[];
  recentCommands: string[];
  hasSeenOnboarding: boolean;
  hasSeenWhisperOnboarding: boolean;
  ai: AISettings;
  commandMetadata?: Record<string, { subtitle?: string }>;
  debugMode: boolean;
}

const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'openai',
  openaiApiKey: '',
  anthropicApiKey: '',
  elevenlabsApiKey: '',
  supermemoryApiKey: '',
  supermemoryClient: '',
  supermemoryBaseUrl: 'https://api.supermemory.ai',
  supermemoryLocalMode: false,
  ollamaBaseUrl: 'http://localhost:11434',
  defaultModel: '',
  speechCorrectionModel: '',
  speechToTextModel: 'native',
  speechLanguage: 'en-US',
  textToSpeechModel: 'edge-tts',
  edgeTtsVoice: 'en-US-EricNeural',
  speechCorrectionEnabled: true,
  enabled: true,
};

const DEFAULT_SETTINGS: AppSettings = {
  globalShortcut: 'Alt+Space',
  openAtLogin: false,
  disabledCommands: [],
  enabledCommands: [],
  customExtensionFolders: [],
  commandHotkeys: {
    'system-cursor-prompt': 'Command+Shift+K',
    'system-supercmd-whisper': 'Command+Shift+W',
    'system-supercmd-whisper-speak-toggle': 'Fn',
    'system-supercmd-speak': 'Command+Shift+S',
  },
  pinnedCommands: [],
  recentCommands: [],
  hasSeenOnboarding: false,
  hasSeenWhisperOnboarding: false,
  ai: { ...DEFAULT_AI_SETTINGS },
  debugMode: false,
};

let settingsCache: AppSettings | null = null;

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  if (settingsCache) return { ...settingsCache };

  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const parsedHotkeys = { ...(parsed.commandHotkeys || {}) };
    if (!parsedHotkeys['system-supercmd-whisper-speak-toggle']) {
      if (parsedHotkeys['system-supercmd-whisper-start']) {
        parsedHotkeys['system-supercmd-whisper-speak-toggle'] = parsedHotkeys['system-supercmd-whisper-start'];
      } else if (parsedHotkeys['system-supercmd-whisper-stop']) {
        parsedHotkeys['system-supercmd-whisper-speak-toggle'] = parsedHotkeys['system-supercmd-whisper-stop'];
      }
    }
    if (parsedHotkeys['system-supercmd-whisper-toggle']) {
      if (!parsedHotkeys['system-supercmd-whisper-start']) {
        parsedHotkeys['system-supercmd-whisper-start'] = parsedHotkeys['system-supercmd-whisper-toggle'];
      }
      if (!parsedHotkeys['system-supercmd-whisper']) {
        parsedHotkeys['system-supercmd-whisper'] = parsedHotkeys['system-supercmd-whisper-toggle'];
      }
    }
    delete parsedHotkeys['system-supercmd-whisper-toggle'];
    delete parsedHotkeys['system-supercmd-whisper-start'];
    delete parsedHotkeys['system-supercmd-whisper-stop'];
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
      pinnedCommands: parsed.pinnedCommands ?? DEFAULT_SETTINGS.pinnedCommands,
      recentCommands: parsed.recentCommands ?? DEFAULT_SETTINGS.recentCommands,
      // Existing users with older settings should not be forced into onboarding.
      hasSeenOnboarding:
        parsed.hasSeenOnboarding ?? true,
      hasSeenWhisperOnboarding:
        parsed.hasSeenWhisperOnboarding ?? false,
      ai: { ...DEFAULT_AI_SETTINGS, ...parsed.ai },
      commandMetadata: parsed.commandMetadata ?? {},
      debugMode: parsed.debugMode ?? DEFAULT_SETTINGS.debugMode,
    };
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS };
  }

  return { ...settingsCache };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const updated = { ...current, ...patch };

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
