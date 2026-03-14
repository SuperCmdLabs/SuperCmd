/**
 * Notes Store
 *
 * Manages markdown notes with full Raycast Notes feature parity:
 * - Markdown support (headings, bold, italics, lists, checklists)
 * - Unlimited notes storage
 * - Custom themes per note
 * - Pin/unpin notes
 * - Export as plain text, markdown, or HTML
 * - Import/export collections
 * - Search across title and content
 */

import { app, clipboard, dialog, BrowserWindow, SaveDialogOptions, OpenDialogOptions } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────

export type NoteTheme =
  | 'default'
  | 'rose'
  | 'orange'
  | 'amber'
  | 'emerald'
  | 'cyan'
  | 'blue'
  | 'violet'
  | 'fuchsia'
  | 'slate';

export type NoteExportFormat = 'markdown' | 'plaintext' | 'html';

export interface Note {
  id: string;
  title: string;
  icon: string;              // emoji icon for the note
  content: string;           // markdown content
  theme: NoteTheme;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── Cache ──────────────────────────────────────────────────────────

let notesCache: Note[] | null = null;

// ─── Paths ──────────────────────────────────────────────────────────

function getNotesDir(): string {
  const dir = path.join(app.getPath('userData'), 'notes');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getNotesFilePath(): string {
  return path.join(getNotesDir(), 'notes.json');
}

// ─── Persistence ────────────────────────────────────────────────────

function loadFromDisk(): Note[] {
  try {
    const filePath = getNotesFilePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => ({
          id: String(item.id || crypto.randomUUID()),
          title: String(item.title || ''),
          icon: typeof item.icon === 'string' ? item.icon : '',
          content: String(item.content || ''),
          theme: isValidTheme(item.theme) ? item.theme : 'default',
          pinned: Boolean(item.pinned),
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        }));
      }
    }
  } catch (e) {
    console.error('Failed to load notes from disk:', e);
  }
  return [];
}

function saveToDisk(): void {
  try {
    const filePath = getNotesFilePath();
    fs.writeFileSync(filePath, JSON.stringify(notesCache || [], null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save notes to disk:', e);
  }
}

const VALID_THEMES: Set<string> = new Set([
  'default', 'rose', 'orange', 'amber', 'emerald',
  'cyan', 'blue', 'violet', 'fuchsia', 'slate',
]);

function isValidTheme(value: unknown): value is NoteTheme {
  return typeof value === 'string' && VALID_THEMES.has(value);
}

// ─── Public API ─────────────────────────────────────────────────────

export function initNoteStore(): void {
  notesCache = loadFromDisk();
  console.log(`[Notes] Loaded ${notesCache.length} note(s)`);
}

export function getAllNotes(): Note[] {
  if (!notesCache) notesCache = loadFromDisk();
  return [...notesCache].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt;
  });
}

export function searchNotes(query: string): Note[] {
  const all = getAllNotes();
  if (!query.trim()) return all;

  const lowerQuery = query.toLowerCase();
  return all.filter((n) => {
    return (
      n.title.toLowerCase().includes(lowerQuery) ||
      n.content.toLowerCase().includes(lowerQuery)
    );
  });
}

export function getNoteById(id: string): Note | null {
  const all = getAllNotes();
  return all.find((n) => n.id === id) || null;
}

