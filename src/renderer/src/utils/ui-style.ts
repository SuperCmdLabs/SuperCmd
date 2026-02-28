export type UiStylePreference = 'default' | 'glassy';

export function normalizeUiStyle(value: any): UiStylePreference {
  return String(value || '').trim().toLowerCase() === 'glassy' ? 'glassy' : 'default';
}

export function applyUiStyle(style: UiStylePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const body = document.body;
  const isGlassy = style === 'glassy';
  root.classList.toggle('sc-glassy', isGlassy);
  body?.classList.toggle('sc-glassy', isGlassy);
  if (!isGlassy) {
    root.classList.remove('sc-native-liquid-glass');
    body?.classList.remove('sc-native-liquid-glass');
  }
}
