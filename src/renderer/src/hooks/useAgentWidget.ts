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

export interface AgentPendingApproval {
  id: string;
  tool: string;
  args: Record<string, any>;
  summary: string;
}

export interface AgentSession {
  id: string;
  query: string;
  workingDir: string | null;
  steps: AgentTimelineStep[];
  message: string | null;
  error: string | null;
  lifecycle: AgentLifecycle;
  currentStep: number;
  startedAt: number;
  finishedAt: number | null;
  /** Tool calls currently blocked waiting on a user approve/deny decision. */
  pendingApproval: AgentPendingApproval | null;
}

interface UseAgentWidgetResult {
  session: AgentSession | null;
  isOpen: boolean;
  startAgent: (query: string) => void;
  cancelAgent: () => void;
  closeWidget: () => void;
  respondToApproval: (callId: string, approved: boolean) => void;
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
      workingDir: null,
      steps: [],
      message: null,
      error: null,
      lifecycle: 'running',
      currentStep: 0,
      startedAt: Date.now(),
      finishedAt: null,
      pendingApproval: null,
    };
    setSession(next);
    setIsOpen(true);

    // Resolve the context folder (Finder target / terminal cwd captured at
    // show-time) and kick off the run. We don't block UI on the lookup — the
    // `started` event will backfill workingDir if this call races.
    (async () => {
      let workingDir: string | null = null;
      try {
        workingDir = (await window.electron.agentGetContextFolder()) || null;
      } catch {
        workingDir = null;
      }
      if (workingDir) {
        setSession((s) => (s && s.id === requestId ? { ...s, workingDir } : s));
      }
      try {
        void window.electron.agentRun(requestId, trimmed, workingDir || undefined);
      } catch (err: any) {
        setSession((s) =>
          s && s.id === requestId
            ? { ...s, lifecycle: 'error', error: err?.message || 'Failed to start agent', finishedAt: Date.now() }
            : s
        );
      }
    })();
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

  const respondToApproval = useCallback((callId: string, approved: boolean) => {
    try { window.electron.agentApprovalResponse(callId, approved); } catch {}
    // Optimistically clear the pending prompt — the `approval_resolved`
    // event from main will confirm.
    setSession((prev) => (prev ? { ...prev, pendingApproval: null } : prev));
  }, []);

  return { session, isOpen, startAgent, cancelAgent, closeWidget, respondToApproval };
}

function reduceAgentEvent(state: AgentSession, event: AgentEvent): AgentSession {
  switch (event.type) {
    case 'started':
      return event.workingDir && !state.workingDir
        ? { ...state, workingDir: event.workingDir }
        : state;
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
    case 'approval_request':
      return {
        ...state,
        pendingApproval: {
          id: event.id,
          tool: event.tool,
          args: event.args || {},
          summary: event.summary,
        },
      };
    case 'approval_resolved':
      return state.pendingApproval && state.pendingApproval.id === event.id
        ? { ...state, pendingApproval: null }
        : state;
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
