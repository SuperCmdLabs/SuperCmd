#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);
const mainSource = fs.readFileSync(path.resolve('src/main/main.ts'), 'utf8');
const providerSource = extractSourceBetween(
  mainSource,
  'type BufferedRequestPart = Buffer;',
  'function fetchElevenLabsVoices',
);

test('ElevenLabs STT streams multipart upload parts without a full body concat', async (t) => {
  const audioBuffer = Buffer.alloc(6 * 1024 * 1024, 0x65);
  const https = createFakeHttps({ responseChunks: [Buffer.from('{"text":"  eleven transcript  "}')] });
  const { transcribeAudioWithElevenLabs } = await loadMainMediaProviders({ https });

  const { result, concatCalls } = await instrumentBufferConcat(() => transcribeAudioWithElevenLabs({
    audioBuffer,
    apiKey: 'eleven-key',
    model: 'scribe_v1',
    language: 'en',
    mimeType: 'audio/wav',
  }));

  assert.equal(result, 'eleven transcript');
  assert.equal(https.requests.length, 1);

  const req = https.requests[0];
  const boundary = extractBoundary(req.options.headers['Content-Type']);
  const expectedParts = buildExpectedElevenLabsSttParts({
    audioBuffer,
    boundary,
    language: 'en',
    mimeType: 'audio/wav',
    model: 'scribe_v1',
  });
  const expectedBody = Buffer.concat(expectedParts);
  const actualBody = Buffer.concat(req.writes);

  assert.deepEqual(
    {
      hostname: req.options.hostname,
      path: req.options.path,
      method: req.options.method,
      apiKey: req.options.headers['xi-api-key'],
      contentLength: req.options.headers['Content-Length'],
    },
    {
      hostname: 'api.elevenlabs.io',
      path: '/v1/speech-to-text',
      method: 'POST',
      apiKey: 'eleven-key',
      contentLength: expectedBody.length,
    },
  );
  assert.equal(actualBody.equals(expectedBody), true);
  assert.equal(req.writes.length, expectedParts.length);
  assert.equal(req.writes[1], audioBuffer, 'the original audio Buffer should be written directly');
  assertNoProviderConcat(concatCalls, 'production ElevenLabs STT path should not call Buffer.concat');
  assertMultipartOrder(actualBody, ['name="file"', 'name="model_id"', 'name="language_code"']);

  const framingBytes = expectedBody.length - audioBuffer.length;
  t.diagnostic(`before: legacy Buffer.concat would allocate a ${expectedBody.length} byte ElevenLabs multipart body copy`);
  t.diagnostic(`after: streamed upload wrote ${req.writes.length} buffers, reusing the ${audioBuffer.length} byte audio Buffer and allocating ${framingBytes} framing bytes`);
});

test('Mistral Voxtral STT streams multipart upload parts without a full body concat', async (t) => {
  const audioBuffer = Buffer.alloc(7 * 1024 * 1024, 0x6d);
  const https = createFakeHttps({ responseChunks: [Buffer.from('{"choices":[{"message":{"content":[{"text":"mistral "},"transcript"]}}]}')] });
  const { transcribeAudioWithMistralVoxtral } = await loadMainMediaProviders({ https });

  const { result, concatCalls } = await instrumentBufferConcat(() => transcribeAudioWithMistralVoxtral({
    audioBuffer,
    apiKey: 'mistral-key',
    model: 'voxtral-mini-latest',
    language: 'fr',
    mimeType: 'audio/mpeg',
  }));

  assert.equal(result, 'mistral transcript');
  assert.equal(https.requests.length, 1);

  const req = https.requests[0];
  const boundary = extractBoundary(req.options.headers['Content-Type']);
  const expectedParts = buildExpectedMistralSttParts({
    audioBuffer,
    boundary,
    language: 'fr',
    model: 'voxtral-mini-latest',
    mimeType: 'audio/mpeg',
  });
  const expectedBody = Buffer.concat(expectedParts);
  const actualBody = Buffer.concat(req.writes);

  assert.deepEqual(
    {
      hostname: req.options.hostname,
      path: req.options.path,
      method: req.options.method,
      authorization: req.options.headers.Authorization,
      contentLength: req.options.headers['Content-Length'],
      timeoutMs: req.timeoutMs,
    },
    {
      hostname: 'api.mistral.ai',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      authorization: 'Bearer mistral-key',
      contentLength: expectedBody.length,
      timeoutMs: 60000,
    },
  );
  assert.equal(actualBody.equals(expectedBody), true);
  assert.equal(req.writes.length, expectedParts.length);
  assert.equal(req.writes[1], audioBuffer, 'the original audio Buffer should be written directly');
  assertNoProviderConcat(concatCalls, 'production Mistral STT path should not call Buffer.concat');
  assertMultipartOrder(actualBody, ['name="file"', 'name="model"', 'name="language"']);

  const framingBytes = expectedBody.length - audioBuffer.length;
  t.diagnostic(`before: legacy Buffer.concat would allocate a ${expectedBody.length} byte Mistral multipart body copy`);
  t.diagnostic(`after: streamed upload wrote ${req.writes.length} buffers, reusing the ${audioBuffer.length} byte audio Buffer and allocating ${framingBytes} framing bytes`);
});

