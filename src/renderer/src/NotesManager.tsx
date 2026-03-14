/**
 * Notes Manager UI — Raycast Notes clone (exact parity)
 *
 * Editor: WYSIWYG inline markdown rendering via contentEditable
 * Action Panel: drops down from title bar, exact Raycast items/order
 * All shortcuts match Raycast exactly
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X, ArrowLeft, Plus, FileText, Pin, PinOff,
  Copy, Trash2, Files, Download, Upload,
  Bold, Italic, Strikethrough, Underline, Code,
  Link, Quote, ListOrdered, List, ListChecks,
  SquareCode, Command, LayoutList, Search,
  Type, ArrowUp, ArrowDown, Link2, Info,
} from 'lucide-react';
import type { Note, NoteTheme } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';

// ─── Props ──────────────────────────────────────────────────────────

interface NotesManagerProps {
  onClose: () => void;
  initialView: 'search' | 'create';
}

interface Action {
  title: string;
  icon?: React.ReactNode;
  shortcut?: string[];
  execute: () => void | Promise<void>;
  style?: 'default' | 'destructive';
  section?: string;
  disabled?: boolean;
}

// ─── Theme Accent Colors ────────────────────────────────────────────

const THEME_ACCENT: Record<NoteTheme, string> = {
  default: '#a0a0a0',
  rose: '#fb7185',
  orange: '#fb923c',
  amber: '#fbbf24',
  emerald: '#34d399',
  cyan: '#22d3ee',
  blue: '#60a5fa',
  violet: '#a78bfa',
  fuchsia: '#e879f9',
  slate: '#94a3b8',
};

const THEME_DOTS: Array<{ id: NoteTheme; label: string; color: string }> = [
  { id: 'default', label: 'Default', color: '#737373' },
  { id: 'rose', label: 'Rose', color: '#fb7185' },
  { id: 'orange', label: 'Orange', color: '#fb923c' },
  { id: 'amber', label: 'Amber', color: '#fbbf24' },
  { id: 'emerald', label: 'Emerald', color: '#34d399' },
  { id: 'cyan', label: 'Cyan', color: '#22d3ee' },
  { id: 'blue', label: 'Blue', color: '#60a5fa' },
  { id: 'violet', label: 'Violet', color: '#a78bfa' },
  { id: 'fuchsia', label: 'Fuchsia', color: '#e879f9' },
  { id: 'slate', label: 'Slate', color: '#94a3b8' },
];

// ─── Helpers ────────────────────────────────────────────────────────

function charCount(s: string) { return s.length; }
function wordCount(s: string) { return s.trim() ? s.trim().split(/\s+/).length : 0; }

function formatDateLabel(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined });
}

function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' at ' +
    new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function groupNotesByDate(notes: Note[]): Array<{ label: string; notes: Note[] }> {
  const pinned = notes.filter(n => n.pinned);
  const unpinned = notes.filter(n => !n.pinned);
  const groups: Array<{ label: string; notes: Note[] }> = [];
  if (pinned.length > 0) groups.push({ label: 'Pinned', notes: pinned });
  const dateGroups = new Map<string, Note[]>();
  for (const note of unpinned) {
    const label = formatDateLabel(note.updatedAt);
    if (!dateGroups.has(label)) dateGroups.set(label, []);
    dateGroups.get(label)!.push(note);
  }
  for (const [label, ns] of dateGroups.entries()) groups.push({ label, notes: ns });
  return groups;
}

function extractTitleFromContent(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.replace(/^#{1,6}\s+/, '') || 'Untitled';
  }
  return 'Untitled';
}

// ─── Markdown → HTML for WYSIWYG preview ────────────────────────────

function markdownToHtml(md: string, accentColor: string): string {
  if (!md.trim()) return '<span style="color:rgba(255,255,255,0.2);font-style:italic">Start writing...</span>';

  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inlineFormat = (text: string): string => {
    let s = escapeHtml(text);
    // inline code (before bold/italic to avoid conflicts)
    s = s.replace(/`([^`]+)`/g, `<code style="background:rgba(255,255,255,0.08);padding:1px 6px;border-radius:4px;font-size:12px;font-family:monospace;color:${accentColor}">$1</code>`);
    // bold
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:rgba(255,255,255,0.9);font-weight:700">$1</strong>');
    // italic
    s = s.replace(/\*(.+?)\*/g, '<em style="color:rgba(255,255,255,0.7);font-style:italic">$1</em>');
    // strikethrough
    s = s.replace(/~~(.+?)~~/g, '<del style="color:rgba(255,255,255,0.4)">$1</del>');
    // links
    s = s.replace(/\[(.+?)\]\((.+?)\)/g, `<span style="color:${accentColor};text-decoration:underline;text-underline-offset:2px;cursor:pointer">$1</span>`);
    return s;
  };

  const lines = md.split('\n');
  const parts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```') || line.startsWith('~~~')) {
      const fence = line.startsWith('```') ? '```' : '~~~';
      const codeLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith(fence)) { codeLines.push(escapeHtml(lines[j])); j++; }
      parts.push(`<pre style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px;margin:8px 0;font-size:12px;font-family:monospace;color:rgba(255,255,255,0.7);overflow-x:auto;white-space:pre">${codeLines.join('\n')}</pre>`);
      i = j + 1; continue;
    }

    // Headings
    const h3 = line.match(/^### (.+)/);
    if (h3) { parts.push(`<h3 style="font-size:15px;font-weight:600;color:rgba(255,255,255,0.9);margin:16px 0 4px">${inlineFormat(h3[1])}</h3>`); i++; continue; }
    const h2 = line.match(/^## (.+)/);
    if (h2) { parts.push(`<h2 style="font-size:17px;font-weight:700;color:rgba(255,255,255,0.9);margin:16px 0 4px">${inlineFormat(h2[1])}</h2>`); i++; continue; }
    const h1 = line.match(/^# (.+)/);
    if (h1) { parts.push(`<h1 style="font-size:22px;font-weight:700;color:white;margin:12px 0 8px">${inlineFormat(h1[1])}</h1>`); i++; continue; }

    // Horizontal rule
    if (/^(---+|___+|\*\*\*+)$/.test(line.trim())) { parts.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:12px 0" />'); i++; continue; }

    // Checklist
    const check = line.match(/^- \[([ x])\]\s*(.*)/);
    if (check) {
      const done = check[1] === 'x';
      const checkStyle = done
        ? 'border:2px solid #fb7185;background:rgba(251,113,133,0.2);color:#fda4af;border-radius:4px;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;margin-top:2px'
        : 'border:2px solid rgba(251,113,133,0.4);border-radius:4px;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px';
      const textStyle = done ? 'color:rgba(255,255,255,0.4);text-decoration:line-through' : 'color:rgba(255,255,255,0.8)';
      parts.push(`<div style="display:flex;align-items:flex-start;gap:10px;padding:4px 0"><span style="${checkStyle}">${done ? '✓' : ''}</span><span style="font-size:14px;${textStyle}">${inlineFormat(check[2])}</span></div>`);
      i++; continue;
    }

    // Bullet list
    const ul = line.match(/^[-*+]\s+(.+)/);
    if (ul) {
      parts.push(`<div style="display:flex;align-items:flex-start;gap:8px;padding:2px 0 2px 4px"><span style="margin-top:7px;width:5px;height:5px;border-radius:50%;background:${accentColor};flex-shrink:0"></span><span style="font-size:14px;color:rgba(255,255,255,0.8)">${inlineFormat(ul[1])}</span></div>`);
      i++; continue;
    }

    // Ordered list
    const ol = line.match(/^(\d+)\.\s+(.+)/);
    if (ol) {
      parts.push(`<div style="display:flex;align-items:flex-start;gap:8px;padding:2px 0 2px 4px"><span style="color:rgba(255,255,255,0.4);font-size:13px;min-width:18px;text-align:right">${ol[1]}.</span><span style="font-size:14px;color:rgba(255,255,255,0.8)">${inlineFormat(ol[2])}</span></div>`);
      i++; continue;
    }

    // Blockquote
    const bq = line.match(/^>\s*(.*)/);
    if (bq) {
      parts.push(`<div style="border-left:2px solid rgba(255,255,255,0.2);padding-left:12px;padding:2px 0 2px 12px;margin:4px 0"><span style="font-size:14px;color:rgba(255,255,255,0.5);font-style:italic">${inlineFormat(bq[1])}</span></div>`);
      i++; continue;
    }

    // Empty line
    if (!line.trim()) { parts.push('<div style="height:12px"></div>'); i++; continue; }

    // Paragraph
    parts.push(`<p style="font-size:14px;color:rgba(255,255,255,0.8);line-height:1.6;margin:0">${inlineFormat(line)}</p>`);
    i++;
  }

  return parts.join('');
}

// Also keep the React version for search preview
function renderMarkdownPreview(md: string, accentColor: string): React.ReactNode {
  if (!md.trim()) return <span className="text-white/25 italic">Start writing...</span>;
  // Use dangerouslySetInnerHTML for the HTML version
  return <div dangerouslySetInnerHTML={{ __html: markdownToHtml(md, accentColor) }} />;
}

// ─── Editor View ────────────────────────────────────────────────────

interface EditorViewProps {
  note: Note | null;
  onSave: (data: { title: string; icon: string; content: string; theme: NoteTheme }) => void;
  onClose: () => void;
  onBrowse: () => void;
  onNewNote: () => void;
  onShowActions: () => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onDuplicate: () => void;
  onTogglePin: () => void;
  showFind: boolean;
  setShowFind: (v: boolean) => void;
}

const EditorView: React.FC<EditorViewProps> = ({
  note, onSave, onClose, onBrowse, onNewNote, onShowActions,
  onNavigateBack, onNavigateForward,
  onDuplicate, onTogglePin, showFind, setShowFind,
}) => {
  const [icon, setIcon] = useState(note?.icon || '');
  const [content, setContent] = useState(note?.content || '');
  const [theme, setTheme] = useState<NoteTheme>(note?.theme || 'default');
  const [showToolbar, setShowToolbar] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [manualResize, setManualResize] = useState(false);
  const [showAutoSizeBtn, setShowAutoSizeBtn] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  // Derive title from content (Raycast behavior: first line = title)
  const title = useMemo(() => extractTitleFromContent(content), [content]);

  // Sync state when note prop changes
  useEffect(() => {
    setIcon(note?.icon || '');
    setContent(note?.content || '');
    setTheme(note?.theme || 'default');
  }, [note?.id]);

  // Focus content area on mount
  useEffect(() => {
    setTimeout(() => {
      const el = contentRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 50);
  }, [note?.id]);

  // Focus find input when opened
  useEffect(() => {
    if (showFind) setTimeout(() => findInputRef.current?.focus(), 50);
  }, [showFind]);

  // Auto-save debounce
  useEffect(() => {
    if (!note) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      onSave({ title, icon, content, theme });
    }, 400);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [title, icon, content, theme, note]);

  // ─── Dynamic window auto-sizing ──────────────────────────────
  // Measures content via a hidden div and resizes the Electron window.
  // Skipped when user has manually resized (manualResize).

  useEffect(() => {
    // Check manual resize state from main process
    window.electron.noteGetManualResize().then(setManualResize);
  }, []);

  useEffect(() => {
    if (manualResize) return;
    if (autoSizeTimeoutRef.current) clearTimeout(autoSizeTimeoutRef.current);
    autoSizeTimeoutRef.current = setTimeout(() => {
      const measure = measureRef.current;
      if (!measure) return;
      // Title bar ~40px, find bar ~36px if shown, toolbar ~40px if shown, bottom bar ~32px, padding 32px
      const chrome = 40 + (showFind ? 36 : 0) + (showToolbar ? 40 : 0) + 32 + 32;
      const contentHeight = measure.scrollHeight;
      const desiredHeight = Math.max(420, chrome + contentHeight); // min 420px for vertical feel
      window.electron.noteSetWindowHeight(desiredHeight);
    }, 150);
    return () => { if (autoSizeTimeoutRef.current) clearTimeout(autoSizeTimeoutRef.current); };
  }, [content, showFind, showToolbar, manualResize]);

  const handleResetAutoSize = useCallback(async () => {
    await window.electron.noteResetAutoSize();
    setManualResize(false);
    setShowAutoSizeBtn(false);
  }, []);

  // Markdown insertion helpers
  const insertMarkdown = useCallback((prefix: string, suffix: string = '') => {
    const el = contentRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const replacement = `${prefix}${selected || 'text'}${suffix}`;
    const newContent = content.slice(0, start) + replacement + content.slice(end);
    setContent(newContent);
    requestAnimationFrame(() => {
      el.focus();
      const cursorPos = start + prefix.length;
      el.setSelectionRange(cursorPos, cursorPos + (selected || 'text').length);
    });
  }, [content]);

  const insertLinePrefix = useCallback((prefix: string) => {
    const el = contentRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const newContent = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    setContent(newContent);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  }, [content]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const alt = e.altKey;

      if (e.key === 'Escape') {
        if (showFind) { setShowFind(false); e.preventDefault(); contentRef.current?.focus(); return; }
        if (showToolbar) { setShowToolbar(false); e.preventDefault(); return; }
        if (!note && content.trim()) onSave({ title: title || 'Untitled', icon, content, theme });
        e.preventDefault(); onClose(); return;
      }

      if (meta && !shift && !alt && e.key === 'n') { e.preventDefault(); onNewNote(); return; }
      if (meta && !shift && !alt && e.key === 'k') { e.preventDefault(); onShowActions(); return; }
      if (meta && !shift && !alt && e.key === 'p') { e.preventDefault(); onBrowse(); return; }
      if (meta && shift && e.key === 'p') { e.preventDefault(); onTogglePin(); return; }
      if (meta && !shift && !alt && e.key === 'd') { e.preventDefault(); onDuplicate(); return; }
      if (meta && !shift && !alt && e.key === 'f') { e.preventDefault(); setShowFind(true); return; }
      if (meta && !shift && !alt && e.key === '[') { e.preventDefault(); onNavigateBack(); return; }
      if (meta && !shift && !alt && e.key === ']') { e.preventDefault(); onNavigateForward(); return; }
      if (meta && alt && e.key === ',') { e.preventDefault(); setShowToolbar(p => !p); return; }
      // ⇧⌘, — Format submenu (show format bar as well)
      if (meta && shift && !alt && e.key === ',') { e.preventDefault(); setShowToolbar(p => !p); return; }

      // Paragraph formatting
      if (meta && alt && e.key === '1') { e.preventDefault(); insertLinePrefix('# '); return; }
      if (meta && alt && e.key === '2') { e.preventDefault(); insertLinePrefix('## '); return; }
      if (meta && alt && e.key === '3') { e.preventDefault(); insertLinePrefix('### '); return; }
      if (meta && alt && e.key === 'c') { e.preventDefault(); insertMarkdown('\n```\n', '\n```\n'); return; }
      if (meta && shift && e.key === 'b') { e.preventDefault(); insertLinePrefix('> '); return; }
      if (meta && shift && e.key === '7') { e.preventDefault(); insertLinePrefix('1. '); return; }
      if (meta && shift && e.key === '8') { e.preventDefault(); insertLinePrefix('- '); return; }
      if (meta && shift && e.key === '9') { e.preventDefault(); insertLinePrefix('- [ ] '); return; }

      // Inline formatting
      if (meta && !shift && !alt && e.key === 'b') { e.preventDefault(); insertMarkdown('**', '**'); return; }
      if (meta && !shift && !alt && e.key === 'i') { e.preventDefault(); insertMarkdown('*', '*'); return; }
      if (meta && shift && e.key === 's') { e.preventDefault(); insertMarkdown('~~', '~~'); return; }
      if (meta && !shift && !alt && e.key === 'u') { e.preventDefault(); insertMarkdown('<u>', '</u>'); return; }
      if (meta && !shift && !alt && e.key === 'e') { e.preventDefault(); insertMarkdown('`', '`'); return; }
      if (meta && !shift && !alt && e.key === 'l') { e.preventDefault(); insertMarkdown('[', '](url)'); return; }

      // ⌘+Enter — toggle checkbox on current line
      if (meta && !shift && !alt && e.key === 'Enter') {
        const el = contentRef.current;
        if (el) {
          const pos = el.selectionStart;
          const lineStart = content.lastIndexOf('\n', pos - 1) + 1;
          const lineEnd = content.indexOf('\n', pos);
          const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
          if (line.match(/^(\s*)- \[ \]/)) {
            e.preventDefault();
            const newLine = line.replace('- [ ]', '- [x]');
            const newContent = content.slice(0, lineStart) + newLine + (lineEnd === -1 ? '' : content.slice(lineEnd));
            setContent(newContent);
            requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
            return;
          }
          if (line.match(/^(\s*)- \[x\]/)) {
            e.preventDefault();
            const newLine = line.replace('- [x]', '- [ ]');
            const newContent = content.slice(0, lineStart) + newLine + (lineEnd === -1 ? '' : content.slice(lineEnd));
            setContent(newContent);
            requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
            return;
          }
        }
      }

      // ⇧⌘E — Export
      // handled in main component
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showToolbar, showFind, note, title, icon, content, theme, onClose, onNewNote, onBrowse, onShowActions, onNavigateBack, onNavigateForward, onDuplicate, onTogglePin, insertMarkdown, insertLinePrefix, setShowFind]);

  // Heading dropdown state
  const [showHeadingMenu, setShowHeadingMenu] = useState(false);

  return (
    <div className="flex flex-col h-full relative">
      {/* Title bar — glass-effect with subtle tint */}
      <div className="flex items-center px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.02] backdrop-blur-sm" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex-1 flex items-center justify-center gap-1.5 truncate">
          {icon && <span className="text-[14px]">{icon}</span>}
          <span className="text-white/45 text-[13px] font-medium truncate">{title}</span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <ToolbarBtn
            icon={Command}
            label="Actions"
            shortcut={['⌘', 'K']}
            onClick={onShowActions}
            iconSize={14}
            className="p-1.5 rounded-md text-white/25 hover:text-white/60 hover:bg-white/[0.08] transition-all duration-150"
            tooltipPosition="bottom"
          />
          <ToolbarBtn
            icon={LayoutList}
            label="Browse Notes"
            shortcut={['⌘', 'P']}
            onClick={onBrowse}
            iconSize={14}
            className="p-1.5 rounded-md text-white/25 hover:text-white/60 hover:bg-white/[0.08] transition-all duration-150"
            tooltipPosition="bottom"
          />
          <ToolbarBtn
            icon={Plus}
            label="New Note"
            shortcut={['⌘', 'N']}
            onClick={onNewNote}
            iconSize={14}
            className="p-1.5 rounded-md text-white/25 hover:text-white/60 hover:bg-white/[0.08] transition-all duration-150"
            tooltipPosition="bottom"
          />
        </div>
      </div>

      {/* Find bar */}
      {showFind && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/[0.06] bg-white/[0.015]">
          <Search size={13} className="text-white/25 flex-shrink-0" />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            placeholder="Find in note..."
            className="flex-1 bg-transparent text-white/80 text-[13px] placeholder-white/25 outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setShowFind(false); contentRef.current?.focus(); e.stopPropagation(); }
            }}
          />
          <button onClick={() => { setShowFind(false); setFindQuery(''); }} className="p-0.5 rounded hover:bg-white/10 text-white/30">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Hidden measure div for auto-sizing */}
      <div
        ref={measureRef}
        aria-hidden
        className="absolute pointer-events-none opacity-0 w-full px-5 py-4 text-[14px] leading-relaxed whitespace-pre-wrap break-words"
        style={{ top: -9999, left: 0 }}
      >
        {content || 'X'}
      </div>

      {/* Content area — always textarea */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-transparent">
        <textarea
          ref={contentRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            // Auto-continue lists & task lists on Enter
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              const el = contentRef.current;
              if (!el) return;
              const pos = el.selectionStart;
              const lineStart = content.lastIndexOf('\n', pos - 1) + 1;
              const currentLine = content.slice(lineStart, pos);

              // Task list: - [ ] or - [x]
              const taskMatch = currentLine.match(/^(\s*)- \[[ x]\]\s*/);
              if (taskMatch) {
                // If line is just the prefix with no content, clear it instead
                if (currentLine.trim() === '- [ ]' || currentLine.trim() === '- [x]') {
                  e.preventDefault();
                  const newContent = content.slice(0, lineStart) + '\n' + content.slice(pos);
                  setContent(newContent);
                  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(lineStart + 1, lineStart + 1); });
                  return;
                }
                e.preventDefault();
                const indent = taskMatch[1];
                const prefix = `\n${indent}- [ ] `;
                const newContent = content.slice(0, pos) + prefix + content.slice(pos);
                setContent(newContent);
                const newPos = pos + prefix.length;
                requestAnimationFrame(() => { el.focus(); el.setSelectionRange(newPos, newPos); });
                return;
              }

              // Bullet list: - or * or +
              const bulletMatch = currentLine.match(/^(\s*)[-*+]\s+/);
              if (bulletMatch) {
                if (currentLine.trim() === '-' || currentLine.trim() === '*' || currentLine.trim() === '+') {
                  e.preventDefault();
                  const newContent = content.slice(0, lineStart) + '\n' + content.slice(pos);
                  setContent(newContent);
                  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(lineStart + 1, lineStart + 1); });
                  return;
                }
                e.preventDefault();
                const prefix = `\n${bulletMatch[0]}`;
                const newContent = content.slice(0, pos) + prefix + content.slice(pos);
                setContent(newContent);
                const newPos = pos + prefix.length;
                requestAnimationFrame(() => { el.focus(); el.setSelectionRange(newPos, newPos); });
                return;
              }

              // Ordered list: 1. 2. etc.
              const olMatch = currentLine.match(/^(\s*)(\d+)\.\s+/);
              if (olMatch) {
                if (currentLine.trim().match(/^\d+\.$/)) {
                  e.preventDefault();
                  const newContent = content.slice(0, lineStart) + '\n' + content.slice(pos);
                  setContent(newContent);
                  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(lineStart + 1, lineStart + 1); });
                  return;
                }
                e.preventDefault();
                const nextNum = parseInt(olMatch[2]) + 1;
                const prefix = `\n${olMatch[1]}${nextNum}. `;
                const newContent = content.slice(0, pos) + prefix + content.slice(pos);
                setContent(newContent);
                const newPos = pos + prefix.length;
                requestAnimationFrame(() => { el.focus(); el.setSelectionRange(newPos, newPos); });
                return;
              }
            }
          }}
          placeholder="Start writing..."
          className="w-full h-full bg-transparent text-white/[0.82] text-[14px] leading-[1.75] placeholder-white/20 outline-none resize-none px-5 py-4 selection:bg-white/[0.12]"
          spellCheck
        />
      </div>

      {/* Bottom bar — format toolbar + character count */}
      <div className="border-t border-white/[0.06] bg-white/[0.015]">
        {showToolbar && (
          <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-white/[0.06]">
            {/* H↓ dropdown for headings — with tooltip + dropdown */}
            <HeadingDropdownBtn
              showMenu={showHeadingMenu}
              onToggle={() => setShowHeadingMenu(p => !p)}
              onSelect={(prefix: string) => { insertLinePrefix(prefix); setShowHeadingMenu(false); }}
            />
            <ToolbarBtn icon={Bold} label="Bold" shortcut={['⌘', 'B']} onClick={() => insertMarkdown('**', '**')} />
            <ToolbarBtn icon={Italic} label="Italic" shortcut={['⌘', 'I']} onClick={() => insertMarkdown('*', '*')} />
            <ToolbarBtn icon={Strikethrough} label="Strikethrough" shortcut={['⇧', '⌘', 'S']} onClick={() => insertMarkdown('~~', '~~')} />
            <ToolbarBtn icon={Underline} label="Underline" shortcut={['⌘', 'U']} onClick={() => insertMarkdown('<u>', '</u>')} />
            <ToolbarBtn icon={Code} label="Inline code" shortcut={['⌘', 'E']} onClick={() => insertMarkdown('`', '`')} />
            <ToolbarBtn icon={Link} label="Link" shortcut={['⌘', 'L']} onClick={() => insertMarkdown('[', '](url)')} />
            <ToolbarBtn icon={SquareCode} label="Code block" shortcut={['⌥', '⌘', 'C']} onClick={() => insertMarkdown('\n```\n', '\n```\n')} />
            <ToolbarBtn icon={Quote} label="Blockquote" shortcut={['⇧', '⌘', 'B']} onClick={() => insertLinePrefix('> ')} />
            <ToolbarBtn icon={ListOrdered} label="Ordered list" shortcut={['⇧', '⌘', '7']} onClick={() => insertLinePrefix('1. ')} />
            <ToolbarBtn icon={List} label="Bullet list" shortcut={['⇧', '⌘', '8']} onClick={() => insertLinePrefix('- ')} />
            <ToolbarBtn icon={ListChecks} label="Task list" shortcut={['⇧', '⌘', '9']} onClick={() => insertLinePrefix('- [ ] ')} />
            <div className="flex-1" />
            <ToolbarBtn
              icon={X}
              label="Close Toolbar"
              onClick={() => setShowToolbar(false)}
              iconSize={14}
              className="p-1 rounded text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
            />
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-1.5">
          <span className="text-[11px] text-white/20 tabular-nums">{charCount(content)} characters</span>
          <ToolbarBtn
            icon={Type}
            label="Format"
            onClick={() => setShowToolbar(p => !p)}
            iconSize={14}
            className={`p-1 rounded-md transition-all duration-150 ${showToolbar ? 'text-white/60 bg-white/[0.08]' : 'text-white/20 hover:text-white/50 hover:bg-white/[0.06]'}`}
          />
        </div>
      </div>

      {/* Bottom edge hover zone — shows auto-size button when user has manually resized */}
      <div
        className="absolute bottom-0 left-0 right-0 h-6 z-30"
        onMouseEnter={() => { if (manualResize) setShowAutoSizeBtn(true); }}
        onMouseLeave={() => setShowAutoSizeBtn(false)}
      >
        {showAutoSizeBtn && (
          <div className="flex justify-center">
            <button
              onClick={handleResetAutoSize}
              className="px-3 py-0.5 bg-[#2a2a3e]/95 backdrop-blur-xl border border-white/10 rounded-t-md text-[11px] text-white/50 hover:text-white/80 transition-colors shadow-lg"
            >
              Auto-size
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Raycast-style Tooltip ───────────────────────────────────────────

const ShortcutTooltip: React.FC<{
  label: string;
  shortcut?: string[];
  visible: boolean;
  position?: 'top' | 'bottom';
}> = ({ label, shortcut, visible, position = 'top' }) => {
  if (!visible) return null;
  const posClass = position === 'top'
    ? 'absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5'
    : 'absolute top-full left-1/2 -translate-x-1/2 mt-1.5';
  return (
    <div className={`${posClass} pointer-events-none z-50`}>
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[#2a2a3e]/95 backdrop-blur-xl border border-white/10 rounded-md shadow-xl whitespace-nowrap">
        <span className="text-[11px] text-white/70">{label}</span>
        {shortcut && shortcut.map((k, i) => (
          <kbd key={i} className="text-[10px] min-w-[18px] h-[16px] flex items-center justify-center px-1 bg-white/[0.08] border border-white/[0.1] rounded text-white/40 font-medium">
            {k}
          </kbd>
        ))}
      </div>
    </div>
  );
};

// ─── Toolbar Button with Raycast-style tooltip ──────────────────────

interface ToolbarBtnProps {
  icon: React.FC<any>;
  label: string;
  shortcut?: string[];
  onClick: () => void;
  iconSize?: number;
  className?: string;
  tooltipPosition?: 'top' | 'bottom';
}

const ToolbarBtn: React.FC<ToolbarBtnProps> = ({ icon: Icon, label, shortcut, onClick, iconSize = 15, className, tooltipPosition = 'top' }) => {
  const [hover, setHover] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={className || "p-1.5 rounded text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"}
      >
        <Icon size={iconSize} />
      </button>
      <ShortcutTooltip label={label} shortcut={shortcut} visible={hover} position={tooltipPosition} />
    </div>
  );
};

// ─── Heading Dropdown Button with tooltip ────────────────────────────

const HEADING_OPTIONS = [
  { label: 'Heading 1', prefix: '# ', keys: ['⌥', '⌘', '1'], size: 'text-[16px]' },
  { label: 'Heading 2', prefix: '## ', keys: ['⌥', '⌘', '2'], size: 'text-[14px]' },
  { label: 'Heading 3', prefix: '### ', keys: ['⌥', '⌘', '3'], size: 'text-[13px]' },
];

const HeadingDropdownBtn: React.FC<{
  showMenu: boolean;
  onToggle: () => void;
  onSelect: (prefix: string) => void;
}> = ({ showMenu, onToggle, onSelect }) => {
  const [hover, setHover] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="flex items-center gap-0.5 px-1.5 py-1 rounded text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
      >
        <span className="text-[14px] font-bold">H</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="opacity-50"><path d="M1 3l3 3 3-3z" /></svg>
      </button>
      {/* Tooltip — only when menu is closed */}
      {!showMenu && <ShortcutTooltip label="Headings" visible={hover} position="top" />}
      {/* Dropdown menu */}
      {showMenu && (
        <div className="absolute bottom-full left-0 mb-1 bg-[#2a2a3e]/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-xl overflow-hidden z-50 min-w-[220px]">
          {HEADING_OPTIONS.map((h) => (
            <button
              key={h.label}
              onClick={() => onSelect(h.prefix)}
              className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-white/70 hover:bg-white/10"
            >
              <span className={`font-bold ${h.size}`}>{h.label}</span>
              <span className="flex items-center gap-0.5">
                {h.keys.map((k, i) => (
                  <kbd key={i} className="text-[10px] min-w-[18px] h-[16px] flex items-center justify-center px-1 bg-white/[0.08] border border-white/[0.1] rounded text-white/40 font-medium">
                    {k}
                  </kbd>
                ))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Search / Browse View ───────────────────────────────────────────

interface SearchViewProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  onOpenNote: (note: Note) => void;
  onClose: () => void;
  onShowActions: () => void;
  flatNotes: Note[];
}

const SearchView: React.FC<SearchViewProps> = ({
  searchQuery, setSearchQuery, selectedIndex, setSelectedIndex,
  onOpenNote, onClose, onShowActions, flatNotes,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedNote = flatNotes[selectedIndex] || null;
  const grouped = useMemo(() => groupNotesByDate(flatNotes), [flatNotes]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = list.querySelectorAll('[data-note-item]');
    const item = items[selectedIndex] as HTMLElement;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
        <button onClick={onClose} className="p-0.5 rounded-md hover:bg-white/[0.08] text-white/25 hover:text-white/60 transition-all duration-150">
          <ArrowLeft size={16} />
        </button>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search Notes..."
          autoFocus
          className="flex-1 bg-transparent text-white/80 text-[13px] placeholder-white/25 outline-none"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="p-0.5 rounded hover:bg-white/10 text-white/30">
            <X size={12} />
          </button>
        )}
      </div>

      {flatNotes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <FileText size={32} className="text-white/15" />
          <p className="text-[13px] text-white/30">{searchQuery ? 'No notes found' : 'No notes yet'}</p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div ref={listRef} className="w-[38%] border-r border-white/[0.06] overflow-y-auto custom-scrollbar bg-white/[0.01]">
            {grouped.map((group) => (
              <div key={group.label}>
                <div className="px-3 pt-3 pb-1">
                  <span className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">{group.label}</span>
                </div>
                {group.notes.map((note) => {
                  const flatIdx = flatNotes.indexOf(note);
                  const isSelected = flatIdx === selectedIndex;
                  return (
                    <div
                      key={note.id}
                      data-note-item
                      onClick={() => setSelectedIndex(flatIdx)}
                      onDoubleClick={() => onOpenNote(note)}
                      className={`px-3 py-2 cursor-pointer transition-colors ${isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
                    >
                      <div className="flex items-center gap-2">
                        {note.pinned && <Pin size={11} className="text-white/30 flex-shrink-0" />}
                        {note.icon && <span className="text-[13px] flex-shrink-0">{note.icon}</span>}
                        <span className="text-[13px] text-white/80 font-medium truncate">{note.title || 'Untitled'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 pl-[calc(1.3rem)]">
                        <span className="text-[11px] text-white/25">Opened {formatRelativeTime(note.updatedAt)}</span>
                        <span className="text-[11px] text-white/20">&middot;</span>
                        <span className="text-[11px] text-white/25">{charCount(note.content)} Characters</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="w-[62%] flex flex-col overflow-hidden">
            {selectedNote ? (
              <>
                <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
                  <div className="flex items-start gap-2 mb-3">
                    {selectedNote.icon && <span className="text-[22px] mt-0.5">{selectedNote.icon}</span>}
                    <h1 className="text-[20px] font-bold text-white leading-tight">{selectedNote.title || 'Untitled'}</h1>
                  </div>
                  {renderMarkdownPreview(selectedNote.content, THEME_ACCENT[selectedNote.theme])}
                </div>
                <div className="border-t border-white/[0.06] px-5 py-3 space-y-1.5 flex-shrink-0 bg-white/[0.015]">
                  <div className="text-[11px] text-white/35 font-semibold uppercase tracking-wider mb-2">Information</div>
                  <MetaRow label="Title" value={
                    <span className="flex items-center gap-1.5">
                      {selectedNote.icon && <span className="text-[12px]">{selectedNote.icon}</span>}
                      {selectedNote.title || 'Untitled'}
                    </span>
                  } />
                  <MetaRow label="Characters" value={charCount(selectedNote.content).toLocaleString()} />
                  <MetaRow label="Words" value={wordCount(selectedNote.content).toLocaleString()} />
                  <MetaRow label="Created" value={formatRelativeTime(selectedNote.createdAt)} />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <span className="text-[12px] text-white/20">Select a note</span>
              </div>
            )}
          </div>
        </div>
      )}

      <ExtensionActionFooter
        leftContent={
          <span className="flex items-center gap-2 text-white/40">
            <Search className="w-3.5 h-3.5" />
            <span className="truncate">Search Notes</span>
          </span>
        }
        primaryAction={
          selectedNote
            ? { label: 'Open Note', onClick: () => onOpenNote(selectedNote), shortcut: ['↩'] }
            : undefined
        }
        actionsButton={{ label: 'Actions', onClick: () => onShowActions(), shortcut: ['⌘', 'K'] }}
      />
    </div>
  );
};

const MetaRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-[12px] text-white/40">{label}</span>
    <span className="text-[12px] text-white/60 text-right">{value}</span>
  </div>
);

// ─── Browse Overlay ─────────────────────────────────────────────────

interface BrowseOverlayProps {
  notes: Note[];
  currentNoteId: string | null;
  onSelect: (note: Note) => void;
  onClose: () => void;
  onTogglePin: (noteId: string) => void;
  onDelete: (noteId: string) => void;
}

const BrowseOverlay: React.FC<BrowseOverlayProps> = ({ notes, currentNoteId, onSelect, onClose, onTogglePin, onDelete }) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const sorted = [...notes].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    if (!query.trim()) return sorted;
    const q = query.toLowerCase();
    return sorted.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
  }, [notes, query]);

  useEffect(() => { setSelectedIdx(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = list.querySelectorAll('[data-browse-item]');
    const item = items[selectedIdx] as HTMLElement;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && filtered[selectedIdx]) { e.preventDefault(); onSelect(filtered[selectedIdx]); return; }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filtered, selectedIdx, onSelect, onClose]);

  // Current note index for "X/Y Notes" display
  const currentIdx = filtered.findIndex(n => n.id === currentNoteId);
  const displayIdx = currentIdx >= 0 ? currentIdx + 1 : selectedIdx + 1;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[360px] mx-4 bg-[#1a1a2e]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="px-3 py-2.5 border-b border-white/[0.06]">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for notes..."
            className="w-full bg-transparent text-white/80 text-[13px] placeholder-white/25 outline-none"
          />
        </div>

        {/* Header: "Notes" label + "X/Y Notes (i)" */}
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-[11px] font-semibold text-white/40">Notes</span>
          <span className="flex items-center gap-1 text-[11px] text-white/30">
            {filtered.length > 0 && <>{displayIdx}/{filtered.length} Notes</>}
            <Info size={11} className="text-white/20 ml-0.5" />
          </span>
        </div>

        {/* Notes list */}
        <div ref={listRef} className="max-h-[280px] overflow-y-auto custom-scrollbar">
          {filtered.map((note, idx) => {
            const isCurrent = note.id === currentNoteId;
            const isSelected = idx === selectedIdx;
            return (
              <div
                key={note.id}
                data-browse-item
                onClick={() => onSelect(note)}
                onMouseEnter={() => setSelectedIdx(idx)}
                className={`group px-3 py-2 cursor-pointer transition-colors ${isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
              >
                <div className="flex items-center gap-2">
                  {note.icon && <span className="text-[13px] flex-shrink-0">{note.icon}</span>}
                  {note.pinned && <Pin size={11} className="text-white/30 flex-shrink-0" />}
                  <span className="text-[13px] text-white/80 font-medium truncate flex-1">{note.title || 'Untitled'}</span>
                  {/* Inline pin/delete buttons — visible on hover/selected */}
                  <div className={`flex items-center gap-0.5 flex-shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                    <button
                      title={note.pinned ? 'Unpin' : 'Pin'}
                      onClick={(e) => { e.stopPropagation(); onTogglePin(note.id); }}
                      className="p-1 rounded text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
                    >
                      {note.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    </button>
                    <button
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); onDelete(note.id); }}
                      className="p-1 rounded text-white/30 hover:text-red-400 hover:bg-white/10 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {isCurrent ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
                      <span className="text-[11px] text-white/40">Current</span>
                    </>
                  ) : (
                    <span className="text-[11px] text-white/25">Opened {formatRelativeTime(note.updatedAt)}</span>
                  )}
                  <span className="text-[11px] text-white/20">&middot;</span>
                  <span className="text-[11px] text-white/25">{charCount(note.content)} Characters</span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-[12px] text-white/25">No notes found</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Actions Overlay (dropdown from title bar) ──────────────────────

interface ActionsOverlayProps {
  actions: Action[];
  onClose: () => void;
}

const ActionsOverlay: React.FC<ActionsOverlayProps> = ({ actions, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter(a => a.title.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => { setSelectedIdx(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = list.querySelectorAll('[data-action-item]');
    const item = items[selectedIdx] as HTMLElement;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && filtered[selectedIdx] && !filtered[selectedIdx].disabled) { e.preventDefault(); filtered[selectedIdx].execute(); return; }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filtered, selectedIdx, onClose]);

  // Group by section with separators
  const groupedActions = useMemo(() => {
    const groups: Array<{ section: string; actions: Action[] }> = [];
    let currentSection = '';
    for (const action of filtered) {
      const section = action.section || '';
      if (section !== currentSection) {
        groups.push({ section, actions: [] });
        currentSection = section;
      }
      groups[groups.length - 1].actions.push(action);
    }
    return groups;
  }, [filtered]);

  let flatIdx = 0;

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0" onClick={onClose} />
      {/* Dropdown positioned from top-right area, like Raycast */}
      <div className="absolute top-[44px] left-1/2 -translate-x-1/2 w-full max-w-[420px] px-4">
        <div className="bg-[#1a1a2e]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-white/[0.06]">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for actions..."
              className="w-full bg-transparent text-white/80 text-[13px] placeholder-white/25 outline-none"
            />
          </div>
          <div ref={listRef} className="max-h-[420px] overflow-y-auto custom-scrollbar py-1">
            {groupedActions.map((group, gi) => (
              <div key={group.section || `__${gi}`}>
                {gi > 0 && <div className="mx-3 my-1 border-t border-white/[0.06]" />}
                {group.actions.map((action) => {
                  const idx = flatIdx++;
                  return (
                    <div
                      key={idx}
                      data-action-item
                      onClick={() => { if (!action.disabled) action.execute(); }}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={`flex items-center gap-3 px-3 py-[7px] cursor-pointer transition-colors ${
                        idx === selectedIdx ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                      } ${action.style === 'destructive' ? 'text-red-400' : action.disabled ? 'text-white/30' : 'text-white/70'}`}
                    >
                      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center opacity-60">{action.icon}</span>
                      <span className="flex-1 text-[13px]">{action.title}</span>
                      {action.shortcut && (
                        <span className="flex items-center gap-0.5 flex-shrink-0">
                          {action.shortcut.map((k, ki) => (
                            <kbd key={ki} className="text-[10px] min-w-[22px] h-[20px] flex items-center justify-center px-1 bg-white/[0.06] border border-white/[0.08] rounded text-white/30 font-medium">
                              {k}
                            </kbd>
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-[12px] text-white/25">No actions found</div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Main Component ─────────────────────────────────────────────────

const NotesManager: React.FC<NotesManagerProps> = ({ onClose, initialView }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [viewMode, setViewMode] = useState<'editor' | 'search'>(initialView === 'search' ? 'search' : 'editor');
  const [showBrowse, setShowBrowse] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showFind, setShowFind] = useState(false);

  // Navigation history
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [navIndex, setNavIndex] = useState(-1);
  const isNavigatingRef = useRef(false);
  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  const loadNotes = useCallback(async () => {
    try {
      const data = searchQuery.trim()
        ? await window.electron.noteSearch(searchQuery)
        : await window.electron.noteGetAll();
      setNotes(data);
    } catch (e) {
      console.error('Failed to load notes:', e);
    }
  }, [searchQuery]);

  useEffect(() => { loadNotes(); }, [loadNotes]);
  useEffect(() => { setSelectedIndex(0); }, [searchQuery]);

  const selectedNote = notes[selectedIndex] || null;
  const targetNote = viewMode === 'editor' ? currentNote : selectedNote;

  // Navigation history
  const pushToHistory = useCallback((noteId: string) => {
    if (isNavigatingRef.current) return;
    setNavHistory(prev => {
      const trimmed = prev.slice(0, navIndex + 1);
      if (trimmed[trimmed.length - 1] === noteId) return trimmed;
      return [...trimmed, noteId];
    });
    setNavIndex(prev => {
      const trimmedLen = navHistory.slice(0, prev + 1).length;
      return trimmedLen;
    });
  }, [navIndex, navHistory]);

  const navigateBack = useCallback(() => {
    if (!canGoBack) return;
    const prevNote = notes.find(n => n.id === navHistory[navIndex - 1]);
    if (prevNote) {
      isNavigatingRef.current = true;
      setCurrentNote(prevNote);
      setNavIndex(i => i - 1);
      setViewMode('editor');
      setTimeout(() => { isNavigatingRef.current = false; }, 100);
    }
  }, [canGoBack, navHistory, navIndex, notes]);

  const navigateForward = useCallback(() => {
    if (!canGoForward) return;
    const nextNote = notes.find(n => n.id === navHistory[navIndex + 1]);
    if (nextNote) {
      isNavigatingRef.current = true;
      setCurrentNote(nextNote);
      setNavIndex(i => i + 1);
      setViewMode('editor');
      setTimeout(() => { isNavigatingRef.current = false; }, 100);
    }
  }, [canGoForward, navHistory, navIndex, notes]);

  const pinnedNotes = useMemo(() => notes.filter(n => n.pinned).sort((a, b) => b.updatedAt - a.updatedAt), [notes]);

  // ─── Handlers ───────────────────────────────────────────────────

  const handleNewNote = useCallback(async () => {
    const newNote = await window.electron.noteCreate({ title: 'Untitled' });
    setCurrentNote(newNote);
    setViewMode('editor');
    pushToHistory(newNote.id);
    loadNotes();
  }, [loadNotes, pushToHistory]);

  const handleEditorSave = useCallback(async (data: { title: string; icon: string; content: string; theme: NoteTheme }) => {
    if (currentNote) {
      await window.electron.noteUpdate(currentNote.id, { title: data.title, icon: data.icon, content: data.content, theme: data.theme });
      setCurrentNote(prev => prev ? { ...prev, ...data } : null);
    } else {
      const created = await window.electron.noteCreate({ title: data.title, icon: data.icon, content: data.content, theme: data.theme });
      setCurrentNote(created);
      pushToHistory(created.id);
    }
  }, [currentNote, pushToHistory]);

  const handleEditorClose = useCallback(() => {
    setCurrentNote(null);
    setViewMode('search');
    loadNotes();
  }, [loadNotes]);

  const handleOpenNote = useCallback((note: Note) => {
    setCurrentNote(note);
    setViewMode('editor');
    setShowBrowse(false);
    pushToHistory(note.id);
  }, [pushToHistory]);

  const handleDuplicate = useCallback(async () => {
    if (!targetNote) return;
    const dup = await window.electron.noteDuplicate(targetNote.id);
    loadNotes();
    if (dup) handleOpenNote(dup);
    setShowActions(false);
  }, [targetNote, loadNotes, handleOpenNote]);

  const handleTogglePin = useCallback(async () => {
    if (!targetNote) return;
    await window.electron.noteTogglePin(targetNote.id);
    loadNotes();
    setShowActions(false);
  }, [targetNote, loadNotes]);

  const handleExport = useCallback(async () => {
    if (!targetNote) return;
    await window.electron.noteExportToFile(targetNote.id, 'markdown');
    setShowActions(false);
  }, [targetNote]);

  // ─── Actions (exact Raycast order from screenshots) ────────────

  const actions: Action[] = useMemo(() => {
    const a: Action[] = [];

    // ─── Section 1: Note management ─────────────────────────
    a.push(
      {
        title: 'New Note',
        icon: <Plus size={14} />,
        shortcut: ['⌘', 'N'],
        section: 'actions',
        execute: () => { handleNewNote(); setShowActions(false); },
      },
    );

    if (targetNote) {
      a.push(
        {
          title: 'Duplicate Note',
          icon: <Files size={14} />,
          shortcut: ['⌘', 'D'],
          section: 'actions',
          execute: () => handleDuplicate(),
        },
      );
    }

    if (viewMode === 'editor') {
      a.push(
        {
          title: 'Browse Notes',
          icon: <LayoutList size={14} />,
          shortcut: ['⌘', 'P'],
          section: 'actions',
          execute: () => { setShowBrowse(true); setShowActions(false); },
        },
      );
    }

    // ─── Section 2: Find / Copy / Export ────────────────────
    if (viewMode === 'editor') {
      a.push(
        {
          title: 'Find in Note',
          icon: <Search size={14} />,
          shortcut: ['⌘', 'F'],
          section: 'find',
          execute: () => { setShowFind(true); setShowActions(false); },
        },
      );
    }

    if (targetNote) {
      a.push(
        {
          title: 'Copy Note As...',
          icon: <Copy size={14} />,
          shortcut: ['⇧', '⌘', 'C'],
          section: 'find',
          execute: async () => { await window.electron.noteCopyToClipboard(targetNote.id, 'markdown'); setShowActions(false); },
        },
        {
          title: 'Copy Deeplink',
          icon: <Link2 size={14} />,
          shortcut: ['⇧', '⌘', 'D'],
          section: 'find',
          execute: async () => {
            // Copy a deeplink to the note
            const deeplink = `supercmd://notes/${targetNote.id}`;
            await navigator.clipboard.writeText(deeplink);
            setShowActions(false);
          },
        },
        {
          title: 'Export...',
          icon: <Upload size={14} />,
          shortcut: ['⇧', '⌘', 'E'],
          section: 'find',
          execute: () => handleExport(),
        },
      );
    }

    // ─── Section 3: Move / Format ───────────────────────────
    if (viewMode === 'editor') {
      a.push(
        {
          title: 'Move List Item Up',
          icon: <ArrowUp size={14} />,
          shortcut: ['^', '⌘', '↑'],
          section: 'format',
          disabled: true,
          execute: () => { setShowActions(false); },
        },
        {
          title: 'Move List Item Down',
          icon: <ArrowDown size={14} />,
          shortcut: ['^', '⌘', '↓'],
          section: 'format',
          disabled: true,
          execute: () => { setShowActions(false); },
        },
        {
          title: 'Format...',
          icon: <Type size={14} />,
          shortcut: ['⇧', '⌘', ','],
          section: 'format',
          execute: () => { setShowActions(false); /* Will toggle format bar via shortcut */ },
        },
        {
          title: 'Show Format Bar',
          icon: <SquareCode size={14} />,
          shortcut: ['⌥', '⌘', ','],
          section: 'format',
          execute: () => { setShowActions(false); },
        },
      );
    }

    // ─── Section 4: Settings / Delete ───────────────────────
    if (targetNote) {
      a.push(
        {
          title: targetNote.pinned ? 'Unpin Note' : 'Pin Note',
          icon: targetNote.pinned ? <PinOff size={14} /> : <Pin size={14} />,
          shortcut: ['⇧', '⌘', 'P'],
          section: 'settings',
          execute: () => handleTogglePin(),
        },
      );
    }

    a.push(
      {
        title: 'Import Notes',
        icon: <Download size={14} />,
        section: 'settings',
        execute: async () => { await window.electron.noteImport(); loadNotes(); setShowActions(false); },
      },
      {
        title: 'Export All Notes',
        icon: <Upload size={14} />,
        section: 'settings',
        execute: async () => { await window.electron.noteExport(); setShowActions(false); },
      },
    );

    // Theme submenu items
    if (targetNote) {
      for (const dot of THEME_DOTS) {
        a.push({
          title: `${dot.label} Theme`,
          icon: <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: dot.color }} />,
          section: 'theme',
          execute: async () => {
            await window.electron.noteUpdate(targetNote.id, { theme: dot.id });
            if (viewMode === 'editor') setCurrentNote(prev => prev ? { ...prev, theme: dot.id } : null);
            loadNotes();
            setShowActions(false);
          },
        });
      }
    }

    if (targetNote) {
      a.push({
        title: 'Delete Note',
        icon: <Trash2 size={14} />,
        shortcut: ['^', 'X'],
        style: 'destructive',
        section: 'danger',
        execute: async () => {
          await window.electron.noteDelete(targetNote.id);
          if (viewMode === 'editor') { setCurrentNote(null); setViewMode('search'); }
          else setSelectedIndex(i => Math.max(0, i - 1));
          loadNotes();
          setShowActions(false);
        },
      });
    }

    return a;
  }, [targetNote, viewMode, loadNotes, handleNewNote, handleDuplicate, handleTogglePin, handleExport, notes]);

  // ─── Keyboard: search view ────────────────────────────────────

  useEffect(() => {
    if (viewMode !== 'search') return;
    const handler = (e: KeyboardEvent) => {
      if (showActions || showBrowse) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setShowActions(true); return; }
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleNewNote(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, notes.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && selectedNote) { e.preventDefault(); handleOpenNote(selectedNote); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewMode, showActions, showBrowse, notes, selectedIndex, selectedNote, onClose, handleNewNote, handleOpenNote]);

  // ─── Keyboard: global (⇧⌘P pin, ⌘0-9, ⇧⌘E export) ──────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showActions || showBrowse) return;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.shiftKey && e.key === 'p') { e.preventDefault(); handleTogglePin(); return; }
      if (meta && e.shiftKey && e.key === 'e') { e.preventDefault(); handleExport(); return; }
      if (meta && e.shiftKey && e.key === 'c' && targetNote) {
        e.preventDefault();
        window.electron.noteCopyToClipboard(targetNote.id, 'markdown');
        return;
      }

      if (meta && !e.shiftKey && !e.altKey && e.key >= '0' && e.key <= '9') {
        const idx = e.key === '0' ? 0 : parseInt(e.key) - 1;
        if (pinnedNotes[idx]) { e.preventDefault(); handleOpenNote(pinnedNotes[idx]); }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showActions, showBrowse, targetNote, pinnedNotes, handleTogglePin, handleExport, handleOpenNote]);

  // ─── Window resizing: enable when notes opens, restore on close ──
  useEffect(() => {
    window.electron.noteSetResizable(true);
    return () => { window.electron.noteSetResizable(false); };
  }, []);

  // Initialize
  useEffect(() => {
    if (initialView === 'create') handleNewNote();
  }, []);

  return (
    <div className="flex flex-col h-full bg-transparent backdrop-blur-none">
      {viewMode === 'editor' ? (
        <EditorView
          note={currentNote}
          onSave={handleEditorSave}
          onClose={handleEditorClose}
          onBrowse={() => setShowBrowse(true)}
          onNewNote={handleNewNote}
          onShowActions={() => setShowActions(true)}
          onNavigateBack={navigateBack}
          onNavigateForward={navigateForward}
          onDuplicate={handleDuplicate}
          onTogglePin={handleTogglePin}
          showFind={showFind}
          setShowFind={setShowFind}
        />
      ) : (
        <SearchView
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          onOpenNote={handleOpenNote}
          onClose={onClose}
          onShowActions={() => setShowActions(true)}
          flatNotes={notes}
        />
      )}

      {showBrowse && (
        <BrowseOverlay
          notes={notes}
          currentNoteId={currentNote?.id || null}
          onSelect={handleOpenNote}
          onClose={() => setShowBrowse(false)}
          onTogglePin={async (id) => { await window.electron.noteTogglePin(id); loadNotes(); }}
          onDelete={async (id) => {
            await window.electron.noteDelete(id);
            if (currentNote?.id === id) { setCurrentNote(null); setViewMode('search'); }
            loadNotes();
          }}
        />
      )}

      {showActions && (
        <ActionsOverlay
          actions={actions}
          onClose={() => setShowActions(false)}
        />
      )}
    </div>
  );
};

export default NotesManager;
