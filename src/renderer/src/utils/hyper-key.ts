export type Modifier = 'cmd' | 'shift' | 'ctrl' | 'alt' | 'hyper';

export function collapseHyperShortcut(shortcut: string): string {
  const raw = String(shortcut || '').trim();
  if (!raw) return '';
  // Hyper collapsing temporarily disabled.
  return raw;
}

export function formatShortcutForDisplay(shortcut: string): string {
  const collapsed = collapseHyperShortcut(shortcut);
  return collapsed
    .split('+')
    .map((token) => {
      const value = String(token || '').trim();
      if (!value) return value;
      if (/^hyper$/i.test(value) || value === '✦') return 'Hyper';
      if (/^(command|cmd)$/i.test(value)) return '⌘';
      if (/^(control|ctrl)$/i.test(value)) return '⌃';
      if (/^(alt|option)$/i.test(value)) return '⌥';
      if (/^shift$/i.test(value)) return '⇧';
      if (/^(function|fn)$/i.test(value)) return 'fn';
      if (/^arrowup$/i.test(value)) return '↑';
      if (/^arrowdown$/i.test(value)) return '↓';
      if (/^(backspace|delete)$/i.test(value)) return '⌫';
      if (/^period$/i.test(value)) return '.';
      return value.length === 1 ? value.toUpperCase() : value;
    })
    .join(' + ');
}
