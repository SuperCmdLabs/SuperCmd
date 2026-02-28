/**
 * command-helpers.tsx
 *
 * Pure utility functions and types for the launcher command list.
 * - filterCommands: text search + hidden-command filtering
 * - Icon renderers: renderCommandIcon, renderSuperCmdLogoIcon, getSystemCommandFallbackIcon
 * - Display helpers: getCommandDisplayTitle, getCategoryLabel, getCommandAccessoryLabel, formatShortcutLabel, renderShortcutLabel
 * - Voice utilities: buildReadVoiceOptions, getVoiceLanguageCode, getFallbackVoiceLabel
 * - parseIntervalToMs: converts interval strings like "1m", "12h" to milliseconds
 * - Types: LauncherAction, MemoryFeedback, ReadVoiceOption
 *
 * No side-effects; all functions are stateless and safe to import anywhere.
 */

import React from 'react';
import { Search, Power, Settings, Puzzle, Sparkles, Clipboard, FileText, Mic, Volume2, Brain, TerminalSquare, RefreshCw, LayoutGrid, Link2 } from 'lucide-react';
import type { CommandInfo, EdgeTtsVoice } from '../../types/electron';
import supercmdLogo from '../../../../supercmd.svg';
import { formatShortcutForDisplay } from './hyper-key';
import { renderQuickLinkIconGlyph } from './quicklink-icons';

export interface LauncherAction {
  id: string;
  title: string;
  shortcut?: string;
  style?: 'default' | 'destructive';
  enabled?: boolean;
  execute: () => void | Promise<void>;
}

export type MemoryFeedback = {
  type: 'success' | 'error';
  text: string;
} | null;

export type ReadVoiceOption = {
  value: string;
  label: string;
};

const SEARCH_TOKEN_SPLIT_REGEX = /[^a-z0-9]+/g;

function normalizeSearchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(SEARCH_TOKEN_SPLIT_REGEX, ' ')
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function isSubsequenceMatch(needle: string, haystack: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;

  let needleIndex = 0;
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) {
      needleIndex += 1;
    }
  }
  return needleIndex === needle.length;
}

function maxAllowedTypoDistance(termLength: number): number {
  if (termLength <= 3) return 0;
  if (termLength <= 5) return 1;
  if (termLength <= 8) return 2;
  return 3;
}

function damerauLevenshteinDistance(a: string, b: string, maxDistance: number): number {
  const aLen = a.length;
  const bLen = b.length;

  if (!aLen) return bLen;
  if (!bLen) return aLen;
  if (Math.abs(aLen - bLen) > maxDistance) {
    return maxDistance + 1;
  }

  const dp: number[][] = Array.from({ length: aLen + 1 }, () => Array<number>(bLen + 1).fill(0));
  for (let i = 0; i <= aLen; i += 1) dp[i][0] = i;
  for (let j = 0; j <= bLen; j += 1) dp[0][j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );

      // Adjacent transposition (Damerau-Levenshtein)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, dp[i - 2][j - 2] + 1);
      }

      dp[i][j] = distance;
    }
  }

  return dp[aLen][bLen];
}

function scoreTokenMatch(term: string, candidate: string): number {
  if (!term || !candidate) return 0;
  if (candidate === term) return 120;
  if (candidate.startsWith(term)) return 106;
  if (candidate.includes(term)) return 94;

  if (term.length >= 3 && isSubsequenceMatch(term, candidate)) {
    return 78;
  }

  const maxDistance = maxAllowedTypoDistance(term.length);
  if (maxDistance > 0 && Math.abs(candidate.length - term.length) <= maxDistance) {
    const distance = damerauLevenshteinDistance(term, candidate, maxDistance);
    if (distance <= maxDistance) {
      const similarity = 1 - distance / Math.max(term.length, candidate.length);
      if (similarity >= 0.65) {
        return Math.round(50 + similarity * 30 - distance * 8);
      }
    }
  }

  return 0;
}

type SearchCandidate = {
  token: string;
  weight: number;
};

function bestTermScore(term: string, candidates: SearchCandidate[]): number {
  let best = 0;
  for (const candidate of candidates) {
    const baseScore = scoreTokenMatch(term, candidate.token);
    if (baseScore <= 0) continue;
    const weighted = Math.round(baseScore * candidate.weight);
    if (weighted > best) {
      best = weighted;
    }
  }
  return best;
}

