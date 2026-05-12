/**
 * useAiChat.ts
 *
 * Multi-turn AI chat state with conversation history.
 * - Owns `messages` array for the active conversation
 * - Persists conversation list + bodies in the Electron main process
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
import type {
  AiChatConversation as AiConversation,
  AiChatMessage as AiMessage,
  AiChatSnapshot,
} from '../../types/electron';

export type { AiConversation, AiMessage };

export interface UseAiChatOptions {
  onExitAiMode?: () => void;
  setAiMode: (value: boolean) => void;
}

export interface UseAiChatReturn {
  messages: AiMessage[];
  aiStreaming: boolean;
  aiAvailable: boolean;
  aiQuery: string;
  setAiQuery: (value: string) => void;
  aiInputRef: React.RefObject<HTMLInputElement>;
  aiResponseRef: React.RefObject<HTMLDivElement>;
  setAiAvailable: (value: boolean) => void;
  conversations: AiConversation[];
  activeConversationId: string | null;
  startAiChat: (searchQuery: string) => void;
  sendMessage: (text: string) => void;
  stopStreaming: () => void;
  newChat: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  exitAiMode: () => void;
}

const MAX_CONVERSATIONS = 50;

function makeTitle(text: string): string {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'New Chat';
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSnapshot(snapshot: AiChatSnapshot | null | undefined): AiConversation[] {
  if (!snapshot || !Array.isArray(snapshot.conversations)) return [];
  return snapshot.conversations.slice(0, MAX_CONVERSATIONS);
}

export function useAiChat({ onExitAiMode, setAiMode }: UseAiChatOptions): UseAiChatReturn {
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiQuery, setAiQuery] = useState('');

  const aiRequestIdRef = useRef<string | null>(null);
  const aiStreamingRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const messagesRef = useRef<AiMessage[]>([]);
  const aiInputRef = useRef<HTMLInputElement>(null);
  const aiResponseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const applySnapshot = useCallback((snapshot: AiChatSnapshot | null | undefined) => {
    const nextConversations = normalizeSnapshot(snapshot);
    setConversations(nextConversations);

    if (aiStreamingRef.current) {
      return;
    }

    const activeId = activeConversationIdRef.current;
    if (!activeId) return;

    const nextActive = nextConversations.find((conversation) => conversation.id === activeId);
    if (nextActive) {
      setMessages(nextActive.messages);
      return;
    }

    if (messagesRef.current.length === 0) {
      activeConversationIdRef.current = null;
      setActiveConversationId(null);
    }
  }, []);

  const refreshSnapshot = useCallback(() => {
    void window.electron.getAiChatSnapshot()
      .then((snapshot) => {
        applySnapshot(snapshot);
      })
      .catch(() => {});
  }, [applySnapshot]);

  useEffect(() => {
    refreshSnapshot();
  }, [refreshSnapshot]);

  useEffect(() => {
    return window.electron.onAiChatsUpdated(() => {
      refreshSnapshot();
    });
  }, [refreshSnapshot]);

  const persistConversation = useCallback((conversation: AiConversation) => {
    setConversations((prev) => [
      conversation,
      ...prev.filter((entry) => entry.id !== conversation.id),
    ].slice(0, MAX_CONVERSATIONS));
    void window.electron.upsertAiChatConversation(conversation);
  }, []);

  useEffect(() => {
    const appendToStreamingMessage = (chunk: string) => {
      const msgId = streamingMessageIdRef.current;
      if (!msgId) return;
      setMessages((prev) =>
        prev.map((message) => (
          message.id === msgId
            ? { ...message, content: message.content + chunk }
            : message
        ))
      );
    };

    const finalizeConversation = () => {
      const conversationId = activeConversationIdRef.current;
      if (!conversationId) return;

      setMessages((current) => {
        const existing = conversations.find((conversation) => conversation.id === conversationId);
        const updatedConversation: AiConversation = {
          id: conversationId,
          title:
            existing?.title && existing.title !== 'New Chat'
              ? existing.title
              : makeTitle(current.find((message) => message.role === 'user')?.content || 'New Chat'),
          messages: current,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          source: existing?.source || 'local',
          ...(existing?.sourceConversationId ? { sourceConversationId: existing.sourceConversationId } : {}),
          ...(existing?.metadata ? { metadata: existing.metadata } : {}),
        };
        persistConversation(updatedConversation);
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
            prev.map((message) =>
              message.id === msgId
                ? {
                    ...message,
                    content: message.content + (message.content ? '\n\n' : '') + `Error: ${data.error}`,
                  }
                : message
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
  }, [conversations, persistConversation]);

  useEffect(() => {
    if (aiResponseRef.current) {
      aiResponseRef.current.scrollTop = aiResponseRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    window.electron.aiIsAvailable().then(setAiAvailable);
  }, []);

  const sendChatTurn = useCallback((allMessages: AiMessage[]) => {
    if (aiRequestIdRef.current && aiStreamingRef.current) {
      window.electron.aiCancel(aiRequestIdRef.current);
    }
    const requestId = uid('ai');
    aiRequestIdRef.current = requestId;
    aiStreamingRef.current = true;
    setAiStreaming(true);
    const payload = allMessages.map((message) => ({ role: message.role, content: message.content }));
    window.electron.aiChat(requestId, payload);
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !aiAvailable) return;

      let conversationId = activeConversationIdRef.current;
      if (!conversationId) {
        conversationId = uid('conv');
        activeConversationIdRef.current = conversationId;
        setActiveConversationId(conversationId);
        persistConversation({
          id: conversationId,
          title: makeTitle(trimmed),
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: 'local',
        });
      }

      const userMessage: AiMessage = {
        id: uid('msg'),
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
      };
      const assistantMessage: AiMessage = {
        id: uid('msg'),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };
      streamingMessageIdRef.current = assistantMessage.id;

      setMessages((prev) => {
        const next = [...prev, userMessage, assistantMessage];
        sendChatTurn([...prev, userMessage]);
        return next;
      });
      setAiQuery('');
    },
    [aiAvailable, persistConversation, sendChatTurn]
  );

  const startAiChat = useCallback(
    (searchQuery: string) => {
      if (!aiAvailable) return;
      activeConversationIdRef.current = null;
      setActiveConversationId(null);
      setMessages([]);
      setAiMode(true);
      const trimmed = searchQuery.trim();
      if (trimmed) {
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
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessages((prev) =>
        prev.map((message) => (message.id === messageId ? { ...message, cancelled: true } : message))
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

    setConversations((current) => {
      const conversation = current.find((entry) => entry.id === id);
      if (conversation) {
        activeConversationIdRef.current = id;
        setActiveConversationId(id);
        setMessages(conversation.messages);
      }
      return current;
    });
    setAiQuery('');
    setTimeout(() => aiInputRef.current?.focus(), 0);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((conversation) => conversation.id !== id));
    void window.electron.deleteAiChatConversation(id);
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
  }, []);

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
    onExitAiMode?.();
  }, [setAiMode, onExitAiMode]);

  useEffect(() => {
    if (messages.length === 0 && !aiQuery && !aiStreaming) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
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
