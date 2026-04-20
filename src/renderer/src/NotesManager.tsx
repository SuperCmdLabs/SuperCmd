/**
 * Notes Manager — Notion-like block editor with SuperCmd native UI
 *
 * Features:
 * - Block-based contentEditable editor with live rendering
 * - Markdown shortcuts auto-convert (# → heading, - → bullet, - [ ] → checkbox, etc.)
 * - Notion-like slash command menu (/heading, /bullet, /todo, etc.)
 * - Drag-and-drop block reordering
 * - Clickable checkboxes
 * - Native SuperCmd styling (CSS variables, glass footer, back button)
 * - Runs in a detached window (always on top)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, FileText, Pin, PinOff,
  Copy, Trash2, Files, Download, Upload,
  Bold, Italic, Strikethrough, Underline, Code,
  Link, Quote, ListOrdered, List, ListChecks,
  SquareCode, LayoutList, Search,
  Type, ArrowUp, ArrowDown, Link2,
  GripVertical, Minus, X,
} from 'lucide-react';
import type { Note, NoteTheme } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';

// ─── Types ───────────────────────────────────────────────────────────

interface NotesManagerProps {
  initialView: 'search' | 'create';
}

interface Action {
  title: string;
  icon?: React.ReactNode;
  shortcut?: string[];
  execute: () => void | Promise<void>;
  style?: 'default' | 'destructive';
  section?: string;
  submenu?: Action[];
  disabled?: boolean;
}

type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'checkbox' | 'code' | 'blockquote' | 'divider';

interface Block {
  id: string;
  type: BlockType;
  content: string;
  checked?: boolean;
}

// ─── Theme ───────────────────────────────────────────────────────────

const THEME_ACCENT: Record<NoteTheme, string> = {
  default: '#a0a0a0', rose: '#fb7185', orange: '#fb923c', amber: '#fbbf24',
  emerald: '#34d399', cyan: '#22d3ee', blue: '#60a5fa', violet: '#a78bfa',
  fuchsia: '#e879f9', slate: '#94a3b8',
};


// ─── Helpers ─────────────────────────────────────────────────────────

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
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t) return t.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').replace(/^- \[[ x]\]\s+/, '').replace(/^>\s+/, '').replace(/^\d+\.\s+/, '') || 'Untitled';
  }
  return 'Untitled';
}

/** Render inline markdown formatting (bold, italic, strikethrough, underline, code, links) to HTML */
function renderInlineFormatting(text: string): string {
  let s = text;
  s = s.replace(/`([^`]+?)`/g, '<code style="background:var(--input-bg);padding:1px 4px;border-radius:3px;font-size:0.9em;font-family:monospace">$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del style="text-decoration:line-through">$1</del>');
  s = s.replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, '<span style="text-decoration:underline">$1</span>');
  s = s.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:var(--accent, #60a5fa);text-decoration:underline;cursor:pointer" data-href="$2">$1</a>');
  return s;
}

/** Check if block content has any inline formatting markers */
function hasInlineFormatting(text: string): boolean {
  return /\*\*.+?\*\*|(?<!\*)\*[^*]+?\*(?!\*)|~~.+?~~|<u>.+?<\/u>|`.+?`|\[.+?\]\(.+?\)/.test(text);
}

// ─── Block System ────────────────────────────────────────────────────

let _blockIdCounter = 0;
const genBlockId = () => `blk-${++_blockIdCounter}-${Date.now().toString(36)}`;

function parseMarkdownToBlocks(md: string): Block[] {
  if (!md.trim()) return [{ id: genBlockId(), type: 'paragraph', content: '' }];
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```') || line.startsWith('~~~')) {
      const fence = line.startsWith('```') ? '```' : '~~~';
      const codeLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith(fence)) { codeLines.push(lines[j]); j++; }
      blocks.push({ id: genBlockId(), type: 'code', content: codeLines.join('\n') });
      i = j + 1; continue;
    }
    if (/^(---+|___+|\*\*\*+)$/.test(line.trim())) { blocks.push({ id: genBlockId(), type: 'divider', content: '' }); i++; continue; }
    const h3 = line.match(/^### (.+)/);
    if (h3) { blocks.push({ id: genBlockId(), type: 'h3', content: h3[1] }); i++; continue; }
    const h2 = line.match(/^## (.+)/);
    if (h2) { blocks.push({ id: genBlockId(), type: 'h2', content: h2[1] }); i++; continue; }
    const h1 = line.match(/^# (.+)/);
    if (h1) { blocks.push({ id: genBlockId(), type: 'h1', content: h1[1] }); i++; continue; }
    const check = line.match(/^- \[([ x])\]\s*(.*)/);
    if (check) { blocks.push({ id: genBlockId(), type: 'checkbox', content: check[2], checked: check[1] === 'x' }); i++; continue; }
    const bullet = line.match(/^[-*+]\s+(.*)/);
    if (bullet) { blocks.push({ id: genBlockId(), type: 'bullet', content: bullet[1] }); i++; continue; }
    const ordered = line.match(/^(\d+)\.\s+(.*)/);
    if (ordered) { blocks.push({ id: genBlockId(), type: 'ordered', content: ordered[2] }); i++; continue; }
    const bq = line.match(/^>\s*(.*)/);
    if (bq) { blocks.push({ id: genBlockId(), type: 'blockquote', content: bq[1] }); i++; continue; }
    if (!line.trim()) { blocks.push({ id: genBlockId(), type: 'paragraph', content: '' }); i++; continue; }
    blocks.push({ id: genBlockId(), type: 'paragraph', content: line });
    i++;
  }
  if (blocks.length === 0) blocks.push({ id: genBlockId(), type: 'paragraph', content: '' });
  return blocks;
}

function serializeBlocksToMarkdown(blocks: Block[]): string {
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'h1': return `# ${b.content}`;
      case 'h2': return `## ${b.content}`;
      case 'h3': return `### ${b.content}`;
      case 'bullet': return `- ${b.content}`;
      case 'ordered': {
        let num = 1;
        for (let j = i - 1; j >= 0 && blocks[j].type === 'ordered'; j--) num++;
        return `${num}. ${b.content}`;
      }
      case 'checkbox': return `- [${b.checked ? 'x' : ' '}] ${b.content}`;
      case 'blockquote': return `> ${b.content}`;
      case 'code': return '```\n' + b.content + '\n```';
      case 'divider': return '---';
      default: return b.content;
    }
  }).join('\n');
}

function detectMarkdownPrefix(text: string): { type: BlockType; content: string; checked?: boolean } | null {
  if (text.startsWith('### ')) return { type: 'h3', content: text.slice(4) };
  if (text.startsWith('## ')) return { type: 'h2', content: text.slice(3) };
  if (text.startsWith('# ')) return { type: 'h1', content: text.slice(2) };
  if (text.startsWith('- [x] ')) return { type: 'checkbox', content: text.slice(6), checked: true };
  if (text.startsWith('- [ ] ')) return { type: 'checkbox', content: text.slice(6), checked: false };
  if (text.startsWith('[] ')) return { type: 'checkbox', content: text.slice(3), checked: false };
  if (/^[-*+] /.test(text)) return { type: 'bullet', content: text.slice(2) };
  if (/^\d+\. /.test(text)) { const m = text.match(/^\d+\. /); return m ? { type: 'ordered', content: text.slice(m[0].length) } : null; }
  if (text.startsWith('> ')) return { type: 'blockquote', content: text.slice(2) };
  if (text === '---' || text === '***' || text === '___') return { type: 'divider', content: '' };
  return null;
}

function getCursorOffset(el: HTMLElement | null | undefined): number {
  if (!el) return 0;
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return 0;
  if (range.startContainer === el) return range.startOffset;
  return range.startOffset;
}