/**
 * Filter and sort commands based on search query
 */
export function filterCommands(commands: CommandInfo[], query: string): CommandInfo[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return commands;
  }

  const queryTerms = tokenizeSearchText(normalizedQuery);

  const scored = commands
    .map((cmd) => {
      const title = normalizeSearchText(cmd.title);
      const subtitle = normalizeSearchText(String(cmd.subtitle || ''));
      const keywordTokens = (cmd.keywords || []).flatMap((keyword) => tokenizeSearchText(keyword));
      const titleTokens = tokenizeSearchText(cmd.title);
      const subtitleTokens = tokenizeSearchText(String(cmd.subtitle || ''));

      const candidates: SearchCandidate[] = [
        ...titleTokens.map((token) => ({ token, weight: 1 })),
        ...keywordTokens.map((token) => ({ token, weight: 0.92 })),
        ...subtitleTokens.map((token) => ({ token, weight: 0.76 })),
      ];

      if (candidates.length === 0) {
        return null;
      }

      let score = 0;

      if (title === normalizedQuery) {
        score += 420;
      } else if (title.startsWith(normalizedQuery)) {
        score += 320;
      } else if (title.includes(normalizedQuery)) {
        score += 260;
      } else if (keywordTokens.includes(normalizedQuery)) {
        score += 225;
      } else if (keywordTokens.some((keyword) => keyword.includes(normalizedQuery))) {
        score += 180;
      } else if (subtitle.includes(normalizedQuery)) {
        score += 145;
      }

      let termScoreSum = 0;
      for (const term of queryTerms) {
        const termScore = bestTermScore(term, candidates);
        if (termScore <= 0) {
          return null;
        }
        termScoreSum += termScore;
      }

      score += termScoreSum;

      if (normalizedQuery.length >= 3) {
        const compactQuery = normalizedQuery.replace(/\s+/g, '');
        const compactTitle = title.replace(/\s+/g, '');
        if (compactQuery && compactTitle && isSubsequenceMatch(compactQuery, compactTitle)) {
          score += 18;
        }
      }

      // Favor concise titles when scores are close.
      score += Math.max(0, 12 - Math.max(0, title.length - normalizedQuery.length));

      return { cmd, score, title };
    })
    .filter((entry): entry is { cmd: CommandInfo; score: number; title: string } => Boolean(entry) && entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title);
    });

  return scored.map(({ cmd }) => cmd);
}

/**
 * Get category display label
 */
export function getCategoryLabel(category: string): string {
  switch (category) {
    case 'settings':
      return 'System Settings';
    case 'system':
      return 'System';
    case 'extension':
      return 'Extension';
    case 'script':
      return 'Script';
    case 'app':
    default:
      return 'Application';
  }
}

function toTitleCaseLabel(input: string): string {
  return String(input || '')
    .split('-')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ');
}

export function getCommandAccessoryLabel(command: CommandInfo): string {
  if (command.category === 'extension') {
    const extName = String(command.path || '').split('/')[0] || '';
    if (extName) return toTitleCaseLabel(extName);
  }

  if (command.category === 'script') {
    const subtitle = String(command.subtitle || '').trim();
    if (subtitle) return subtitle;
  }

  const subtitle = String(command.subtitle || '').trim();
  if (subtitle) return subtitle;

  return '';
}

export function getCommandTypeBadgeLabel(command: CommandInfo): string {
  const commandId = String(command.id || '').trim();
  if (commandId.startsWith('quicklink-')) {
    return 'Quick Link';
  }
  return '';
}

export function formatShortcutLabel(shortcut: string): string {
  return formatShortcutForDisplay(shortcut).replace(/ \+ /g, ' ');
}

export function isSuperCmdAppTitle(title: string): boolean {
  const key = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key === 'supercmd' || key === 'supercmd';
}

export function isSuperCmdSystemCommand(commandId: string): boolean {
  return (
    commandId === 'system-open-settings' ||
    commandId === 'system-open-ai-settings' ||
    commandId === 'system-open-extensions-settings' ||
    commandId === 'system-open-onboarding' ||
    commandId === 'system-quit-launcher'
  );
}

export function getVoiceLanguageCode(voiceId: string): string {
  const id = String(voiceId || '').trim();
  const match = /^([a-z]{2}-[A-Z]{2})-/.exec(id);
  return match?.[1] || '';
}