test('ElevenLabs TTS streams successful MP3 responses to the temp file without full audio concat', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-cloud-media-buffering-'));
  const audioPath = path.join(tempDir, 'speech.mp3');
  const audioChunks = [
    Buffer.alloc(3 * 1024 * 1024, 0x11),
    Buffer.alloc(2 * 1024 * 1024, 0x22),
    Buffer.alloc(512 * 1024, 0x33),
  ];
  const audioBytes = audioChunks.reduce((total, chunk) => total + chunk.length, 0);
  const https = createFakeHttps({ responseChunks: audioChunks });
  const fakeFs = createInstrumentedFs();
  const { synthesizeElevenLabsToFile } = await loadMainMediaProviders({ https, fsModule: fakeFs });

  try {
    const { concatCalls } = await instrumentBufferConcat(() => synthesizeElevenLabsToFile({
      text: 'Read this aloud.',
      apiKey: 'eleven-key',
      modelId: 'eleven_multilingual_v2',
      voiceId: 'voice-id',
      audioPath,
      timeoutMs: 30000,
    }));

    assert.equal(https.requests.length, 1);
    const req = https.requests[0];
    assert.deepEqual(
      {
        hostname: req.options.hostname,
        path: req.options.path,
        method: req.options.method,
        apiKey: req.options.headers['xi-api-key'],
        contentType: req.options.headers['Content-Type'],
        accept: req.options.headers.Accept,
        timeoutMs: req.timeoutMs,
      },
      {
        hostname: 'api.elevenlabs.io',
        path: '/v1/text-to-speech/voice-id?output_format=mp3_44100_128',
        method: 'POST',
        apiKey: 'eleven-key',
        contentType: 'application/json',
        accept: 'audio/mpeg',
        timeoutMs: 30000,
      },
    );
    assert.deepEqual(JSON.parse(req.writes.join('')), {
      text: 'Read this aloud.',
      model_id: 'eleven_multilingual_v2',
    });
    assert.equal(fs.statSync(audioPath).size, audioBytes);
    assert.equal(fakeFs.writeFileCalls.length, 0, 'success path should stream with createWriteStream instead of fs.writeFile');
    assert.equal(fakeFs.createWriteStreamCalls.length, 1);
    assertNoProviderConcat(concatCalls, 'production ElevenLabs TTS success path should not call Buffer.concat');

    t.diagnostic(`before: legacy Buffer.concat would retain a ${audioBytes} byte MP3 response before fs.writeFile`);
    t.diagnostic(`after: streamed ${audioBytes} MP3 bytes directly to ${fs.statSync(audioPath).size} temp-file bytes without a full audio Buffer concat`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ElevenLabs TTS keeps HTTP error text bounded and preserves unusual-activity message', async () => {
  {
    const https = createFakeHttps({
      statusCode: 500,
      responseChunks: [Buffer.from('x'.repeat(2 * 1024 * 1024))],
    });
    const { synthesizeElevenLabsToFile } = await loadMainMediaProviders({ https, fsModule: createInstrumentedFs() });

    const { error, concatCalls } = await instrumentBufferConcatRejection(() => synthesizeElevenLabsToFile({
      text: 'Read this aloud.',
      apiKey: 'eleven-key',
      modelId: 'eleven_multilingual_v2',
      voiceId: 'voice-id',
      audioPath: path.join(os.tmpdir(), 'unused-supercmd-tts-error.mp3'),
    }));

    assert.match(error.message, /^ElevenLabs TTS HTTP 500: x{500}$/);
    assert.equal(error.message.length, 'ElevenLabs TTS HTTP 500: '.length + 500);
    assertNoProviderConcat(concatCalls, 'production ElevenLabs TTS error path should not call Buffer.concat');
  }

  {
    const https = createFakeHttps({
      statusCode: 401,
      responseChunks: [Buffer.from('{"detail":"detected_unusual_activity"}')],
    });
    const { synthesizeElevenLabsToFile } = await loadMainMediaProviders({ https, fsModule: createInstrumentedFs() });

    await assert.rejects(
      synthesizeElevenLabsToFile({
        text: 'Read this aloud.',
        apiKey: 'eleven-key',
        modelId: 'eleven_multilingual_v2',
        voiceId: 'voice-id',
        audioPath: path.join(os.tmpdir(), 'unused-supercmd-tts-unusual.mp3'),
      }),
      /ElevenLabs rejected this key due to account restrictions \(detected_unusual_activity\)/,
    );
  }
});

async function loadMainMediaProviders({ https, fsModule = fs } = {}) {
  const cjs = stripMediaProviderTypes(`${providerSource}
module.exports = {
  transcribeAudioWithElevenLabs,
  transcribeAudioWithMistralVoxtral,
  synthesizeElevenLabsToFile,
};`);
  const module = { exports: {} };
  const context = vm.createContext({
    Buffer,
    Error,
    JSON,
    Math,
    Promise,
    String,
    console,
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === 'https') return https;
      if (specifier === 'fs') return fsModule;
      if (specifier === 'stream') return requireFromHere('node:stream');
      if (specifier === 'string_decoder') return requireFromHere('node:string_decoder');
      return requireFromHere(specifier);
    },
  });

  vm.runInContext(cjs, context, { filename: 'main-media-providers.cjs' });
  return module.exports;
}

