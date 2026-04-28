/**
 * Agent Runner — autonomous action agent for SuperCmd.
 *
 * Drives a Codex-style tool-calling loop: the LLM is given typed tool
 * schemas and emits structured tool_calls via native function-calling;
 * we execute them, feed results back as `tool` messages, and loop until
 * the model stops calling tools and its final assistant text becomes
 * the answer.
 *
 * Event protocol (one-way main → renderer, channel `agent-event`):
 *   { requestId, type: 'started' }
 *   { requestId, type: 'thinking', delta: string }   // raw assistant text as it streams
 *   { requestId, type: 'step', step: number }
 *   { requestId, type: 'tool_call', id, tool, args, summary }
 *   { requestId, type: 'tool_result', id, ok, output }
 *   { requestId, type: 'message', text }             // model's final assistant text
 *   { requestId, type: 'done' }
 *   { requestId, type: 'error', error: string }
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { shell, clipboard } from 'electron';
import {
  streamAgentChat,
  type AgentImage,
  type AgentMessage,
  type ToolCall,
  type ToolSchema,
} from './agent-tool-calling';
import {
  loadAgentSession,
  saveAgentSession,
  type PersistedAgentSession,
  type PersistedAgentStep,
} from './agent-session-store';
import { mcpPool } from './mcp-client';
import type { AppSettings } from './settings-store';

const MAX_STEPS = 12;
const SHELL_TIMEOUT_MS = 8_000;
const MAX_TOOL_OUTPUT_CHARS = 6_000;
const MAX_FILE_READ_BYTES = 200_000;

export type AgentEvent =
  | { requestId: string; type: 'started'; query: string; workingDir?: string }
  | { requestId: string; type: 'thinking'; delta: string }
  | { requestId: string; type: 'step'; step: number }
  | { requestId: string; type: 'tool_call'; id: string; tool: string; args: Record<string, any>; summary: string }
  | { requestId: string; type: 'tool_result'; id: string; ok: boolean; output: string }
  | { requestId: string; type: 'message'; text: string }
  | { requestId: string; type: 'approval_request'; id: string; tool: string; args: Record<string, any>; summary: string; risk: 'review' }
  | { requestId: string; type: 'approval_resolved'; id: string; approved: boolean }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'error'; error: string };

// ─── Approval policy ──────────────────────────────────────────────────

/** Tools that can modify the system and need user confirmation by default. */
const REVIEW_TOOLS = new Set<string>([
  'run_shell',
  'run_applescript',
  'organize_files',
  'write_file',
  'apply_patch',
]);

