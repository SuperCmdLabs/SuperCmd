/**
 * Canvas Search — Inline launcher view (matches Notes Search UI pattern).
 * Opens the detached canvas editor window when a canvas is selected.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Plus, Pin, PinOff, X,
  Files, Copy, Download, Trash2, Palette,
} from 'lucide-react';
import type { Canvas } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';
import IconCodeEditor from './icons/Snippet';

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

function formatDate(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface CanvasSearchInlineProps {
  onClose: () => void;
}

const CanvasSearchInline: React.FC<CanvasSearchInlineProps> = ({ onClose }) => {
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showActions, setShowActions] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  // Filter canvases
  const filteredCanvases = useMemo(() => {
    if (!searchQuery.trim()) return canvases;
    const q = searchQuery.toLowerCase();
    return canvases.filter((c) => c.title.toLowerCase().includes(q));
  }, [canvases, searchQuery]);

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

  // Open canvas in editor
  const openCanvas = useCallback((canvas: Canvas) => {
    window.electron.openCanvasWindow('edit', JSON.stringify({ id: canvas.id }));
  }, []);

  // Actions
  const actions: Action[] = useMemo(() => {
    const items: Action[] = [
      {
        title: 'New Canvas',
        icon: <Plus className="w-3.5 h-3.5" />,
        shortcut: ['⌘', 'N'],
        execute: () => window.electron.openCanvasWindow('create'),
        section: 'actions',
      },
    ];
    if (selectedCanvas) {
      items.push(
        {
          title: 'Open Canvas',
          icon: <Palette className="w-3.5 h-3.5" />,
          shortcut: ['↩'],
          execute: () => openCanvas(selectedCanvas),
          section: 'actions',
        },
        {
          title: 'Duplicate',
          icon: <Files className="w-3.5 h-3.5" />,
          shortcut: ['⌘', 'D'],
          execute: async () => {
            await window.electron.canvasDuplicate(selectedCanvas.id);
            loadCanvases();
          },
          section: 'actions',
        },
        {
          title: 'Copy Deeplink',
          icon: <Copy className="w-3.5 h-3.5" />,
          shortcut: ['⇧', '⌘', 'D'],
          execute: () => {
            navigator.clipboard.writeText(`supercmd://canvas/${selectedCanvas.id}`);
          },
          section: 'actions',
        },
        {
          title: 'Export as JSON',
          icon: <Download className="w-3.5 h-3.5" />,
          shortcut: ['⇧', '⌘', 'E'],
          execute: async () => {
            await window.electron.canvasExport(selectedCanvas.id, 'json');
          },
          section: 'manage',
        },
        {
          title: selectedCanvas.pinned ? 'Unpin' : 'Pin',
          icon: selectedCanvas.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />,
          shortcut: ['⇧', '⌘', 'P'],
          execute: async () => {
            await window.electron.canvasTogglePin(selectedCanvas.id);
            loadCanvases();
          },
          section: 'manage',
        },
        {
          title: 'Delete Canvas',
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
  }, [selectedCanvas, openCanvas, loadCanvases]);

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
        setSelectedIndex((i) => Math.min(i + 1, filteredCanvases.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (e.key === 'Enter' && selectedCanvas && !confirmDelete) {
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
  }, [showActions, selectedActionIndex, actions, selectedCanvas, filteredCanvases.length, onClose, openCanvas, loadCanvases, confirmDelete]);

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
        {/* Header */}
        <div className="snippet-header flex h-16 items-center gap-2 px-4">
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-[15px] text-white/60 flex-1 font-medium">Canvases</span>
        </div>
        {/* Empty state */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="mb-3 flex justify-center"><IconCodeEditor size="40px" style={canvasIconStyle} /></div>
            <p className="text-[14px] font-medium text-white/70 mb-1">No canvases yet</p>
            <p className="text-[12px] text-white/40 mb-4">Create your first canvas to get started</p>
            <button
              onClick={() => window.electron.openCanvasWindow('create')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--snippet-divider-strong)] bg-white/[0.14] text-xs text-[var(--text-primary)] hover:bg-white/[0.2] transition-colors"
            >
              Create Canvas
            </button>
            <p className="text-[11px] text-white/30 mt-2">or press ⌘N</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="snippet-view flex flex-col h-full">
      {/* Header (matches snippet-header pattern) */}
      <div className="snippet-header flex h-16 items-center gap-2 px-4">
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
              placeholder="Search canvases..."
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
            title="Create Canvas"
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
              <p className="text-sm">{searchQuery ? 'No canvases found' : 'No canvases yet'}</p>
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
                      {canvas.title || 'Untitled Canvas'}
                    </span>
                    {canvas.pinned && <Pin className="w-3 h-3 text-amber-300/80 flex-shrink-0" />}
                  </div>
                  <div className="mt-0.5 text-[11px] text-white/30 pl-6">
                    {formatDate(canvas.updatedAt)}
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
              <div className="px-4 pb-3 flex-shrink-0">
                <p className="text-[13px] font-medium text-white/75 truncate">{selectedCanvas.title}</p>
                <p className="text-[11px] text-white/35 mt-0.5">Modified {formatDate(selectedCanvas.updatedAt)}</p>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/20">
              <IconCodeEditor size="36px" style={canvasIconStyle} />
              <p className="text-[12px]">
                {selectedCanvas ? 'No preview yet — save the canvas to generate one' : 'Select a canvas to preview'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && selectedCanvas && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="rounded-xl p-5 max-w-sm" style={{ background: 'var(--card-bg)', backdropFilter: 'blur(40px)' }}>
            <p className="text-[14px] font-medium text-white/90 mb-2">Delete "{selectedCanvas.title}"?</p>
            <p className="text-[12px] text-white/50 mb-4">This action cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-md text-[12px] text-white/60 hover:bg-white/5"
              >
                Cancel
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
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actions overlay */}
      {showActions && (
        <div className="absolute bottom-12 right-3 w-72 rounded-xl shadow-xl z-50 overflow-hidden"
          style={{ background: 'var(--card-bg)', backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)' }}
        >
          <div className="p-1.5">
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={() => { action.execute(); setShowActions(false); }}
                onMouseMove={() => setSelectedActionIndex(i)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
                  action.style === 'destructive'
                    ? `text-red-400 ${i === selectedActionIndex ? 'bg-red-500/10' : 'hover:bg-red-500/10'}`
                    : `text-white/70 ${i === selectedActionIndex ? 'bg-white/10' : 'hover:bg-white/5'}`
                }`}
              >
                {action.icon}
                <span className="flex-1 text-left">{action.title}</span>
                {action.shortcut && (
                  <span className="flex gap-0.5">
                    {action.shortcut.map((k, j) => (
                      <kbd key={j} className="px-1 py-0.5 text-[9px] bg-white/5 rounded text-white/40">{k}</kbd>
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <ExtensionActionFooter
        leftContent={<span className="text-[11px] text-white/30">{filteredCanvases.length} canvas{filteredCanvases.length !== 1 ? 'es' : ''}</span>}
        primaryAction={selectedCanvas ? {
          label: 'Open',
          onClick: () => openCanvas(selectedCanvas),
          shortcut: ['↩'],
        } : undefined}
        actionsButton={{
          label: 'Actions',
          onClick: () => setShowActions((v) => !v),
          shortcut: ['⌘', 'K'],
        }}
      />
    </div>
  );
};

export default CanvasSearchInline;
