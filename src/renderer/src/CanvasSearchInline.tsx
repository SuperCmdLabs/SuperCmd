/**
 * Canvas Search — Inline launcher view (matches Notes Search UI pattern).
 * Opens the detached canvas editor window when a canvas is selected.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Plus, Pin, PinOff, X,
  Files, Copy, Download, Trash2, Palette, Pencil,
} from 'lucide-react';
import type { Canvas } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';
import IconCodeEditor from './icons/Snippet';
import { useI18n } from './i18n';

const canvasIconStyle = {
  '--nc-gradient-1-color-1': '#fcd34d',
  '--nc-gradient-1-color-2': '#d97706',
  '--nc-gradient-2-color-1': '#fef3c7b8',
  '--nc-gradient-2-color-2': '#fcd34d90',
} as React.CSSProperties;

interface Action {
  title: string;
  icon?: React.ReactNode;
  shortcut?: string[];
  execute: () => void | Promise<void>;
  style?: 'default' | 'destructive';
  section?: string;
}

function formatRelative(
  ts: number,
  locale: string,
  t: (key: string) => string
): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('canvas.time.justNow');
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diff < 3_600_000) return formatter.format(-Math.floor(diff / 60_000), 'minute');
  if (diff < 86_400_000) return formatter.format(-Math.floor(diff / 3_600_000), 'hour');
  if (diff < 604_800_000) return formatter.format(-Math.floor(diff / 86_400_000), 'day');
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(ts));
}

function formatAbsolute(ts: number, locale: string): string {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
  if (isToday) return time;
  return `${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d)} · ${time}`;
}

interface CanvasSearchInlineProps {
  onClose: () => void;
}

const CanvasSearchInline: React.FC<CanvasSearchInlineProps> = ({ onClose }) => {
  const { t, locale } = useI18n();
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showActions, setShowActions] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renameCanvas, setRenameCanvas] = useState<Canvas | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const actionsOverlayRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isGlassyTheme = document.documentElement.classList.contains('sc-glassy') || document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass = document.documentElement.classList.contains('sc-native-liquid-glass') || document.body.classList.contains('sc-native-liquid-glass');

  // Load canvases
  const loadCanvases = useCallback(async () => {
    const all = await window.electron.canvasGetAll();
    setCanvases(all);
  }, []);

  useEffect(() => { loadCanvases(); }, [loadCanvases]);

  // Load thumbnails for visible canvases
  useEffect(() => {
    const loadThumbnails = async () => {
      const thumbs: Record<string, string> = {};
      for (const c of canvases) {
        const thumb = await window.electron.canvasGetThumbnail(c.id);
        if (thumb) thumbs[c.id] = thumb;
      }
      setThumbnails(thumbs);
    };
    if (canvases.length > 0) loadThumbnails();
  }, [canvases]);

  // Refresh canvas list when a scene is saved (e.g. new canvas created, Escape pressed)
  useEffect(() => {
    const unsub = window.electron.onCanvasListUpdated(() => { loadCanvases(); });
    return unsub;
  }, [loadCanvases]);

  // Refresh thumbnail when canvas editor saves one (e.g. on Escape)
  useEffect(() => {
    const unsub = window.electron.onCanvasThumbnailUpdated(async (id: string) => {
      const thumb = await window.electron.canvasGetThumbnail(id);
      if (thumb) setThumbnails((prev) => ({ ...prev, [id]: thumb }));
    });
    return unsub;
  }, []);

  // Filter canvases
  const filteredCanvases = useMemo(() => {
    if (!searchQuery.trim()) return canvases;
    const q = searchQuery.toLowerCase();
    return canvases.filter((c) => c.title.toLowerCase().includes(q));
  }, [canvases, searchQuery]);
  const filteredCanvasCount = filteredCanvases.length;

  const selectedCanvas = filteredCanvases[selectedIndex] || null;

  // Ensure selected index is within bounds
  useEffect(() => {
    if (selectedIndex >= filteredCanvases.length) {
      setSelectedIndex(Math.max(0, filteredCanvases.length - 1));
    }
  }, [filteredCanvases.length, selectedIndex]);

  // Focus search input on mount
  useEffect(() => {
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    if (!showActions) return;
    setSelectedActionIndex(0);
    setTimeout(() => actionsOverlayRef.current?.focus(), 0);
  }, [showActions]);

  useEffect(() => {
    if (!renameCanvas) return;
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 50);
  }, [renameCanvas]);

  // Open canvas in editor
  const openCanvas = useCallback((canvas: Canvas) => {
    window.electron.openCanvasWindow('edit', JSON.stringify({ id: canvas.id }));
  }, []);

  // Actions
  const actions: Action[] = useMemo(() => {
    const items: Action[] = [
      {
        title: t('canvas.actions.new'),
        icon: <Plus className="w-3.5 h-3.5" />,
        shortcut: ['⌘', 'N'],
        execute: () => window.electron.openCanvasWindow('create'),
        section: 'actions',
      },
    ];
    if (selectedCanvas) {
      items.push(
        {
          title: t('canvas.actions.open'),
          icon: <Palette className="w-3.5 h-3.5" />,
          shortcut: ['↩'],
          execute: () => openCanvas(selectedCanvas),
          section: 'actions',
        },
        {
          title: t('canvas.actions.rename'),
          icon: <Pencil className="w-3.5 h-3.5" />,
          shortcut: ['⌘', 'R'],
          execute: () => { setRenameValue(selectedCanvas.title); setRenameCanvas(selectedCanvas); },
          section: 'actions',
        },
        {
          title: t('canvas.actions.duplicate'),
          icon: <Files className="w-3.5 h-3.5" />,
          shortcut: ['⌘', 'D'],
          execute: async () => {
            await window.electron.canvasDuplicate(selectedCanvas.id);
            loadCanvases();
          },
          section: 'actions',
        },
        {
          title: t('canvas.actions.copyDeeplink'),
          icon: <Copy className="w-3.5 h-3.5" />,
          shortcut: ['⇧', '⌘', 'D'],
          execute: () => {
            navigator.clipboard.writeText(`supercmd://canvas/${selectedCanvas.id}`);
          },
          section: 'actions',
        },
        {
          title: t('canvas.actions.exportJson'),
          icon: <Download className="w-3.5 h-3.5" />,
          shortcut: ['⇧', '⌘', 'E'],
          execute: async () => {
            await window.electron.canvasExport(selectedCanvas.id, 'json');
          },
          section: 'manage',
        },
        {
          title: selectedCanvas.pinned ? t('canvas.actions.unpin') : t('canvas.actions.pin'),
          icon: selectedCanvas.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />,
          shortcut: ['⇧', '⌘', 'P'],
          execute: async () => {
            await window.electron.canvasTogglePin(selectedCanvas.id);
            loadCanvases();
          },
          section: 'manage',
        },
        {
          title: t('canvas.actions.delete'),
          icon: <Trash2 className="w-3.5 h-3.5" />,
          shortcut: ['⌃', 'X'],
          execute: async () => {
            await window.electron.canvasDelete(selectedCanvas.id);
            loadCanvases();
            setShowActions(false);
          },
          style: 'destructive',
          section: 'danger',
        },
      );
    }
    return items;
  }, [selectedCanvas, openCanvas, loadCanvases, t]);

  // Keyboard handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Actions overlay open: navigate and execute
      if (showActions) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          setSelectedActionIndex((i) => Math.min(i + 1, actions.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          setSelectedActionIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          actions[selectedActionIndex]?.execute();
          setShowActions(false);
          return;
        }
        if (e.key === 'Escape' || (e.key === 'k' && e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
          setShowActions(false);
          return;
        }
        return;
      }

      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(i + 1, filteredCanvases.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (e.key === 'Enter' && selectedCanvas && !confirmDelete && !renameCanvas) {
        e.preventDefault();
        openCanvas(selectedCanvas);
        return;
      }

      if (e.key === 'k' && e.metaKey) {
        e.preventDefault();
        setShowActions((v) => !v);
        setSelectedActionIndex(0);
        return;
      }

      if (e.key === 'n' && e.metaKey) {
        e.preventDefault();
        window.electron.openCanvasWindow('create');
        return;
      }

      if (e.key === 'r' && e.metaKey && selectedCanvas) {
        e.preventDefault();
        setRenameValue(selectedCanvas.title);
        setRenameCanvas(selectedCanvas);
        return;
      }

      if (e.key === 'd' && e.metaKey && selectedCanvas) {
        e.preventDefault();
        window.electron.canvasDuplicate(selectedCanvas.id).then(() => loadCanvases());
        return;
      }

      if (e.key === 'p' && e.metaKey && e.shiftKey && selectedCanvas) {
        e.preventDefault();
        window.electron.canvasTogglePin(selectedCanvas.id).then(() => loadCanvases());
        return;
      }

      if (e.key === 'x' && e.ctrlKey && selectedCanvas) {
        e.preventDefault();
        setConfirmDelete(true);
        return;
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showActions, selectedActionIndex, actions, selectedCanvas, filteredCanvases.length, onClose, openCanvas, loadCanvases, confirmDelete, renameCanvas]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const wrapper = list.children[0] as HTMLElement;
    if (!wrapper) return;
    const item = wrapper.children[selectedIndex] as HTMLElement;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Delete confirmation — use capture phase to intercept before main handler
  useEffect(() => {
    if (!confirmDelete || !selectedCanvas) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.electron.canvasDelete(selectedCanvas.id).then(() => {
          loadCanvases();
          setConfirmDelete(false);
        });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setConfirmDelete(false);
      }
    };
    window.addEventListener('keydown', handler, true); // capture phase
    return () => window.removeEventListener('keydown', handler, true);
  }, [confirmDelete, selectedCanvas, loadCanvases]);

  // Empty state
  if (canvases.length === 0 && !searchQuery) {
    return (
      <div className="snippet-view flex flex-col h-full">
        {/* Same header as normal view */}
        <div className="snippet-header drag-region flex h-16 items-center gap-2 px-4">
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0" tabIndex={-1}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <input
            value=""
            readOnly
            placeholder={t('canvas.searchPlaceholder')}
            className="min-w-0 w-full bg-transparent border-none outline-none text-white/95 placeholder:text-[color:var(--text-subtle)] text-[15px] font-medium tracking-[0.005em]"
          />
          <button
            onClick={() => window.electron.openCanvasWindow('create')}
            className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
            title={t('canvas.actions.new')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {/* Empty body */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="mb-3 flex justify-center"><IconCodeEditor size="40px" style={canvasIconStyle} /></div>
            <p className="text-[14px] font-medium text-white/70 mb-1">{t('canvas.empty.title')}</p>
            <p className="text-[12px] text-white/40 mb-4">{t('canvas.empty.description')}</p>
            <button
              onClick={() => window.electron.openCanvasWindow('create')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--snippet-divider-strong)] bg-white/[0.14] text-xs text-[var(--text-primary)] hover:bg-white/[0.2] transition-colors"
            >
              {t('canvas.actions.new')}
            </button>
            <p className="text-[11px] text-white/30 mt-2">{t('canvas.empty.shortcutHint')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="snippet-view flex flex-col h-full">
      {/* Header (matches snippet-header pattern) */}
      <div className="snippet-header drag-region flex h-16 items-center gap-2 px-4">
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          tabIndex={-1}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="relative min-w-0 flex-1">
          <div className="flex h-full items-center">
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSelectedIndex(0); }}
              placeholder={t('canvas.searchPlaceholder')}
              className="min-w-0 w-full bg-transparent border-none outline-none text-white/95 placeholder:text-[color:var(--text-subtle)] text-[15px] font-medium tracking-[0.005em]"
              autoFocus
            />
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => window.electron.openCanvasWindow('create')}
            className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
            title={t('canvas.actions.new')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Split pane (matches snippet layout) */}
      <div className="flex-1 flex min-h-0">
        {/* Left: List (40%) */}
        <div
          ref={listRef}
          className="snippet-split w-[40%] overflow-y-auto custom-scrollbar"
        >
          {filteredCanvases.length === 0 ? (
            <div className="flex items-center justify-center h-full text-white/30">
              <p className="text-sm">{searchQuery ? t('canvas.empty.noSearchResults') : t('canvas.empty.title')}</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredCanvases.map((canvas, index) => (
                <div
                  key={canvas.id}
                  className={`px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? 'bg-[var(--launcher-card-selected-bg)] border-[var(--launcher-card-border)]'
                      : 'border-transparent hover:bg-[var(--launcher-card-hover-bg)] hover:border-[var(--launcher-card-border)]'
                  }`}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => openCanvas(canvas)}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-shrink-0"><IconCodeEditor size="14px" style={canvasIconStyle} /></span>
                    <span className="text-white/80 text-[13px] truncate font-medium leading-tight">
                      {canvas.title || t('canvas.untitled')}
                    </span>
                    {canvas.pinned && <Pin className="w-3 h-3 text-amber-300/80 flex-shrink-0" />}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-subtle)] pl-6 flex items-center gap-1.5">
                    <span>{formatRelative(canvas.updatedAt, locale, t)}</span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span>{formatAbsolute(canvas.updatedAt, locale)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Preview (60%) */}
        <div className="flex-1 flex flex-col min-h-0 border-l border-[var(--snippet-divider)]">
          {selectedCanvas && thumbnails[selectedCanvas.id] ? (
            <>
              <div className="flex-1 flex items-center justify-center p-5 min-h-0">
                <img
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(thumbnails[selectedCanvas.id])}`}
                  alt={selectedCanvas.title}
                  className="max-w-full max-h-full object-contain rounded-lg"
                  style={{ display: 'block' }}
                />
              </div>
              <div className="px-5 pb-4 flex-shrink-0">
                <p className="text-[13px] font-medium text-[var(--text-primary)] truncate mb-2">{selectedCanvas.title}</p>
                <div className="pt-2.5 border-t border-[var(--ui-divider)]">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-[var(--text-subtle)]">{t('canvas.modified')}</span>
                    <span className="text-[var(--text-muted)] text-right truncate">
                      {formatAbsolute(selectedCanvas.updatedAt, locale)}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/20">
              <IconCodeEditor size="36px" style={canvasIconStyle} />
              <p className="text-[12px]">
                {selectedCanvas ? t('canvas.preview.empty') : t('canvas.preview.selectPrompt')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Rename dialog */}
      {renameCanvas && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="rounded-xl p-5 w-72" style={{ background: 'var(--card-bg)', backdropFilter: 'blur(40px)', border: '1px solid var(--border-primary)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <p className="text-[13px] font-medium text-white/90 mb-3">{t('canvas.rename.title')}</p>
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && renameValue.trim()) {
                  e.preventDefault();
                  window.electron.canvasUpdate(renameCanvas.id, { title: renameValue.trim() }).then(() => {
                    loadCanvases();
                    setRenameCanvas(null);
                  });
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenameCanvas(null);
                }
              }}
              className="w-full bg-transparent border border-[var(--border-primary)] rounded-md px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--text-muted)] mb-4"
              placeholder={t('canvas.rename.placeholder')}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRenameCanvas(null)}
                className="px-3 py-1.5 rounded-md text-[12px] border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--overlay-item-hover-bg)] transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  if (!renameValue.trim()) return;
                  window.electron.canvasUpdate(renameCanvas.id, { title: renameValue.trim() }).then(() => {
                    loadCanvases();
                    setRenameCanvas(null);
                  });
                }}
                className="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--border-primary)] bg-[var(--launcher-card-selected-bg)] text-[var(--text-primary)] hover:bg-[var(--overlay-item-hover-bg)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!renameValue.trim()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && selectedCanvas && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="rounded-xl p-5 max-w-sm" style={{ background: 'var(--card-bg)', backdropFilter: 'blur(40px)' }}>
            <p className="text-[14px] font-medium text-white/90 mb-2">{t('canvas.delete.title', { title: selectedCanvas.title })}</p>
            <p className="text-[12px] text-white/50 mb-4">{t('canvas.delete.description')}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-md text-[12px] text-white/60 hover:bg-white/5"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  window.electron.canvasDelete(selectedCanvas.id).then(() => {
                    loadCanvases();
                    setConfirmDelete(false);
                  });
                }}
                className="px-3 py-1.5 rounded-md text-[12px] text-red-400 bg-red-500/10 hover:bg-red-500/20"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actions overlay */}
      {showActions && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setShowActions(false)}
          style={{ background: 'var(--bg-scrim)' }}
        >
          <div
            ref={actionsOverlayRef}
            className="absolute bottom-12 right-3 w-80 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0"
            tabIndex={0}
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
            onFocus={(e) => { (e.currentTarget as HTMLDivElement).style.outline = 'none'; }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto py-1">
              {actions.map((action, idx) => (
                <div
                  key={idx}
                  className={`mx-1 px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-2.5 cursor-pointer transition-colors ${
                    idx === selectedActionIndex
                      ? action.style === 'destructive'
                        ? 'bg-[var(--action-menu-selected-bg)] text-[var(--status-danger-faded)]'
                        : 'bg-[var(--action-menu-selected-bg)] text-[var(--text-primary)]'
                      : ''
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
                  onClick={() => { action.execute(); setShowActions(false); }}
                >
                  {action.icon ? (
                    <span className={action.style === 'destructive' ? 'text-[var(--status-danger-faded)]' : 'text-[var(--text-muted)]'}>
                      {action.icon}
                    </span>
                  ) : null}
                  <span className="flex-1 text-sm truncate">{action.title}</span>
                  {action.shortcut ? (
                    <span className="flex items-center gap-0.5">
                      {action.shortcut.map((key, keyIdx) => (
                        <kbd
                          key={`${idx}-${key}-${keyIdx}`}
                          className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] font-medium text-[var(--text-muted)]"
                        >
                          {key}
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

      {/* Footer */}
      <ExtensionActionFooter
        leftContent={(
          <span className="text-[11px] text-white/30">
            {t('canvas.count', {
              count: filteredCanvasCount,
              plural: filteredCanvasCount === 1 ? '' : 'es',
            })}
          </span>
        )}
        primaryAction={selectedCanvas ? {
          label: t('common.open'),
          onClick: () => openCanvas(selectedCanvas),
          shortcut: ['↩'],
        } : undefined}
        actionsButton={{
          label: t('common.actions'),
          onClick: () => setShowActions((v) => !v),
          shortcut: ['⌘', 'K'],
        }}
      />
    </div>
  );
};

export default CanvasSearchInline;
