import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let mockUserDataPath = '';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return mockUserDataPath;
      return mockUserDataPath;
    },
  },
}));

import {
  getOAuthToken,
  loadSettings,
  removeOAuthToken,
  resetSettingsCache,
  saveSettings,
  setOAuthToken,
} from '../settings-store';

function getSettingsFilePath(): string {
  return path.join(mockUserDataPath, 'settings.json');
}

describe('settings-store', () => {
  beforeEach(() => {
    mockUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-settings-test-'));
    resetSettingsCache();
  });

  afterEach(() => {
    resetSettingsCache();
    try {
      fs.rmSync(mockUserDataPath, { recursive: true, force: true });
    } catch {}
  });

  it('loads defaults when settings file is missing', () => {
    const settings = loadSettings();

    expect(settings.globalShortcut).toBe(process.platform === 'win32' ? 'Ctrl+Space' : 'Alt+Space');
    expect(settings.commandHotkeys['system-supercmd-whisper-speak-toggle']).toBe(
      process.platform === 'win32' ? 'Ctrl+Shift+Space' : 'Fn'
    );
    expect(settings.baseColor).toBe('#101113');
    expect(settings.commandAliases).toEqual({});
  });

  it('migrates legacy whisper hotkey keys and trims aliases', () => {
    const legacy = {
      commandHotkeys: {
        'system-supercmd-whisper-toggle': 'Fn',
      },
      commandAliases: {
        '  cmd-one  ': '  alias-one  ',
        '': 'ignored',
        'cmd-two': '',
      },
      hasSeenOnboarding: false,
    };

    fs.writeFileSync(getSettingsFilePath(), JSON.stringify(legacy, null, 2));
    const settings = loadSettings();

    expect(settings.commandHotkeys['system-supercmd-whisper-speak-toggle']).toBe('Fn');
    expect(settings.commandHotkeys['system-supercmd-whisper-toggle']).toBeUndefined();
    expect(settings.commandAliases).toEqual({ 'cmd-one': 'alias-one' });
    expect(settings.hasSeenOnboarding).toBe(false);
  });

  it('saves settings patch and can reload persisted values', () => {
    const saved = saveSettings({
      openAtLogin: true,
      baseColor: '#abcdef',
      commandAliases: { 'alpha-command': 'alpha' },
    });

    expect(saved.openAtLogin).toBe(true);
    expect(saved.baseColor).toBe('#abcdef');

    resetSettingsCache();
    const reloaded = loadSettings();
    expect(reloaded.openAtLogin).toBe(true);
    expect(reloaded.baseColor).toBe('#abcdef');
    expect(reloaded.commandAliases['alpha-command']).toBe('alpha');
  });

  it('stores and removes oauth tokens independently of settings', () => {
    setOAuthToken('notion', {
      accessToken: 'token-123',
      tokenType: 'Bearer',
      obtainedAt: new Date('2026-02-21T00:00:00.000Z').toISOString(),
    });

    const token = getOAuthToken('notion');
    expect(token?.accessToken).toBe('token-123');

    removeOAuthToken('notion');
    expect(getOAuthToken('notion')).toBeNull();
  });
});
