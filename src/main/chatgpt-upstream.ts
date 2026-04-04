/**
 * ChatGPT Upstream — Responses API bridge
 *
 * Streams completions via ChatGPT's internal Responses API
 * (chatgpt.com/backend-api/codex/responses). Converts standard
 * chat messages to Responses format and parses SSE events.
 *
 * Uses Node.js built-in https — no npm dependencies.
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { loadChatGPTTokens } from './chatgpt-auth';

// ─── Callback-based SSE stream ───────────────────────────────────

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onStatus?: (status: string) => void; // "Searching the web...", "Thinking...", etc.
}

/**
 * Stream SSE from an IncomingMessage, calling onDelta for each text chunk
 * and onStatus for status updates (web search, thinking).
 * DIRECTLY from the 'data' event handler — zero async overhead, zero buffering.
 */
function streamSSEDirect(
  response: http.IncomingMessage,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let sseBuffer = '';
    let settled = false;
    let searchingNotified = false;
    let thinkingNotified = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve();
    };

    response.on('data', (chunk: Buffer) => {
      if (settled || signal?.aborted) return;
      sseBuffer += chunk.toString();
      const normalized = sseBuffer.replace(/\r\n/g, '\n');
      const events = normalized.split('\n\n');
      sseBuffer = events.pop() || '';

      for (const rawEvent of events) {
        if (settled) break;

        const dataLines = rawEvent
          .split('\n')
          .map((line) => line.trimEnd())
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart());

        if (dataLines.length === 0) continue;
        const data = dataLines.join('\n').trim();
        if (!data || data === '[DONE]') continue;

        try {
          const evt = JSON.parse(data);
          const kind: string = evt.type || '';

          if (kind === 'response.output_text.delta') {
            const delta = evt.delta || '';
            if (delta) callbacks.onDelta(delta);
          } else if (kind.includes('web_search_call')) {
            // Web search in progress
            if (!searchingNotified && callbacks.onStatus) {
              callbacks.onStatus('Searching the web...');
              searchingNotified = true;
            }
          } else if (kind === 'response.reasoning_summary_text.delta' || kind === 'response.reasoning_text.delta') {
            // Model is thinking
            if (!thinkingNotified && callbacks.onStatus) {
              callbacks.onStatus('Thinking...');
              thinkingNotified = true;
            }
          } else if (kind === 'response.reasoning_summary_part.added') {
            if (!thinkingNotified && callbacks.onStatus) {
              callbacks.onStatus('Thinking...');
              thinkingNotified = true;
            }
          } else if (kind === 'response.failed') {
            finish(new Error(evt?.response?.error?.message || evt?.error?.message || 'ChatGPT request failed'));
          } else if (kind === 'response.completed') {
            finish();
          }
        } catch {}
      }
    });

    response.on('end', () => finish());
    response.on('error', (err) => finish(err));
    if (signal) {
      signal.addEventListener('abort', () => finish(new Error('Request aborted')), { once: true });
    }
  });
}

/**
 * Async generator wrapper around streamSSEDirect for backward compat
 * with functions that still use `yield*`.
 */
async function* streamResponseSSE(
  response: http.IncomingMessage,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const chunks: string[] = [];
  let done = false;
  let error: Error | null = null;
  let resolve: (() => void) | null = null;

  // Consume via callback, push to array
  streamSSEDirect(response, {
    onDelta: (text) => {
      chunks.push(text);
      if (resolve) { const r = resolve; resolve = null; r(); }
    },
  }, signal).then(() => {
    done = true;
    if (resolve) { const r = resolve; resolve = null; r(); }
  }).catch((e) => {
    error = e;
    done = true;
    if (resolve) { const r = resolve; resolve = null; r(); }
  });

  while (true) {
    if (signal?.aborted) return;
    if (chunks.length > 0) { yield chunks.shift()!; continue; }
    if (error) throw error;
    if (done) return;
    await new Promise<void>((r) => { resolve = r; });
  }
}

// ─── Constants ────────────────────────────────────────────────────

const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

// ─── Model registry ──────────────────────────────────────────────

interface ChatGPTModelConfig {
  upstreamId: string;
  reasoning: string; // 'none' | 'low' | 'medium' | 'high' | 'xhigh'
}

