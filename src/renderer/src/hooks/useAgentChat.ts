/**
 * useAgentChat — state and logic for the agent chat mode.
 *
 * Manages structured conversations with tool calls, results,
 * confirmations, and multi-turn history.
 *
 * Separate from useAiChat (which remains for simple text chat).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { AgentEvent } from '../../types/electron';

// ─── Types ──────────────────────────────────────────────────────────

export interface AgentStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'error' | 'status';
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, any>;
    dangerous: boolean;
    confirmationMessage?: string;
  };
  toolResult?: {
    id: string;
    name: string;
    success: boolean;
    output: string;
    durationMs: number;
  };
  timestamp: number;
}

export interface AgentConversationTurn {
  role: 'user' | 'assistant';
  query?: string;
  steps: AgentStep[];
  finalAnswer: string;
}

export interface UseAgentChatOptions {
  onExitAgentMode?: () => void;
  setAiMode: (value: boolean) => void;
}

export interface UseAgentChatReturn {
  conversation: AgentConversationTurn[];
  isRunning: boolean;
  pendingConfirmation: {
    toolCallId: string;
    toolName: string;
    message: string;
    args: Record<string, any>;
  } | null;
  agentQuery: string;
  setAgentQuery: (value: string) => void;
  submitQuery: (query: string) => void;
  startAgentChat: (query: string) => void;
  confirmTool: (toolCallId: string, approved: boolean) => void;
  cancelAgent: () => void;
  exitAgentMode: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  scrollRef: React.RefObject<HTMLDivElement>;
  agentAvailable: boolean;
  setAgentAvailable: (value: boolean) => void;
}

// ─── Hook ───────────────────────────────────────────────────────────

export function useAgentChat({
  onExitAgentMode,
  setAiMode,
}: UseAgentChatOptions): UseAgentChatReturn {
  const [conversation, setConversation] = useState<AgentConversationTurn[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<UseAgentChatReturn['pendingConfirmation']>(null);
  const [agentQuery, setAgentQuery] = useState('');
  const [agentAvailable, setAgentAvailable] = useState(false);

  const requestIdRef = useRef<string | null>(null);
  const isRunningRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Helper: append a step to the last assistant turn
  const appendStep = useCallback((step: AgentStep) => {
    setConversation((prev) => {
      const updated = [...prev];
      const lastTurn = updated[updated.length - 1];
      if (lastTurn?.role === 'assistant') {
        lastTurn.steps = [...lastTurn.steps, step];
      }
      return updated;
    });
  }, []);

  // Helper: append to the final answer of the last assistant turn
  const appendToFinalAnswer = useCallback((text: string) => {
    setConversation((prev) => {
      const updated = [...prev];
      const lastTurn = updated[updated.length - 1];
      if (lastTurn?.role === 'assistant') {
        lastTurn.finalAnswer = (lastTurn.finalAnswer || '') + text;
      }
      return updated;
    });
  }, []);

  // ── Agent event listener ──────────────────────────────────────

  useEffect(() => {
    const cleanup = window.electron.onAgentEvent((event: AgentEvent) => {
      if (event.requestId !== requestIdRef.current) return;

      switch (event.type) {
        case 'thinking':
          appendStep({
            type: 'thinking',
            text: event.text,
            timestamp: Date.now(),
          });
          break;

        case 'status':
          appendStep({
            type: 'status',
            text: event.status || event.text,
            timestamp: Date.now(),
          });
          break;

        case 'tool_call':
          appendStep({
            type: 'tool_call',
            toolCall: event.toolCall,
            timestamp: Date.now(),
          });
          break;

        case 'tool_result':
          appendStep({
            type: 'tool_result',
            toolResult: event.toolResult,
            timestamp: Date.now(),
          });
          break;

        case 'confirm_needed':
          if (event.confirmation) {
            setPendingConfirmation(event.confirmation);
          }
          break;

        case 'text_chunk':
          appendToFinalAnswer(event.text || '');
          break;

        case 'done':
          isRunningRef.current = false;
          setIsRunning(false);
          break;

        case 'error':
          appendStep({
            type: 'error',
            text: event.error,
            timestamp: Date.now(),
          });
          isRunningRef.current = false;
          setIsRunning(false);
          break;
      }
    });

    return cleanup;
  }, [appendStep, appendToFinalAnswer]);

  // ── Auto-scroll ───────────────────────────────────────────────

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation]);

  // ── AI availability check ─────────────────────────────────────

  useEffect(() => {
    window.electron.aiIsAvailable().then(setAgentAvailable);
  }, []);

  // ── Build conversation history for multi-turn ─────────────────

  const buildHistory = useCallback((conv: AgentConversationTurn[]): any[] => {
    const history: any[] = [];
    for (const turn of conv) {
      if (turn.role === 'user' && turn.query) {
        history.push({ role: 'user', content: turn.query });
      } else if (turn.role === 'assistant' && turn.finalAnswer) {
        history.push({ role: 'assistant', content: turn.finalAnswer });
      }
    }
    return history;
  }, []);

  // ── Submit a query ────────────────────────────────────────────

  const submitQuery = useCallback(
    (query: string) => {
      if (!query.trim() || isRunningRef.current) return;

      const requestId = `agent-${Date.now()}`;
      requestIdRef.current = requestId;
      isRunningRef.current = true;
      setIsRunning(true);
      setAgentQuery(query);

      // Build history from prior turns
      const history = buildHistory(conversation);

      // Add user turn + empty assistant turn
      setConversation((prev) => [
        ...prev,
        { role: 'user', query, steps: [], finalAnswer: '' },
        { role: 'assistant', steps: [], finalAnswer: '' },
      ]);

      window.electron.agentRun(requestId, query, history);
    },
    [conversation, buildHistory]
  );

  // ── Start agent chat (entry point from App.tsx) ───────────────

  const startAgentChat = useCallback(
    (query: string) => {
      if (!query.trim() || !agentAvailable) return;
      setAiMode(true);
      // Reset conversation for fresh start
      setConversation([]);
      // Defer submit to next tick so mode is set
      setTimeout(() => submitQuery(query), 0);
    },
    [agentAvailable, setAiMode, submitQuery]
  );

  // ── Confirm/deny tool ─────────────────────────────────────────

  const confirmTool = useCallback(
    (toolCallId: string, approved: boolean) => {
      window.electron.agentConfirm(toolCallId, approved);
      setPendingConfirmation(null);
    },
    []
  );

  // ── Cancel ────────────────────────────────────────────────────

  const cancelAgent = useCallback(() => {
    if (requestIdRef.current && isRunningRef.current) {
      window.electron.agentCancel(requestIdRef.current);
    }
    isRunningRef.current = false;
    setIsRunning(false);
    setPendingConfirmation(null);
  }, []);

  // ── Exit agent mode ───────────────────────────────────────────

  const exitAgentMode = useCallback(() => {
    cancelAgent();
    requestIdRef.current = null;
    setAiMode(false);
    setConversation([]);
    setAgentQuery('');
    onExitAgentMode?.();
  }, [cancelAgent, setAiMode, onExitAgentMode]);

  // ── Escape to exit ────────────────────────────────────────────

  useEffect(() => {
    if (conversation.length === 0 && !isRunning) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isRunningRef.current) {
          cancelAgent();
        } else {
          exitAgentMode();
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [conversation.length, isRunning, cancelAgent, exitAgentMode]);

  return {
    conversation,
    isRunning,
    pendingConfirmation,
    agentQuery,
    setAgentQuery,
    submitQuery,
    startAgentChat,
    confirmTool,
    cancelAgent,
    exitAgentMode,
    inputRef,
    scrollRef,
    agentAvailable,
    setAgentAvailable,
  };
}
