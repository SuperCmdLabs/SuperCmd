/**
 * Notes Search — Inline launcher view (matches Snippet Manager UI exactly).
 * Opens the detached notes editor window when a note is selected.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Plus, FileText, Pin, X,
} from 'lucide-react';
import type { Note, NoteTheme } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';

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
  if (!md.trim()) return '<span style="color:rgba(255,255,255,0.3);font-style:italic">No content</span>';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (text: string): string => {
    let s = esc(text);
    s = s.replace(/`([^`]+)`/g, `<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;font-size:11px;font-family:monospace;color:${accentColor}">$1</code>`);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:rgba(255,255,255,0.9);font-weight:600">$1</strong>');
    s = s.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/~~(.+?)~~/g, '<del style="text-decoration:line-through;color:rgba(255,255,255,0.4)">$1</del>');
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
      parts.push(`<pre style="background:rgba(255,255,255,0.06);border-radius:6px;padding:8px;margin:4px 0;font-size:11px;font-family:monospace;color:rgba(255,255,255,0.7);white-space:pre;overflow-x:auto">${cl.join('\n')}</pre>`);
      i = j + 1; continue;
    }
    if (/^(---+|___+|\*\*\*+)$/.test(line.trim())) { parts.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:8px 0" />'); i++; continue; }
    const h3 = line.match(/^### (.+)/); if (h3) { parts.push(`<div style="font-size:14px;font-weight:600;color:rgba(255,255,255,0.9);margin:8px 0 2px">${inline(h3[1])}</div>`); i++; continue; }
    const h2 = line.match(/^## (.+)/); if (h2) { parts.push(`<div style="font-size:17px;font-weight:600;color:rgba(255,255,255,0.9);margin:8px 0 2px">${inline(h2[1])}</div>`); i++; continue; }
    const h1 = line.match(/^# (.+)/); if (h1) { parts.push(`<div style="font-size:22px;font-weight:700;color:rgba(255,255,255,0.95);margin:6px 0 4px">${inline(h1[1])}</div>`); i++; continue; }
    const ck = line.match(/^- \[([ x])\]\s*(.*)/);
    if (ck) {
      const done = ck[1] === 'x';
      parts.push(`<div style="display:flex;align-items:flex-start;gap:8px;padding:2px 0"><span style="border:2px solid ${done ? accentColor : accentColor + '60'};${done ? 'background:' + accentColor + '30;' : ''}border-radius:3px;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0;margin-top:2px;color:${accentColor}">${done ? '✓' : ''}</span><span style="font-size:13px;${done ? 'color:rgba(255,255,255,0.35);text-decoration:line-through' : 'color:rgba(255,255,255,0.7)'}">${inline(ck[2])}</span></div>`);
      i++; continue;
    }
    const ul = line.match(/^[-*+]\s+(.+)/);
    if (ul) { parts.push(`<div style="display:flex;align-items:flex-start;gap:6px;padding:1px 0 1px 3px"><span style="margin-top:7px;width:5px;height:5px;border-radius:50%;background:${accentColor};flex-shrink:0"></span><span style="font-size:13px;color:rgba(255,255,255,0.7)">${inline(ul[1])}</span></div>`); i++; continue; }
    const ol = line.match(/^(\d+)\.\s+(.+)/);
    if (ol) { parts.push(`<div style="display:flex;align-items:flex-start;gap:6px;padding:1px 0 1px 2px"><span style="color:rgba(255,255,255,0.4);font-size:13px;min-width:14px;text-align:right">${ol[1]}.</span><span style="font-size:13px;color:rgba(255,255,255,0.7)">${inline(ol[2])}</span></div>`); i++; continue; }
    const bq = line.match(/^>\s*(.*)/);
    if (bq) { parts.push(`<div style="border-left:3px solid ${accentColor}50;padding-left:10px;padding:2px 0 2px 10px;margin:2px 0"><span style="font-size:13px;color:rgba(255,255,255,0.5);font-style:italic">${inline(bq[1])}</span></div>`); i++; continue; }
    if (!line.trim()) { parts.push('<div style="height:8px"></div>'); i++; continue; }
    parts.push(`<p style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.6;margin:0">${inline(line)}</p>`);
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
    window.electron.openNotesWindow('search');
    onClose();
  }, [onClose]);

  const handleNewNote = useCallback(() => {
    window.electron.openNotesWindow('create');
    onClose();
  }, [onClose]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleNewNote(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, notes.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && selectedNote) { e.preventDefault(); handleOpenNote(selectedNote); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [notes, selectedIndex, selectedNote, onClose, handleNewNote, handleOpenNote]);

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
                  <div className="flex items-start gap-2">
                    <div className="text-white/40 flex-shrink-0 mt-0.5">
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white/80 text-[13px] truncate font-medium leading-tight">
                          {note.title || 'Untitled'}
                        </span>
                        {note.pinned && (
                          <Pin className="w-3 h-3 text-amber-300/80 flex-shrink-0" />
                        )}
                      </div>
                      <div className="text-white/30 text-[11px] truncate mt-0.5 leading-tight">
                        {note.content.split('\n')[0] || 'No content'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Preview (60%) */}
        <div className="flex-1 flex flex-col min-h-0">
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
          label: 'New Note',
          onClick: handleNewNote,
          shortcut: ['⌘', 'N'],
        }}
      />
    </div>
  );
};

export default NotesSearchInline;