function stripMediaProviderTypes(source) {
  return source
    .replace(/^type BufferedRequestPart = Buffer;\n/m, '')
    .replace(/function getBufferedRequestPartsContentLength\(parts: readonly BufferedRequestPart\[\]\): number \{/g, 'function getBufferedRequestPartsContentLength(parts) {')
    .replace(/function writeBufferedRequestParts\(req: \{ write: \(chunk: Buffer\) => unknown; end: \(\) => unknown \}, parts: readonly BufferedRequestPart\[\]\): void \{/g, 'function writeBufferedRequestParts(req, parts) {')
    .replace(/function collectBoundedResponseText\(res: any, maxBytes = ([^)]+)\): Promise<string> \{/g, 'function collectBoundedResponseText(res, maxBytes = $1) {')
    .replace(/function (transcribeAudioWithElevenLabs|transcribeAudioWithMistralVoxtral|synthesizeElevenLabsToFile)\(opts: \{[\s\S]*?\}\): Promise<[^>]+> \{/g, 'function $1(opts) {')
    .replace(/ as typeof import\('string_decoder'\)/g, '')
    .replace(/ as typeof import\('stream'\)/g, '')
    .replace(/: Buffer\[\]/g, '')
    .replace(/\((chunk|err|res|part): (?:Buffer \| string|Buffer|Error \| null|any)\) =>/g, '($1) =>')
    .replace(/new Promise<[^>]+>/g, 'new Promise');
}

async function instrumentBufferConcat(fn) {
  const originalConcat = Buffer.concat;
  const concatCalls = [];

  Buffer.concat = function instrumentedConcat(list, totalLength) {
    concatCalls.push({
      chunks: list.length,
      totalLength: totalLength ?? list.reduce((total, chunk) => total + chunk.length, 0),
      stack: new Error().stack || '',
    });
    return originalConcat.call(Buffer, list, totalLength);
  };

  try {
    const result = await fn();
    return { result, concatCalls };
  } finally {
    Buffer.concat = originalConcat;
  }
}

async function instrumentBufferConcatRejection(fn) {
  const originalConcat = Buffer.concat;
  const concatCalls = [];

  Buffer.concat = function instrumentedConcat(list, totalLength) {
    concatCalls.push({
      chunks: list.length,
      totalLength: totalLength ?? list.reduce((total, chunk) => total + chunk.length, 0),
      stack: new Error().stack || '',
    });
    return originalConcat.call(Buffer, list, totalLength);
  };

  try {
    await fn();
    assert.fail('expected rejection');
  } catch (error) {
    return { error, concatCalls };
  } finally {
    Buffer.concat = originalConcat;
  }
}

function assertNoProviderConcat(concatCalls, message) {
  const providerConcatCalls = concatCalls.filter((call) => call.stack.includes('main-media-providers.cjs'));
  assert.equal(providerConcatCalls.length, 0, message);
}

function createFakeHttps(options = {}) {
  const requests = [];
  return {
    requests,
    request(requestOptions, onResponse) {
      const req = new FakeClientRequest(requestOptions, onResponse, options);
      requests.push(req);
      return req;
    },
  };
}

class FakeClientRequest extends EventEmitter {
  constructor(options, onResponse, responseOptions) {
    super();
    this.options = options;
    this.onResponse = onResponse;
    this.responseOptions = responseOptions;
    this.destroyed = false;
    this.ended = false;
    this.timeoutMs = null;
    this.writes = [];
  }

  write(chunk) {
    this.writes.push(chunk);
    return true;
  }

  end() {
    this.ended = true;
    queueMicrotask(() => {
      if (this.responseOptions.requestError) {
        this.emit('error', this.responseOptions.requestError);
        return;
      }
      if (this.destroyed) return;

      const res = new PassThrough();
      res.statusCode = this.responseOptions.statusCode ?? 200;
      this.onResponse(res);
      for (const chunk of this.responseOptions.responseChunks ?? [Buffer.from('transcript')]) {
        res.write(chunk);
      }
      res.end();
    });
  }

  setTimeout(timeoutMs) {
    this.timeoutMs = timeoutMs;
  }

  destroy(error) {
    this.destroyed = true;
    if (error) this.emit('error', error);
  }
}

function createInstrumentedFs() {
  return {
    ...fs,
    createWriteStreamCalls: [],
    writeFileCalls: [],
    createWriteStream(filePath, options) {
      this.createWriteStreamCalls.push({ filePath, options });
      return fs.createWriteStream(filePath, options);
    },
    writeFile(...args) {
      this.writeFileCalls.push(args);
      return fs.writeFile(...args);
    },
  };
}

function buildExpectedElevenLabsSttParts({ audioBuffer, boundary, language, mimeType, model }) {
  const normalized = String(mimeType || '').toLowerCase();
  const filename = normalized.includes('wav')
    ? 'audio.wav'
    : normalized.includes('mpeg') || normalized.includes('mp3')
      ? 'audio.mp3'
      : normalized.includes('mp4') || normalized.includes('m4a')
        ? 'audio.m4a'
        : normalized.includes('ogg') || normalized.includes('oga')
          ? 'audio.ogg'
          : normalized.includes('flac')
            ? 'audio.flac'
            : 'audio.webm';
  const contentType = normalized || 'audio/webm';
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    audioBuffer,
    Buffer.from('\r\n'),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\n${model}\r\n`),
  ];

  if (language) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language_code"\r\n\r\n${language}\r\n`));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return parts;
}

function buildExpectedMistralSttParts({ audioBuffer, boundary, language, mimeType, model }) {
  const normalized = String(mimeType || '').toLowerCase();
  const filename = normalized.includes('mp3') || normalized.includes('mpeg') ? 'audio.mp3' : 'audio.wav';
  const contentType = filename.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    audioBuffer,
    Buffer.from('\r\n'),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model || 'voxtral-mini-latest'}\r\n`),
  ];

  if (language) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return parts;
}

function extractBoundary(contentType) {
  const match = /^multipart\/form-data; boundary=(.+)$/.exec(contentType);
  assert.ok(match, `expected multipart content type, got ${contentType}`);
  return match[1];
}

function assertMultipartOrder(body, markers) {
  const text = body.toString('utf8');
  let previous = -1;

  for (const marker of markers) {
    const index = text.indexOf(marker);
    assert.notEqual(index, -1, `expected multipart marker ${marker}`);
    assert.ok(index > previous, `expected ${marker} after previous multipart field`);
    previous = index;
  }
}

function extractSourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `expected source marker ${startMarker}`);
  assert.notEqual(end, -1, `expected source marker ${endMarker}`);
  return source.slice(start, end);
}
