/**
 * AiChatManager.tsx
 *
 * Main component for the AI chat detached window.
 * Left sidebar with conversation list, right panel with chat messages and input.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Search, Trash2, Pin, PinOff, Pencil, Sparkles, Send,
  MessageSquare, Check, X, ImagePlus, Square,
} from 'lucide-react';
import type { AppSettings, Conversation, ChatMessageData } from '../../types/electron';
import type { AiModelInfo, AiModelOption } from '../utils/ai-models';
import {
  getConfiguredChatModelOptions,
  getConversationModelInfo,
} from '../utils/ai-models';

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

function normalizeOllamaModelName(value: string): string {
  return String(value || '').trim();
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
  const [streamingStatus, setStreamingStatus] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [chatModel, setChatModel] = useState('');
  const [availableModels, setAvailableModels] = useState<AiModelOption[]>([]);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [settingsSnapshot, setSettingsSnapshot] = useState<AppSettings | null>(null);
  const [selectedModelInfo, setSelectedModelInfo] = useState<AiModelInfo | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

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
    window.electron.getSettings().then(setSettingsSnapshot).catch(() => setSettingsSnapshot(null));
    const cleanup = window.electron.onSettingsUpdated?.((next) => setSettingsSnapshot(next));
    return cleanup;
  }, []);

  useEffect(() => {
    if (!settingsSnapshot) {
      setOllamaModels([]);
      return;
    }

    const needsOllamaModels =
      settingsSnapshot.ai.provider === 'ollama' ||
      String(activeConvo?.model || '').startsWith('ollama-') ||
      chatModel.startsWith('ollama-');

    if (!needsOllamaModels) {
      setOllamaModels([]);
      return;
    }

    window.electron.ollamaStatus().then((result) => {
      if (!result.running) {
        setOllamaModels([]);
        return;
      }
      const nextModels = Array.from(new Set(
        (result.models || [])
          .map((item: any) => normalizeOllamaModelName(item?.name))
          .filter(Boolean)
      ));
      setOllamaModels(nextModels);
    }).catch(() => setOllamaModels([]));
  }, [settingsSnapshot, activeConvo?.model, chatModel]);

  useEffect(() => {
    if (!settingsSnapshot) {
      setAvailableModels([]);
      setSelectedModelInfo(null);
      return;
    }

    const models = getConfiguredChatModelOptions(settingsSnapshot.ai, {
      currentModelKey: activeConvo?.model || chatModel,
      ollamaModels,
    });
    setAvailableModels(models);

    const resolved = activeConvo
      ? getConversationModelInfo(activeConvo, settingsSnapshot.ai)
      : getConversationModelInfo(null, settingsSnapshot.ai);
    const nextModel = activeConvo?.model || chatModel || resolved.modelKey || models[0]?.id || '';
    setChatModel(nextModel);
    setSelectedModelInfo(getConversationModelInfo(
      { model: nextModel, provider: activeConvo?.provider || resolved.providerId } as Pick<Conversation, 'model' | 'provider'>,
      settingsSnapshot.ai
    ));
  }, [settingsSnapshot, activeConvo, ollamaModels]);

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

  // Focus input when conversation loads or changes
  useEffect(() => {
    if (activeConvo) inputRef.current?.focus();
  }, [activeConvo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Streaming listeners (registered once) ────────────────────

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => {
    const cleanupChunk = window.electron.onAiChatStreamChunk((d) => {
      if (d.requestId === requestIdRef.current) {
        setStreamingStatus(''); // Clear status once real text arrives
        setStreamingText((p) => p + d.chunk);
      }
    });
    const cleanupDone = window.electron.onAiChatStreamDone((d) => {
      if (d.requestId === requestIdRef.current) {
        setStreaming(false);
        setStreamingText('');
        setStreamingStatus('');
        const curId = activeIdRef.current;
        if (curId) window.electron.aiChatGet(curId).then(setActiveConvo);
        window.electron.aiChatGetAll().then(setConversations);
      }
    });
    const cleanupError = window.electron.onAiChatStreamError((d) => {
      if (d.requestId === requestIdRef.current) {
        setStreaming(false);
        setStreamingStatus('');
        setStreamingText((p) => p + `\n\nError: ${d.error}`);
      }
    });
    const cleanupStatus = window.electron.onAiChatStreamStatus((d) => {
      if (d.requestId === requestIdRef.current) {
        setStreamingStatus(d.status);
      }
    });
    return () => { cleanupChunk(); cleanupDone(); cleanupError(); cleanupStatus(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (settingsSnapshot) {
      const fallbackInfo = getConversationModelInfo(null, settingsSnapshot.ai);
      setChatModel(fallbackInfo.modelKey);
      setSelectedModelInfo(fallbackInfo);
    }
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

  const handleModelChange = async (nextModel: string) => {
    setChatModel(nextModel);
    if (!settingsSnapshot) return;

    const nextInfo = getConversationModelInfo(
      { model: nextModel, provider: activeConvo?.provider || settingsSnapshot.ai.provider } as Pick<Conversation, 'model' | 'provider'>,
      settingsSnapshot.ai
    );
    setSelectedModelInfo(nextInfo);

    if (!activeId) return;
    await window.electron.aiChatUpdate(activeId, {
      model: nextInfo.modelKey,
      provider: nextInfo.providerId,
    });
    setActiveConvo((prev) => prev ? {
      ...prev,
      model: nextInfo.modelKey,
      provider: nextInfo.providerId,
    } : prev);
    refreshList();
  };

  const handleSend = async () => {
    const msg = inputValue.trim();
    if ((!msg && pendingImages.length === 0) || streaming) return;
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;
    const modelInfo = selectedModelInfo;
    setInputValue('');
    setPendingImages([]);
    setStreamingText('');
    setStreamingStatus('');
    setStreaming(true);

    if (inputRef.current) inputRef.current.style.height = 'auto';

    let convId = activeId;
    if (!convId) {
      const convo = await window.electron.aiChatCreate({
        firstMessage: msg || 'Image',
        model: modelInfo?.modelKey || chatModel || undefined,
        provider: modelInfo?.providerId || undefined,
      });
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
    window.electron.aiChatSend(rid, convId, msg || 'Describe this image.', modelInfo?.modelKey || chatModel || undefined, images);
  };

  const handleCancel = () => {
    if (requestIdRef.current) {
      window.electron.aiChatCancel(requestIdRef.current);
    }
    setStreaming(false);
    setStreamingStatus('');
    // If there's partial streaming text, save it as the assistant response
    if (streamingText && activeId) {
      window.electron.aiChatAddMessage(activeId, { role: 'assistant', content: streamingText + '\n\n*(cancelled)*' });
      window.electron.aiChatGet(activeId).then(setActiveConvo);
    }
    setStreamingText('');
    refreshList();
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
      {/* Textarea + send */}
      <div className="flex items-end gap-2 px-4 py-2.5">
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
        {streaming ? (
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0 border border-[var(--ui-divider)]"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() && pendingImages.length === 0}
            className="p-1.5 rounded-lg bg-[var(--accent)] text-white disabled:opacity-25 disabled:cursor-not-allowed hover:bg-[var(--accent-hover)] transition-colors flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {/* Bottom bar: model selector + image attach */}
      <div className="flex items-center justify-between px-3 pb-2 pt-0">
        <select
          value={chatModel}
          onChange={(e) => { void handleModelChange(e.target.value); }}
          className="bg-transparent border-none outline-none text-[0.625rem] text-[var(--text-subtle)] cursor-pointer hover:text-[var(--text-muted)] transition-colors"
        >
          {availableModels.length > 0 ? (
            availableModels.map((m) => (
              <option key={m.id} value={m.id}>{`${m.providerLabel} · ${m.label}`}</option>
            ))
          ) : (
            <option value="">Default</option>
          )}
        </select>
        <button
          onClick={handleImageUpload}
          disabled={streaming}
          className="p-1 rounded-md text-[var(--text-subtle)] hover:text-[var(--text-muted)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors flex-shrink-0 disabled:opacity-30"
          title="Attach image"
        >
          <ImagePlus className="w-3.5 h-3.5" />
        </button>
      </div>
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
            <div className="h-[52px] flex-shrink-0 flex items-center justify-between px-5 border-b border-[var(--ui-divider)] drag-region">
              <div className="w-[160px]" />
              <span className="text-[0.8125rem] font-medium text-[var(--text-secondary)] truncate text-center">
                {activeConvo.title}
              </span>
              <div className="w-[160px] flex justify-end">
                {selectedModelInfo && (
                  <div className="rounded-full border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] px-2.5 py-1 text-[0.625rem] text-[var(--text-subtle)]">
                    {selectedModelInfo.modelLabel} · {selectedModelInfo.providerLabel}
                  </div>
                )}
              </div>
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
                      {streamingStatus && (
                        <span className="ml-1 text-[var(--text-subtle)]">{streamingStatus}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Cancel button while streaming */}
                {streaming && (
                  <div className="flex justify-center pt-1">
                    <button
                      onClick={handleCancel}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[0.75rem] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors border border-[var(--ui-divider)] hover:border-[var(--text-subtle)]"
                      style={{ background: 'rgba(var(--on-surface-rgb), 0.04)' }}
                    >
                      <Square className="w-3 h-3" />
                      Stop
                    </button>
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
