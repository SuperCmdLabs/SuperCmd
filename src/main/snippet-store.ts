/**
 * Snippet Store
 *
 * Manages text snippets with dynamic placeholder support.
 * - Stores snippets as JSON on disk
 * - In-memory cache for fast access
 * - Supports placeholders: {clipboard}, {date}, {time}, {date:FORMAT}, {time:FORMAT}, {random:UUID}
 * - Import/export via OS file dialogs
 */

import { app, clipboard, dialog, BrowserWindow, SaveDialogOptions, OpenDialogOptions } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface Snippet {
  id: string;
  name: string;
  content: string;
  keyword?: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

let snippetsCache: Snippet[] | null = null;

// ─── Paths ──────────────────────────────────────────────────────────

function getSnippetsDir(): string {
  const dir = path.join(app.getPath('userData'), 'snippets');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getSnippetsFilePath(): string {
  return path.join(getSnippetsDir(), 'snippets.json');
}

// ─── Persistence ────────────────────────────────────────────────────

function loadFromDisk(): Snippet[] {
  try {
    const filePath = getSnippetsFilePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => ({
          id: String(item.id || crypto.randomUUID()),
          name: String(item.name || ''),
          content: String(item.content || ''),
          keyword: typeof item.keyword === 'string' && item.keyword.trim() ? item.keyword.trim() : undefined,
          pinned: Boolean(item.pinned),
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        }));
      }
    }
  } catch (e) {
    console.error('Failed to load snippets from disk:', e);
  }
  return [];
}

