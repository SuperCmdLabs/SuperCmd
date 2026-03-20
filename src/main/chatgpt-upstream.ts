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
import * as crypto from 'crypto';
import { loadChatGPTTokens } from './chatgpt-auth';

// ─── Constants ────────────────────────────────────────────────────

const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

// ─── Model registry ──────────────────────────────────────────────

interface ChatGPTModelConfig {
  upstreamId: string;
  reasoning?: string; // 'none' | 'low' | 'medium' | 'high'
}

const CHATGPT_MODELS: Record<string, ChatGPTModelConfig> = {
  'gpt-5.4': { upstreamId: 'gpt-5.4', reasoning: 'none' },
  'gpt-5.2': { upstreamId: 'gpt-5.2' },
  'gpt-5.1': { upstreamId: 'gpt-5.1' },
  'gpt-5': { upstreamId: 'gpt-5' },
  'gpt-5-codex': { upstreamId: 'gpt-5-codex' },
  'gpt-5.2-codex': { upstreamId: 'gpt-5.2-codex' },
  'gpt-5.1-codex': { upstreamId: 'gpt-5.1-codex' },
  'codex-mini': { upstreamId: 'codex-mini' },
  'gpt-4o': { upstreamId: 'gpt-4o', reasoning: 'none' },
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
  messages: Array<{ role: string; content: string }>
): ResponsesInput[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      type: 'message',
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{
        type: m.role === 'assistant' ? 'output_text' : 'input_text',
        text: m.content,
      }],
    }));
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

  const payload: any = {
    model: upstreamModel,
    instructions: systemPrompt || 'You are a helpful assistant.',
    input,
    store: false,
    stream: true,
    prompt_cache_key: sessionId,
  };

  // Add reasoning config for models that support it
  if (modelConfig.reasoning !== 'none') {
    payload.reasoning = {
      effort: modelConfig.reasoning || 'medium',
      summary: 'auto',
    };
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

  // Parse SSE stream from Responses API
  let buffer = '';

  for await (const rawChunk of response) {
    if (signal?.aborted) break;

    buffer += rawChunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (!data || data === '[DONE]') continue;

      let evt: any;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }

      const kind = evt.type;

      if (kind === 'response.output_text.delta') {
        const delta = evt.delta || '';
        if (delta) yield delta;
      } else if (kind === 'response.reasoning_summary_text.delta') {
        // Optionally yield reasoning as think-tags
        // For now, skip reasoning output to keep responses clean
      } else if (kind === 'response.failed') {
        const errorMsg =
          evt?.response?.error?.message ||
          evt?.error?.message ||
          'ChatGPT request failed';
        throw new Error(errorMsg);
      } else if (kind === 'response.completed') {
        // Stream complete
        break;
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6);
      if (data && data !== '[DONE]') {
        try {
          const evt = JSON.parse(data);
          if (evt.type === 'response.output_text.delta' && evt.delta) {
            yield evt.delta;
          }
        } catch {}
      }
    }
  }
}

// ─── Multi-turn streaming ────────────────────────────────────────

export async function* streamChatGPTAccountMultiTurn(
  modelId: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
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

  const payload: any = {
    model: upstreamModel,
    instructions: systemPrompt || 'You are a helpful assistant.',
    input: inputItems,
    store: false,
    stream: true,
    prompt_cache_key: effectiveSessionId,
  };

  if (modelConfig.reasoning !== 'none') {
    payload.reasoning = {
      effort: modelConfig.reasoning || 'medium',
      summary: 'auto',
    };
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

  let buffer = '';
  for await (const rawChunk of response) {
    if (signal?.aborted) break;
    buffer += rawChunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (!data || data === '[DONE]') continue;
      let evt: any;
      try { evt = JSON.parse(data); } catch { continue; }
      const kind = evt.type;
      if (kind === 'response.output_text.delta') {
        const delta = evt.delta || '';
        if (delta) yield delta;
      } else if (kind === 'response.failed') {
        throw new Error(evt?.response?.error?.message || evt?.error?.message || 'ChatGPT request failed');
      } else if (kind === 'response.completed') {
        break;
      }
    }
  }
}
