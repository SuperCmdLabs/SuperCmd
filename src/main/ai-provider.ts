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
  provider: 'openai' | 'anthropic' | 'ollama' | 'openai-compatible';
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
  // If the model key is not in our routing table, strip provider prefix and route directly
  if (model) {
    // Order matters: check longer prefixes first to avoid partial matches
    const prefixes = ['openai-compatible-', 'anthropic-', 'ollama-', 'openai-'] as const;
    for (const prefix of prefixes) {
      if (model.startsWith(prefix)) {
        return { provider: prefix.slice(0, -1) as 'openai' | 'anthropic' | 'ollama' | 'openai-compatible', modelId: model.slice(prefix.length) };
      }
    }
    return { provider: config.provider, modelId: model };
  }
  // Fallback to default model or provider default
  if (config.defaultModel) {
    if (MODEL_ROUTES[config.defaultModel]) {
      return MODEL_ROUTES[config.defaultModel];
    }
    // Handle dynamic model IDs (e.g. "ollama-llama3.2")
    // Order matters: check longer prefixes first to avoid partial matches
    const prefixes = ['openai-compatible-', 'anthropic-', 'ollama-', 'openai-'] as const;
    for (const prefix of prefixes) {
      if (config.defaultModel.startsWith(prefix)) {
        return { provider: prefix.slice(0, -1) as 'openai' | 'anthropic' | 'ollama' | 'openai-compatible', modelId: config.defaultModel.slice(prefix.length) };
      }
    }
  }
  // Provider defaults
  const defaults: Record<string, string> = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    ollama: 'llama3',
    'openai-compatible': config.openaiCompatibleModel?.trim() || 'gpt-4o',
  };
  return { provider: config.provider, modelId: defaults[config.provider] || 'gpt-4o-mini' };
}

// ─── Availability check ──────────────────────────────────────────────

function hasProviderCredentials(provider: ModelRoute['provider'], config: AISettings): boolean {
  switch (provider) {
    case 'openai':
      return !!config.openaiApiKey;
    case 'anthropic':
      return !!config.anthropicApiKey;
    case 'ollama':
      return !!config.ollamaBaseUrl;
    case 'openai-compatible':
      return !!(config.openaiCompatibleBaseUrl && config.openaiCompatibleApiKey);
    default:
      return false;
  }
}

export function isAIAvailable(config: AISettings): boolean {
  // Treat missing/legacy "enabled" as enabled by default.
  if (config.enabled === false) return false;
  if (config.llmEnabled === false) return false;

  // Availability should follow the effective model route (defaultModel can
  // point to a different provider than config.provider).
  const route = resolveModel(undefined, config);
  if (hasProviderCredentials(route.provider, config)) return true;

  // Fallback to configured provider in case defaultModel is invalid.
  return hasProviderCredentials(config.provider, config);
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
    case 'openai-compatible':
      yield* streamOpenAICompatible(
        config.openaiCompatibleBaseUrl,
        config.openaiCompatibleApiKey,
        route.modelId,
        options.prompt,
        temperature,
        options.systemPrompt,
        options.signal
      );
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

// ─── OpenAI-Compatible (Generic) ──────────────────────────────────────

async function* streamOpenAICompatible(
  baseUrl: string,
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

  // Ensure baseUrl ends with /v1 and append /chat/completions
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const chatUrl = normalizedBaseUrl.endsWith('/v1') 
    ? `${normalizedBaseUrl}/chat/completions`
    : `${normalizedBaseUrl}/v1/chat/completions`;
  
  const url = new URL(chatUrl);
  const useHttps = url.protocol === 'https:';

  const response = await httpRequest({
    hostname: url.hostname,
    port: url.port ? parseInt(url.port) : undefined,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
    signal,
    useHttps,
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

// ─── Whisper Audio Transcription ─────────────────────────────────────

export interface TranscribeOptions {
  audioBuffer: Buffer;
  apiKey: string;
  model: string;
  language?: string;
  mimeType?: string;
  signal?: AbortSignal;
}

function resolveUploadMeta(mimeType?: string): { filename: string; contentType: string } {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('wav')) return { filename: 'audio.wav', contentType: 'audio/wav' };
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return { filename: 'audio.mp3', contentType: 'audio/mpeg' };
  if (normalized.includes('mp4') || normalized.includes('m4a')) return { filename: 'audio.m4a', contentType: 'audio/mp4' };
  if (normalized.includes('ogg') || normalized.includes('oga')) return { filename: 'audio.ogg', contentType: 'audio/ogg' };
  if (normalized.includes('flac')) return { filename: 'audio.flac', contentType: 'audio/flac' };
  return { filename: 'audio.webm', contentType: 'audio/webm' };
}

export function transcribeAudio(opts: TranscribeOptions): Promise<string> {
  const boundary = `----SuperCmdBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const uploadMeta = resolveUploadMeta(opts.mimeType);

  const parts: Buffer[] = [];

  // file field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${uploadMeta.filename}"\r\nContent-Type: ${uploadMeta.contentType}\r\n\r\n`
  ));
  parts.push(opts.audioBuffer);
  parts.push(Buffer.from('\r\n'));

  // model field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${opts.model}\r\n`
  ));

  // response_format field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`
  ));

  // language field (optional)
  if (opts.language) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${opts.language}\r\n`
    ));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  return new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Whisper API HTTP ${res.statusCode}: ${responseBody.slice(0, 500)}`));
            return;
          }
          resolve(responseBody.trim());
        });
      }
    );

    req.on('error', reject);

    if (opts.signal) {
      if (opts.signal.aborted) {
        req.destroy();
        reject(new Error('Transcription aborted'));
        return;
      }
      opts.signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('Transcription aborted'));
      }, { once: true });
    }

    req.write(body);
    req.end();
  });
}
