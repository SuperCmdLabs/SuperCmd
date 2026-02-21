/**
 * Chat Completion with Tools — non-streaming LLM calls that support
 * function/tool calling for OpenAI, Anthropic, Ollama, and OpenAI-compatible.
 *
 * Separate from the existing streamAI (which is text-only streaming).
 * Reuses resolveModel from ai-provider.ts.
 */

import * as http from 'http';
import * as https from 'https';
import type { AISettings } from '../settings-store';
import {
  resolveModel,
  hasProviderCredentials,
  type ModelRoute,
} from '../ai-provider';
import type { AgentMessage } from './types';
import type { ToolDefinition } from './tool-definitions';
import { toOpenAITools, toAnthropicTools } from './tool-format';

// ─── Agent-specific HTTP request ─────────────────────────────────────
// Unlike the shared httpRequest in ai-provider.ts, this one ALWAYS resolves
// with the response (even on 4xx/5xx) so our error recovery can inspect
// the response body and potentially recover tool calls.

interface AgentHttpOpts {
  hostname: string;
  port?: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  useHttps: boolean;
}

function agentHttpRequest(opts: AgentHttpOpts): Promise<http.IncomingMessage> {
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
      (res) => resolve(res) // Always resolve, even on 4xx/5xx
    );
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

// ─── Response Types ─────────────────────────────────────────────────

export interface ChatCompletionToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ChatCompletionResponse {
  text: string | null;
  toolCalls: ChatCompletionToolCall[];
}

// ─── Main Entry Point ───────────────────────────────────────────────

export async function chatCompletionWithTools(
  config: AISettings,
  systemPrompt: string,
  messages: AgentMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  options?: { autoSelectBestModel?: boolean }
): Promise<ChatCompletionResponse> {
  const route = options?.autoSelectBestModel === false
    ? resolveModel(undefined, config)
    : resolveBestAgentRoute(config);

  if (!hasProviderCredentials(route.provider, config)) {
    throw new Error(`No credentials configured for provider: ${route.provider}`);
  }

  switch (route.provider) {
    case 'openai':
      return openaiCompletion(config.openaiApiKey, route.modelId, systemPrompt, messages, tools, signal);
    case 'anthropic':
      return anthropicCompletion(config.anthropicApiKey, route.modelId, systemPrompt, messages, tools, signal);
    case 'ollama':
      return ollamaCompletion(config.ollamaBaseUrl, route.modelId, systemPrompt, messages, tools, signal);
    case 'openai-compatible':
      return openaiCompatibleCompletion(
        config.openaiCompatibleBaseUrl,
        config.openaiCompatibleApiKey,
        route.modelId,
        systemPrompt,
        messages,
        tools,
        signal
      );
    default:
      throw new Error(`Unsupported provider for agent: ${route.provider}`);
  }
}

function bestModelForProvider(
  provider: ModelRoute['provider'],
  config: AISettings
): ModelRoute {
  switch (provider) {
    case 'openai':
      return { provider: 'openai', modelId: 'gpt-4o' };
    case 'anthropic':
      return { provider: 'anthropic', modelId: 'claude-opus-4-20250514' };
    case 'openai-compatible':
      return {
        provider: 'openai-compatible',
        modelId: config.openaiCompatibleModel?.trim() || 'gpt-4o',
      };
    case 'ollama': {
      const configured = String(config.defaultModel || '').trim();
      if (configured.startsWith('ollama-')) {
        return { provider: 'ollama', modelId: configured.slice('ollama-'.length) };
      }
      return { provider: 'ollama', modelId: 'llama3.2' };
    }
    default:
      return resolveModel(undefined, config);
  }
}

function resolveBestAgentRoute(config: AISettings): ModelRoute {
  // Prefer the user-selected provider if it has credentials.
  if (hasProviderCredentials(config.provider, config)) {
    return bestModelForProvider(config.provider, config);
  }

  // Fallback across any configured provider.
  const fallbackOrder: ModelRoute['provider'][] = ['openai', 'anthropic', 'openai-compatible', 'ollama'];
  for (const provider of fallbackOrder) {
    if (hasProviderCredentials(provider, config)) {
      return bestModelForProvider(provider, config);
    }
  }

  // Final fallback to existing resolver.
  return resolveModel(undefined, config);
}