export function getFallbackVoiceLabel(voiceId: string): string {
  const id = String(voiceId || '').trim();
  if (!id) return 'Voice';
  const base = id.split('-').slice(2).join('-').replace(/Neural$/i, '').trim();
  const lang = getVoiceLanguageCode(id);
  return base ? `${base} (${lang || 'Unknown'})` : id;
}

export function buildReadVoiceOptions(
  allVoices: EdgeTtsVoice[],
  currentVoice: string,
  configuredVoice: string
): ReadVoiceOption[] {
  const configured = String(configuredVoice || '').trim();
  const current = String(currentVoice || '').trim();
  const targetVoice = configured || current;
  const targetLang = getVoiceLanguageCode(targetVoice) || getVoiceLanguageCode(current);

  const filtered = allVoices
    .filter((voice) => (targetLang ? voice.languageCode === targetLang : true))
    .slice()
    .sort((a, b) => {
      const genderScore = (v: EdgeTtsVoice) => (String(v.gender).toLowerCase() === 'female' ? 0 : 1);
      const genderCmp = genderScore(a) - genderScore(b);
      if (genderCmp !== 0) return genderCmp;
      return String(a.label || '').localeCompare(String(b.label || ''));
    });

  const options: ReadVoiceOption[] = filtered.map((voice) => {
    const style = String(voice.style || '').trim();
    const gender = String(voice.gender || '').toLowerCase() === 'male' ? 'Male' : 'Female';
    const languageCode = String(voice.languageCode || '').trim();
    const languageSuffix = languageCode ? ` (${languageCode})` : '';
    const styleSuffix = style ? ` - ${style}` : '';
    return {
      value: voice.id,
      label: `${voice.label}${styleSuffix} - ${gender}${languageSuffix}`,
    };
  });

  const ensureVoicePresent = (voiceId: string) => {
    const id = String(voiceId || '').trim();
    if (!id) return;
    if (options.some((opt) => opt.value === id)) return;
    options.unshift({ value: id, label: getFallbackVoiceLabel(id) });
  };
  ensureVoicePresent(current);
  ensureVoicePresent(configured);

  return options;
}

export function renderSuperCmdLogoIcon(): React.ReactNode {
  return (
    <img
      src={supercmdLogo}
      alt=""
      className="w-5 h-5 object-contain"
      draggable={false}
    />
  );
}

export function getCommandDisplayTitle(command: CommandInfo): string {
  if (command.category === 'app' && isSuperCmdAppTitle(command.title)) return 'SuperCmd';
  return command.title;
}

type WindowManagementGlyphId =
  | 'panel'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center'
  | 'center-80'
  | 'fill'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'first-third'
  | 'center-third'
  | 'last-third'
  | 'first-two-thirds'
  | 'center-two-thirds'
  | 'last-two-thirds'
  | 'first-fourth'
  | 'second-fourth'
  | 'third-fourth'
  | 'last-fourth'
  | 'first-three-fourths'
  | 'center-three-fourths'
  | 'last-three-fourths'
  | 'top-left-sixth'
  | 'top-center-sixth'
  | 'top-right-sixth'
  | 'bottom-left-sixth'
  | 'bottom-center-sixth'
  | 'bottom-right-sixth'
  | 'next-display'
  | 'previous-display'
  | 'auto-organize'
  | 'increase-size-10'
  | 'decrease-size-10'
  | 'increase-left-10'
  | 'increase-right-10'
  | 'increase-top-10'
  | 'increase-bottom-10'
  | 'decrease-left-10'
  | 'decrease-right-10'
  | 'decrease-top-10'
  | 'decrease-bottom-10'
  | 'move-up-10'
  | 'move-down-10'
  | 'move-left-10'
  | 'move-right-10';

