export type Modifier = 'cmd' | 'shift' | 'ctrl' | 'alt' | 'hyper';

export function collapseHyperShortcut(shortcut: string): string {
  const raw = String(shortcut || '').trim();
  if (!raw) return '';
  // Hyper collapsing temporarily disabled.
  return raw;
}

export function formatShortcutForDisplay(shortcut: string): string {
  const isMac =
    typeof window !== 'undefined' &&
    (window as any)?.electron?.platform === 'darwin';
  const collapsed = collapseHyperShortcut(shortcut);
  return collapsed
    .split('+')
    .map((token) => {
      const value = String(token || '').trim();
      if (!value) return value;
      if (/^hyper$/i.test(value) || value === '✦') return 'Hyper';
      if (/^(command|cmd)$/i.test(value)) return isMac ? '⌘' : 'Ctrl';
      if (/^(control|ctrl)$/i.test(value)) return isMac ? '⌃' : 'Ctrl';
      if (/^(alt|option)$/i.test(value)) return isMac ? '⌥' : 'Alt';
      if (/^shift$/i.test(value)) return isMac ? '⇧' : 'Shift';
      if (/^(function|fn)$/i.test(value)) return 'fn';
      if (/^arrowup$/i.test(value)) return '↑';
      if (/^arrowdown$/i.test(value)) return '↓';
      if (/^backspace$/i.test(value)) return isMac ? '⌫' : 'Backspace';
      if (/^delete$/i.test(value)) return isMac ? '⌦' : 'Del';
      if (/^period$/i.test(value)) return '.';
      return value.length === 1 ? value.toUpperCase() : value;
    })
    .join(' + ');
}
