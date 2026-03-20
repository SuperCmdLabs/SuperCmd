/**
 * AiChatManager.tsx
 *
 * Main component for the AI chat detached window.
 * Left sidebar with conversation list, right panel with chat messages and input.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Search, Trash2, Pin, PinOff, Pencil, Sparkles, Send,
  MessageSquare, Check, X, ChevronDown, ImagePlus, X as XIcon,
} from 'lucide-react';
import type { Conversation, ChatMessageData, AISettings } from '../../types/electron';

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

  const [chatModel, setChatModel] = useState('');
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string }>>([]);
  const [pendingImages, setPendingImages] = useState<string[]>([]);

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

  // Load available models based on current settings
  useEffect(() => {
    window.electron.getSettings().then((s) => {
      const ai = s.ai;
      const models: Array<{ id: string; label: string }> = [];
      const allModels: Record<string, Array<{ id: string; label: string }>> = {
        'chatgpt-account': [
          { id: 'chatgpt-gpt-5', label: 'GPT-5' },
          { id: 'chatgpt-gpt-5.4', label: 'GPT-5.4' },
          { id: 'chatgpt-gpt-5.2', label: 'GPT-5.2' },
          { id: 'chatgpt-gpt-5.1', label: 'GPT-5.1' },
          { id: 'chatgpt-gpt-5-codex', label: 'GPT-5 Codex' },
          { id: 'chatgpt-codex-mini', label: 'Codex Mini' },
          { id: 'chatgpt-gpt-4o', label: 'GPT-4o' },
        ],
        openai: [
          { id: 'openai-gpt-4o', label: 'GPT-4o' },
          { id: 'openai-gpt-4o-mini', label: 'GPT-4o Mini' },
          { id: 'openai-o3-mini', label: 'o3-mini' },
        ],
        anthropic: [
          { id: 'anthropic-claude-opus', label: 'Claude Opus' },
          { id: 'anthropic-claude-sonnet', label: 'Claude Sonnet' },
          { id: 'anthropic-claude-haiku', label: 'Claude Haiku' },
        ],
        gemini: [
          { id: 'gemini-gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
          { id: 'gemini-gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        ],
      };
      if (allModels[ai.provider]) {
        models.push(...allModels[ai.provider]);
      }
      setAvailableModels(models);
      // Set default chat model to current settings default
      if (ai.defaultModel) setChatModel(ai.defaultModel);
    });
  }, []);

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
    setPendingImages([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      if (!input.files) return;
      Array.from(input.files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          setPendingImages((prev) => [...prev, dataUrl]);
        };
        reader.readAsDataURL(file);
      });
    };
    input.click();
  };

  const handleSend = async () => {
    const msg = inputValue.trim();
    if ((!msg && pendingImages.length === 0) || streaming) return;
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;
    setInputValue('');
    setPendingImages([]);
    setStreamingText('');
    setStreaming(true);

    if (inputRef.current) inputRef.current.style.height = 'auto';

    let convId = activeId;
    if (!convId) {
      const convo = await window.electron.aiChatCreate({ firstMessage: msg || 'Image' });
      convId = convo.id;
      setActiveId(convo.id);
      setActiveConvo(convo);
      refreshList();
    } else {
      setActiveConvo((prev) => prev ? {
        ...prev,
        messages: [...prev.messages, { id: `t-${Date.now()}`, role: 'user', content: msg, images, timestamp: Date.now() }],
      } : prev);
    }

    const rid = `chat-${Date.now()}`;
    requestIdRef.current = rid;
    window.electron.aiChatSend(rid, convId, msg || 'Describe this image.', chatModel || undefined, images);
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
    <div className="bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-xl focus-within:border-[var(--accent)]/30 transition-colors">
      {/* Image previews */}
      {pendingImages.length > 0 && (
        <div className="flex gap-2 px-3 pt-2.5 pb-1 flex-wrap">
          {pendingImages.map((img, i) => (
            <div key={i} className="relative group">
              <img src={img} alt="" className="w-14 h-14 rounded-lg object-cover border border-[var(--ui-divider)]" />
              <button
                onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--text-muted)] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 px-4 py-2.5">
        <button
          onClick={handleImageUpload}
          disabled={streaming}
          className="p-1 rounded-md text-[var(--text-subtle)] hover:text-[var(--text-muted)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors flex-shrink-0 disabled:opacity-30 mb-0.5"
          title="Attach image"
        >
          <ImagePlus className="w-4 h-4" />
        </button>
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
          disabled={(!inputValue.trim() && pendingImages.length === 0) || streaming}
          className="p-1.5 rounded-lg bg-[var(--accent)] text-white disabled:opacity-25 disabled:cursor-not-allowed hover:bg-[var(--accent-hover)] transition-colors flex-shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
      {availableModels.length > 0 && (
        <div className="px-3 pb-2 pt-0">
          <select
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            className="bg-transparent border-none outline-none text-[0.625rem] text-[var(--text-subtle)] cursor-pointer hover:text-[var(--text-muted)] transition-colors"
          >
            <option value="">Auto</option>
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      )}
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
        <div className="flex-shrink-0 pt-[38px] px-3 pb-2 drag-region">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[0.75rem] font-medium text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors border border-[var(--ui-divider)]"
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
            <div className="h-[52px] flex-shrink-0 flex items-center justify-center px-5 border-b border-[var(--ui-divider)] drag-region">
              <span className="text-[0.8125rem] font-medium text-[var(--text-secondary)] truncate">
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
                  <StreamingMessage text={streamingText} />
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
            <div className="h-[52px] flex-shrink-0 drag-region" />
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

// ─── Think block parser ──────────────────────────────────────────────

function parseThinkBlocks(content: string): Array<{ type: 'think' | 'text'; content: string }> {
  const blocks: Array<{ type: 'think' | 'text'; content: string }> = [];
  const regex = /<think>\n?([\s\S]*?)\n?<\/think>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Text before this think block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) blocks.push({ type: 'text', content: text });
    }
    // The think block itself
    const thinkContent = match[1].trim();
    if (thinkContent) blocks.push({ type: 'think', content: thinkContent });
    lastIndex = regex.lastIndex;
  }

  // Remaining text after last think block
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) blocks.push({ type: 'text', content: text });
  }

  // No think tags found — return as single text block
  if (blocks.length === 0 && content.trim()) {
    blocks.push({ type: 'text', content: content.trim() });
  }

  return blocks;
}