function focusAndSetCursor(el: HTMLElement, offset: number) {
  el.focus();
  const textNode = el.firstChild;
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    const safe = Math.min(offset, textNode.textContent?.length || 0);
    range.setStart(textNode, safe);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } else {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(offset > 0 ? false : true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

function setCursorPosition(el: HTMLElement, offset: number) {
  requestAnimationFrame(() => focusAndSetCursor(el, offset));
}

// ─── Menu Panel Styles (matches clipboard/extension action panels) ───

function getMenuPanelStyle(): { className: string; style: React.CSSProperties } {
  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass =
    document.documentElement.classList.contains('sc-native-liquid-glass') ||
    document.body.classList.contains('sc-native-liquid-glass');

  const className = (isNativeLiquidGlass || isGlassyTheme)
    ? 'rounded-3xl p-1'
    : 'rounded-xl shadow-2xl';

  const style: React.CSSProperties = isNativeLiquidGlass
    ? {
        background: 'rgba(var(--surface-base-rgb), 0.72)',
        backdropFilter: 'blur(44px) saturate(155%)',
        WebkitBackdropFilter: 'blur(44px) saturate(155%)' as any,
        border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
        boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26), inset 0 -1px 0 0 rgba(var(--on-surface-rgb), 0.05)',
      }
    : isGlassyTheme
    ? {
        background: 'linear-gradient(160deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.035) 38%, rgba(255,255,255,0.07) 100%), rgba(var(--surface-base-rgb), 0.58)',
        backdropFilter: 'blur(128px) saturate(195%) contrast(107%) brightness(1.03)',
        WebkitBackdropFilter: 'blur(128px) saturate(195%) contrast(107%) brightness(1.03)' as any,
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: '0 28px 58px -14px rgba(0,0,0,0.42), inset 0 -1px 0 0 rgba(0,0,0,0.08)',
      }
    : {
        background: 'var(--card-bg)',
        backdropFilter: 'blur(40px)',
        WebkitBackdropFilter: 'blur(40px)' as any,
        border: '1px solid var(--border-primary)',
      };

  return { className, style };
}

// ─── Slash Command Menu ──────────────────────────────────────────────

const SLASH_COMMANDS: Array<{ type: BlockType; label: string; description: string; icon: React.ReactNode; keywords: string[] }> = [
  { type: 'paragraph', label: 'Text', description: 'Plain text block', icon: <Type size={14} />, keywords: ['text', 'paragraph', 'plain'] },
  { type: 'h1', label: 'Heading 1', description: 'Large heading', icon: <span className="text-xs font-bold">H1</span>, keywords: ['heading', 'h1', 'title'] },
  { type: 'h2', label: 'Heading 2', description: 'Medium heading', icon: <span className="text-xs font-bold">H2</span>, keywords: ['heading', 'h2'] },
  { type: 'h3', label: 'Heading 3', description: 'Small heading', icon: <span className="text-xs font-bold">H3</span>, keywords: ['heading', 'h3'] },
  { type: 'bullet', label: 'Bullet List', description: 'Unordered list item', icon: <List size={14} />, keywords: ['bullet', 'list', 'unordered'] },
  { type: 'ordered', label: 'Numbered List', description: 'Ordered list item', icon: <ListOrdered size={14} />, keywords: ['numbered', 'ordered', 'list'] },
  { type: 'checkbox', label: 'To-Do', description: 'Checkbox item', icon: <ListChecks size={14} />, keywords: ['todo', 'checkbox', 'task', 'check'] },
  { type: 'blockquote', label: 'Quote', description: 'Block quote', icon: <Quote size={14} />, keywords: ['quote', 'blockquote'] },
  { type: 'code', label: 'Code', description: 'Code block', icon: <SquareCode size={14} />, keywords: ['code', 'snippet'] },
  { type: 'divider', label: 'Divider', description: 'Horizontal line', icon: <Minus size={14} />, keywords: ['divider', 'line', 'separator', 'hr'] },
];

interface SlashMenuProps {
  position: { top: number; left: number };
  onSelect: (type: BlockType) => void;
  onClose: () => void;
}

/**
 * Slash command menu — renders as a fixed-position overlay that pops OUT of the
 * editor. Has its own search input so keyboard navigation works reliably.
 */
const SlashMenu: React.FC<SlashMenuProps> = ({ position, onSelect, onClose }) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!filterQuery) return SLASH_COMMANDS;
    const q = filterQuery.toLowerCase();
    return SLASH_COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.keywords.some(k => k.includes(q)));
  }, [filterQuery]);

  useEffect(() => { setSelectedIdx(0); }, [filterQuery]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const items = listRef.current?.querySelectorAll('[data-slash-item]');
    const item = items?.[selectedIdx] as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSelectedIdx(i => Math.max(0, i - 1)); return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (filtered[selectedIdx]) { e.preventDefault(); e.stopPropagation(); onSelect(filtered[selectedIdx].type); }
      return;
    }
  };

  // Adjust position after first render using actual menu size
  const [adjustedPos, setAdjustedPos] = useState(position);
  const [menuMaxH, setMenuMaxH] = useState(400);
  useEffect(() => {
    requestAnimationFrame(() => {
      const menuEl = menuRef.current;
      const menuHeight = menuEl?.offsetHeight || 380;
      const menuWidth = 260;
      const winH = window.innerHeight;
      const winW = window.innerWidth;
      const pad = 8;
      const titleBarH = 40; // Keep below traffic light buttons

      let top = position.top;
      let left = position.left;

      // Try below cursor first
      if (top + menuHeight > winH - pad) {
        // Flip above: position.top is rect.bottom + 4, so cursor top ≈ position.top - 4 - 22
        const cursorTop = position.top - 4 - 22;
        top = cursorTop - menuHeight;
      }

      // Clamp to window bounds (never overlap title bar)
      top = Math.max(titleBarH, Math.min(top, winH - menuHeight - pad));
      left = Math.max(pad, Math.min(left, winW - menuWidth - pad));

      // If menu still doesn't fit, constrain max height
      const availH = winH - pad * 2;
      setMenuMaxH(Math.min(400, availH));

      setAdjustedPos({ top, left });
    });
  }, [position]);

  return createPortal(
    <div className="fixed inset-0 z-[9998]" onClick={onClose}>
      <div
        ref={menuRef}
        className="fixed z-[9999] w-[260px] overflow-hidden flex flex-col rounded-lg shadow-2xl"
        style={{
          top: adjustedPos.top, left: adjustedPos.left, maxHeight: menuMaxH,
          background: 'rgba(30, 30, 30, 0.85)',
          backdropFilter: 'blur(80px) saturate(150%)',
          WebkitBackdropFilter: 'blur(80px) saturate(150%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-2.5 py-2 border-b border-[var(--ui-divider)]">
          <Search size={13} className="text-[var(--text-disabled)] flex-shrink-0" />
          <input
            ref={inputRef}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Filter..."
            className="flex-1 bg-transparent text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] outline-none"
          />
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-2.5 py-3 text-center text-[11px] text-[var(--text-disabled)]">No blocks found</div>
          ) : filtered.map((cmd, idx) => (
            <div
              key={cmd.type}
              data-slash-item
              onClick={() => onSelect(cmd.type)}
              onMouseEnter={() => setSelectedIdx(idx)}
              className="flex items-center gap-2.5 px-2.5 py-[7px] cursor-pointer transition-colors"
              style={idx === selectedIdx ? { background: 'rgba(255,255,255,0.08)' } : undefined}
            >
              <span className="w-5 h-5 flex items-center justify-center text-[var(--text-muted)] flex-shrink-0">{cmd.icon}</span>
              <span className="text-[12px] text-[var(--text-primary)] font-medium">{cmd.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Block Editor ────────────────────────────────────────────────────

export interface BlockEditorHandle {
  wrapSelection: (prefix: string, suffix: string) => void;
  insertBlockType: (type: BlockType) => void;
}

interface BlockEditorProps {
  initialContent: string;
  onContentChange: (content: string) => void;
  accentColor: string;
  editorRef?: React.Ref<BlockEditorHandle>;
  findQuery?: string;
  findActiveIndex?: number;
  onFindCountChange?: (count: number) => void;
}

const BlockEditor: React.FC<BlockEditorProps> = ({ initialContent, onContentChange, accentColor, editorRef, findQuery, findActiveIndex = 0, onFindCountChange }) => {
  const [blocks, setBlocks] = useState<Block[]>(() => parseMarkdownToBlocks(initialContent));
  const blocksRef = useRef(blocks);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);

  const [slashMenu, setSlashMenu] = useState<{ blockId: string; position: { top: number; left: number } } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const blockElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingFocusRef = useRef<{ id: string; offset: number } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

  // ─── Undo / Redo History ───────────────────────────────────
  const historyRef = useRef<Block[][]>([]);
  const historyIdxRef = useRef(-1);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUndoRedoRef = useRef(false);

  const snapshotBlocks = useCallback((): Block[] => {
    return blocksRef.current.map(b => {
      const el = blockElsRef.current.get(b.id);
      return { ...b, content: el?.textContent ?? b.content };
    });
  }, []);

  const pushHistory = useCallback((immediate?: boolean) => {
    if (isUndoRedoRef.current) return;
    const push = () => {
      const snapshot = snapshotBlocks().map(b => ({ ...b }));
      const stack = historyRef.current.slice(0, historyIdxRef.current + 1);
      stack.push(snapshot);
      if (stack.length > 100) stack.shift();
      historyRef.current = stack;
      historyIdxRef.current = stack.length - 1;
    };
    if (immediate) {
      if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
      push();
    } else {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyTimerRef.current = setTimeout(push, 500);
    }
  }, [snapshotBlocks]);

  useEffect(() => {
    const initial = blocksRef.current.map(b => ({ ...b }));
    historyRef.current = [initial];
    historyIdxRef.current = 0;
  }, []);

  // Auto-focus on mount: empty note → focus first line; non-empty → add new line at end and focus it
  useEffect(() => {
    const hasContent = blocksRef.current.some(b => b.content.trim() !== '' || b.type === 'divider');
    if (hasContent) {
      // Add a new empty paragraph at the end and focus it
      const newBlock: Block = { id: genBlockId(), type: 'paragraph', content: '' };
      setBlocks(prev => [...prev, newBlock]);
      setTimeout(() => {
        const el = blockElsRef.current.get(newBlock.id);
        if (el) {
          el.focus();
          setCursorPosition(el, 0);
        }
      }, 50);
    } else {
      // Empty note — focus the first block
      const firstBlock = blocksRef.current[0];
      if (firstBlock) {
        setTimeout(() => {
          const el = blockElsRef.current.get(firstBlock.id);
          if (el) {
            el.focus();
            setCursorPosition(el, 0);
          }
        }, 50);
      }
    }
  }, []);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
    const currentSnapshot = snapshotBlocks().map(b => ({ ...b }));
    const stack = historyRef.current;
    stack[historyIdxRef.current] = currentSnapshot;
    historyIdxRef.current--;
    const prev = stack[historyIdxRef.current];
    isUndoRedoRef.current = true;
    setBlocks(prev.map(b => ({ ...b })));
    requestAnimationFrame(() => {
      for (const b of prev) {
        const el = blockElsRef.current.get(b.id);
        if (el && el.textContent !== b.content) el.textContent = b.content;
      }
      isUndoRedoRef.current = false;
    });
  }, [snapshotBlocks]);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const next = historyRef.current[historyIdxRef.current];
    isUndoRedoRef.current = true;
    setBlocks(next.map(b => ({ ...b })));
    requestAnimationFrame(() => {
      for (const b of next) {
        const el = blockElsRef.current.get(b.id);
        if (el && el.textContent !== b.content) el.textContent = b.content;
      }
      isUndoRedoRef.current = false;
    });
  }, []);

  // Debounced save
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onContentChange(serializeBlocksToMarkdown(blocks));
    }, 300);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [blocks]);

  // Pending focus after render
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    setTimeout(() => {
      const el = blockElsRef.current.get(pending.id);
      if (el) setCursorPosition(el, pending.offset);
    }, 0);
  });

  const focusBlock = useCallback((id: string, offset: number) => {
    pendingFocusRef.current = { id, offset };
  }, []);

  // ─── Block Input Handler ─────────────────────────────────────
  const handleBlockInput = useCallback((blockId: string) => {
    const el = blockElsRef.current.get(blockId);
    if (!el) return;
    const text = el.textContent || '';
    const block = blocksRef.current.find(b => b.id === blockId);
    if (!block) return;

    if (block.type === 'paragraph') {
      const prefix = detectMarkdownPrefix(text);
      if (prefix) {
        if (prefix.type === 'divider') {
          // Divider: convert block and add a new paragraph below, then focus it
          const newPara: Block = { id: genBlockId(), type: 'paragraph', content: '' };
          setBlocks(prev => {
            const idx = prev.findIndex(b => b.id === blockId);
            const updated = [...prev];
            updated[idx] = { ...prev[idx], type: 'divider', content: '' };
            updated.splice(idx + 1, 0, newPara);
            return updated;
          });
          focusBlock(newPara.id, 0);
        } else {
          el.textContent = prefix.content;
          setCursorPosition(el, prefix.content.length);
          setBlocks(prev => prev.map(b =>
            b.id === blockId ? { ...b, type: prefix.type, content: prefix.content, checked: prefix.checked } : b
          ));
        }
        setSlashMenu(null);
        return;
      }
    }

    // Slash command detection — open menu and clear the "/" from the block
    if (text === '/') {
      const rect = el.getBoundingClientRect();
      el.textContent = '';
      setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, content: '' } : b));
      setSlashMenu({ blockId, position: { top: rect.bottom + 4, left: rect.left } });
      return;
    }

    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, content: text } : b));
    pushHistory();
  }, [slashMenu, pushHistory]);

  // ─── Slash Command Selection ─────────────────────────────────
  const handleSlashSelect = useCallback((type: BlockType) => {
    if (!slashMenu) return;
    const { blockId } = slashMenu;
    const el = blockElsRef.current.get(blockId);
    setSlashMenu(null);

    if (type === 'divider') {
      const newPara: Block = { id: genBlockId(), type: 'paragraph', content: '' };
      setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === blockId);
        const updated = [...prev];
        updated[idx] = { ...prev[idx], type: 'divider', content: '' };
        updated.splice(idx + 1, 0, newPara);
        return updated;
      });
      focusBlock(newPara.id, 0);
    } else {
      if (el) el.textContent = '';
      setBlocks(prev => prev.map(b =>
        b.id === blockId ? { ...b, type, content: '', checked: type === 'checkbox' ? false : undefined } : b
      ));
      focusBlock(blockId, 0);
    }
  }, [slashMenu, focusBlock]);

  // ─── Key Down Handler ────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent, blockId: string) => {
    const block = blocksRef.current.find(b => b.id === blockId);
    if (!block) return;
    const el = blockElsRef.current.get(blockId);
    const meta = e.metaKey || e.ctrlKey;

    if (slashMenu?.blockId === blockId && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;

    if (meta && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
    if (meta && e.shiftKey && e.key === 'z') { e.preventDefault(); redo(); return; }

    if (e.key === 'Enter' && !e.shiftKey && !meta) {
      e.preventDefault();
      pushHistory(true);
      const offset = getCursorOffset(el);
      const text = el?.textContent || '';
      const before = text.slice(0, offset);
      const after = text.slice(offset);

      if (['bullet', 'ordered', 'checkbox'].includes(block.type) && !before && !after) {
        setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, type: 'paragraph' } : b));
        pushHistory(true);
        return;
      }

      const newType = ['bullet', 'ordered', 'checkbox'].includes(block.type) ? block.type : 'paragraph';
      const newBlock: Block = {
        id: genBlockId(),
        type: newType as BlockType,
        content: after,
        checked: newType === 'checkbox' ? false : undefined,
      };

      if (el) el.textContent = before;
      setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === blockId);
        const updated = [...prev];
        updated[idx] = { ...block, content: before };
        updated.splice(idx + 1, 0, newBlock);
        return updated;
      });
      focusBlock(newBlock.id, 0);
      pushHistory(true);
      return;
    }

    if (e.key === 'Backspace' && !meta) {
      const offset = getCursorOffset(el);
      const sel = window.getSelection();
      if (offset === 0 && sel?.isCollapsed) {
        e.preventDefault();
        pushHistory(true);
        if (block.type !== 'paragraph') {
          setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, type: 'paragraph', checked: undefined } : b));
        } else {
          const idx = blocksRef.current.findIndex(b => b.id === blockId);
          if (idx > 0) {
            const prev = blocksRef.current[idx - 1];
            if (prev.type === 'divider') {
              setBlocks(p => p.filter((_, i) => i !== idx - 1));
              focusBlock(blockId, 0);
            } else {
              const mergeOffset = prev.content.length;
              const mergedContent = prev.content + block.content;
              const prevEl = blockElsRef.current.get(prev.id);
              if (prevEl) prevEl.textContent = mergedContent;
              setBlocks(p => {
                const u = [...p];
                u[idx - 1] = { ...prev, content: mergedContent };
                u.splice(idx, 1);
                return u;
              });
              focusBlock(prev.id, mergeOffset);
            }
          }
        }
        pushHistory(true);
        return;
      }
    }

    // Arrow navigation between blocks — focus synchronously to avoid lag.
    // Skip over dividers (they have no editable element).
    if (e.key === 'ArrowDown' && !meta && !e.shiftKey) {
      const offset = getCursorOffset(el);
      const textLen = el?.textContent?.length || 0;
      if (offset >= textLen) {
        const idx = blocksRef.current.findIndex(b => b.id === blockId);
        for (let i = idx + 1; i < blocksRef.current.length; i++) {
          const target = blocksRef.current[i];
          if (target.type === 'divider') continue;
          const targetEl = blockElsRef.current.get(target.id);
          if (targetEl) { e.preventDefault(); focusAndSetCursor(targetEl, 0); }
          break;
        }
      }
    }

    if (e.key === 'ArrowUp' && !meta && !e.shiftKey) {
      const offset = getCursorOffset(el);
      if (offset === 0) {
        const idx = blocksRef.current.findIndex(b => b.id === blockId);
        for (let i = idx - 1; i >= 0; i--) {
          const target = blocksRef.current[i];
          if (target.type === 'divider') continue;
          const targetEl = blockElsRef.current.get(target.id);
          if (targetEl) { e.preventDefault(); focusAndSetCursor(targetEl, target.content.length); }
          break;
        }
      }
    }

    if (e.key === 'ArrowLeft' && !meta && !e.shiftKey && !e.altKey) {
      const offset = getCursorOffset(el);
      const sel = window.getSelection();
      if (offset === 0 && sel?.isCollapsed) {
        const idx = blocksRef.current.findIndex(b => b.id === blockId);
        for (let i = idx - 1; i >= 0; i--) {
          const target = blocksRef.current[i];
          if (target.type === 'divider') continue;
          const targetEl = blockElsRef.current.get(target.id);
          if (targetEl) { e.preventDefault(); focusAndSetCursor(targetEl, target.content.length); }
          break;
        }
      }
    }

    if (e.key === 'ArrowRight' && !meta && !e.shiftKey && !e.altKey) {
      const offset = getCursorOffset(el);
      const textLen = el?.textContent?.length || 0;
      const sel = window.getSelection();
      if (offset >= textLen && sel?.isCollapsed) {
        const idx = blocksRef.current.findIndex(b => b.id === blockId);
        for (let i = idx + 1; i < blocksRef.current.length; i++) {
          const target = blocksRef.current[i];
          if (target.type === 'divider') continue;
          const targetEl = blockElsRef.current.get(target.id);
          if (targetEl) { e.preventDefault(); focusAndSetCursor(targetEl, 0); }
          break;
        }
      }
    }

    // Formatting shortcuts
    if (meta && !e.shiftKey && !e.altKey && e.key === 'b') { e.preventDefault(); pushHistory(true); wrapSelection('**', '**'); pushHistory(true); return; }
    if (meta && !e.shiftKey && !e.altKey && e.key === 'i') { e.preventDefault(); pushHistory(true); wrapSelection('*', '*'); pushHistory(true); return; }
    if (meta && e.shiftKey && e.key === 's') { e.preventDefault(); pushHistory(true); wrapSelection('~~', '~~'); pushHistory(true); return; }
    if (meta && !e.shiftKey && !e.altKey && e.key === 'e') { e.preventDefault(); pushHistory(true); wrapSelection('`', '`'); pushHistory(true); return; }
    if (meta && !e.shiftKey && !e.altKey && e.key === 'u') { e.preventDefault(); pushHistory(true); wrapSelection('<u>', '</u>'); pushHistory(true); return; }

    if (meta && e.key === 'Enter') {
      if (block.type === 'checkbox') {
        e.preventDefault();
        pushHistory(true);
        setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, checked: !b.checked } : b));
        pushHistory(true);
        return;
      }
    }
  }, [slashMenu, focusBlock, undo, redo, pushHistory]);

  const wrapSelection = useCallback((prefix: string, suffix: string) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const selected = range.toString();
    if (!selected) return;

    // Smart link: if wrapping with []() and selected text is a URL, use it as the href
    let text: string;
    const isLinkWrap = prefix === '[' && suffix === '](url)';
    const isUrl = /^https?:\/\/\S+$/i.test(selected.trim());
    if (isLinkWrap && isUrl) {
      text = `[${selected.trim()}](${selected.trim()})`;
    } else {
      text = prefix + selected + suffix;
    }

    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    const el = range.startContainer.parentElement?.closest('[data-block-id]') as HTMLElement;
    if (el) {
      const blockId = el.dataset.blockId;
      if (blockId) {
        setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, content: el.textContent || '' } : b));
      }
    }
  }, []);

  // Expose format actions to parent via ref
  React.useImperativeHandle(editorRef, () => ({
    wrapSelection: (prefix: string, suffix: string) => {
      pushHistory(true);
      // If there's a selection, wrap it. Otherwise insert at cursor in focused block.
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        wrapSelection(prefix, suffix);
      } else {
        // Find focused block and insert wrapping at cursor
        const focusedId = focusedBlockId || blocksRef.current[blocksRef.current.length - 1]?.id;
        if (!focusedId) return;
        const el = blockElsRef.current.get(focusedId);
        if (!el) return;
        el.focus();
        const offset = getCursorOffset(el);
        const text = el.textContent || '';
        const placeholder = prefix + suffix;
        const newText = text.slice(0, offset) + placeholder + text.slice(offset);
        el.textContent = newText;
        setCursorPosition(el, offset + prefix.length);
        setBlocks(prev => prev.map(b => b.id === focusedId ? { ...b, content: newText } : b));
      }
      pushHistory(true);
    },
    insertBlockType: (type: BlockType) => {
      pushHistory(true);
      const newBlock: Block = { id: genBlockId(), type, content: '', checked: type === 'checkbox' ? false : undefined };
      setBlocks(prev => [...prev, newBlock]);
      pendingFocusRef.current = { id: newBlock.id, offset: 0 };
      pushHistory(true);
    },
  }), [wrapSelection, focusedBlockId, pushHistory]);

  // ─── Drag & Drop ─────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIdx(idx);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    const fromIdx = dragIdx;
    setDragIdx(null);
    setDropIdx(null);
    if (fromIdx === null || fromIdx === toIdx) return;
    setBlocks(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
      return updated;
    });
  }, [dragIdx]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDropIdx(null);
  }, []);

  // ─── Find Highlighting ──────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous highlights
    container.querySelectorAll('mark[data-find-highlight]').forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });

    if (!findQuery || !findQuery.trim()) {
      onFindCountChange?.(0);
      return;
    }

    const query = findQuery.toLowerCase();
    let matchCount = 0;

    // Walk all text nodes in block elements (not in contentEditable to avoid corrupting input)
    // Instead, walk the overlay divs and the contentEditable divs
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const textNodes: { node: Text; start: number }[] = [];
    let walkerNode: Node | null;
    while ((walkerNode = walker.nextNode())) {
      const textNode = walkerNode as Text;
      // Skip nodes inside the slash menu or style tags
      const parent = textNode.parentElement;
      if (!parent || parent.tagName === 'STYLE') continue;
      if (parent.closest('[data-slash-item]')) continue;
      const text = textNode.textContent || '';
      const lower = text.toLowerCase();
      let searchFrom = 0;
      while (searchFrom < lower.length) {
        const idx = lower.indexOf(query, searchFrom);
        if (idx === -1) break;
        textNodes.push({ node: textNode, start: idx });
        searchFrom = idx + query.length;
      }
    }

    matchCount = textNodes.length;
    onFindCountChange?.(matchCount);

    // Apply highlights in reverse order to not invalidate positions
    for (let i = textNodes.length - 1; i >= 0; i--) {
      const { node: textNode, start } = textNodes[i];
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + query.length);

      const mark = document.createElement('mark');
      mark.setAttribute('data-find-highlight', '');
      mark.style.borderRadius = '2px';
      mark.style.padding = '0 1px';
      mark.style.color = 'inherit';
      if (i === findActiveIndex) {
        mark.style.background = 'rgba(234, 179, 8, 0.6)';
        mark.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        mark.style.background = 'rgba(234, 179, 8, 0.25)';
      }

      range.surroundContents(mark);
    }
  }, [findQuery, findActiveIndex, blocks]);

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 cursor-text"
      onClick={(e) => {
        // Clicking empty space below blocks → focus last block or create one
        const target = e.target as HTMLElement;
        if (target === containerRef.current) {
          const lastBlock = blocksRef.current[blocksRef.current.length - 1];
          if (lastBlock && lastBlock.content === '' && lastBlock.type === 'paragraph') {
            // Last block is already an empty paragraph — just focus it
            const el = blockElsRef.current.get(lastBlock.id);
            if (el) { el.focus(); setCursorPosition(el, 0); }
          } else {
            // Add a new empty paragraph and focus it
            const newBlock: Block = { id: genBlockId(), type: 'paragraph', content: '' };
            setBlocks(prev => [...prev, newBlock]);
            pendingFocusRef.current = { id: newBlock.id, offset: 0 };
          }
        }
      }}
    >
      {blocks.map((block, idx) => (
        <div key={block.id} className="relative group">
          {dropIdx === idx && dragIdx !== null && dragIdx !== idx && (
            <div className="absolute top-0 left-6 right-2 h-[2px] rounded-full" style={{ background: accentColor }} />
          )}
          <div
            className={`flex items-start gap-1 rounded-md transition-all ${dragIdx === idx ? 'opacity-40' : ''}`}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
          >
            <div
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragEnd={handleDragEnd}
              className={`flex-shrink-0 w-5 flex items-center justify-center cursor-grab opacity-0 group-hover:opacity-30 hover:!opacity-60 transition-opacity ${
                block.type === 'h1' ? 'h-[36px]' : block.type === 'h2' ? 'h-[28px]' : block.type === 'h3' ? 'h-[23px]' : 'h-[21px]'
              }`}
            >
              <GripVertical size={12} />
            </div>

            {block.type === 'divider' ? (
              <div className="flex-1 py-3 px-1">
                <div className="border-t border-[var(--ui-divider)]" />
              </div>
            ) : (
              <div className="flex-1 flex items-start gap-1.5 min-w-0" data-block-id={block.id}>
                {block.type === 'checkbox' && (
                  <button
                    onClick={() => setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, checked: !b.checked } : b))}
                    className="flex-shrink-0 mt-[3px] w-4 h-4 rounded border-2 flex items-center justify-center transition-colors"
                    style={{
                      borderColor: block.checked ? accentColor : `${accentColor}60`,
                      background: block.checked ? `${accentColor}30` : 'transparent',
                      color: accentColor,
                    }}
                  >
                    {block.checked && <span className="text-[9px] font-bold">✓</span>}
                  </button>
                )}
                {block.type === 'bullet' && (
                  <span className="flex-shrink-0 mt-[9px] w-[5px] h-[5px] rounded-full" style={{ background: accentColor }} />
                )}
                {block.type === 'ordered' && (
                  <span className="flex-shrink-0 mt-[2px] text-[12px] text-[var(--text-subtle)] min-w-[16px] text-right font-medium">
                    {(() => { let n = 1; for (let j = idx - 1; j >= 0 && blocks[j].type === 'ordered'; j--) n++; return `${n}.`; })()}
                  </span>
                )}
                {block.type === 'blockquote' && (
                  <div className="flex-shrink-0 w-[3px] self-stretch rounded-full mr-1" style={{ background: `${accentColor}50` }} />
                )}

                <div className="flex-1 relative min-w-0">
                  <div
                    ref={(el) => {
                      if (el) {
                        blockElsRef.current.set(block.id, el);
                        if (!el.dataset.init) { el.textContent = block.content; el.dataset.init = '1'; }
                      } else { blockElsRef.current.delete(block.id); }
                    }}
                    contentEditable={"plaintext-only" as any}
                    suppressContentEditableWarning
                    onInput={() => handleBlockInput(block.id)}
                    onKeyDown={(e) => handleKeyDown(e, block.id)}
                    onFocus={() => { setFocusedBlockId(block.id); if (slashMenu && slashMenu.blockId !== block.id) setSlashMenu(null); }}
                    onBlur={() => { if (focusedBlockId === block.id) setFocusedBlockId(null); }}
                    className={[
                      'outline-none min-h-[24px] leading-[1.65]',
                      block.type === 'h1' && 'text-[22px] font-bold text-[var(--text-primary)]',
                      block.type === 'h2' && 'text-[17px] font-semibold text-[var(--text-primary)]',
                      block.type === 'h3' && 'text-[14px] font-semibold text-[var(--text-primary)]',
                      block.type === 'paragraph' && 'text-[13px] text-[var(--text-secondary)]',
                      block.type === 'bullet' && 'text-[13px] text-[var(--text-secondary)]',
                      block.type === 'ordered' && 'text-[13px] text-[var(--text-secondary)]',
                      block.type === 'checkbox' && block.checked && 'text-[13px] text-[var(--text-subtle)] line-through',
                      block.type === 'checkbox' && !block.checked && 'text-[13px] text-[var(--text-secondary)]',
                      block.type === 'blockquote' && 'text-[13px] text-[var(--text-muted)] italic',
                      block.type === 'code' && 'text-[12px] font-mono text-[var(--text-secondary)] bg-[var(--input-bg)] rounded px-2 py-1 whitespace-pre',
                      focusedBlockId !== block.id && hasInlineFormatting(block.content) && block.type !== 'code' && 'opacity-0',
                    ].filter(Boolean).join(' ')}
                    data-placeholder={focusedBlockId === block.id ? (block.type === 'h1' ? 'Heading 1' : block.type === 'h2' ? 'Heading 2' : block.type === 'h3' ? 'Heading 3' : block.type === 'paragraph' ? "Type '/' for commands..." : '') : ''}
                    style={{ '--placeholder-color': 'var(--text-disabled)' } as any}
                  />
                  {focusedBlockId !== block.id && hasInlineFormatting(block.content) && block.type !== 'code' && (
                    <div
                      onClick={(e) => {
                        // If clicking a link, open it instead of focusing the block
                        const target = e.target as HTMLElement;
                        const link = target.closest('a[data-href]') as HTMLElement;
                        if (link) {
                          e.preventDefault();
                          e.stopPropagation();
                          const href = link.dataset.href;
                          if (href) window.electron?.openUrl?.(href);
                          return;
                        }
                        setFocusedBlockId(block.id);
                        const el = blockElsRef.current.get(block.id);
                        if (el) el.focus();
                      }}
                      className={[
                        'absolute inset-0 cursor-text min-h-[24px] leading-[1.65]',
                        block.type === 'h1' && 'text-[22px] font-bold text-[var(--text-primary)]',
                        block.type === 'h2' && 'text-[17px] font-semibold text-[var(--text-primary)]',
                        block.type === 'h3' && 'text-[14px] font-semibold text-[var(--text-primary)]',
                        block.type === 'paragraph' && 'text-[13px] text-[var(--text-secondary)]',
                        block.type === 'bullet' && 'text-[13px] text-[var(--text-secondary)]',
                        block.type === 'ordered' && 'text-[13px] text-[var(--text-secondary)]',
                        block.type === 'checkbox' && block.checked && 'text-[13px] text-[var(--text-subtle)] line-through',
                        block.type === 'checkbox' && !block.checked && 'text-[13px] text-[var(--text-secondary)]',
                        block.type === 'blockquote' && 'text-[13px] text-[var(--text-muted)] italic',
                      ].filter(Boolean).join(' ')}
                      dangerouslySetInnerHTML={{ __html: renderInlineFormatting(block.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')) }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}

      {slashMenu && (
        <SlashMenu
          position={slashMenu.position}
          onSelect={handleSlashSelect}
          onClose={() => {
            const { blockId } = slashMenu;
            setSlashMenu(null);
            focusBlock(blockId, 0);
          }}
        />
      )}

      <style>{`
        [data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: var(--text-disabled, rgba(255,255,255,0.25));
          pointer-events: none;
          position: absolute;
        }
        [data-placeholder]:empty { position: relative; }
      `}</style>
    </div>
  );
};

// ─── Tooltip ─────────────────────────────────────────────────────────

const ShortcutTooltip: React.FC<{
  label: string;
  shortcut?: string[];
  visible: boolean;
  position?: 'top' | 'bottom';
}> = ({ label, shortcut, visible, position = 'top' }) => {
  if (!visible) return null;
  const posClass = position === 'top'
    ? 'absolute bottom-full right-0 mb-1.5'
    : 'absolute top-full right-0 mt-1.5';
  return (
    <div className={`${posClass} pointer-events-none z-50`}>
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--ui-divider)] rounded-md shadow-xl whitespace-nowrap">
        <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
        {shortcut?.map((k, i) => (
          <kbd key={i} className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded bg-[var(--kbd-bg)] text-[10px] text-[var(--text-subtle)] font-medium">
            {k}
          </kbd>
        ))}
      </div>
    </div>
  );
};

// ─── Toolbar Button ──────────────────────────────────────────────────

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
        className={className || "p-1.5 rounded text-[var(--text-subtle)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-colors"}
      >
        <Icon size={iconSize} />
      </button>
      <ShortcutTooltip label={label} shortcut={shortcut} visible={hover} position={tooltipPosition} />
    </div>
  );
};

// ─── Heading Dropdown Button ─────────────────────────────────────────

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
        className="flex items-center gap-0.5 px-1.5 py-1 rounded text-[var(--text-subtle)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-colors"
      >
        <span className="text-[14px] font-bold">H</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="opacity-50"><path d="M1 3l3 3 3-3z" /></svg>
      </button>
      {!showMenu && <ShortcutTooltip label="Headings" visible={hover} position="top" />}
      {showMenu && (
        <div className="absolute bottom-full left-0 mb-1 bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--ui-divider)] rounded-lg shadow-xl overflow-hidden z-50 min-w-[220px]">
          {HEADING_OPTIONS.map((h) => (
            <button
              key={h.label}
              onClick={() => onSelect(h.prefix)}
              className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
            >
              <span className={`font-bold ${h.size}`}>{h.label}</span>
              <span className="flex items-center gap-0.5">
                {h.keys.map((k, i) => (
                  <kbd key={i} className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded bg-[var(--kbd-bg)] text-[10px] text-[var(--text-subtle)] font-medium">
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

// ─── Editor View ─────────────────────────────────────────────────────

interface EditorViewProps {
  note: Note | null;
  onSave: (data: { title: string; icon: string; content: string; theme: NoteTheme }) => void;
  onBack: () => void;
  onBrowse: () => void;
  onNewNote: () => void;
  onShowActions: () => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onDuplicate: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  showFind: boolean;
  setShowFind: (v: boolean) => void;
}

const EditorView: React.FC<EditorViewProps> = ({
  note, onSave, onBack, onBrowse, onNewNote, onShowActions,
  onNavigateBack, onNavigateForward,
  onDuplicate, onTogglePin, onDelete, showFind, setShowFind,
}) => {
  const [icon, setIcon] = useState(note?.icon || '');
  const [content, setContent] = useState(note?.content || '');
  const [theme, setTheme] = useState<NoteTheme>(note?.theme || 'default');
  const [showToolbar, setShowToolbar] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findActiveIndex, setFindActiveIndex] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const [showHeadingMenu, setShowHeadingMenu] = useState(false);
  const blockEditorRef = useRef<BlockEditorHandle>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = useMemo(() => extractTitleFromContent(content), [content]);
  const accentColor = THEME_ACCENT[theme];

  useEffect(() => {
    setIcon(note?.icon || '');
    setContent(note?.content || '');
    setTheme(note?.theme || 'default');
  }, [note?.id]);

  useEffect(() => {
    if (showFind) setTimeout(() => findInputRef.current?.focus(), 50);
  }, [showFind]);

  // Auto-save debounce. Runs even when `note` is null (draft / new-note
  // path) so the first keystroke triggers a create; handleEditorSave gates
  // whether to actually persist based on non-empty content.
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      onSave({ title, icon, content, theme });
    }, 400);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [title, icon, content, theme, note]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const alt = e.altKey;

      if (e.key === 'Escape') {
        if (showFind) { setShowFind(false); e.preventDefault(); return; }
        if (showToolbar) { setShowToolbar(false); e.preventDefault(); return; }
        // Save and close the window — but only persist if there's real
        // content. Empty drafts are discarded rather than saved as Untitled.
        // `title` comes from extractTitleFromContent and falls back to 'Untitled',
        // so we can't rely on it — only check `content`.
        const hasContent = (content || '').trim().length > 0;
        if (hasContent) onSave({ title: title || 'Untitled', icon, content, theme });
        e.preventDefault();
        window.close();
        return;
      }
      if (meta && !shift && !alt && e.key === 'n') { e.preventDefault(); onNewNote(); return; }
      if (meta && !shift && !alt && e.key === 'k') { e.preventDefault(); onShowActions(); return; }
      if (meta && !shift && !alt && e.key === 'p') { e.preventDefault(); onBrowse(); return; }
      if (meta && shift && e.key === 'p') { e.preventDefault(); onTogglePin(); return; }
      if (meta && !shift && !alt && e.key === 'd') { e.preventDefault(); onDuplicate(); return; }
      // Control+X (not Cmd+X — that is cut) deletes the current note.
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        onDelete();
        return;
      }
      if (meta && !shift && !alt && e.key === 'f') {
        e.preventDefault();
        setShowFind(true);
        // Re-focus the find input even if already open
        setTimeout(() => findInputRef.current?.focus(), 50);
        return;
      }
      if (meta && !shift && !alt && e.key === '[') { e.preventDefault(); onNavigateBack(); return; }
      if (meta && !shift && !alt && e.key === ']') { e.preventDefault(); onNavigateForward(); return; }
      // Format toolbar toggle: Cmd+Alt+, or Cmd+Shift+, (Shift+, = < on macOS)
      if (meta && alt && (e.key === ',' || e.code === 'Comma')) { e.preventDefault(); setShowToolbar(p => !p); return; }
      if (meta && shift && !alt && (e.key === ',' || e.key === '<' || e.code === 'Comma')) { e.preventDefault(); setShowToolbar(p => !p); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showToolbar, showFind, note, title, icon, content, theme, onBack, onNewNote, onBrowse, onShowActions, onNavigateBack, onNavigateForward, onDuplicate, onTogglePin, onDelete, setShowFind]);

  const formatWrap = useCallback((prefix: string, suffix: string) => {
    blockEditorRef.current?.wrapSelection(prefix, suffix);
  }, []);

  const formatInsertBlock = useCallback((type: BlockType) => {
    blockEditorRef.current?.insertBlockType(type);
  }, []);

  return (
    <div className="flex flex-col h-full relative">
      {/* Title bar */}
      <div className="flex items-center px-3 py-2 border-b border-[var(--ui-divider)]" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex-shrink-0 w-[68px]" />
        <div className="flex-1 flex items-center justify-center gap-1.5 truncate mx-2">
          {icon && <span className="text-[13px]">{icon}</span>}
          <span className="text-[var(--text-muted)] text-[13px] font-medium truncate">{title}</span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <ToolbarBtn icon={LayoutList} label="Browse Notes" shortcut={['⌘', 'P']} onClick={onBrowse}
            iconSize={14} tooltipPosition="bottom"
            className="p-1.5 rounded-md text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-all duration-150" />
          <ToolbarBtn icon={Plus} label="New Note" shortcut={['⌘', 'N']} onClick={onNewNote}
            iconSize={14} tooltipPosition="bottom"
            className="p-1.5 rounded-md text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-all duration-150" />
        </div>
      </div>

      {/* Find bar */}
      {showFind && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--ui-divider)]">
          <Search size={13} className="text-[var(--text-disabled)] flex-shrink-0" />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => { setFindQuery(e.target.value); setFindActiveIndex(0); }}
            placeholder="Find in note..."
            className="flex-1 bg-transparent text-[var(--text-primary)] text-[13px] placeholder:text-[var(--text-disabled)] outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setShowFind(false); setFindQuery(''); setFindCount(0); e.stopPropagation(); return; }
              if (e.key === 'Enter' && findQuery && findCount > 0) {
                e.preventDefault();
                if (e.shiftKey) {
                  setFindActiveIndex(i => (i - 1 + findCount) % findCount);
                } else {
                  setFindActiveIndex(i => (i + 1) % findCount);
                }
              }
            }}
          />
          {findQuery && findCount > 0 && (
            <span className="text-[11px] text-[var(--text-muted)] flex-shrink-0 tabular-nums">
              {findActiveIndex + 1}/{findCount}
            </span>
          )}
          {findQuery && findCount === 0 && (
            <span className="text-[11px] text-[var(--text-disabled)] flex-shrink-0">
              No results
            </span>
          )}
          {findQuery && findCount > 0 && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button onClick={() => setFindActiveIndex(i => (i - 1 + findCount) % findCount)}
                className="p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-subtle)]" title="Previous">
                <ArrowUp size={12} />
              </button>
              <button onClick={() => setFindActiveIndex(i => (i + 1) % findCount)}
                className="p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-subtle)]" title="Next">
                <ArrowDown size={12} />
              </button>
            </div>
          )}
          <button onClick={() => { setShowFind(false); setFindQuery(''); setFindCount(0); }} className="p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-subtle)]">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Block Editor */}
      <BlockEditor
        key={note?.id || '__new'}
        initialContent={note?.content || ''}
        onContentChange={setContent}
        accentColor={accentColor}
        editorRef={blockEditorRef}
        findQuery={showFind ? findQuery : undefined}
        findActiveIndex={findActiveIndex}
        onFindCountChange={setFindCount}
      />

      {/* Bottom bar */}
      <div className="border-t border-[var(--ui-divider)]">
        {showToolbar && (
          <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-[var(--ui-divider)]">
            <HeadingDropdownBtn showMenu={showHeadingMenu} onToggle={() => setShowHeadingMenu(p => !p)} onSelect={(prefix: string) => { formatInsertBlock(prefix === '# ' ? 'h1' : prefix === '## ' ? 'h2' : 'h3'); setShowHeadingMenu(false); }} />
            <ToolbarBtn icon={Bold} label="Bold" shortcut={['⌘', 'B']} onClick={() => formatWrap('**', '**')} />
            <ToolbarBtn icon={Italic} label="Italic" shortcut={['⌘', 'I']} onClick={() => formatWrap('*', '*')} />
            <ToolbarBtn icon={Strikethrough} label="Strikethrough" shortcut={['⇧', '⌘', 'S']} onClick={() => formatWrap('~~', '~~')} />
            <ToolbarBtn icon={Underline} label="Underline" shortcut={['⌘', 'U']} onClick={() => formatWrap('<u>', '</u>')} />
            <ToolbarBtn icon={Code} label="Inline code" shortcut={['⌘', 'E']} onClick={() => formatWrap('`', '`')} />
            <ToolbarBtn icon={Link} label="Link" shortcut={['⌘', 'L']} onClick={() => formatWrap('[', '](url)')} />
            <ToolbarBtn icon={SquareCode} label="Code block" shortcut={['⌥', '⌘', 'C']} onClick={() => formatInsertBlock('code')} />
            <ToolbarBtn icon={Quote} label="Blockquote" shortcut={['⇧', '⌘', 'B']} onClick={() => formatInsertBlock('blockquote')} />
            <ToolbarBtn icon={ListOrdered} label="Ordered list" shortcut={['⇧', '⌘', '7']} onClick={() => formatInsertBlock('ordered')} />
            <ToolbarBtn icon={List} label="Bullet list" shortcut={['⇧', '⌘', '8']} onClick={() => formatInsertBlock('bullet')} />
            <ToolbarBtn icon={ListChecks} label="Task list" shortcut={['⇧', '⌘', '9']} onClick={() => formatInsertBlock('checkbox')} />
            <div className="flex-1" />
            <ToolbarBtn icon={X} label="Close" onClick={() => setShowToolbar(false)} iconSize={13}
              className="p-1 rounded text-[var(--text-subtle)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-colors" />
          </div>
        )}

        <ExtensionActionFooter
          leftContent={
            <span className="flex items-center gap-2">
              {icon && <span className="text-[11px]">{icon}</span>}
              <span className="truncate text-xs">{charCount(content)} chars</span>
            </span>
          }
          primaryAction={{
            label: showToolbar ? 'Hide Format' : 'Format',
            onClick: () => setShowToolbar(p => !p),
            shortcut: ['⌥', '⌘', ','],
          }}
          actionsButton={{ label: 'Actions', onClick: onShowActions, shortcut: ['⌘', 'K'] }}
        />
      </div>
    </div>
  );
};

