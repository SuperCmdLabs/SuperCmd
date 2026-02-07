/**
 * AI Provider — streaming LLM completions via OpenAI, Anthropic, or Ollama.
 *
 * Uses Node.js built-in https/http modules — no npm dependencies.
 */

import * as https from 'https';
import * as http from 'http';
import type { AISettings } from './settings-store';

export interface AIRequestOptions {
  prompt: string;
  model?: string;
  creativity?: number; // 0-2 temperature
  systemPrompt?: string;
  signal?: AbortSignal;
}

// ─── Model routing ────────────────────────────────────────────────────

interface ModelRoute {
  provider: 'openai' | 'anthropic' | 'ollama';
  modelId: string;
}

const MODEL_ROUTES: Record<string, ModelRoute> = {
  // OpenAI
  'openai-gpt-4o': { provider: 'openai', modelId: 'gpt-4o' },
  'openai-gpt-4o-mini': { provider: 'openai', modelId: 'gpt-4o-mini' },
  'openai-gpt-4-turbo': { provider: 'openai', modelId: 'gpt-4-turbo' },
  'openai-gpt-3.5-turbo': { provider: 'openai', modelId: 'gpt-3.5-turbo' },
  'openai-o1': { provider: 'openai', modelId: 'o1' },
  'openai-o1-mini': { provider: 'openai', modelId: 'o1-mini' },
  'openai-o3-mini': { provider: 'openai', modelId: 'o3-mini' },
  // Anthropic
  'anthropic-claude-opus': { provider: 'anthropic', modelId: 'claude-opus-4-20250514' },
  'anthropic-claude-sonnet': { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
  'anthropic-claude-haiku': { provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' },
  // Ollama (user-managed models)
  'ollama-llama3': { provider: 'ollama', modelId: 'llama3' },
  'ollama-mistral': { provider: 'ollama', modelId: 'mistral' },
  'ollama-codellama': { provider: 'ollama', modelId: 'codellama' },
};

function resolveModel(model: string | undefined, config: AISettings): ModelRoute {
  if (model && MODEL_ROUTES[model]) {
    return MODEL_ROUTES[model];
  }
  // If the model key is not in our routing table, try using it directly with the configured provider
  if (model) {
    return { provider: config.provider, modelId: model };
  }
  // Fallback to default model or provider default
  if (config.defaultModel && MODEL_ROUTES[config.defaultModel]) {
    return MODEL_ROUTES[config.defaultModel];
  }
  // Provider defaults
  const defaults: Record<string, string> = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    ollama: 'llama3',
  };
  return { provider: config.provider, modelId: defaults[config.provider] || 'gpt-4o-mini' };
}

// ─── Availability check ──────────────────────────────────────────────

export function isAIAvailable(config: AISettings): boolean {
  if (!config.enabled) return false;
  switch (config.provider) {
    case 'openai': return !!config.openaiApiKey;
    case 'anthropic': return !!config.anthropicApiKey;
    case 'ollama': return !!config.ollamaBaseUrl;
    default: return false;
  }
}

// ─── Streaming implementation ────────────────────────────────────────

export async function* streamAI(
  config: AISettings,
  options: AIRequestOptions
): AsyncGenerator<string> {
  const route = resolveModel(options.model, config);
  const temperature = options.creativity ?? 0.7;

  switch (route.provider) {
    case 'openai':
      yield* streamOpenAI(config.openaiApiKey, route.modelId, options.prompt, temperature, options.systemPrompt, options.signal);
      break;
    case 'anthropic':
      yield* streamAnthropic(config.anthropicApiKey, route.modelId, options.prompt, temperature, options.systemPrompt, options.signal);
      break;
    case 'ollama':
      yield* streamOllama(config.ollamaBaseUrl, route.modelId, options.prompt, temperature, options.systemPrompt, options.signal);
      break;
  }
}

// ─── OpenAI ──────────────────────────────────────────────────────────

async function* streamOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
  temperature: number,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const messages: any[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const body = JSON.stringify({
    model,
    messages,
    temperature,
    stream: true,
  });

  const response = await httpRequest({
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
    signal,
    useHttps: true,
  });

  yield* parseSSE(response, (data) => {
    if (data === '[DONE]') return null;
    try {
      const parsed = JSON.parse(data);
      return parsed.choices?.[0]?.delta?.content || null;
    } catch {
      return null;
    }
  });
}

// ─── Anthropic ───────────────────────────────────────────────────────

async function* streamAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
  temperature: number,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const body: any = {
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (systemPrompt) body.system = systemPrompt;

  const response = await httpRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
    useHttps: true,
  });

  yield* parseSSE(response, (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        return parsed.delta.text;
      }
      return null;
    } catch {
      return null;
    }
  });
}

// ─── Ollama ──────────────────────────────────────────────────────────

async function* streamOllama(
  baseUrl: string,
  model: string,
  prompt: string,
  temperature: number,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const url = new URL('/api/generate', baseUrl);

  const body: any = {
    model,
    prompt,
    stream: true,
    options: { temperature },
  };
  if (systemPrompt) body.system = systemPrompt;

  const useHttps = url.protocol === 'https:';
  const response = await httpRequest({
    hostname: url.hostname,
    port: url.port ? parseInt(url.port) : undefined,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    useHttps,
  });

  // Ollama uses NDJSON — each line is a JSON object
  yield* parseNDJSON(response, (obj) => {
    return obj.response || null;
  });
}

// ─── HTTP helpers ────────────────────────────────────────────────────

interface HttpRequestOptions {
  hostname: string;
  port?: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  useHttps: boolean;
}

function httpRequest(opts: HttpRequestOptions): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const mod = opts.useHttps ? https : http;

    const reqOpts: https.RequestOptions = {
      hostname: opts.hostname,
      port: opts.port,
      path: opts.path,
      method: opts.method,
      headers: opts.headers,
    };

    const req = mod.request(reqOpts, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
        });
        return;
      }
      resolve(res);
    });

    req.on('error', reject);

    if (opts.signal) {
      if (opts.signal.aborted) {
        req.destroy();
        reject(new Error('Request aborted'));
        return;
      }
      opts.signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('Request aborted'));
      }, { once: true });
    }

    req.write(opts.body);
    req.end();
  });
}

async function* parseSSE(
  response: http.IncomingMessage,
  extractChunk: (data: string) => string | null
): AsyncGenerator<string> {
  let buffer = '';

  for await (const rawChunk of response) {
    buffer += rawChunk.toString();

    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      const text = extractChunk(data);
      if (text) yield text;
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6);
      const text = extractChunk(data);
      if (text) yield text;
    }
  }
}

async function* parseNDJSON(
  response: http.IncomingMessage,
  extractChunk: (obj: any) => string | null
): AsyncGenerator<string> {
  let buffer = '';

  for await (const rawChunk of response) {
    buffer += rawChunk.toString();

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        const text = extractChunk(obj);
        if (text) yield text;
      } catch {
        // skip malformed lines
      }
    }
  }

  if (buffer.trim()) {
    try {
      const obj = JSON.parse(buffer.trim());
      const text = extractChunk(obj);
      if (text) yield text;
    } catch {}
  }
}
