/**
 * Native tool-calling adapter.
 *
 * Provides a provider-agnostic streaming chat API that understands tool
 * schemas and emits structured `tool_call` events. The agent loop sits on
 * top of this and no longer has to parse JSON out of model prose.
 *
 * Replaces the legacy ReAct "JSON-in-text" protocol used by the initial
 * version of agent-runner.ts. Per-provider shapes are:
 *
 *   OpenAI / openai-compatible / Ollama  → OpenAI-style `tools` + streaming
 *                                          `delta.tool_calls[i].function.arguments`
 *                                          (arguments stream as JSON fragments
 *                                          and must be accumulated).
 *   Anthropic                             → `tools` + `tool_use` content blocks
 *                                          with `input_json_delta` events.
 *   Gemini                                → `tools.functionDeclarations` and
 *                                          `functionCall` parts (args are
 *                                          already objects, no JSON parsing).
 */

import type { AISettings } from './settings-store';
import {
  httpRequest,
  isOpenAIReasoningModel,
  parseSSELines,
  parseNDJSONLines,
  resolveModel,
} from './ai-provider';

// ─── Public types ─────────────────────────────────────────────────────

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema describing the tool's argument object. */
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface ToolCall {
  /** Provider-issued id so the tool result can be linked back. */
  id: string;
  name: string;
  /** Parsed arguments (not JSON string). */
  arguments: Record<string, any>;
}

export interface AgentImage {
  mimeType: string;
  dataBase64: string;
  label?: string;
  width?: number;
  height?: number;
}

export type AgentMessage =
  | { role: 'user'; content: string; images?: AgentImage[] }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };

export type AgentStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'finish'; reason: 'end_turn' | 'tool_calls' | 'other'; raw?: string };

export interface AgentChatOptions {
  messages: AgentMessage[];
  tools: ToolSchema[];
  model?: string;
  creativity?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

// ─── Dispatcher ───────────────────────────────────────────────────────

export async function* streamAgentChat(
  config: AISettings,
  options: AgentChatOptions,
): AsyncGenerator<AgentStreamEvent> {
  const route = resolveModel(options.model, config);
  const temperature = options.creativity ?? 0.2;

  switch (route.provider) {
    case 'openai':
      yield* streamOpenAITools({
        baseUrl: 'https://api.openai.com',
        apiKey: config.openaiApiKey,
        model: route.modelId,
        options,
        temperature,
      });
      return;
    case 'openai-compatible':
      yield* streamOpenAITools({
        baseUrl: config.openaiCompatibleBaseUrl,
        apiKey: config.openaiCompatibleApiKey,
        model: route.modelId,
        options,
        temperature,
      });
      return;
    case 'anthropic':
      yield* streamAnthropicTools({
        apiKey: config.anthropicApiKey,
        model: route.modelId,
        options,
        temperature,
      });
      return;
    case 'gemini':
      yield* streamGeminiTools({
        apiKey: config.geminiApiKey,
        model: route.modelId,
        options,
        temperature,
      });
      return;
    case 'ollama':
      yield* streamOllamaTools({
        baseUrl: config.ollamaBaseUrl,
        model: route.modelId,
        options,
        temperature,
      });
      return;
  }
}

// ─── OpenAI / openai-compatible / Ollama ─────────────────────────────
// All three use the OpenAI chat/completions schema for tools. Ollama's
// /api/chat is close enough but uses NDJSON and returns arguments as a
// parsed object, so it has its own handler below.

interface OpenAIToolArgs {
  baseUrl: string;
  apiKey: string;
  model: string;
  options: AgentChatOptions;
  temperature: number;
}

async function* streamOpenAITools(
  args: OpenAIToolArgs,
): AsyncGenerator<AgentStreamEvent> {
  const { baseUrl, apiKey, model, options, temperature } = args;
  const messages = toOpenAIMessages(options.messages, options.systemPrompt);
  const tools = options.tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const payload: any = {
    model,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    stream: true,
  };
  if (!isOpenAIReasoningModel(model)) payload.temperature = temperature;

  // Normalize URL (api.openai.com vs a custom /v1 base).
  const { hostname, port, path: urlPath, useHttps } = parseOpenAIUrl(baseUrl);

  const response = await httpRequest({
    hostname,
    port,
    path: urlPath,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: options.signal,
    useHttps,
  });

  // Accumulate tool-call fragments by `index` (OpenAI streams arguments as
  // JSON string chunks spread across many SSE events).
  const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | null = null;

  for await (const data of parseSSELines(response)) {
    if (data === '[DONE]') break;
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { continue; }
    const choice = parsed?.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta || {};
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      yield { type: 'text_delta', delta: delta.content };
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === 'number' ? tc.index : 0;
        let slot = pendingCalls.get(idx);
        if (!slot) {
          slot = { id: tc.id || `call_${idx}`, name: tc.function?.name || '', args: '' };
          pendingCalls.set(idx, slot);
        }
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name = tc.function.name;
        if (typeof tc.function?.arguments === 'string') slot.args += tc.function.arguments;
      }
    }
    if (choice.finish_reason) finishReason = String(choice.finish_reason);
  }

  for (const slot of pendingCalls.values()) {
    if (!slot.name) continue;
    yield { type: 'tool_call', call: { id: slot.id, name: slot.name, arguments: safeParseArgs(slot.args) } };
  }

  yield { type: 'finish', reason: normalizeFinishReason(finishReason), raw: finishReason || undefined };
}

