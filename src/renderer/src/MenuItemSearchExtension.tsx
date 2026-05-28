import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onThemeChange } from './utils/theme';

type MenuItemInfo = {
  path: string;
  title: string;
  fullPath: string;
  shortcut?: string | null;
  enabled: boolean;
};

interface MenuItemSearchProps {
  show: boolean;
  portalTarget?: HTMLElement | null;
  onClose: () => void;
}

export default function MenuItemSearch({ show, portalTarget, onClose }: MenuItemSearchProps) {
  const [items, setItems] = useState<MenuItemInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [appName, setAppName] = useState('');
  const [themeKey, setThemeKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Theme reactivity
  useEffect(() => {
    const off = onThemeChange(() => setThemeKey((k) => k + 1));
    return off;
  }, []);

  // Load menu items when shown
  useEffect(() => {
    if (!show) return;
    setLoading(true);
    setError(null);
    setQuery('');
    setSelectedIndex(0);

    // Get frontmost app name
    window.electron.getFrontmostApplication().then((app) => {
      if (app) setAppName(app.name);
    });

    window.electron.getAppMenuItems().then((result) => {
      setLoading(false);
      if (result.ok && result.items) {
        setItems(result.items);
      } else {
        setError(result.error || 'Failed to load menu items');
      }
    });
  }, [show]);

  // Focus input when shown
  useEffect(() => {
    if (show) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [show]);

  // Filter items
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.fullPath.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q),
    );
  }, [items, query]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Execute a menu item
  const executeItem = useCallback(
    async (item: MenuItemInfo) => {
      const result = await window.electron.pressAppMenuItem(item.fullPath);
      if (result.ok) {
        onClose();
      } else {
        setError(result.error || 'Failed to execute menu item');
      }
    },
    [onClose],
  );

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[selectedIndex]) {
            executeItem(filtered[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, executeItem, onClose],
  );

  if (!show) return null;

  const content = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 580,
          maxHeight: '70vh',
          borderRadius: 16,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(30,30,30,0.95)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
            {appName ? `Menu Items — ${appName}` : 'Menu Items'}
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search menu items…"
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'rgba(255,255,255,0.9)',
              fontSize: 18,
              fontWeight: 500,
              padding: '4px 0',
            }}
          />
        </div>

        {/* Results */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {loading && (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              Loading menu items…
            </div>
          )}
          {error && (
            <div style={{ padding: '16px 20px', color: '#f87171', fontSize: 13 }}>
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              {query ? 'No matching menu items' : 'No menu items found'}
            </div>
          )}
          {filtered.map((item, i) => (
            <div
              key={item.fullPath + i}
              data-index={i}
              onClick={() => executeItem(item)}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 20px',
                cursor: 'pointer',
                background: i === selectedIndex ? 'rgba(255,255,255,0.08)' : 'transparent',
                borderRadius: 8,
                margin: '0 6px',
                opacity: item.enabled ? 1 : 0.4,
                transition: 'background 0.1s',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>
                  {item.title}
                </div>
                {item.path && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.path}
                  </div>
                )}
              </div>
              {item.shortcut && (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginLeft: 12, flexShrink: 0, fontFamily: 'monospace' }}>
                  {item.shortcut}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
            {filtered.length} items
          </span>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
            <span>↑↓ Navigate</span>
            <span>↵ Execute</span>
            <span>Esc Close</span>
          </div>
        </div>
      </div>
    </div>
  );

  if (portalTarget) return createPortal(content, portalTarget);
  return content;
}