const CHATGPT_MODELS: Record<string, ChatGPTModelConfig> = {
  'gpt-5':        { upstreamId: 'gpt-5',            reasoning: 'medium' },
  'gpt-5.4':      { upstreamId: 'gpt-5.4',          reasoning: 'none' },
  'gpt-5.2':      { upstreamId: 'gpt-5.2',          reasoning: 'medium' },
  'gpt-5.1':      { upstreamId: 'gpt-5.1',          reasoning: 'medium' },
  'gpt-5-codex':  { upstreamId: 'gpt-5-codex',      reasoning: 'medium' },
  'gpt-5.2-codex':{ upstreamId: 'gpt-5.2-codex',    reasoning: 'medium' },
  'gpt-5.1-codex':{ upstreamId: 'gpt-5.1-codex',    reasoning: 'medium' },
  'codex-mini':   { upstreamId: 'codex-mini-latest', reasoning: 'medium' },
  'gpt-4o':       { upstreamId: 'gpt-4o',            reasoning: 'none' },
};

export function getChatGPTModelList(): { id: string; label: string }[] {
  return [
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'gpt-5.1', label: 'GPT-5.1' },
    { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
    { id: 'codex-mini', label: 'Codex Mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
  ];
}

// ─── Message conversion ──────────────────────────────────────────

interface ResponsesInput {
  type: string;
  role?: string;
  content?: Array<{ type: string; text?: string; image_url?: string }>;
  [key: string]: any;
}

function convertSinglePromptToInput(prompt: string): ResponsesInput[] {
  return [{
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: prompt }],
  }];
}

export function convertMessageHistoryToInput(
  messages: Array<{ role: string; content: string; images?: string[] }>
): ResponsesInput[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const contentParts: Array<{ type: string; text?: string; image_url?: string }> = [];
      // Text content
      if (m.content) {
        contentParts.push({
          type: m.role === 'assistant' ? 'output_text' : 'input_text',
          text: m.content,
        });
      }
      // Image attachments (user messages only)
      if (m.role === 'user' && m.images) {
        for (const img of m.images) {
          contentParts.push({ type: 'input_image', image_url: img });
        }
      }
      return {
        type: 'message',
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: contentParts,
      };
    });
}

// ─── Session ID for prompt caching ───────────────────────────────

function generateSessionId(systemPrompt: string | undefined, firstMessage: string): string {
  const canonical = JSON.stringify({
    instructions: systemPrompt || '',
    firstMessage: firstMessage.slice(0, 1000),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

// ─── Streaming implementation ─────────────────────────────────────

export async function* streamChatGPTAccount(
  modelId: string,
  prompt: string,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const tokens = await loadChatGPTTokens();
  if (!tokens) {
    throw new Error('ChatGPT session expired. Please sign in again in Settings → AI.');
  }

  const modelConfig = CHATGPT_MODELS[modelId] || { upstreamId: modelId };
  const upstreamModel = modelConfig.upstreamId;

  const input = convertSinglePromptToInput(prompt);
  const sessionId = generateSessionId(systemPrompt, prompt);

  const singleReasoningEffort = modelConfig.reasoning || 'medium';
  const singleReasoningParam: any = { effort: singleReasoningEffort };
  if (singleReasoningEffort !== 'none') {
    singleReasoningParam.summary = 'auto';
  }

  const payload: any = {
    model: upstreamModel,
    instructions: systemPrompt || 'You are a helpful assistant.',
    input,
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    store: false,
    stream: true,
    prompt_cache_key: sessionId,
    reasoning: singleReasoningParam,
  };

  if (singleReasoningEffort !== 'none') {
    payload.include = ['reasoning.encrypted_content'];
  }

  const body = JSON.stringify(payload);

  const response = await new Promise<import('http').IncomingMessage>((resolve, reject) => {
    const url = new URL(RESPONSES_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Accept-Encoding': 'identity',
          'chatgpt-account-id': tokens.accountId,
          'OpenAI-Beta': 'responses=experimental',
          'session_id': sessionId,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            let errorMessage = `ChatGPT API error (HTTP ${res.statusCode})`;
            try {
              const parsed = JSON.parse(body);
              if (parsed?.error?.message) errorMessage = parsed.error.message;
              else if (parsed?.detail) errorMessage = parsed.detail;
            } catch {}
            reject(new Error(errorMessage));
          });
          return;
        }
        resolve(res);
      }
    );

    req.on('error', reject);

    if (signal) {
      if (signal.aborted) {
        req.destroy();
        reject(new Error('Request aborted'));
        return;
      }
      signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('Request aborted'));
      }, { once: true });
    }

    req.write(body);
    req.end();
  });

  yield* streamResponseSSE(response, signal);
}

// ─── Direct callback streaming (bypasses async generators) ───────