// ─── Markdown Preview for Search View ────────────────────────────────

function markdownToHtml(md: string, accentColor: string): string {
  if (!md.trim()) return '<span style="color:var(--text-disabled);font-style:italic">No content</span>';
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inlineFormat = (text: string): string => {
    let s = escapeHtml(text);
    s = s.replace(/`([^`]+)`/g, `<code style="background:var(--input-bg);padding:1px 5px;border-radius:3px;font-size:11px;font-family:monospace;color:${accentColor}">$1</code>`);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-primary);font-weight:600">$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em style="color:var(--text-secondary);font-style:italic">$1</em>');
    s = s.replace(/~~(.+?)~~/g, '<del style="color:var(--text-subtle)">$1</del>');
    s = s.replace(/\[(.+?)\]\((.+?)\)/g, `<span style="color:${accentColor};text-decoration:underline">$1</span>`);
    return s;
  };
  const lines = md.split('\n');
  const parts: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```') || line.startsWith('~~~')) {
      const fence = line.startsWith('```') ? '```' : '~~~';
      const cl: string[] = []; let j = i + 1;
      while (j < lines.length && !lines[j].startsWith(fence)) { cl.push(escapeHtml(lines[j])); j++; }
      parts.push(`<pre style="background:var(--input-bg);border-radius:6px;padding:8px;margin:4px 0;font-size:11px;font-family:monospace;color:var(--text-secondary);white-space:pre">${cl.join('\n')}</pre>`);
      i = j + 1; continue;
    }
    if (/^(---+|___+|\*\*\*+)$/.test(line.trim())) { parts.push('<hr style="border:none;border-top:1px solid var(--ui-divider);margin:8px 0" />'); i++; continue; }
    const h3 = line.match(/^### (.+)/); if (h3) { parts.push(`<h3 style="font-size:13px;font-weight:600;color:var(--text-primary);margin:8px 0 2px">${inlineFormat(h3[1])}</h3>`); i++; continue; }
    const h2 = line.match(/^## (.+)/); if (h2) { parts.push(`<h2 style="font-size:15px;font-weight:600;color:var(--text-primary);margin:8px 0 2px">${inlineFormat(h2[1])}</h2>`); i++; continue; }
    const h1 = line.match(/^# (.+)/); if (h1) { parts.push(`<h1 style="font-size:18px;font-weight:700;color:var(--text-primary);margin:6px 0 4px">${inlineFormat(h1[1])}</h1>`); i++; continue; }
    const ck = line.match(/^- \[([ x])\]\s*(.*)/);
    if (ck) {
      const done = ck[1] === 'x';
      parts.push(`<div style="display:flex;align-items:flex-start;gap:8px;padding:2px 0"><span data-checkbox-line="${i}" data-checked="${done}" style="border:2px solid ${done ? accentColor : accentColor + '60'};${done ? 'background:' + accentColor + '30;' : ''}border-radius:3px;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0;margin-top:2px;cursor:pointer;color:${accentColor}">${done ? '✓' : ''}</span><span style="font-size:12px;${done ? 'color:var(--text-subtle);text-decoration:line-through' : 'color:var(--text-secondary)'}">${inlineFormat(ck[2])}</span></div>`);
      i++; continue;
    }
    const ul = line.match(/^[-*+]\s+(.+)/);
    if (ul) { parts.push(`<div style="display:flex;align-items:flex-start;gap:6px;padding:1px 0 1px 3px"><span style="margin-top:6px;width:4px;height:4px;border-radius:50%;background:${accentColor};flex-shrink:0"></span><span style="font-size:12px;color:var(--text-secondary)">${inlineFormat(ul[1])}</span></div>`); i++; continue; }
    const ol = line.match(/^(\d+)\.\s+(.+)/);
    if (ol) { parts.push(`<div style="display:flex;align-items:flex-start;gap:6px;padding:1px 0 1px 2px"><span style="color:var(--text-subtle);font-size:11px;min-width:14px;text-align:right">${ol[1]}.</span><span style="font-size:12px;color:var(--text-secondary)">${inlineFormat(ol[2])}</span></div>`); i++; continue; }
    const bq = line.match(/^>\s*(.*)/);
    if (bq) { parts.push(`<div style="border-left:2px solid var(--ui-divider);padding-left:10px;padding:1px 0 1px 10px;margin:2px 0"><span style="font-size:12px;color:var(--text-muted);font-style:italic">${inlineFormat(bq[1])}</span></div>`); i++; continue; }
    if (!line.trim()) { parts.push('<div style="height:8px"></div>'); i++; continue; }
    parts.push(`<p style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin:0">${inlineFormat(line)}</p>`);
    i++;
  }
  return parts.join('');
}

// ─── Search View ─────────────────────────────────────────────────────

interface SearchViewProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  onOpenNote: (note: Note) => void;
  onShowActions: () => void;
  flatNotes: Note[];
  onUpdateNoteContent: (noteId: string, content: string) => void;
}

