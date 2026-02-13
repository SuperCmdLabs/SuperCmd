import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Interfaces ──────────────────────────────────────────────────────

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
  startAiChat: (searchQuery: string) => void;
  submitAiQuery: (query: string) => void;
  exitAiMode: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useAiChat({ onExitAiMode, setAiMode }: UseAiChatOptions): UseAiChatReturn {
  const [aiResponse, setAiResponse] = useState('');
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiQuery, setAiQuery] = useState('');

  const aiRequestIdRef = useRef<string | null>(null);
  const aiStreamingRef = useRef(false);
  const aiResponseRef = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);

  // ── AI streaming listeners (only for AI chat requests) ──────────

  useEffect(() => {
    const handleChunk = (data: { requestId: string; chunk: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        setAiResponse((prev) => prev + data.chunk);
      }
    };
    const handleDone = (data: { requestId: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        aiStreamingRef.current = false;
        setAiStreaming(false);
      }
    };
    const handleError = (data: { requestId: string; error: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        aiStreamingRef.current = false;
        setAiResponse((prev) => prev + `\n\nError: ${data.error}`);
        setAiStreaming(false);
      }
    };

    window.electron.onAIStreamChunk(handleChunk);
    window.electron.onAIStreamDone(handleDone);
    window.electron.onAIStreamError(handleError);
  }, []);

  // ── Auto-scroll AI response ─────────────────────────────────────

  useEffect(() => {
    if (aiResponseRef.current) {
      aiResponseRef.current.scrollTop = aiResponseRef.current.scrollHeight;
    }
  }, [aiResponse]);

  // ── Escape to exit AI mode ──────────────────────────────────────
  // The parent passes `aiMode` implicitly via setAiMode, but we listen
  // for Escape only when we have an active query or response.

  useEffect(() => {
    // We can detect "ai mode is active" from internal state: if aiQuery
    // is set, we're in AI mode. This avoids needing aiMode as a param.
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
      const requestId = `ai-${Date.now()}`;
      aiRequestIdRef.current = requestId;
      aiStreamingRef.current = true;
      setAiQuery(searchQuery);
      setAiResponse('');
      setAiStreaming(true);
      setAiMode(true);
      window.electron.aiAsk(requestId, searchQuery);
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
      setAiQuery(query);
      setAiResponse('');
      setAiStreaming(true);
      window.electron.aiAsk(requestId, query);
    },
    [],
  );

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
    onExitAiMode?.();
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
    startAiChat,
    submitAiQuery,
    exitAiMode,
  };
}