function isPathWithinBase(target: string, base: string): boolean {
  if (!target || !base) return false;
  const rel = path.relative(base, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Decide whether a tool call can auto-approve under the configured policy.
 * Returns true if the run should proceed without prompting.
 */
function shouldAutoApprove(
  toolName: string,
  args: Record<string, any>,
  mode: 'prompt' | 'auto-workspace' | 'auto-all',
  workingDir: string | undefined,
): boolean {
  if (!REVIEW_TOOLS.has(toolName)) return true;
  if (mode === 'auto-all') return true;
  if (mode === 'auto-workspace') {
    if (toolName === 'write_file' || toolName === 'apply_patch') {
      if (!workingDir) return false;
      const writePaths = extractWritePaths(toolName, args);
      if (writePaths.length === 0) return false;
      return writePaths.every((p) => {
        const resolved = path.isAbsolute(p) ? p : path.resolve(workingDir, p);
        return isPathWithinBase(resolved, workingDir);
      });
    }
    if (toolName === 'run_shell') {
      const cmd = String(args?.command || '');
      const cwd = typeof args?.cwd === 'string' && args.cwd ? args.cwd : workingDir;
      return isShellCommandSafeForWorkspace(cmd, cwd);
    }
    if (toolName === 'run_applescript') {
      const script = String(args?.script || '');
      return isAppleScriptSafe(script);
    }
    if (toolName === 'organize_files') {
      if (!workingDir) return false;
      const rawPath = typeof args?.path === 'string' && args.path ? args.path : '.';
      const resolved = resolvePath(rawPath, workingDir);
      return resolved === workingDir || isPathWithinBase(resolved, workingDir);
    }
    return false;
  }
  return false;
}

/**
 * Heuristic: is a shell command "safe enough" to run without prompting,
 * given it's confined to the workingDir?
 *
 * We auto-approve commands that read or that write only inside the current
 * folder. We block patterns that are obviously destructive, escalate
 * privileges, or reach across the system.
 */
function isShellCommandSafeForWorkspace(command: string, cwd: string | undefined): boolean {
  if (!cwd) return false;
  const cmd = command.trim();
  if (!cmd) return false;

  // Normalize for inspection
  const lower = cmd.toLowerCase();

  // Hard blockers — always prompt.
  if (/(^|\s|;|&&|\|\|)sudo\b/.test(cmd)) return false;
  if (/(^|\s|;|&&|\|\|)(rm\s+-[rf]+|rmdir|trash)\b.*\s\/(?!Users\/[^/]+\/)/.test(cmd)) return false; // delete outside ~
  if (/(^|\s|;|&&|\|\|)(dd|mkfs|fdisk|diskutil)\b/.test(cmd)) return false;
  if (/(^|\s|;|&&|\|\|)(reboot|shutdown|halt|poweroff)\b/.test(cmd)) return false;
  if (/(^|\s|;|&&|\|\|)(chmod|chown)\s+(?:-R\s+)?(?:[0-7]{3,4}|[ugo+=-]\S*)\s+\/(?!Users\/[^/]+\/)/.test(cmd)) return false;
  if (/\bcurl\b[^|]*\|\s*(sh|bash|zsh|python|node)\b/.test(lower)) return false;
  if (/\bwget\b[^|]*\|\s*(sh|bash|zsh|python|node)\b/.test(lower)) return false;
  if (/\bnpm\s+(install|i|publish|adduser|login)\b/.test(lower)) return false;
  if (/\bpip\s+(install|uninstall)\b/.test(lower)) return false;
  if (/\bgit\s+push\b/.test(lower)) return false;

  // Block redirections that write outside the user's home tree.
  if (/(^|[\s;|&])(>{1,2}|tee)\s+(\/(?!Users\/[^/]+\/)\S+|~root\S*)/.test(cmd)) return false;

  // Disallow absolute paths to non-home locations as command args (best-effort).
  // e.g. `mv /etc/foo bar` is risky; `mv ./foo bar` is fine.
  const absPaths = cmd.match(/(^|\s)(\/[^\s'"`]+)/g) || [];
  for (const m of absPaths) {
    const p = m.trim();
    if (!p.startsWith('/Users/') && !p.startsWith('/tmp/') && !p.startsWith('/var/folders/') && !p.startsWith('/private/tmp/')) {
      return false;
    }
  }

  return true;
}

function isAppleScriptSafe(script: string): boolean {
  const s = script.toLowerCase();
  // Block scripts that send messages, mail, or shell out as root.
  if (/\btell application\s+"messages"\s+to send\b/.test(s)) return false;
  if (/\btell application\s+"mail"\s+to send\b/.test(s)) return false;
  if (/\bdo shell script\b.*\bwith administrator privileges\b/.test(s)) return false;
  // Otherwise allow — Apple's permission prompts gate the actually-sensitive ones (Notes, Calendar, Reminders, etc.) the first time.
  return true;
}

function extractWritePaths(toolName: string, args: Record<string, any>): string[] {
  if (toolName === 'write_file') {
    const raw = String(args?.path || '').trim();
    return raw ? [raw] : [];
  }
  if (toolName === 'apply_patch') {
    const patch = String(args?.patch || '');
    const paths: string[] = [];
    const re = /^\*\*\* (?:Add|Update) File: (.+?)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(patch)) !== null) paths.push(m[1].trim());
    const moveRe = /^\*\*\* Move to: (.+?)$/gm;
    while ((m = moveRe.exec(patch)) !== null) paths.push(m[1].trim());
    return paths;
  }
  return [];
}

// Registry of pending approvals so the IPC handler can resolve them.
type ApprovalResolver = (approved: boolean) => void;
const pendingApprovals = new Map<string, ApprovalResolver>();

export function resolveAgentApproval(callId: string, approved: boolean): void {
  let resolver = pendingApprovals.get(callId);
  let keyToDelete = callId;

  // The renderer receives the provider tool-call id, while we namespace the
  // stored approval by request id so cancellation can reject one run at a time.
  // Resolve by suffix to keep that public IPC shape stable.
  if (!resolver) {
    for (const [key, candidate] of pendingApprovals.entries()) {
      if (key.endsWith(`:${callId}`)) {
        resolver = candidate;
        keyToDelete = key;
        break;
      }
    }
  }

  if (resolver) {
    pendingApprovals.delete(keyToDelete);
    resolver(approved);
  }
}

export function rejectAllPendingApprovalsForRequest(requestId: string): void {
  for (const [callId, resolver] of pendingApprovals.entries()) {
    if (callId.startsWith(`${requestId}:`)) {
      pendingApprovals.delete(callId);
      resolver(false);
    }
  }
}

interface RunAgentOptions {
  requestId: string;
  query: string;
  settings: AppSettings;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
  /**
   * Folder the user was "in" when they invoked SuperCmd (Finder target,
   * terminal cwd, etc.). When set, tools like run_shell / list_dir /
   * read_file treat relative paths as resolved against this folder instead
   * of the user's home.
   */
  workingDir?: string;
  /**
   * If set, load the named session from disk and continue its conversation —
   * the new `query` becomes the next user turn in that thread. The persisted
   * session's id is reused so all turns live under one record.
   */
  resumeFromSessionId?: string;
  /** Optional visual context captured at invocation time. Used by voice agent only. */
  screenContext?: AgentImage;
  /** Capture failure reason for voice agent screen context. */
  screenContextError?: string;
}

// ─── Tool registry ────────────────────────────────────────────────────

interface ToolContext {
  signal: AbortSignal;
  /** User-context folder; falls back to home when unset. */
  workingDir?: string;
}

interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's argument object. */
  parameters: ToolSchema['parameters'];
  /** Short label shown in the widget's step list. */
  summarize: (args: Record<string, any>) => string;
  run: (args: Record<string, any>, ctx: ToolContext) => Promise<string>;
}

function resolvePath(input: string, workingDir?: string): string {
  if (!input) return '';
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  if (path.isAbsolute(input)) return input;
  const base = workingDir || os.homedir();
  return path.resolve(base, input);
}

const TOOLS: ToolSpec[] = [
  {
    name: 'run_shell',
    description:
      'Run a shell command on the user\'s machine. Returns combined stdout+stderr (truncated). Use non-interactive commands only. Avoid destructive operations unless the user asked for them.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute.' },
        cwd: { type: 'string', description: 'Optional working directory (absolute, ~/, or relative to the current folder).' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    summarize: (a) => `$ ${String(a.command || '').slice(0, 140)}`,
    run: async (args, { signal, workingDir }) => {
      const cmd = String(args.command || '').trim();
      if (!cmd) throw new Error('run_shell: missing command');
      const cwdArg = typeof args.cwd === 'string' && args.cwd ? args.cwd : '';
      const cwd = cwdArg ? resolvePath(cwdArg, workingDir) : (workingDir || os.homedir());
      return await runShell(cmd, cwd, signal);
    },
  },
  {
    name: 'run_applescript',
    description:
      'Run AppleScript (or JavaScript for Automation) on macOS to automate native apps — e.g. create notes in Apple Notes, add reminders, send iMessages, query Calendar, control Safari, Finder, Music, System Events (keystrokes/clicks). Script is passed via stdin so no quote escaping is needed. Returns the script\'s stdout, trimmed.',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'AppleScript or JXA source.' },
        language: { type: 'string', enum: ['applescript', 'js'], description: 'applescript (default) or js for JavaScript for Automation.' },
      },
      required: ['script'],
      additionalProperties: false,
    },
    summarize: (a) => {
      const first = String(a.script || '').split('\n').find((l) => l.trim()) || '';
      const lang = a.language === 'js' ? 'JXA' : 'AppleScript';
      return `${lang}: ${first.trim().slice(0, 120)}`;
    },
    run: async (args, { signal }) => {
      if (process.platform !== 'darwin') {
        throw new Error('run_applescript: only available on macOS');
      }
      const script = String(args.script || '').trim();
      if (!script) throw new Error('run_applescript: missing script');
      const language = args.language === 'js' ? 'JavaScript' : 'AppleScript';
      return await runAppleScriptInternal(script, language, signal);
    },
  },
  {
    name: 'open_app',
    description: 'Launch a native application by name (macOS uses `open -a`, Linux uses xdg-open, Windows uses `start`).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Application name (e.g., "Safari", "Finder").' },
      },
      required: ['name'],
      additionalProperties: false,
    },
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
    description: 'Open a URL in the user\'s default web browser. Does NOT return page contents. To read a web page inside the agent use fetch_url; to find pages matching a query use web_search.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s):// or file:// URL.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
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
    name: 'web_search',
    description:
      'Search the web via DuckDuckGo and return a short list of result titles, URLs, and snippets. Use this when the user asks you to look something up online, find an article, get current info, etc. No API key required.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        limit: { type: 'number', description: 'Max results (1–10, default 5).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    summarize: (a) => `Search: ${String(a.query || '').slice(0, 120)}`,
    run: async (args, { signal }) => {
      const query = String(args.query || '').trim();
      if (!query) throw new Error('web_search: missing query');
      const limit = Math.max(1, Math.min(10, Number(args.limit) || 5));
      return await webSearch(query, limit, signal);
    },
  },
  {
    name: 'fetch_url',
    description:
      'GET a URL and return its text content (HTML is stripped of tags, scripts, and styles). Use this to actually read a web page — e.g. after web_search gives you promising URLs. Follows redirects, 10s timeout, caps response at ~150KB.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s):// URL to fetch.' },
        max_bytes: { type: 'number', description: 'Optional cap in bytes (1024–500000, default 150000).' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    summarize: (a) => `Fetch: ${String(a.url || '').slice(0, 140)}`,
    run: async (args, { signal }) => {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('fetch_url: url must start with http(s)://');
      }
      const maxBytes = Math.max(1024, Math.min(500_000, Number(args.max_bytes) || 150_000));
      return await fetchUrl(url, maxBytes, signal);
    },
  },
  {
    name: 'read_file',
    description: 'Read up to ~200KB of a text file and return its contents. Tilde (~) is expanded; relative paths resolve against the current working folder.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (absolute, ~/, or relative to the current folder).' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    summarize: (a) => `Read: ${a.path}`,
    run: async (args, { workingDir }) => {
      const resolved = resolvePath(String(args.path || ''), workingDir);
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
    description: 'List the entries of a directory. Tilde (~) is expanded; relative paths (including "." and "") resolve against the current working folder. Returns up to 200 entries.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path; omit or use "." for the current working folder.' },
      },
      additionalProperties: false,
    },
    summarize: (a) => `List: ${a.path || '.'}`,
    run: async (args, { workingDir }) => {
      const raw = String(args.path || '.');
      const resolved = resolvePath(raw, workingDir);
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
    name: 'organize_files',
    description:
      'Organize top-level files in a folder into category subfolders by file type. Creates folders as needed and moves all matching files, including videos such as .mp4 into Videos. Use this for requests like "organize the files here by category". Existing folders are left in place; only files directly inside the target folder are moved.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder to organize; omit or use "." for the current working folder.' },
        include_hidden: { type: 'boolean', description: 'Whether to organize hidden dotfiles. Defaults to false.' },
      },
      additionalProperties: false,
    },
    summarize: (a) => `Organize files: ${a.path || '.'}`,
    run: async (args, { workingDir }) => {
      const target = resolvePath(String(args.path || '.'), workingDir);
      if (!target) throw new Error('organize_files: missing path');
      const includeHidden = Boolean(args.include_hidden);
      return await organizeFilesByCategory(target, includeHidden);
    },
  },
  {
    name: 'get_clipboard',
    description: 'Read the current text contents of the user\'s clipboard.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    summarize: () => 'Read clipboard',
    run: async () => {
      const text = clipboard.readText();
      return text || '[clipboard is empty]';
    },
  },
  {
    name: 'set_clipboard',
    description: 'Write text to the user\'s clipboard.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to copy.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    summarize: (a) => `Copy to clipboard (${String(a.text || '').length} chars)`,
    run: async (args) => {
      const text = String(args.text ?? '');
      clipboard.writeText(text);
      return `Copied ${text.length} chars to clipboard.`;
    },
  },
  {
    name: 'write_file',
    description:
      'Create a file or overwrite its entire contents. Use for creating new files or rewriting small files. For surgical edits to an existing file, prefer apply_patch. Creates parent directories if missing. Atomic (writes to tmp then renames).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (absolute, ~/, or relative to the current folder).' },
        content: { type: 'string', description: 'Full text content to write.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    summarize: (a) => `Write: ${a.path}`,
    run: async (args, { workingDir }) => {
      const resolved = resolvePath(String(args.path || ''), workingDir);
      if (!resolved) throw new Error('write_file: missing path');
      const content = typeof args.content === 'string' ? args.content : '';
      await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
      const tmp = `${resolved}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await fs.promises.writeFile(tmp, content, 'utf8');
      await fs.promises.rename(tmp, resolved);
      return `Wrote ${content.length} chars to ${resolved}`;
    },
  },
  {
    name: 'apply_patch',
    description:
      `Apply a Codex-format patch. Use for surgical edits to one or more existing files (add, delete, or modify). Envelope is *** Begin Patch … *** End Patch. Supported operations:
- *** Add File: <path>     — new file; every following line must start with "+"
- *** Delete File: <path>  — remove an existing file
- *** Update File: <path>  — patch an existing file in place; may be followed by "*** Move to: <new>" to rename. Then one or more hunks introduced by "@@". Each hunk line starts with " " (context), "+" (new line), or "-" (removed line). Context must match the file exactly — include a few lines around the change. Multi-hunk updates apply sequentially.
Paths are resolved against the current working folder. Example:
*** Begin Patch
*** Update File: src/app.py
@@ def greet():
-    print("Hi")
+    print("Hello!")
*** End Patch`,
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'Patch text including the *** Begin Patch / *** End Patch envelope.' },
      },
      required: ['patch'],
      additionalProperties: false,
    },
    summarize: (a) => {
      const text = String(a.patch || '');
      const files = [...text.matchAll(/^\*\*\* (Add|Delete|Update) File: (.+)$/gm)].map(
        (m) => `${m[1][0]} ${m[2].trim()}`
      );
      return files.length
        ? `Patch: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` +${files.length - 3}` : ''}`
        : 'Apply patch';
    },
    run: async (args, { workingDir }) => {
      const patch = String(args.patch || '');
      if (!patch.trim()) throw new Error('apply_patch: missing patch');
      return await applyCodexPatch(patch, workingDir);
    },
  },
];

const TOOL_MAP: Record<string, ToolSpec> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const TOOL_SCHEMAS: ToolSchema[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters,
}));

// ─── Prompt construction ──────────────────────────────────────────────

function buildSystemPrompt(workingDir?: string): string {
  const cwdNote = workingDir
    ? `- Working folder (where the user opened SuperCmd): ${workingDir}
  Shell commands run here by default; relative paths in read_file/list_dir resolve against it. When the user says "here", "this folder", "these files" — they mean this folder.`
    : `- Working folder: ${os.homedir()} (home; no specific folder context detected)`;

  return `You are SuperCmd's local action agent. You help the user accomplish tasks on their own computer by calling tools via native function-calling.

# Guidelines
- Call tools to take action; do not ask the user clarifying questions unless the task is genuinely ambiguous.
- Prefer the most direct path. Don't run unnecessary probing commands.
- For "open <app>" requests, prefer open_app over run_shell.
- For file organization requests like "organize files here by category", prefer organize_files over ad-hoc mkdir/mv shell commands. It moves every matching top-level file and includes .mp4/.mov/.mkv/.webm files in Videos.
- For "go to <website>" / "search for X" requests online: use web_search to find URLs, fetch_url to read them, open_url only when you want the user's browser to physically open the page.
- For native macOS apps (Notes, Reminders, Calendar, Mail, Messages, Safari, Finder, Music, System Events / keystrokes / clicks), prefer run_applescript — it passes the script via stdin so multi-line AppleScript works without quote escaping. Example to create a Note:
  tell application "Notes"
      tell account "iCloud"
          make new note at folder "Notes" with properties {name:"Title", body:"<h1>Title</h1><br>Body text"}
      end tell
  end tell
  Notes bodies are HTML — use <br> for newlines.
- Shell commands must be non-interactive and self-contained.
- Keep final answers compact. Default to 1-3 short sentences unless the user explicitly asks for detail.
- Stop after at most ${MAX_STEPS} tool calls. When you are finished, reply with the final answer the user sees. The UI renders Markdown — use it sparingly:
  - Wrap any value the user is likely to copy (IDs, invoice/order numbers, amounts, file paths, URLs, hashes, codes, command snippets) in backticks so it renders as a one-click copy chip — e.g. \`RD17676742753723162\`, \`₹152.00\`, \`~/Documents/invoices\`.
  - Use fenced \`\`\`code blocks\`\`\` for multi-line snippets (commands, scripts, structured output).
  - Use **bold** for the headline number/result, and ordered/unordered lists for breakdowns.
  - Do not output raw \`##\` headings or \`**\` markers as literal text — only use markdown syntax when you actually want it rendered.
- If a request is unsafe, overly destructive, or impossible, explain in plain text instead of refusing silently.

# Context
- OS: ${process.platform}
- Home: ${os.homedir()}
${cwdNote}
- Date: ${new Date().toISOString().slice(0, 10)}`;
}

