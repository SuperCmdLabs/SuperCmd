/**
 * Notes Search — Inline launcher view (matches Snippet Manager UI exactly).
 * Opens the detached notes editor window when a note is selected.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Plus, FileText, Pin, PinOff, X,
  Files, Copy, Link2, Upload, Download, Trash2, Search,
} from 'lucide-react';
import type { Note, NoteTheme } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';
import IconNotes from './icons/Notes';

interface Action {
  title: string;
  icon?: React.ReactNode;
  shortcut?: string[];
  execute: () => void | Promise<void>;
  style?: 'default' | 'destructive';
  section?: string;
  submenu?: Action[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const THEME_ACCENT: Record<NoteTheme, string> = {
  default: '#a0a0a0', rose: '#fb7185', orange: '#fb923c', amber: '#fbbf24',
  emerald: '#34d399', cyan: '#22d3ee', blue: '#60a5fa', violet: '#a78bfa',
  fuchsia: '#e879f9', slate: '#94a3b8',
};

/** Render markdown content to styled HTML for preview */
function markdownToPreviewHtml(md: string, accentColor: string): string {
  if (!md.trim()) return '<span style="color:var(--text-disabled);font-style:italic">No content</span>';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (text: string): string => {
    let s = esc(text);
    s = s.replace(/`([^`]+)`/g, `<code style="background:var(--input-bg);padding:1px 5px;border-radius:3px;font-size:11px;font-family:monospace;color:${accentColor}">$1</code>`);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-primary);font-weight:600">$1</strong>');
    s = s.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/~~(.+?)~~/g, '<del style="text-decoration:line-through;color:var(--text-subtle)">$1</del>');
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
      while (j < lines.length && !lines[j].startsWith(fence)) { cl.push(esc(lines[j])); j++; }
      parts.push(`<pre style="background:var(--input-bg);border-radius:6px;padding:8px;margin:4px 0;font-size:11px;font-family:monospace;color:var(--text-secondary);white-space:pre;overflow-x:auto">${cl.join('\n')}</pre>`);
      i = j + 1; continue;
    }
    if (/^(---+|___+|\*\*\*+)$/.test(line.trim())) { parts.push('<hr style="border:none;border-top:1px solid var(--ui-divider);margin:8px 0" />'); i++; continue; }
    const h3 = line.match(/^### (.+)/); if (h3) { parts.push(`<div style="font-size:14px;font-weight:600;color:var(--text-primary);margin:8px 0 2px">${inline(h3[1])}</div>`); i++; continue; }
    const h2 = line.match(/^## (.+)/); if (h2) { parts.push(`<div style="font-size:17px;font-weight:600;color:var(--text-primary);margin:8px 0 2px">${inline(h2[1])}</div>`); i++; continue; }
    const h1 = line.match(/^# (.+)/); if (h1) { parts.push(`<div style="font-size:22px;font-weight:700;color:var(--text-primary);margin:6px 0 4px">${inline(h1[1])}</div>`); i++; continue; }
    const ck = line.match(/^- \[([ x])\]\s*(.*)/);
    if (ck) {
      const done = ck[1] === 'x';
      parts.push(`<div style="display:flex;align-items:flex-start;gap:8px;padding:2px 0"><span style="border:2px solid ${done ? accentColor : accentColor + '60'};${done ? 'background:' + accentColor + '30;' : ''}border-radius:3px;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0;margin-top:2px;color:${accentColor}">${done ? '✓' : ''}</span><span style="font-size:13px;${done ? 'color:var(--text-subtle);text-decoration:line-through' : 'color:var(--text-secondary)'}">${inline(ck[2])}</span></div>`);
      i++; continue;
    }
    const ul = line.match(/^[-*+]\s+(.+)/);
    if (ul) { parts.push(`<div style="display:flex;align-items:flex-start;gap:6px;padding:1px 0 1px 3px"><span style="margin-top:7px;width:5px;height:5px;border-radius:50%;background:${accentColor};flex-shrink:0"></span><span style="font-size:13px;color:var(--text-secondary)">${inline(ul[1])}</span></div>`); i++; continue; }
    const ol = line.match(/^(\d+)\.\s+(.+)/);
    if (ol) { parts.push(`<div style="display:flex;align-items:flex-start;gap:6px;padding:1px 0 1px 2px"><span style="color:var(--text-subtle);font-size:13px;min-width:14px;text-align:right">${ol[1]}.</span><span style="font-size:13px;color:var(--text-secondary)">${inline(ol[2])}</span></div>`); i++; continue; }
    const bq = line.match(/^>\s*(.*)/);
    if (bq) { parts.push(`<div style="border-left:3px solid ${accentColor}50;padding-left:10px;padding:2px 0 2px 10px;margin:2px 0"><span style="font-size:13px;color:var(--text-muted);font-style:italic">${inline(bq[1])}</span></div>`); i++; continue; }
    if (!line.trim()) { parts.push('<div style="height:8px"></div>'); i++; continue; }
    parts.push(`<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0">${inline(line)}</p>`);
    i++;
  }
  return parts.join('');
}

