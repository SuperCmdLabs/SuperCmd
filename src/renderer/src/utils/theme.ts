export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'sc-theme-preference';
const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';
const THEME_ANIMATION_CLASS = 'sc-theme-animating';
const THEME_EVENT = 'sc-theme-change';
const THEME_ANIMATION_MS = 180;

let initialized = false;
let currentPreference: ThemePreference = 'system';
let mediaQuery: MediaQueryList | null = null;
let mediaQueryCleanupBound = false;
let externalSyncListenersBound = false;
let animationTimer: number | null = null;
let forcedTheme: ResolvedTheme | null = null;

function normalizeThemePreference(value: string | null | undefined): ThemePreference {
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  return 'system';
}

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(THEME_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return resolveSystemTheme();
  return preference;
}

function resolveActiveTheme(preference: ThemePreference): ResolvedTheme {
  return forcedTheme ?? resolveTheme(preference);
}

function applyResolvedTheme(theme: ResolvedTheme, animate: boolean): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const body = document.body;
  const isDark = theme === 'dark';

  root.classList.toggle('dark', isDark);
  body?.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';

  if (animate) {
    root.classList.add(THEME_ANIMATION_CLASS);
    if (animationTimer !== null) {
      window.clearTimeout(animationTimer);
      animationTimer = null;
    }
    animationTimer = window.setTimeout(() => {
      root.classList.remove(THEME_ANIMATION_CLASS);
      animationTimer = null;
    }, THEME_ANIMATION_MS);
  }

  root.dispatchEvent(
    new CustomEvent(THEME_EVENT, {
      detail: {
        preference: currentPreference,
        theme,
      },
    })
  );
}

function syncPreferenceFromStorage(animate: boolean): void {
  if (typeof window === 'undefined') return;
  const nextPreference = getThemePreference();
  if (nextPreference === currentPreference) return;
  currentPreference = nextPreference;
  applyResolvedTheme(resolveActiveTheme(currentPreference), animate);
}

function ensureMediaQueryListener(): void {
  if (typeof window === 'undefined' || mediaQueryCleanupBound) return;
  if (typeof window.matchMedia !== 'function') return;

  mediaQuery = window.matchMedia(THEME_MEDIA_QUERY);
  const onChange = () => {
    if (currentPreference !== 'system') return;
    applyResolvedTheme(resolveActiveTheme(currentPreference), true);
  };

  mediaQuery.addEventListener('change', onChange);
  mediaQueryCleanupBound = true;
}

function ensureExternalPreferenceSync(): void {
  if (typeof window === 'undefined' || externalSyncListenersBound) return;

  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== THEME_STORAGE_KEY) return;
    syncPreferenceFromStorage(true);
  });

  window.addEventListener('focus', () => {
    syncPreferenceFromStorage(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncPreferenceFromStorage(false);
    }
  });

  externalSyncListenersBound = true;
}

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    const normalizedPreference = normalizeThemePreference(storedPreference);
    if (storedPreference !== normalizedPreference) {
      window.localStorage.setItem(THEME_STORAGE_KEY, normalizedPreference);
    }
    return normalizedPreference;
  } catch {
    return 'system';
  }
}

export function setThemePreference(nextPreference: ThemePreference): ResolvedTheme {
  currentPreference = nextPreference;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
  }
  const resolved = resolveActiveTheme(nextPreference);
  applyResolvedTheme(resolved, true);
  return resolved;
}

export function refreshThemeFromStorage(animate = false): ResolvedTheme {
  currentPreference = getThemePreference();
  const resolved = resolveActiveTheme(currentPreference);
  applyResolvedTheme(resolved, animate);
  return resolved;
}

export function toggleTheme(): ResolvedTheme {
  const resolved = resolveTheme(currentPreference);
  return setThemePreference(resolved === 'dark' ? 'light' : 'dark');
}

export function initializeTheme(): ThemePreference {
  if (initialized) return currentPreference;
  currentPreference = getThemePreference();
  applyResolvedTheme(resolveActiveTheme(currentPreference), false);
  ensureMediaQueryListener();
  ensureExternalPreferenceSync();
  initialized = true;
  return currentPreference;
}

export function setForcedTheme(theme: ResolvedTheme | null, animate = false): ResolvedTheme {
  const previous = forcedTheme;
  forcedTheme = theme;
  const resolved = resolveActiveTheme(currentPreference);
  if (previous === forcedTheme) {
    return resolved;
  }
  applyResolvedTheme(resolved, animate);
  return resolved;
}

export function onThemeChange(handler: (payload: { preference: ThemePreference; theme: ResolvedTheme }) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const root = document.documentElement;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ preference: ThemePreference; theme: ResolvedTheme }>).detail;
    if (!detail) return;
    handler(detail);
  };

  root.addEventListener(THEME_EVENT, listener as EventListener);
  return () => {
    root.removeEventListener(THEME_EVENT, listener as EventListener);
  };
}
