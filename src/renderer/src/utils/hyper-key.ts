export type Modifier = 'cmd' | 'shift' | 'ctrl' | 'alt' | 'hyper';

function normalizeModifierToken(token: string): Modifier | 'fn' | 'other' {
  const value = String(token || '').trim().toLowerCase();
  if (!value) return 'other';

  if (value === '✦' || value === 'hyper') return 'hyper';
  if (value === '⌘' || value === 'command' || value === 'cmd' || value === 'meta' || value === 'super') return 'cmd';
  if (value === '⌃' || value === 'control' || value === 'ctrl') return 'ctrl';
  if (value === '⌥' || value === 'alt' || value === 'option') return 'alt';
  if (value === '⇧' || value === 'shift') return 'shift';
  if (value === 'fn' || value === 'function') return 'fn';

  return 'other';
}

export function collapseHyperShortcut(shortcut: string): string {
  const raw = String(shortcut || '').trim();
  if (!raw) return '';

  const tokens = raw
    .split('+')
    .map((token) => String(token || '').trim())
    .filter(Boolean);
  if (tokens.length <= 1) return raw;

  const keyToken = tokens[tokens.length - 1];
  const modifierTokens = tokens.slice(0, -1);

  const normalizedModifiers = modifierTokens.map((token) => normalizeModifierToken(token));
  const hasHyperModifier = normalizedModifiers.includes('hyper');
  const hasAllCoreModifiers =
    normalizedModifiers.includes('cmd') &&
    normalizedModifiers.includes('ctrl') &&
    normalizedModifiers.includes('alt') &&
    normalizedModifiers.includes('shift');

  if (!hasHyperModifier && !hasAllCoreModifiers) {
    return raw;
  }

  const outputModifiers: string[] = [];
  for (let i = 0; i < modifierTokens.length; i += 1) {
    const normalized = normalizedModifiers[i];
    if (normalized === 'cmd' || normalized === 'ctrl' || normalized === 'alt' || normalized === 'shift' || normalized === 'hyper') {
      continue;
    }
    if (normalized === 'fn') {
      outputModifiers.push('Fn');
      continue;
    }
    outputModifiers.push(modifierTokens[i]);
  }
  outputModifiers.push('✦');

  return [...outputModifiers, keyToken].join('+');
}

export function formatShortcutForDisplay(shortcut: string): string {
  const collapsed = collapseHyperShortcut(shortcut);
  const formattedTokens = collapsed
    .split('+')
    .map((token) => {
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

  if (formattedTokens.includes('✦')) {
    return formattedTokens.join(' ');
  }
  return formattedTokens.join(' + ');
}