async function* streamOllamaTools(args: {
  baseUrl: string;
  model: string;
  options: AgentChatOptions;
  temperature: number;
}): AsyncGenerator<AgentStreamEvent> {
  const { baseUrl, model, options, temperature } = args;
  const url = new URL('/api/chat', baseUrl);
  const useHttps = url.protocol === 'https:';

  const messages: any[] = [];
  if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
  for (const m of options.messages) {
    if (m.role === 'user') {
      const message: any = { role: 'user', content: m.content };
      if (m.images && m.images.length > 0) {
        message.images = m.images
          .filter((image) => image?.dataBase64)
          .map((image) => image.dataBase64);
      }
      messages.push(message);
    } else if (m.role === 'assistant') {
      const am: any = { role: 'assistant', content: m.content };
      if (m.tool_calls && m.tool_calls.length > 0) {
        am.tool_calls = m.tool_calls.map((c) => ({
          function: { name: c.name, arguments: c.arguments },
        }));
      }
      messages.push(am);
    } else {
      // Ollama uses role: 'tool' and a name field.
      messages.push({ role: 'tool', content: m.content });
    }
  }

  const tools = options.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const body = {
    model,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    stream: true,
    options: { temperature },
  };

  const response = await httpRequest({
    hostname: url.hostname,
    port: url.port ? parseInt(url.port) : undefined,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
    useHttps,
  });

  let finishReason: string | null = null;
  let textBuffer = '';
  const pendingCalls: ToolCall[] = [];
  let callCounter = 0;

  for await (const obj of parseNDJSONLines(response)) {
    const msg = obj?.message;
    if (msg?.content && typeof msg.content === 'string' && msg.content.length > 0) {
      textBuffer += msg.content;
      yield { type: 'text_delta', delta: msg.content };
    }
    if (Array.isArray(msg?.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const name = tc?.function?.name;
        if (!name) continue;
        const rawArgs = tc?.function?.arguments;
        const argsObj =
          typeof rawArgs === 'string' ? safeParseArgs(rawArgs) :
          rawArgs && typeof rawArgs === 'object' ? rawArgs :
          {};
        pendingCalls.push({ id: `call_${callCounter++}`, name, arguments: argsObj });
      }
    }
    if (obj?.done === true) {
      finishReason = pendingCalls.length > 0 ? 'tool_calls' : 'stop';
    }
  }

  for (const call of pendingCalls) {
    yield { type: 'tool_call', call };
  }
  yield { type: 'finish', reason: normalizeFinishReason(finishReason) };
  void textBuffer;
}

