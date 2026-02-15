/**
 * raycast-api/icon-runtime-phosphor.tsx
 * Purpose: Resolve Raycast icon keys to Phosphor icon components.
 */

import React from 'react';
import * as Phosphor from '../../../../node_modules/@phosphor-icons/react/dist/index.es.js';
import { RAYCAST_ICON_NAMES, RAYCAST_ICON_VALUE_TO_NAME, type RaycastIconName } from './raycast-icon-enum';

type PhosphorIconComponent = React.ComponentType<{
  className?: string;
  size?: number | string;
  color?: string;
  style?: React.CSSProperties;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
}>;

type PhosphorExportValue = unknown;

function normalizeIconName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function splitIconTokens(name: string): string[] {
  const spaced = String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!spaced) return [];
  return spaced.split(/\s+/).filter(Boolean);
}

function isRenderablePhosphorComponent(candidate: PhosphorExportValue): candidate is PhosphorIconComponent {
  if (typeof candidate === 'function') return true;
  if (!candidate || typeof candidate !== 'object') return false;
  const maybe = candidate as Record<string, unknown>;
  return Boolean(maybe.$$typeof || maybe.render || maybe.type);
}

const raycastIconNameSet: Set<string> =
  RAYCAST_ICON_NAMES instanceof Set
    ? new Set(Array.from(RAYCAST_ICON_NAMES))
    : Array.isArray(RAYCAST_ICON_NAMES)
      ? new Set(RAYCAST_ICON_NAMES)
      : new Set();
const raycastIconValueToNameMap = new Map<string, RaycastIconName>();

function registerRaycastIconValueEntry(key: string, value: RaycastIconName) {
  const rawKey = String(key || '').trim();
  if (!rawKey) return;
  raycastIconValueToNameMap.set(rawKey, value);
  raycastIconValueToNameMap.set(normalizeIconName(rawKey), value);
}

if (RAYCAST_ICON_VALUE_TO_NAME instanceof Map) {
  for (const [key, value] of RAYCAST_ICON_VALUE_TO_NAME.entries()) {
    registerRaycastIconValueEntry(String(key), value as RaycastIconName);
  }
} else if (Array.isArray(RAYCAST_ICON_VALUE_TO_NAME)) {
  for (const entry of RAYCAST_ICON_VALUE_TO_NAME) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    registerRaycastIconValueEntry(String(entry[0]), entry[1] as RaycastIconName);
  }
} else if (RAYCAST_ICON_VALUE_TO_NAME && typeof RAYCAST_ICON_VALUE_TO_NAME === 'object') {
  for (const [key, value] of Object.entries(RAYCAST_ICON_VALUE_TO_NAME as Record<string, unknown>)) {
    registerRaycastIconValueEntry(key, value as RaycastIconName);
  }
}

function resolveRaycastIconName(input: string): RaycastIconName | undefined {
  const rawInput = String(input || '').trim();
  const normalized = normalizeIconName(input);
  if (!rawInput && !normalized) return undefined;
  if (raycastIconNameSet.has(rawInput)) return rawInput as RaycastIconName;
  return raycastIconValueToNameMap.get(rawInput) || raycastIconValueToNameMap.get(normalized);
}

function tryResolvePhosphorByName(name: string): PhosphorIconComponent | undefined {
  if (!name) return undefined;

  const direct = (Phosphor as Record<string, unknown>)[name];
  if (isRenderablePhosphorComponent(direct)) return direct as PhosphorIconComponent;

  const normalizedTarget = normalizeIconName(name);
  if (!normalizedTarget) return undefined;

  // Some bundling modes can make namespace entries non-enumerable for Object.entries.
  // getOwnPropertyNames is more robust for resolving the export keys.
  for (const key of Object.getOwnPropertyNames(Phosphor)) {
    if (normalizeIconName(key) !== normalizedTarget) continue;
    const candidate = (Phosphor as Record<string, unknown>)[key];
    if (isRenderablePhosphorComponent(candidate)) return candidate as PhosphorIconComponent;
  }

  return undefined;
}

