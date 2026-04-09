/**
 * Personal Commands
 *
 * Loads user-defined commands from:
 *   ~/Library/Application Support/SuperCmd/personal-commands.json
 *
 * Each entry supports:
 *   id        – unique string (auto-generated from title if omitted)
 *   title     – display name
 *   subtitle  – optional secondary line
 *   icon      – emoji character OR a URL pointing to an image
 *   keywords  – array of alias strings for search
 *   action    – one of: "url" | "shell" | "copy" | "open"
 *   target    – the URL, shell command, text to copy, or file/folder path
 *
 * This file is safe to edit directly. Changes are picked up after the
 * command cache is invalidated (launcher restart or cache TTL expiry).
 *
 * Example personal-commands.json:
 * [
 *   { "title": "GitHub", "icon": "🐙", "action": "url", "target": "https://github.com" },
 *   { "title": "Today's standup", "icon": "📋", "action": "shell", "target": "open -a Zoom" }
 * ]
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { CommandInfo } from './commands';

export type PersonalCommandAction = 'url' | 'shell' | 'copy' | 'open';

export interface PersonalCommandDef {
  id?: string;
  title: string;
  subtitle?: string;
  icon?: string;
  keywords?: string[];
  action: PersonalCommandAction;
  target: string;
}

export const PERSONAL_COMMAND_PREFIX = 'personal-';

function getPersonalCommandsPath(): string {
  return path.join(app.getPath('userData'), 'personal-commands.json');
}

function makeId(def: PersonalCommandDef, index: number): string {
  if (def.id) return `${PERSONAL_COMMAND_PREFIX}${def.id}`;
  const slug = def.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // Hash target to avoid collisions between similar titles
  const hash = crypto.createHash('sha1').update(def.target).digest('hex').slice(0, 6);
  return `${PERSONAL_COMMAND_PREFIX}${slug || `cmd-${index}`}-${hash}`;
}

/**
 * Load personal command definitions from disk.
 * Returns an empty array if the file is missing or invalid.
 */
export function loadPersonalCommandDefs(): PersonalCommandDef[] {
  const configPath = getPersonalCommandsPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PersonalCommandDef =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.title === 'string' &&
        entry.title.trim() &&
        typeof entry.action === 'string' &&
        ['url', 'shell', 'copy', 'open'].includes(entry.action) &&
        typeof entry.target === 'string' &&
        entry.target.trim()
    );
  } catch {
    return [];
  }
}

/**
 * Convert personal command definitions to CommandInfo objects.
 * The `category` is cast to `'system'` so existing execution paths don't
 * choke — actual dispatch happens via the `personal-*` id prefix in main.ts.
 */
export function getPersonalCommands(): CommandInfo[] {
  const defs = loadPersonalCommandDefs();
  return defs.map((def, index) => {
    const id = makeId(def, index);
    const cmd: CommandInfo = {
      id,
      title: def.title.trim(),
      subtitle: def.subtitle?.trim(),
      keywords: Array.isArray(def.keywords) ? def.keywords.map(String) : [],
      category: 'personal' as const,
      // Encode action + target as a JSON string in the path field so the
      // executor in main.ts can decode it without new IPC.
      path: JSON.stringify({ action: def.action, target: def.target }),
    };
    if (def.icon) {
      // Simple emoji detection: single grapheme cluster of non-ASCII
      const isEmoji = /^\p{Emoji}/u.test(def.icon) && def.icon.length <= 8;
      if (isEmoji) {
        cmd.iconEmoji = def.icon;
      } else if (def.icon.startsWith('http')) {
        // Remote icon URL stored as iconName for the renderer to resolve
        cmd.iconName = def.icon;
      }
    }
    return cmd;
  });
}

/**
 * Ensure the config file exists with starter examples.
 * Call once on first run.
 */
export function ensurePersonalCommandsFile(): void {
  const configPath = getPersonalCommandsPath();
  if (fs.existsSync(configPath)) return;

  const examples: PersonalCommandDef[] = [
    {
      title: 'GitHub',
      subtitle: 'Open GitHub in browser',
      icon: '🐙',
      keywords: ['git', 'code', 'repo'],
      action: 'url',
      target: 'https://github.com',
    },
    {
      title: 'Downloads Folder',
      subtitle: 'Open your Downloads folder',
      icon: '📥',
      keywords: ['download', 'files'],
      action: 'open',
      target: `${app.getPath('home')}/Downloads`,
    },
    {
      title: 'Copy IP Address',
      subtitle: 'Copy machine hostname to clipboard',
      icon: '🌐',
      keywords: ['ip', 'hostname', 'network'],
      action: 'shell',
      target: "hostname -I 2>/dev/null | awk '{print $1}' || hostname",
    },
    {
      title: 'Work Notes',
      subtitle: 'Open work notes file',
      icon: '📝',
      keywords: ['notes', 'todo', 'work'],
      action: 'open',
      target: `${app.getPath('home')}/Documents/notes.md`,
    },
    {
      title: 'Quick Google Search',
      subtitle: 'Search Google for selected text',
      icon: '🔍',
      keywords: ['search', 'google', 'web'],
      action: 'url',
      target: 'https://google.com',
    },
  ];

  try {
    fs.writeFileSync(configPath, JSON.stringify(examples, null, 2));
  } catch (e) {
    console.error('[PersonalCommands] Failed to write starter config:', e);
  }
}
