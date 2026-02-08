/**
 * Snippet Manager UI
 *
 * Features:
 * - Search view: 40/60 split (list/preview)
 * - Create/Edit view: form with placeholder insertion
 * - Actions overlay styled like ClipboardManager
 * - Matches settings window theme
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, ArrowLeft, Plus, Trash2, Copy, Clipboard, Edit3, FileText } from 'lucide-react';
import type { Snippet } from '../types/electron';

interface SnippetManagerProps {
  onClose: () => void;
  initialView: 'search' | 'create';
}

interface Action {
  title: string;
  icon?: React.ReactNode;
  shortcut?: string;
  execute: () => void | Promise<void>;
  style?: 'default' | 'destructive';
}

// ─── Placeholder helpers ────────────────────────────────────────────

const PLACEHOLDERS = [
  { label: '{clipboard}', value: '{clipboard}' },
  { label: '{date}', value: '{date}' },
  { label: '{time}', value: '{time}' },
  { label: '{date:YYYY-MM-DD}', value: '{date:YYYY-MM-DD}' },
  { label: '{random:UUID}', value: '{random:UUID}' },
];

// ─── Create / Edit Form ─────────────────────────────────────────────

interface SnippetFormProps {
  snippet?: Snippet;
  onSave: (data: { name: string; content: string; keyword?: string }) => void;
  onCancel: () => void;
}

const SnippetForm: React.FC<SnippetFormProps> = ({ snippet, onSave, onCancel }) => {
  const [name, setName] = useState(snippet?.name || '');
  const [content, setContent] = useState(snippet?.content || '');
  const [keyword, setKeyword] = useState(snippet?.keyword || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const insertPlaceholder = (placeholder: string) => {
    const textarea = contentRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newContent = content.slice(0, start) + placeholder + content.slice(end);
    setContent(newContent);

    // Restore cursor after the inserted placeholder
    requestAnimationFrame(() => {
      textarea.focus();
      const newPos = start + placeholder.length;
      textarea.setSelectionRange(newPos, newPos);
    });
  };

  const handleSave = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (!content.trim()) newErrors.content = 'Snippet content is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave({
      name: name.trim(),
      content,
      keyword: keyword.trim() || undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="w-full h-full flex flex-col" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06]">
        <button
          onClick={onCancel}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-white/90 text-[15px] font-light">
          {snippet ? 'Edit Snippet' : 'Create Snippet'}
        </span>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5">
        {/* Name */}
        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">
            Name
          </label>
          <div className="flex-1">
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: '' })); }}
              placeholder="Snippet name"
              className="w-full bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 text-sm placeholder-white/30 outline-none focus:border-white/20 transition-colors"
            />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
          </div>
        </div>

        {/* Snippet Content */}
        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">
            Snippet
          </label>
          <div className="flex-1">
            <textarea
              ref={contentRef}
              value={content}
              onChange={(e) => { setContent(e.target.value); setErrors((p) => ({ ...p, content: '' })); }}
              placeholder="Type your snippet content here...&#10;Use {clipboard}, {date}, {time} for dynamic values"
              rows={8}
              className="w-full bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 text-sm placeholder-white/30 outline-none focus:border-white/20 transition-colors font-mono resize-y leading-relaxed"
            />
            {errors.content && <p className="text-red-400 text-xs mt-1">{errors.content}</p>}

            {/* Placeholder buttons */}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-white/30 text-xs mr-1">Insert:</span>
              {PLACEHOLDERS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => insertPlaceholder(p.value)}
                  className="px-2 py-1 text-[11px] rounded bg-white/[0.06] text-white/50 hover:bg-white/[0.10] hover:text-white/70 transition-colors font-mono"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-white/25 text-xs mt-2">
              Include <strong className="text-white/40">{'{Dynamic Placeholders}'}</strong> for context like the copied text or the current date
            </p>
          </div>
        </div>

        {/* Keyword */}
        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">
            Keyword
          </label>
          <div className="flex-1">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Optional keyword"
              className="w-full bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-white/90 text-sm placeholder-white/30 outline-none focus:border-white/20 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center px-4 py-3.5 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
        <div className="flex items-center gap-2 text-white/40 text-xs flex-1 min-w-0 font-medium">
          <span className="truncate">{snippet ? 'Edit Snippet' : 'Create Snippet'}</span>
        </div>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
        >
          <span className="text-white text-xs font-semibold">Save Snippet</span>
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd>
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">↩</kbd>
        </button>
      </div>
    </div>
  );
};