export function createNote(data: {
  title: string;
  icon?: string;
  content?: string;
  theme?: NoteTheme;
}): Note {
  if (!notesCache) notesCache = loadFromDisk();

  const note: Note = {
    id: crypto.randomUUID(),
    title: data.title || 'Untitled',
    icon: data.icon || '',
    content: data.content || '',
    theme: data.theme && isValidTheme(data.theme) ? data.theme : 'default',
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  notesCache.push(note);
  saveToDisk();
  return note;
}

export function updateNote(
  id: string,
  data: Partial<Pick<Note, 'title' | 'icon' | 'content' | 'theme' | 'pinned'>>
): Note | null {
  if (!notesCache) notesCache = loadFromDisk();

  const index = notesCache.findIndex((n) => n.id === id);
  if (index === -1) return null;

  const note = notesCache[index];
  if (data.title !== undefined) note.title = data.title;
  if (data.icon !== undefined) note.icon = data.icon;
  if (data.content !== undefined) note.content = data.content;
  if (data.theme !== undefined && isValidTheme(data.theme)) note.theme = data.theme;
  if (data.pinned !== undefined) note.pinned = Boolean(data.pinned);
  note.updatedAt = Date.now();

  saveToDisk();
  return { ...note };
}

export function deleteNote(id: string): boolean {
  if (!notesCache) notesCache = loadFromDisk();

  const index = notesCache.findIndex((n) => n.id === id);
  if (index === -1) return false;

  notesCache.splice(index, 1);
  saveToDisk();
  return true;
}

export function deleteAllNotes(): number {
  if (!notesCache) notesCache = loadFromDisk();
  const removed = notesCache.length;
  notesCache = [];
  saveToDisk();
  return removed;
}

export function duplicateNote(id: string): Note | null {
  if (!notesCache) notesCache = loadFromDisk();
  const original = notesCache.find((n) => n.id === id);
  if (!original) return null;

  const duplicate: Note = {
    ...original,
    id: crypto.randomUUID(),
    title: `${original.title} Copy`,
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  notesCache.push(duplicate);
  saveToDisk();
  return duplicate;
}

export function togglePinNote(id: string): Note | null {
  if (!notesCache) notesCache = loadFromDisk();
  const note = notesCache.find((n) => n.id === id);
  if (!note) return null;
  note.pinned = !note.pinned;
  note.updatedAt = Date.now();
  saveToDisk();
  return { ...note };
}

// ─── Copy to Clipboard ─────────────────────────────────────────────

export function copyNoteToClipboard(id: string, format: NoteExportFormat = 'markdown'): boolean {
  const note = getNoteById(id);
  if (!note) return false;

  const text = formatNoteForExport(note, format);
  clipboard.writeText(text);
  return true;
}

// ─── Export Formatting ──────────────────────────────────────────────

function formatNoteForExport(note: Note, format: NoteExportFormat): string {
  switch (format) {
    case 'plaintext':
      return stripMarkdown(note.content);
    case 'html':
      return markdownToBasicHtml(note.title, note.content);
    case 'markdown':
    default:
      return note.content;
  }
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')           // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')       // bold
    .replace(/\*(.+?)\*/g, '$1')           // italic
    .replace(/__(.+?)__/g, '$1')           // bold alt
    .replace(/_(.+?)_/g, '$1')             // italic alt
    .replace(/~~(.+?)~~/g, '$1')           // strikethrough
    .replace(/`(.+?)`/g, '$1')             // inline code
    .replace(/```[\s\S]*?```/g, '')        // code blocks
    .replace(/!\[.*?\]\(.*?\)/g, '')       // images
    .replace(/\[(.+?)\]\(.*?\)/g, '$1')   // links
    .replace(/^[-*+]\s+/gm, '• ')         // unordered lists
    .replace(/^\d+\.\s+/gm, '')           // ordered lists
    .replace(/^>\s+/gm, '')               // blockquotes
    .replace(/^---$/gm, '')               // horizontal rules
    .replace(/- \[[ x]\]\s*/gm, '')       // checklists
    .trim();
}

function markdownToBasicHtml(title: string, md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/- \[x\]\s*(.+)/gm, '<li style="list-style:none"><input type="checkbox" checked disabled> $1</li>')
    .replace(/- \[ \]\s*(.+)/gm, '<li style="list-style:none"><input type="checkbox" disabled> $1</li>')
    .replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>\n');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<h1>${title}</h1>
${html}
</body>
</html>`;
}

// ─── Export Single Note to File ─────────────────────────────────────

export async function exportNoteToFile(
  id: string,
  format: NoteExportFormat,
  parentWindow?: BrowserWindow
): Promise<boolean> {
  const note = getNoteById(id);
  if (!note) return false;

  const ext = format === 'html' ? 'html' : format === 'plaintext' ? 'txt' : 'md';
  const filterName = format === 'html' ? 'HTML' : format === 'plaintext' ? 'Text' : 'Markdown';

  const dialogOptions: SaveDialogOptions = {
    title: 'Export Note',
    defaultPath: `${note.title.replace(/[/\\?%*:|"<>]/g, '-')}.${ext}`,
    filters: [{ name: filterName, extensions: [ext] }],
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) return false;

  const text = formatNoteForExport(note, format);
  fs.writeFileSync(result.filePath, text, 'utf-8');
  return true;
}

// ─── Import / Export Collection ─────────────────────────────────────

interface NoteExportFile {
  version: number;
  app: string;
  type: string;
  exportedAt: string;
  notes: Array<{
    title: string;
    icon?: string;
    content: string;
    theme?: NoteTheme;
    pinned?: boolean;
  }>;
}

export async function exportNotesToFile(parentWindow?: BrowserWindow): Promise<boolean> {
  const dialogOptions: SaveDialogOptions = {
    title: 'Export Notes',
    defaultPath: 'notes.json',
    filters: [{ name: 'SuperCmd Notes', extensions: ['json'] }],
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) return false;

  const all = getAllNotes();
  const exportData: NoteExportFile = {
    version: 1,
    app: 'SuperCmd',
    type: 'notes',
    exportedAt: new Date().toISOString(),
    notes: all.map((n) => ({
      title: n.title,
      icon: n.icon,
      content: n.content,
      theme: n.theme,
      pinned: n.pinned,
    })),
  };

  fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
  return true;
}

export async function importNotesFromFile(
  parentWindow?: BrowserWindow
): Promise<{ imported: number; skipped: number }> {
  const dialogOptions: OpenDialogOptions = {
    title: 'Import Notes',
    filters: [
      { name: 'Notes Files', extensions: ['json', 'md', 'txt'] },
    ],
    properties: ['openFile', 'multiSelections'],
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return { imported: 0, skipped: 0 };
  }

  if (!notesCache) notesCache = loadFromDisk();

  let imported = 0;
  let skipped = 0;

  for (const filePath of result.filePaths) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const data = fs.readFileSync(filePath, 'utf-8');

      if (ext === '.json') {
        // Try parsing as SuperCmd notes export
        const parsed = JSON.parse(data);
        let rawItems: any[] = [];

        if (parsed.type === 'notes' && Array.isArray(parsed.notes)) {
          rawItems = parsed.notes;
        } else if (Array.isArray(parsed)) {
          rawItems = parsed;
        }

        for (const item of rawItems) {
          if (!item.title && !item.content) { skipped++; continue; }

          const exists = notesCache.some(
            (n) => n.title.toLowerCase() === (item.title || '').toLowerCase()
              && n.content === (item.content || '')
          );
          if (exists) { skipped++; continue; }

          notesCache.push({
            id: crypto.randomUUID(),
            title: String(item.title || 'Untitled'),
            icon: typeof item.icon === 'string' ? item.icon : '',
            content: String(item.content || ''),
            theme: isValidTheme(item.theme) ? item.theme : 'default',
            pinned: Boolean(item.pinned),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          imported++;
        }
      } else {
        // Import .md or .txt as a single note
        const baseName = path.basename(filePath, ext);
        const exists = notesCache.some(
          (n) => n.title.toLowerCase() === baseName.toLowerCase() && n.content === data
        );
        if (exists) { skipped++; continue; }

        notesCache.push({
          id: crypto.randomUUID(),
          title: baseName,
          icon: '',
          content: data,
          theme: 'default',
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        imported++;
      }
    } catch (e) {
      console.error(`Failed to import note from ${filePath}:`, e);
      skipped++;
    }
  }

  if (imported > 0) {
    saveToDisk();
  }

  return { imported, skipped };
}