function saveToDisk(): void {
  try {
    const filePath = getSnippetsFilePath();
    fs.writeFileSync(filePath, JSON.stringify(snippetsCache || [], null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save snippets to disk:', e);
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export function initSnippetStore(): void {
  snippetsCache = loadFromDisk();
  console.log(`[Snippets] Loaded ${snippetsCache.length} snippet(s)`);
}

export function getAllSnippets(): Snippet[] {
  if (!snippetsCache) snippetsCache = loadFromDisk();
  return [...snippetsCache].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt;
  });
}

export function searchSnippets(query: string): Snippet[] {
  const all = getAllSnippets();
  if (!query.trim()) return all;

  const lowerQuery = query.toLowerCase();
  return all.filter((s) => {
    return (
      s.name.toLowerCase().includes(lowerQuery) ||
      s.content.toLowerCase().includes(lowerQuery) ||
      (s.keyword && s.keyword.toLowerCase().includes(lowerQuery))
    );
  });
}

export function getSnippetById(id: string): Snippet | null {
  const all = getAllSnippets();
  return all.find((s) => s.id === id) || null;
}

export function createSnippet(data: { name: string; content: string; keyword?: string }): Snippet {
  if (!snippetsCache) snippetsCache = loadFromDisk();

  const snippet: Snippet = {
    id: crypto.randomUUID(),
    name: data.name,
    content: data.content,
    keyword: data.keyword || undefined,
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  snippetsCache.push(snippet);
  saveToDisk();
  return snippet;
}

export function updateSnippet(
  id: string,
  data: Partial<Pick<Snippet, 'name' | 'content' | 'keyword' | 'pinned'>>
): Snippet | null {
  if (!snippetsCache) snippetsCache = loadFromDisk();

  const index = snippetsCache.findIndex((s) => s.id === id);
  if (index === -1) return null;

  const snippet = snippetsCache[index];
  if (data.name !== undefined) snippet.name = data.name;
  if (data.content !== undefined) snippet.content = data.content;
  if (data.keyword !== undefined) snippet.keyword = data.keyword || undefined;
  if (data.pinned !== undefined) snippet.pinned = Boolean(data.pinned);
  snippet.updatedAt = Date.now();

  saveToDisk();
  return { ...snippet };
}

export function deleteSnippet(id: string): boolean {
  if (!snippetsCache) snippetsCache = loadFromDisk();

  const index = snippetsCache.findIndex((s) => s.id === id);
  if (index === -1) return false;

  snippetsCache.splice(index, 1);
  saveToDisk();
  return true;
}

export function deleteAllSnippets(): number {
  if (!snippetsCache) snippetsCache = loadFromDisk();
  const removed = snippetsCache.length;
  snippetsCache = [];
  saveToDisk();
  return removed;
}

export function duplicateSnippet(id: string): Snippet | null {
  if (!snippetsCache) snippetsCache = loadFromDisk();
  const original = snippetsCache.find((s) => s.id === id);
  if (!original) return null;

  const duplicate: Snippet = {
    ...original,
    id: crypto.randomUUID(),
    name: `${original.name} Copy`,
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  snippetsCache.push(duplicate);
  saveToDisk();
  return duplicate;
}

export function togglePinSnippet(id: string): Snippet | null {
  if (!snippetsCache) snippetsCache = loadFromDisk();
  const snippet = snippetsCache.find((s) => s.id === id);
  if (!snippet) return null;
  snippet.pinned = !snippet.pinned;
  snippet.updatedAt = Date.now();
  saveToDisk();
  return { ...snippet };
}

export function getSnippetByKeyword(keyword: string): Snippet | null {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return null;
  return getAllSnippets().find((s) => (s.keyword || '').trim().toLowerCase() === normalized) || null;
}

// ─── Placeholder Resolution ─────────────────────────────────────────

export interface SnippetDynamicField {
  key: string;
  name: string;
  defaultValue?: string;
}

function parseArgumentToken(rawToken: string): { key: string; name: string; defaultValue?: string } | null {
  const token = rawToken.trim();
  if (!token.startsWith('argument')) return null;

  const nameMatch = token.match(/name\s*=\s*"([^"]+)"/i);
  const defaultMatch = token.match(/default\s*=\s*"([^"]*)"/i);
  const fallbackNameMatch = token.match(/^argument(?::|\s+)(.+)$/i);

  const name = (nameMatch?.[1] || fallbackNameMatch?.[1] || '').trim();
  if (!name) return null;

  return {
    key: name.toLowerCase(),
    name,
    defaultValue: defaultMatch?.[1],
  };
}

export function extractSnippetDynamicFields(content: string): SnippetDynamicField[] {
  const fields = new Map<string, SnippetDynamicField>();
  const re = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(content)) !== null) {
    const parsed = parseArgumentToken(match[1]);
    if (!parsed) continue;
    if (!fields.has(parsed.key)) fields.set(parsed.key, parsed);
  }
  return Array.from(fields.values());
}

export function resolveSnippetPlaceholders(content: string, dynamicValues?: Record<string, string>): string {
  const now = new Date();
  const values = dynamicValues || {};

  return content.replace(/\{([^}]+)\}/g, (match, token: string) => {
    const trimmed = token.trim();
    const arg = parseArgumentToken(trimmed);
    if (arg) {
      const provided = values[arg.key] ?? values[arg.name] ?? '';
      return String(provided || arg.defaultValue || '');
    }

    if (trimmed === 'clipboard') {
      return clipboard.readText() || '';
    }

    if (trimmed === 'cursor-position') {
      return '';
    }

    if (trimmed === 'date') {
      return now.toLocaleDateString();
    }

    if (trimmed === 'time') {
      return now.toLocaleTimeString();
    }

    if (trimmed.startsWith('date:')) {
      const fmt = trimmed.slice(5);
      return formatDate(now, fmt);
    }

    if (trimmed.startsWith('time:')) {
      const fmt = trimmed.slice(5);
      return formatDate(now, fmt);
    }

    if (trimmed === 'random:UUID') {
      return crypto.randomUUID();
    }

    // Unknown placeholder — leave as-is
    return match;
  });
}

function formatDate(date: Date, format: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return format
    .replace('YYYY', String(date.getFullYear()))
    .replace('MM', pad(date.getMonth() + 1))
    .replace('DD', pad(date.getDate()))
    .replace('HH', pad(date.getHours()))
    .replace('mm', pad(date.getMinutes()))
    .replace('ss', pad(date.getSeconds()));
}

