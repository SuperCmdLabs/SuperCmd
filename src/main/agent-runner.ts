/**
 * Agent Runner — autonomous action agent for SuperCmd.
 *
 * A codex-inspired ReAct loop that lets a user type a natural-language
 * instruction and have an LLM drive a sequence of tool calls to fulfil it.
 * Tools run inside the main process with the user's privileges. The agent
 * streams structured events to the renderer so the AgentWidget can show
 * each step as it happens.
 *
 * Event protocol (one-way main → renderer, channel `agent-event`):
 *   { requestId, type: 'started' }
 *   { requestId, type: 'thinking', delta: string }
 *   { requestId, type: 'step', step: number }
 *   { requestId, type: 'tool_call', id, tool, args }
 *   { requestId, type: 'tool_result', id, ok, output }
 *   { requestId, type: 'message', text }          // final_answer
 *   { requestId, type: 'done' }
 *   { requestId, type: 'error', error: string }
 *
 * Providers don't expose native tool-calling here, so we use a strict
 * JSON-action protocol: the model must reply with a single JSON object
 * describing one tool invocation per turn.
 */

import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { shell, clipboard } from 'electron';
import { streamAIChat, type ChatMessage } from './ai-provider';
import type { AppSettings } from './settings-store';

const MAX_STEPS = 12;
const SHELL_TIMEOUT_MS = 30_000;
const MAX_TOOL_OUTPUT_CHARS = 6_000;
const MAX_FILE_READ_BYTES = 200_000;

export type AgentEvent =
  | { requestId: string; type: 'started'; query: string }
  | { requestId: string; type: 'thinking'; delta: string }
  | { requestId: string; type: 'step'; step: number }
  | { requestId: string; type: 'tool_call'; id: string; tool: string; args: Record<string, any>; summary: string }
  | { requestId: string; type: 'tool_result'; id: string; ok: boolean; output: string }
  | { requestId: string; type: 'message'; text: string }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'error'; error: string };

interface ToolInvocation {
  tool: string;
  args: Record<string, any>;
}

interface ModelAction {
  thought?: string;
  action: ToolInvocation;
}

interface RunAgentOptions {
  requestId: string;
  query: string;
  settings: AppSettings;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
}

// ─── Tool registry ────────────────────────────────────────────────────

interface ToolSpec {
  name: string;
  description: string;
  args: string; // JSON-shape hint for the prompt
  summarize: (args: Record<string, any>) => string;
  run: (args: Record<string, any>, ctx: { signal: AbortSignal }) => Promise<string>;
}

const TOOLS: ToolSpec[] = [
  {
    name: 'run_shell',
    description:
      'Run a shell command on the user\'s machine. Returns combined stdout+stderr (truncated). Use non-interactive commands only. Avoid destructive operations unless the user asked for them.',
    args: '{ "command": "string", "cwd"?: "string" }',
    summarize: (a) => `$ ${String(a.command || '').slice(0, 140)}`,
    run: async (args, { signal }) => {
      const cmd = String(args.command || '').trim();
      if (!cmd) throw new Error('run_shell: missing command');
      const cwd = typeof args.cwd === 'string' && args.cwd ? args.cwd : os.homedir();
      return await runShell(cmd, cwd, signal);
    },
  },
  {
    name: 'open_app',
    description: 'Launch a native application by name (macOS uses `open -a`, Linux uses xdg-open, Windows uses `start`).',
    args: '{ "name": "string" }',
    summarize: (a) => `Open app: ${a.name}`,
    run: async (args) => {
      const name = String(args.name || '').trim();
      if (!name) throw new Error('open_app: missing name');
      await openApplicationByName(name);
      return `Launched "${name}".`;
    },
  },
  {
    name: 'open_url',
    description: 'Open a URL in the user\'s default web browser.',
    args: '{ "url": "string" }',
    summarize: (a) => `Open URL: ${a.url}`,
    run: async (args) => {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) {
        throw new Error('open_url: url must start with http(s):// or file://');
      }
      await shell.openExternal(url);
      return `Opened ${url}`;
    },
  },
  {
    name: 'read_file',
    description: 'Read up to ~200KB of a text file and return its contents. Tilde (~) is expanded to the user\'s home dir.',
    args: '{ "path": "string" }',
    summarize: (a) => `Read: ${a.path}`,
    run: async (args) => {
      const resolved = expandHome(String(args.path || ''));
      if (!resolved) throw new Error('read_file: missing path');
      const stat = await fs.promises.stat(resolved);
      if (!stat.isFile()) throw new Error(`read_file: not a regular file: ${resolved}`);
      const buf = await fs.promises.readFile(resolved);
      const trimmed = buf.subarray(0, MAX_FILE_READ_BYTES).toString('utf8');
      return buf.length > MAX_FILE_READ_BYTES
        ? `${trimmed}\n\n[truncated: file is ${buf.length} bytes, showing first ${MAX_FILE_READ_BYTES}]`
        : trimmed;
    },
  },
  {
    name: 'list_dir',
    description: 'List the entries of a directory. Tilde (~) is expanded. Returns up to 200 entries.',
    args: '{ "path": "string" }',
    summarize: (a) => `List: ${a.path}`,
    run: async (args) => {
      const resolved = expandHome(String(args.path || ''));
      if (!resolved) throw new Error('list_dir: missing path');
      const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
      const formatted = entries
        .slice(0, 200)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join('\n');
      return entries.length > 200
        ? `${formatted}\n\n[truncated: ${entries.length} entries total, showing first 200]`
        : formatted;
    },
  },
  {
    name: 'get_clipboard',
    description: 'Read the current text contents of the user\'s clipboard.',
    args: '{}',
    summarize: () => 'Read clipboard',
    run: async () => {
      const text = clipboard.readText();
      return text || '[clipboard is empty]';
    },
  },
  {
    name: 'set_clipboard',
    description: 'Write text to the user\'s clipboard.',
    args: '{ "text": "string" }',
    summarize: (a) => `Copy to clipboard (${String(a.text || '').length} chars)`,
    run: async (args) => {
      const text = String(args.text ?? '');
      clipboard.writeText(text);
      return `Copied ${text.length} chars to clipboard.`;
    },
  },
  {
    name: 'final_answer',
    description: 'End the task and return a short human-readable message describing the outcome.',
    args: '{ "message": "string" }',
    summarize: (a) => String(a.message || '').slice(0, 140),
    run: async (args) => String(args.message || ''),
  },
];

