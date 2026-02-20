/**
 * ai-provider.test.ts
 *
 * Unit tests for the critical paths in ai-provider.ts:
 *  - isAIAvailable       — determines whether AI features are active
 *  - resolveModel        — routes model key/prefix to provider + modelId
 *  - resolveCompatibleChatUrl — normalises OpenAI-compatible base URLs
 *  - parseSSE            — parses streaming SSE payloads
 *  - parseNDJSON         — parses streaming NDJSON payloads (Ollama)
 *  - resolveUploadMeta   — maps MIME types to upload filenames/content-types
 */

import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import type { AISettings } from '../settings-store';

import {
  isAIAvailable,
  resolveModel,
  resolveCompatibleChatUrl,
  parseSSE,
  parseNDJSON,
  resolveUploadMeta,
} from '../ai-provider';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Build a minimal AISettings object, overriding only the fields you care about. */
function cfg(overrides: Partial<AISettings> = {}): AISettings {
  return {
    provider: 'openai',
    enabled: true,
    openaiApiKey: '',
    anthropicApiKey: '',
    elevenlabsApiKey: '',
    supermemoryApiKey: '',
    supermemoryClient: '',
    supermemoryBaseUrl: '',
    supermemoryLocalMode: false,
    ollamaBaseUrl: '',
    defaultModel: '',
    speechCorrectionModel: '',
    speechToTextModel: 'native',
    speechLanguage: 'en-US',
    textToSpeechModel: 'edge-tts',
    edgeTtsVoice: '',
    speechCorrectionEnabled: true,
    openaiCompatibleBaseUrl: '',
    openaiCompatibleApiKey: '',
    openaiCompatibleModel: '',
    ...overrides,
  };
}

/** Collect all yielded values from an async generator. */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

/**
 * Build a mock readable stream from raw string chunks.
 * parseSSE / parseNDJSON only do `for await...of` on the response,
 * so any async iterable (including Readable) satisfies the contract.
 */
function makeStream(chunks: string[]): NodeJS.ReadableStream {
  return Readable.from(chunks);
}

// ─── isAIAvailable ───────────────────────────────────────────────────

describe('isAIAvailable', () => {
  it('returns false when AI is disabled, regardless of credentials', () => {
    expect(isAIAvailable(cfg({ enabled: false, provider: 'openai', openaiApiKey: 'sk-abc' }))).toBe(false);
    expect(isAIAvailable(cfg({ enabled: false, provider: 'anthropic', anthropicApiKey: 'sk-ant-abc' }))).toBe(false);
  });

  describe('openai provider', () => {
    it('returns true when api key is present', () => {
      expect(isAIAvailable(cfg({ provider: 'openai', openaiApiKey: 'sk-abc' }))).toBe(true);
    });
    it('returns false when api key is empty', () => {
      expect(isAIAvailable(cfg({ provider: 'openai', openaiApiKey: '' }))).toBe(false);
    });
  });

  describe('anthropic provider', () => {
    it('returns true when api key is present', () => {
      expect(isAIAvailable(cfg({ provider: 'anthropic', anthropicApiKey: 'sk-ant-abc' }))).toBe(true);
    });
    it('returns false when api key is empty', () => {
      expect(isAIAvailable(cfg({ provider: 'anthropic', anthropicApiKey: '' }))).toBe(false);
    });
  });

  describe('ollama provider', () => {
    it('returns true when base URL is present', () => {
      expect(isAIAvailable(cfg({ provider: 'ollama', ollamaBaseUrl: 'http://localhost:11434' }))).toBe(true);
    });
    it('returns false when base URL is empty', () => {
      expect(isAIAvailable(cfg({ provider: 'ollama', ollamaBaseUrl: '' }))).toBe(false);
    });
  });

  describe('openai-compatible provider', () => {
    it('returns true when both baseUrl and apiKey are present', () => {
      expect(isAIAvailable(cfg({
        provider: 'openai-compatible',
        openaiCompatibleBaseUrl: 'https://api.groq.com/openai/v1',
        openaiCompatibleApiKey: 'gsk-abc',
      }))).toBe(true);
    });
    it('returns false when only baseUrl is present', () => {
      expect(isAIAvailable(cfg({
        provider: 'openai-compatible',
        openaiCompatibleBaseUrl: 'https://api.groq.com/openai/v1',
        openaiCompatibleApiKey: '',
      }))).toBe(false);
    });
    it('returns false when only apiKey is present', () => {
      expect(isAIAvailable(cfg({
        provider: 'openai-compatible',
        openaiCompatibleBaseUrl: '',
        openaiCompatibleApiKey: 'gsk-abc',
      }))).toBe(false);
    });
    it('returns false when both are empty', () => {
      expect(isAIAvailable(cfg({ provider: 'openai-compatible' }))).toBe(false);
    });
  });
});

