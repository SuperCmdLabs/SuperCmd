export function collapseHyperShortcut(shortcut: string): string {
  const raw = String(shortcut || '').trim();
  if (!raw) return '';
  return raw;
}

export function formatShortcutForDisplay(shortcut: string): string {
  const collapsed = collapseHyperShortcut(shortcut);
  const parts = collapsed.split('+').map((token) => {
    const value = String(token || '').trim();
    if (!value) return value;
    if (/^hyper$/i.test(value) || value === '✦') return '✦';
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
  });

  const modifierSymbols = new Set(['⌘', '⌃', '⌥', '⇧', '✦', 'fn']);
  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const part of parts) {
    if (modifierSymbols.has(part)) {
      modifiers.push(part);
    } else if (part) {
      keys.push(part);
    }
  }

  const modifierStr = modifiers.join('');
  const keyStr = keys.join('+');

  if (modifierStr && keyStr) return modifierStr + '+' + keyStr;
  return modifierStr || keyStr;
}