const TOOL_MAP: Record<string, ToolSpec> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// ─── Prompt construction ──────────────────────────────────────────────

function buildSystemPrompt(): string {
  const toolDocs = TOOLS.map(
    (t) => `- **${t.name}** ${t.args}\n  ${t.description}`
  ).join('\n');

  return `You are SuperCmd's local action agent. You help the user accomplish tasks on their own computer by calling tools.

You run as a ReAct loop: each turn you emit a single JSON object with a brief \`thought\` and one \`action\` (a tool call). The system executes the tool and returns its result as the next user message. Continue until the task is done, then call the \`final_answer\` tool.

# Output format
Reply with **only** a single JSON object, no prose before or after, no markdown fences:
{
  "thought": "one short sentence of reasoning",
  "action": { "tool": "<tool_name>", "args": { ... } }
}

If the task is complete, use:
{ "thought": "done", "action": { "tool": "final_answer", "args": { "message": "<short summary>" } } }

# Tools
${toolDocs}

# Rules
- Exactly one action per turn.
- Prefer the most direct path. Don't run unnecessary probing commands.
- When running shell commands, keep them non-interactive and self-contained.
- For "open <app>" style requests, prefer open_app over shell.
- For "go to <website>" / "search for X" requests, prefer open_url.
- Keep thoughts to one short sentence — the user sees them in a small widget.
- Stop after at most ${MAX_STEPS} tool calls; always finish with final_answer.
- If a request is unsafe, overly destructive, or impossible, explain it in final_answer instead of refusing outright.

# Context
- OS: ${process.platform}
- Home: ${os.homedir()}
- Date: ${new Date().toISOString().slice(0, 10)}`;
}

function buildToolDigest(): string {
  return TOOLS.map((t) => `${t.name} — ${t.description.split('.')[0]}`).join('\n');
}

// ─── JSON extraction ──────────────────────────────────────────────────

function extractJsonObject(text: string): ModelAction | null {
  if (!text) return null;
  const candidates = collectJsonCandidates(text);
  for (const cand of candidates) {
    try {
      const parsed = JSON.parse(cand);
      if (parsed && typeof parsed === 'object' && parsed.action && typeof parsed.action.tool === 'string') {
        const args = parsed.action.args && typeof parsed.action.args === 'object' ? parsed.action.args : {};
        return {
          thought: typeof parsed.thought === 'string' ? parsed.thought : undefined,
          action: { tool: parsed.action.tool, args },
        };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function collectJsonCandidates(text: string): string[] {
  const out: string[] = [];
  // Strip markdown code fences if present
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(text)) !== null) {
    out.push(match[1].trim());
  }
  // Full text fallback
  out.push(text.trim());
  // Balanced-brace extraction from the first '{'
  const firstBrace = text.indexOf('{');
  if (firstBrace >= 0) {
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = firstBrace; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          out.push(text.slice(firstBrace, i + 1));
          break;
        }
      }
    }
  }
  return out;
}

