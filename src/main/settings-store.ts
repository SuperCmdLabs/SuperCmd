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
  edgeTtsVoice: 'en-US-JennyNeural',
  speechCorrectionEnabled: true,
  enabled: false,
};

const DEFAULT_SETTINGS: AppSettings = {
  globalShortcut: 'Alt+Space',
  openAtLogin: false,
  disabledCommands: [],
  enabledCommands: [],
  customExtensionFolders: [],
  commandHotkeys: {
    'system-cursor-prompt': 'Command+K',
    'system-supercommand-whisper': 'Command+Shift+W',
    'system-supercommand-whisper-speak-toggle': 'Command+.',
    'system-supercommand-speak': 'Command+Shift+S',
  },
  pinnedCommands: [],
  recentCommands: [],
  hasSeenOnboarding: false,
  hasSeenWhisperOnboarding: false,
  ai: { ...DEFAULT_AI_SETTINGS },
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
    if (!parsedHotkeys['system-supercommand-whisper-speak-toggle']) {
      if (parsedHotkeys['system-supercommand-whisper-start']) {
        parsedHotkeys['system-supercommand-whisper-speak-toggle'] = parsedHotkeys['system-supercommand-whisper-start'];
      } else if (parsedHotkeys['system-supercommand-whisper-stop']) {
        parsedHotkeys['system-supercommand-whisper-speak-toggle'] = parsedHotkeys['system-supercommand-whisper-stop'];
      }
    }
    if (parsedHotkeys['system-supercommand-whisper-toggle']) {
      if (!parsedHotkeys['system-supercommand-whisper-start']) {
        parsedHotkeys['system-supercommand-whisper-start'] = parsedHotkeys['system-supercommand-whisper-toggle'];
      }
      if (!parsedHotkeys['system-supercommand-whisper']) {
        parsedHotkeys['system-supercommand-whisper'] = parsedHotkeys['system-supercommand-whisper-toggle'];
      }
    }
    delete parsedHotkeys['system-supercommand-whisper-toggle'];
    delete parsedHotkeys['system-supercommand-whisper-start'];
    delete parsedHotkeys['system-supercommand-whisper-stop'];
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
