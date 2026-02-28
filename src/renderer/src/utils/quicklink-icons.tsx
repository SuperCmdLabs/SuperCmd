import React from 'react';
import { Link2 } from 'lucide-react';
import { renderPhosphorIcon } from '../raycast-api/icon-runtime-phosphor';
import { RAYCAST_ICON_NAMES, type RaycastIconName } from '../raycast-api/raycast-icon-enum';

type LucideIconComponent = React.ComponentType<{ className?: string; strokeWidth?: number }>;

export type QuickLinkIconOption = {
  value: string;
  label: string;
  icon?: LucideIconComponent;
  searchText: string;
};

export const QUICK_LINK_DEFAULT_ICON = 'default';

const LEGACY_ICON_ALIASES: Record<string, string> = {
  default: QUICK_LINK_DEFAULT_ICON,
  link: 'Link',
  globe: 'Globe',
  search: 'MagnifyingGlass',
  bolt: 'Bolt',
};

function normalizeIconKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function buildIconLabel(iconName: string): string {
  return iconName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchAliases(iconName: string): string[] {
  const normalized = normalizeIconKey(iconName);
  const aliases: string[] = [];

  if (normalized.includes('magnifying') || normalized.includes('search')) aliases.push('search', 'find', 'lookup');
  if (normalized.includes('globe')) aliases.push('web', 'internet', 'browser');
  if (normalized.includes('link')) aliases.push('url', 'hyperlink');
  if (normalized.includes('bolt')) aliases.push('flash', 'lightning');
  if (normalized.includes('trash')) aliases.push('delete', 'remove');
  if (normalized.includes('gear') || normalized.includes('cog')) aliases.push('settings', 'preferences');
  if (normalized.includes('house')) aliases.push('home');
  if (normalized.includes('mail') || normalized.includes('envelope')) aliases.push('email');
  if (normalized.includes('terminal')) aliases.push('shell', 'console');

  return aliases;
}

const rawIconOptions: QuickLinkIconOption[] = (Array.isArray(RAYCAST_ICON_NAMES) ? RAYCAST_ICON_NAMES : [])
  .map((name) => {
    const raycastName = String(name || '').trim() as RaycastIconName;
    if (!raycastName) return null;
    const label = buildIconLabel(raycastName);
    const compact = normalizeIconKey(label);
    const aliases = buildSearchAliases(raycastName).join(' ');
    return {
      value: raycastName,
      label,
      searchText: `${label} ${raycastName} ${compact} ${aliases}`.toLowerCase(),
    } satisfies QuickLinkIconOption;
  })
  .filter((option): option is QuickLinkIconOption => Boolean(option))
  .sort((a, b) => a.label.localeCompare(b.label));

const canonicalIconValueByNormalized = new Map<string, string>();
const quickLinkIconOptions = new Map<string, QuickLinkIconOption>();

for (const option of rawIconOptions) {
  quickLinkIconOptions.set(option.value, option);
  canonicalIconValueByNormalized.set(normalizeIconKey(option.value), option.value);
  canonicalIconValueByNormalized.set(normalizeIconKey(option.label), option.value);
}

export const QUICK_LINK_ICON_OPTIONS: QuickLinkIconOption[] = [
  {
    value: QUICK_LINK_DEFAULT_ICON,
    label: 'Default App Icon',
    icon: Link2,
    searchText: 'default app icon browser',
  },
  ...rawIconOptions,
];

export function normalizeQuickLinkIconValue(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return QUICK_LINK_DEFAULT_ICON;

  const alias = LEGACY_ICON_ALIASES[raw.toLowerCase()];
  if (alias) return alias;

  const canonical = canonicalIconValueByNormalized.get(normalizeIconKey(raw));
  if (canonical) return canonical;

  return raw.slice(0, 80);
}

export function getQuickLinkIconOption(value: unknown): QuickLinkIconOption | undefined {
  const normalized = normalizeQuickLinkIconValue(value);
  if (normalized === QUICK_LINK_DEFAULT_ICON) return QUICK_LINK_ICON_OPTIONS[0];
  return quickLinkIconOptions.get(normalized);
}

export function getQuickLinkIconLabel(value: unknown): string {
  if (normalizeQuickLinkIconValue(value) === QUICK_LINK_DEFAULT_ICON) {
    return 'Default App Icon';
  }
  return getQuickLinkIconOption(value)?.label || buildIconLabel(String(value || '')) || 'Custom Icon';
}

export function renderQuickLinkIconGlyph(value: unknown, className: string): React.ReactNode {
  const normalized = normalizeQuickLinkIconValue(value);
  if (normalized === QUICK_LINK_DEFAULT_ICON) {
    return <Link2 className={className} strokeWidth={1.9} />;
  }
  return renderPhosphorIcon(normalized, className);
}
