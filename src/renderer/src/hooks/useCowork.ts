/**
 * useCowork.ts
 *
 * State and streaming logic for the Cowork local AI code assistant panel.
 * - Maintains a multi-turn conversation history
 * - Streams responses from Ollama via the existing aiAsk IPC channel
 * - Formats conversation history into each prompt so the model has context
 *
 * Rendered by App.tsx when showCowork === true.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface CoworkMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface UseCoworkOptions {
  setShowCowork: (value: boolean) => void;
}

export interface UseCoworkReturn {
  messages: CoworkMessage[];
  currentInput: string;
  setCurrentInput: (value: string) => void;
  isStreaming: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  submitMessage: (text: string) => void;
  clearConversation: () => void;
  exitCowork: () => void;
}

const COWORK_SYSTEM_PROMPT = `You are a local AI coding assistant running inside SuperCmd on macOS. Help with:
- Writing and editing code
- Explaining code and debugging
- Shell commands and automation
- File and project structure questions

Be concise and practical. Format code in markdown fenced code blocks with the language specified.`;

export function useCowork({ setShowCowork }: UseCoworkOptions): UseCoworkReturn {
  const [messages, setMessages] = useState<CoworkMessage[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const requestIdRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── AI streaming listeners ──────────────────────────────────────

  useEffect(() => {
    const handleChunk = (data: { requestId: string; chunk: string }) => {
      if (data.requestId !== requestIdRef.current) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, content: last.content + data.chunk }];
        }
        return [...prev, { role: 'assistant' as const, content: data.chunk }];
      });
    };

    const handleDone = (data: { requestId: string }) => {
      if (data.requestId !== requestIdRef.current) return;
      streamingRef.current = false;
      setIsStreaming(false);
    };

    const handleError = (data: { requestId: string; error: string }) => {
      if (data.requestId !== requestIdRef.current) return;
      streamingRef.current = false;
      setIsStreaming(false);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, content: last.content + `\n\nError: ${data.error}` }];
        }
        return [...prev, { role: 'assistant' as const, content: `Error: ${data.error}` }];
      });
    };

    window.electron.onAIStreamChunk(handleChunk);
    window.electron.onAIStreamDone(handleDone);
    window.electron.onAIStreamError(handleError);
  }, []);

  // ── Auto-scroll to bottom ───────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Callbacks ───────────────────────────────────────────────────

  const submitMessage = useCallback(
    (text: string) => {
      if (!text.trim() || streamingRef.current) return;

      const userMessage: CoworkMessage = { role: 'user', content: text.trim() };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setCurrentInput('');

      // Format conversation history into a single prompt string
      const prompt = updatedMessages
        .map((m) => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
        .join('\n\n') + '\n\nAssistant:';

      const requestId = `cowork-${Date.now()}`;
      requestIdRef.current = requestId;
      streamingRef.current = true;
      setIsStreaming(true);

      window.electron.aiAsk(requestId, prompt, {
        systemPrompt: COWORK_SYSTEM_PROMPT,
      });
    },
    [messages],
  );

  const clearConversation = useCallback(() => {
    if (requestIdRef.current && streamingRef.current) {
      window.electron.aiCancel(requestIdRef.current);
    }
    requestIdRef.current = null;
    streamingRef.current = false;
    setMessages([]);
    setIsStreaming(false);
    setCurrentInput('');
  }, []);

  const exitCowork = useCallback(() => {
    if (requestIdRef.current && streamingRef.current) {
      window.electron.aiCancel(requestIdRef.current);
    }
    requestIdRef.current = null;
    streamingRef.current = false;
    setShowCowork(false);
    setMessages([]);
    setIsStreaming(false);
    setCurrentInput('');
  }, [setShowCowork]);

  return {
    messages,
    currentInput,
    setCurrentInput,
    isStreaming,
    inputRef,
    messagesEndRef,
    submitMessage,
    clearConversation,
    exitCowork,
  };
}
