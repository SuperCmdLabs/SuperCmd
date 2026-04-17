/**
 * SoulverCore calculator bridge.
 *
 * Spawns `dist/native/soulver-calculator/soulver-calculator` as a long-lived
 * child process and talks to it over NDJSON on stdin/stdout. Multiple requests
 * can be in flight concurrently — each is tagged with an incrementing id and
 * resolved when the helper echoes the same id back.
 *
 * The child is spawned lazily on first call. If it dies we restart on the next
 * call; any outstanding requests from the dead process are rejected.
 */
import * as path from 'path';
import * as fs from 'fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { app } from 'electron';

export interface SoulverResponse {
  id: number;
  value: string | null;
  raw: number | null;
  type: string;
  error: string | null;
}

type Pending = {
  resolve: (response: SoulverResponse) => void;
  reject: (err: Error) => void;
};

let child: ChildProcessWithoutNullStreams | null = null;
let stdoutBuffer = '';
let nextId = 1;
const pending = new Map<number, Pending>();

function binaryPath(): string {
  const base = path.join(__dirname, '..', 'native', 'soulver-calculator', 'soulver-calculator');
  if (!app.isPackaged) return base;
  // In packaged apps dist/native/** lives in app.asar.unpacked (see asarUnpack).
  const unpacked = base.replace('app.asar', 'app.asar.unpacked');
  return fs.existsSync(unpacked) ? unpacked : base;
}

function rejectAllPending(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: SoulverResponse;
  try {
    parsed = JSON.parse(trimmed) as SoulverResponse;
  } catch {
    console.warn('[soulver] non-JSON on stdout:', trimmed);
    return;
  }
  const p = pending.get(parsed.id);
  if (!p) return;
  pending.delete(parsed.id);
  p.resolve(parsed);
}

function ensureChild(): ChildProcessWithoutNullStreams {
  if (child) return child;

  const bin = binaryPath();
  if (!fs.existsSync(bin)) {
    throw new Error(
      `soulver-calculator binary not found at ${bin}. Rebuild with: node scripts/build-soulver-calculator.mjs`,
    );
  }

  const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  child = proc;
  stdoutBuffer = '';

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    let newline = stdoutBuffer.indexOf('\n');
    while (newline !== -1) {
      handleLine(stdoutBuffer.slice(0, newline));
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      newline = stdoutBuffer.indexOf('\n');
    }
  });

  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk: string) => {
    console.warn('[soulver stderr]', chunk.trim());
  });

  const onExit = (err: Error) => {
    if (child === proc) child = null;
    stdoutBuffer = '';
    rejectAllPending(err);
  };

  proc.on('error', (err) => onExit(err));
  proc.on('exit', (code, signal) => {
    onExit(new Error(`soulver-calculator exited (code=${code} signal=${signal})`));
  });

  return proc;
}

export function evaluate(expr: string): Promise<SoulverResponse> {
  const trimmed = expr.trim();
  if (!trimmed) {
    return Promise.resolve({ id: 0, value: null, raw: null, type: 'unknown', error: 'empty' });
  }

  return new Promise<SoulverResponse>((resolve, reject) => {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = ensureChild();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const id = nextId++;
    pending.set(id, { resolve, reject });

    try {
      proc.stdin.write(JSON.stringify({ id, expr: trimmed }) + '\n');
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function shutdown(): void {
  if (!child) return;
  try {
    child.stdin.end();
  } catch {}
  try {
    child.kill();
  } catch {}
  child = null;
  rejectAllPending(new Error('soulver-calculator shut down'));
}