const WINDOW_MANAGEMENT_GLYPH_SUFFIXES = new Set<WindowManagementGlyphId>([
  'left',
  'right',
  'top',
  'bottom',
  'center',
  'center-80',
  'fill',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'first-third',
  'center-third',
  'last-third',
  'first-two-thirds',
  'center-two-thirds',
  'last-two-thirds',
  'first-fourth',
  'second-fourth',
  'third-fourth',
  'last-fourth',
  'first-three-fourths',
  'center-three-fourths',
  'last-three-fourths',
  'top-left-sixth',
  'top-center-sixth',
  'top-right-sixth',
  'bottom-left-sixth',
  'bottom-center-sixth',
  'bottom-right-sixth',
  'next-display',
  'previous-display',
  'auto-organize',
  'increase-size-10',
  'decrease-size-10',
  'increase-left-10',
  'increase-right-10',
  'increase-top-10',
  'increase-bottom-10',
  'decrease-left-10',
  'decrease-right-10',
  'decrease-top-10',
  'decrease-bottom-10',
  'move-up-10',
  'move-down-10',
  'move-left-10',
  'move-right-10',
]);

function resolveWindowManagementGlyphId(commandId: string): WindowManagementGlyphId | null {
  const normalized = String(commandId || '').trim();
  if (normalized === 'system-window-management') {
    return 'panel';
  }
  const prefix = 'system-window-management-';
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  const suffix = normalized.slice(prefix.length) as WindowManagementGlyphId;
  if (!WINDOW_MANAGEMENT_GLYPH_SUFFIXES.has(suffix)) {
    return null;
  }
  return suffix;
}