// ─── resolveModel ────────────────────────────────────────────────────

describe('resolveModel', () => {
  describe('known model table keys', () => {
    it('routes openai-gpt-4o correctly', () => {
      expect(resolveModel('openai-gpt-4o', cfg())).toEqual({ provider: 'openai', modelId: 'gpt-4o' });
    });
    it('routes openai-gpt-4o-mini correctly', () => {
      expect(resolveModel('openai-gpt-4o-mini', cfg())).toEqual({ provider: 'openai', modelId: 'gpt-4o-mini' });
    });
    it('routes anthropic-claude-haiku correctly', () => {
      expect(resolveModel('anthropic-claude-haiku', cfg())).toEqual({
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5-20251001',
      });
    });
    it('routes anthropic-claude-sonnet correctly', () => {
      expect(resolveModel('anthropic-claude-sonnet', cfg())).toEqual({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
      });
    });
    it('routes ollama-llama3 correctly', () => {
      expect(resolveModel('ollama-llama3', cfg())).toEqual({ provider: 'ollama', modelId: 'llama3' });
    });
  });

  describe('prefix stripping for unknown model strings', () => {
    it('strips openai- prefix for unknown openai models', () => {
      expect(resolveModel('openai-gpt-5', cfg())).toEqual({ provider: 'openai', modelId: 'gpt-5' });
    });
    it('strips anthropic- prefix for unknown anthropic models', () => {
      expect(resolveModel('anthropic-claude-opus-4', cfg())).toEqual({
        provider: 'anthropic',
        modelId: 'claude-opus-4',
      });
    });
    it('strips ollama- prefix for dynamic ollama models like llama3.2', () => {
      expect(resolveModel('ollama-llama3.2', cfg())).toEqual({ provider: 'ollama', modelId: 'llama3.2' });
    });
    it('strips openai-compatible- prefix correctly', () => {
      expect(resolveModel('openai-compatible-llama-3.1-8b-instant', cfg({ provider: 'openai-compatible' }))).toEqual({
        provider: 'openai-compatible',
        modelId: 'llama-3.1-8b-instant',
      });
    });
    it('openai-compatible- prefix is matched before openai- (order matters)', () => {
      // A model like "openai-compatible-openai-thing" must route to openai-compatible, not openai
      const result = resolveModel('openai-compatible-openai-thing', cfg({ provider: 'openai-compatible' }));
      expect(result.provider).toBe('openai-compatible');
      expect(result.modelId).toBe('openai-thing');
    });
  });

  describe('fallback to defaultModel', () => {
    it('uses known defaultModel from table when no model arg given', () => {
      expect(resolveModel(undefined, cfg({ defaultModel: 'openai-gpt-4o' }))).toEqual({
        provider: 'openai',
        modelId: 'gpt-4o',
      });
    });
    it('strips prefix from dynamic defaultModel like ollama-llama3.2', () => {
      expect(resolveModel(undefined, cfg({ defaultModel: 'ollama-llama3.2' }))).toEqual({
        provider: 'ollama',
        modelId: 'llama3.2',
      });
    });
    it('strips openai-compatible- prefix from defaultModel', () => {
      expect(resolveModel(undefined, cfg({
        provider: 'openai-compatible',
        defaultModel: 'openai-compatible-mixtral-8x7b',
      }))).toEqual({ provider: 'openai-compatible', modelId: 'mixtral-8x7b' });
    });
  });

  describe('provider defaults when no model at all', () => {
    it('defaults openai provider to gpt-4o-mini', () => {
      expect(resolveModel(undefined, cfg({ provider: 'openai' }))).toEqual({
        provider: 'openai',
        modelId: 'gpt-4o-mini',
      });
    });
    it('defaults anthropic provider to claude-haiku', () => {
      expect(resolveModel(undefined, cfg({ provider: 'anthropic' }))).toEqual({
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5-20251001',
      });
    });
    it('defaults ollama provider to llama3', () => {
      expect(resolveModel(undefined, cfg({ provider: 'ollama' }))).toEqual({
        provider: 'ollama',
        modelId: 'llama3',
      });
    });
    it('defaults openai-compatible to openaiCompatibleModel setting when set', () => {
      expect(resolveModel(undefined, cfg({
        provider: 'openai-compatible',
        openaiCompatibleModel: 'my-custom-model',
      }))).toEqual({ provider: 'openai-compatible', modelId: 'my-custom-model' });
    });
    it('defaults openai-compatible to gpt-4o when openaiCompatibleModel is empty', () => {
      expect(resolveModel(undefined, cfg({
        provider: 'openai-compatible',
        openaiCompatibleModel: '',
      }))).toEqual({ provider: 'openai-compatible', modelId: 'gpt-4o' });
    });
  });

  it('uses configured provider when model has no known prefix', () => {
    expect(resolveModel('custom-model-x', cfg({ provider: 'anthropic' }))).toEqual({
      provider: 'anthropic',
      modelId: 'custom-model-x',
    });
  });
});

