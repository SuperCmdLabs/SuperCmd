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

  // Parse SSE stream — single-turn mode: skip reasoning, only yield output text
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
      } else if (kind === 'response.reasoning_summary_text.delta' || kind === 'response.reasoning_text.delta') {
        // Skip reasoning in single-turn (inline AI) — no collapsible UI to display it
      } else if (kind === 'response.failed') {
        throw new Error(
          evt?.response?.error?.message ||
          evt?.error?.message ||
          'ChatGPT request failed'
        );
      } else if (kind === 'response.completed') {
        break;
      }
    }
  }
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
  let inThinking = false;
  let thinkingClosed = false;

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

      // Reasoning/thinking output — wrap in <think> tags
      if (kind === 'response.reasoning_summary_text.delta' || kind === 'response.reasoning_text.delta') {
        const delta = evt.delta || '';
        if (delta) {
          if (!inThinking && !thinkingClosed) {
            yield '<think>\n';
            inThinking = true;
          }
          if (inThinking) yield delta;
        }
      } else if (kind === 'response.output_text.delta') {
        // Close thinking block before first output
        if (inThinking && !thinkingClosed) {
          yield '\n</think>\n\n';
          inThinking = false;
          thinkingClosed = true;
        }
        const delta = evt.delta || '';
        if (delta) yield delta;
      } else if (kind === 'response.failed') {
        throw new Error(evt?.response?.error?.message || evt?.error?.message || 'ChatGPT request failed');
      } else if (kind === 'response.completed') {
        if (inThinking && !thinkingClosed) {
          yield '\n</think>\n\n';
        }
        break;
      }
    }
  }
}