export async function streamChatGPTDirect(
  modelId: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }>,
  onChunk: (text: string) => void,
  opts?: { systemPrompt?: string; sessionId?: string; signal?: AbortSignal; onStatus?: (status: string) => void }
): Promise<void> {
  const tokens = await loadChatGPTTokens();
  if (!tokens) throw new Error('ChatGPT session expired. Please sign in again in Settings → AI.');

  const mc = CHATGPT_MODELS[modelId] || { upstreamId: modelId, reasoning: 'medium' };
  const items = convertMessageHistoryToInput(messages);
  const sid = opts?.sessionId || generateSessionId(opts?.systemPrompt, messages[0]?.content || '');
  const effort = mc.reasoning || 'medium';
  const rp: any = { effort };
  if (effort !== 'none') rp.summary = 'auto';

  const payload: any = {
    model: mc.upstreamId, instructions: opts?.systemPrompt || 'You are a helpful assistant.',
    input: items, tools: [{ type: 'web_search' }], tool_choice: 'auto',
    parallel_tool_calls: false, store: false, stream: true,
    prompt_cache_key: sid, reasoning: rp,
  };
  if (effort !== 'none') payload.include = ['reasoning.encrypted_content'];

  const body = JSON.stringify(payload);
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const url = new URL(RESPONSES_URL);
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json',
        'Accept': 'text/event-stream', 'Accept-Encoding': 'identity',
        'chatgpt-account-id': tokens.accountId,
        'OpenAI-Beta': 'responses=experimental', 'session_id': sid,
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let errB = ''; res.on('data', (c) => { errB += c; });
        res.on('end', () => {
          let m = `HTTP ${res.statusCode}`;
          try { const p = JSON.parse(errB); m = p?.error?.message || p?.detail || m; } catch {}
          reject(new Error(m));
        }); return;
      }
      resolve(res);
    });
    req.on('error', reject);
    if (opts?.signal) {
      if (opts.signal.aborted) { req.destroy(); reject(new Error('aborted')); return; }
      opts.signal.addEventListener('abort', () => { req.destroy(); }, { once: true });
    }
    req.write(body); req.end();
  });

  await streamSSEDirect(response, { onDelta: onChunk, onStatus: opts?.onStatus }, opts?.signal);
}

// ─── Multi-turn streaming ────────────────────────────────────────

export async function* streamChatGPTAccountMultiTurn(
  modelId: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }>,
  systemPrompt?: string,
  sessionId?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const tokens = await loadChatGPTTokens();
  if (!tokens) {
    throw new Error('ChatGPT session expired. Please sign in again in Settings → AI.');
  }

  const modelConfig = CHATGPT_MODELS[modelId] || { upstreamId: modelId };
  const upstreamModel = modelConfig.upstreamId;
  const inputItems = convertMessageHistoryToInput(messages);
  const effectiveSessionId = sessionId || generateSessionId(systemPrompt, messages[0]?.content || '');

  // Build reasoning param — always send it (matching ChatMock behavior)
  const reasoningEffort = modelConfig.reasoning || 'medium';
  const reasoningParam: any = { effort: reasoningEffort };
  if (reasoningEffort !== 'none') {
    reasoningParam.summary = 'auto';
  }

  const payload: any = {
    model: upstreamModel,
    instructions: systemPrompt || 'You are a helpful assistant.',
    input: inputItems,
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    store: false,
    stream: true,
    prompt_cache_key: effectiveSessionId,
    reasoning: reasoningParam,
  };

  if (reasoningEffort !== 'none') {
    payload.include = ['reasoning.encrypted_content'];
  }

  const body = JSON.stringify(payload);

  const response = await new Promise<import('http').IncomingMessage>((resolve, reject) => {
    const url = new URL(RESPONSES_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Accept-Encoding': 'identity',
          'chatgpt-account-id': tokens.accountId,
          'OpenAI-Beta': 'responses=experimental',
          'session_id': effectiveSessionId,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = '';
          res.on('data', (chunk) => { errBody += chunk; });
          res.on('end', () => {
            let errorMessage = `ChatGPT API error (HTTP ${res.statusCode})`;
            try {
              const parsed = JSON.parse(errBody);
              if (parsed?.error?.message) errorMessage = parsed.error.message;
              else if (parsed?.detail) errorMessage = parsed.detail;
            } catch {}
            reject(new Error(errorMessage));
          });
          return;
        }
        resolve(res);
      }
    );

    req.on('error', reject);

    if (signal) {
      if (signal.aborted) {
        req.destroy();
        reject(new Error('Request aborted'));
        return;
      }
      signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('Request aborted'));
      }, { once: true });
    }

    req.write(body);
    req.end();
  });

  yield* streamResponseSSE(response, signal);
}
