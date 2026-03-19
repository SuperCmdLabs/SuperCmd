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
    <div className="flex flex-col h-full">
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
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {selectedNote ? (
            <div className="p-5">
              <pre className="text-white/80 text-sm whitespace-pre-wrap break-words font-mono leading-relaxed">
                {selectedNote.content || 'No content'}
              </pre>

              <div className="mt-4 pt-3 border-t border-[var(--snippet-divider)] space-y-1.5">
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
            </div>
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
