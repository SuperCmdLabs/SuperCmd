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
import { Search, Power, Settings, Puzzle, Sparkles, Clipboard, FileText, Mic, Volume2, Brain, TerminalSquare } from 'lucide-react';
import type { CommandInfo, EdgeTtsVoice } from '../../types/electron';
import supercmdLogo from '../../../../supercmd.svg';

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

/**
 * Filter and sort commands based on search query
 */
export function filterCommands(commands: CommandInfo[], query: string): CommandInfo[] {
  if (!query.trim()) {
    return commands;
  }

  const lowerQuery = query.toLowerCase().trim();

  const scored = commands
    .map((cmd) => {
      const lowerTitle = cmd.title.toLowerCase();
      const lowerSubtitle = String(cmd.subtitle || '').toLowerCase();
      const keywords = cmd.keywords?.map((k) => k.toLowerCase()) || [];

      let score = 0;

      // Exact match
      if (lowerTitle === lowerQuery) {
        score = 200;
      }
      // Title starts with query
      else if (lowerTitle.startsWith(lowerQuery)) {
        score = 100;
      }
      // Title includes query
      else if (lowerTitle.includes(lowerQuery)) {
        score = 75;
      }
      // Keywords start with query
      else if (keywords.some((k) => k.startsWith(lowerQuery))) {
        score = 50;
      }
      // Keywords include query
      else if (keywords.some((k) => k.includes(lowerQuery))) {
        score = 25;
      }
      // Subtitle match
      else if (lowerSubtitle.includes(lowerQuery)) {
        score = 22;
      }

      return { cmd, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

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

export function formatShortcutLabel(shortcut: string): string {
  return String(shortcut || '')
    .replace(/Command/g, '\u2318')
    .replace(/Control/g, '\u2303')
    .replace(/Alt/g, '\u2325')
    .replace(/Shift/g, '\u21E7')
    .replace(/Period/g, '.')
    .replace(/\+/g, ' ');
}

export function isSuperCmdAppTitle(title: string): boolean {
  const key = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key === 'supercommand' || key === 'supercmd';
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
    <div className="w-5 h-5 rounded bg-gray-500/20 flex items-center justify-center">
      <Settings className="w-3 h-3 text-gray-400" />
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
      <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center">
        <Clipboard className="w-3 h-3 text-cyan-300" />
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
      <div className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center">
        <FileText className="w-3 h-3 text-amber-300" />
      </div>
    );
  }

  if (
    commandId === 'system-create-script-command' ||
    commandId === 'system-open-script-commands'
  ) {
    return (
      <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center">
        <TerminalSquare className="w-3 h-3 text-emerald-300" />
      </div>
    );
  }

  if (commandId === 'system-search-files') {
    return (
      <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center">
        <Search className="w-3 h-3 text-emerald-300" />
      </div>
    );
  }

  if (commandId === 'system-supercommand-whisper') {
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

  if (commandId === 'system-supercommand-speak') {
    return (
      <div className="w-5 h-5 rounded bg-indigo-500/20 flex items-center justify-center">
        <Volume2 className="w-3 h-3 text-indigo-200" />
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
  return shortcut
    .replace(/Command|Cmd/gi, '⌘')
    .replace(/Control|Ctrl/gi, '⌃')
    .replace(/Alt|Option/gi, '⌥')
    .replace(/Shift/gi, '⇧')
    .replace(/ArrowUp/g, '↑')
    .replace(/ArrowDown/g, '↓')
    .replace(/Backspace|Delete/g, '⌫')
    .replace(/\+/g, ' ');
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
