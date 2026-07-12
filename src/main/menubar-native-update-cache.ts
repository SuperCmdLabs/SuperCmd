/**
 * Main-process MenuBarExtra native update cache.
 *
 * Tracks the last native tray sub-payload applied per extension so title-only
 * ticks do not rebuild unchanged Electron menu templates.
 */

export type MenuBarNativeUpdatePayload = {
  iconPath?: unknown;
  iconDataUrl?: unknown;
  iconEmoji?: unknown;
  iconTemplate?: unknown;
  iconBitmapScale?: unknown;
  fallbackIconDataUrl?: unknown;
  title?: unknown;
  tooltip?: unknown;
  items?: unknown;
};

export type MenuBarNativeFileStatFs = {
  statSync: (pathValue: string) => {
    size?: number;
    mtimeMs?: number;
    isFile?: () => boolean;
  };
};

export type MenuBarNativeUpdateState = {
  iconKey: string | null;
  iconFileIdentityKey: string | null;
  lastResolvedTrayIconOk: boolean;
  title: string | null;
  tooltip: string | null;
  itemsKey: string | null;
};

export function createMenuBarNativeUpdateState(): MenuBarNativeUpdateState {
  return {
    iconKey: null,
    iconFileIdentityKey: null,
    lastResolvedTrayIconOk: false,
    title: null,
    tooltip: null,
    itemsKey: null,
  };
}

export function getMenuBarNativeIconKey(payload: MenuBarNativeUpdatePayload): string {
  return safeJsonStringify([
    payload.iconPath ?? null,
    payload.iconDataUrl ?? null,
    payload.iconEmoji ?? null,
    typeof payload.iconTemplate === 'boolean' ? payload.iconTemplate : null,
    payload.iconBitmapScale ?? null,
    payload.fallbackIconDataUrl ?? null,
  ]);
}

export function hasFileBackedMenuBarNativeIcon(payload: MenuBarNativeUpdatePayload): boolean {
  return typeof payload.iconPath === 'string' && payload.iconPath.trim().length > 0;
}

export function getMenuBarNativeFileIconIdentityKey(
  payload: MenuBarNativeUpdatePayload,
  fs: MenuBarNativeFileStatFs,
): string | null {
  if (!hasFileBackedMenuBarNativeIcon(payload)) return null;
  const pathValue = (payload.iconPath as string).trim();
  try {
    const stat = fs.statSync(pathValue);
    if (typeof stat?.isFile === 'function' && !stat.isFile()) {
      return `path:${pathValue}|missing`;
    }
    const size = Number.isFinite(Number(stat?.size)) ? Number(stat.size) : 0;
    const mtimeMs = Number.isFinite(Number(stat?.mtimeMs)) ? Number(stat.mtimeMs) : 0;
    return `path:${pathValue}|mtimeMs=${mtimeMs}|bytes=${size}`;
  } catch {
    return `path:${pathValue}|missing`;
  }
}

export function isMenuBarNativeIconRefreshNeeded(
  state: MenuBarNativeUpdateState,
  payload: MenuBarNativeUpdatePayload,
  nextFileIdentityKey?: string | null,
): boolean {
  const nextIconKey = getMenuBarNativeIconKey(payload);
  if (state.iconKey !== nextIconKey) return true;
  if (!hasFileBackedMenuBarNativeIcon(payload)) return false;
  if (nextFileIdentityKey === undefined) return true;
  return state.iconFileIdentityKey !== nextFileIdentityKey;
}

export function rememberMenuBarNativeIcon(
  state: MenuBarNativeUpdateState,
  payload: MenuBarNativeUpdatePayload,
  lastResolvedTrayIconOk: boolean,
  fileIdentityKey: string | null = null,
): void {
  state.iconKey = getMenuBarNativeIconKey(payload);
  state.iconFileIdentityKey = fileIdentityKey;
  state.lastResolvedTrayIconOk = lastResolvedTrayIconOk;
}

export function getMenuBarNativeTitle(
  payload: MenuBarNativeUpdatePayload,
  lastResolvedTrayIconOk: boolean,
): string {
  const title = normalizeMenuBarNativeString(payload.title);
  if (title) return title;
  const iconEmoji = normalizeMenuBarNativeString(payload.iconEmoji);
  if (iconEmoji) return iconEmoji;
  return lastResolvedTrayIconOk ? '' : '\u23f1';
}

export function isMenuBarNativeTitleUpdateNeeded(
  state: MenuBarNativeUpdateState,
  nextTitle: string,
): boolean {
  return state.title !== nextTitle;
}

export function rememberMenuBarNativeTitle(
  state: MenuBarNativeUpdateState,
  nextTitle: string,
): void {
  state.title = nextTitle;
}

export function getMenuBarNativeTooltip(payload: MenuBarNativeUpdatePayload): string {
  return normalizeMenuBarNativeString(payload.tooltip);
}

export function isMenuBarNativeTooltipUpdateNeeded(
  state: MenuBarNativeUpdateState,
  nextTooltip: string,
): boolean {
  return nextTooltip.length > 0 && state.tooltip !== nextTooltip;
}

export function rememberMenuBarNativeTooltip(
  state: MenuBarNativeUpdateState,
  nextTooltip: string,
): void {
  state.tooltip = nextTooltip;
}

export function getMenuBarNativeItemsKey(items: unknown): string {
  return safeJsonStringify(items ?? []);
}

export function isMenuBarNativeMenuUpdateNeeded(
  state: MenuBarNativeUpdateState,
  nextItemsKey: string,
): boolean {
  return state.itemsKey !== nextItemsKey;
}

export function rememberMenuBarNativeMenu(
  state: MenuBarNativeUpdateState,
  nextItemsKey: string,
): void {
  state.itemsKey = nextItemsKey;
}

function normalizeMenuBarNativeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function safeJsonStringify(value: unknown): string {
  try {
    const result = JSON.stringify(value);
    return typeof result === 'string' ? result : '';
  } catch {
    return String(value);
  }
}