// Detect partial thinking during streaming (has <think> but no </think>)
function parseStreamingContent(content: string): { thinking: string | null; text: string } {
  const thinkStart = content.indexOf('<think>');
  if (thinkStart === -1) return { thinking: null, text: content };

  const thinkEnd = content.indexOf('</think>');
  if (thinkEnd === -1) {
    // Still thinking — everything after <think> is the thinking content
    const thinking = content.slice(thinkStart + 7).trim();
    const textBefore = content.slice(0, thinkStart).trim();
    return { thinking: thinking || '', text: textBefore };
  }

  // Think block is closed — parse normally and return remaining text
  const blocks = parseThinkBlocks(content);
  const thinkBlocks = blocks.filter(b => b.type === 'think').map(b => b.content).join('\n');
  const textBlocks = blocks.filter(b => b.type === 'text').map(b => b.content).join('\n\n');
  return { thinking: thinkBlocks || null, text: textBlocks };
}

// ─── Collapsible Thinking Component ──────────────────────────────────

const ThinkingBlock: React.FC<{ content: string; isStreaming?: boolean }> = ({ content, isStreaming }) => {
  const [expanded, setExpanded] = useState(false);

  // Auto-expand while streaming
  const isOpen = isStreaming || expanded;

  // Get a short summary (first line or first ~60 chars)
  const summary = (() => {
    const firstLine = content.split('\n').find(l => l.trim()) || '';
    const cleaned = firstLine.replace(/^\*\*|\*\*$/g, '').trim();
    if (cleaned.length <= 60) return cleaned;
    return cleaned.slice(0, 57) + '...';
  })();

  return (
    <div
      className="rounded-lg mb-2"
      style={{ background: 'rgba(var(--on-surface-rgb), 0.04)' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left"
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {isStreaming ? (
            <div className="flex gap-0.5 flex-shrink-0">
              <span className="w-1 h-1 rounded-full bg-[var(--accent)] animate-pulse" />
              <span className="w-1 h-1 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: '0.15s' }} />
              <span className="w-1 h-1 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: '0.3s' }} />
            </div>
          ) : (
            <Sparkles className="w-3 h-3 text-[var(--accent)] opacity-60 flex-shrink-0" />
          )}
          <span className="text-[0.75rem] text-[var(--text-muted)] truncate">
            {isStreaming ? 'Thinking...' : (summary || 'Thought process')}
          </span>
        </div>
        <ChevronDown className={`w-3 h-3 text-[var(--text-subtle)] transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="px-3 pb-2.5">
          <div className="text-[0.75rem] text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap select-text">
            {content}
          </div>
        </div>
      )}
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
          {message.images && message.images.length > 0 && (
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {message.images.map((img, i) => (
                <img key={i} src={img} alt="" className="max-w-[200px] max-h-[150px] rounded-lg object-cover" />
              ))}
            </div>
          )}
          <p className="text-[0.8125rem] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap select-text">{message.content}</p>
        </div>
      </div>
    );
  }

  // Parse think blocks from assistant messages
  const blocks = parseThinkBlocks(message.content);

  return (
    <div className="flex gap-3">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
        style={{ background: 'rgba(var(--on-surface-rgb), 0.06)' }}
      >
        <Sparkles className="w-3 h-3 text-[var(--accent)]" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        {blocks.map((block, i) =>
          block.type === 'think' ? (
            <ThinkingBlock key={i} content={block.content} />
          ) : (
            <div key={i} className="text-[0.8125rem] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap select-text">
              {block.content}
            </div>
          )
        )}
      </div>
    </div>
  );
};

// ─── Streaming Message ───────────────────────────────────────────────

const StreamingMessage: React.FC<{ text: string }> = ({ text }) => {
  const { thinking, text: displayText } = parseStreamingContent(text);

  return (
    <div className="flex gap-3">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
        style={{ background: 'rgba(var(--on-surface-rgb), 0.06)' }}
      >
        <Sparkles className="w-3 h-3 text-[var(--accent)]" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        {thinking !== null && (
          <ThinkingBlock content={thinking} isStreaming={!text.includes('</think>')} />
        )}
        {displayText && (
          <div className="text-[0.8125rem] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap select-text">
            {displayText}
          </div>
        )}
      </div>
    </div>
  );
};

export default AiChatManager;
