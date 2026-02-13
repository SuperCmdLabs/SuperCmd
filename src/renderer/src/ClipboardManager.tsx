/**
 * Clipboard Manager UI
 * 
 * Features:
 * - 40/60 split (list/preview)
 * - Actions button styled exactly like List component
 * - Matches settings window theme
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Trash2, Copy, Clipboard, Image as ImageIcon, Link, FileText, ArrowLeft } from 'lucide-react';
import type { ClipboardItem } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';

interface ClipboardManagerProps {
  onClose: () => void;
}

interface Action {
  title: string;
  icon?: React.ReactNode;
  shortcut?: string[];
  execute: () => void | Promise<void>;
  style?: 'default' | 'destructive';
}

const ClipboardManager: React.FC<ClipboardManagerProps> = ({ onClose }) => {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<ClipboardItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterType, setFilterType] = useState<'all' | 'text' | 'image' | 'url' | 'file'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [frontmostAppName, setFrontmostAppName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const actionsOverlayRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async (withLoading = false) => {
    if (withLoading) setIsLoading(true);
    try {
      const history = await window.electron.clipboardGetHistory();
      setItems((prev) => {
        if (
          prev.length === history.length &&
          prev.every((item, idx) => item.id === history[idx]?.id && item.timestamp === history[idx]?.timestamp)
        ) {
          return prev;
        }
        return history;
      });
    } catch (e) {
      console.error('Failed to load clipboard history:', e);
    }
    if (withLoading) setIsLoading(false);
  }, []);

  useEffect(() => {
    loadHistory(true);
    inputRef.current?.focus();
    window.electron.getLastFrontmostApp().then((app) => {
      if (app) setFrontmostAppName(app.name);
    });
  }, [loadHistory]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadHistory(false);
    }, 750);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadHistory]);

  useEffect(() => {
    let filtered = items;

    if (filterType !== 'all') {
      filtered = filtered.filter((item) => item.type === filterType);
    }

    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => {
        if (item.type === 'text' || item.type === 'url' || item.type === 'file') {
          return item.content.toLowerCase().includes(lowerQuery);
        }
        return false;
      });
    }

    setFilteredItems(filtered);
  }, [items, filterType, searchQuery]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filterType, searchQuery]);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, filteredItems.length);
  }, [filteredItems.length]);

  useEffect(() => {
    if (filteredItems.length === 0 && selectedIndex !== 0) {
      setSelectedIndex(0);
      return;
    }
    if (selectedIndex >= filteredItems.length && filteredItems.length > 0) {
      setSelectedIndex(filteredItems.length - 1);
    }
  }, [filteredItems.length, selectedIndex]);

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

  useEffect(() => {
    if (!showActions) return;
    setSelectedActionIndex(0);
    setTimeout(() => actionsOverlayRef.current?.focus(), 0);
  }, [showActions]);

  const handlePasteItem = async (item?: ClipboardItem) => {
    const itemToPaste = item || filteredItems[selectedIndex];
    if (!itemToPaste) return;
    
    try {
      // This copies to clipboard, hides window, and simulates Cmd+V
      await window.electron.clipboardPasteItem(itemToPaste.id);
    } catch (e) {
      console.error('Failed to paste item:', e);
    }
  };

  const handleCopyToClipboard = async () => {
    if (!filteredItems[selectedIndex]) return;
    try {
      await window.electron.clipboardCopyItem(filteredItems[selectedIndex].id);
    } catch (e) {
      console.error('Failed to copy item:', e);
    }
  };

  const handleDeleteItem = async (item?: ClipboardItem) => {
    const itemToDelete = item || filteredItems[selectedIndex];
    if (!itemToDelete) return;
    
    try {
      await window.electron.clipboardDeleteItem(itemToDelete.id);
      await loadHistory();
    } catch (e) {
      console.error('Failed to delete item:', e);
    }
  };

  const handleClearAll = async () => {
    if (confirm('Are you sure you want to clear all clipboard history?')) {
      try {
        await window.electron.clipboardClearHistory();
        await loadHistory();
      } catch (e) {
        console.error('Failed to clear history:', e);
      }
    }
  };

  const selectedItem = filteredItems[selectedIndex];

  const pasteLabel = frontmostAppName ? `Paste in ${frontmostAppName}` : 'Paste';

  const actions: Action[] = [
    {
      title: pasteLabel,
      icon: <Clipboard className="w-4 h-4" />,
      shortcut: ['↩'],
      execute: () => handlePasteItem(),
    },
    {
      title: 'Copy to Clipboard',
      icon: <Copy className="w-4 h-4" />,
      shortcut: ['⌘', '↩'],
      execute: handleCopyToClipboard,
    },
    {
      title: 'Delete',
      icon: <Trash2 className="w-4 h-4" />,
      shortcut: ['⌃', 'X'],
      execute: () => handleDeleteItem(),
      style: 'destructive',
    },
    {
      title: 'Delete All Entries',
      icon: <Trash2 className="w-4 h-4" />,
      shortcut: ['⌃', '⇧', 'X'],
      execute: handleClearAll,
      style: 'destructive',
    },
  ];

  const isMetaEnter = (e: React.KeyboardEvent) =>
    e.metaKey &&
    (e.key === 'Enter' || e.key === 'Return' || e.code === 'Enter' || e.code === 'NumpadEnter');

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'k' && e.metaKey && !e.repeat) {
        e.preventDefault();
        setShowActions(p => !p);
        return;
      }

      if (showActions) {
        if (isMetaEnter(e)) {
          e.preventDefault();
          void handleCopyToClipboard();
          setShowActions(false);
          return;
        }
        if (e.key.toLowerCase() === 'x' && e.ctrlKey && e.shiftKey) {
          e.preventDefault();
          void handleClearAll();
          setShowActions(false);
          return;
        }
        if (e.key.toLowerCase() === 'x' && e.ctrlKey) {
          e.preventDefault();
          void handleDeleteItem();
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
          if (action) {
            action.execute();
          }
          setShowActions(false);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowActions(false);
          return;
        }
        return;
      }

      if (isMetaEnter(e)) {
        e.preventDefault();
        void handleCopyToClipboard();
        return;
      }
      if (e.key.toLowerCase() === 'x' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        handleClearAll();
        return;
      }
      if (e.key.toLowerCase() === 'x' && e.ctrlKey) {
        e.preventDefault();
        handleDeleteItem();
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredItems.length - 1 ? prev + 1 : prev
          );
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;

        case 'Enter':
          e.preventDefault();
          if (!e.repeat && filteredItems[selectedIndex]) {
            handlePasteItem();
          }
          break;

        case 'Backspace':
        case 'Delete':
          if (e.metaKey) {
            e.preventDefault();
            if (filteredItems[selectedIndex]) {
              handleDeleteItem();
            }
          }
          break;

        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filteredItems, selectedIndex, onClose, showActions, actions, selectedActionIndex]
  );

  const formatDate = (timestamp: number): string =>
    new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const getItemIcon = (type: string) => {
    switch (type) {
      case 'image':
        return <ImageIcon className="w-4 h-4" />;
      case 'url':
        return <Link className="w-4 h-4" />;
      case 'file':
        return <FileText className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <div className="w-full h-full flex flex-col" onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Header - transparent background same as main screen */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06]">
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search clipboard history..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-white/95 placeholder-white/45 text-[15px] font-medium tracking-[0.005em]"
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
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-white/[0.06]">
        {['all', 'text', 'image', 'url', 'file'].map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type as any)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              filterType === type
                ? 'bg-white/10 text-white/90'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
            }`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
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
              <p className="text-sm">Loading history...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">No items found</p>
            </div>
          ) : (
            <div className="p-2.5 space-y-1.5">
              {filteredItems.map((item, index) => (
                <div
                  key={item.id}
                  ref={(el) => (itemRefs.current[index] = el)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? 'bg-white/10'
                      : 'hover:bg-white/5'
                  }`}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => handlePasteItem(item)}
                >
                  <div className="flex items-center gap-2.5">
                    {item.type === 'image' ? (
                      <>
                        <img
                          src={`file://${item.content}`}
                          alt="Clipboard"
                          className="w-8 h-8 object-cover rounded flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-white/70 text-sm truncate">
                            Image
                          </div>
                          <div className="text-white/40 text-xs">
                            {item.metadata?.width} × {item.metadata?.height}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-white/40 flex-shrink-0">
                          {getItemIcon(item.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-white/80 text-sm truncate">
                            {item.preview || item.content}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Preview (60%) */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {selectedItem ? (
            <div className="p-5">
              {selectedItem.type === 'image' ? (
                <div>
                  <img
                    src={`file://${selectedItem.content}`}
                    alt="Clipboard"
                    className="w-full rounded-lg border border-white/10"
                  />
                </div>
              ) : (
                <pre className="text-white/80 text-xs whitespace-pre-wrap break-words font-mono leading-normal">
                  {selectedItem.content}
                </pre>
              )}

              <div className="mt-4 pt-3 border-t border-white/[0.08]">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Date</span>
                  <span className="text-white/65 text-right truncate">
                    {formatDate(selectedItem.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Select an item to preview</p>
            </div>
          )}
        </div>
      </div>

      <ExtensionActionFooter
        leftContent={<span className="truncate">{filteredItems.length} items</span>}
        primaryAction={
          selectedItem
            ? {
                label: actions[0].title,
                onClick: () => handlePasteItem(),
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

      {/* Actions Overlay - styled exactly like ActionPanelOverlay */}
      {showActions && (
        <div 
          className="fixed inset-0 z-50" 
          onClick={() => setShowActions(false)}
          style={{ background: 'rgba(0,0,0,0.15)' }}
        >
          <div
            ref={actionsOverlayRef}
            className="absolute bottom-12 right-3 w-80 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl"
            tabIndex={0}
            style={{ 
              background: 'rgba(30,30,34,0.97)', 
              backdropFilter: 'blur(40px)', 
              border: '1px solid rgba(255,255,255,0.08)' 
            }}
            onClick={e => e.stopPropagation()}
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
                      {action.shortcut.map((key, keyIdx) => (
                        <kbd
                          key={`${idx}-${key}-${keyIdx}`}
                          className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] font-medium text-white/70"
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
    </div>
  );
};

export default ClipboardManager;
