/**
 * Claude Upstream — Claude Code account bridge
 *
 * Streams completions through the Anthropic Messages API using the
 * local Claude Code auth token and base URL.
 */

import * as http from 'http';
import * as https from 'https';
import { loadClaudeAccountTokens, resolveClaudeCodeModelAlias } from './claude-auth';

interface ClaudeModelConfig {
  upstreamId: string;
}

const CLAUDE_MODELS: Record<string, ClaudeModelConfig> = {
  sonnet: { upstreamId: 'claude-sonnet-4-5' },
  opus: { upstreamId: 'claude-opus-4-1' },
  haiku: { upstreamId: 'claude-3-5-haiku-latest' },
};

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
    const req = mod.request(
      {
        hostname: opts.hostname,
        port: opts.port,
        path: opts.path,
        method: opts.method,
        headers: opts.headers,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk.toString();
          });
          res.on('end', () => {
            reject(new Error(body || `Claude API error (HTTP ${res.statusCode})`));
          });
          return;
        }
        resolve(res);
      }
    );

    req.on('error', reject);
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        req.destroy(new Error('Request aborted'));
      }, { once: true });
    }
    req.write(opts.body);
    req.end();
  });
}

async function* parseSSE(
  response: http.IncomingMessage,
  extract: (data: string) => string | null
): AsyncGenerator<string> {
  let buffer = '';
  for await (const chunk of response) {
    buffer += chunk.toString();
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const lines = event.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const text = extract(data);
        if (text) yield text;
      }
    }
  }
}

function getMessagesUrl(baseUrl: string): URL {
  const normalized = baseUrl.replace(/\/+$/, '');
  const url = normalized.endsWith('/v1')
    ? `${normalized}/messages`
    : `${normalized}/v1/messages`;
  return new URL(url);
}

function getUpstreamModel(modelId: string): string {
  const configuredAlias = resolveClaudeCodeModelAlias(modelId);
  if (configuredAlias && configuredAlias !== modelId) {
    return configuredAlias;
  }
  return CLAUDE_MODELS[modelId]?.upstreamId || modelId;
}

function getClaudeHeaders(authToken: string, baseUrl: string): Record<string, string> {
  // LiteLLM proxies (and the Anthropic Messages API) require x-api-key,
  // while claude.ai OAuth endpoints require Authorization: Bearer.
  // Use x-api-key when the base URL is not claude.ai.
  const isClaudeAi = /claude\.ai/i.test(baseUrl);
  return {
    'Content-Type': 'application/json',
    ...(isClaudeAi
      ? { 'Authorization': `Bearer ${authToken}` }
      : { 'x-api-key': authToken, 'Authorization': `Bearer ${authToken}` }),
    'anthropic-version': '2023-06-01',
  };
}

export async function* streamClaudeAccount(
  modelId: string,
  prompt: string,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const tokens = await loadClaudeAccountTokens();
  if (!tokens) {
    throw new Error('Claude session expired. Please sign in again in Settings → AI.');
  }

  const url = getMessagesUrl(tokens.baseUrl);
  const body: any = {
    model: getUpstreamModel(modelId),
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  };
  if (systemPrompt) body.system = systemPrompt;

  const response = await httpRequest({
    hostname: url.hostname,
    port: url.port ? parseInt(url.port, 10) : undefined,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: getClaudeHeaders(tokens.authToken, tokens.baseUrl),
    body: JSON.stringify(body),
    signal,
    useHttps: url.protocol === 'https:',
  });

  yield* parseSSE(response, (data) => {
    try {
      const parsed = JSON.parse(data);
      // Anthropic native format
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        return parsed.delta.text;
      }
      // OpenAI-compatible format (LiteLLM and other proxies)
      if (parsed.choices?.[0]?.delta?.content) {
        return parsed.choices[0].delta.content;
      }
      return null;
    } catch {
      return null;
    }
  });
}

export async function* streamClaudeAccountMultiTurn(
  modelId: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }>,
  systemPrompt?: string,
  _sessionId?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const tokens = await loadClaudeAccountTokens();
  if (!tokens) {
    throw new Error('Claude session expired. Please sign in again in Settings → AI.');
  }

  const url = getMessagesUrl(tokens.baseUrl);
  const body: any = {
    model: getUpstreamModel(modelId),
    max_tokens: 4096,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (systemPrompt) body.system = systemPrompt;

  const response = await httpRequest({
    hostname: url.hostname,
    port: url.port ? parseInt(url.port, 10) : undefined,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: getClaudeHeaders(tokens.authToken, tokens.baseUrl),
    body: JSON.stringify(body),
    signal,
    useHttps: url.protocol === 'https:',
  });

  yield* parseSSE(response, (data) => {
    try {
      const parsed = JSON.parse(data);
      // Anthropic native format
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        return parsed.delta.text;
      }
      // OpenAI-compatible format (LiteLLM and other proxies)
      if (parsed.choices?.[0]?.delta?.content) {
        return parsed.choices[0].delta.content;
      }
      return null;
    } catch {
      return null;
    }
  });
}
