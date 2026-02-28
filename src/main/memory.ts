import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { AppSettings } from './settings-store';

const DEFAULT_SUPERMEMORY_BASE_URL = 'https://api.supermemory.ai';
const DEFAULT_CLIENT_ID = 'supercmd-client';
const DEFAULT_TOP_K = 6;
const MAX_TOP_K = 20;
const MAX_MEMORY_ITEM_CHARS = 320;
const MAX_MEMORY_CONTEXT_CHARS = 2400;

// ─── Local File-Based Memory Store ──────────────────────────────────────────
// Used as a fallback when Supermemory is not configured. Persists to
// <userData>/local-memories.json so memories survive restarts.

interface LocalMemoryEntry {
  id: string;
  text: string;
  createdAt: string;
}

function getLocalMemoryPath(): string {
  return path.join(app.getPath('userData'), 'local-memories.json');
}

function readLocalMemories(): LocalMemoryEntry[] {
  try {
    const raw = fs.readFileSync(getLocalMemoryPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalMemories(memories: LocalMemoryEntry[]): void {
  try {
    fs.writeFileSync(getLocalMemoryPath(), JSON.stringify(memories, null, 2), 'utf8');
  } catch (err) {
    console.error('[LocalMemory] Failed to write memories:', err);
  }
}

function addLocalMemory(text: string): { id: string } {
  const memories = readLocalMemories();
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  memories.push({ id, text: sanitizeMemoryText(text), createdAt: new Date().toISOString() });
  writeLocalMemories(memories);
  return { id };
}

function searchLocalMemories(query: string, limit: number): LocalMemoryEntry[] {
  const memories = readLocalMemories();
  if (!query.trim()) return memories.slice(-limit).reverse();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = memories
    .map((m) => {
      const lower = m.text.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0);
      return { m, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ m }) => m);
}

// ────────────────────────────────────────────────────────────────────────────

type SupermemoryAuthMode = 'none' | 'token' | 'bearer';

export interface MemoryEntry {
  id?: string;
  text: string;
  score?: number;
  raw: any;
}

export interface AddMemoryPayload {
  text: string;
  userId?: string;
  source?: string;
  metadata?: Record<string, any>;
}

export interface AddMemoryResult {
  success: boolean;
  memoryId?: string;
  error?: string;
}

interface SupermemoryConfig {
  apiKey: string;
  clientId: string;
  baseUrl: string;
  localMode: boolean;
}

function parseEnvBoolean(input: unknown): boolean {
  const normalized = String(input || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  const input = String(rawBaseUrl || '').trim();
  if (!input) return DEFAULT_SUPERMEMORY_BASE_URL;
  if (/^https?:\/\//i.test(input)) return input.replace(/\/+$/, '');
  return `https://${input.replace(/\/+$/, '')}`;
}

function isLikelyLocalBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    const hostname = String(parsed.hostname || '').toLowerCase();
    if (!hostname) return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
    if (hostname.endsWith('.local')) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    const range172 = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
    if (range172) {
      const secondOctet = Number(range172[1]);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function resolveSupermemoryConfig(settings: AppSettings, userIdOverride?: string): SupermemoryConfig {
  const ai = settings.ai || ({} as any);
  const apiKey = String(ai.supermemoryApiKey || process.env.SUPERMEMORY_API_KEY || '').trim();
  const clientId = String(
    userIdOverride ||
      ai.supermemoryClient ||
      process.env.SUPERMEMORY_CLIENT ||
      process.env.USER ||
      process.env.USERNAME ||
      DEFAULT_CLIENT_ID
  ).trim();
  const baseUrl = normalizeBaseUrl(
    String(ai.supermemoryBaseUrl || process.env.SUPERMEMORY_BASE_URL || DEFAULT_SUPERMEMORY_BASE_URL)
  );
  const explicitLocalMode = Boolean(ai.supermemoryLocalMode);
  const envLocalMode = parseEnvBoolean(process.env.SUPERMEMORY_LOCAL);
  const inferredLocalMode = isLikelyLocalBaseUrl(baseUrl);
  const localMode = explicitLocalMode || envLocalMode || inferredLocalMode;

  return { apiKey, clientId, baseUrl, localMode };
}

function sanitizeMemoryText(input: string): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampTopK(input?: number): number {
  const value = Number(input ?? DEFAULT_TOP_K);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TOP_K;
  return Math.max(1, Math.min(MAX_TOP_K, Math.round(value)));
}

function extractMemoryId(data: any): string | undefined {
  if (!data) return undefined;
  const candidates = [
    data.id,
    data.memory_id,
    Array.isArray(data) ? data[0]?.id : undefined,
    Array.isArray(data?.results) ? data.results[0]?.id : undefined,
    Array.isArray(data?.memories) ? data.memories[0]?.id : undefined,
    Array.isArray(data?.data) ? data.data[0]?.id : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const id = String(candidate).trim();
    if (id) return id;
  }
  return undefined;
}

function pickArrayPayload(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.memories)) return data.memories;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function extractMemoryText(entry: any): string {
  if (!entry) return '';
  const candidates = [
    entry.memory,
    entry.text,
    entry.content,
    entry.value,
    entry.summary,
    entry?.memory?.content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const cleaned = sanitizeMemoryText(candidate);
    if (cleaned) return cleaned;
  }
  return '';
}

function errorMessage(error: unknown): string {
  return String((error as any)?.message || '').toLowerCase();
}

function isStatusError(error: unknown, statusCode: number): boolean {
  return errorMessage(error).includes(`http ${statusCode}`);
}

function isPathUnsupportedError(error: unknown): boolean {
  return isStatusError(error, 404) || isStatusError(error, 405) || isStatusError(error, 501);
}

function buildAuthorizationHeader(apiKey: string, authMode: SupermemoryAuthMode): string | undefined {
  if (!apiKey || authMode === 'none') return undefined;
  if (authMode === 'bearer') return `Bearer ${apiKey}`;
  return `Token ${apiKey}`;
}

function getAuthModes(config: SupermemoryConfig): SupermemoryAuthMode[] {
  if (config.localMode) {
    if (!config.apiKey) return ['none'];
    return ['none', 'token', 'bearer'];
  }
  if (!config.apiKey) return [];
  return ['token', 'bearer'];
}

function postSupermemory(
  baseUrl: string,
  path: string,
  apiKey: string,
  authMode: SupermemoryAuthMode,
  payload: Record<string, any>
): Promise<any> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(path, `${baseUrl}/`);
    } catch {
      reject(new Error('Invalid Supermemory base URL.'));
      return;
    }

    const body = JSON.stringify(payload || {});
    const useHttps = url.protocol === 'https:';
    const client = useHttps ? https : http;
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    const authorization = buildAuthorizationHeader(apiKey, authMode);
    if (authorization) headers.Authorization = authorization;

    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers,
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk: Buffer | string) => {
          responseBody += chunk.toString();
        });
        res.on('end', () => {
          const statusCode = Number(res.statusCode || 0);
          if (statusCode >= 400) {
            reject(new Error(`Supermemory HTTP ${statusCode}: ${responseBody.slice(0, 320)}`));
            return;
          }
          if (!responseBody.trim()) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(responseBody));
          } catch {
            resolve({ raw: responseBody });
          }
        });
      }
    );

    req.on('error', (error: Error) => reject(error));
    req.setTimeout(12_000, () => {
      req.destroy(new Error('Supermemory request timed out.'));
    });
    req.write(body);
    req.end();
  });
}

