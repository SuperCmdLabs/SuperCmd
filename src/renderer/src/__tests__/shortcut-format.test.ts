import { afterEach, describe, expect, it } from 'vitest';
import { formatShortcutForDisplay } from '../utils/hyper-key';

function setElectronPlatform(platform: 'darwin' | 'win32' | null): void {
  if (platform === null) {
    delete (globalThis as any).window;
    return;
  }
  (globalThis as any).window = {
    electron: { platform },
  };
}

describe('shortcut formatting', () => {
  afterEach(() => {
    setElectronPlatform(null);
  });

  it('formats command shortcuts as Ctrl on Windows', () => {
    setElectronPlatform('win32');
    expect(formatShortcutForDisplay('Cmd+Shift+P')).toBe('Ctrl + Shift + P');
    expect(formatShortcutForDisplay('Cmd+Delete')).toBe('Ctrl + Del');
    expect(formatShortcutForDisplay('Ctrl+Backspace')).toBe('Ctrl + Backspace');
  });

  it('formats command shortcuts as symbols on macOS', () => {
    setElectronPlatform('darwin');
    expect(formatShortcutForDisplay('Cmd+Shift+P')).toBe('⌘ + ⇧ + P');
    expect(formatShortcutForDisplay('Cmd+Delete')).toBe('⌘ + ⌦');
    expect(formatShortcutForDisplay('Ctrl+Backspace')).toBe('⌃ + ⌫');
  });
});
