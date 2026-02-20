import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let userDataDir = '';
  return {
    setUserDataDir(value: string) {
      userDataDir = value;
    },
    appGetPath: vi.fn((_name: string) => userDataDir),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: mocks.appGetPath,
  },
}));

async function loadStore() {
  return import('../settings-store');
}

let tempDir = '';

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-store-test-'));
  mocks.setUserDataDir(tempDir);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('loadSettings/saveSettings', () => {
  it('returns defaults when settings file is missing', async () => {
    const store = await loadStore();
    const settings = store.loadSettings();

    expect(settings.globalShortcut).toBe('Alt+Space');
    expect(settings.ai.provider).toBe('openai');
    expect(settings.commandHotkeys['system-supercmd-whisper-speak-toggle']).toBe('Fn');
  });

  it('falls back to defaults on malformed JSON', async () => {
    fs.writeFileSync(path.join(tempDir, 'settings.json'), '{bad json', 'utf-8');
    const store = await loadStore();

    const settings = store.loadSettings();
    expect(settings.globalShortcut).toBe('Alt+Space');
    expect(settings.debugMode).toBe(false);
  });

  it('normalizes migrated command hotkeys and sanitizes customExtensionFolders', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'settings.json'),
      JSON.stringify({
        globalShortcut: 'Ctrl+Space',
        customExtensionFolders: ['  /a  ', '', null, '/b'],
        commandHotkeys: {
          'system-supercmd-whisper-toggle': 'Ctrl+T',
        },
      }),
      'utf-8'
    );

    const store = await loadStore();
    const settings = store.loadSettings();

    expect(settings.globalShortcut).toBe('Ctrl+Space');
    expect(settings.customExtensionFolders).toEqual(['/a', '/b']);
    expect(settings.commandHotkeys['system-supercmd-whisper']).toBe('Ctrl+T');
    expect(settings.commandHotkeys['system-supercmd-whisper-speak-toggle']).toBe('Fn');
  });

  it('saveSettings writes merged settings to disk', async () => {
    const store = await loadStore();

    const updated = store.saveSettings({ globalShortcut: 'Ctrl+J', debugMode: true });
    expect(updated.globalShortcut).toBe('Ctrl+J');
    expect(updated.debugMode).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(path.join(tempDir, 'settings.json'), 'utf-8')) as {
      globalShortcut: string;
      debugMode: boolean;
    };

    expect(onDisk.globalShortcut).toBe('Ctrl+J');
    expect(onDisk.debugMode).toBe(true);
  });
});

describe('OAuth token store', () => {
  it('supports set/get/remove lifecycle', async () => {
    const store = await loadStore();

    store.setOAuthToken('github', {
      accessToken: 'abc',
      tokenType: 'bearer',
      scope: 'repo',
      expiresIn: 3600,
      obtainedAt: '2025-01-01T00:00:00.000Z',
    });

    expect(store.getOAuthToken('github')).toEqual({
      accessToken: 'abc',
      tokenType: 'bearer',
      scope: 'repo',
      expiresIn: 3600,
      obtainedAt: '2025-01-01T00:00:00.000Z',
    });

    store.removeOAuthToken('github');
    expect(store.getOAuthToken('github')).toBeNull();
  });
});