async function postSupermemoryWithAuthFallback(
  config: SupermemoryConfig,
  path: string,
  payload: Record<string, any>
): Promise<any> {
  const authModes = getAuthModes(config);
  if (!authModes.length) {
    throw new Error('Supermemory API key missing.');
  }

  let lastError: unknown = null;
  for (const authMode of authModes) {
    try {
      return await postSupermemory(config.baseUrl, path, config.apiKey, authMode, payload);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Supermemory request failed.');
}

async function requestSupermemoryWithPathAndPayloadFallback(
  config: SupermemoryConfig,
  paths: string[],
  payloads: Array<Record<string, any>>
): Promise<any> {
  let lastError: unknown = null;

  for (const path of paths) {
    for (const payload of payloads) {
      try {
        return await postSupermemoryWithAuthFallback(config, path, payload);
      } catch (error) {
        lastError = error;
        if (!config.localMode && !isPathUnsupportedError(error)) {
          break;
        }
      }
    }
  }

  throw lastError || new Error('Supermemory request failed.');
}

export function isSupermemoryConfigured(settings: AppSettings): boolean {
  const config = resolveSupermemoryConfig(settings);
  return Boolean(config.clientId && (config.localMode || config.apiKey));
}

/** True when any memory backend is available (Supermemory or local file fallback). */
export function isMemoryEnabled(_settings: AppSettings): boolean {
  return true;
}

export async function addMemory(
  settings: AppSettings,
  payload: AddMemoryPayload
): Promise<AddMemoryResult> {
  const text = String(payload?.text || '').trim();
  if (!text) {
    return { success: false, error: 'No text provided.' };
  }

  const config = resolveSupermemoryConfig(settings, payload?.userId);
  if (!config.clientId) {
    return {
      success: false,
      error: 'Supermemory client is missing. Set one in Settings -> AI.',
    };
  }
  if (!config.localMode && !config.apiKey) {
    // No Supermemory configured — persist to local file so memories survive restarts
    const { id } = addLocalMemory(text);
    return { success: true, memoryId: id };
  }

  const metadata = {
    source: payload?.source || 'supercmd',
    ...(payload?.metadata || {}),
  };

  // Supermemory primary ingest endpoint is /v3/documents.
  // Keep legacy fallbacks for compatibility with self-hosted/proxy backends.
  const paths = ['/v3/documents', '/v3/memories', '/v2/memories', '/v1/memories', '/memories', '/memory'];
  const payloads = [
    {
      content: text,
      containerTag: config.clientId,
      metadata,
    },
    {
      content: text,
      userId: config.clientId,
      metadata,
    },
    {
      content: text,
      containerTags: [config.clientId],
      metadata,
    },
    {
      messages: [{ role: 'user', content: text }],
      user_id: config.clientId,
      client_id: config.clientId,
      client: config.clientId,
      metadata,
      version: 'v2',
    },
    {
      messages: [{ role: 'user', content: text }],
      user_id: config.clientId,
      client_id: config.clientId,
      client: config.clientId,
      metadata,
    },
    {
      text,
      user_id: config.clientId,
      client_id: config.clientId,
      client: config.clientId,
      metadata,
    },
    {
      memory: text,
      user_id: config.clientId,
      client_id: config.clientId,
      client: config.clientId,
      metadata,
    },
  ];

  try {
    const response = await requestSupermemoryWithPathAndPayloadFallback(config, paths, payloads);
    return {
      success: true,
      memoryId: extractMemoryId(response),
    };
  } catch (error: any) {
    return {
      success: false,
      error: String(error?.message || 'Failed to add memory.'),
    };
  }
}

export async function searchMemories(
  settings: AppSettings,
  options: { query: string; limit?: number; userId?: string }
): Promise<MemoryEntry[]> {
  const query = String(options?.query || '').trim();
  if (!query) return [];

  const config = resolveSupermemoryConfig(settings, options?.userId);
  if (!config.clientId) return [];
  if (!config.localMode && !config.apiKey) {
    // No Supermemory — search local file
    const limit = clampTopK(options?.limit);
    return searchLocalMemories(query, limit).map((m) => ({ id: m.id, text: m.text, raw: m }));
  }

  const limit = clampTopK(options?.limit);
  // Supermemory memory search endpoint is /v4/search (low-latency memories),
  // with /v3/search as broader document-search fallback.
  const paths = ['/v4/search', '/v3/search', '/v2/memories/search', '/v1/memories/search', '/memories/search', '/search'];
  const payloads = [
    {
      q: query,
      containerTag: config.clientId,
      threshold: 0.6,
      limit,
    },
    {
      q: query,
      containerTags: [config.clientId],
      threshold: 0.6,
      limit,
    },
    {
      query,
      filters: {
        AND: [{ user_id: config.clientId }],
      },
      user_id: config.clientId,
      client_id: config.clientId,
      client: config.clientId,
      top_k: limit,
      version: 'v2',
    },
    {
      query,
      user_id: config.clientId,
      client_id: config.clientId,
      client: config.clientId,
      limit,
    },
    {
      query,
      user_id: config.clientId,
      client_id: config.clientId,
      client: config.clientId,
      top_k: limit,
    },
  ];

  const response = await requestSupermemoryWithPathAndPayloadFallback(config, paths, payloads);

  const entries = pickArrayPayload(response);
  const output: MemoryEntry[] = [];
  const dedupe = new Set<string>();

  for (const entry of entries) {
    const text = extractMemoryText(entry);
    if (!text) continue;
    const dedupeKey = text.toLowerCase();
    if (dedupe.has(dedupeKey)) continue;
    dedupe.add(dedupeKey);

    const score =
      typeof entry?.score === 'number' && Number.isFinite(entry.score)
        ? entry.score
        : undefined;

    output.push({
      id: entry?.id ? String(entry.id) : undefined,
      text,
      score,
      raw: entry,
    });
    if (output.length >= limit) break;
  }

  return output;
}

export async function buildMemoryContextSystemPrompt(
  settings: AppSettings,
  query: string,
  options?: { limit?: number }
): Promise<string> {
  if (!isMemoryEnabled(settings)) return '';

  let memories: MemoryEntry[] = [];
  try {
    memories = await searchMemories(settings, {
      query,
      limit: options?.limit ?? DEFAULT_TOP_K,
    });
  } catch (error) {
    console.warn('[Supermemory] search failed:', error);
    return '';
  }

  if (!memories.length) return '';

  let totalChars = 0;
  const lines: string[] = [];
  for (const memory of memories) {
    const trimmed = sanitizeMemoryText(memory.text);
    if (!trimmed) continue;
    const clipped =
      trimmed.length > MAX_MEMORY_ITEM_CHARS
        ? `${trimmed.slice(0, MAX_MEMORY_ITEM_CHARS - 3)}...`
        : trimmed;
    const projected = totalChars + clipped.length;
    if (projected > MAX_MEMORY_CONTEXT_CHARS) break;
    totalChars = projected;
    lines.push(`${lines.length + 1}. ${clipped}`);
  }

  if (!lines.length) return '';

  return [
    'You have access to relevant long-term user memory from Supermemory.',
    'Use this context only when it is directly helpful for the current request.',
    'If memory conflicts with the latest user instruction, follow the latest user instruction.',
    'Do not mention these memory notes unless the user asks.',
    '',
    'Supermemory context:',
    ...lines,
  ].join('\n');
}