function renderGlyphArrow(
  key: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  size = 1.7
): JSX.Element {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const leftX = toX - ux * size + px * size * 0.72;
  const leftY = toY - uy * size + py * size * 0.72;
  const rightX = toX - ux * size - px * size * 0.72;
  const rightY = toY - uy * size - py * size * 0.72;
  return (
    <g key={key}>
      <path d={`M${fromX} ${fromY}L${toX} ${toY}`} stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
      <path
        d={`M${leftX} ${leftY}L${toX} ${toY}L${rightX} ${rightY}`}
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

function renderWindowManagementGlyph(glyphId: WindowManagementGlyphId): JSX.Element {
  const cells: Array<{ x: number; y: number; w: number; h: number }> = [];
  const overlays: JSX.Element[] = [];
  const showOuterFrame = glyphId !== 'next-display' && glyphId !== 'previous-display';

  switch (glyphId) {
    case 'top-left':
      cells.push({ x: 1, y: 1, w: 9, h: 6 });
      break;
    case 'top-right':
      cells.push({ x: 10, y: 1, w: 9, h: 6 });
      break;
    case 'bottom-left':
      cells.push({ x: 1, y: 7, w: 9, h: 6 });
      break;
    case 'bottom-right':
      cells.push({ x: 10, y: 7, w: 9, h: 6 });
      break;
    case 'top-left-sixth':
      cells.push({ x: 1, y: 1, w: 6, h: 6 });
      break;
    case 'top-center-sixth':
      cells.push({ x: 7, y: 1, w: 6, h: 6 });
      break;
    case 'top-right-sixth':
      cells.push({ x: 13, y: 1, w: 6, h: 6 });
      break;
    case 'bottom-left-sixth':
      cells.push({ x: 1, y: 7, w: 6, h: 6 });
      break;
    case 'bottom-center-sixth':
      cells.push({ x: 7, y: 7, w: 6, h: 6 });
      break;
    case 'bottom-right-sixth':
      cells.push({ x: 13, y: 7, w: 6, h: 6 });
      break;
    case 'left':
      cells.push({ x: 1, y: 1, w: 9, h: 12 });
      break;
    case 'right':
      cells.push({ x: 10, y: 1, w: 9, h: 12 });
      break;
    case 'first-third':
      cells.push({ x: 1, y: 1, w: 6, h: 12 });
      break;
    case 'center-third':
      cells.push({ x: 7, y: 1, w: 6, h: 12 });
      break;
    case 'last-third':
      cells.push({ x: 13, y: 1, w: 6, h: 12 });
      break;
    case 'first-two-thirds':
      cells.push({ x: 1, y: 1, w: 12, h: 12 });
      break;
    case 'center-two-thirds':
      cells.push({ x: 4, y: 1, w: 12, h: 12 });
      break;
    case 'last-two-thirds':
      cells.push({ x: 7, y: 1, w: 12, h: 12 });
      break;
    case 'first-fourth':
      cells.push({ x: 1, y: 1, w: 5, h: 12 });
      break;
    case 'second-fourth':
      cells.push({ x: 6, y: 1, w: 4, h: 12 });
      break;
    case 'third-fourth':
      cells.push({ x: 10, y: 1, w: 4, h: 12 });
      break;
    case 'last-fourth':
      cells.push({ x: 14, y: 1, w: 5, h: 12 });
      break;
    case 'first-three-fourths':
      cells.push({ x: 1, y: 1, w: 14, h: 12 });
      break;
    case 'center-three-fourths':
      cells.push({ x: 3, y: 1, w: 14, h: 12 });
      break;
    case 'last-three-fourths':
      cells.push({ x: 6, y: 1, w: 13, h: 12 });
      break;
    case 'top':
      cells.push({ x: 1, y: 1, w: 18, h: 6 });
      break;
    case 'bottom':
      cells.push({ x: 1, y: 7, w: 18, h: 6 });
      break;
    case 'fill':
      cells.push({ x: 1, y: 1, w: 18, h: 12 });
      break;
    case 'center':
      cells.push({ x: 4, y: 3, w: 12, h: 8 });
      break;
    case 'center-80':
      cells.push({ x: 3, y: 2, w: 14, h: 10 });
      break;
    case 'auto-organize':
      cells.push(
        { x: 1, y: 1, w: 8, h: 5 },
        { x: 11, y: 1, w: 8, h: 5 },
        { x: 1, y: 8, w: 8, h: 5 },
        { x: 11, y: 8, w: 8, h: 5 }
      );
      break;
    case 'increase-size-10':
    case 'decrease-size-10':
    case 'move-up-10':
    case 'move-down-10':
    case 'move-left-10':
    case 'move-right-10':
      cells.push({ x: 4, y: 3, w: 12, h: 8 });
      break;
    case 'increase-left-10':
    case 'decrease-left-10':
      cells.push({ x: 4, y: 2, w: 12, h: 10 });
      break;
    case 'increase-right-10':
    case 'decrease-right-10':
      cells.push({ x: 4, y: 2, w: 12, h: 10 });
      break;
    case 'increase-top-10':
    case 'decrease-top-10':
      cells.push({ x: 3, y: 3, w: 14, h: 9 });
      break;
    case 'increase-bottom-10':
    case 'decrease-bottom-10':
      cells.push({ x: 3, y: 2, w: 14, h: 9 });
      break;
    case 'next-display':
    case 'previous-display':
      break;
    case 'panel':
      cells.push({ x: 1, y: 1, w: 18, h: 12 });
      break;
    default:
      cells.push({ x: 1, y: 1, w: 18, h: 12 });
      break;
  }

  switch (glyphId) {
    case 'next-display':
      overlays.push(
        <rect
          key="display-left"
          x={0.8}
          y={2}
          width={6.8}
          height={9.8}
          rx={1}
          stroke="currentColor"
          strokeWidth={1}
          strokeOpacity={0.5}
        />,
        <rect
          key="display-right"
          x={12.4}
          y={2}
          width={6.8}
          height={9.8}
          rx={1}
          stroke="currentColor"
          strokeWidth={1}
          strokeOpacity={0.5}
        />,
        renderGlyphArrow('display-next', 8.4, 7, 11.6, 7)
      );
      break;
    case 'previous-display':
      overlays.push(
        <rect
          key="display-left"
          x={0.8}
          y={2}
          width={6.8}
          height={9.8}
          rx={1}
          stroke="currentColor"
          strokeWidth={1}
          strokeOpacity={0.5}
        />,
        <rect
          key="display-right"
          x={12.4}
          y={2}
          width={6.8}
          height={9.8}
          rx={1}
          stroke="currentColor"
          strokeWidth={1}
          strokeOpacity={0.5}
        />,
        renderGlyphArrow('display-prev', 11.6, 7, 8.4, 7)
      );
      break;
    case 'increase-size-10':
      overlays.push(
        <path key="grow-v" d="M10 4.6V9.4" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />,
        <path key="grow-h" d="M7.6 7H12.4" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
      );
      break;
    case 'decrease-size-10':
      overlays.push(
        <path key="shrink-h" d="M7.6 7H12.4" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
      );
      break;
    case 'increase-left-10':
      overlays.push(renderGlyphArrow('grow-left', 6.6, 7, 2, 7));
      break;
    case 'decrease-left-10':
      overlays.push(renderGlyphArrow('shrink-left', 2, 7, 6.6, 7));
      break;
    case 'increase-right-10':
      overlays.push(renderGlyphArrow('grow-right', 13.4, 7, 18, 7));
      break;
    case 'decrease-right-10':
      overlays.push(renderGlyphArrow('shrink-right', 18, 7, 13.4, 7));
      break;
    case 'increase-top-10':
      overlays.push(renderGlyphArrow('grow-top', 10, 5.5, 10, 1.2));
      break;
    case 'decrease-top-10':
      overlays.push(renderGlyphArrow('shrink-top', 10, 1.2, 10, 5.5));
      break;
    case 'increase-bottom-10':
      overlays.push(renderGlyphArrow('grow-bottom', 10, 8.5, 10, 12.8));
      break;
    case 'decrease-bottom-10':
      overlays.push(renderGlyphArrow('shrink-bottom', 10, 12.8, 10, 8.5));
      break;
    case 'move-up-10':
      overlays.push(renderGlyphArrow('move-up', 10, 10.5, 10, 2.2));
      break;
    case 'move-down-10':
      overlays.push(renderGlyphArrow('move-down', 10, 3.2, 10, 11.8));
      break;
    case 'move-left-10':
      overlays.push(renderGlyphArrow('move-left', 14.8, 7, 4.2, 7));
      break;
    case 'move-right-10':
      overlays.push(renderGlyphArrow('move-right', 5.2, 7, 15.8, 7));
      break;
    default:
      break;
  }

  return (
    <svg width={16} height={16} viewBox="0 0 20 14" fill="none" aria-hidden="true">
      {showOuterFrame ? (
        <rect
          x={0.75}
          y={0.75}
          width={18.5}
          height={12.5}
          rx={2}
          stroke="currentColor"
          strokeWidth={1}
          strokeOpacity={0.5}
        />
      ) : null}
      {cells.map((cell, index) => (
        <rect
          key={`${glyphId}-cell-${index}`}
          x={cell.x}
          y={cell.y}
          width={cell.w}
          height={cell.h}
          rx={1}
          fill="currentColor"
          fillOpacity={0.62}
        />
      ))}
      {overlays}
    </svg>
  );
}

function renderWindowManagementCommandIcon(commandId: string): React.ReactNode | null {
  const glyphId = resolveWindowManagementGlyphId(commandId);
  if (!glyphId) {
    return null;
  }
  if (glyphId === 'panel') {
    return (
      <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center">
        <LayoutGrid className="w-3 h-3 text-cyan-200" />
      </div>
    );
  }
  return (
    <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center text-cyan-100">
      {renderWindowManagementGlyph(glyphId)}
    </div>
  );
}

export function renderCommandIcon(command: CommandInfo): React.ReactNode {
  if (command.category === 'app' && isSuperCmdAppTitle(command.title)) {
    return renderSuperCmdLogoIcon();
  }
  if (command.iconDataUrl) {
    return (
      <img
        src={command.iconDataUrl}
        alt=""
        className="w-5 h-5 object-contain"
        draggable={false}
      />
    );
  }
  if (command.iconName) {
    return (
      <div
        className="w-5 h-5 rounded flex items-center justify-center"
        style={{ background: 'var(--icon-neutral-bg)', color: 'var(--icon-neutral-fg)' }}
      >
        {renderQuickLinkIconGlyph(command.iconName, 'w-3.5 h-3.5')}
      </div>
    );
  }
  if (command.category === 'system') {
    return getSystemCommandFallbackIcon(command.id);
  }
  if (command.category === 'extension') {
    return (
      <div className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">
        <Puzzle className="w-3 h-3 text-purple-400" />
      </div>
    );
  }
  if (command.category === 'script') {
    if (command.iconEmoji) {
      return <span className="text-sm leading-none">{command.iconEmoji}</span>;
    }
    return (
      <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center">
        <TerminalSquare className="w-3 h-3 text-emerald-300" />
      </div>
    );
  }
  return (
    <div
      className="w-5 h-5 rounded flex items-center justify-center"
      style={{ background: 'var(--icon-neutral-bg)', color: 'var(--icon-neutral-fg)' }}
    >
      <Settings className="w-3 h-3" />
    </div>
  );
}

export function getSystemCommandFallbackIcon(commandId: string): React.ReactNode {
  if (isSuperCmdSystemCommand(commandId)) {
    return renderSuperCmdLogoIcon();
  }

  if (commandId === 'system-cursor-prompt') {
    return (
      <div className="w-5 h-5 rounded bg-violet-500/20 flex items-center justify-center">
        <Sparkles className="w-3 h-3 text-violet-300" />
      </div>
    );
  }

  if (commandId === 'system-add-to-memory') {
    return (
      <div className="w-5 h-5 rounded bg-fuchsia-500/20 flex items-center justify-center">
        <Brain className="w-3 h-3 text-fuchsia-200" />
      </div>
    );
  }

  if (commandId === 'system-clipboard-manager') {
    return (
      <div
        className="w-5 h-5 rounded flex items-center justify-center"
        style={{ background: 'var(--icon-clipboard-bg)', color: 'var(--icon-clipboard-fg)' }}
      >
        <Clipboard className="w-3 h-3" />
      </div>
    );
  }

  if (
    commandId === 'system-create-snippet' ||
    commandId === 'system-search-snippets' ||
    commandId === 'system-import-snippets' ||
    commandId === 'system-export-snippets'
  ) {
    return (
      <div
        className="w-5 h-5 rounded flex items-center justify-center"
        style={{ background: 'var(--icon-snippet-bg)', color: 'var(--icon-snippet-fg)' }}
      >
        <FileText className="w-3 h-3" />
      </div>
    );
  }

  if (
    commandId === 'system-create-quicklink' ||
    commandId === 'system-search-quicklinks' ||
    commandId.startsWith('quicklink-')
  ) {
    return (
      <div
        className="w-5 h-5 rounded flex items-center justify-center"
        style={{ background: 'var(--icon-search-bg)', color: 'var(--icon-search-fg)' }}
      >
        <Link2 className="w-3 h-3" />
      </div>
    );
  }

  if (
    commandId === 'system-create-script-command' ||
    commandId === 'system-open-script-commands'
  ) {
    return (
      <div
        className="w-5 h-5 rounded flex items-center justify-center"
        style={{ background: 'var(--icon-script-bg)', color: 'var(--icon-script-fg)' }}
      >
        <TerminalSquare className="w-3 h-3" />
      </div>
    );
  }

  if (commandId === 'system-search-files') {
    return (
      <div
        className="w-5 h-5 rounded flex items-center justify-center"
        style={{ background: 'var(--icon-search-bg)', color: 'var(--icon-search-fg)' }}
      >
        <Search className="w-3 h-3" />
      </div>
    );
  }

  if (commandId === 'system-supercmd-whisper') {
    return (
      <div className="w-5 h-5 rounded bg-sky-500/20 flex items-center justify-center">
        <Mic className="w-3 h-3 text-sky-300" />
      </div>
    );
  }

  if (commandId === 'system-whisper-onboarding') {
    return (
      <div className="w-5 h-5 rounded bg-sky-500/20 flex items-center justify-center">
        <Sparkles className="w-3 h-3 text-sky-200" />
      </div>
    );
  }

  if (commandId === 'system-supercmd-speak') {
    return (
      <div className="w-5 h-5 rounded bg-indigo-500/20 flex items-center justify-center">
        <Volume2 className="w-3 h-3 text-indigo-200" />
      </div>
    );
  }

  const windowManagementIcon = renderWindowManagementCommandIcon(commandId);
  if (windowManagementIcon) {
    return windowManagementIcon;
  }

  if (commandId === 'system-check-for-updates') {
    return (
      <div className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center">
        <RefreshCw className="w-3 h-3 text-green-300" />
      </div>
    );
  }

  return (
    <div className="w-5 h-5 rounded bg-red-500/20 flex items-center justify-center">
      <Power className="w-3 h-3 text-red-400" />
    </div>
  );
}

export function renderShortcutLabel(shortcut?: string): string {
  if (!shortcut) return '';
  return formatShortcutForDisplay(shortcut).replace(/ \+ /g, ' ');
}

export function parseIntervalToMs(interval?: string): number | null {
  if (!interval) return null;
  const trimmed = interval.trim();
  const match = trimmed.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2].toLowerCase();
  const unitMs =
    unit === 's' ? 1_000 :
    unit === 'm' ? 60_000 :
    unit === 'h' ? 60 * 60_000 :
    24 * 60 * 60_000;
  return value * unitMs;
}