// ─── Helpers ────────────────────────────────────────────────────────

async function collectResponseBody(response: http.IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of response) {
    body += chunk.toString();
  }
  return body;
}

function convertMessages(messages: AgentMessage[]): any[] {
  return messages.map((m) => {
    const msg: any = { role: m.role, content: m.content || '' };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    if (m.name) msg.name = m.name;
    return msg;
  });
}

function safeParseJSON(str: string): Record<string, any> {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

/** Extract a clean, user-friendly error message from API response bodies. */
function parseAPIError(statusCode: number, responseBody: string): string {
  try {
    const parsed = JSON.parse(responseBody);
    const errObj = parsed.error;
    if (errObj) {
      const msg = errObj.message || errObj.msg || '';
      const code = errObj.code || errObj.type || '';
      // Special handling for common errors
      if (code === 'tool_use_failed' || msg.includes('Failed to call a function')) {
        return 'The AI model had trouble calling a tool. Retrying with adjusted parameters...';
      }
      if (code === 'rate_limit_exceeded' || statusCode === 429) {
        return 'Rate limited by the AI provider. Waiting before retrying...';
      }
      if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
        return 'API quota exceeded. Please check your API key billing.';
      }
      if (code === 'invalid_api_key' || statusCode === 401) {
        return 'Invalid API key. Please check your AI settings.';
      }
      if (code === 'model_not_found' || statusCode === 404) {
        return `Model not found. Please check your AI model setting.`;
      }
      if (code === 'context_length_exceeded') {
        return 'The conversation is too long for this model. Try starting a new conversation.';
      }
      // Generic known error
      if (msg) return msg;
    }
  } catch {
    // Not JSON
  }
  return `Request failed (HTTP ${statusCode}). Please try again.`;
}

/** Check if an error is retryable (transient). */
function isRetryableError(statusCode: number, errorBody: string): boolean {
  if (statusCode === 429 || statusCode >= 500) return true;
  try {
    const parsed = JSON.parse(errorBody);
    const code = parsed.error?.code || '';
    // tool_use_failed is handled by recovery, not retry
    if (code === 'overloaded') return true;
  } catch {}
  return false;
}

