/**
 * Persistent store for agent sessions.
 *
 * One JSON file per session under <userData>/agent-sessions/. Atomic writes
 * via tmp+rename. Session IDs are used as filenames with a sanitization pass
 * to prevent path traversal.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { AgentMessage } from './agent-tool-calling';

export interface PersistedAgentStep {
  id: string;
  tool: string;
  args: Record<string, any>;
  summary: string;
  ok: boolean;
  output: string;
  startedAt: number;
  finishedAt: number;
}

export type PersistedAgentLifecycle = 'running' | 'done' | 'error' | 'cancelled';

export interface PersistedAgentSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** First user prompt of the session — used as the display title. */
  query: string;
  workingDir: string | null;
  /** Full model-facing conversation history (system prompt not included). */
  messages: AgentMessage[];
  /** UI-facing step timeline, for rendering the thinking accordion. */
  steps: PersistedAgentStep[];
  /** Model's final assistant text, if the session finished cleanly. */
  finalMessage?: string;
  error?: string;
  lifecycle: PersistedAgentLifecycle;
}

function sessionsDir(): string {
  return path.join(app.getPath('userData'), 'agent-sessions');
}

async function ensureSessionsDir(): Promise<string> {
  const dir = sessionsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

function sanitizeId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export async function saveAgentSession(session: PersistedAgentSession): Promise<void> {
  const dir = await ensureSessionsDir();
  const safeId = sanitizeId(session.id);
  if (!safeId) throw new Error('saveAgentSession: empty id');
  const file = path.join(dir, `${safeId}.json`);
  const tmp = `${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.promises.writeFile(tmp, JSON.stringify(session), 'utf8');
  await fs.promises.rename(tmp, file);
}

export async function loadAgentSession(id: string): Promise<PersistedAgentSession | null> {
  const safeId = sanitizeId(id);
  if (!safeId) return null;
  const file = path.join(sessionsDir(), `${safeId}.json`);
  try {
    const raw = await fs.promises.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as PersistedAgentSession;
  } catch {
    return null;
  }
}

export interface AgentSessionSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  query: string;
  workingDir: string | null;
  lifecycle: PersistedAgentLifecycle;
  stepCount: number;
  finalMessage?: string;
  error?: string;
}

export async function listAgentSessions(limit = 100): Promise<AgentSessionSummary[]> {
  try {
    const dir = await ensureSessionsDir();
    const files = await fs.promises.readdir(dir);
    const summaries: AgentSessionSummary[] = [];
    for (const f of files) {
      if (!f.endsWith('.json') || f.includes('.tmp-')) continue;
      try {
        const raw = await fs.promises.readFile(path.join(dir, f), 'utf8');
        const s = JSON.parse(raw) as PersistedAgentSession;
        if (!s || !s.id) continue;
        summaries.push({
          id: s.id,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          query: s.query,
          workingDir: s.workingDir,
          lifecycle: s.lifecycle,
          stepCount: Array.isArray(s.steps) ? s.steps.length : 0,
          finalMessage: s.finalMessage,
          error: s.error,
        });
      } catch {
        // skip malformed
      }
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries.slice(0, limit);
  } catch {
    return [];
  }
}

export async function deleteAgentSession(id: string): Promise<void> {
  const safeId = sanitizeId(id);
  if (!safeId) return;
  const file = path.join(sessionsDir(), `${safeId}.json`);
  try { await fs.promises.unlink(file); } catch {}
}
