/**
 * AiChatView.tsx
 *
 * Multi-turn AI chat panel (Raycast-style, single-column).
 * Header: back arrow + single-line "Ask follow-up…" input
 * Body: list of QA cards; newest card scrolls to top (old cards slide up)
 * Footer: SuperCmd logo + "Ask AI" label, plain "Actions ⌘K" text button
 *
 * Popups:
 * - Actions overlay: mirrors NotesManager ActionsOverlay (bottom-right panel, search)
 * - History overlay: mirrors NotesManager BrowseOverlay (centered 360px modal)
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ArrowLeft, Plus, ChevronLeft, ChevronRight, History, Trash2, Eraser, Sparkles, Copy, Check } from 'lucide-react';
import { renderSimpleMarkdown } from '../raycast-api/detail-markdown';
import type { AiMessage, AiConversation } from '../hooks/useAiChat';
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog';
import supercmdLogo from '../../../../supercmd.png';

interface AiChatViewProps {
  alwaysMountedRunners: React.ReactNode;
  aiQuery: string;
  setAiQuery: (query: string) => void;
  messages: AiMessage[];
  aiStreaming: boolean;
  aiInputRef: React.RefObject<HTMLInputElement>;
  aiResponseRef: React.RefObject<HTMLDivElement>;
  conversations: AiConversation[];
  activeConversationId: string | null;
  sendMessage: (text: string) => void;
  stopStreaming: () => void;
  newChat: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  exitAiMode: () => void;
}

// ─── Menu panel style (matches launcher + NotesManager) ──────────────

function getMenuPanelStyle(): { className: string; style: React.CSSProperties } {
  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass =
    document.documentElement.classList.contains('sc-native-liquid-glass') ||
    document.body.classList.contains('sc-native-liquid-glass');

  const className = (isNativeLiquidGlass || isGlassyTheme)
    ? 'rounded-3xl p-1'
    : 'rounded-xl shadow-2xl';

  const style: React.CSSProperties = isNativeLiquidGlass
    ? {
        background: 'rgba(var(--surface-base-rgb), 0.72)',
        backdropFilter: 'blur(44px) saturate(155%)',
        WebkitBackdropFilter: 'blur(44px) saturate(155%)' as any,
        border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
        boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26), inset 0 -1px 0 0 rgba(var(--on-surface-rgb), 0.05)',
      }
    : isGlassyTheme
    ? {
        background: 'linear-gradient(160deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.035) 38%, rgba(255,255,255,0.07) 100%), rgba(var(--surface-base-rgb), 0.58)',
        backdropFilter: 'blur(128px) saturate(195%) contrast(107%) brightness(1.03)',
        WebkitBackdropFilter: 'blur(128px) saturate(195%) contrast(107%) brightness(1.03)' as any,
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: '0 28px 58px -14px rgba(0,0,0,0.42), inset 0 -1px 0 0 rgba(0,0,0,0.08)',
      }
    : {
        background: 'linear-gradient(var(--card-bg), var(--card-bg)), var(--bg-primary)',
        border: '1px solid var(--border-primary)',
      };

  return { className, style };
}

// ─── QA pair grouping ────────────────────────────────────────────────

interface QAPair {
  id: string;
  question: string;
  answer: AiMessage | null;
}

function groupIntoPairs(messages: AiMessage[]): QAPair[] {
  const pairs: QAPair[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'user') {
      const next = messages[i + 1];
      if (next && next.role === 'assistant') {
        pairs.push({ id: m.id, question: m.content, answer: next });
        i += 2;
      } else {
        pairs.push({ id: m.id, question: m.content, answer: null });
        i += 1;
      }
    } else {
      pairs.push({ id: m.id, question: '', answer: m });
      i += 1;
    }
  }
  return pairs;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── QA Card ────────────────────────────────────────────────────────

const QACard: React.FC<{ pair: QAPair; isStreaming: boolean }> = ({ pair, isStreaming }) => {
  const answerContent = pair.answer?.content || '';
  const cancelled = pair.answer?.cancelled;
  const showThinking = isStreaming && !answerContent;
  const showAssistantRow = showThinking || answerContent || cancelled;
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!answerContent) return;
    navigator.clipboard.writeText(answerContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }, [answerContent]);

  return (
    <div className="flex flex-col gap-3">
      {/* User question — right-aligned bubble */}
      {pair.question && (
        <div className="flex justify-end">
          <div
            className="max-w-[85%] px-3.5 py-2 text-[13.5px] leading-snug whitespace-pre-wrap break-words"
            style={{
              background: 'var(--accent-soft)',
              color: 'var(--text-primary)',
              border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)',
              borderRadius: '16px 16px 4px 16px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            }}
          >
            {pair.question}
          </div>
        </div>
      )}

      {/* Assistant answer — sparkle glyph + prose, no card */}
      {showAssistantRow && (
        <div className="group relative flex gap-3">
          <div
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 relative"
            style={{
              background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
              color: 'var(--accent)',
            }}
          >
            <Sparkles size={13} strokeWidth={2.25} />
            {isStreaming && (
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full"
                style={{
                  boxShadow: '0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent)',
                  animation: 'sc-ai-pulse 1.6s ease-out infinite',
                }}
              />
            )}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            {showThinking ? (
              <div className="flex flex-col gap-1.5 pt-1">
                <div
                  className="h-2.5 rounded-full sc-ai-shimmer"
                  style={{ width: '78%' }}
                />
                <div
                  className="h-2.5 rounded-full sc-ai-shimmer"
                  style={{ width: '62%', animationDelay: '0.15s' }}
                />
                <div
                  className="h-2.5 rounded-full sc-ai-shimmer"
                  style={{ width: '44%', animationDelay: '0.3s' }}
                />
              </div>
            ) : answerContent ? (
              <div
                className="text-[14px] leading-[1.65] text-[var(--text-primary)] ai-markdown sc-ai-selectable"
                style={cancelled ? { opacity: 0.75 } : undefined}
              >
                {renderSimpleMarkdown(answerContent, (src) => src)}
                {isStreaming && (
                  <span
                    aria-hidden="true"
                    className="inline-block align-[-2px] ml-0.5"
                    style={{
                      width: '6px',
                      height: '14px',
                      background: 'var(--accent)',
                      borderRadius: '1.5px',
                      animation: 'sc-ai-caret 1.1s steps(2) infinite',
                    }}
                  />
                )}
              </div>
            ) : null}
            {cancelled && (
              <div
                className="mt-2 inline-flex items-center gap-1.5 text-[11px]"
                style={{ color: 'var(--danger, #ef4444)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--danger, #ef4444)' }}
                />
                Response cancelled
              </div>
            )}
          </div>
          {answerContent && !isStreaming && (
            <button
              type="button"
              onClick={handleCopy}
              title={copied ? 'Copied' : 'Copy'}
              aria-label={copied ? 'Copied' : 'Copy response'}
              className={`absolute top-0 right-0 inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] transition-opacity ${
                copied ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
              }`}
              style={{
                background: 'var(--ui-segment-active-bg)',
                border: '1px solid var(--ui-segment-border)',
                color: copied ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Actions Overlay (launcher-style) ───────────────────────────────

interface ActionItem {
  id: string;
  title: string;
  icon: React.ReactNode;
  shortcut: string[];
  onRun: () => void;
  danger?: boolean;
  section?: string;
}

const ActionsOverlay: React.FC<{ actions: ActionItem[]; onClose: () => void }> = ({ actions, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter((a) => a.title.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => setSelectedIdx(0), [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const items = listRef.current?.querySelectorAll('[data-action-item]');
    (items?.[selectedIdx] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && filtered[selectedIdx]) {
        e.preventDefault();
        e.stopPropagation();
        filtered[selectedIdx].onRun();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filtered, selectedIdx, onClose]);

  // Group by section, preserving order
  const grouped = useMemo(() => {
    const groups: Array<{ section: string; items: ActionItem[] }> = [];
    let current = '__init__';
    for (const a of filtered) {
      const section = a.section || '';
      if (section !== current) {
        groups.push({ section, items: [] });
        current = section;
      }
      groups[groups.length - 1].items.push(a);
    }
    return groups;
  }, [filtered]);

  const panel = getMenuPanelStyle();
  let flatIdx = 0;

  return (
    <div className="fixed inset-0 z-[9999]" style={{ background: 'var(--bg-scrim)' }}>
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className={`absolute bottom-12 right-3 w-80 max-h-[65vh] overflow-hidden flex flex-col ${panel.className}`}
        style={panel.style}
        onClick={(e) => e.stopPropagation()}
      >
        <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-[var(--text-disabled)] text-sm">No matching actions</div>
          ) : (
            grouped.map((group, gi) => (
              <div key={group.section || `__${gi}`}>
                {gi > 0 && <hr className="border-[var(--ui-divider)] my-0.5" />}
                {group.section && (
                  <div className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--text-subtle)] font-medium select-none">
                    {group.section}
                  </div>
                )}
                {group.items.map((action) => {
                  const idx = flatIdx++;
                  return (
                    <div
                      key={action.id}
                      data-action-item
                      onClick={() => { action.onRun(); onClose(); }}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={`flex items-center gap-3 px-3 py-[7px] cursor-pointer transition-colors ${action.danger ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}
                      style={idx === selectedIdx ? { background: 'rgba(255,255,255,0.08)' } : undefined}
                    >
                      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center opacity-60">
                        {action.icon}
                      </span>
                      <span className="flex-1 text-[12px]">{action.title}</span>
                      <span className="flex items-center gap-0.5 flex-shrink-0">
                        {action.shortcut.map((k, ki) => (
                          <kbd key={ki} className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded bg-[var(--kbd-bg)] text-[10px] text-[var(--text-subtle)] font-medium">
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="border-t border-[var(--ui-divider)] px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for actions..."
            className="w-full bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-subtle)] outline-none"
          />
        </div>
      </div>
    </div>
  );
};

// ─── History Overlay (Browse-style centered modal) ──────────────────

const HistoryOverlay: React.FC<{
  conversations: AiConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}> = ({ conversations, activeId, onSelect, onDelete, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return conversations;
    const q = query.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [conversations, query]);

  useEffect(() => setSelectedIdx(0), [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const items = listRef.current?.querySelectorAll('[data-history-item]');
    (items?.[selectedIdx] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' && filtered[selectedIdx]) {
        e.preventDefault();
        onSelect(filtered[selectedIdx].id);
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filtered, selectedIdx, onSelect, onClose]);

  const panel = getMenuPanelStyle();

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0" onClick={onClose} style={{ background: 'var(--bg-scrim)' }} />
      <div
        className={`relative z-10 w-full max-w-[360px] mx-4 overflow-hidden ${panel.className}`}
        style={panel.style}
      >
        <div className="px-3 py-2.5 border-b border-[var(--ui-divider)]">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for chats..."
            className="w-full bg-transparent text-[var(--text-primary)] text-[13px] placeholder:text-[var(--text-subtle)] outline-none"
          />
        </div>
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-[10px] font-semibold text-[var(--text-subtle)] uppercase tracking-wider">Chats</span>
          <span className="text-[10px] text-[var(--text-disabled)]">{filtered.length} chats</span>
        </div>
        <div ref={listRef} className="max-h-[280px] overflow-y-auto custom-scrollbar">
          {filtered.map((c, idx) => {
            const isCurrent = c.id === activeId;
            const isSelected = idx === selectedIdx;
            const charCount = c.messages.reduce((n, m) => n + m.content.length, 0);
            return (
              <div
                key={c.id}
                data-history-item
                onClick={() => { onSelect(c.id); onClose(); }}
                onMouseEnter={() => setSelectedIdx(idx)}
                className="group px-3 py-2 cursor-pointer transition-colors"
                style={isSelected ? { background: 'rgba(255,255,255,0.08)' } : undefined}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--text-primary)] font-medium truncate flex-1">
                    {c.title || 'New Chat'}
                  </span>
                  <div className={`flex items-center gap-0.5 flex-shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                    <button
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                      className="p-1 rounded text-[var(--text-subtle)] hover:text-red-400 hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {isCurrent ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
                      <span className="text-[10px] text-[var(--text-muted)]">Current</span>
                    </>
                  ) : (
                    <span className="text-[10px] text-[var(--text-disabled)]">{formatRelativeTime(c.updatedAt)}</span>
                  )}
                  <span className="text-[10px] text-[var(--text-disabled)]">&middot;</span>
                  <span className="text-[10px] text-[var(--text-disabled)]">{c.messages.length} messages</span>
                  <span className="text-[10px] text-[var(--text-disabled)]">&middot;</span>
                  <span className="text-[10px] text-[var(--text-disabled)]">{charCount} chars</span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-[11px] text-[var(--text-disabled)]">
              No chats found
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Main View ──────────────────────────────────────────────────────

const AiChatView: React.FC<AiChatViewProps> = ({
  alwaysMountedRunners,
  aiQuery,
  setAiQuery,
  messages,
  aiStreaming,
  aiInputRef,
  aiResponseRef,
  conversations,
  activeConversationId,
  sendMessage,
  stopStreaming,
  newChat,
  selectConversation,
  deleteConversation,
  exitAiMode,
}) => {
  const pairs = useMemo(() => groupIntoPairs(messages), [messages]);
  const prevPairCountRef = useRef(pairs.length);
  const pairRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const spacerRef = useRef<HTMLDivElement>(null);

  const [actionsOpen, setActionsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirm, setConfirm] = useState<
    | {
        title: string;
        target?: string;
        message?: React.ReactNode;
        confirmLabel: string;
        onConfirm: () => void;
      }
    | null
  >(null);

  // Keep the latest card pinned to the TOP of the viewport:
  // when a new pair is added, scroll so the new card's top edge aligns with
  // the top of the scroll area (accounting for container padding).
  useEffect(() => {
    if (pairs.length > prevPairCountRef.current) {
      const lastId = pairs[pairs.length - 1]?.id;
      const container = aiResponseRef.current;
      const r = requestAnimationFrame(() => {
        const el = lastId ? pairRefs.current.get(lastId) : null;
        if (!el || !container) return;
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const paddingTop = parseFloat(getComputedStyle(container).paddingTop) || 0;
        const delta = elRect.top - containerRect.top - paddingTop;
        container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
      });
      return () => cancelAnimationFrame(r);
    }
    prevPairCountRef.current = pairs.length;
  }, [pairs.length, aiResponseRef]);

  // Ensure spacer is tall enough to allow latest card to reach the top of the viewport.
  // spacerHeight = (visible content area) - card.offsetHeight
  useEffect(() => {
    const container = aiResponseRef.current;
    const spacer = spacerRef.current;
    if (!container || !spacer || pairs.length === 0) return;
    const lastId = pairs[pairs.length - 1]?.id;
    const el = lastId ? pairRefs.current.get(lastId) : null;
    if (!el) return;
    const cs = getComputedStyle(container);
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const paddingBottom = parseFloat(cs.paddingBottom) || 0;
    const visible = container.clientHeight - paddingTop - paddingBottom;
    const target = Math.max(0, visible - el.offsetHeight);
    spacer.style.height = `${target}px`;
  }, [pairs, aiResponseRef]);

  // Navigation across conversations: conversations[] is newest-first.
  const activeIdx = conversations.findIndex((c) => c.id === activeConversationId);
  const hasPrev = activeIdx >= 0 && activeIdx < conversations.length - 1;
  const hasNext = activeIdx > 0;
  const hasCurrentChat = pairs.length > 0;
  const hasHistory = conversations.length > 0;

  const goPrevChat = useCallback(() => {
    if (!hasPrev) return;
    selectConversation(conversations[activeIdx + 1].id);
  }, [hasPrev, activeIdx, conversations, selectConversation]);

  const goNextChat = useCallback(() => {
    if (!hasNext) return;
    selectConversation(conversations[activeIdx - 1].id);
  }, [hasNext, activeIdx, conversations, selectConversation]);

  const deleteCurrentChat = useCallback(() => {
    if (!activeConversationId) {
      newChat();
      return;
    }
    const active = conversations.find((c) => c.id === activeConversationId);
    setConfirm({
      title: 'Delete Chat',
      target: active?.title || 'this chat',
      confirmLabel: 'Delete',
      onConfirm: () => {
        deleteConversation(activeConversationId);
        setConfirm(null);
      },
    });
  }, [activeConversationId, conversations, deleteConversation, newChat]);

  const deleteAllHistory = useCallback(() => {
    if (conversations.length === 0) return;
    const n = conversations.length;
    setConfirm({
      title: 'Delete All History',
      message: (
        <>
          {n} conversation{n === 1 ? '' : 's'} will be permanently removed. This action cannot be undone.
        </>
      ),
      confirmLabel: 'Delete All',
      onConfirm: () => {
        for (const c of [...conversations]) deleteConversation(c.id);
        newChat();
        setConfirm(null);
      },
    });
  }, [conversations, deleteConversation, newChat]);

  const requestDeleteConversation = useCallback(
    (id: string) => {
      const c = conversations.find((x) => x.id === id);
      setConfirm({
        title: 'Delete Chat',
        target: c?.title || 'this chat',
        confirmLabel: 'Delete',
        onConfirm: () => {
          deleteConversation(id);
          setConfirm(null);
        },
      });
    },
    [conversations, deleteConversation]
  );

  const actions: ActionItem[] = useMemo(() => {
    const list: ActionItem[] = [
      { id: 'new', title: 'New Chat', icon: <Plus size={14} />, shortcut: ['⌘', 'N'], onRun: newChat, section: '' },
    ];
    if (hasPrev) list.push({ id: 'prev', title: 'Previous Chat', icon: <ChevronLeft size={14} />, shortcut: ['⌘', '['], onRun: goPrevChat });
    if (hasNext) list.push({ id: 'next', title: 'Next Chat', icon: <ChevronRight size={14} />, shortcut: ['⌘', ']'], onRun: goNextChat });
    list.push({ id: 'history', title: 'Show History', icon: <History size={14} />, shortcut: ['⌘', 'H'], onRun: () => setHistoryOpen(true) });
    if (hasCurrentChat) list.push({ id: 'delete-chat', title: 'Delete Chat', icon: <Trash2 size={14} />, shortcut: ['⌘', 'X'], onRun: deleteCurrentChat, danger: true });
    if (hasHistory) list.push({ id: 'delete-history', title: 'Delete History', icon: <Eraser size={14} />, shortcut: ['⌘', '⇧', 'X'], onRun: deleteAllHistory, danger: true });
    return list;
  }, [hasPrev, hasNext, hasCurrentChat, hasHistory, newChat, goPrevChat, goNextChat, deleteCurrentChat, deleteAllHistory]);

  // Global hotkeys (suppressed while overlays open — they own their keys)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (actionsOpen || historyOpen || confirm) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); setActionsOpen(true); }
      else if (k === 'n') { e.preventDefault(); newChat(); }
      else if (e.key === '[') { e.preventDefault(); goPrevChat(); }
      else if (e.key === ']') { e.preventDefault(); goNextChat(); }
      else if (k === 'h') { e.preventDefault(); setHistoryOpen(true); }
      else if (k === 'x' && e.shiftKey) {
        if (!hasHistory) return;
        e.preventDefault();
        deleteAllHistory();
      } else if (k === 'x') {
        if (!hasCurrentChat) return;
        e.preventDefault();
        deleteCurrentChat();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actionsOpen, historyOpen, confirm, newChat, goPrevChat, goNextChat, deleteCurrentChat, deleteAllHistory, hasCurrentChat, hasHistory]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (aiStreaming) {
        stopStreaming();
        return;
      }
      if (aiQuery.trim()) sendMessage(aiQuery);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exitAiMode();
    }
  };

  const placeholder = pairs.length === 0 ? 'Ask AI anything…' : 'Ask follow-up…';

  return (
    <>
      {alwaysMountedRunners}
      <div className="w-full h-full">
        <div className="glass-effect overflow-hidden h-full flex flex-col relative">
          {/* Header */}
          <div className="drag-region flex items-center gap-3 px-4 py-3 border-b border-[var(--ui-divider)]">
            <button
              onClick={exitAiMode}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--ui-segment-hover-bg)] text-[var(--text-primary)] transition-colors flex-shrink-0"
              title="Back"
              style={{ background: 'var(--ui-segment-active-bg)', border: '1px solid var(--ui-segment-border)' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <input
              ref={aiInputRef}
              type="text"
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] text-[15px] font-light tracking-wide min-w-0"
              autoFocus
            />
          </div>

          {/* Body: QA cards + tall spacer to let latest card anchor at top */}
          <div
            ref={aiResponseRef}
            className="flex-1 overflow-y-auto custom-scrollbar px-5 py-5 space-y-7"
          >
            {pairs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-8 -mt-4">
                <div
                  className="relative w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 26%, transparent)',
                    color: 'var(--accent)',
                  }}
                >
                  <Sparkles size={22} strokeWidth={2.25} />
                  <div
                    aria-hidden="true"
                    className="absolute -inset-3 rounded-[24px] pointer-events-none"
                    style={{
                      background:
                        'radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--accent) 32%, transparent), transparent 68%)',
                      filter: 'blur(14px)',
                      opacity: 0.9,
                    }}
                  />
                </div>
                <div className="space-y-1 max-w-[320px]">
                  <div className="text-[15px] font-medium text-[var(--text-primary)]">
                    Ask AI anything
                  </div>
                  <div className="text-[12px] text-[var(--text-muted)] leading-relaxed">
                    Ideas, code, writing, quick answers — start typing to begin a new conversation.
                  </div>
                </div>
              </div>
            ) : (
              <>
                {pairs.map((p, idx) => {
                  const isLast = idx === pairs.length - 1;
                  const isStreamingThis = aiStreaming && isLast;
                  return (
                    <div
                      key={p.id}
                      ref={(el) => {
                        if (el) pairRefs.current.set(p.id, el);
                        else pairRefs.current.delete(p.id);
                      }}
                    >
                      <QACard pair={p} isStreaming={isStreamingThis} />
                    </div>
                  );
                })}
                <div ref={spacerRef} aria-hidden="true" />
              </>
            )}
          </div>

          {/* Footer (launcher-style: plain text + kbd badges, no pill) */}
          <div className="sc-glass-footer px-4 py-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <img src={supercmdLogo} alt="SuperCmd" className="w-4 h-4 rounded-sm" />
              <span className="text-[12px] text-[var(--text-primary)]">Ask AI</span>
            </div>
            <div className="flex items-center gap-3">
              {(() => {
                const hasMessages = messages.length > 0;
                const hasQuery = aiQuery.trim().length > 0;
                let label: string | null = null;
                let onClick: (() => void) | null = null;
                if (aiStreaming) {
                  label = 'Cancel';
                  onClick = stopStreaming;
                } else if (hasQuery) {
                  label = hasMessages ? 'Ask Follow-up' : 'Ask AI';
                  onClick = () => sendMessage(aiQuery);
                }
                if (!label) return null;
                return (
                  <button
                    onClick={onClick ?? undefined}
                    className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    <span className="text-xs font-normal">{label}</span>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">↵</kbd>
                  </button>
                );
              })()}
              <div className="w-px h-4 bg-[var(--border-subtle)]" />
              <button
                onClick={() => setActionsOpen(true)}
                className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                <span className="text-xs font-normal">Actions</span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">⌘</kbd>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">K</kbd>
              </button>
            </div>
          </div>

          {actionsOpen && (
            <ActionsOverlay
              actions={actions}
              onClose={() => {
                setActionsOpen(false);
                setTimeout(() => aiInputRef.current?.focus(), 0);
              }}
            />
          )}
          {historyOpen && (
            <HistoryOverlay
              conversations={conversations}
              activeId={activeConversationId}
              onSelect={selectConversation}
              onDelete={requestDeleteConversation}
              onClose={() => {
                setHistoryOpen(false);
                setTimeout(() => aiInputRef.current?.focus(), 0);
              }}
            />
          )}
          {confirm && (
            <ConfirmDeleteDialog
              title={confirm.title}
              target={confirm.target}
              message={confirm.message}
              confirmLabel={confirm.confirmLabel}
              onConfirm={confirm.onConfirm}
              onCancel={() => {
                setConfirm(null);
                setTimeout(() => aiInputRef.current?.focus(), 0);
              }}
            />
          )}
        </div>
      </div>
    </>
  );
};

export default AiChatView;