function parseOpenAIUrl(baseUrl: string): {
  hostname: string;
  port?: number;
  path: string;
  useHttps: boolean;
} {
  const normalized = (baseUrl || 'https://api.openai.com').replace(/\/$/, '');
  const chatUrl = normalized.endsWith('/v1')
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`;
  const u = new URL(chatUrl);
  return {
    hostname: u.hostname,
    port: u.port ? parseInt(u.port) : undefined,
    path: u.pathname,
    useHttps: u.protocol === 'https:',
  };
}

function toOpenAIMessages(messages: AgentMessage[], systemPrompt?: string): any[] {
  const out: any[] = [];
  if (systemPrompt) out.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    if (m.role === 'user') {
      out.push(toOpenAIUserMessage(m));
    } else if (m.role === 'assistant') {
      const msg: any = { role: 'assistant', content: m.content || '' };
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
        }));
      }
      out.push(msg);
    } else {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
    }
  }
  return out;
}

function toOpenAIUserMessage(message: Extract<AgentMessage, { role: 'user' }>): any {
  const images = Array.isArray(message.images)
    ? message.images.filter((image) => image?.dataBase64)
    : [];

  if (images.length === 0) {
    return { role: 'user', content: message.content };
  }

  return {
    role: 'user',
    content: [
      { type: 'text', text: message.content },
      ...images.map((image) => ({
        type: 'image_url',
        image_url: {
          url: `data:${image.mimeType || 'image/jpeg'};base64,${image.dataBase64}`,
        },
      })),
    ],
  };
}

// ─── Anthropic ───────────────────────────────────────────────────────

async function* streamAnthropicTools(args: {
  apiKey: string;
  model: string;
  options: AgentChatOptions;
  temperature: number;
}): AsyncGenerator<AgentStreamEvent> {
  const { apiKey, model, options, temperature } = args;

  const messages = toAnthropicMessages(options.messages);
  const tools = options.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const body: any = {
    model,
    max_tokens: 4096,
    messages,
    stream: true,
  };
  if (tools.length > 0) body.tools = tools;
  if (options.systemPrompt) body.system = options.systemPrompt;
  if (temperature !== undefined) body.temperature = temperature;

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
    signal: options.signal,
    useHttps: true,
  });

  // Anthropic streams content_block_start/delta/stop around tool_use blocks
  // whose arguments arrive via `input_json_delta.partial_json`.
  const blocks: Array<{ type: string; id?: string; name?: string; partial: string }> = [];
  let stopReason: string | null = null;

  for await (const data of parseSSELines(response)) {
    let evt: any;
    try { evt = JSON.parse(data); } catch { continue; }
    switch (evt.type) {
      case 'content_block_start': {
        const idx = evt.index;
        const cb = evt.content_block || {};
        blocks[idx] = { type: cb.type, id: cb.id, name: cb.name, partial: '' };
        break;
      }
      case 'content_block_delta': {
        const idx = evt.index;
        const block = blocks[idx];
        if (!block) break;
        if (evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
          yield { type: 'text_delta', delta: evt.delta.text };
        } else if (evt.delta?.type === 'input_json_delta' && typeof evt.delta.partial_json === 'string') {
          block.partial += evt.delta.partial_json;
        }
        break;
      }
      case 'content_block_stop': {
        const idx = evt.index;
        const block = blocks[idx];
        if (!block) break;
        if (block.type === 'tool_use' && block.name) {
          yield {
            type: 'tool_call',
            call: {
              id: block.id || `call_${idx}`,
              name: block.name,
              arguments: safeParseArgs(block.partial || '{}'),
            },
          };
        }
        break;
      }
      case 'message_delta': {
        if (evt.delta?.stop_reason) stopReason = String(evt.delta.stop_reason);
        break;
      }
      case 'message_stop': {
        break;
      }
    }
  }

  yield { type: 'finish', reason: normalizeFinishReason(stopReason), raw: stopReason || undefined };
}

function toAnthropicMessages(messages: AgentMessage[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const content: any[] = [{ type: 'text', text: m.content }];
      if (m.images) {
        for (const image of m.images) {
          if (!image?.dataBase64) continue;
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mimeType || 'image/jpeg',
              data: image.dataBase64,
            },
          });
        }
      }
      out.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      const content: any[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      if (m.tool_calls) {
        for (const c of m.tool_calls) {
          content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
        }
      }
      out.push({ role: 'assistant', content });
    } else {
      // Tool result goes on the *user* turn for Anthropic.
      const last = out[out.length - 1];
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}

// ─── Gemini ──────────────────────────────────────────────────────────

async function* streamGeminiTools(args: {
  apiKey: string;
  model: string;
  options: AgentChatOptions;
  temperature: number;
}): AsyncGenerator<AgentStreamEvent> {
  const { apiKey, model, options, temperature } = args;

  const contents = toGeminiContents(options.messages);
  const body: any = {
    contents,
    generationConfig: { temperature },
  };
  if (options.systemPrompt) body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
  if (options.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }

  const response = await httpRequest({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
    useHttps: true,
  });

  let finishReason: string | null = null;
  let callCounter = 0;

  for await (const data of parseSSELines(response)) {
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { continue; }
    const cand = parsed?.candidates?.[0];
    if (!cand) continue;
    const parts = cand?.content?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (typeof part?.text === 'string' && part.text.length > 0) {
          yield { type: 'text_delta', delta: part.text };
        } else if (part?.functionCall) {
          const name = part.functionCall.name;
          const argsObj = part.functionCall.args && typeof part.functionCall.args === 'object'
            ? part.functionCall.args
            : {};
          if (name) {
            yield {
              type: 'tool_call',
              call: { id: `call_${callCounter++}`, name, arguments: argsObj },
            };
          }
        }
      }
    }
    if (cand.finishReason) finishReason = String(cand.finishReason);
  }

  yield { type: 'finish', reason: normalizeFinishReason(finishReason), raw: finishReason || undefined };
}

function toGeminiContents(messages: AgentMessage[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const parts: any[] = [{ text: m.content }];
      if (m.images) {
        for (const image of m.images) {
          if (!image?.dataBase64) continue;
          parts.push({
            inlineData: {
              mimeType: image.mimeType || 'image/jpeg',
              data: image.dataBase64,
            },
          });
        }
      }
      out.push({ role: 'user', parts });
    } else if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content) parts.push({ text: m.content });
      if (m.tool_calls) {
        for (const c of m.tool_calls) {
          parts.push({ functionCall: { name: c.name, args: c.arguments } });
        }
      }
      out.push({ role: 'model', parts });
    } else {
      // Tool result: stitched onto a user turn as functionResponse.
      const block = {
        functionResponse: {
          name: m.name,
          response: { content: m.content },
        },
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.parts)) {
        last.parts.push(block);
      } else {
        out.push({ role: 'user', parts: [block] });
      }
    }
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function safeParseArgs(json: string): Record<string, any> {
  const trimmed = (json || '').trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeFinishReason(raw: string | null): 'end_turn' | 'tool_calls' | 'other' {
  if (!raw) return 'other';
  const lower = raw.toLowerCase();
  if (lower === 'tool_calls' || lower === 'tool_use') return 'tool_calls';
  if (lower === 'stop' || lower === 'end_turn' || lower === 'stop_sequence') return 'end_turn';
  return 'other';
}