// ─── Snippet Manager ─────────────────────────────────────────────────

const SnippetManager: React.FC<SnippetManagerProps> = ({ onClose, initialView }) => {
  const [view, setView] = useState<'search' | 'create' | 'edit'>(initialView);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [filteredSnippets, setFilteredSnippets] = useState<Snippet[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | undefined>(undefined);
  const [frontmostAppName, setFrontmostAppName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const loadSnippets = useCallback(async () => {
    setIsLoading(true);
    try {
      const all = await window.electron.snippetGetAll();
      setSnippets(all);
    } catch (e) {
      console.error('Failed to load snippets:', e);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadSnippets();
    if (view === 'search') inputRef.current?.focus();
    window.electron.getLastFrontmostApp().then((app) => {
      if (app) setFrontmostAppName(app.name);
    });
  }, [loadSnippets, view]);

  useEffect(() => {
    let filtered = snippets;

    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      filtered = filtered.filter((s) =>
        s.name.toLowerCase().includes(lowerQuery) ||
        s.content.toLowerCase().includes(lowerQuery) ||
        (s.keyword && s.keyword.toLowerCase().includes(lowerQuery))
      );
    }

    setFilteredSnippets(filtered);
    setSelectedIndex(0);
  }, [snippets, searchQuery]);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, filteredSnippets.length);
  }, [filteredSnippets.length]);

  const scrollToSelected = useCallback(() => {
    const selectedElement = itemRefs.current[selectedIndex];
    const scrollContainer = listRef.current;

    if (selectedElement && scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elementRect = selectedElement.getBoundingClientRect();

      if (elementRect.top < containerRect.top) {
        selectedElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (elementRect.bottom > containerRect.bottom) {
        selectedElement.scrollIntoView({ block: 'end', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  useEffect(() => {
    scrollToSelected();
  }, [selectedIndex, scrollToSelected]);

  const selectedSnippet = filteredSnippets[selectedIndex];

  // ─── Actions ────────────────────────────────────────────────────

  const handlePaste = async (snippet?: Snippet) => {
    const s = snippet || selectedSnippet;
    if (!s) return;
    try {
      await window.electron.snippetPaste(s.id);
    } catch (e) {
      console.error('Failed to paste snippet:', e);
    }
  };

  const handleCopy = async () => {
    if (!selectedSnippet) return;
    try {
      await window.electron.snippetCopyToClipboard(selectedSnippet.id);
    } catch (e) {
      console.error('Failed to copy snippet:', e);
    }
  };

  const handleEdit = () => {
    if (!selectedSnippet) return;
    setEditingSnippet(selectedSnippet);
    setView('edit');
  };

  const handleDelete = async (snippet?: Snippet) => {
    const s = snippet || selectedSnippet;
    if (!s) return;
    try {
      await window.electron.snippetDelete(s.id);
      await loadSnippets();
    } catch (e) {
      console.error('Failed to delete snippet:', e);
    }
  };

  const handleSave = async (data: { name: string; content: string; keyword?: string }) => {
    try {
      if (view === 'edit' && editingSnippet) {
        await window.electron.snippetUpdate(editingSnippet.id, data);
      } else {
        await window.electron.snippetCreate(data);
      }
      await loadSnippets();
      setEditingSnippet(undefined);
      setView('search');
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (e) {
      console.error('Failed to save snippet:', e);
    }
  };

  const pasteLabel = frontmostAppName ? `Paste in ${frontmostAppName}` : 'Paste';

  const actions: Action[] = [
    {
      title: pasteLabel,
      execute: () => handlePaste(),
    },
    {
      title: 'Copy to Clipboard',
      execute: handleCopy,
    },
    {
      title: 'Edit',
      execute: handleEdit,
    },
    {
      title: 'Delete',
      execute: () => handleDelete(),
      style: 'destructive',
    },
  ];

  // ─── Keyboard ───────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'k' && e.metaKey && !e.repeat) {
        e.preventDefault();
        setShowActions((p) => !p);
        return;
      }

      if (showActions) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredSnippets.length - 1 ? prev + 1 : prev
          );
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;

        case 'Enter':
          e.preventDefault();
          if (!e.repeat && filteredSnippets[selectedIndex]) {
            handlePaste();
          }
          break;

        case 'Backspace':
        case 'Delete':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (filteredSnippets[selectedIndex]) {
              handleDelete();
            }
          }
          break;

        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filteredSnippets, selectedIndex, onClose, showActions]
  );

  // ─── Render: Create / Edit ──────────────────────────────────────

  if (view === 'create' || view === 'edit') {
    return (
      <SnippetForm
        snippet={view === 'edit' ? editingSnippet : undefined}
        onSave={handleSave}
        onCancel={() => {
          setEditingSnippet(undefined);
          setView('search');
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
      />
    );
  }

  // ─── Render: Search ─────────────────────────────────────────────

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="w-full h-full flex flex-col" onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06]">
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search snippets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-[15px] font-light tracking-wide"
          autoFocus
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => setView('create')}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          title="Create Snippet"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Left: List (40%) */}
        <div
          ref={listRef}
          className="w-[40%] overflow-y-auto custom-scrollbar border-r border-white/[0.06]"
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Loading snippets...</p>
            </div>
          ) : filteredSnippets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/50 gap-3">
              <p className="text-sm">
                {searchQuery ? 'No snippets found' : 'No snippets yet'}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => setView('create')}
                  className="px-3 py-1.5 text-xs rounded-lg bg-white/[0.08] text-white/60 hover:bg-white/[0.12] hover:text-white/80 transition-colors"
                >
                  Create your first snippet
                </button>
              )}
            </div>
          ) : (
            <div className="p-2.5 space-y-1.5">
              {filteredSnippets.map((snippet, index) => (
                <div
                  key={snippet.id}
                  ref={(el) => (itemRefs.current[index] = el)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? 'bg-white/10'
                      : 'hover:bg-white/5'
                  }`}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => handlePaste(snippet)}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="text-white/40 flex-shrink-0 mt-0.5">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white/80 text-sm truncate font-medium">
                          {snippet.name}
                        </span>
                        {snippet.keyword && (
                          <code className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.08] text-white/40 flex-shrink-0">
                            {snippet.keyword}
                          </code>
                        )}
                      </div>
                      <div className="text-white/30 text-xs truncate mt-0.5">
                        {snippet.content.split('\n')[0]}
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
          {selectedSnippet ? (
            <div className="p-5">
              <div className="mb-4">
                <h3 className="text-white/90 text-base font-medium">
                  {selectedSnippet.name}
                </h3>
                {selectedSnippet.keyword && (
                  <div className="mt-2">
                    <code className="text-xs px-2 py-1 rounded bg-white/[0.08] text-white/50">
                      {selectedSnippet.keyword}
                    </code>
                  </div>
                )}
              </div>

              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <pre className="text-white/80 text-sm whitespace-pre-wrap break-words font-mono leading-relaxed">
                  {selectedSnippet.content}
                </pre>
              </div>

              <div className="mt-4 space-y-1">
                <div className="text-white/30 text-xs">
                  Created {formatDate(selectedSnippet.createdAt)}
                </div>
                {selectedSnippet.updatedAt !== selectedSnippet.createdAt && (
                  <div className="text-white/30 text-xs">
                    Updated {formatDate(selectedSnippet.updatedAt)}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Select a snippet to preview</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center px-4 py-3.5 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
        <div className="flex items-center gap-2 text-white/40 text-xs flex-1 min-w-0 font-medium">
          <span className="truncate">{filteredSnippets.length} snippets</span>
        </div>
        {selectedSnippet && (
          <div className="flex items-center gap-2 mr-3">
            <span className="text-white text-xs font-semibold truncate max-w-[200px]">{pasteLabel}</span>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">↩</kbd>
          </div>
        )}
        <button
          onClick={() => setShowActions(true)}
          className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors"
        >
          <span className="text-xs font-medium">Actions</span>
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd>
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">K</kbd>
        </button>
      </div>

      {/* Actions Overlay */}
      {showActions && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setShowActions(false)}
          style={{ background: 'rgba(0,0,0,0.15)' }}
        >
          <div
            className="absolute bottom-12 right-3 w-80 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl"
            style={{
              background: 'rgba(30,30,34,0.97)',
              backdropFilter: 'blur(40px)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto py-1">
              {actions.map((action, idx) => (
                <div
                  key={idx}
                  className={`mx-1 px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 cursor-pointer transition-colors ${
                    action.style === 'destructive'
                      ? 'hover:bg-white/[0.06] text-red-400'
                      : 'hover:bg-white/[0.06] text-white/80'
                  }`}
                  onClick={() => {
                    action.execute();
                    setShowActions(false);
                  }}
                >
                  <span className="flex-1 text-sm truncate">
                    {action.title}
                  </span>
                  {idx === 0 && (
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] font-medium text-white/70">
                      ↩
                    </kbd>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SnippetManager;
