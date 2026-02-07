/**
 * Settings Store
 *
 * Simple JSON-file persistence for app settings.
 * Stored at ~/Library/Application Support/SuperCommand/settings.json
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

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

const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'openai',
  openaiApiKey: '',
  anthropicApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  defaultModel: '',
  enabled: false,
};

const DEFAULT_SETTINGS: AppSettings = {
  globalShortcut: 'Command+Space',
  disabledCommands: [],
  commandHotkeys: {},
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
    settingsCache = {
      globalShortcut: parsed.globalShortcut ?? DEFAULT_SETTINGS.globalShortcut,
      disabledCommands: parsed.disabledCommands ?? DEFAULT_SETTINGS.disabledCommands,
      commandHotkeys: parsed.commandHotkeys ?? DEFAULT_SETTINGS.commandHotkeys,
      ai: { ...DEFAULT_AI_SETTINGS, ...parsed.ai },
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

