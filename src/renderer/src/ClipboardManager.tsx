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
  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass =
    document.documentElement.classList.contains('sc-native-liquid-glass') ||
    document.body.classList.contains('sc-native-liquid-glass');

  const focusSearchInput = useCallback(() => {
    // Defer focus to the next frame so window/show transitions don't steal it.
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  }, []);

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
    focusSearchInput();
    const focusTimer = window.setTimeout(() => {
      focusSearchInput();
    }, 40);
    window.electron.getLastFrontmostApp().then((app) => {
      if (app) setFrontmostAppName(app.name);
    });
    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [loadHistory, focusSearchInput]);

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
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--ui-divider)]">
        <button
          onClick={onClose}
          className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0 focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
          tabIndex={-1}
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
          className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] text-[15px] font-medium tracking-[0.005em]"
          autoFocus
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-[var(--ui-divider)]">
        {['all', 'text', 'image', 'url', 'file'].map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type as any)}
            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
              filterType === type
                ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)] border-[var(--ui-segment-border)]'
                : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)] hover:border-[var(--ui-segment-border)] hover:bg-[var(--ui-segment-hover-bg)]'
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
          className="w-[40%] overflow-y-auto custom-scrollbar border-r border-[var(--ui-divider)]"
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
              <p className="text-sm">Loading history...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
              <p className="text-sm">No items found</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredItems.map((item, index) => (
                <div
                  key={item.id}
                  ref={(el) => (itemRefs.current[index] = el)}
                  className={`px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? 'bg-[var(--launcher-card-selected-bg)] border-transparent'
                      : 'border-transparent hover:border-[var(--launcher-card-border)] hover:bg-[var(--launcher-card-hover-bg)]'
                  }`}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => handlePasteItem(item)}
                >
                  <div className="flex items-center gap-2">
                    {item.type === 'image' ? (
                      <>
                        <img
                          src={`file://${item.content}`}
                          alt="Clipboard"
                          className="w-7 h-7 object-cover rounded flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[var(--text-secondary)] text-[13px] truncate leading-tight">
                            Image
                          </div>
                          <div className="text-[var(--text-muted)] text-[11px] leading-tight">
                            {item.metadata?.width} × {item.metadata?.height}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-[var(--text-muted)] flex-shrink-0">
                          {getItemIcon(item.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[var(--text-secondary)] text-[13px] truncate">
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
            <div className={selectedItem.type === 'image' ? 'p-1' : 'p-5'}>
              {selectedItem.type === 'image' ? (
                <div className="flex items-center justify-center">
                  <img
                    src={`file://${selectedItem.content}`}
                    alt="Clipboard"
                    className="w-full object-contain"
                    style={{ maxHeight: 'calc(75vh - 80px)' }}
                  />
                </div>
              ) : (
                <pre className="text-[var(--text-secondary)] text-xs whitespace-pre-wrap break-words font-mono leading-normal">
                  {selectedItem.content}
                </pre>
              )}

              <div className={selectedItem.type === 'image' ? 'px-5 pb-5 pt-3 border-t border-[var(--ui-divider)]' : 'mt-4 pt-3 border-t border-[var(--ui-divider)]'}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-[var(--text-subtle)]">Date</span>
                  <span className="text-[var(--text-muted)] text-right truncate">
                    {formatDate(selectedItem.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
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
            onFocus={(e) => {
              (e.currentTarget as HTMLDivElement).style.outline = 'none';
            }}
            onClick={e => e.stopPropagation()}
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
    </div>
  );
};

export default ClipboardManager;