/** Wrap an async API call with retry logic. */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  baseDelayMs: number = 2000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      if (attempt < maxRetries && e._retryable) {
        // Rate limits need much longer waits (5s, 10s, ...)
        const isRateLimit = e._statusCode === 429;
        const delay = isRateLimit
          ? 5000 * (attempt + 1)     // 5s, 10s for rate limits
          : baseDelayMs * (attempt + 1); // 2s, 4s for other errors
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

/**
 * Infer the correct argument key for a tool based on what it expects.
 * When models output {"/some/path"} we need to know the parameter name.
 */
const TOOL_PRIMARY_ARG: Record<string, string> = {
  exec_command: 'command',
  run_applescript: 'script',
  read_file: 'path',
  write_file: 'path',
  create_directory: 'path',
  copy_path: 'source',
  move_path: 'source',
  rename_path: 'path',
  delete_path: 'path',
  read_dir: 'path',
  path_info: 'path',
  find_paths: 'path',
  search_file_content: 'path',
  replace_in_file: 'path',
  top_largest_entries: 'path',
  clipboard_write: 'text',
  http_request: 'url',
  memory_search: 'query',
  memory_add: 'text',
};

/**
 * Parse text-format tool calls from failed_generation.
 * Models like Llama output: <function=tool_name>{"arg":"val"}</function>
 * or: <function=tool_name>{"arg":"val"}<function=tool_name2>{"arg":"val2"}
 * Some also output: <function=tool_name>{"/just/a/path"}
 * The API rejects these but we can recover by parsing them ourselves.
 */
function parseFailedGeneration(failedGen: string): ChatCompletionToolCall[] | null {
  const calls: ChatCompletionToolCall[] = [];
  // Match <function=name>{...} patterns (with or without closing tag)
  const pattern = /<function=(\w+)>\s*(\{[^<]*\})/g;
  let match;
  while ((match = pattern.exec(failedGen)) !== null) {
    const name = match[1];
    const argsStr = match[2].trim();
    let args = safeParseJSON(argsStr);

    // If JSON parse gave empty object, the model might have output {"value"} or {"/path"}
    // Try to extract the raw value and map it to the tool's primary parameter
    if (Object.keys(args).length === 0 && argsStr.length > 2) {
      const inner = argsStr.slice(1, -1).trim(); // strip { }
      const primaryKey = TOOL_PRIMARY_ARG[name];
      if (primaryKey && inner) {
        // Remove surrounding quotes if present
        const cleanVal = inner.replace(/^["']|["']$/g, '');
        args = { [primaryKey]: cleanVal };
      }
    }

    if (name && Object.keys(args).length > 0) {
      calls.push({
        id: `recovered-tc-${Date.now()}-${calls.length}`,
        name,
        args,
      });
    }
  }
  return calls.length > 0 ? calls : null;
}

/** Parse response, check for HTTP errors, and throw clean messages. */
async function parseResponseOrThrow(response: http.IncomingMessage): Promise<string> {
  const responseBody = await collectResponseBody(response);
  const statusCode = response.statusCode || 0;
  if (statusCode >= 400) {
    const cleanMessage = parseAPIError(statusCode, responseBody);
    const err: any = new Error(cleanMessage);
    err._retryable = isRetryableError(statusCode, responseBody);
    err._statusCode = statusCode;
    err._responseBody = responseBody;
    throw err;
  }
  return responseBody;
}

/**
 * Try to recover tool calls from a tool_use_failed error.
 * Returns a ChatCompletionResponse if recovery is possible, null otherwise.
 */
function tryRecoverFromToolUseFailure(err: any): ChatCompletionResponse | null {
  if (!err._responseBody) return null;
  try {
    const parsed = JSON.parse(err._responseBody);
    const code = parsed.error?.code || '';
    const failedGen = parsed.error?.failed_generation || '';
    if (code === 'tool_use_failed' && failedGen) {
      const recovered = parseFailedGeneration(failedGen);
      if (recovered && recovered.length > 0) {
        // Only return the first tool call to avoid overwhelming the model
        return {
          text: null,
          toolCalls: [recovered[0]],
        };
      }
    }
  } catch {}
  return null;
}

// ─── OpenAI ─────────────────────────────────────────────────────────

async function openaiCompletion(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AgentMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal
): Promise<ChatCompletionResponse> {
  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...convertMessages(messages),
  ];

  const body: any = {
    model,
    messages: allMessages,
    temperature: 0.7,
    parallel_tool_calls: false,
  };
  if (tools.length > 0) {
    body.tools = toOpenAITools(tools);
  }

  return withRetry(async () => {
    try {
      const response = await agentHttpRequest({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
        useHttps: true,
      });

      const responseBody = await parseResponseOrThrow(response);
      const parsed = JSON.parse(responseBody);
      const choice = parsed.choices?.[0]?.message;

      if (!choice) {
        throw new Error('Empty response from OpenAI');
      }

      const toolCalls: ChatCompletionToolCall[] = (choice.tool_calls || []).map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        args: safeParseJSON(tc.function.arguments),
      }));

      return {
        text: choice.content || null,
        toolCalls,
      };
    } catch (e: any) {
      const recovered = tryRecoverFromToolUseFailure(e);
      if (recovered) return recovered;
      throw e;
    }
  });
}

// ─── OpenAI-Compatible ──────────────────────────────────────────────

async function openaiCompatibleCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AgentMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal
): Promise<ChatCompletionResponse> {
  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...convertMessages(messages),
  ];

  const body: any = {
    model,
    messages: allMessages,
    temperature: 0.7,
    parallel_tool_calls: false,
  };
  if (tools.length > 0) {
    body.tools = toOpenAITools(tools);
  }

  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const parsedUrl = new URL(cleanUrl);
  const isHttps = parsedUrl.protocol === 'https:';

  return withRetry(async () => {
    try {
      const response = await agentHttpRequest({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : undefined,
        path: `${parsedUrl.pathname.replace(/\/+$/, '')}/chat/completions`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
        useHttps: isHttps,
      });

      const responseBody = await parseResponseOrThrow(response);
      const parsed = JSON.parse(responseBody);
      const choice = parsed.choices?.[0]?.message;

      if (!choice) {
        throw new Error('Empty response from AI provider');
      }

      const toolCalls: ChatCompletionToolCall[] = (choice.tool_calls || []).map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        args: safeParseJSON(tc.function.arguments),
      }));

      return {
        text: choice.content || null,
        toolCalls,
      };
    } catch (e: any) {
      // Try to recover tool calls from failed_generation
      const recovered = tryRecoverFromToolUseFailure(e);
      if (recovered) return recovered;
      throw e;
    }
  });
}

