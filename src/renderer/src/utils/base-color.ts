export const DEFAULT_BASE_COLOR = '#101113';

function normalizeHex(value: string): string {
  const raw = String(value || '').trim();
  const sixDigit = /^#([0-9a-fA-F]{6})$/;
  const threeDigit = /^#([0-9a-fA-F]{3})$/;
  if (sixDigit.test(raw)) return raw.toLowerCase();
  const short = raw.match(threeDigit);
  if (!short) return DEFAULT_BASE_COLOR;
  const expanded = short[1].split('').map((ch) => `${ch}${ch}`).join('');
  return `#${expanded}`.toLowerCase();
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = normalizeHex(hex).slice(1);
  const value = parseInt(cleaned, 16);
  return [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
}

export function normalizeBaseColorHex(value: string): string {
  return normalizeHex(value);
}

export function applyBaseColor(baseColor: string): void {
  const [r, g, b] = hexToRgb(baseColor);
  document.documentElement.style.setProperty('--sc-base-rgb', `${r}, ${g}, ${b}`);
}
