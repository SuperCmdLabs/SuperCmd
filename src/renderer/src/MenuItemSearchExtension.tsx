/**
 * Menu Item Search — Inline launcher view.
 * Matches the Notes / Canvas / Clipboard search format (snippet-view chrome,
 * ExtensionActionFooter, actions overlay). Enumerates and presses menu items of
 * the app that was frontmost before the launcher opened.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Menu as MenuIcon, X } from 'lucide-react';
import ExtensionActionFooter from './components/ExtensionActionFooter';

type MenuItemInfo = {
  path: string;
  title: string;
  fullPath: string;
  shortcut?: string | null;
  enabled: boolean;
};

interface Action {
  title: string;
  icon?: React.ReactNode;
  shortcut?: string[];
  execute: () => void | Promise<void>;
  style?: 'default' | 'destructive';
  section?: string;
}

interface MenuItemSearchProps {
  onClose: () => void;
}

// Map a keydown event to the same shortcut-glyph string the Swift helper emits
// (modifier order ⌃⌥⇧⌘, then the key), so we can match an item's displayed
// shortcut and invoke it. Returns null when no command modifier is held.
const EVENT_KEY_GLYPHS: Record<string, string> = {
  Backspace: '⌫', Tab: '⇥', Enter: '↩', Return: '↩', Escape: '⎋', Delete: '⌦',
  ' ': '␣', Spacebar: '␣',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Home: '↖', End: '↘', PageUp: '⇞', PageDown: '⇟',
};
function eventToShortcut(e: KeyboardEvent): string | null {
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return null; // need a command modifier
  let key = '';
  if (EVENT_KEY_GLYPHS[e.key]) key = EVENT_KEY_GLYPHS[e.key];
  else if (e.key.length === 1) key = e.key.toUpperCase();
  else return null; // unknown / pure modifier press
  let s = '';
  if (e.ctrlKey) s += '⌃';
  if (e.altKey) s += '⌥';
  if (e.shiftKey) s += '⇧';
  if (e.metaKey) s += '⌘';
  return s + key;
}

const MenuItemSearch: React.FC<MenuItemSearchProps> = ({ onClose }) => {
  const [items, setItems] = useState<MenuItemInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [appName, setAppName] = useState('');
  const [appIcon, setAppIcon] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Load the target app's menu items. The handler also returns the app name +
  // icon (resolved from the same app the menus came from), so we don't depend
  // on getFrontmostApplication's path being populated.
  const reloadRef = useRef(0);
  const loadMenuItems = useCallback(() => {
    const seq = ++reloadRef.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setSelectedIndex(0);
    setSearchQuery('');
    window.electron.getAppMenuItems().then((result) => {
      if (reloadRef.current !== seq) return; // a newer reload superseded this one
      setLoading(false);
      setAppName(result.appName || '');
      setAppIcon(result.appIconDataUrl || null);
      if (result.ok && result.items) {
        setItems(result.items);
      } else {
        setError(result.error || 'Failed to load menu items');
      }
    });
  }, []);

  useEffect(() => { loadMenuItems(); }, [loadMenuItems]);

  // Re-fetch whenever the launcher is shown again — the frontmost app may have
  // changed, and the stale previous app's menus must not persist.
  useEffect(() => {
    const cleanup = window.electron.onWindowShown(() => loadMenuItems());
    return cleanup;
  }, [loadMenuItems]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => { setSelectedIndex(0); }, [searchQuery]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.fullPath.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q),
    );
  }, [items, searchQuery]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const selectedItem = filtered[selectedIndex] || null;

  const executeItem = useCallback(
    async (item?: MenuItemInfo | null) => {
      const target = item || selectedItem;
      if (!target || !target.enabled) return;
      // Hide the launcher first so the target app comes forward and the menu
      // action applies to it (the launcher panel is frontmost while open).
      try { await window.electron.hideWindow(); } catch {}
      const result = await window.electron.pressAppMenuItem(target.fullPath);
      onClose();
      if (!result.ok) {
        console.warn('[MenuItemSearch] press failed:', result.error);
      }
    },
    [selectedItem, onClose],
  );

  const actions: Action[] = useMemo(() => {
    const a: Action[] = [];
    if (selectedItem) {
      a.push({
        title: 'Open Menu Item',
        icon: <MenuIcon size={14} />,
        shortcut: ['↩'],
        section: 'actions',
        execute: () => { void executeItem(selectedItem); setShowActions(false); },
      });
    }
    return a;
  }, [selectedItem, executeItem]);

  // Keyboard (global listener, matches Notes/Canvas search).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showActions) return; // actions overlay handles its own keys
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'Backspace' && !searchQuery) { e.preventDefault(); onClose(); return; }
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setShowActions(true); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && selectedItem) { e.preventDefault(); void executeItem(selectedItem); return; }

      // Invoke a menu item by pressing its own displayed shortcut (e.g. ⌘T).
      const combo = eventToShortcut(e);
      if (combo) {
        const match = items.find((it) => it.enabled && it.shortcut === combo);
        if (match) {
          e.preventDefault();
          void executeItem(match);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, filtered.length, selectedItem, showActions, searchQuery, onClose, executeItem]);

  const renderBreadcrumb = (item: MenuItemInfo) => {
    // fullPath already begins with the top-level menu, so don't prepend the app
    // name (it would duplicate it). Every parent segment is muted; only the
    // leaf (last segment) is bright.
    const segments = item.fullPath.split('>').map((c) => c.trim()).filter(Boolean);
    return (
      <div className="flex items-center gap-1.5 min-w-0 text-[13px] leading-tight">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <React.Fragment key={`${seg}-${i}`}>
              <span className={isLast ? 'text-[var(--text-primary)] font-medium truncate' : 'text-[var(--text-subtle)] flex-shrink-0'}>{seg}</span>
              {!isLast ? <ChevronRight className="w-3 h-3 text-[var(--text-disabled)] flex-shrink-0" /> : null}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // Split a shortcut string ("⇧⌘X") into chip tokens: each leading modifier
  // glyph is its own chip, then the remaining key is one chip.
  const MODIFIER_GLYPHS = new Set(['⌘', '⌥', '⇧', '⌃']);
  const renderShortcut = (shortcut: string) => {
    const chars = [...shortcut];
    const tokens: string[] = [];
    let i = 0;
    while (i < chars.length && MODIFIER_GLYPHS.has(chars[i])) { tokens.push(chars[i]); i += 1; }
    const key = chars.slice(i).join('');
    if (key) tokens.push(key);
    return (
      <span className="flex items-center gap-1 flex-shrink-0">
        {tokens.map((tok, idx) => (
          <kbd
            key={idx}
            className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-[5px] bg-[var(--kbd-bg)] text-[12px] text-[var(--text-secondary)] font-medium"
          >
            {tok}
          </kbd>
        ))}
      </span>
    );
  };

  return (
    <div className="snippet-view flex flex-col h-full">
      {/* ─── Header (matches snippet-header) ─── */}
      <div className="snippet-header drag-region flex h-16 items-center gap-2 px-4">
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          tabIndex={-1}
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="relative min-w-0 flex-1">
          <div className="flex h-full items-center">
            <input
              ref={inputRef}
              type="text"
              placeholder="Filter by menu item title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-w-0 w-full bg-transparent border-none outline-none text-white/95 placeholder:text-[color:var(--text-subtle)] text-[15px] font-medium tracking-[0.005em]"
              autoFocus
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {appName && (
            <div className="flex items-center gap-1.5 text-white/55 text-[13px] font-medium">
              <span className="truncate max-w-[160px]">{appName}</span>
              {appIcon ? <img src={appIcon} alt="" className="w-4 h-4 object-contain" draggable={false} /> : null}
            </div>
          )}
        </div>
      </div>

      {/* ─── List ─── */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center h-full text-white/30 text-sm">Loading menu items…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-full px-8 text-center text-[#f87171] text-[13px] leading-snug">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/30 text-sm">
            {searchQuery ? 'No matching menu items' : 'No menu items found'}
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filtered.map((item, index) => (
              <div
                key={`${item.fullPath}-${index}`}
                ref={(el) => (itemRefs.current[index] = el)}
                className={`px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                  index === selectedIndex
                    ? 'bg-[var(--launcher-card-selected-bg)] border-[var(--launcher-card-border)]'
                    : 'border-transparent hover:bg-[var(--launcher-card-hover-bg)] hover:border-[var(--launcher-card-border)]'
                } ${item.enabled ? '' : 'opacity-40'}`}
                onClick={() => setSelectedIndex(index)}
                onMouseEnter={() => setSelectedIndex(index)}
                onDoubleClick={() => void executeItem(item)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {appIcon ? (
                    <img src={appIcon} alt="" className="w-[18px] h-[18px] object-contain flex-shrink-0" draggable={false} />
                  ) : (
                    <MenuIcon className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">{renderBreadcrumb(item)}</div>
                  {item.shortcut ? <div className="ml-2">{renderShortcut(item.shortcut)}</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Footer (matches snippet footer) ─── */}
      <ExtensionActionFooter
        leftContent={
          <div className="flex items-center gap-2 min-w-0">
            <MenuIcon className="w-4 h-4 text-white/45" />
            <span className="truncate">{filtered.length} menu items</span>
          </div>
        }
        primaryAction={
          selectedItem
            ? { label: 'Open', onClick: () => void executeItem(selectedItem), disabled: !selectedItem.enabled, shortcut: ['↩'] }
            : undefined
        }
        actionsButton={{ label: 'Actions', onClick: () => setShowActions(true), shortcut: ['⌘', 'K'] }}
      />

      {/* ─── Actions Overlay ─── */}
      {showActions && <MenuActionsOverlay actions={actions} onClose={() => setShowActions(false)} />}
    </div>
  );
};

// ─── Actions Overlay (same style as Notes/Canvas search) ─────────────
const MenuActionsOverlay: React.FC<{ actions: Action[]; onClose: () => void }> = ({ actions, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter((a) => a.title.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => { setSelectedIdx(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const items = listRef.current?.querySelectorAll('[data-action-item]');
    (items?.[selectedIdx] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSelectedIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && filtered[selectedIdx]) { e.preventDefault(); e.stopPropagation(); void filtered[selectedIdx].execute(); return; }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filtered, selectedIdx, onClose]);

  const isGlassyTheme = document.documentElement.classList.contains('sc-glassy') || document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass = document.documentElement.classList.contains('sc-native-liquid-glass') || document.body.classList.contains('sc-native-liquid-glass');
  const panelStyle: React.CSSProperties = isNativeLiquidGlass
    ? { background: 'rgba(var(--surface-base-rgb), 0.72)', backdropFilter: 'blur(44px) saturate(155%)', WebkitBackdropFilter: 'blur(44px) saturate(155%)', border: '1px solid rgba(var(--on-surface-rgb), 0.22)', boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26), inset 0 -1px 0 0 rgba(var(--on-surface-rgb), 0.05)' }
    : isGlassyTheme
    ? { background: 'linear-gradient(160deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.035) 38%, rgba(255,255,255,0.07) 100%), rgba(var(--surface-base-rgb), 0.58)', backdropFilter: 'blur(128px) saturate(195%) contrast(107%) brightness(1.03)', WebkitBackdropFilter: 'blur(128px) saturate(195%) contrast(107%) brightness(1.03)', border: '1px solid rgba(255, 255, 255, 0.14)', boxShadow: '0 28px 58px -14px rgba(0,0,0,0.42), inset 0 -1px 0 0 rgba(0,0,0,0.08)' }
    : { background: 'var(--card-bg)', backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)', border: '1px solid var(--border-primary)' };
  const panelClassName = (isNativeLiquidGlass || isGlassyTheme) ? 'rounded-3xl p-1' : 'rounded-xl shadow-2xl';

  return (
    <div className="fixed inset-0 z-[9999]" style={{ background: 'var(--bg-scrim)' }}>
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className={`absolute bottom-12 right-3 w-80 max-h-[65vh] overflow-hidden flex flex-col ${panelClassName}`}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 border-b border-[var(--ui-divider)]">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for actions..."
            className="w-full bg-transparent text-[var(--text-primary)] text-[13px] placeholder:text-[var(--text-subtle)] outline-none"
          />
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar py-1">
          {filtered.map((action, idx) => (
            <div
              key={action.title}
              data-action-item
              onClick={() => void action.execute()}
              onMouseEnter={() => setSelectedIdx(idx)}
              className={`flex items-center gap-3 px-3 py-[7px] cursor-pointer transition-colors ${action.style === 'destructive' ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}
              style={idx === selectedIdx ? { background: 'rgba(255,255,255,0.08)' } : undefined}
            >
              <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center opacity-60">{action.icon}</span>
              <span className="flex-1 text-[12px]">{action.title}</span>
              {action.shortcut && (
                <span className="flex items-center gap-0.5 flex-shrink-0">
                  {action.shortcut.map((k, ki) => (
                    <kbd key={ki} className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded bg-[var(--kbd-bg)] text-[10px] text-[var(--text-subtle)] font-medium">{k}</kbd>
                  ))}
                </span>
              )}
            </div>
          ))}
          {filtered.length === 0 && <div className="px-3 py-4 text-center text-[11px] text-[var(--text-disabled)]">No actions found</div>}
        </div>
      </div>
    </div>
  );
};

export default MenuItemSearch;