// ─── resolveCompatibleChatUrl ─────────────────────────────────────────

describe('resolveCompatibleChatUrl', () => {
  it('appends /chat/completions when base URL already ends with /v1', () => {
    expect(resolveCompatibleChatUrl('https://api.groq.com/openai/v1'))
      .toBe('https://api.groq.com/openai/v1/chat/completions');
  });
  it('strips trailing slash then appends /chat/completions for /v1 base', () => {
    expect(resolveCompatibleChatUrl('https://api.groq.com/openai/v1/'))
      .toBe('https://api.groq.com/openai/v1/chat/completions');
  });
  it('inserts /v1 when base URL has no /v1 suffix', () => {
    expect(resolveCompatibleChatUrl('https://api.together.xyz'))
      .toBe('https://api.together.xyz/v1/chat/completions');
  });
  it('handles openrouter style URL correctly', () => {
    expect(resolveCompatibleChatUrl('https://openrouter.ai/api/v1'))
      .toBe('https://openrouter.ai/api/v1/chat/completions');
  });
  it('handles localhost with port and no /v1', () => {
    expect(resolveCompatibleChatUrl('http://localhost:11434'))
      .toBe('http://localhost:11434/v1/chat/completions');
  });
  it('does not double-insert /v1 when already present', () => {
    const result = resolveCompatibleChatUrl('https://api.groq.com/openai/v1');
    expect(result).not.toContain('/v1/v1');
  });
  it('preserves custom path and appends /v1/chat/completions', () => {
    expect(resolveCompatibleChatUrl('https://api.example.com/custom/path'))
      .toBe('https://api.example.com/custom/path/v1/chat/completions');
  });
  it('handles custom path already ending with /v1', () => {
    expect(resolveCompatibleChatUrl('https://api.example.com/custom/path/v1/'))
      .toBe('https://api.example.com/custom/path/v1/chat/completions');
  });
});

// ─── parseSSE ────────────────────────────────────────────────────────

describe('parseSSE', () => {
  const openaiExtract = (data: string): string | null => {
    if (data === '[DONE]') return null;
    try {
      const p = JSON.parse(data);
      return p.choices?.[0]?.delta?.content || null;
    } catch { return null; }
  };

  it('yields text from a single well-formed SSE chunk', async () => {
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello' } }] })}\n\n`;
    const stream = makeStream([payload]) as any;
    expect(await collect(parseSSE(stream, openaiExtract))).toEqual(['hello']);
  });

  it('yields nothing for [DONE] sentinel', async () => {
    const stream = makeStream(['data: [DONE]\n\n']) as any;
    expect(await collect(parseSSE(stream, openaiExtract))).toEqual([]);
  });

  it('handles multiple data lines in one chunk', async () => {
    const line = (text: string) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`;
    const payload = [line('foo'), line('bar'), 'data: [DONE]', ''].join('\n');
    const stream = makeStream([payload]) as any;
    expect(await collect(parseSSE(stream, openaiExtract))).toEqual(['foo', 'bar']);
  });

  it('reassembles a line split across two raw chunks', async () => {
    const full = JSON.stringify({ choices: [{ delta: { content: 'split' } }] });
    // Split the SSE line mid-payload between two network chunks
    const half = Math.floor(full.length / 2);
    const chunk1 = `data: ${full.slice(0, half)}`;
    const chunk2 = `${full.slice(half)}\n\n`;
    const stream = makeStream([chunk1, chunk2]) as any;
    expect(await collect(parseSSE(stream, openaiExtract))).toEqual(['split']);
  });

  it('skips empty lines and non-data lines', async () => {
    const payload = '\n: comment\nevent: ping\ndata: [DONE]\n\n';
    const stream = makeStream([payload]) as any;
    expect(await collect(parseSSE(stream, openaiExtract))).toEqual([]);
  });

  it('skips malformed JSON without throwing', async () => {
    const stream = makeStream(['data: {not json}\n\n']) as any;
    expect(await collect(parseSSE(stream, openaiExtract))).toEqual([]);
  });

  it('processes remaining buffer after stream ends', async () => {
    // No trailing newline — the last line stays in the buffer until stream ends
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: 'tail' } }] })}`;
    const stream = makeStream([payload]) as any;
    expect(await collect(parseSSE(stream, openaiExtract))).toEqual(['tail']);
  });

  it('handles CRLF lines and mixed event metadata', async () => {
    const payload = [
      'event: message\r\n',
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'crlf' } }] })}\r\n`,
      ': keepalive\r\n',
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\r\n`,
      '\r\n',
    ].join('');
    const stream = makeStream([payload]) as any;
    expect(await collect(parseSSE(stream, openaiExtract))).toEqual(['crlf', 'ok']);
  });
});