// ─── Anthropic ──────────────────────────────────────────────────────

function convertMessagesForAnthropic(messages: AgentMessage[]): any[] {
  const result: any[] = [];

  for (const m of messages) {
    if (m.role === 'system') continue; // system is separate in Anthropic API

    if (m.role === 'assistant' && m.tool_calls?.length) {
      // Anthropic uses content blocks for tool use
      const content: any[] = [];
      if (m.content) {
        content.push({ type: 'text', text: m.content });
      }
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: safeParseJSON(tc.function.arguments),
        });
      }
      result.push({ role: 'assistant', content });
    } else if (m.role === 'tool') {
      // Anthropic expects tool results in a user message with tool_result content blocks
      // Group consecutive tool messages
      const lastMsg = result[result.length - 1];
      const toolResult = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: m.content || '',
      };
      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content) && lastMsg.content[0]?.type === 'tool_result') {
        lastMsg.content.push(toolResult);
      } else {
        result.push({ role: 'user', content: [toolResult] });
      }
    } else {
      result.push({ role: m.role, content: m.content || '' });
    }
  }

  return result;
}

async function anthropicCompletion(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AgentMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal
): Promise<ChatCompletionResponse> {
  const body: any = {
    model,
    max_tokens: 4096,
    messages: convertMessagesForAnthropic(messages),
    temperature: 0.7,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (tools.length > 0) {
    body.tools = toAnthropicTools(tools);
  }

  return withRetry(async () => {
    const response = await agentHttpRequest({
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

    const responseBody = await parseResponseOrThrow(response);
    const parsed = JSON.parse(responseBody);

    if (parsed.error) {
      const msg = parsed.error.message || 'Unknown error from Anthropic';
      const err: any = new Error(msg);
      err._retryable = parsed.error.type === 'overloaded_error';
      throw err;
    }

    // Parse content blocks
    let text: string | null = null;
    const toolCalls: ChatCompletionToolCall[] = [];

    for (const block of parsed.content || []) {
      if (block.type === 'text') {
        text = (text || '') + block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: block.input || {},
        });
      }
    }

    return { text, toolCalls };
  });
}

// ─── Ollama ─────────────────────────────────────────────────────────

async function ollamaCompletion(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: AgentMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal
): Promise<ChatCompletionResponse> {
  // Ollama supports OpenAI-compatible chat completions with tools
  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...convertMessages(messages),
  ];

  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const parsedUrl = new URL(cleanUrl);
  const isHttps = parsedUrl.protocol === 'https:';

  const body: any = {
    model,
    messages: allMessages,
    stream: false,
  };
  if (tools.length > 0) {
    body.tools = toOpenAITools(tools);
  }

  return withRetry(async () => {
    try {
      const response = await agentHttpRequest({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : undefined,
        path: `${parsedUrl.pathname.replace(/\/+$/, '')}/api/chat`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
        useHttps: isHttps,
      });

      const responseBody = await parseResponseOrThrow(response);
      const parsed = JSON.parse(responseBody);

      const message = parsed.message;
      if (!message) {
        throw new Error('Empty response from Ollama');
      }

      const toolCalls: ChatCompletionToolCall[] = (message.tool_calls || []).map((tc: any, i: number) => ({
        id: `ollama-tc-${Date.now()}-${i}`,
        name: tc.function?.name || '',
        args: tc.function?.arguments || {},
      }));

      return {
        text: message.content || null,
        toolCalls,
      };
    } catch (e: any) {
      const recovered = tryRecoverFromToolUseFailure(e);
      if (recovered) return recovered;
      throw e;
    }
  });
}
