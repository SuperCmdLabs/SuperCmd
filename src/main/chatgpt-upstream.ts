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

// ─── Callback-based SSE stream consumer ──────────────────────────

/**
 * Create an async generator from response 'data' events.
 * Each SSE output_text.delta is yielded individually for real-time streaming.
 */
async function* streamResponseSSE(
  response: http.IncomingMessage,
  signal?: AbortSignal
): AsyncGenerator<string> {
  // Push-based async queue: data events push, generator pulls
  const queue: Array<string | null | Error> = []; // null = done, Error = error
  let waiting: ((value: void) => void) | null = null;

  const notify = () => { if (waiting) { const w = waiting; waiting = null; w(); } };

  let sseBuffer = '';
  response.on('data', (chunk: Buffer) => {
    if (signal?.aborted) return;
    sseBuffer += chunk.toString();
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (!data || data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data);
        const kind = evt.type;
        if (kind === 'response.output_text.delta') {
          const delta = evt.delta || '';
          if (delta) { queue.push(delta); notify(); }
        } else if (kind === 'response.failed') {
          queue.push(new Error(evt?.response?.error?.message || evt?.error?.message || 'ChatGPT request failed'));
          notify();
          return;
        } else if (kind === 'response.completed') {
          queue.push(null);
          notify();
          return;
        }
      } catch {}
    }
  });

  response.on('end', () => { queue.push(null); notify(); });
  response.on('error', (err) => { queue.push(err); notify(); });

  while (true) {
    if (signal?.aborted) return;
    while (queue.length === 0) {
      await new Promise<void>((r) => { waiting = r; });
    }
    const item = queue.shift()!;
    if (item === null || item === undefined) return;
    if (item instanceof Error) throw item;
    yield item as string;
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
