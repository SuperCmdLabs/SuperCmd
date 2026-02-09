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
import { createPortal } from 'react-dom';
import { Search, X, ArrowLeft, Plus, FileText, Pin, PinOff, Pencil, Copy, Clipboard, Trash2, Files } from 'lucide-react';
import type { Snippet, SnippetDynamicField } from '../types/electron';

interface SnippetManagerProps {
  onClose: () => void;
  initialView: 'search' | 'create';
}

interface Action {
  title: string;
  icon?: React.ReactNode;
  shortcut?: string[];
  execute: () => void | Promise<void>;
  style?: 'default' | 'destructive';
}

function parseArgumentPlaceholderToken(rawToken: string): { key: string; name: string; defaultValue?: string } | null {
  const token = rawToken.trim();
  if (!token.startsWith('argument')) return null;
  const nameMatch = token.match(/name\s*=\s*"([^"]+)"/i);
  const defaultMatch = token.match(/default\s*=\s*"([^"]*)"/i);
  const fallbackNameMatch = token.match(/^argument(?::|\s+)(.+)$/i);
  const name = (nameMatch?.[1] || fallbackNameMatch?.[1] || '').trim();
  if (!name) return null;
  return { key: name.toLowerCase(), name, defaultValue: defaultMatch?.[1] };
}

function renderSnippetPreviewWithHighlights(content: string, values: Record<string, string>): React.ReactNode {
  const parts = content.split(/(\{[^}]+\})/g);
  return parts.map((part, idx) => {
    const tokenMatch = part.match(/^\{([^}]+)\}$/);
    if (!tokenMatch) return <span key={idx}>{part}</span>;
    const arg = parseArgumentPlaceholderToken(tokenMatch[1]);
    if (!arg) return <span key={idx}>{part}</span>;
    const value = values[arg.key] || values[arg.name] || arg.defaultValue || '';
    return (
      <span key={idx} className="text-emerald-300 font-medium">
        {value}
      </span>
    );
  });
}

// ─── Placeholder helpers ────────────────────────────────────────────

