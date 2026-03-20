/**
 * AiChatManager.tsx
 *
 * Main component for the AI chat detached window.
 * Left sidebar with conversation list, right panel with chat messages and input.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Search, Trash2, Pin, PinOff, Pencil, Sparkles, Send,
  MessageSquare, Check, X,
} from 'lucide-react';
import type { Conversation, ChatMessageData } from '../../types/electron';

// ─── Helpers ─────────────────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Component ───────────────────────────────────────────────────────

interface AiChatManagerProps {
  initialConversationId: string | null;
}

const AiChatManager: React.FC<AiChatManagerProps> = ({ initialConversationId }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId);
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const requestIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Data loading ───────────────────────────────────────────────

  const refreshList = useCallback(async () => {
    const list = searchQuery
      ? await window.electron.aiChatSearch(searchQuery)
      : await window.electron.aiChatGetAll();
    setConversations(list);
  }, [searchQuery]);

  useEffect(() => { refreshList(); }, [refreshList]);

  useEffect(() => {
    if (!activeId) { setActiveConvo(null); return; }
    window.electron.aiChatGet(activeId).then(setActiveConvo);
  }, [activeId]);

  // ── Auto-scroll + focus ────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConvo?.messages.length, streamingText]);

  useEffect(() => {
    if (!streaming) inputRef.current?.focus();
  }, [streaming]);

  // ── Streaming listeners ────────────────────────────────────────

  useEffect(() => {
    const onChunk = (d: { requestId: string; chunk: string }) => {
      if (d.requestId === requestIdRef.current) setStreamingText((p) => p + d.chunk);
    };
    const onDone = (d: { requestId: string }) => {
      if (d.requestId === requestIdRef.current) {
        setStreaming(false);
        setStreamingText('');
        if (activeId) window.electron.aiChatGet(activeId).then(setActiveConvo);
        refreshList();
      }
    };
    const onError = (d: { requestId: string; error: string }) => {
      if (d.requestId === requestIdRef.current) {
        setStreaming(false);
        setStreamingText((p) => p + `\n\nError: ${d.error}`);
      }
    };
    window.electron.onAiChatStreamChunk(onChunk);
    window.electron.onAiChatStreamDone(onDone);
    window.electron.onAiChatStreamError(onError);
  }, [activeId, refreshList]);

  // ── IPC: open-conversation event from main ─────────────────────

  useEffect(() => {
    return window.electron.onAiChatOpenConversation((id) => setActiveId(id));
  }, []);

  // ── Actions ────────────────────────────────────────────────────

  const handleNewChat = () => {
    setActiveId(null);
    setActiveConvo(null);
    setInputValue('');
    setStreamingText('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSend = async () => {
    const msg = inputValue.trim();
    if (!msg || streaming) return;
    setInputValue('');
    setStreamingText('');
    setStreaming(true);

    if (inputRef.current) inputRef.current.style.height = 'auto';

    let convId = activeId;
    if (!convId) {
      const convo = await window.electron.aiChatCreate({ firstMessage: msg });
      convId = convo.id;
      setActiveId(convo.id);
      setActiveConvo(convo);
      refreshList();
    } else {
      setActiveConvo((prev) => prev ? {
        ...prev,
        messages: [...prev.messages, { id: `t-${Date.now()}`, role: 'user', content: msg, timestamp: Date.now() }],
      } : prev);
    }

    const rid = `chat-${Date.now()}`;
    requestIdRef.current = rid;
    window.electron.aiChatSend(rid, convId, msg);
  };

  const handleDelete = async (id: string) => {
    await window.electron.aiChatDelete(id);
    if (activeId === id) { setActiveId(null); setActiveConvo(null); }
    refreshList();
  };

  const handlePin = async (id: string, pinned: boolean) => {
    await window.electron.aiChatUpdate(id, { pinned });
    refreshList();
  };

  const commitRename = async (id: string) => {
    if (renameValue.trim()) {
      await window.electron.aiChatUpdate(id, { title: renameValue.trim() });
      refreshList();
      if (activeId === id) window.electron.aiChatGet(id).then(setActiveConvo);
    }
    setRenamingId(null);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const autoGrow = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const t = e.target as HTMLTextAreaElement;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  };

  // ── Input box (shared between active convo and empty state) ────

  const renderInput = (autoFocus?: boolean) => (
    <div className="flex items-end gap-2 bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-xl px-4 py-2.5 focus-within:border-[var(--accent)]/30 transition-colors">
      <textarea
        ref={inputRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={onInputKeyDown}
        onInput={autoGrow}
        placeholder="Type a message..."
        disabled={streaming}
        rows={1}
        autoFocus={autoFocus}
        className="flex-1 bg-transparent border-none outline-none text-[0.8125rem] text-[var(--text-primary)] placeholder:text-[color:var(--text-subtle)] resize-none min-h-[20px] max-h-[120px] leading-snug disabled:opacity-40"
        style={{ height: 'auto', overflow: 'hidden' }}
      />
      <button
        onClick={handleSend}
        disabled={!inputValue.trim() || streaming}
        className="p-1.5 rounded-lg bg-[var(--accent)] text-white disabled:opacity-25 disabled:cursor-not-allowed hover:bg-[var(--accent-hover)] transition-colors flex-shrink-0"
      >
        <Send className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <div
        className="w-[250px] flex-shrink-0 border-r border-[var(--ui-divider)] flex flex-col overflow-hidden"
        style={{ background: 'rgba(var(--on-surface-rgb), 0.04)' }}
      >
        {/* Traffic light safe zone + New Chat */}
        <div className="flex-shrink-0 pt-[38px] px-3 pb-2 app-drag-region">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[0.75rem] font-medium text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors border border-[var(--ui-divider)] app-no-drag"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-subtle)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md pl-7 pr-2.5 py-1.5 text-[0.6875rem] text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] focus:outline-none focus:border-[var(--accent)]/40"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1 space-y-0.5">
          {conversations.length === 0 ? (
            <div className="text-center py-10 px-3">
              <MessageSquare className="w-5 h-5 mx-auto mb-2 text-[var(--text-subtle)] opacity-40" />
              <p className="text-[0.6875rem] text-[var(--text-subtle)]">
                {searchQuery ? 'No matching chats' : 'No chats yet'}
              </p>
            </div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => { setActiveId(c.id); setStreamingText(''); }}
                className={`group relative rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                  activeId === c.id
                    ? 'bg-[var(--ui-segment-active-bg)]'
                    : 'hover:bg-[var(--ui-segment-hover-bg)]'
                }`}
              >
                {renamingId === c.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(c.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      className="flex-1 bg-transparent border border-[var(--accent)]/30 rounded px-1.5 py-0.5 text-[0.75rem] text-[var(--text-primary)] outline-none min-w-0"
                    />
                    <button onClick={() => commitRename(c.id)} className="p-0.5 text-[var(--text-muted)] hover:text-green-400">
                      <Check className="w-3 h-3" />
                    </button>
                    <button onClick={() => setRenamingId(null)} className="p-0.5 text-[var(--text-muted)] hover:text-red-400">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 pr-14">
                      {c.pinned && <Pin className="w-2.5 h-2.5 text-[var(--accent)] flex-shrink-0 opacity-70" />}
                      <span className="text-[0.75rem] font-medium text-[var(--text-primary)] truncate leading-tight">{c.title}</span>
                    </div>
                    <p className="text-[0.625rem] text-[var(--text-subtle)] mt-0.5 truncate">
                      {c.messages.length} message{c.messages.length !== 1 ? 's' : ''} · {formatRelativeTime(c.updatedAt)}
                    </p>
                    {/* Hover actions */}
                    <div className="absolute right-1.5 top-1.5 hidden group-hover:flex items-center gap-0.5 bg-[var(--ui-segment-bg)] rounded-md border border-[var(--ui-divider)] p-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenamingId(c.id); setRenameValue(c.title); }}
                        className="p-1 rounded hover:bg-[var(--ui-segment-hover-bg)] text-[var(--text-subtle)] hover:text-[var(--text-muted)]"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePin(c.id, !c.pinned); }}
                        className="p-1 rounded hover:bg-[var(--ui-segment-hover-bg)] text-[var(--text-subtle)] hover:text-[var(--text-muted)]"
                      >
                        {c.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                        className="p-1 rounded hover:bg-red-500/15 text-[var(--text-subtle)] hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Chat Area ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {activeConvo ? (
          <>
            {/* Title bar + convo title */}
            <div className="h-[52px] flex-shrink-0 flex items-center justify-center px-5 border-b border-[var(--ui-divider)] app-drag-region">
              <span className="text-[0.8125rem] font-medium text-[var(--text-secondary)] truncate app-no-drag">
                {activeConvo.title}
              </span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="max-w-[680px] mx-auto px-6 py-5 space-y-5">
                {activeConvo.messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}

                {streaming && streamingText && (
                  <div className="flex gap-3">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
                      style={{ background: 'rgba(var(--on-surface-rgb), 0.06)' }}
                    >
                      <Sparkles className="w-3 h-3 text-[var(--accent)]" />
                    </div>
                    <div className="flex-1 min-w-0 text-[0.8125rem] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap pt-0.5 select-text">
                      {streamingText}
                    </div>
                  </div>
                )}

                {streaming && !streamingText && (
                  <div className="flex gap-3">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
                      style={{ background: 'rgba(var(--on-surface-rgb), 0.06)' }}
                    >
                      <Sparkles className="w-3 h-3 text-[var(--accent)]" />
                    </div>
                    <div className="flex items-center gap-1.5 text-[var(--text-muted)] text-[0.8125rem] pt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: '0.15s' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: '0.3s' }} />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input area */}
            <div className="flex-shrink-0 px-6 py-3" style={{ maxWidth: 680 + 48, margin: '0 auto', width: '100%' }}>
              {renderInput()}
              <p className="text-[0.5625rem] text-[var(--text-subtle)] mt-1.5 text-center opacity-60">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          </>
        ) : (
          /* ── Empty state ─────────────────────────────────────── */
          <>
            <div className="h-[52px] flex-shrink-0 app-drag-region" />
            <div className="flex-1 flex flex-col items-center justify-center px-6">
              <div className="w-14 h-14 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center mb-5">
                <Sparkles className="w-7 h-7 text-[var(--accent)] opacity-80" />
              </div>
              <h2 className="text-[1.0625rem] font-semibold text-[var(--text-primary)] mb-1">Start a conversation</h2>
              <p className="text-[0.8125rem] text-[var(--text-muted)] mb-8 text-center max-w-[300px] leading-snug">
                Ask anything. Your conversations are saved and persist across sessions.
              </p>
              <div className="w-full max-w-[520px]">
                {renderInput(true)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Message Bubble ──────────────────────────────────────────────────

const MessageBubble: React.FC<{ message: ChatMessageData }> = ({ message }) => {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-xl rounded-br-sm px-3.5 py-2"
          style={{ background: 'rgba(var(--on-surface-rgb), 0.1)' }}
        >
          <p className="text-[0.8125rem] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap select-text">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
        style={{ background: 'rgba(var(--on-surface-rgb), 0.06)' }}
      >
        <Sparkles className="w-3 h-3 text-[var(--accent)]" />
      </div>
      <div className="flex-1 min-w-0 text-[0.8125rem] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap pt-0.5 select-text">
        {message.content}
      </div>
    </div>
  );
};

export default AiChatManager;
