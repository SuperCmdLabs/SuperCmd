/**
 * useAiChat.ts
 *
 * State and streaming logic for the AI chat mode (the full-screen AI panel).
 * - Manages aiQuery, aiResponse, aiStreaming, aiAvailable state
 * - Tracks full conversation history across turns (multi-turn context)
 * - Persists conversation history to localStorage so it survives page refreshes
 * - Listens for ai-stream-chunk / ai-stream-done / ai-stream-error / ai-tool-calls
 *   IPC events, routing them by requestId so cursor-prompt streams don't bleed in
 * - startAiChat(query): enter AI mode and fire the first request (clears history)
 * - submitAiQuery(query): submit a follow-up in an ongoing conversation
 * - clearConversation(): wipe history and reset to fresh state
 * - exitAiMode(): cancel any in-flight request, reset state, restore launcher focus
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Interfaces ──────────────────────────────────────────────────────

export interface AIMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface UseAiChatOptions {
  onExitAiMode?: () => void;
  setAiMode: (value: boolean) => void;
}

export interface UseAiChatReturn {
  aiResponse: string;
  aiStreaming: boolean;
  aiAvailable: boolean;
  aiQuery: string;
  setAiQuery: (value: string) => void;
  aiResponseRef: React.RefObject<HTMLDivElement>;
  aiInputRef: React.RefObject<HTMLInputElement>;
  setAiAvailable: (value: boolean) => void;
  conversationHistory: AIMessage[];
  activeToolCalls: Array<{ name: string; args: Record<string, any> }>;
  startAiChat: (searchQuery: string) => void;
  submitAiQuery: (query: string) => void;
  clearConversation: () => void;
  exitAiMode: () => void;
}

const HISTORY_STORAGE_KEY = 'sc-ai-conversation-history';
const MAX_HISTORY_MESSAGES = 40; // keep last 40 messages (~20 turns)

function loadStoredHistory(): AIMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY_MESSAGES) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: AIMessage[]): void {
  try {
    const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // storage full or unavailable — ignore
  }
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useAiChat({ onExitAiMode, setAiMode }: UseAiChatOptions): UseAiChatReturn {
  const [aiResponse, setAiResponse] = useState('');
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [conversationHistory, setConversationHistory] = useState<AIMessage[]>(loadStoredHistory);
  const [activeToolCalls, setActiveToolCalls] = useState<Array<{ name: string; args: Record<string, any> }>>([]);

  const aiRequestIdRef = useRef<string | null>(null);
  const aiStreamingRef = useRef(false);
  const aiResponseRef = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);

  // Refs to track the current turn's query and accumulated response
  // (needed in callbacks without stale closure issues)
  const currentQueryRef = useRef('');
  const currentResponseRef = useRef('');
  // Snapshot of history at the start of a request (to avoid stale closure in handleDone)
  const historySnapshotRef = useRef<AIMessage[]>([]);

  // ── AI streaming listeners ──────────────────────────────────────

  useEffect(() => {
    const handleChunk = (data: { requestId: string; chunk: string }) => {
      if (data.requestId !== aiRequestIdRef.current) return;
      currentResponseRef.current += data.chunk;
      setAiResponse((prev) => prev + data.chunk);
    };

    const handleDone = (data: { requestId: string }) => {
      if (data.requestId !== aiRequestIdRef.current) return;
      aiStreamingRef.current = false;
      setAiStreaming(false);
      setActiveToolCalls([]);

      // Append this turn to conversation history
      const userMsg: AIMessage = { role: 'user', content: currentQueryRef.current };
      const assistantMsg: AIMessage = { role: 'assistant', content: currentResponseRef.current };
      const newHistory = [...historySnapshotRef.current, userMsg, assistantMsg];
      setConversationHistory(newHistory);
      saveHistory(newHistory);
    };

    const handleError = (data: { requestId: string; error: string }) => {
      if (data.requestId !== aiRequestIdRef.current) return;
      aiStreamingRef.current = false;
      setAiResponse((prev) => prev + `\n\nError: ${data.error}`);
      setAiStreaming(false);
      setActiveToolCalls([]);
    };

    const handleToolCalls = (data: { requestId: string; toolCalls: Array<{ name: string; args: Record<string, any> }> }) => {
      if (data.requestId !== aiRequestIdRef.current) return;
      setActiveToolCalls(data.toolCalls);
    };

    window.electron.onAIStreamChunk(handleChunk);
    window.electron.onAIStreamDone(handleDone);
    window.electron.onAIStreamError(handleError);
    window.electron.onAIToolCalls(handleToolCalls);
  }, []);

  // ── Auto-scroll AI response ─────────────────────────────────────

  useEffect(() => {
    if (aiResponseRef.current) {
      aiResponseRef.current.scrollTop = aiResponseRef.current.scrollHeight;
    }
  }, [aiResponse]);

  // ── Escape to exit AI mode ──────────────────────────────────────

  useEffect(() => {
    if (!aiQuery && !aiResponse && !aiStreaming) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitAiMode();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [aiQuery, aiResponse, aiStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── AI availability check on mount ──────────────────────────────

  useEffect(() => {
    window.electron.aiIsAvailable().then(setAiAvailable);
  }, []);

  // ── Callbacks ───────────────────────────────────────────────────

  const startAiChat = useCallback(
    (searchQuery: string) => {
      if (!searchQuery.trim() || !aiAvailable) return;

      // Start fresh — new conversation clears history
      const requestId = `ai-${Date.now()}`;
      aiRequestIdRef.current = requestId;
      aiStreamingRef.current = true;
      currentQueryRef.current = searchQuery;
      currentResponseRef.current = '';
      historySnapshotRef.current = []; // fresh conversation

      setAiQuery(searchQuery);
      setAiResponse('');
      setAiStreaming(true);
      setAiMode(true);
      setConversationHistory([]);
      setActiveToolCalls([]);

      window.electron.aiAsk(requestId, searchQuery, { useTools: true });
    },
    [aiAvailable, setAiMode],
  );

  const submitAiQuery = useCallback(
    (query: string) => {
      if (!query.trim()) return;

      // Cancel any in-flight request
      if (aiRequestIdRef.current && aiStreamingRef.current) {
        window.electron.aiCancel(aiRequestIdRef.current);
      }

      const requestId = `ai-${Date.now()}`;
      aiRequestIdRef.current = requestId;
      aiStreamingRef.current = true;
      currentQueryRef.current = query;
      currentResponseRef.current = '';

      // Snapshot current history before this new turn
      setConversationHistory((prev) => {
        historySnapshotRef.current = prev;
        return prev;
      });

      setAiQuery(query);
      setAiResponse('');
      setAiStreaming(true);
      setActiveToolCalls([]);

      // Pass full conversation history as context
      window.electron.aiAsk(requestId, query, {
        messages: historySnapshotRef.current,
        useTools: true,
      });
    },
    [],
  );

  const clearConversation = useCallback(() => {
    if (aiRequestIdRef.current && aiStreamingRef.current) {
      window.electron.aiCancel(aiRequestIdRef.current);
    }
    aiRequestIdRef.current = null;
    aiStreamingRef.current = false;
    currentQueryRef.current = '';
    currentResponseRef.current = '';
    historySnapshotRef.current = [];

    setConversationHistory([]);
    setAiResponse('');
    setAiStreaming(false);
    setAiQuery('');
    setActiveToolCalls([]);
    saveHistory([]);
  }, []);

  const exitAiMode = useCallback(() => {
    if (aiRequestIdRef.current && aiStreamingRef.current) {
      window.electron.aiCancel(aiRequestIdRef.current);
    }
    aiRequestIdRef.current = null;
    aiStreamingRef.current = false;
    setAiMode(false);
    setAiResponse('');
    setAiStreaming(false);
    setAiQuery('');
    setActiveToolCalls([]);
    onExitAiMode?.();
    // Note: conversation history is preserved on exit so the user can
    // re-open AI mode and continue the conversation
  }, [setAiMode, onExitAiMode]);

  return {
    aiResponse,
    aiStreaming,
    aiAvailable,
    aiQuery,
    setAiQuery,
    aiResponseRef,
    aiInputRef,
    setAiAvailable,
    conversationHistory,
    activeToolCalls,
    startAiChat,
    submitAiQuery,
    clearConversation,
    exitAiMode,
  };
}
