import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AISettings } from '../settings-store';

type RequestHandler = (ctx: {
  opts: any;
  req: any;
  body: Buffer;
  callback: (res: any) => void;
}) => void;

const netMocks = vi.hoisted(() => {
  const calls: Array<{ protocol: 'http' | 'https'; opts: any; req: any; body: Buffer }> = [];
  let httpHandler: RequestHandler | null = null;
  let httpsHandler: RequestHandler | null = null;

  const makeRequest = (protocol: 'http' | 'https') => (opts: any, callback: (res: any) => void) => {
    const req = new EventEmitter() as any;
    const chunks: Buffer[] = [];
    const call = { protocol, opts, req, body: Buffer.alloc(0) };
    calls.push(call);

    req.write = (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    };

    req.end = () => {
      const body = Buffer.concat(chunks);
      call.body = body;
      const handler = protocol === 'https' ? httpsHandler : httpHandler;
      if (handler) {
        handler({ opts, req, body, callback });
        return;
      }
      const res = Readable.from([]) as any;
      res.statusCode = 200;
      callback(res);
    };

    req.destroy = vi.fn();

    return req;
  };

  return {
    setHttpHandler(handler: RequestHandler | null) {
      httpHandler = handler;
    },
    setHttpsHandler(handler: RequestHandler | null) {
      httpsHandler = handler;
    },
    getCalls() {
      return calls;
    },
    reset() {
      calls.length = 0;
      httpHandler = null;
      httpsHandler = null;
    },
    httpRequest: vi.fn(makeRequest('http')),
    httpsRequest: vi.fn(makeRequest('https')),
  };
});

vi.mock('http', () => ({
  request: netMocks.httpRequest,
}));

vi.mock('https', () => ({
  request: netMocks.httpsRequest,
}));

function cfg(overrides: Partial<AISettings> = {}): AISettings {
  return {
    provider: 'openai',
    enabled: true,
    openaiApiKey: 'openai-key',
    anthropicApiKey: '',
    elevenlabsApiKey: '',
    supermemoryApiKey: '',
    supermemoryClient: '',
    supermemoryBaseUrl: '',
    supermemoryLocalMode: false,
    ollamaBaseUrl: 'http://localhost:11434',
    defaultModel: '',
    speechCorrectionModel: '',
    speechToTextModel: 'native',
    speechLanguage: 'en-US',
    textToSpeechModel: 'edge-tts',
    edgeTtsVoice: '',
    speechCorrectionEnabled: true,
    openaiCompatibleBaseUrl: 'http://localhost:1234/v1',
    openaiCompatibleApiKey: 'compatible-key',
    openaiCompatibleModel: 'local-model',
    ...overrides,
  };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

async function loadAI() {
  return import('../ai-provider');
}

beforeEach(() => {
  netMocks.reset();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('streamAI provider dispatch (mocked network)', () => {
  it('routes openai requests through https and parses SSE', async () => {
    const ai = await loadAI();

    netMocks.setHttpsHandler(({ callback }) => {
      const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello' } }] })}\n\n`;
      const done = 'data: [DONE]\n\n';
      const res = Readable.from([payload, done]) as any;
      res.statusCode = 200;
      callback(res);
    });

    const chunks = await collect(ai.streamAI(cfg({ provider: 'openai' }), { prompt: 'hi' }));
    expect(chunks).toEqual(['hello']);

    const [call] = netMocks.getCalls();
    expect(call.protocol).toBe('https');
    expect(call.opts.hostname).toBe('api.openai.com');
    expect(call.opts.path).toBe('/v1/chat/completions');
  });

  it('routes openai-compatible http base URL through http module', async () => {
    const ai = await loadAI();

    netMocks.setHttpHandler(({ callback }) => {
      const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: 'compat' } }] })}\n\n`;
      const done = 'data: [DONE]\n\n';
      const res = Readable.from([payload, done]) as any;
      res.statusCode = 200;
      callback(res);
    });

    const chunks = await collect(ai.streamAI(
      cfg({
        provider: 'openai-compatible',
        openaiCompatibleBaseUrl: 'http://localhost:8080/custom',
      }),
      { prompt: 'hi', model: 'openai-compatible-local-test-model' }
    ));

    expect(chunks).toEqual(['compat']);

    const [call] = netMocks.getCalls();
    expect(call.protocol).toBe('http');
    expect(call.opts.hostname).toBe('localhost');
    expect(call.opts.port).toBe(8080);
    expect(call.opts.path).toBe('/custom/v1/chat/completions');
  });

  it('routes ollama through NDJSON parser', async () => {
    const ai = await loadAI();

    netMocks.setHttpHandler(({ callback }) => {
      const res = Readable.from([
        `${JSON.stringify({ response: 'ol' })}\n`,
        `${JSON.stringify({ response: 'lama' })}\n`,
      ]) as any;
      res.statusCode = 200;
      callback(res);
    });

    const chunks = await collect(ai.streamAI(cfg({ provider: 'ollama' }), { prompt: 'hi' }));
    expect(chunks).toEqual(['ol', 'lama']);

    const [call] = netMocks.getCalls();
    expect(call.protocol).toBe('http');
    expect(call.opts.path).toBe('/api/generate');
  });

  it('propagates HTTP >=400 response body errors from streamAI', async () => {
    const ai = await loadAI();

    netMocks.setHttpsHandler(({ callback }) => {
      const res = new EventEmitter() as any;
      res.statusCode = 401;
      callback(res);
      res.emit('data', 'invalid api key provided');
      res.emit('end');
    });

    const stream = ai.streamAI(cfg({ provider: 'openai' }), { prompt: 'hi' });
    await expect(stream.next()).rejects.toThrow('HTTP 401: invalid api key provided');
  });
});

describe('transcribeAudio (mocked network)', () => {
  it('sends multipart request and returns transcription text', async () => {
    const ai = await loadAI();

    netMocks.setHttpsHandler(({ callback }) => {
      const res = Readable.from(['transcribed text']) as any;
      res.statusCode = 200;
      callback(res);
    });

    const out = await ai.transcribeAudio({
      audioBuffer: Buffer.from('abc123', 'utf-8'),
      apiKey: 'openai-key',
      model: 'whisper-1',
      language: 'en',
      mimeType: 'audio/wav',
    });

    expect(out).toBe('transcribed text');

    const [call] = netMocks.getCalls();
    expect(call.protocol).toBe('https');
    expect(call.opts.hostname).toBe('api.openai.com');
    expect(call.opts.path).toBe('/v1/audio/transcriptions');

    const body = call.body.toString('utf-8');
    expect(body).toContain('name="model"');
    expect(body).toContain('whisper-1');
    expect(body).toContain('name="language"');
    expect(body).toContain('name="file"; filename="audio.wav"');
  });

  it('rejects immediately when transcription signal is already aborted', async () => {
    const ai = await loadAI();

    netMocks.setHttpsHandler(() => {
      throw new Error('Handler should not run for pre-aborted signal');
    });

    const controller = new AbortController();
    controller.abort();

    await expect(ai.transcribeAudio({
      audioBuffer: Buffer.from('abc123', 'utf-8'),
      apiKey: 'openai-key',
      model: 'whisper-1',
      signal: controller.signal,
    })).rejects.toThrow('Transcription aborted');

    const [call] = netMocks.getCalls();
    expect(call.req.destroy).toHaveBeenCalled();
  });
});
