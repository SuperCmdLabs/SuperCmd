/**
 * Clipboard Manager UI
 * 
 * Features:
 * - 40/60 split (list/preview)
 * - Actions button styled exactly like List component
 * - Matches settings window theme
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Trash2, Copy, Clipboard, Image as ImageIcon, Link, FileText } from 'lucide-react';
import type { ClipboardItem } from '../types/electron';

interface ClipboardManagerProps {
  onClose: () => void;
}

interface Action {
  title: string;
  icon?: React.ReactNode;
  shortcut?: string;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const history = await window.electron.clipboardGetHistory();
      setItems(history);
    } catch (e) {
      console.error('Failed to load clipboard history:', e);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadHistory();
    inputRef.current?.focus();
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
    setSelectedIndex(0);
  }, [items, filterType, searchQuery]);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, filteredItems.length);
  }, [filteredItems.length]);

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

  const handlePasteItem = async (item?: ClipboardItem) => {
    const itemToPaste = item || filteredItems[selectedIndex];
    if (!itemToPaste) return;
    
    try {
      // Copy to clipboard
      const success = await window.electron.clipboardCopyItem(itemToPaste.id);
      if (!success) {
        console.error('Failed to copy to clipboard');
        return;
      }
      
      // Small delay to ensure clipboard is ready
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Close window so user can paste
      window.electron.hideWindow();
      
      // Log success
      console.log('Item copied to clipboard, window closed. Press Cmd+V to paste.');
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

  const actions: Action[] = [
    {
      title: 'Paste',
      execute: () => handlePasteItem(),
    },
    {
      title: 'Copy to Clipboard',
      execute: handleCopyToClipboard,
    },
    {
      title: 'Delete',
      execute: () => handleDeleteItem(),
      style: 'destructive',
    },
    {
      title: 'Delete All Entries',
      execute: handleClearAll,
      style: 'destructive',
    },
  ];

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'k' && e.metaKey && !e.repeat) {
        e.preventDefault();
        setShowActions(p => !p);
        return;
      }

      if (showActions) return;

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
          if (e.metaKey || e.ctrlKey) {
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
    [filteredItems, selectedIndex, onClose, showActions]
  );

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search clipboard history..."
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
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5 px-5 py-3 border-b border-white/[0.06]">
        {['all', 'text', 'image', 'url', 'file'].map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type as any)}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${
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
              <div className="mb-4">
                <div className="text-white/50 text-xs uppercase tracking-wider">
                  {selectedItem.type}
                </div>
              </div>

              {selectedItem.type === 'image' ? (
                <div>
                  <img
                    src={`file://${selectedItem.content}`}
                    alt="Clipboard"
                    className="w-full rounded-lg border border-white/10"
                  />
                  <div className="mt-4 space-y-1.5">
                    <div className="text-white/50 text-sm">
                      <span className="text-white/30">Dimensions:</span>{' '}
                      {selectedItem.metadata?.width} × {selectedItem.metadata?.height}
                    </div>
                    <div className="text-white/50 text-sm">
                      <span className="text-white/30">Size:</span>{' '}
                      {selectedItem.metadata?.size && formatFileSize(selectedItem.metadata.size)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <pre className="text-white/80 text-sm whitespace-pre-wrap break-words font-mono leading-relaxed">
                    {selectedItem.content}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Select an item to preview</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer - same background as main screen */}
      <div className="flex items-center px-4 py-3.5 border-t border-white/[0.06]" style={{ background: 'rgba(18,18,22,0.85)' }}>
        <div className="flex items-center gap-2 text-white/40 text-xs flex-1 min-w-0 font-medium">
          <span className="truncate">{filteredItems.length} items</span>
        </div>
        {selectedItem && (
          <div className="flex items-center gap-2 mr-3">
            <span className="text-white text-xs font-semibold">{actions[0].title}</span>
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

      {/* Actions Overlay - styled exactly like ActionPanelOverlay */}
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
              border: '1px solid rgba(255,255,255,0.08)' 
            }}
            onClick={e => e.stopPropagation()}
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

export default ClipboardManager;
