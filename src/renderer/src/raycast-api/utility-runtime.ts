/**
 * raycast-api/utility-runtime.ts
 * Purpose: Shared utility exports from @raycast/utils.
 */

import { Toast, showToast } from './index';

export function getFavicon(url: string | { url: string }, options?: { fallback?: string; size?: number; mask?: string }): string {
  const rawUrl = typeof url === 'string' ? url : url.url;
  try {
    const u = new URL(rawUrl);
    const size = options?.size || 64;
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=${size}`;
  } catch {
    return options?.fallback || '';
  }
}

const AVATAR_COLORS = [
  '#FF6363', '#FF9F43', '#FECA57', '#2ECC71', '#54A0FF',
  '#C56CF0', '#FF6B81', '#7BED9F', '#70A1FF', '#FFA502',
  '#A29BFE', '#FD79A8', '#00CEC9', '#E17055', '#6C5CE7',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getAvatarIcon(name: string, options?: { background?: string; gradient?: boolean }): string {
  const initials = getInitials(name);
  const bgColor = options?.background || AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
  const useGradient = options?.gradient !== false;

  const gradientDef = useGradient
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(255,255,255,0.15)"/><stop offset="100%" stop-color="rgba(0,0,0,0.1)"/></linearGradient></defs>`
    : '';
  const gradientRect = useGradient ? `<rect width="64" height="64" rx="32" fill="url(#g)"/>` : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${gradientDef}<rect width="64" height="64" rx="32" fill="${bgColor}"/>${gradientRect}<text x="32" y="32" text-anchor="middle" dominant-baseline="central" fill="white" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="24" font-weight="600">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function getProgressIcon(
  progress: number,
  color?: string,
  options?: { background?: string; backgroundOpacity?: number }
): string {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const fgColor = color || '#FF6363';
  const bgColor = options?.background || '#FFFFFF';
  const bgOpacity = options?.backgroundOpacity ?? 0.1;

  const radius = 10;
  const cx = 16;
  const cy = 16;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clampedProgress);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${bgColor}" stroke-width="4" opacity="${bgOpacity}"/><circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${fgColor}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 ${cx} ${cy})"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export async function runAppleScript(script: string, options?: any): Promise<string> {
  const electron = (window as any).electron;
  if (!electron?.runAppleScript) {
    throw new Error('runAppleScript is not available');
  }
  return await electron.runAppleScript(script);
}

export async function showFailureToast(error: Error | string | unknown, options?: { title?: string; message?: string; primaryAction?: any }): Promise<void> {
  const msg = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
  showToast({ title: options?.title || 'Error', message: options?.message || msg, style: Toast.Style.Failure });
}
