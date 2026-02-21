import type { AppSettings } from '../../types/electron';

export type AppFontSize = NonNullable<AppSettings['fontSize']>;

const DEFAULT_FONT_SIZE: AppFontSize = 'medium';

const ROOT_FONT_SIZE_MAP: Record<AppFontSize, number> = {
  small: 14,
  medium: 16,
  large: 18,
};

function normalizeAppFontSize(raw: any): AppFontSize {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'small' || value === 'large') return value;
  return DEFAULT_FONT_SIZE;
}

export function applyAppFontSize(raw: any): AppFontSize {
  const normalized = normalizeAppFontSize(raw);
  document.documentElement.style.fontSize = `${ROOT_FONT_SIZE_MAP[normalized]}px`;
  document.body.dataset.scFontSize = normalized;
  return normalized;
}

export function getDefaultAppFontSize(): AppFontSize {
  return DEFAULT_FONT_SIZE;
}