const SearchView: React.FC<SearchViewProps> = ({
  searchQuery, setSearchQuery, selectedIndex, setSelectedIndex,
  onOpenNote, onShowActions, flatNotes, onUpdateNoteContent,
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
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--ui-divider)]" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex-shrink-0 w-[68px]" />
        <div className="flex-1 flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <Search size={14} className="text-[var(--text-disabled)] flex-shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Notes..."
            autoFocus
            className="flex-1 bg-transparent text-[var(--text-primary)] text-[13px] placeholder:text-[var(--text-subtle)] outline-none font-light"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-subtle)]">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {flatNotes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <FileText size={32} className="text-[var(--text-disabled)]" />
          <p className="text-[13px] text-[var(--text-subtle)]">{searchQuery ? 'No notes found' : 'No notes yet'}</p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div ref={listRef} className="w-[38%] border-r border-[var(--ui-divider)] overflow-y-auto custom-scrollbar">
            {grouped.map((group) => (
              <div key={group.label}>
                <div className="px-3 pt-3 pb-1">
                  <span className="text-[10px] font-semibold text-[var(--text-subtle)] uppercase tracking-wider">{group.label}</span>
                </div>
                {group.notes.map((note) => {
                  const flatIdx = flatNotes.indexOf(note);
                  const isSelected = flatIdx === selectedIndex;
                  return (
                    <div
                      key={note.id} data-note-item
                      onClick={() => setSelectedIndex(flatIdx)}
                      onDoubleClick={() => onOpenNote(note)}
                      className={`px-3 py-2 cursor-pointer transition-colors ${isSelected ? 'bg-[var(--accent)]/8' : 'hover:bg-[var(--bg-secondary)]/50'}`}
                    >
                      <div className="flex items-center gap-2">
                        {note.pinned && <Pin size={10} className="text-[var(--text-subtle)] flex-shrink-0" />}
                        {note.icon && <span className="text-[12px] flex-shrink-0">{note.icon}</span>}
                        <span className="text-[12px] text-[var(--text-primary)] font-medium truncate">{note.title || 'Untitled'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-[var(--text-disabled)]">{formatRelativeTime(note.updatedAt)}</span>
                        <span className="text-[10px] text-[var(--text-disabled)]">&middot;</span>
                        <span className="text-[10px] text-[var(--text-disabled)]">{charCount(note.content)} chars</span>
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
                <div
                  className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3"
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    const cbox = target.closest('[data-checkbox-line]') as HTMLElement;
                    if (!cbox || !selectedNote) return;
                    const lineIdx = parseInt(cbox.dataset.checkboxLine || '', 10);
                    if (isNaN(lineIdx)) return;
                    const lines = selectedNote.content.split('\n');
                    if (lineIdx < 0 || lineIdx >= lines.length) return;
                    const line = lines[lineIdx];
                    if (line.match(/^- \[ \]/)) lines[lineIdx] = line.replace('- [ ]', '- [x]');
                    else if (line.match(/^- \[x\]/)) lines[lineIdx] = line.replace('- [x]', '- [ ]');
                    else return;
                    onUpdateNoteContent(selectedNote.id, lines.join('\n'));
                  }}
                >
                  <div className="flex items-start gap-2 mb-2">
                    {selectedNote.icon && <span className="text-[18px] mt-0.5">{selectedNote.icon}</span>}
                    <h1 className="text-[17px] font-bold text-[var(--text-primary)] leading-tight">{selectedNote.title || 'Untitled'}</h1>
                  </div>
                  <div dangerouslySetInnerHTML={{ __html: markdownToHtml(selectedNote.content, THEME_ACCENT[selectedNote.theme]) }} />
                </div>
                <div className="border-t border-[var(--ui-divider)] px-4 py-2.5 space-y-1 flex-shrink-0">
                  <div className="text-[10px] text-[var(--text-subtle)] font-semibold uppercase tracking-wider mb-1.5">Info</div>
                  <MetaRow label="Characters" value={charCount(selectedNote.content).toLocaleString()} />
                  <MetaRow label="Words" value={wordCount(selectedNote.content).toLocaleString()} />
                  <MetaRow label="Created" value={formatRelativeTime(selectedNote.createdAt)} />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <span className="text-[12px] text-[var(--text-disabled)]">Select a note</span>
              </div>
            )}
          </div>
        </div>
      )}

      <ExtensionActionFooter
        leftContent={
          <span className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5" />
            <span className="truncate">Search Notes</span>
          </span>
        }
        primaryAction={selectedNote ? { label: 'Open Note', onClick: () => onOpenNote(selectedNote), shortcut: ['↩'] } : undefined}
        actionsButton={{ label: 'Actions', onClick: onShowActions, shortcut: ['⌘', 'K'] }}
      />
    </div>
  );
};

const MetaRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-[11px] text-[var(--text-subtle)]">{label}</span>
    <span className="text-[11px] text-[var(--text-muted)] text-right">{value}</span>
  </div>
);

// ─── Browse Overlay ──────────────────────────────────────────────────

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
    const items = listRef.current?.querySelectorAll('[data-browse-item]');
    const item = items?.[selectedIdx] as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
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

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[360px] mx-4 overflow-hidden rounded-lg shadow-2xl"
        style={getMenuPanelStyle().style}>
        <div className="px-3 py-2.5 border-b border-[var(--ui-divider)]">
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for notes..."
            className="w-full bg-transparent text-[var(--text-primary)] text-[13px] placeholder:text-[var(--text-subtle)] outline-none" />
        </div>
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-[10px] font-semibold text-[var(--text-subtle)] uppercase tracking-wider">Notes</span>
          <span className="text-[10px] text-[var(--text-disabled)]">{filtered.length} notes</span>
        </div>
        <div ref={listRef} className="max-h-[280px] overflow-y-auto custom-scrollbar">
          {filtered.map((note, idx) => {
            const isCurrent = note.id === currentNoteId;
            const isSelected = idx === selectedIdx;
            return (
              <div key={note.id} data-browse-item onClick={() => onSelect(note)} onMouseEnter={() => setSelectedIdx(idx)}
                className="group px-3 py-2 cursor-pointer transition-colors"
                style={isSelected ? { background: 'rgba(255,255,255,0.08)' } : undefined}>
                <div className="flex items-center gap-2">
                  {note.icon && <span className="text-[12px] flex-shrink-0">{note.icon}</span>}
                  {note.pinned && <Pin size={10} className="text-[var(--text-subtle)] flex-shrink-0" />}
                  <span className="text-[12px] text-[var(--text-primary)] font-medium truncate flex-1">{note.title || 'Untitled'}</span>
                  <div className={`flex items-center gap-0.5 flex-shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                    <button title={note.pinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); onTogglePin(note.id); }}
                      className="p-1 rounded text-[var(--text-subtle)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-colors">
                      {note.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {isCurrent ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
                      <span className="text-[10px] text-[var(--text-muted)]">Current</span>
                    </>
                  ) : (
                    <span className="text-[10px] text-[var(--text-disabled)]">{formatRelativeTime(note.updatedAt)}</span>
                  )}
                  <span className="text-[10px] text-[var(--text-disabled)]">&middot;</span>
                  <span className="text-[10px] text-[var(--text-disabled)]">{charCount(note.content)} chars</span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="px-3 py-4 text-center text-[11px] text-[var(--text-disabled)]">No notes found</div>}
        </div>
      </div>
    </div>
  );
};

// ─── Actions Overlay ─────────────────────────────────────────────────

interface ActionsOverlayProps {
  actions: Action[];
  onClose: () => void;
}

const ActionsOverlay: React.FC<ActionsOverlayProps> = ({ actions, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [submenuActions, setSubmenuActions] = useState<Action[] | null>(null);
  const [submenuSelectedIdx, setSubmenuSelectedIdx] = useState(0);
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
    const items = listRef.current?.querySelectorAll('[data-action-item]');
    const item = items?.[selectedIdx] as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const executeAction = useCallback((action: Action) => {
    if (action.submenu && action.submenu.length > 0) {
      setSubmenuActions(action.submenu);
      setSubmenuSelectedIdx(0);
    } else if (!action.disabled) {
      action.execute();
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (submenuActions) {
        if (e.key === 'Escape' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setSubmenuActions(null); inputRef.current?.focus(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSubmenuSelectedIdx(i => Math.min(i + 1, submenuActions.length - 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSubmenuSelectedIdx(i => Math.max(0, i - 1)); return; }
        if (e.key === 'Enter' && submenuActions[submenuSelectedIdx]) { e.preventDefault(); e.stopPropagation(); submenuActions[submenuSelectedIdx].execute(); return; }
        return;
      }

      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        if (filtered[selectedIdx]) { e.preventDefault(); e.stopPropagation(); executeAction(filtered[selectedIdx]); return; }
      }

      if (e.metaKey || e.ctrlKey) {
        for (const action of actions) {
          if (!action.shortcut) continue;
          const keys = action.shortcut;
          const needsShift = keys.includes('⇧');
          const needsCtrl = keys.includes('^');
          const lastKey = keys[keys.length - 1];
          if (needsCtrl && e.ctrlKey && e.key.toLowerCase() === lastKey.toLowerCase()) {
            e.preventDefault(); e.stopPropagation(); executeAction(action); return;
          }
          if (!needsCtrl && (e.metaKey || e.ctrlKey) && e.shiftKey === needsShift && e.key.toLowerCase() === lastKey.toLowerCase()) {
            e.preventDefault(); e.stopPropagation(); executeAction(action); return;
          }
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filtered, selectedIdx, onClose, actions, submenuActions, submenuSelectedIdx, executeAction]);

  const groupedActions = useMemo(() => {
    const groups: Array<{ section: string; actions: Action[] }> = [];
    let currentSection = '';
    for (const action of filtered) {
      const section = action.section || '';
      if (section !== currentSection) { groups.push({ section, actions: [] }); currentSection = section; }
      groups[groups.length - 1].actions.push(action);
    }
    return groups;
  }, [filtered]);

  let flatIdx = 0;
  const panel = getMenuPanelStyle();

  return (
    <div className="fixed inset-0 z-[9999]" style={{ background: 'var(--bg-scrim)' }}>
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className={`absolute bottom-12 right-3 w-80 max-h-[65vh] overflow-hidden flex flex-col ${panel.className}`}
        style={panel.style}
        onClick={(e) => e.stopPropagation()}
      >
        {submenuActions ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--ui-divider)]">
              <button onClick={() => setSubmenuActions(null)} className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors">
                <span className="text-[12px]">←</span>
              </button>
              <span className="text-[13px] text-[var(--text-muted)]">{filtered[selectedIdx]?.title}</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
              {submenuActions.map((sub, si) => (
                <div key={si} data-action-item
                  onClick={() => sub.execute()}
                  onMouseEnter={() => setSubmenuSelectedIdx(si)}
                  className="flex items-center gap-3 px-3 py-[7px] cursor-pointer transition-colors text-[var(--text-secondary)]"
                  style={si === submenuSelectedIdx ? { background: 'rgba(255,255,255,0.08)' } : undefined}
                >
                  <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center opacity-60">{sub.icon}</span>
                  <span className="flex-1 text-[12px]">{sub.title}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="px-3 py-2.5 border-b border-[var(--ui-divider)]">
              <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for actions..."
                className="w-full bg-transparent text-[var(--text-primary)] text-[13px] placeholder:text-[var(--text-subtle)] outline-none" />
            </div>
            <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar py-1">
              {groupedActions.map((group, gi) => (
                <div key={group.section || `__${gi}`}>
                  {gi > 0 && <hr className="border-[var(--ui-divider)] my-0.5" />}
                  {group.actions.map((action) => {
                    const idx = flatIdx++;
                    return (
                      <div key={idx} data-action-item
                        onClick={() => executeAction(action)}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        className={`flex items-center gap-3 px-3 py-[7px] cursor-pointer transition-colors ${action.style === 'destructive' ? 'text-red-400' : action.disabled ? 'text-[var(--text-disabled)]' : 'text-[var(--text-secondary)]'}`}
                        style={idx === selectedIdx ? { background: 'rgba(255,255,255,0.08)' } : undefined}
                      >
                        <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center opacity-60">{action.icon}</span>
                        <span className="flex-1 text-[12px]">{action.title}</span>
                        {action.shortcut && (
                          <span className="flex items-center gap-0.5 flex-shrink-0">
                            {action.shortcut.map((k, ki) => (
                              <kbd key={ki} className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded bg-[var(--kbd-bg)] text-[10px] text-[var(--text-subtle)] font-medium">
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
              {filtered.length === 0 && <div className="px-3 py-4 text-center text-[11px] text-[var(--text-disabled)]">No actions found</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────────────

const NotesManager: React.FC<NotesManagerProps> = ({ initialView }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [viewMode, setViewMode] = useState<'editor' | 'search'>(initialView === 'search' ? 'search' : 'editor');
  const [showBrowse, setShowBrowse] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const pushToHistory = useCallback((noteId: string) => {
    if (isNavigatingRef.current) return;
    setNavHistory(prev => {
      const trimmed = prev.slice(0, navIndex + 1);
      if (trimmed[trimmed.length - 1] === noteId) return trimmed;
      return [...trimmed, noteId];
    });
    setNavIndex(prev => navHistory.slice(0, prev + 1).length);
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

  // ─── Handlers ────────────────────────────────────────────────────

  const handleNewNote = useCallback(async () => {
    // Don't pre-create the note — we want an in-memory draft so that if the
    // user closes the editor without typing anything, nothing gets persisted.
    // The actual DB row is created by handleEditorSave below when the first
    // auto-save fires with non-empty content.
    setCurrentNote(null);
    setViewMode('editor');
  }, []);

  const handleEditorSave = useCallback(async (data: { title: string; icon: string; content: string; theme: NoteTheme }) => {
    // Don't save empty notes — applies to both draft creation and existing-note
    // updates. If the user clears an existing note to empty, we simply skip
    // the auto-save so we don't persist empty content.
    // NOTE: `data.title` is derived from `data.content` via extractTitleFromContent
    // and falls back to 'Untitled', so it's NEVER empty. Only gate on content.
    const hasContent = (data.content || '').trim().length > 0;
    if (currentNote) {
      if (!hasContent) return;
      await window.electron.noteUpdate(currentNote.id, { title: data.title, icon: data.icon, content: data.content, theme: data.theme });
      setCurrentNote(prev => prev ? { ...prev, ...data } : null);
    } else {
      // Draft path: only persist once the user has typed something. An empty
      // draft (no title and no content) is intentionally discarded so we
      // don't leave "Untitled" stubs behind.
      if (!hasContent) return;
      const created = await window.electron.noteCreate({ title: data.title || 'Untitled', icon: data.icon, content: data.content, theme: data.theme });
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

  // ─── Actions ─────────────────────────────────────────────────────

  const actions: Action[] = useMemo(() => {
    const a: Action[] = [];
    a.push({ title: 'New Note', icon: <Plus size={14} />, shortcut: ['⌘', 'N'], section: 'actions', execute: () => { handleNewNote(); setShowActions(false); } });
    if (targetNote) a.push({ title: 'Duplicate Note', icon: <Files size={14} />, shortcut: ['⌘', 'D'], section: 'actions', execute: () => handleDuplicate() });
    if (viewMode === 'editor') a.push({ title: 'Browse Notes', icon: <LayoutList size={14} />, shortcut: ['⌘', 'P'], section: 'actions', execute: () => { setShowBrowse(true); setShowActions(false); } });
    if (viewMode === 'editor') a.push({ title: 'Find in Note', icon: <Search size={14} />, shortcut: ['⌘', 'F'], section: 'find', execute: () => { setShowFind(true); setShowActions(false); } });
    if (targetNote) {
      a.push({ title: 'Copy Note As...', icon: <Copy size={14} />, shortcut: ['⇧', '⌘', 'C'], section: 'copy', execute: () => {}, submenu: [
        { title: 'Copy as Markdown', icon: <Copy size={14} />, execute: async () => { await window.electron.noteCopyToClipboard(targetNote.id, 'markdown'); setShowActions(false); } },
        { title: 'Copy as HTML', icon: <Copy size={14} />, execute: async () => { await window.electron.noteCopyToClipboard(targetNote.id, 'html'); setShowActions(false); } },
        { title: 'Copy as Plain Text', icon: <Copy size={14} />, execute: async () => { await window.electron.noteCopyToClipboard(targetNote.id, 'plaintext'); setShowActions(false); } },
      ] });
      a.push({ title: 'Copy Deeplink', icon: <Link2 size={14} />, shortcut: ['⇧', '⌘', 'D'], section: 'copy', execute: async () => { await navigator.clipboard.writeText(`supercmd://notes/${targetNote.id}`); setShowActions(false); } });
      a.push({ title: 'Export...', icon: <Upload size={14} />, shortcut: ['⇧', '⌘', 'E'], section: 'copy', execute: () => handleExport() });
    }
    if (targetNote) a.push({ title: targetNote.pinned ? 'Unpin Note' : 'Pin Note', icon: targetNote.pinned ? <PinOff size={14} /> : <Pin size={14} />, shortcut: ['⇧', '⌘', 'P'], section: 'settings', execute: () => handleTogglePin() });
    a.push({ title: 'Import Notes', icon: <Download size={14} />, section: 'settings', execute: async () => { await window.electron.noteImport(); loadNotes(); setShowActions(false); } });
    a.push({ title: 'Export All Notes', icon: <Upload size={14} />, section: 'settings', execute: async () => { await window.electron.noteExport(); setShowActions(false); } });
    if (targetNote) a.push({ title: 'Delete Note', icon: <Trash2 size={14} />, shortcut: ['⌃', 'X'], section: 'danger', style: 'destructive', execute: () => { setConfirmDelete(true); setShowActions(false); } });
    return a;
  }, [targetNote, viewMode, loadNotes, handleNewNote, handleDuplicate, handleTogglePin, handleExport, notes]);

  // ─── Keyboard: search view ──────────────────────────────────────

  useEffect(() => {
    if (viewMode !== 'search') return;
    const handler = (e: KeyboardEvent) => {
      if (showActions || showBrowse) return;
      if (e.key === 'Escape') { e.preventDefault(); window.close(); return; }
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setShowActions(true); return; }
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleNewNote(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, notes.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && selectedNote) { e.preventDefault(); handleOpenNote(selectedNote); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewMode, showActions, showBrowse, notes, selectedIndex, selectedNote, handleNewNote, handleOpenNote]);

  // ─── Keyboard: global shortcuts ──────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showActions || showBrowse) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && e.key === 'p') { e.preventDefault(); handleTogglePin(); return; }
      if (meta && e.shiftKey && e.key === 'e') { e.preventDefault(); handleExport(); return; }
      if (meta && e.shiftKey && e.key === 'c' && targetNote) { e.preventDefault(); window.electron.noteCopyToClipboard(targetNote.id, 'markdown'); return; }
      // Control+X (not Cmd+X — that is cut) opens the delete confirmation.
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'x' || e.key === 'X') && targetNote) {
        e.preventDefault();
        setConfirmDelete(true);
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

  // Listen for mode changes from main process (when window is reused)
  useEffect(() => {
    const cleanup = (window as any).electron?.onNotesMode?.((payload: any) => {
      // payload is { mode, noteJson } or a string
      const noteJson = typeof payload === 'object' ? payload?.noteJson : undefined;
      const mode = typeof payload === 'object' ? payload?.mode : payload;
      if (noteJson) {
        try {
          const note = JSON.parse(noteJson);
          if (note && note.id) {
            setCurrentNote(note);
            setViewMode('editor');
            return;
          }
        } catch {}
      }
      if (mode === 'create') handleNewNote();
    });
    return cleanup;
  }, [handleNewNote]);

  useEffect(() => {
    let aborted = false;
    // Check if there's a pending note to open (passed from inline search)
    window.electron.notesGetPending?.().then((json: string | null) => {
      if (aborted) return;
      if (json) {
        try {
          const note = JSON.parse(json);
          if (note && note.id) {
            setCurrentNote(note);
            setViewMode('editor');
            return;
          }
        } catch {}
      }
      // No pending note — create new or show search based on initialView
      if (initialView === 'create') handleNewNote();
    }).catch(() => {
      if (!aborted && initialView === 'create') handleNewNote();
    });
    return () => { aborted = true; };
  }, []);

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {viewMode === 'editor' ? (
        <EditorView
          note={currentNote}
          onSave={handleEditorSave}
          onBack={handleEditorClose}
          onBrowse={() => setShowBrowse(true)}
          onNewNote={handleNewNote}
          onShowActions={() => setShowActions(true)}
          onNavigateBack={navigateBack}
          onNavigateForward={navigateForward}
          onDuplicate={handleDuplicate}
          onTogglePin={handleTogglePin}
          onDelete={() => { if (currentNote) setConfirmDelete(true); }}
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
          onShowActions={() => setShowActions(true)}
          flatNotes={notes}
          onUpdateNoteContent={async (noteId, content) => {
            const noteTitle = notes.find(n => n.id === noteId)?.title || 'Untitled';
            await window.electron.noteUpdate(noteId, { content, title: noteTitle });
            loadNotes();
          }}
        />
      )}

      {showBrowse && (
        <BrowseOverlay
          notes={notes}
          currentNoteId={currentNote?.id || null}
          onSelect={handleOpenNote}
          onClose={() => setShowBrowse(false)}
          onTogglePin={async (id) => { await window.electron.noteTogglePin(id); loadNotes(); }}
          onDelete={async (id) => { await window.electron.noteDelete(id); if (currentNote?.id === id) { setCurrentNote(null); setViewMode('search'); } loadNotes(); }}
        />
      )}

      {showActions && <ActionsOverlay actions={actions} onClose={() => setShowActions(false)} />}

      {confirmDelete && targetNote && (
        <ConfirmDeleteDialog
          title={targetNote.title || 'Untitled'}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await window.electron.noteDelete(targetNote.id);
            setConfirmDelete(false);
            if (viewMode === 'editor') { setCurrentNote(null); window.close(); }
            else { setSelectedIndex(i => Math.max(0, i - 1)); loadNotes(); }
          }}
        />
      )}
    </div>
  );
};

export default NotesManager;

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Delete Dialog
// ─────────────────────────────────────────────────────────────────────────────

interface ConfirmDeleteDialogProps {
  title: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({ title, onConfirm, onCancel }) => {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Move focus to the Delete button so the active editor no longer
    // receives keystrokes while the dialog is open.
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    // Capture-phase so we intercept before the editor / other listeners.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-[320px] rounded-xl shadow-2xl overflow-hidden"
        style={{
          // Layer the translucent card color over an opaque surface so the
          // 0.5 black overlay behind the dialog can't bleed through and dim
          // the card. Skip backdrop-filter for the same reason (it would
          // blur the dark overlay and darken the card).
          background: 'linear-gradient(var(--card-bg), var(--card-bg)), var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}>
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1.5">Delete Note</h3>
          <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
            Are you sure you want to delete "<span className="text-[var(--text-secondary)]">{title}</span>"? This action cannot be undone.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-2">
          <button onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-colors">
            Cancel
          </button>
          <button ref={confirmRef} onClick={() => onConfirm()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-white bg-red-400/70 hover:bg-red-400/90 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400/50">
            Delete
            <kbd className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded bg-white/15 text-[10px] font-medium">↩</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};
