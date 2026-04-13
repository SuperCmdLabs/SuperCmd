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
import { Search, Power, Settings, Puzzle, Sparkles, FileText, Mic, Volume2, Brain, TerminalSquare, RefreshCw, LayoutGrid, Lock, Trash2 } from 'lucide-react';
import type { CommandInfo, EdgeTtsVoice } from '../../types/electron';
import supercmdLogo from '../../../../supercmd.svg';
import IconCalendar from '../icons/Calendar';
import IconCamera from '../icons/Camera';
import IconClipboard from '../icons/Clipboard';
import IconMagnifier from '../icons/FileSearch';
import IconLink from '../icons/QuickLinks';
import IconCodeEditor from '../icons/Snippet';
import IconNotes from '../icons/Notes';
import IconPen from '../icons/Pen';
import { formatShortcutForDisplay } from './hyper-key';
import { renderQuickLinkIconGlyph } from './quicklink-icons';

export { filterCommands } from './command-search';

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

type Translator = (key: string, params?: Record<string, string | number>) => string;

function buildCoreIconStyle(
  gradient1Top: string,
  gradient1Bottom: string,
  gradient2Top: string,
  gradient2Bottom: string
): React.CSSProperties {
  return {
    '--nc-gradient-1-color-1': gradient1Top,
    '--nc-gradient-1-color-2': gradient1Bottom,
    '--nc-gradient-2-color-1': gradient2Top,
    '--nc-gradient-2-color-2': gradient2Bottom,
  } as React.CSSProperties;
}

/**
 * Get category display label
 */
export function getCategoryLabel(category: string, t?: Translator): string {
  switch (category) {
    case 'settings':
      return t ? t('launcher.badges.settings') : 'System Settings';
    case 'system':
      return t ? t('common.system') : 'System';
    case 'extension':
      return t ? t('launcher.badges.extension') : 'Extension';
    case 'script':
      return t ? t('launcher.badges.script') : 'Script';
    case 'app':
    default:
      return t ? t('launcher.badges.application') : 'Application';
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

export function getCommandTypeBadgeLabel(command: CommandInfo, t?: Translator): string {
  const commandId = String(command.id || '').trim();
  if (commandId.startsWith('quicklink-')) {
    return t ? t('launcher.badges.quickLink') : 'Quick Link';
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

export function getCommandDisplayTitle(command: CommandInfo, t?: Translator): string {
  if (command.category === 'app' && isSuperCmdAppTitle(command.title)) return 'SuperCmd';
  if (t) {
    switch (String(command.id || '').trim()) {
      case 'system-open-settings':
        return t('settings.title');
      case 'system-supercmd-whisper':
        return t('whisper.title');
      case 'system-supercmd-speak':
        return t('read.title');
      default:
        break;
    }
  }
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
      <div className="w-5 h-5 flex items-center justify-center">
        <IconClipboard
          size="16px"
          aria-hidden="true"
          style={buildCoreIconStyle('#fda4af', '#be123c', '#fff1f2cc', '#fecdd399')}
        />
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
      <div className="w-5 h-5 flex items-center justify-center">
        <IconNotes
          size="16px"
          aria-hidden="true"
          style={buildCoreIconStyle('#fcd34d', '#d97706', '#fef3c7b8', '#fcd34d90')}
        />
      </div>
    );
  }

  if (
    commandId === 'system-search-notes' ||
    commandId === 'system-create-note'
  ) {
    return (
      <div className="w-5 h-5 flex items-center justify-center">
        <IconPen
          size="16px"
          aria-hidden="true"
          style={buildCoreIconStyle('#c4b5fd', '#7c3aed', '#ede9feb8', '#c4b5fd90')}
        />
      </div>
    );
  }

  if (
    commandId === 'system-search-canvases' ||
    commandId === 'system-create-canvas'
  ) {
    return (
      <div className="w-5 h-5 flex items-center justify-center">
        <IconCodeEditor
          size="16px"
          aria-hidden="true"
          style={buildCoreIconStyle('#fcd34d', '#d97706', '#fef3c7b8', '#fcd34d90')}
        />
      </div>
    );
  }

  if (
    commandId === 'system-create-quicklink' ||
    commandId === 'system-search-quicklinks' ||
    commandId.startsWith('quicklink-')
  ) {
    return (
      <div className="w-5 h-5 flex items-center justify-center">
        <IconLink
          size="16px"
          aria-hidden="true"
          style={buildCoreIconStyle('#86efac', '#16a34a', '#dcfce7b8', '#86efac90')}
        />
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
      <div className="w-5 h-5 flex items-center justify-center">
        <IconMagnifier
          size="16px"
          aria-hidden="true"
          style={buildCoreIconStyle('#86efac', '#16a34a', '#dcfce7b8', '#86efac90')}
        />
      </div>
    );
  }

  if (commandId === 'system-my-schedule') {
    return (
      <div className="w-5 h-5 flex items-center justify-center">
        <IconCalendar
          size="16px"
          aria-hidden="true"
          style={
            {
              '--nc-gradient-1-color-1': '#fecdd3',
              '--nc-gradient-1-color-2': '#e11d48',
              '--nc-gradient-2-color-1': '#fff1f2b8',
              '--nc-gradient-2-color-2': '#fecdd390',
            } as React.CSSProperties
          }
        />
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

  if (commandId === 'system-camera') {
    return (
      <div className="w-5 h-5 flex items-center justify-center">
        <IconCamera
          size="16px"
          aria-hidden="true"
          style={buildCoreIconStyle('#a5f3fc', '#0891b2', '#cffafecc', '#a5f3fc99')}
        />
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

  if (commandId === 'system-lock-screen') {
    return (
      <div className="w-5 h-5 rounded bg-slate-500/20 flex items-center justify-center">
        <Lock className="w-3 h-3 text-slate-300" />
      </div>
    );
  }

  if (commandId === 'system-empty-trash') {
    return (
      <div className="w-5 h-5 rounded bg-orange-500/20 flex items-center justify-center">
        <Trash2 className="w-3 h-3 text-orange-300" />
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
