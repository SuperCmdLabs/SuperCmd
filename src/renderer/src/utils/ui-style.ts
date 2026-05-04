export type UiStylePreference = 'default' | 'glassy';

export function normalizeUiStyle(value: any): UiStylePreference {
  return String(value || '').trim().toLowerCase() === 'glassy' ? 'glassy' : 'default';
}

// True when the platform can render the native NSGlassEffectView underlay
// that .sc-glassy CSS expects. macOS Tahoe (26) ships the real private class
// but its hit-testing eats mouse events, so the main process skips attaching
// it — and the renderer must not pretend the underlay is there, otherwise
// .sc-glassy renders dark with a detached-looking footer.
function nativeLiquidGlassAvailable(): boolean {
  if (typeof window === 'undefined') return true;
  const electron: any = (window as any).electron;
  if (!electron) return true;
  return electron.nativeLiquidGlassAvailable !== false;
}

export function applyUiStyle(style: UiStylePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const body = document.body;
  // User stays on their stored preference (settings.json untouched), but
  // visually fall back to default when native glass isn't actually usable.
  // Once electron-liquid-glass exposes a hit-test-transparent option and we
  // re-enable native glass on Tahoe, glassy will start rendering again with
  // no settings change required from the user.
  const effective: UiStylePreference =
    style === 'glassy' && !nativeLiquidGlassAvailable() ? 'default' : style;
  const isGlassy = effective === 'glassy';
  root.classList.toggle('sc-glassy', isGlassy);
  body?.classList.toggle('sc-glassy', isGlassy);
  if (!isGlassy) {
    root.classList.remove('sc-native-liquid-glass');
    body?.classList.remove('sc-native-liquid-glass');
  }
}