// ─── parseNDJSON ──────────────────────────────────────────────────────

describe('parseNDJSON', () => {
  const ollamaExtract = (obj: any): string | null => obj.response || null;

  it('yields text from a single NDJSON line', async () => {
    const stream = makeStream([JSON.stringify({ response: 'hi' }) + '\n']) as any;
    expect(await collect(parseNDJSON(stream, ollamaExtract))).toEqual(['hi']);
  });

  it('yields text from multiple NDJSON lines in one chunk', async () => {
    const payload = [
      JSON.stringify({ response: 'a' }),
      JSON.stringify({ response: 'b' }),
      JSON.stringify({ done: true }),
    ].join('\n') + '\n';
    const stream = makeStream([payload]) as any;
    expect(await collect(parseNDJSON(stream, ollamaExtract))).toEqual(['a', 'b']);
  });

  it('skips malformed JSON lines without throwing', async () => {
    const payload = '{bad json}\n' + JSON.stringify({ response: 'ok' }) + '\n';
    const stream = makeStream([payload]) as any;
    expect(await collect(parseNDJSON(stream, ollamaExtract))).toEqual(['ok']);
  });

  it('processes remaining buffer when stream ends without trailing newline', async () => {
    const stream = makeStream([JSON.stringify({ response: 'last' })]) as any;
    expect(await collect(parseNDJSON(stream, ollamaExtract))).toEqual(['last']);
  });

  it('reassembles a line split across two chunks', async () => {
    const full = JSON.stringify({ response: 'reassembled' });
    const half = Math.floor(full.length / 2);
    const stream = makeStream([full.slice(0, half), full.slice(half) + '\n']) as any;
    expect(await collect(parseNDJSON(stream, ollamaExtract))).toEqual(['reassembled']);
  });

  it('handles mixed valid and invalid lines with trailing buffer', async () => {
    const payloadA = `${JSON.stringify({ response: 'a' })}\n{bad json}\n`;
    const payloadB = `${JSON.stringify({ response: 'tail' })}`;
    const stream = makeStream([payloadA, payloadB]) as any;
    expect(await collect(parseNDJSON(stream, ollamaExtract))).toEqual(['a', 'tail']);
  });
});

// ─── resolveUploadMeta ────────────────────────────────────────────────

describe('resolveUploadMeta', () => {
  it('maps audio/wav to audio.wav', () => {
    expect(resolveUploadMeta('audio/wav')).toEqual({ filename: 'audio.wav', contentType: 'audio/wav' });
  });
  it('maps audio/mpeg to audio.mp3', () => {
    expect(resolveUploadMeta('audio/mpeg')).toEqual({ filename: 'audio.mp3', contentType: 'audio/mpeg' });
  });
  it('maps audio/mp3 to audio.mp3', () => {
    expect(resolveUploadMeta('audio/mp3')).toEqual({ filename: 'audio.mp3', contentType: 'audio/mpeg' });
  });
  it('maps audio/mp4 to audio.m4a', () => {
    expect(resolveUploadMeta('audio/mp4')).toEqual({ filename: 'audio.m4a', contentType: 'audio/mp4' });
  });
  it('maps audio/ogg to audio.ogg', () => {
    expect(resolveUploadMeta('audio/ogg')).toEqual({ filename: 'audio.ogg', contentType: 'audio/ogg' });
  });
  it('maps audio/flac to audio.flac', () => {
    expect(resolveUploadMeta('audio/flac')).toEqual({ filename: 'audio.flac', contentType: 'audio/flac' });
  });
  it('defaults to audio.webm for unknown type', () => {
    expect(resolveUploadMeta('audio/unknown')).toEqual({ filename: 'audio.webm', contentType: 'audio/webm' });
  });
  it('defaults to audio.webm when mimeType is undefined', () => {
    expect(resolveUploadMeta(undefined)).toEqual({ filename: 'audio.webm', contentType: 'audio/webm' });
  });
  it('defaults to audio.webm when mimeType is empty string', () => {
    expect(resolveUploadMeta('')).toEqual({ filename: 'audio.webm', contentType: 'audio/webm' });
  });
  it('handles uppercase mime types', () => {
    expect(resolveUploadMeta('AUDIO/WAV')).toEqual({ filename: 'audio.wav', contentType: 'audio/wav' });
  });
  it('maps m4a-like types to audio.m4a', () => {
    expect(resolveUploadMeta('audio/x-m4a')).toEqual({ filename: 'audio.m4a', contentType: 'audio/mp4' });
  });
  it('matches mp3 substring in nonstandard mime type', () => {
    expect(resolveUploadMeta('application/octet-stream; codec=mp3')).toEqual({
      filename: 'audio.mp3',
      contentType: 'audio/mpeg',
    });
  });
});