const EXPLICIT_RAYCAST_TO_PHOSPHOR: Record<string, string[]> = {
  addperson: ['UserPlus'],
  aligncentre: ['AlignCenterHorizontal'],
  appwindowgrid2x2: ['RowsPlusTop', 'SquaresFour'],
  appwindowgrid3x3: ['DotsNine', 'SquaresFour'],
  appwindowlist: ['Rows'],
  appwindowsidebarleft: ['SidebarSimple'],
  appwindowsidebarright: ['SidebarSimple'],
  arrowscontract: ['ArrowsInSimple'],
  arrowsexpand: ['ArrowsOutSimple'],
  atsymbol: ['At'],
  bandaid: ['Bandage'],
  barchart: ['ChartBar'],
  batterydisabled: ['BatteryVerticalEmpty'],
  belldisabled: ['BellSlash'],
  bullseye: ['Target'],
  bullseyemissed: ['Target'],
  checkrosette: ['SealCheck'],
  cog: ['Gear'],
  commandsymbol: ['Command'],
  computerchip: ['Cpu'],
  copyclipboard: ['Copy'],
  droplets: ['Drop'],
  eyedisabled: ['EyeSlash'],
  hashsymbol: ['Hash'],
  hashtag: ['Hash'],
  lightbulboff: ['LightbulbFilament'],
  livestream: ['Broadcast'],
  livestreamdisabled: ['Broadcast'],
  lockunlocked: ['LockOpen'],
  lowercase: ['TextLowercase'],
  uppercase: ['TextUppercase'],
  magnifyingglass: ['MagnifyingGlass'],
  medicalsupport: ['FirstAidKit'],
  moonrise: ['MoonStars'],
  network: ['Network'],
  number00: ['NumberCircleZero'],
  quicklink: ['LinkSimple'],
  rss: ['Rss'],
  twopeople: ['Users'],
  xmark: ['X'],
  xmarkcircle: ['XCircle'],
  xmarkcirclefilled: ['XCircle'],
};

const phosphorExportKeys = Object.getOwnPropertyNames(Phosphor);
const phosphorNamePool = Array.from(new Set(
  phosphorExportKeys
    .map((key) => key.replace(/Icon$/, ''))
    .filter((key) => Boolean(tryResolvePhosphorByName(key)))
));
const phosphorTokenPool = phosphorNamePool.map((name) => ({
  name,
  normalized: normalizeIconName(name),
  tokens: new Set(splitIconTokens(name)),
}));

function bestFuzzyPhosphorCandidate(input: string): string | undefined {
  const inputTokens = splitIconTokens(input);
  if (inputTokens.length === 0) return undefined;
  const inputSet = new Set(inputTokens);
  const normalizedInput = normalizeIconName(input);

  let bestName = '';
  let bestScore = -1;
  for (const candidate of phosphorTokenPool) {
    let overlap = 0;
    for (const token of inputSet) {
      if (candidate.tokens.has(token)) overlap += 1;
    }
    if (overlap === 0) continue;

    let score = overlap * 10;
    if (candidate.normalized === normalizedInput) score += 100;
    if (candidate.normalized.startsWith(normalizedInput) || normalizedInput.startsWith(candidate.normalized)) score += 20;
    if (candidate.tokens.size <= inputSet.size + 1) score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestName = candidate.name;
    }
  }

  return bestName || undefined;
}