const PLACEHOLDER_GROUPS = [
  {
    title: 'Snippets',
    items: [
      { label: 'Cursor Position', value: '{cursor-position}' },
      { label: 'Clipboard Text', value: '{clipboard}' },
      { label: 'Argument', value: '{argument name="Argument"}' },
      { label: 'UUID', value: '{random:UUID}' },
    ],
  },
  {
    title: 'Date & Time',
    items: [
      { label: 'Time', value: '{time}' },
      { label: 'Date', value: '{date}' },
      { label: 'Date & Time', value: '{date:YYYY-MM-DD} {time:HH:mm}' },
      { label: 'Custom Date', value: '{date:YYYY-MM-DD}' },
    ],
  },
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
  const [showPlaceholderMenu, setShowPlaceholderMenu] = useState(false);
  const [placeholderQuery, setPlaceholderQuery] = useState('');
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const placeholderButtonRef = useRef<HTMLButtonElement>(null);
  const [placeholderMenuPos, setPlaceholderMenuPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 300,
  });

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const refreshPlaceholderMenuPos = useCallback(() => {
    const rect = placeholderButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPlaceholderMenuPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: Math.max(300, rect.width + 120),
    });
  }, []);

  useEffect(() => {
    if (!showPlaceholderMenu) return;
    refreshPlaceholderMenuPos();
    const onResize = () => refreshPlaceholderMenuPos();
    const onScroll = () => refreshPlaceholderMenuPos();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [showPlaceholderMenu, refreshPlaceholderMenuPos]);

  useEffect(() => {
    if (!showPlaceholderMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const menuEl = document.getElementById('snippet-placeholder-menu');
      if (menuEl?.contains(target)) return;
      if (placeholderButtonRef.current?.contains(target)) return;
      setShowPlaceholderMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [showPlaceholderMenu]);

  const filteredPlaceholderGroups = PLACEHOLDER_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      !placeholderQuery.trim()
        ? true
        : item.label.toLowerCase().includes(placeholderQuery.trim().toLowerCase()) ||
          item.value.toLowerCase().includes(placeholderQuery.trim().toLowerCase())
    ),
  })).filter((group) => group.items.length > 0);

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

            {/* Placeholder dropdown */}
            <div className="relative mt-2">
              <button
                ref={placeholderButtonRef}
                type="button"
                onClick={() => {
                  refreshPlaceholderMenuPos();
                  setShowPlaceholderMenu((p) => !p);
                }}
                className="px-2.5 py-1.5 text-xs rounded-md bg-white/[0.06] text-white/65 hover:bg-white/[0.1] hover:text-white/80 transition-colors"
              >
                Insert Dynamic Value
              </button>
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
            <p className="text-white/25 text-xs mt-2">
              Typing this keyword in the snippet search instantly targets this snippet for replacement.
            </p>
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

      {showPlaceholderMenu && createPortal(
        <div
          id="snippet-placeholder-menu"
          className="fixed z-[80] rounded-lg overflow-hidden border border-white/[0.08]"
          style={{
            top: placeholderMenuPos.top,
            left: placeholderMenuPos.left,
            width: placeholderMenuPos.width,
            background: 'rgba(26,26,30,0.96)',
            backdropFilter: 'blur(18px)',
          }}
        >
          <div className="px-2 py-2 border-b border-white/[0.08]">
            <input
              type="text"
              value={placeholderQuery}
              onChange={(e) => setPlaceholderQuery(e.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent text-sm text-white/75 placeholder-white/30 outline-none"
              autoFocus
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto py-1">
            {filteredPlaceholderGroups.map((group) => (
              <div key={group.title} className="mb-1">
                <div className="px-2.5 py-1 text-[11px] uppercase tracking-wider text-white/30">{group.title}</div>
                {group.items.map((item) => (
                  <button
                    key={`${group.title}-${item.value}`}
                    type="button"
                    onClick={() => {
                      insertPlaceholder(item.value);
                      setShowPlaceholderMenu(false);
                      setPlaceholderQuery('');
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-sm text-white/80 hover:bg-white/[0.07] transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
            {filteredPlaceholderGroups.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-white/35">No dynamic values</div>
            ) : null}
          </div>
        </div>,
        document.body
      )}
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
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | undefined>(undefined);
  const [frontmostAppName, setFrontmostAppName] = useState<string | null>(null);
  const [dynamicPrompt, setDynamicPrompt] = useState<{
    snippet: Snippet;
    mode: 'paste' | 'copy';
    fields: SnippetDynamicField[];
    values: Record<string, string>;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstDynamicInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!showActions) {
      setSelectedActionIndex(0);
    }
  }, [showActions]);

  useEffect(() => {
    if (!dynamicPrompt) return;
    const t = setTimeout(() => firstDynamicInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [dynamicPrompt?.snippet.id, dynamicPrompt?.mode]);

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
  const exactKeywordSnippet = searchQuery.trim()
    ? snippets.find((s) => (s.keyword || '').trim().toLowerCase() === searchQuery.trim().toLowerCase())
    : undefined;
  const activeSnippet = exactKeywordSnippet || selectedSnippet;

  // ─── Actions ────────────────────────────────────────────────────

  const handlePaste = async (snippet?: Snippet) => {
    const s = snippet || activeSnippet;
    if (!s) return;
    try {
      const fields = await window.electron.snippetGetDynamicFields(s.id);
      if (fields.length > 0) {
        const initialValues: Record<string, string> = {};
        for (const field of fields) {
          initialValues[field.key] = field.defaultValue || '';
        }
        setDynamicPrompt({ snippet: s, mode: 'paste', fields, values: initialValues });
        return;
      }
      await window.electron.snippetPaste(s.id);
    } catch (e) {
      console.error('Failed to paste snippet:', e);
    }
  };

  const handleCopy = async () => {
    if (!activeSnippet) return;
    try {
      const fields = await window.electron.snippetGetDynamicFields(activeSnippet.id);
      if (fields.length > 0) {
        const initialValues: Record<string, string> = {};
        for (const field of fields) {
          initialValues[field.key] = field.defaultValue || '';
        }
        setDynamicPrompt({ snippet: activeSnippet, mode: 'copy', fields, values: initialValues });
        return;
      }
      await window.electron.snippetCopyToClipboard(activeSnippet.id);
    } catch (e) {
      console.error('Failed to copy snippet:', e);
    }
  };

  const handleEdit = () => {
    if (!activeSnippet) return;
    setEditingSnippet(activeSnippet);
    setView('edit');
  };

  const handleDelete = async (snippet?: Snippet) => {
    const s = snippet || activeSnippet;
    if (!s) return;
    try {
      await window.electron.snippetDelete(s.id);
      await loadSnippets();
    } catch (e) {
      console.error('Failed to delete snippet:', e);
    }
  };

  const handleDeleteAll = async () => {
    try {
      await window.electron.snippetDeleteAll();
      await loadSnippets();
      setSearchQuery('');
    } catch (e) {
      console.error('Failed to delete all snippets:', e);
    }
  };

  const handleDuplicate = async () => {
    if (!activeSnippet) return;
    try {
      await window.electron.snippetDuplicate(activeSnippet.id);
      await loadSnippets();
    } catch (e) {
      console.error('Failed to duplicate snippet:', e);
    }
  };

  const handleTogglePin = async () => {
    if (!activeSnippet) return;
    try {
      await window.electron.snippetTogglePin(activeSnippet.id);
      await loadSnippets();
    } catch (e) {
      console.error('Failed to toggle pin snippet:', e);
    }
  };

  const handleConfirmDynamicPrompt = async () => {
    if (!dynamicPrompt) return;
    try {
      if (dynamicPrompt.mode === 'paste') {
        await window.electron.snippetPasteResolved(dynamicPrompt.snippet.id, dynamicPrompt.values);
      } else {
        await window.electron.snippetCopyToClipboardResolved(dynamicPrompt.snippet.id, dynamicPrompt.values);
      }
      setDynamicPrompt(null);
    } catch (e) {
      console.error('Failed to resolve snippet dynamic values:', e);
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
      icon: <Clipboard className="w-4 h-4" />,
      shortcut: ['↩'],
      execute: () => handlePaste(),
    },
    {
      title: 'Copy to Clipboard',
      icon: <Copy className="w-4 h-4" />,
      shortcut: ['⌘', '↩'],
      execute: handleCopy,
    },
    {
      title: activeSnippet?.pinned ? 'Unpin Snippet' : 'Pin Snippet',
      icon: activeSnippet?.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />,
      shortcut: ['⇧', '⌘', 'P'],
      execute: handleTogglePin,
    },
    {
      title: 'Edit Snippet',
      icon: <Pencil className="w-4 h-4" />,
      shortcut: ['⌘', 'E'],
      execute: handleEdit,
    },
    {
      title: 'Duplicate Snippet',
      icon: <Files className="w-4 h-4" />,
      shortcut: ['⌘', 'D'],
      execute: handleDuplicate,
    },
    {
      title: 'Export Snippets',
      shortcut: ['⇧', '⌘', 'S'],
      execute: async () => {
        await window.electron.snippetExport();
      },
    },
    {
      title: 'Import Snippets',
      shortcut: ['⇧', '⌘', 'I'],
      execute: async () => {
        await window.electron.snippetImport();
        await loadSnippets();
      },
    },
    {
      title: 'Delete Snippet',
      icon: <Trash2 className="w-4 h-4" />,
      shortcut: ['⌃', 'X'],
      execute: () => handleDelete(),
      style: 'destructive',
    },
    {
      title: 'Delete All Snippets',
      icon: <Trash2 className="w-4 h-4" />,
      shortcut: ['⌃', '⇧', 'X'],
      execute: handleDeleteAll,
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

      if (dynamicPrompt) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setDynamicPrompt(null);
        } else if (e.key === 'Enter' && e.metaKey) {
          e.preventDefault();
          handleConfirmDynamicPrompt();
        }
        return;
      }

      if (showActions) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedActionIndex((prev) => (prev < actions.length - 1 ? prev + 1 : prev));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedActionIndex((prev) => (prev > 0 ? prev - 1 : 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const action = actions[selectedActionIndex];
          if (action) action.execute();
          setShowActions(false);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowActions(false);
          return;
        }
      }

      if (e.key.toLowerCase() === 'e' && e.metaKey) {
        e.preventDefault();
        handleEdit();
        return;
      }
      if (e.key.toLowerCase() === 'd' && e.metaKey) {
        e.preventDefault();
        handleDuplicate();
        return;
      }
      if (e.key.toLowerCase() === 'p' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        handleTogglePin();
        return;
      }
      if (e.key.toLowerCase() === 's' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        window.electron.snippetExport();
        return;
      }
      if (e.key.toLowerCase() === 'i' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        window.electron.snippetImport().then(() => loadSnippets());
        return;
      }
      if (e.key.toLowerCase() === 'x' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        handleDeleteAll();
        return;
      }
      if (e.key.toLowerCase() === 'x' && e.ctrlKey) {
        e.preventDefault();
        handleDelete();
        return;
      }
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault();
        handleCopy();
        return;
      }

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
          if (!e.repeat && activeSnippet) {
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
    [showActions, selectedActionIndex, actions, filteredSnippets, selectedIndex, onClose, dynamicPrompt, activeSnippet, loadSnippets]
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
                        {snippet.pinned ? (
                          <Pin className="w-3 h-3 text-amber-300/80 flex-shrink-0" />
                        ) : null}
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
        {activeSnippet && (
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

      {dynamicPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }}>
          <div
            className="w-[520px] max-w-[92vw] rounded-xl border border-white/[0.1] overflow-hidden"
            style={{ background: 'rgba(24,24,28,0.96)', backdropFilter: 'blur(28px)' }}
          >
            <div className="px-4 py-3 border-b border-white/[0.08] text-white/85 text-sm font-medium">
              Fill Dynamic Values
            </div>
            <div className="p-4 space-y-3">
              {dynamicPrompt.fields.map((field, idx) => (
                <div key={field.key}>
                  <label className="block text-xs text-white/45 mb-1.5">{field.name}</label>
                  <input
                    ref={idx === 0 ? firstDynamicInputRef : undefined}
                    type="text"
                    value={dynamicPrompt.values[field.key] || ''}
                    onChange={(e) =>
                      setDynamicPrompt((prev) =>
                        prev
                          ? {
                              ...prev,
                              values: { ...prev.values, [field.key]: e.target.value },
                            }
                          : prev
                      )
                    }
                    placeholder={field.defaultValue || ''}
                    className="w-full bg-white/[0.06] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white/85 placeholder-white/30 outline-none focus:border-white/25"
                  />
                </div>
              ))}
              <div className="pt-2">
                <div className="text-[11px] uppercase tracking-wider text-white/35 mb-1.5">Preview</div>
                <div className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-white/85 whitespace-pre-wrap break-words font-mono">
                  {renderSnippetPreviewWithHighlights(
                    dynamicPrompt.snippet.content,
                    dynamicPrompt.values
                  )}
                </div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-white/[0.08] flex items-center justify-end gap-2">
              <button
                onClick={() => setDynamicPrompt(null)}
                className="px-3 py-1.5 rounded-md text-xs text-white/60 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDynamicPrompt}
                className="px-3 py-1.5 rounded-md text-xs text-white bg-white/[0.12] hover:bg-white/[0.18] transition-colors"
              >
                {dynamicPrompt.mode === 'paste' ? 'Paste' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                    idx === selectedActionIndex ? 'bg-white/[0.08]' : ''
                  } ${
                    action.style === 'destructive'
                      ? 'hover:bg-white/[0.06] text-red-400'
                      : 'hover:bg-white/[0.06] text-white/80'
                  }`}
                  onMouseMove={() => setSelectedActionIndex(idx)}
                  onClick={() => {
                    action.execute();
                    setShowActions(false);
                  }}
                >
                  {action.icon ? (
                    <span className={action.style === 'destructive' ? 'text-red-400' : 'text-white/60'}>
                      {action.icon}
                    </span>
                  ) : null}
                  <span className="flex-1 text-sm truncate">
                    {action.title}
                  </span>
                  {action.shortcut ? (
                    <span className="flex items-center gap-0.5">
                      {action.shortcut.map((k, keyIdx) => (
                        <kbd
                          key={`${idx}-${keyIdx}`}
                          className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] font-medium text-white/70"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  ) : null}
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
