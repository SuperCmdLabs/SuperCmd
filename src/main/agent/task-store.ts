import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface AgentTaskAttemptRecord {
  attempt: number;
  provider: string;
  startedAt: string;
  finishedAt?: string;
  status: 'done' | 'error' | 'cancelled';
  error?: string;
}

export interface AgentTaskRecord {
  requestId: string;
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  attempts: AgentTaskAttemptRecord[];
}

interface TaskFilePayload {
  tasks: AgentTaskRecord[];
}

const MAX_TASKS = 200;

function getTaskStorePath(): string {
  return path.join(app.getPath('userData'), 'agent-tasks.json');
}

function readTaskPayload(): TaskFilePayload {
  try {
    const raw = fs.readFileSync(getTaskStorePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.tasks)) {
      return { tasks: parsed.tasks };
    }
  } catch {}
  return { tasks: [] };
}

function writeTaskPayload(payload: TaskFilePayload): void {
  try {
    fs.writeFileSync(getTaskStorePath(), JSON.stringify(payload, null, 2), 'utf-8');
  } catch {}
}

function withTask(requestId: string, updater: (task: AgentTaskRecord) => void): void {
  const payload = readTaskPayload();
  const task = payload.tasks.find((t) => t.requestId === requestId);
  if (!task) return;
  updater(task);
  payload.tasks = payload.tasks.slice(-MAX_TASKS);
  writeTaskPayload(payload);
}

export function startAgentTask(requestId: string, prompt: string): void {
  const payload = readTaskPayload();
  payload.tasks.push({
    requestId,
    prompt,
    startedAt: new Date().toISOString(),
    status: 'running',
    attempts: [],
  });
  payload.tasks = payload.tasks.slice(-MAX_TASKS);
  writeTaskPayload(payload);
}

export function startAgentTaskAttempt(requestId: string, attempt: number, provider: string): void {
  withTask(requestId, (task) => {
    task.attempts.push({
      attempt,
      provider,
      startedAt: new Date().toISOString(),
      status: 'error',
    });
  });
}

export function finishAgentTaskAttempt(
  requestId: string,
  attempt: number,
  status: 'done' | 'error' | 'cancelled',
  error?: string
): void {
  withTask(requestId, (task) => {
    const entry = [...task.attempts].reverse().find((a) => a.attempt === attempt);
    if (!entry) return;
    entry.status = status;
    entry.error = error;
    entry.finishedAt = new Date().toISOString();
  });
}

export function finishAgentTask(
  requestId: string,
  status: 'done' | 'error' | 'cancelled'
): void {
  withTask(requestId, (task) => {
    task.status = status;
    task.finishedAt = new Date().toISOString();
  });
}

