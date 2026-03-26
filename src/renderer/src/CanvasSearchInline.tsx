/**
 * Canvas Search — Inline launcher view (matches Notes Search UI pattern).
 * Opens the detached canvas editor window when a canvas is selected.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Plus, Pin, PinOff, X,
  Files, Copy, Download, Trash2, Search, Palette,
} from 'lucide-react';
import type { Canvas } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';

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
      // Actions overlay open
      if (showActions) {
        if (e.key === 'Escape') { e.preventDefault(); setShowActions(false); return; }
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

      if (e.key === 'Enter' && selectedCanvas) {
        e.preventDefault();
        openCanvas(selectedCanvas);
        return;
      }

      if (e.key === 'k' && e.metaKey) {
        e.preventDefault();
        setShowActions((v) => !v);
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

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showActions, selectedCanvas, filteredCanvases.length, onClose, openCanvas, loadCanvases]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Delete confirmation
  useEffect(() => {
    if (!confirmDelete || !selectedCanvas) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.electron.canvasDelete(selectedCanvas.id).then(() => {
          loadCanvases();
          setConfirmDelete(false);
        });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmDelete(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [confirmDelete, selectedCanvas, loadCanvases]);

  // Empty state
  if (canvases.length === 0 && !searchQuery) {
    return (
      <div className="snippet-view flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5 transition-colors">
            <ArrowLeft className="w-4 h-4 text-white/50" />
          </button>
          <span className="text-[13px] text-white/60 flex-1">Canvases</span>
        </div>
        {/* Empty state */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-3">🎨</div>
            <p className="text-[14px] font-medium text-white/70 mb-1">No canvases yet</p>
            <p className="text-[12px] text-white/40 mb-4">Create your first canvas to get started</p>
            <button
              onClick={() => window.electron.openCanvasWindow('create')}
              className="px-4 py-2 rounded-lg text-[13px] font-medium text-white bg-indigo-500/20 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors"
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
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <button onClick={onClose} className="p-1 rounded hover:bg-white/5 transition-colors">
          <ArrowLeft className="w-4 h-4 text-white/50" />
        </button>
        <div className="flex-1 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Search canvases..."
            className="w-full bg-white/5 rounded-md pl-7 pr-3 py-1.5 text-[13px] text-white/90 placeholder:text-white/30 outline-none border border-transparent focus:border-white/10"
          />
        </div>
        <button
          onClick={() => window.electron.openCanvasWindow('create')}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
        >
          <Plus className="w-3 h-3" /> New
        </button>
      </div>

      {/* Split pane */}
      <div className="flex-1 flex min-h-0">
        {/* List pane (40%) */}
        <div ref={listRef} className="w-[40%] border-r border-white/5 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
          {filteredCanvases.map((canvas, index) => (
            <div
              key={canvas.id}
              className={`px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                index === selectedIndex
                  ? 'bg-[var(--launcher-card-selected-bg,rgba(99,102,241,0.15))] border border-[var(--launcher-card-selected-border,rgba(99,102,241,0.3))]'
                  : 'border border-transparent hover:bg-white/[0.03]'
              }`}
              onClick={() => setSelectedIndex(index)}
              onDoubleClick={() => openCanvas(canvas)}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm flex-shrink-0">{canvas.icon || '🎨'}</span>
                <span className="text-[13px] truncate font-medium text-white/90">
                  {canvas.title || 'Untitled Canvas'}
                </span>
                {canvas.pinned && <Pin className="w-3 h-3 text-white/30 flex-shrink-0" />}
              </div>
              <div className="mt-1 text-[11px] text-white/30 pl-6">
                {formatDate(canvas.updatedAt)}
              </div>
            </div>
          ))}
          {filteredCanvases.length === 0 && searchQuery && (
            <div className="text-center py-8 text-[12px] text-white/30">
              No canvases match "{searchQuery}"
            </div>
          )}
        </div>

        {/* Preview pane (60%) */}
        <div className="flex-1 flex items-center justify-center p-4">
          {selectedCanvas && thumbnails[selectedCanvas.id] ? (
            <div className="w-full h-full flex flex-col items-center justify-center">
              <div
                className="max-w-full max-h-[80%] rounded-lg overflow-hidden border border-white/5 bg-white/[0.02]"
                dangerouslySetInnerHTML={{ __html: thumbnails[selectedCanvas.id] }}
              />
              <div className="mt-3 text-center">
                <p className="text-[13px] font-medium text-white/70">{selectedCanvas.title}</p>
                <p className="text-[11px] text-white/30 mt-0.5">
                  Modified {formatDate(selectedCanvas.updatedAt)}
                </p>
              </div>
            </div>
          ) : selectedCanvas ? (
            <div className="text-center">
              <Palette className="w-10 h-10 text-white/10 mx-auto mb-2" />
              <p className="text-[13px] text-white/40">{selectedCanvas.title}</p>
              <p className="text-[11px] text-white/20 mt-1">Open to preview</p>
            </div>
          ) : (
            <div className="text-center text-[12px] text-white/20">Select a canvas</div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && selectedCanvas && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[var(--launcher-bg,#1e1e2e)] rounded-xl p-5 max-w-sm border border-white/10">
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
                className="px-3 py-1.5 rounded-md text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actions overlay */}
      {showActions && (
        <div className="absolute bottom-12 right-3 w-72 bg-[var(--launcher-bg,#1e1e2e)] border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="p-1.5">
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={() => { action.execute(); setShowActions(false); }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
                  action.style === 'destructive'
                    ? 'text-red-400 hover:bg-red-500/10'
                    : 'text-white/70 hover:bg-white/5'
                }`}
              >
                {action.icon}
                <span className="flex-1 text-left">{action.title}</span>
                {action.shortcut && (
                  <span className="flex gap-0.5">
                    {action.shortcut.map((k, j) => (
                      <kbd key={j} className="px-1 py-0.5 text-[9px] bg-white/5 rounded border border-white/10 text-white/40">{k}</kbd>
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