function resolvePhosphorIconFromRaycast(input: string): PhosphorIconComponent | undefined {
  const iconName = resolveRaycastIconName(input) || input;
  const normalized = normalizeIconName(iconName);

  const directCandidates = [
    iconName,
    iconName.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\s+/g, ''),
    iconName.replace(/[^a-zA-Z0-9]/g, ''),
    iconName.replace(/^Icon\./, ''),
    iconName.replace(/Icon$/, ''),
  ];

  for (const candidate of directCandidates) {
    const resolved = tryResolvePhosphorByName(candidate);
    if (resolved) return resolved;
  }

  const explicitAliases = EXPLICIT_RAYCAST_TO_PHOSPHOR[normalized] || [];
  for (const candidate of explicitAliases) {
    const resolved = tryResolvePhosphorByName(candidate);
    if (resolved) return resolved;
  }

  const candidates = new Set<string>();

  if (normalized.includes('arrow') && normalized.includes('left')) candidates.add('ArrowLeft');
  if (normalized.includes('arrow') && normalized.includes('right')) candidates.add('ArrowRight');
  if (normalized.includes('arrow') && normalized.includes('up')) candidates.add('ArrowUp');
  if (normalized.includes('arrow') && normalized.includes('down')) candidates.add('ArrowDown');
  if (normalized.includes('check') && normalized.includes('circle')) candidates.add('CheckCircle');
  if (normalized.includes('check')) candidates.add('Check');
  if (normalized.includes('x') && normalized.includes('circle')) candidates.add('XCircle');
  if (normalized.includes('xmark') || normalized === 'x') candidates.add('X');
  if (normalized.includes('trash')) candidates.add('TrashSimple');
  if (normalized.includes('folder')) candidates.add('Folder');
  if (normalized.includes('file')) candidates.add('File');
  if (normalized.includes('link')) candidates.add('Link');
  if (normalized.includes('lock') && normalized.includes('open')) candidates.add('LockOpen');
  if (normalized.includes('lock')) candidates.add('Lock');
  if (normalized.includes('person') || normalized.includes('user')) candidates.add('User');
  if (normalized.includes('people') || normalized.includes('users') || normalized.includes('group')) candidates.add('Users');
  if (normalized.includes('calendar')) candidates.add('Calendar');
  if (normalized.includes('clock') || normalized.includes('history')) candidates.add('ArrowCounterClockwise');
  if (normalized.includes('play')) candidates.add('Play');
  if (normalized.includes('pause')) candidates.add('Pause');
  if (normalized.includes('stop')) candidates.add('Stop');
  if (normalized.includes('star')) candidates.add('Star');
  if (normalized.includes('heartbroken') || normalized.includes('heartbreak')) candidates.add('HeartBreak');
  if (normalized.includes('heart')) candidates.add('Heart');
  if (normalized.includes('sparkle') || normalized.includes('sparkles')) candidates.add('Sparkle');
  if (normalized.includes('wand') || normalized.includes('magic')) candidates.add('Sparkle');
  if (normalized.includes('cpu') || normalized.includes('processor')) candidates.add('Cpu');
  if (normalized.includes('memory') || normalized.includes('ram')) candidates.add('Cpu');
  if (normalized.includes('network') || normalized.includes('wifi')) candidates.add('WifiHigh');
  if (normalized.includes('bluetooth')) candidates.add('Bluetooth');
  if (normalized.includes('terminal') || normalized.includes('commandline')) candidates.add('TerminalWindow');
  if (normalized.includes('download')) candidates.add('DownloadSimple');
  if (normalized.includes('upload')) candidates.add('UploadSimple');
  if (normalized.includes('search') || normalized.includes('magnifyingglass')) candidates.add('MagnifyingGlass');
  if (normalized.includes('image') || normalized.includes('photo')) candidates.add('Image');
  if (normalized.includes('keyboard')) candidates.add('Keyboard');
  if (normalized.includes('music')) candidates.add('MusicNote');
  if (normalized.includes('phone')) candidates.add('Phone');
  if (normalized.includes('video')) candidates.add('VideoCamera');
  if (normalized.includes('warning') || normalized.includes('triangle')) candidates.add('WarningDiamond');
  if (normalized.includes('info')) candidates.add('Info');
  if (normalized.includes('question') || normalized.includes('help')) candidates.add('Question');

  for (const candidate of candidates) {
    const icon = tryResolvePhosphorByName(candidate);
    if (icon) return icon;
  }

  const fuzzyCandidate = bestFuzzyPhosphorCandidate(iconName);
  if (fuzzyCandidate) {
    const fuzzyResolved = tryResolvePhosphorByName(fuzzyCandidate);
    if (fuzzyResolved) return fuzzyResolved;
  }

  return tryResolvePhosphorByName('Question') || tryResolvePhosphorByName('Circle');
}

export function renderPhosphorIcon(input: string, className: string, tint?: string): React.ReactNode {
  const IconComponent = resolvePhosphorIconFromRaycast(input);
  if (!IconComponent) return null;

  return (
    <IconComponent
      className={className}
      weight="regular"
      style={{ color: tint || 'rgba(255,255,255,0.92)' }}
    />
  );
}

export function isRaycastIconName(name: string): boolean {
  return raycastIconNameSet.has(name);
}