function buildToolDigest(): string {
  return TOOLS.map((t) => `${t.name} — ${t.description.split('.')[0]}`).join('\n');
}

function truncateForModel(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…[truncated ${text.length - MAX_TOOL_OUTPUT_CHARS} chars]`;
}

// ─── File organization ────────────────────────────────────────────────

const EXTENSION_CATEGORIES: Record<string, string> = {
  '.3g2': 'Videos',
  '.3gp': 'Videos',
  '.avi': 'Videos',
  '.flv': 'Videos',
  '.m2ts': 'Videos',
  '.m4v': 'Videos',
  '.mkv': 'Videos',
  '.mov': 'Videos',
  '.mp4': 'Videos',
  '.mpeg': 'Videos',
  '.mpg': 'Videos',
  '.webm': 'Videos',
  '.wmv': 'Videos',

  '.apng': 'Images',
  '.avif': 'Images',
  '.bmp': 'Images',
  '.gif': 'Images',
  '.heic': 'Images',
  '.heif': 'Images',
  '.ico': 'Images',
  '.jpeg': 'Images',
  '.jpg': 'Images',
  '.png': 'Images',
  '.psd': 'Images',
  '.raw': 'Images',
  '.svg': 'Images',
  '.tif': 'Images',
  '.tiff': 'Images',
  '.webp': 'Images',

  '.aiff': 'Audio',
  '.flac': 'Audio',
  '.m4a': 'Audio',
  '.mp3': 'Audio',
  '.ogg': 'Audio',
  '.wav': 'Audio',
  '.wma': 'Audio',

  '.csv': 'Documents',
  '.doc': 'Documents',
  '.docx': 'Documents',
  '.epub': 'Documents',
  '.key': 'Documents',
  '.md': 'Documents',
  '.numbers': 'Documents',
  '.pages': 'Documents',
  '.pdf': 'Documents',
  '.ppt': 'Documents',
  '.pptx': 'Documents',
  '.rtf': 'Documents',
  '.txt': 'Documents',
  '.xls': 'Documents',
  '.xlsx': 'Documents',

  '.7z': 'Archives',
  '.bz2': 'Archives',
  '.gz': 'Archives',
  '.rar': 'Archives',
  '.tar': 'Archives',
  '.tgz': 'Archives',
  '.xz': 'Archives',
  '.zip': 'Archives',

  '.app': 'Applications',
  '.dmg': 'Applications',
  '.pkg': 'Applications',

  '.c': 'Code',
  '.cpp': 'Code',
  '.css': 'Code',
  '.go': 'Code',
  '.html': 'Code',
  '.java': 'Code',
  '.js': 'Code',
  '.jsx': 'Code',
  '.py': 'Code',
  '.rb': 'Code',
  '.rs': 'Code',
  '.sh': 'Code',
  '.swift': 'Code',
  '.ts': 'Code',
  '.tsx': 'Code',

  '.conf': 'Configurations',
  '.env': 'Configurations',
  '.ini': 'Configurations',
  '.json': 'Configurations',
  '.plist': 'Configurations',
  '.toml': 'Configurations',
  '.yaml': 'Configurations',
  '.yml': 'Configurations',
};

async function organizeFilesByCategory(targetDir: string, includeHidden: boolean): Promise<string> {
  const stat = await fs.promises.stat(targetDir);
  if (!stat.isDirectory()) throw new Error(`organize_files: not a directory: ${targetDir}`);

  const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
  const moved: string[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!includeHidden && entry.name.startsWith('.')) {
      skipped.push(`${entry.name} (hidden)`);
      continue;
    }

    const category = categoryForFile(entry.name);
    if (!category) {
      skipped.push(`${entry.name} (unknown type)`);
      continue;
    }

    const source = path.join(targetDir, entry.name);
    const categoryDir = path.join(targetDir, category);
    const destination = await uniqueDestinationPath(categoryDir, entry.name);
    await fs.promises.mkdir(categoryDir, { recursive: true });
    await fs.promises.rename(source, destination);
    moved.push(`${entry.name} -> ${category}/${path.basename(destination)}`);
  }

  if (moved.length === 0) {
    const reason = skipped.length ? ` Skipped: ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? `, +${skipped.length - 20} more` : ''}` : '';
    return `No files moved.${reason}`;
  }

  const skippedSummary = skipped.length
    ? `\nSkipped ${skipped.length}: ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? `, +${skipped.length - 20} more` : ''}`
    : '';
  return `Moved ${moved.length} file${moved.length === 1 ? '' : 's'}:\n${moved.join('\n')}${skippedSummary}`;
}

function categoryForFile(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'Archives';
  if (lower.endsWith('.tar.bz2')) return 'Archives';
  if (lower.endsWith('.tar.xz')) return 'Archives';
  return EXTENSION_CATEGORIES[path.extname(lower)] || null;
}

async function uniqueDestinationPath(dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  let candidate = path.join(dir, fileName);
  let counter = 1;
  while (await pathExists(candidate)) {
    candidate = path.join(dir, `${base} ${counter}${ext}`);
    counter++;
  }
  return candidate;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.lstat(target);
    return true;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

// ─── Platform helpers ─────────────────────────────────────────────────

function runShell(command: string, cwd: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const log = (msg: string) => console.error(`[agent runShell +${Date.now() - t0}ms] ${msg}`);
    log(`spawn: cwd=${cwd} cmd=${command}`);
    // Codex hard-won lesson (codex-rs/core/src/spawn.rs:109): you MUST close
    // stdin on shell-tool children. Many tools (ripgrep, less, npm scripts,
    // anything that probes whether stdin is a TTY) will block forever waiting
    // for input if the parent's stdin is forwarded or piped-but-empty. Node's
    // exec() leaves stdin open by default and its `timeout` option silently
    // fails to fire in that state — which is the hang the agent kept tripping.
    // Switching to spawn() with stdio: ['ignore', 'pipe', 'pipe'] is the fix.
    let settled = false;
    let stdoutBuf = '';
    let stderrBuf = '';
    let killTimer: NodeJS.Timeout | null = null;

    const finish = (val: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    let proc: import('child_process').ChildProcess;
    try {
      proc = spawn(
        process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command],
        {
          cwd,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          // Run in its own process group so kill() can take down the whole tree.
          detached: process.platform !== 'win32',
        },
      );
      log(`spawn returned, pid=${proc.pid}`);
    } catch (err: any) {
      log(`spawn threw: ${err?.message}`);
      fail(new Error(`spawn failed: ${err?.message || String(err)}`));
      return;
    }

    proc.stdout?.on('data', (d: Buffer) => {
      stdoutBuf += d.toString('utf8');
      if (stdoutBuf.length > 4 * 1024 * 1024) {
        stdoutBuf = stdoutBuf.slice(0, 4 * 1024 * 1024);
        try { proc.kill('SIGTERM'); } catch {}
      }
    });
    proc.stderr?.on('data', (d: Buffer) => {
      stderrBuf += d.toString('utf8');
      if (stderrBuf.length > 4 * 1024 * 1024) {
        stderrBuf = stderrBuf.slice(0, 4 * 1024 * 1024);
        try { proc.kill('SIGTERM'); } catch {}
      }
    });
    proc.on('error', (err) => {
      log(`error event: ${err.message}`);
      fail(new Error(`shell error: ${err.message}`));
    });
    proc.on('exit', (code, sig) => log(`exit event: code=${code} sig=${sig}`));
    proc.on('close', (code, sig) => {
      log(`close event: code=${code} sig=${sig} stdoutLen=${stdoutBuf.length} stderrLen=${stderrBuf.length}`);
      const combined = [stdoutBuf, stderrBuf].filter(Boolean).join('').trimEnd();
      if (sig) {
        finish(combined ? `${combined}\n[exit: signal ${sig}]` : `[exit: signal ${sig}]`);
        return;
      }
      if (code !== 0) {
        finish(combined ? `${combined}\n[exit: code ${code}]` : `[exit: code ${code}]`);
        return;
      }
      finish(combined || '[no output]');
    });

    const watchdog = setTimeout(() => {
      log(`WATCHDOG firing — killing pid ${proc.pid}`);
      // Kill the entire process group (negative pid) so child shells of the
      // shell get killed too. Falls back to single-process kill on win32.
      try {
        if (process.platform !== 'win32' && proc.pid) {
          process.kill(-proc.pid, 'SIGTERM');
        } else {
          proc.kill('SIGTERM');
        }
      } catch (e: any) { log(`SIGTERM failed: ${e?.message}`); }
      killTimer = setTimeout(() => {
        try {
          if (process.platform !== 'win32' && proc.pid) {
            process.kill(-proc.pid, 'SIGKILL');
          } else {
            proc.kill('SIGKILL');
          }
        } catch {}
      }, 1000);
      const combined = [stdoutBuf, stderrBuf].filter(Boolean).join('').trimEnd();
      const msg = `[exit: shell timed out after ${SHELL_TIMEOUT_MS}ms — process killed]`;
      finish(combined ? `${combined}\n${msg}` : msg);
    }, SHELL_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(watchdog);
      if (killTimer) clearTimeout(killTimer);
    }

    const abortHandler = () => {
      try {
        if (process.platform !== 'win32' && proc.pid) {
          process.kill(-proc.pid, 'SIGTERM');
        } else {
          proc.kill('SIGTERM');
        }
      } catch {}
      setTimeout(() => {
        try {
          if (process.platform !== 'win32' && proc.pid) {
            process.kill(-proc.pid, 'SIGKILL');
          } else {
            proc.kill('SIGKILL');
          }
        } catch {}
      }, 500);
      fail(new Error('aborted'));
    };
    if (signal.aborted) abortHandler();
    else signal.addEventListener('abort', abortHandler, { once: true });
  });
}

function runAppleScriptInternal(
  script: string,
  language: 'AppleScript' | 'JavaScript',
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/bin/osascript', ['-l', language], { env: process.env });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim() || '[no output]');
      } else {
        const err = stderr.trim() || `osascript exited with code ${code}`;
        reject(new Error(err));
      }
    });
    const abortHandler = () => {
      try { proc.kill('SIGTERM'); } catch {}
      reject(new Error('aborted'));
    };
    if (signal.aborted) abortHandler();
    else signal.addEventListener('abort', abortHandler, { once: true });
    proc.stdin.write(script);
    proc.stdin.end();
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
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('xdg-open', [name], { detached: true, stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', () => resolve());
  });
}

// ─── Codex-format apply_patch ─────────────────────────────────────────

interface Hunk {
  header?: string;
  lines: Array<{ prefix: ' ' | '+' | '-'; text: string }>;
}

type PatchOp =
  | { type: 'add'; path: string; content: string }
  | { type: 'delete'; path: string }
  | { type: 'update'; path: string; moveTo?: string; hunks: Hunk[] };

async function applyCodexPatch(patchText: string, workingDir?: string): Promise<string> {
  const ops = parsePatch(patchText);
  if (ops.length === 0) throw new Error('apply_patch: no operations found');

  const log: string[] = [];
  for (const op of ops) {
    if (op.type === 'add') {
      const p = resolvePath(op.path, workingDir);
      await fs.promises.mkdir(path.dirname(p), { recursive: true });
      try {
        const st = await fs.promises.stat(p);
        if (st.isFile()) throw new Error(`apply_patch: "${op.path}" already exists (Add File expects a new path)`);
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
      }
      await fs.promises.writeFile(p, op.content, 'utf8');
      log.push(`  + ${op.path} (${op.content.length} chars)`);
    } else if (op.type === 'delete') {
      const p = resolvePath(op.path, workingDir);
      await fs.promises.unlink(p);
      log.push(`  - ${op.path}`);
    } else {
      const srcPath = resolvePath(op.path, workingDir);
      let next = await fs.promises.readFile(srcPath, 'utf8');
      for (let i = 0; i < op.hunks.length; i++) {
        const hunk = op.hunks[i];
        const { search, replace } = buildHunkBlocks(hunk);
        if (!search) {
          // Pure-add hunk — append/prepend not well-defined; treat as error.
          throw new Error(`apply_patch: hunk ${i + 1} for ${op.path} has no context or removal lines.`);
        }
        const idx = next.indexOf(search);
        if (idx < 0) {
          throw new Error(
            `apply_patch: hunk ${i + 1} for ${op.path} could not locate context. Expected block:\n${search.slice(0, 400)}${search.length > 400 ? '…' : ''}`
          );
        }
        next = next.slice(0, idx) + replace + next.slice(idx + search.length);
      }
      const destPath = op.moveTo ? resolvePath(op.moveTo, workingDir) : srcPath;
      if (destPath !== srcPath) {
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await fs.promises.writeFile(destPath, next, 'utf8');
        await fs.promises.unlink(srcPath);
        log.push(`  ~ ${op.path} → ${op.moveTo} (${op.hunks.length} hunk${op.hunks.length === 1 ? '' : 's'})`);
      } else {
        await fs.promises.writeFile(srcPath, next, 'utf8');
        log.push(`  ~ ${op.path} (${op.hunks.length} hunk${op.hunks.length === 1 ? '' : 's'})`);
      }
    }
  }
  return `apply_patch ok — ${ops.length} op${ops.length === 1 ? '' : 's'}:\n${log.join('\n')}`;
}

function buildHunkBlocks(hunk: Hunk): { search: string; replace: string } {
  const searchLines: string[] = [];
  const replaceLines: string[] = [];
  for (const ln of hunk.lines) {
    if (ln.prefix === ' ') {
      searchLines.push(ln.text);
      replaceLines.push(ln.text);
    } else if (ln.prefix === '-') {
      searchLines.push(ln.text);
    } else if (ln.prefix === '+') {
      replaceLines.push(ln.text);
    }
  }
  return {
    search: searchLines.join('\n'),
    replace: replaceLines.join('\n'),
  };
}

function parsePatch(text: string): PatchOp[] {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() !== '*** Begin Patch') i++;
  if (i >= lines.length) throw new Error('apply_patch: missing *** Begin Patch header');
  i++;

  const ops: PatchOp[] = [];
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trimEnd();
    if (trimmed === '*** End Patch') return ops;

    if (trimmed.startsWith('*** Add File: ')) {
      const pathStr = trimmed.slice('*** Add File: '.length).trim();
      i++;
      const contentLines: string[] = [];
      while (i < lines.length && !isPatchBoundary(lines[i])) {
        const ln = lines[i];
        if (ln.length === 0) {
          contentLines.push('');
        } else if (ln.startsWith('+')) {
          contentLines.push(ln.slice(1));
        } else {
          // Tolerate leading whitespace lines; anything else breaks the block.
          break;
        }
        i++;
      }
      ops.push({ type: 'add', path: pathStr, content: contentLines.join('\n') });
      continue;
    }

    if (trimmed.startsWith('*** Delete File: ')) {
      const pathStr = trimmed.slice('*** Delete File: '.length).trim();
      ops.push({ type: 'delete', path: pathStr });
      i++;
      continue;
    }

    if (trimmed.startsWith('*** Update File: ')) {
      const pathStr = trimmed.slice('*** Update File: '.length).trim();
      i++;
      let moveTo: string | undefined;
      if (i < lines.length) {
        const t = lines[i].trimEnd();
        if (t.startsWith('*** Move to: ')) {
          moveTo = t.slice('*** Move to: '.length).trim();
          i++;
        }
      }
      const hunks: Hunk[] = [];
      while (i < lines.length && !isPatchBoundary(lines[i])) {
        const t = lines[i].trimEnd();
        if (t.startsWith('@@')) {
          const header = t.slice(2).trim() || undefined;
          i++;
          const hunkLines: Array<{ prefix: ' ' | '+' | '-'; text: string }> = [];
          while (i < lines.length) {
            const ln = lines[i];
            const tt = ln.trimEnd();
            if (tt === '*** End of File') { i++; break; }
            if (tt.startsWith('@@') || isPatchBoundary(ln)) break;
            if (ln.length === 0) {
              hunkLines.push({ prefix: ' ', text: '' });
            } else if (ln[0] === ' ' || ln[0] === '+' || ln[0] === '-') {
              hunkLines.push({ prefix: ln[0] as ' ' | '+' | '-', text: ln.slice(1) });
            } else {
              // Stop at unexpected prefix
              break;
            }
            i++;
          }
          hunks.push({ header, lines: hunkLines });
        } else {
          // Ignore stray lines between hunks
          i++;
        }
      }
      ops.push({ type: 'update', path: pathStr, moveTo, hunks });
      continue;
    }

    // Unknown line inside the envelope; skip
    i++;
  }
  throw new Error('apply_patch: missing *** End Patch footer');
}

function isPatchBoundary(line: string): boolean {
  const t = line.trimEnd();
  return t === '*** End Patch'
    || t.startsWith('*** Add File: ')
    || t.startsWith('*** Delete File: ')
    || t.startsWith('*** Update File: ');
}

// ─── Web helpers ──────────────────────────────────────────────────────

const FETCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function webSearch(query: string, limit: number, signal: AbortSignal): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const timeout = AbortSignal.timeout(10_000);
  const combined = anySignal([signal, timeout]);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': FETCH_UA,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `q=${encodeURIComponent(query)}`,
    signal: combined,
  });
  if (!res.ok) throw new Error(`web_search: DuckDuckGo returned HTTP ${res.status}`);
  const html = await res.text();

  const results: { title: string; url: string; snippet: string }[] = [];
  const resultBlockRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m: RegExpExecArray | null;
  while ((m = resultBlockRe.exec(html)) !== null && results.length < limit) {
    const rawUrl = decodeDdgRedirect(m[1]);
    const title = htmlToText(m[2] || '').trim();
    const snippet = htmlToText(m[3] || '').trim();
    if (!rawUrl || !title) continue;
    results.push({ title, url: rawUrl, snippet });
  }

  if (results.length === 0) {
    return '[web_search: no results parsed — DuckDuckGo may have returned an unexpected layout]';
  }
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
    .join('\n\n');
}

function decodeDdgRedirect(href: string): string {
  try {
    if (href.startsWith('//')) href = `https:${href}`;
    const u = new URL(href);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return href;
  } catch {
    return href;
  }
}

async function fetchUrl(url: string, maxBytes: number, signal: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(10_000);
  const combined = anySignal([signal, timeout]);
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': FETCH_UA, Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1' },
    signal: combined,
  });
  const contentType = res.headers.get('content-type') || '';
  const buf = await res.arrayBuffer();
  const truncated = buf.byteLength > maxBytes;
  const bytes = new Uint8Array(truncated ? buf.slice(0, maxBytes) : buf);

  let body: string;
  if (/^application\/json\b/i.test(contentType)) {
    body = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } else if (/\btext\/html\b/i.test(contentType) || looksLikeHtml(bytes)) {
    body = htmlToText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
  } else if (/^text\//i.test(contentType)) {
    body = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } else {
    body = `[binary content-type: ${contentType || 'unknown'}, ${buf.byteLength} bytes — skipped]`;
  }
  if (truncated) body += `\n\n[truncated at ${maxBytes} bytes; full response was ${buf.byteLength} bytes]`;
  return `[HTTP ${res.status} ${res.statusText}${contentType ? ` · ${contentType}` : ''}]\n${body}`;
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 256)).toLowerCase();
  return head.includes('<html') || head.includes('<!doctype html');
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort((s as any).reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort((s as any).reason), { once: true });
  }
  return controller.signal;
}

// ─── Main loop ────────────────────────────────────────────────────────

export async function runAgent(options: RunAgentOptions): Promise<void> {
  const { requestId, query, settings, signal, emit, workingDir, resumeFromSessionId, screenContext, screenContextError } = options;

  emit({ requestId, type: 'started', query, workingDir });

  // Load prior session if resuming; otherwise start fresh. The on-disk
  // session id IS the requestId for new sessions; when resuming we reuse
  // the original session's id so turns accumulate under one record.
  const priorSession = resumeFromSessionId ? await loadAgentSession(resumeFromSessionId) : null;
  const sessionId = priorSession?.id || requestId;
  const createdAt = priorSession?.createdAt ?? Date.now();
  const history: AgentMessage[] = priorSession ? [...priorSession.messages] : [];
  const stepTimeline: PersistedAgentStep[] = priorSession ? [...priorSession.steps] : [];
  const sessionTitle = priorSession?.query || query;

  history.push({
    role: 'user',
    content: screenContext
      ? `${query}\n\nIMPORTANT: The attached screenshot IS the user's current screen right now. Treat it as your visual context. If the user asks what you see on the screen, describe the screenshot directly in 1-2 short sentences. Do not say you cannot see the screen, do not say you lack visual access, and do not mention limitations unless the screenshot itself is unreadable.`
      : screenContextError
        ? `${query}\n\nI attempted to attach the user's current screen screenshot, but capture failed: ${screenContextError}. If the user asked what is on screen, briefly say the screen capture failed and mention this exact reason.`
        : query,
    images: screenContext ? [screenContext] : undefined,
  });

  const systemPrompt = buildSystemPrompt(workingDir);

  const persist = async (
    lifecycle: PersistedAgentSession['lifecycle'],
    patch: Partial<PersistedAgentSession> = {},
  ): Promise<void> => {
    const session: PersistedAgentSession = {
      id: sessionId,
      createdAt,
      updatedAt: Date.now(),
      query: sessionTitle,
      workingDir: workingDir || null,
      messages: history,
      steps: stepTimeline,
      lifecycle,
      ...patch,
    };
    try {
      await saveAgentSession(session);
    } catch (err) {
      // Non-fatal: persistence failure shouldn't crash the run.
      console.error('[agent] saveAgentSession failed:', err);
    }
  };

  await persist('running');

  // Spin up configured MCP servers and merge their tools in. Reconcile is
  // a no-op when the config hasn't changed, so cheap to run every time.
  try {
    await mcpPool.reconcile(settings.mcpServers || {});
  } catch (err) {
    console.error('[agent] mcp reconcile failed:', err);
  }
  const mcpSchemas = mcpPool.listToolSchemas();
  const allToolSchemas: ToolSchema[] = [
    ...TOOL_SCHEMAS,
    ...mcpSchemas.map((s) => ({ name: s.name, description: s.description, parameters: s.parameters })),
  ];

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (signal.aborted) {
        await persist('cancelled');
        return;
      }
      emit({ requestId, type: 'step', step });

      let assistantText = '';
      const toolCalls: ToolCall[] = [];

      try {
        const stream = streamAgentChat(settings.ai, {
          messages: history,
          tools: allToolSchemas,
          systemPrompt,
          creativity: 0.2,
          signal,
        });
        for await (const evt of stream) {
          if (signal.aborted) {
            await persist('cancelled');
            return;
          }
          if (evt.type === 'text_delta') {
            assistantText += evt.delta;
            emit({ requestId, type: 'thinking', delta: evt.delta });
          } else if (evt.type === 'tool_call') {
            toolCalls.push(evt.call);
          }
          // finish reason not needed — we branch on toolCalls length below.
        }
      } catch (err: any) {
        if (signal.aborted) {
          await persist('cancelled');
          return;
        }
        const msg = err?.message || 'Model request failed';
        emit({ requestId, type: 'error', error: msg });
        await persist('error', { error: msg });
        return;
      }

      // No tool calls → model's text is the final answer.
      if (toolCalls.length === 0) {
        const text = assistantText.trim();
        history.push({ role: 'assistant', content: text });
        emit({ requestId, type: 'message', text: text || 'Done.' });
        emit({ requestId, type: 'done' });
        await persist('done', { finalMessage: text });
        return;
      }

      // Record the assistant turn (text + tool_calls) so subsequent tool
      // results link back correctly.
      history.push({ role: 'assistant', content: assistantText, tool_calls: toolCalls });

      for (const call of toolCalls) {
        if (signal.aborted) {
          await persist('cancelled');
          return;
        }
        const spec = TOOL_MAP[call.name];
        const isMcpTool = !spec && mcpPool.hasTool(call.name);
        const startedAt = Date.now();

        const summary = spec
          ? safeSummary(spec, call.arguments)
          : isMcpTool
            ? `mcp · ${call.name}`
            : `Unknown tool: ${call.name}`;

        emit({
          requestId,
          type: 'tool_call',
          id: call.id,
          tool: call.name,
          args: call.arguments,
          summary,
        });

        if (!spec && !isMcpTool) {
          const available = [...TOOLS.map((t) => t.name), ...mcpSchemas.map((s) => s.name)];
          const errMsg = `Unknown tool "${call.name}". Available: ${available.join(', ')}.`;
          emit({ requestId, type: 'tool_result', id: call.id, ok: false, output: errMsg });
          history.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: errMsg });
          stepTimeline.push({
            id: call.id, tool: call.name, args: call.arguments,
            summary: `Unknown tool: ${call.name}`,
            ok: false, output: errMsg, startedAt, finishedAt: Date.now(),
          });
          continue;
        }

        // Approval gate for destructive tools. MCP tools always prompt
        // (unless auto-all) since we can't inspect their side effects.
        const approvalMode = settings.agentApprovalMode || 'prompt';
        const needsApproval = spec
          ? REVIEW_TOOLS.has(call.name) && !shouldAutoApprove(call.name, call.arguments, approvalMode, workingDir)
          : isMcpTool && approvalMode !== 'auto-all';
        if (needsApproval) {
          const approvalKey = `${requestId}:${call.id}`;
          const approved = await new Promise<boolean>((resolve) => {
            pendingApprovals.set(approvalKey, resolve);
            emit({
              requestId,
              type: 'approval_request',
              id: call.id,
              tool: call.name,
              args: call.arguments,
              summary,
              risk: 'review',
            });
            const abortHandler = () => {
              if (pendingApprovals.delete(approvalKey)) resolve(false);
            };
            if (signal.aborted) abortHandler();
            else signal.addEventListener('abort', abortHandler, { once: true });
          });
          emit({ requestId, type: 'approval_resolved', id: call.id, approved });
          if (!approved) {
            const msg = 'Denied by user.';
            emit({ requestId, type: 'tool_result', id: call.id, ok: false, output: msg });
            history.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: msg });
            stepTimeline.push({
              id: call.id, tool: call.name, args: call.arguments,
              summary,
              ok: false, output: msg, startedAt, finishedAt: Date.now(),
            });
            continue;
          }
        }

        let output = '';
        let ok = true;
        try {
          if (spec) {
            output = await spec.run(call.arguments, { signal, workingDir });
          } else {
            // MCP tool
            output = await mcpPool.callTool(call.name, call.arguments);
          }
        } catch (err: any) {
          ok = false;
          output = err?.message ? `Error: ${err.message}` : 'Tool error';
        }

        emit({ requestId, type: 'tool_result', id: call.id, ok, output });
        history.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: truncateForModel(output),
        });
        stepTimeline.push({
          id: call.id,
          tool: call.name,
          args: call.arguments,
          summary,
          ok,
          output,
          startedAt,
          finishedAt: Date.now(),
        });
      }

      // Checkpoint after each step so a crash doesn't lose the trail.
      await persist('running');
    }

    emit({
      requestId,
      type: 'message',
      text: `Reached step limit (${MAX_STEPS}). Task may be incomplete.`,
    });
    emit({ requestId, type: 'done' });
    await persist('done', { finalMessage: `Reached step limit (${MAX_STEPS}).` });
  } catch (err: any) {
    if (signal.aborted) {
      await persist('cancelled');
      return;
    }
    const msg = err?.message || 'Agent crashed';
    emit({ requestId, type: 'error', error: msg });
    await persist('error', { error: msg });
  }
}

function safeSummary(spec: ToolSpec, args: Record<string, any>): string {
  try {
    return spec.summarize(args || {});
  } catch {
    return spec.name;
  }
}

export function getAgentToolDigest(): string {
  return buildToolDigest();
}