function truncateForModel(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…[truncated ${text.length - MAX_TOOL_OUTPUT_CHARS} chars]`;
}

// ─── Platform helpers ─────────────────────────────────────────────────

function expandHome(p: string): string {
  if (!p) return '';
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function runShell(command: string, cwd: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = exec(
      command,
      {
        cwd,
        timeout: SHELL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 4,
        env: process.env,
        shell: process.platform === 'win32' ? undefined : '/bin/sh',
      },
      (err, stdout, stderr) => {
        const combined = [stdout, stderr].filter(Boolean).join('').trimEnd();
        if (err) {
          const msg = (err as any).killed
            ? `[shell timed out after ${SHELL_TIMEOUT_MS}ms]`
            : (err.message || 'shell error');
          resolve(combined ? `${combined}\n[exit: ${msg}]` : `[exit: ${msg}]`);
          return;
        }
        resolve(combined || '[no output]');
      }
    );
    const abortHandler = () => {
      try { proc.kill('SIGTERM'); } catch {}
      reject(new Error('aborted'));
    };
    if (signal.aborted) abortHandler();
    else signal.addEventListener('abort', abortHandler, { once: true });
  });
}

async function openApplicationByName(name: string): Promise<void> {
  if (process.platform === 'darwin') {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('open', ['-a', name], { detached: true, stdio: 'ignore' });
      proc.on('error', reject);
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`open -a exited ${code}`))));
    });
    return;
  }
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('cmd', ['/c', 'start', '', name], { detached: true, stdio: 'ignore' });
      proc.on('error', reject);
      proc.on('close', () => resolve());
    });
    return;
  }
  // linux / other: try xdg-open with the app name as a desktop id or binary
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('xdg-open', [name], { detached: true, stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', () => resolve());
  });
}

// ─── Main loop ────────────────────────────────────────────────────────

export async function runAgent(options: RunAgentOptions): Promise<void> {
  const { requestId, query, settings, signal, emit } = options;

  emit({ requestId, type: 'started', query });

  const history: ChatMessage[] = [{ role: 'user', content: `Task: ${query}` }];
  const systemPrompt = buildSystemPrompt();

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (signal.aborted) return;
    emit({ requestId, type: 'step', step });

    // Ask the model for the next action.
    let rawResponse = '';
    try {
      const gen = streamAIChat(settings.ai, {
        messages: history,
        systemPrompt,
        creativity: 0.2,
        signal,
      });
      for await (const chunk of gen) {
        if (signal.aborted) return;
        rawResponse += chunk;
        emit({ requestId, type: 'thinking', delta: chunk });
      }
    } catch (err: any) {
      if (signal.aborted) return;
      emit({ requestId, type: 'error', error: err?.message || 'Model request failed' });
      return;
    }

    const parsed = extractJsonObject(rawResponse);
    if (!parsed) {
      // Treat un-parseable model output as a final plain-text answer.
      const trimmed = rawResponse.trim();
      emit({ requestId, type: 'message', text: trimmed || 'Agent ended without a structured answer.' });
      emit({ requestId, type: 'done' });
      return;
    }

    const { action } = parsed;
    const toolSpec = TOOL_MAP[action.tool];

    if (!toolSpec) {
      // Unknown tool — tell the model and continue.
      const errMsg = `Unknown tool "${action.tool}". Available: ${TOOLS.map((t) => t.name).join(', ')}.`;
      history.push({ role: 'assistant', content: rawResponse });
      history.push({ role: 'user', content: `Tool error: ${errMsg}` });
      emit({
        requestId,
        type: 'tool_call',
        id: `${requestId}-s${step}`,
        tool: action.tool,
        args: action.args,
        summary: `Unknown tool: ${action.tool}`,
      });
      emit({ requestId, type: 'tool_result', id: `${requestId}-s${step}`, ok: false, output: errMsg });
      continue;
    }

    const callId = `${requestId}-s${step}`;
    emit({
      requestId,
      type: 'tool_call',
      id: callId,
      tool: toolSpec.name,
      args: action.args,
      summary: safeSummary(toolSpec, action.args),
    });

    if (toolSpec.name === 'final_answer') {
      const message = String(action.args.message || parsed.thought || '').trim();
      emit({ requestId, type: 'tool_result', id: callId, ok: true, output: message });
      emit({ requestId, type: 'message', text: message || 'Done.' });
      emit({ requestId, type: 'done' });
      return;
    }

    let toolOutput = '';
    let toolOk = true;
    try {
      toolOutput = await toolSpec.run(action.args, { signal });
    } catch (err: any) {
      toolOk = false;
      toolOutput = err?.message ? `Error: ${err.message}` : 'Tool error';
    }

    emit({
      requestId,
      type: 'tool_result',
      id: callId,
      ok: toolOk,
      output: toolOutput,
    });

    if (signal.aborted) return;

    // Feed the model the structured assistant turn and the tool result.
    history.push({ role: 'assistant', content: rawResponse });
    history.push({
      role: 'user',
      content: `Tool result for ${toolSpec.name} (${toolOk ? 'ok' : 'error'}):\n${truncateForModel(toolOutput)}\n\nRemember: reply with a single JSON action. If the task is complete, call final_answer.`,
    });
  }

  emit({
    requestId,
    type: 'message',
    text: `Reached step limit (${MAX_STEPS}). Task may be incomplete.`,
  });
  emit({ requestId, type: 'done' });
}

function safeSummary(spec: ToolSpec, args: Record<string, any>): string {
  try {
    return spec.summarize(args || {});
  } catch {
    return spec.name;
  }
}

// Expose the tool digest (used in UI placeholder, etc.).
export function getAgentToolDigest(): string {
  return buildToolDigest();
}
