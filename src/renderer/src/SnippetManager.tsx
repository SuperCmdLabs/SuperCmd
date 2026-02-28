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
import { Search, X, ArrowLeft, Plus, FileText, Pin, PinOff, Pencil, Copy, Clipboard, Trash2, Files, TextCursorInput, Variable, Hash, Clock, Calendar, CalendarClock } from 'lucide-react';
import type { Snippet, SnippetDynamicField } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';
import { useInlineArgumentAnchor } from './hooks/useInlineArgumentAnchor';
import InlineArgumentField, { InlineArgumentOverflowBadge } from './components/InlineArgumentField';

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

const INVALID_SNIPPET_KEYWORD_CHARS = /["'`]/;
const MAX_INLINE_SNIPPET_ARGUMENTS = 3;

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

function extractSnippetArgumentFields(content: string): SnippetDynamicField[] {
  const fields = new Map<string, SnippetDynamicField>();
  const re = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(content)) !== null) {
    const parsed = parseArgumentPlaceholderToken(match[1]);
    if (!parsed) continue;
    if (!fields.has(parsed.key)) {
      fields.set(parsed.key, {
        key: parsed.key,
        name: parsed.name,
        defaultValue: parsed.defaultValue,
      });
    }
  }
  return Array.from(fields.values());
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
      { label: 'Cursor Position', value: '{cursor-position}', icon: TextCursorInput },
      { label: 'Clipboard Text', value: '{clipboard}', icon: Clipboard },
      { label: 'Argument', value: '{argument name="Argument"}', icon: Variable },
      { label: 'UUID', value: '{random:UUID}', icon: Hash },
    ],
  },
  {
    title: 'Date & Time',
    items: [
      { label: 'Time', value: '{time}', icon: Clock },
      { label: 'Date', value: '{date}', icon: Calendar },
      { label: 'Date & Time', value: '{date:YYYY-MM-DD} {time:HH:mm}', icon: CalendarClock },
      { label: 'Custom Date', value: '{date:YYYY-MM-DD}', icon: Calendar },
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
  const [placeholderMenuPos, setPlaceholderMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 0,
    width: 260,
    maxHeight: 220,
  });

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const refreshPlaceholderMenuPos = useCallback(() => {
    const rect = placeholderButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 10;
    const desiredWidth = 260;
    const estimatedMenuHeight = 220;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < 260 && spaceAbove > 120;
    const top = openAbove ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - 8) : rect.bottom + 8;
    const maxHeight = Math.max(120, Math.floor((openAbove ? spaceAbove : spaceBelow) - 12));
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - desiredWidth - viewportPadding)
    );
    setPlaceholderMenuPos({
      top,
      left,
      width: desiredWidth,
      maxHeight,
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
    const trimmedKeyword = keyword.trim();
    if (trimmedKeyword && INVALID_SNIPPET_KEYWORD_CHARS.test(trimmedKeyword)) {
      newErrors.keyword = 'Keyword cannot include ", \', or `';
    }

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
    <div className="snippet-view w-full h-full flex flex-col" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="snippet-header flex items-center gap-3 px-5 py-3.5">
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
              className="w-full bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-white/90 text-[13px] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)] transition-colors"
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
              rows={6}
              className="w-full bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-white/90 text-[13px] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)] transition-colors font-mono resize-y leading-relaxed"
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
                className="px-2.5 py-1.5 text-[11px] rounded-md border border-[rgba(124,136,154,0.24)] bg-white/[0.04] text-[var(--text-secondary)] hover:bg-white/[0.08] transition-colors"
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
              onChange={(e) => {
                setKeyword(e.target.value);
                setErrors((p) => ({ ...p, keyword: '' }));
              }}
              placeholder="Optional keyword"
              className="w-full bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-white/90 text-[13px] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)] transition-colors"
            />
            {errors.keyword && <p className="text-red-400 text-xs mt-1">{errors.keyword}</p>}
            <p className="text-white/25 text-xs mt-2">
              Typing this keyword in the snippet search instantly targets this snippet for replacement.
              <br />
              Disallowed characters: ", ', `
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="sc-glass-footer flex items-center px-4 py-2.5">
        <div className="flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-normal">
          <span className="truncate">{snippet ? 'Edit Snippet' : 'Create Snippet'}</span>
        </div>
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 text-[var(--text-primary)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
        >
          <span className="text-xs font-normal">Save Snippet</span>
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">⌘</kbd>
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">↩</kbd>
        </button>
      </div>

      {showPlaceholderMenu && createPortal(
        <div
          id="snippet-placeholder-menu"
          className="fixed z-[120] rounded-lg overflow-hidden border border-[rgba(124,136,154,0.24)]"
          style={{
            top: placeholderMenuPos.top,
            left: placeholderMenuPos.left,
            width: placeholderMenuPos.width,
            background: 'var(--bg-overlay-strong)',
            backdropFilter: 'blur(18px)',
            boxShadow: '0 12px 28px rgba(var(--backdrop-rgb), 0.45)',
          }}
        >
          <div className="px-2 py-1.5 border-b border-[rgba(124,136,154,0.24)]">
            <input
              type="text"
              value={placeholderQuery}
              onChange={(e) => setPlaceholderQuery(e.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent text-[13px] text-white/75 placeholder:text-[color:var(--text-subtle)] outline-none"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto py-1" style={{ maxHeight: placeholderMenuPos.maxHeight }}>
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
                    className="w-full text-left px-2.5 py-0.5 text-[13px] text-white/80 hover:bg-white/[0.07] transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      {item.icon ? <item.icon className="w-3.5 h-3.5 text-white/45" /> : null}
                      <span>{item.label}</span>
                    </span>
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
  const [inlineArgumentValuesBySnippetId, setInlineArgumentValuesBySnippetId] = useState<
    Record<string, Record<string, string>>
  >({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
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
  const inlineArgumentLaneRef = useRef<HTMLDivElement>(null);
  const inlineArgumentClusterRef = useRef<HTMLDivElement>(null);
  const inlineArgumentInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const firstDynamicInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass =
    document.documentElement.classList.contains('sc-native-liquid-glass') ||
    document.body.classList.contains('sc-native-liquid-glass');

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
  const selectedSnippetInlineValues = selectedSnippet
    ? inlineArgumentValuesBySnippetId[selectedSnippet.id] || {}
    : {};
  const activeSnippetDynamicFields = activeSnippet
    ? extractSnippetArgumentFields(activeSnippet.content)
    : [];
  const inlineActiveSnippetDynamicFields = activeSnippetDynamicFields.slice(0, MAX_INLINE_SNIPPET_ARGUMENTS);
  const hasInlineSnippetArguments = inlineActiveSnippetDynamicFields.length > 0;
  const activeSnippetHasOverflowFields = activeSnippetDynamicFields.length > inlineActiveSnippetDynamicFields.length;
  const activeInlineArgumentValues = activeSnippet
    ? inlineArgumentValuesBySnippetId[activeSnippet.id] || {}
    : {};
  const inlineArgumentStartPx = useInlineArgumentAnchor({
    enabled: hasInlineSnippetArguments,
    query: searchQuery,
    searchInputRef: inputRef,
    laneRef: inlineArgumentLaneRef,
    inlineRef: inlineArgumentClusterRef,
    minStartRatio: 0.26,
    gapPx: 8,
  });

  const getResolvedInlineArgumentValues = useCallback(
    (snippet: Snippet, fields: SnippetDynamicField[]) => {
      const values = inlineArgumentValuesBySnippetId[snippet.id] || {};
      return fields.reduce((acc, field) => {
        acc[field.key] = String(values[field.key] ?? field.defaultValue ?? '');
        return acc;
      }, {} as Record<string, string>);
    },
    [inlineArgumentValuesBySnippetId]
  );

  useEffect(() => {
    inlineArgumentInputRefs.current = inlineArgumentInputRefs.current.slice(0, inlineActiveSnippetDynamicFields.length);
  }, [inlineActiveSnippetDynamicFields.length]);

  useEffect(() => {
    if (!activeSnippet || activeSnippetDynamicFields.length === 0) return;
    setInlineArgumentValuesBySnippetId((prev) => {
      const previousValues = prev[activeSnippet.id] || {};
      let changed = !prev[activeSnippet.id];
      const nextValues = { ...previousValues };
      for (const field of activeSnippetDynamicFields) {
        if (nextValues[field.key] === undefined) {
          nextValues[field.key] = String(field.defaultValue || '');
          changed = true;
        }
      }
      if (!changed) return prev;
      return {
        ...prev,
        [activeSnippet.id]: nextValues,
      };
    });
  }, [activeSnippet, activeSnippetDynamicFields]);

  // ─── Actions ────────────────────────────────────────────────────

  const handlePaste = async (snippet?: Snippet) => {
    const s = snippet || activeSnippet;
    if (!s) return;
    try {
      const fields = extractSnippetArgumentFields(s.content);
      if (fields.length > 0) {
        const resolvedValues = getResolvedInlineArgumentValues(s, fields);
        if (fields.length <= MAX_INLINE_SNIPPET_ARGUMENTS) {
          await window.electron.snippetPasteResolved(s.id, resolvedValues);
          return;
        }
        setDynamicPrompt({ snippet: s, mode: 'paste', fields, values: resolvedValues });
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
      const fields = extractSnippetArgumentFields(activeSnippet.content);
      if (fields.length > 0) {
        const resolvedValues = getResolvedInlineArgumentValues(activeSnippet, fields);
        if (fields.length <= MAX_INLINE_SNIPPET_ARGUMENTS) {
          await window.electron.snippetCopyToClipboardResolved(activeSnippet.id, resolvedValues);
          return;
        }
        setDynamicPrompt({ snippet: activeSnippet, mode: 'copy', fields, values: resolvedValues });
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
      title: 'Create Snippet',
      icon: <Plus className="w-4 h-4" />,
      shortcut: ['⌘', 'N'],
      execute: () => setView('create'),
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
      icon: <Files className="w-4 h-4" />,
      shortcut: ['⇧', '⌘', 'S'],
      execute: async () => {
        await window.electron.snippetExport();
      },
    },
    {
      title: 'Import Snippets',
      icon: <Files className="w-4 h-4" />,
      shortcut: ['⇧', '⌘', 'I'],
      execute: async () => {
        const result = await window.electron.snippetImport();
        await loadSnippets();
        if (result.imported > 0 || result.skipped > 0) {
          setImportResult(result);
          setTimeout(() => setImportResult(null), 4000);
        }
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

  const isMetaEnter = (e: React.KeyboardEvent) =>
    e.metaKey &&
    (e.key === 'Enter' || e.key === 'Return' || e.code === 'Enter' || e.code === 'NumpadEnter');
  // ─── Keyboard ───────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'k' && e.metaKey && !e.repeat) {
        e.preventDefault();
        setShowActions((p) => !p);
        return;
      }

      if (dynamicPrompt) {
        const plainEnter =
          (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.shiftKey;
        if (e.key === 'Escape') {
          e.preventDefault();
          setDynamicPrompt(null);
        } else if (plainEnter || (e.key === 'Enter' && e.metaKey)) {
          e.preventDefault();
          handleConfirmDynamicPrompt();
        }
        return;
      }

      if (showActions) {
        if (isMetaEnter(e)) {
          e.preventDefault();
          void handleCopy();
          setShowActions(false);
          return;
        }
        if (e.key.toLowerCase() === 'x' && e.ctrlKey && e.shiftKey) {
          e.preventDefault();
          void handleDeleteAll();
          setShowActions(false);
          return;
        }
        if (e.key.toLowerCase() === 'x' && e.ctrlKey) {
          e.preventDefault();
          void handleDelete();
          setShowActions(false);
          return;
        }
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
      if (e.key.toLowerCase() === 'n' && e.metaKey) {
        e.preventDefault();
        setView('create');
        return;
      }
      if (e.key.toLowerCase() === 's' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        window.electron.snippetExport();
        return;
      }
      if (e.key.toLowerCase() === 'i' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        window.electron.snippetImport().then((result) => {
          loadSnippets();
          if (result.imported > 0 || result.skipped > 0) {
            setImportResult(result);
            setTimeout(() => setImportResult(null), 4000);
          }
        });
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
      if (isMetaEnter(e)) {
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
    <div className="snippet-view snippet-search-view w-full h-full flex flex-col" onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Header */}
      <div className="snippet-header flex h-16 items-center gap-2 px-4">
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div ref={inlineArgumentLaneRef} className="relative min-w-0 flex-1">
          <div className="flex h-full items-center">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search snippets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Tab' && hasInlineSnippetArguments) {
                  e.preventDefault();
                  const targetIndex = e.shiftKey ? inlineActiveSnippetDynamicFields.length - 1 : 0;
                  inlineArgumentInputRefs.current[targetIndex]?.focus();
                }
              }}
              className="min-w-0 w-full bg-transparent border-none outline-none text-white/95 placeholder:text-[color:var(--text-subtle)] text-[15px] font-medium tracking-[0.005em]"
              autoFocus
            />
          </div>
          {hasInlineSnippetArguments ? (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-x-hidden overflow-y-visible">
              <div
                ref={inlineArgumentClusterRef}
                className="pointer-events-auto inline-flex min-w-0 items-center gap-1.5"
                style={{ marginLeft: inlineArgumentStartPx != null ? `${inlineArgumentStartPx}px` : '30%' }}
              >
                {inlineActiveSnippetDynamicFields.map((field, index) => (
                  <InlineArgumentField
                    key={`snippet-inline-arg-${field.key}`}
                    inputRef={(el) => {
                      inlineArgumentInputRefs.current[index] = el;
                    }}
                    value={activeInlineArgumentValues[field.key] || ''}
                    onChange={(nextValue) => {
                      if (!activeSnippet) return;
                      setInlineArgumentValuesBySnippetId((prev) => ({
                        ...prev,
                        [activeSnippet.id]: {
                          ...(prev[activeSnippet.id] || {}),
                          [field.key]: nextValue,
                        },
                      }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab') {
                        e.preventDefault();
                        e.stopPropagation();
                        const total = inlineActiveSnippetDynamicFields.length;
                        const nextIndex = e.shiftKey ? index - 1 : index + 1;
                        if (nextIndex >= 0 && nextIndex < total) {
                          inlineArgumentInputRefs.current[nextIndex]?.focus();
                        } else {
                          inputRef.current?.focus();
                        }
                        return;
                      }
                      if (
                        (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') &&
                        !e.metaKey &&
                        !e.ctrlKey &&
                        !e.altKey &&
                        !e.shiftKey
                      ) {
                        e.preventDefault();
                        e.stopPropagation();
                        void handlePaste();
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        inputRef.current?.focus();
                        return;
                      }
                      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
                        e.stopPropagation();
                      }
                    }}
                    placeholder={field.defaultValue || field.name}
                  />
                ))}
                {activeSnippetHasOverflowFields ? (
                  <InlineArgumentOverflowBadge
                    count={activeSnippetDynamicFields.length - inlineActiveSnippetDynamicFields.length}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
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
            onClick={() => setView('create')}
            className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
            title="Create Snippet"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div className={`px-5 py-2 text-xs flex items-center gap-2 border-b ${
          importResult.imported > 0
            ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
            : 'text-amber-300 bg-amber-500/10 border-amber-500/20'
        }`}>
          {importResult.imported > 0
            ? `✓ Imported ${importResult.imported} snippet${importResult.imported !== 1 ? 's' : ''}${importResult.skipped > 0 ? ` · ${importResult.skipped} duplicate${importResult.skipped !== 1 ? 's' : ''} skipped` : ''}`
            : `All ${importResult.skipped} snippet${importResult.skipped !== 1 ? 's' : ''} already exist — nothing to import`}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Left: List (40%) */}
        <div
          ref={listRef}
          className="snippet-split w-[40%] overflow-y-auto custom-scrollbar"
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
            <div className="p-2 space-y-1">
              {filteredSnippets.map((snippet, index) => (
                <div
                  key={snippet.id}
                  ref={(el) => (itemRefs.current[index] = el)}
                  className={`px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? 'bg-[var(--launcher-card-selected-bg)] border-[var(--launcher-card-border)]'
                      : 'border-transparent hover:bg-[var(--launcher-card-hover-bg)] hover:border-[var(--launcher-card-border)]'
                  }`}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => handlePaste(snippet)}
                >
                  <div className="flex items-start gap-2">
                    <div className="text-white/40 flex-shrink-0 mt-0.5">
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white/80 text-[13px] truncate font-medium leading-tight">
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
                      <div className="text-white/30 text-[11px] truncate mt-0.5 leading-tight">
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
              <pre className="text-white/80 text-sm whitespace-pre-wrap break-words font-mono leading-relaxed">
                {renderSnippetPreviewWithHighlights(
                  selectedSnippet.content,
                  selectedSnippetInlineValues
                )}
              </pre>

              <div className="mt-4 pt-3 border-t border-[var(--snippet-divider)] space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Name</span>
                  <span className="text-white/65 text-right truncate">
                    {selectedSnippet.name || '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Tag</span>
                  <span className="text-white/65 text-right truncate">
                    {selectedSnippet.keyword || '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Date</span>
                  <span className="text-white/65 text-right truncate">
                    {formatDate(selectedSnippet.updatedAt || selectedSnippet.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Select a snippet to preview</p>
            </div>
          )}
        </div>
      </div>

      <ExtensionActionFooter
        leftContent={<span className="truncate">{filteredSnippets.length} snippets</span>}
        primaryAction={
          activeSnippet
            ? {
                label: pasteLabel,
                onClick: () => handlePaste(),
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

      {dynamicPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(var(--backdrop-rgb), 0.25)' }}>
          <div
            className="w-[520px] max-w-[92vw] rounded-xl overflow-hidden"
            style={
              isGlassyTheme
                ? {
                    background: 'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                    backdropFilter: 'blur(96px) saturate(190%)',
                    WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.08)',
                  }
                : {
                    background: 'var(--bg-overlay-strong)',
                    backdropFilter: 'blur(28px)',
                    WebkitBackdropFilter: 'blur(28px)',
                    border: '1px solid var(--snippet-divider)',
                  }
            }
          >
            <div className="px-4 py-3 border-b border-[var(--snippet-divider)] text-white/85 text-sm font-medium">
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
                    className="w-full bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-[13px] text-white/85 placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)]"
                  />
                </div>
              ))}
              <div className="pt-2">
                <div className="text-[11px] uppercase tracking-wider text-white/35 mb-1.5">Preview</div>
                <div className="rounded-lg border border-[var(--snippet-divider)] bg-white/[0.04] px-3 py-2 text-sm text-white/85 whitespace-pre-wrap break-words font-mono">
                  {renderSnippetPreviewWithHighlights(
                    dynamicPrompt.snippet.content,
                    dynamicPrompt.values
                  )}
                </div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-[var(--snippet-divider)] flex items-center justify-end gap-2">
              <button
                onClick={() => setDynamicPrompt(null)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--snippet-divider)] bg-white/[0.03] text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/[0.08] transition-colors"
              >
                <span>Cancel</span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">Esc</kbd>
              </button>
              <button
                onClick={handleConfirmDynamicPrompt}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--snippet-divider-strong)] bg-white/[0.14] text-xs text-[var(--text-primary)] hover:bg-white/[0.2] transition-colors"
              >
                <span>{dynamicPrompt.mode === 'paste' ? 'Paste' : 'Copy'}</span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">↩</kbd>
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
          style={{ background: 'var(--bg-scrim)' }}
        >
          <div
            className="absolute bottom-12 right-3 w-80 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl"
            style={
              isNativeLiquidGlass
                ? {
                    background: 'rgba(var(--surface-base-rgb), 0.72)',
                    backdropFilter: 'blur(44px) saturate(155%)',
                    WebkitBackdropFilter: 'blur(44px) saturate(155%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
                    boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26)',
                  }
                : isGlassyTheme
                ? {
                    background: 'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                    backdropFilter: 'blur(96px) saturate(190%)',
                    WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.05)',
                  }
                : {
                    background: 'var(--card-bg)',
                    backdropFilter: 'blur(40px)',
                    WebkitBackdropFilter: 'blur(40px)',
                    border: '1px solid var(--border-primary)',
                  }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto py-1">
              {actions.map((action, idx) => (
                <div
                  key={idx}
                  className={`mx-1 px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-2.5 cursor-pointer transition-colors ${
                    idx === selectedActionIndex ? 'bg-[var(--action-menu-selected-bg)]' : ''
                  } ${
                    action.style === 'destructive'
                      ? 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--status-danger-faded)]'
                      : 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--text-secondary)]'
                  }`}
                  style={
                    idx === selectedActionIndex
                      ? {
                          background: 'var(--action-menu-selected-bg)',
                          borderColor: 'var(--action-menu-selected-border)',
                          boxShadow: 'var(--action-menu-selected-shadow)',
                        }
                      : undefined
                  }
                  onMouseMove={() => setSelectedActionIndex(idx)}
                  onClick={() => {
                    action.execute();
                    setShowActions(false);
                  }}
                >
                  {action.icon ? (
                    <span className={action.style === 'destructive' ? 'text-[var(--status-danger-faded)]' : 'text-[var(--text-muted)]'}>
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
                          className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] font-medium text-[var(--text-muted)]"
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
