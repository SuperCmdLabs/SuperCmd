/**
 * useAgentWidget — state + IPC wiring for the agentic action widget.
 *
 * The launcher dispatches a natural-language query via `startAgent(query)`.
 * The main process runs a codex-style ReAct loop (see src/main/agent-runner.ts)
 * and streams structured events back here, which we fold into a visible
 * timeline the AgentWidget UI renders.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent } from '../../types/electron';

export type AgentStepStatus = 'running' | 'ok' | 'error';

export interface AgentTimelineStep {
  id: string;
  tool: string;
  summary: string;
  args: Record<string, any>;
  status: AgentStepStatus;
  output?: string;
  startedAt: number;
  finishedAt?: number;
}

export type AgentLifecycle = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

export interface AgentSession {
  id: string;
  query: string;
  steps: AgentTimelineStep[];
  message: string | null;
  error: string | null;
  lifecycle: AgentLifecycle;
  currentStep: number;
  startedAt: number;
  finishedAt: number | null;
}

interface UseAgentWidgetResult {
  session: AgentSession | null;
  isOpen: boolean;
  startAgent: (query: string) => void;
  cancelAgent: () => void;
  closeWidget: () => void;
}

function newRequestId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAgentWidget(): UseAgentWidgetResult {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const sessionRef = useRef<AgentSession | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Subscribe once to the main-process agent event stream. Events carry a
  // requestId so we can ignore stale sessions' events after cancel/close.
  useEffect(() => {
    const off = window.electron.onAgentEvent((event: AgentEvent) => {
      const current = sessionRef.current;
      if (!current || event.requestId !== current.id) return;

      setSession((prev) => {
        if (!prev || prev.id !== event.requestId) return prev;
        return reduceAgentEvent(prev, event);
      });
    });
    return () => {
      try { off?.(); } catch {}
    };
  }, []);

  const startAgent = useCallback((query: string) => {
    const trimmed = String(query || '').trim();
    if (!trimmed) return;

    // Cancel any in-flight session before starting a new one.
    const prev = sessionRef.current;
    if (prev && prev.lifecycle === 'running') {
      try { window.electron.agentCancel(prev.id); } catch {}
    }

    const requestId = newRequestId();
    const next: AgentSession = {
      id: requestId,
      query: trimmed,
      steps: [],
      message: null,
      error: null,
      lifecycle: 'running',
      currentStep: 0,
      startedAt: Date.now(),
      finishedAt: null,
    };
    setSession(next);
    setIsOpen(true);
    try {
      void window.electron.agentRun(requestId, trimmed);
    } catch (err: any) {
      setSession({
        ...next,
        lifecycle: 'error',
        error: err?.message || 'Failed to start agent',
        finishedAt: Date.now(),
      });
    }
  }, []);

  const cancelAgent = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    try { window.electron.agentCancel(current.id); } catch {}
    setSession((prev) => {
      if (!prev) return prev;
      if (prev.lifecycle !== 'running') return prev;
      return {
        ...prev,
        lifecycle: 'cancelled',
        finishedAt: Date.now(),
        steps: prev.steps.map((s) =>
          s.status === 'running' ? { ...s, status: 'error' as const, output: 'Cancelled by user.', finishedAt: Date.now() } : s
        ),
      };
    });
  }, []);

  const closeWidget = useCallback(() => {
    const current = sessionRef.current;
    if (current && current.lifecycle === 'running') {
      try { window.electron.agentCancel(current.id); } catch {}
    }
    setIsOpen(false);
    setSession(null);
  }, []);

  return { session, isOpen, startAgent, cancelAgent, closeWidget };
}

function reduceAgentEvent(state: AgentSession, event: AgentEvent): AgentSession {
  switch (event.type) {
    case 'started':
      return state;
    case 'step':
      return { ...state, currentStep: event.step };
    case 'thinking':
      // Thinking deltas are the raw JSON stream from the model. We don't
      // surface them directly — the parsed tool_call gives a cleaner signal.
      return state;
    case 'tool_call':
      return {
        ...state,
        steps: [
          ...state.steps,
          {
            id: event.id,
            tool: event.tool,
            summary: event.summary,
            args: event.args || {},
            status: 'running',
            startedAt: Date.now(),
          },
        ],
      };
    case 'tool_result':
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.id === event.id
            ? {
                ...s,
                status: event.ok ? 'ok' : 'error',
                output: event.output,
                finishedAt: Date.now(),
              }
            : s
        ),
      };
    case 'message':
      return { ...state, message: event.text };
    case 'done':
      return {
        ...state,
        lifecycle: state.lifecycle === 'running' ? 'done' : state.lifecycle,
        finishedAt: Date.now(),
      };
    case 'error':
      return {
        ...state,
        lifecycle: 'error',
        error: event.error,
        finishedAt: Date.now(),
      };
    default:
      return state;
  }
}
