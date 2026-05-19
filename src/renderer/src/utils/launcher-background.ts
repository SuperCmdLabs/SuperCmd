export const DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT = 25;
export const DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT = 45;
export const MAX_LAUNCHER_BACKGROUND_BLUR_PX = 20;

export function toFileUrl(filePath: string): string {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) return '';
  return `file://${encodeURI(normalizedPath)}`;
}

export function clampLauncherBackgroundPercent(value: number, fallback: number): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsedValue)));
}

export function launcherBackgroundBlurPercentToPx(value: number): number {
  const clampedPercent = clampLauncherBackgroundPercent(
    value,
    DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT
  );
  return Number(((clampedPercent / 100) * MAX_LAUNCHER_BACKGROUND_BLUR_PX).toFixed(2));
}