// ─── Copy to Clipboard ─────────────────────────────────────────────

export function copySnippetToClipboard(id: string): boolean {
  const snippet = getSnippetById(id);
  if (!snippet) return false;

  const resolved = resolveSnippetPlaceholders(snippet.content);
  clipboard.writeText(resolved);
  return true;
}

export function copySnippetToClipboardResolved(id: string, dynamicValues?: Record<string, string>): boolean {
  const snippet = getSnippetById(id);
  if (!snippet) return false;
  const resolved = resolveSnippetPlaceholders(snippet.content, dynamicValues);
  clipboard.writeText(resolved);
  return true;
}

export function getSnippetDynamicFieldsById(id: string): SnippetDynamicField[] {
  const snippet = getSnippetById(id);
  if (!snippet) return [];
  return extractSnippetDynamicFields(snippet.content);
}

export function renderSnippetById(id: string, dynamicValues?: Record<string, string>): string | null {
  const snippet = getSnippetById(id);
  if (!snippet) return null;
  return resolveSnippetPlaceholders(snippet.content, dynamicValues);
}

// ─── Import / Export ────────────────────────────────────────────────

interface SnippetExportFile {
  version: number;
  app: string;
  type: string;
  exportedAt: string;
  snippets: Array<{ name: string; content: string; keyword?: string; pinned?: boolean }>;
}

export async function exportSnippetsToFile(parentWindow?: BrowserWindow): Promise<boolean> {
  const dialogOptions: SaveDialogOptions = {
    title: 'Export Snippets',
    defaultPath: 'snippets.json',
    filters: [{ name: 'SuperCommand Snippets', extensions: ['json'] }],
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) return false;

  const all = getAllSnippets();
  const exportData: SnippetExportFile = {
    version: 1,
    app: 'SuperCommand',
    type: 'snippets',
    exportedAt: new Date().toISOString(),
    snippets: all.map((s) => ({
      name: s.name,
      content: s.content,
      keyword: s.keyword,
      pinned: s.pinned,
    })),
  };

  fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
  return true;
}

export async function importSnippetsFromFile(parentWindow?: BrowserWindow): Promise<{ imported: number; skipped: number }> {
  const dialogOptions: OpenDialogOptions = {
    title: 'Import Snippets',
    filters: [{ name: 'SuperCommand Snippets', extensions: ['json'] }],
    properties: ['openFile'],
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return { imported: 0, skipped: 0 };
  }

  try {
    const data = fs.readFileSync(result.filePaths[0], 'utf-8');
    const parsed = JSON.parse(data);

    let snippetsToImport: Array<{ name: string; content: string; keyword?: string; pinned?: boolean }> = [];

    // Support our export format
    if (parsed.type === 'snippets' && Array.isArray(parsed.snippets)) {
      snippetsToImport = parsed.snippets;
    }
    // Also support a plain array
    else if (Array.isArray(parsed)) {
      snippetsToImport = parsed;
    } else {
      return { imported: 0, skipped: 0 };
    }

    if (!snippetsCache) snippetsCache = loadFromDisk();

    let imported = 0;
    let skipped = 0;

    for (const item of snippetsToImport) {
      if (!item.name || !item.content) {
        skipped++;
        continue;
      }

      // Skip duplicates by name
      const exists = snippetsCache.some(
        (s) => s.name.toLowerCase() === item.name.toLowerCase()
      );
      if (exists) {
        skipped++;
        continue;
      }

      snippetsCache.push({
        id: crypto.randomUUID(),
        name: item.name,
        content: item.content,
        keyword: item.keyword || undefined,
        pinned: Boolean(item.pinned),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      imported++;
    }

    if (imported > 0) {
      saveToDisk();
    }

    return { imported, skipped };
  } catch (e) {
    console.error('Failed to import snippets:', e);
    return { imported: 0, skipped: 0 };
  }
}
