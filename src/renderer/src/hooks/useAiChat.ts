/**
 * useAiChat.ts
 *
 * Multi-turn AI chat state with conversation history.
 * - Owns `messages` array for the active conversation
 * - Persists conversation list + bodies in localStorage
 * - Streams assistant responses into the last message
 * - startAiChat(query): enter AI mode; if query present, auto-send
 * - sendMessage(text): append user msg, stream assistant reply
 * - stopStreaming(): cancel in-flight
 * - newChat(): start a fresh conversation
 * - selectConversation(id): load an existing conversation
 * - deleteConversation(id): remove from history
 * - exitAiMode(): leave AI mode (conversation is kept in history)
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────────────

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  cancelled?: boolean;
}

export interface AiConversation {
  id: string;
  title: string;
  messages: AiMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface UseAiChatOptions {
  onExitAiMode?: () => void;
  setAiMode: (value: boolean) => void;
}

export interface UseAiChatReturn {
  // Active conversation
  messages: AiMessage[];
  aiStreaming: boolean;
  aiAvailable: boolean;
  aiQuery: string;
  setAiQuery: (value: string) => void;
  aiInputRef: React.RefObject<HTMLInputElement>;
  aiResponseRef: React.RefObject<HTMLDivElement>;
  setAiAvailable: (value: boolean) => void;

  // History
  conversations: AiConversation[];
  activeConversationId: string | null;

  // Actions
  startAiChat: (searchQuery: string) => void;
  sendMessage: (text: string) => void;
  stopStreaming: () => void;
  newChat: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  exitAiMode: () => void;
}

// ─── Persistence ────────────────────────────────────────────────────

const STORAGE_KEY = 'sc.aiChat.conversations';
const MAX_CONVERSATIONS = 50;

function loadConversations(): AiConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c) =>
        c &&
        typeof c.id === 'string' &&
        Array.isArray(c.messages)
    );
  } catch {
    return [];
  }
}

function saveConversations(convs: AiConversation[]) {
  try {
    const trimmed = convs.slice(0, MAX_CONVERSATIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
}

function makeTitle(text: string): string {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'New Chat';
  return t.length > 48 ? t.slice(0, 48) + '…' : t;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Hook ───────────────────────────────────────────────────────────

export function useAiChat({ onExitAiMode, setAiMode }: UseAiChatOptions): UseAiChatReturn {
  const [conversations, setConversations] = useState<AiConversation[]>(() => loadConversations());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiQuery, setAiQuery] = useState('');

  const aiRequestIdRef = useRef<string | null>(null);
  const aiStreamingRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);
  const aiResponseRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // Persist conversations on change
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  // ── Streaming listeners ────────────────────────────────────────

  useEffect(() => {
    const appendToStreamingMessage = (chunk: string) => {
      const msgId = streamingMessageIdRef.current;
      if (!msgId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, content: m.content + chunk } : m))
      );
    };

    const finalizeConversation = () => {
      const convId = activeConversationIdRef.current;
      if (!convId) return;
      setMessages((current) => {
        setConversations((convs) => {
          const idx = convs.findIndex((c) => c.id === convId);
          const updated: AiConversation = {
            id: convId,
            title:
              convs[idx]?.title && convs[idx].title !== 'New Chat'
                ? convs[idx].title
                : makeTitle(current.find((m) => m.role === 'user')?.content || 'New Chat'),
            messages: current,
            createdAt: convs[idx]?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
          };
          const rest = convs.filter((c) => c.id !== convId);
          return [updated, ...rest];
        });
        return current;
      });
    };

    const handleChunk = (data: { requestId: string; chunk: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        appendToStreamingMessage(data.chunk);
      }
    };
    const handleDone = (data: { requestId: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        aiStreamingRef.current = false;
        setAiStreaming(false);
        streamingMessageIdRef.current = null;
        finalizeConversation();
      }
    };
    const handleError = (data: { requestId: string; error: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        aiStreamingRef.current = false;
        const msgId = streamingMessageIdRef.current;
        if (msgId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, content: m.content + (m.content ? '\n\n' : '') + `Error: ${data.error}` }
                : m
            )
          );
        }
        setAiStreaming(false);
        streamingMessageIdRef.current = null;
        finalizeConversation();
      }
    };

    const removeChunk = window.electron.onAIStreamChunk(handleChunk);
    const removeDone = window.electron.onAIStreamDone(handleDone);
    const removeError = window.electron.onAIStreamError(handleError);

    return () => {
      removeChunk?.();
      removeDone?.();
      removeError?.();
    };
  }, []);

  // ── Auto-scroll on new content ─────────────────────────────────

  useEffect(() => {
    if (aiResponseRef.current) {
      aiResponseRef.current.scrollTop = aiResponseRef.current.scrollHeight;
    }
  }, [messages]);

  // ── Availability check ────────────────────────────────────────

  useEffect(() => {
    window.electron.aiIsAvailable().then(setAiAvailable);
  }, []);

  // ── Internal: send a chat turn ────────────────────────────────

  const sendChatTurn = useCallback((allMessages: AiMessage[]) => {
    // Cancel any in-flight
    if (aiRequestIdRef.current && aiStreamingRef.current) {
      window.electron.aiCancel(aiRequestIdRef.current);
    }
    const requestId = uid('ai');
    aiRequestIdRef.current = requestId;
    aiStreamingRef.current = true;
    setAiStreaming(true);
    const payload = allMessages.map((m) => ({ role: m.role, content: m.content }));
    window.electron.aiChat(requestId, payload);
  }, []);

  // ── Actions ───────────────────────────────────────────────────

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !aiAvailable) return;

      // Ensure we have an active conversation
      let convId = activeConversationIdRef.current;
      if (!convId) {
        convId = uid('conv');
        activeConversationIdRef.current = convId;
        setActiveConversationId(convId);
        const newConv: AiConversation = {
          id: convId,
          title: makeTitle(trimmed),
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setConversations((prev) => [newConv, ...prev]);
      }

      const userMsg: AiMessage = {
        id: uid('msg'),
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
      };
      const assistantMsg: AiMessage = {
        id: uid('msg'),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };
      streamingMessageIdRef.current = assistantMsg.id;

      setMessages((prev) => {
        const next = [...prev, userMsg, assistantMsg];
        sendChatTurn([...prev, userMsg]); // assistant is empty, send context up to user msg
        return next;
      });
      setAiQuery('');
    },
    [aiAvailable, sendChatTurn]
  );

  const startAiChat = useCallback(
    (searchQuery: string) => {
      if (!aiAvailable) return;
      // Start a fresh conversation
      activeConversationIdRef.current = null;
      setActiveConversationId(null);
      setMessages([]);
      setAiMode(true);
      const trimmed = searchQuery.trim();
      if (trimmed) {
        // Send immediately
        setTimeout(() => sendMessage(trimmed), 0);
      } else {
        setAiQuery('');
      }
    },
    [aiAvailable, setAiMode, sendMessage]
  );

  const stopStreaming = useCallback(() => {
    if (aiRequestIdRef.current && aiStreamingRef.current) {
      window.electron.aiCancel(aiRequestIdRef.current);
    }
    aiStreamingRef.current = false;
    setAiStreaming(false);
    const msgId = streamingMessageIdRef.current;
    if (msgId) {
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, cancelled: true } : m))
      );
    }
    streamingMessageIdRef.current = null;
    aiRequestIdRef.current = null;
  }, []);

  const newChat = useCallback(() => {
    if (aiRequestIdRef.current && aiStreamingRef.current) {
      window.electron.aiCancel(aiRequestIdRef.current);
    }
    aiRequestIdRef.current = null;
    aiStreamingRef.current = false;
    streamingMessageIdRef.current = null;
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setMessages([]);
    setAiStreaming(false);
    setAiQuery('');
    setTimeout(() => aiInputRef.current?.focus(), 0);
  }, []);

  const selectConversation = useCallback((id: string) => {
    if (aiRequestIdRef.current && aiStreamingRef.current) {
      window.electron.aiCancel(aiRequestIdRef.current);
    }
    aiRequestIdRef.current = null;
    aiStreamingRef.current = false;
    streamingMessageIdRef.current = null;
    setAiStreaming(false);

    setConversations((convs) => {
      const conv = convs.find((c) => c.id === id);
      if (conv) {
        activeConversationIdRef.current = id;
        setActiveConversationId(id);
        setMessages(conv.messages);
      }
      return convs;
    });
    setAiQuery('');
    setTimeout(() => aiInputRef.current?.focus(), 0);
  }, []);

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationIdRef.current === id) {
        activeConversationIdRef.current = null;
        setActiveConversationId(null);
        setMessages([]);
        if (aiRequestIdRef.current && aiStreamingRef.current) {
          window.electron.aiCancel(aiRequestIdRef.current);
        }
        aiRequestIdRef.current = null;
        aiStreamingRef.current = false;
        streamingMessageIdRef.current = null;
        setAiStreaming(false);
      }
    },
    []
  );

  const exitAiMode = useCallback(() => {
    if (aiRequestIdRef.current && aiStreamingRef.current) {
      window.electron.aiCancel(aiRequestIdRef.current);
    }
    aiRequestIdRef.current = null;
    aiStreamingRef.current = false;
    streamingMessageIdRef.current = null;
    setAiMode(false);
    setAiStreaming(false);
    setAiQuery('');
    // Keep messages + activeConversationId so returning shows the same chat.
    onExitAiMode?.();
  }, [setAiMode, onExitAiMode]);

  // ── Escape to exit AI mode (only while messages/query/streaming) ──

  useEffect(() => {
    if (messages.length === 0 && !aiQuery && !aiStreaming) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitAiMode();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [messages.length, aiQuery, aiStreaming, exitAiMode]);

  return {
    messages,
    aiStreaming,
    aiAvailable,
    aiQuery,
    setAiQuery,
    aiInputRef,
    aiResponseRef,
    setAiAvailable,
    conversations,
    activeConversationId,
    startAiChat,
    sendMessage,
    stopStreaming,
    newChat,
    selectConversation,
    deleteConversation,
    exitAiMode,
  };
}