// ─── Main Component ──────────────────────────────────────────────────

interface NotesSearchInlineProps {
  onClose: () => void;
}

const NotesSearchInline: React.FC<NotesSearchInlineProps> = ({ onClose }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  // Scroll selected item into view
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleOpenNote = useCallback((note?: Note) => {
    // Hide launcher first to avoid flash, then open notes window
    window.electron.hideWindow();
    if (note) {
      window.electron.openNotesWindow('edit', JSON.stringify(note));
    } else {
      window.electron.openNotesWindow('create');
    }
    onClose();
  }, [onClose]);

  const handleNewNote = useCallback(() => {
    window.electron.hideWindow();
    window.electron.openNotesWindow('create');
    onClose();
  }, [onClose]);

  const handleDuplicate = useCallback(async () => {
    if (!selectedNote) return;
    const dup = await window.electron.noteDuplicate(selectedNote.id);
    loadNotes();
    if (dup) {
      window.electron.hideWindow();
      window.electron.openNotesWindow('edit', JSON.stringify(dup));
      onClose();
    }
    setShowActions(false);
  }, [selectedNote, loadNotes, onClose]);

  const handleTogglePin = useCallback(async () => {
    if (!selectedNote) return;
    await window.electron.noteTogglePin(selectedNote.id);
    loadNotes();
    setShowActions(false);
  }, [selectedNote, loadNotes]);

  const handleExport = useCallback(async () => {
    if (!selectedNote) return;
    await window.electron.noteExportToFile(selectedNote.id, 'markdown');
    setShowActions(false);
  }, [selectedNote]);

  const handleDelete = useCallback(() => {
    if (!selectedNote) return;
    setShowActions(false);
    setConfirmDelete(true);
  }, [selectedNote]);

  const confirmDeleteNote = useCallback(async () => {
    if (!selectedNote) return;
    await window.electron.noteDelete(selectedNote.id);
    setSelectedIndex(i => Math.max(0, i - 1));
    loadNotes();
    setConfirmDelete(false);
  }, [selectedNote, loadNotes]);

  // ─── Actions ─────────────────────────────────────────────────────
  const actions: Action[] = useMemo(() => {
    const a: Action[] = [];
    a.push({ title: 'New Note', icon: <Plus size={14} />, shortcut: ['⌘', 'N'], section: 'actions', execute: () => { handleNewNote(); setShowActions(false); } });
    if (selectedNote) {
      a.push({ title: 'Open Note', icon: <IconNotes size="14px" />, shortcut: ['↩'], section: 'actions', execute: () => { handleOpenNote(selectedNote); setShowActions(false); } });
      a.push({ title: 'Duplicate Note', icon: <Files size={14} />, shortcut: ['⌘', 'D'], section: 'actions', execute: () => handleDuplicate() });
      a.push({ title: 'Copy Note As...', icon: <Copy size={14} />, shortcut: ['⇧', '⌘', 'C'], section: 'copy', execute: () => {}, submenu: [
        { title: 'Copy as Markdown', icon: <Copy size={14} />, execute: async () => { await window.electron.noteCopyToClipboard(selectedNote.id, 'markdown'); setShowActions(false); } },
        { title: 'Copy as HTML', icon: <Copy size={14} />, execute: async () => { await window.electron.noteCopyToClipboard(selectedNote.id, 'html'); setShowActions(false); } },
        { title: 'Copy as Plain Text', icon: <Copy size={14} />, execute: async () => { await window.electron.noteCopyToClipboard(selectedNote.id, 'plaintext'); setShowActions(false); } },
      ] });
      a.push({ title: 'Copy Deeplink', icon: <Link2 size={14} />, shortcut: ['⇧', '⌘', 'D'], section: 'copy', execute: async () => { await navigator.clipboard.writeText(`supercmd://notes/${selectedNote.id}`); setShowActions(false); } });
      a.push({ title: 'Export...', icon: <Upload size={14} />, shortcut: ['⇧', '⌘', 'E'], section: 'copy', execute: () => handleExport() });
      a.push({ title: selectedNote.pinned ? 'Unpin Note' : 'Pin Note', icon: selectedNote.pinned ? <PinOff size={14} /> : <Pin size={14} />, shortcut: ['⇧', '⌘', 'P'], section: 'manage', execute: () => handleTogglePin() });
    }
    a.push({ title: 'Import Notes', icon: <Download size={14} />, section: 'manage', execute: async () => { await window.electron.noteImport(); loadNotes(); setShowActions(false); } });
    a.push({ title: 'Export All Notes', icon: <Upload size={14} />, section: 'manage', execute: async () => { await window.electron.noteExport(); setShowActions(false); } });
    if (selectedNote) {
      a.push({ title: 'Delete Note', icon: <Trash2 size={14} />, shortcut: ['^', 'X'], style: 'destructive', section: 'danger', execute: () => handleDelete() });
    }
    return a;
  }, [selectedNote, loadNotes, handleNewNote, handleOpenNote, handleDuplicate, handleTogglePin, handleExport, handleDelete]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (confirmDelete) return; // Let confirm modal handle keys
      if (showActions) return; // Let actions overlay handle keys
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setShowActions(true); return; }
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleNewNote(); return; }
      if (e.key === 'x' && e.ctrlKey && selectedNote) { e.preventDefault(); handleDelete(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, notes.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && selectedNote) { e.preventDefault(); handleOpenNote(selectedNote); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [notes, selectedIndex, selectedNote, showActions, confirmDelete, onClose, handleNewNote, handleOpenNote, handleDelete]);

  return (
    <div className="snippet-view flex flex-col h-full">
      {/* ─── Header (matches snippet-header) ─── */}
      <div className="snippet-header flex h-16 items-center gap-2 px-4">
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          tabIndex={-1}
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="relative min-w-0 flex-1">
          <div className="flex h-full items-center">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-w-0 w-full bg-transparent border-none outline-none text-white/95 placeholder:text-[color:var(--text-subtle)] text-[15px] font-medium tracking-[0.005em]"
              autoFocus
            />
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleNewNote}
            className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
            title="Create Note"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ─── Split pane (matches snippet layout) ─── */}
      <div className="flex-1 flex min-h-0">
        {/* Left: List (40%) */}
        <div
          ref={listRef}
          className="snippet-split w-[40%] overflow-y-auto custom-scrollbar"
        >
          {notes.length === 0 ? (
            <div className="flex items-center justify-center h-full text-white/30">
              <p className="text-sm">{searchQuery ? 'No notes found' : 'No notes yet'}</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {notes.map((note, index) => (
                <div
                  key={note.id}
                  ref={(el) => (itemRefs.current[index] = el)}
                  className={`px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? 'bg-[var(--launcher-card-selected-bg)] border-[var(--launcher-card-border)]'
                      : 'border-transparent hover:bg-[var(--launcher-card-hover-bg)] hover:border-[var(--launcher-card-border)]'
                  }`}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => handleOpenNote(note)}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                    <span className="text-white/80 text-[13px] truncate font-medium leading-tight">
                      {note.title || 'Untitled'}
                    </span>
                    {note.pinned && (
                      <Pin className="w-3 h-3 text-amber-300/80 flex-shrink-0" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Preview (60%) */}
        <div className="flex-1 flex flex-col min-h-0" style={{ background: 'var(--preview-pane-bg, rgba(0,0,0,0.25))', backdropFilter: 'blur(2px)' }}>
          {selectedNote ? (
            <>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
                <div
                  className="leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: markdownToPreviewHtml(selectedNote.content, THEME_ACCENT[selectedNote.theme]) }}
                />
              </div>

              <div className="flex-shrink-0 px-5 py-3 border-t border-[var(--snippet-divider)] space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Name</span>
                  <span className="text-white/65 text-right truncate">
                    {selectedNote.title || '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Characters</span>
                  <span className="text-white/65 text-right truncate">
                    {selectedNote.content.length.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Date</span>
                  <span className="text-white/65 text-right truncate">
                    {formatDate(selectedNote.updatedAt || selectedNote.createdAt)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Select a note to preview</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Footer (matches snippet footer) ─── */}
      <ExtensionActionFooter
        leftContent={<span className="truncate">{notes.length} notes</span>}
        primaryAction={
          selectedNote
            ? {
                label: 'Open Note',
                onClick: () => handleOpenNote(selectedNote),
                shortcut: ['↩'],
              }
            : undefined
        }
        actionsButton={{
          label: 'Actions',
          onClick: () => setShowActions(true),
          shortcut: ['⌘', 'K'],
        }}
      />

      {/* ─── Actions Overlay ─── */}
      {showActions && <SearchActionsOverlay actions={actions} onClose={() => setShowActions(false)} />}

      {/* ─── Confirm Delete Modal ─── */}
      {confirmDelete && selectedNote && (
        <ConfirmDeleteModal
          noteTitle={selectedNote.title || 'Untitled'}
          onConfirm={confirmDeleteNote}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
};

// ─── Actions Overlay (same style as NotesManager) ────────────────────

const SearchActionsOverlay: React.FC<{ actions: Action[]; onClose: () => void }> = ({ actions, onClose }) => {
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
    } else {
      action.execute();
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Submenu is open
      if (submenuActions) {
        if (e.key === 'Escape' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setSubmenuActions(null); inputRef.current?.focus(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSubmenuSelectedIdx(i => Math.min(i + 1, submenuActions.length - 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSubmenuSelectedIdx(i => Math.max(0, i - 1)); return; }
        if (e.key === 'Enter' && submenuActions[submenuSelectedIdx]) { e.preventDefault(); e.stopPropagation(); submenuActions[submenuSelectedIdx].execute(); return; }
        return;
      }

      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSelectedIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        if (filtered[selectedIdx]) {
          e.preventDefault(); e.stopPropagation();
          executeAction(filtered[selectedIdx]);
          return;
        }
      }

      // Match action shortcuts
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

  const isGlassyTheme = document.documentElement.classList.contains('sc-glassy') || document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass = document.documentElement.classList.contains('sc-native-liquid-glass') || document.body.classList.contains('sc-native-liquid-glass');
  const panelStyle: React.CSSProperties = isNativeLiquidGlass
    ? { background: 'rgba(var(--surface-base-rgb), 0.72)', backdropFilter: 'blur(44px) saturate(155%)', WebkitBackdropFilter: 'blur(44px) saturate(155%)', border: '1px solid rgba(var(--on-surface-rgb), 0.22)', boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26), inset 0 -1px 0 0 rgba(var(--on-surface-rgb), 0.05)' }
    : isGlassyTheme
    ? { background: 'linear-gradient(160deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.035) 38%, rgba(255,255,255,0.07) 100%), rgba(var(--surface-base-rgb), 0.58)', backdropFilter: 'blur(128px) saturate(195%) contrast(107%) brightness(1.03)', WebkitBackdropFilter: 'blur(128px) saturate(195%) contrast(107%) brightness(1.03)', border: '1px solid rgba(255, 255, 255, 0.14)', boxShadow: '0 28px 58px -14px rgba(0,0,0,0.42), inset 0 -1px 0 0 rgba(0,0,0,0.08)' }
    : { background: 'var(--card-bg)', backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)', border: '1px solid var(--border-primary)' };
  const panelClassName = (isNativeLiquidGlass || isGlassyTheme) ? 'rounded-3xl p-1' : 'rounded-xl shadow-2xl';

  return (
    <div className="fixed inset-0 z-[9999]" style={{ background: 'var(--bg-scrim)' }}>
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className={`absolute bottom-12 right-3 w-80 max-h-[65vh] overflow-hidden flex flex-col ${panelClassName}`}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {submenuActions ? (
          /* ─── Submenu view ─── */
          <>
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--ui-divider)]">
              <button onClick={() => setSubmenuActions(null)} className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors">
                <ArrowLeft size={14} />
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
          /* ─── Main actions view ─── */
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
                        className={`flex items-center gap-3 px-3 py-[7px] cursor-pointer transition-colors ${action.style === 'destructive' ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}
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

// ─── Confirm Delete Modal ────────────────────────────────────────────

const ConfirmDeleteModal: React.FC<{
  noteTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ noteTitle, onConfirm, onCancel }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onConfirm(); return; }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-[320px] rounded-xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--card-bg)', backdropFilter: 'blur(40px)', border: '1px solid var(--border-primary)' }}>
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1.5">Delete Note</h3>
          <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
            Are you sure you want to delete "<span className="text-[var(--text-secondary)]">{noteTitle}</span>"? This action cannot be undone.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-white bg-red-400/70 hover:bg-red-400/90 transition-colors"
          >
            Delete
            <kbd className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded bg-white/15 text-[10px] font-medium">↩</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotesSearchInline;
