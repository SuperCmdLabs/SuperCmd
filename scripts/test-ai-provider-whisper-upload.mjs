#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { importTs } from './lib/ts-import.mjs';

const HTTPS_STUB = `
module.exports = {
  request: (...args) => globalThis.__supercmdWhisperHttps.request(...args),
};
`;

const { transcribeAudio } = await importTs(path.resolve('src/main/ai-provider.ts'), {
  stubs: {
    https: HTTPS_STUB,
  },
});

test('transcribeAudio streams Whisper multipart upload bytes without a full body concat', async (t) => {
  const audioBuffer = Buffer.alloc(8 * 1024 * 1024, 0x61);
  const https = createFakeHttps({ responseBody: '  hello from whisper  \n' });
  const { result, concatCalls } = await instrumentBufferConcat(() => transcribeAudio({
    audioBuffer,
    apiKey: 'test-api-key',
    model: 'whisper-1',
    language: 'en',
    mimeType: 'audio/wav',
  }));

  assert.equal(result, 'hello from whisper');
  assert.equal(https.requests.length, 1);

  const req = https.requests[0];
  const boundary = extractBoundary(req.options.headers['Content-Type']);
  const expectedParts = buildExpectedMultipartParts({
    audioBuffer,
    boundary,
    language: 'en',
    mimeType: 'audio/wav',
    model: 'whisper-1',
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
    },
    {
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      authorization: 'Bearer test-api-key',
      contentLength: expectedBody.length,
    },
  );
  assert.equal(actualBody.equals(expectedBody), true);
  assert.equal(req.writes.length, expectedParts.length);
  assert.equal(req.writes[1], audioBuffer, 'the original audio Buffer should be written directly');
  assert.equal(Math.max(...req.writes.map((chunk) => chunk.length)), audioBuffer.length);
  assert.equal(concatCalls.length, 0, 'production upload path should not call Buffer.concat');
  assertMultipartOrder(actualBody, ['name="file"', 'name="model"', 'name="response_format"', 'name="language"']);

  const framingBytes = expectedBody.length - audioBuffer.length;
  t.diagnostic(`before: legacy Buffer.concat would allocate a ${expectedBody.length} byte multipart body copy`);
  t.diagnostic(`after: streamed upload wrote ${req.writes.length} buffers, reusing the ${audioBuffer.length} byte audio Buffer and allocating ${framingBytes} framing bytes`);
});

test('transcribeAudio preserves no-language multipart ordering and default upload metadata', async () => {
  const audioBuffer = Buffer.from('tiny-audio');
  const https = createFakeHttps({ responseBody: 'ok' });

  await transcribeAudio({
    audioBuffer,
    apiKey: 'test-api-key',
    model: 'gpt-4o-transcribe',
  });

  const req = https.requests[0];
  const boundary = extractBoundary(req.options.headers['Content-Type']);
  const expectedParts = buildExpectedMultipartParts({
    audioBuffer,
    boundary,
    model: 'gpt-4o-transcribe',
  });
  const actualBody = Buffer.concat(req.writes);
  const actualText = actualBody.toString('utf8');

  assert.equal(req.options.headers['Content-Length'], Buffer.concat(expectedParts).length);
  assert.equal(actualBody.equals(Buffer.concat(expectedParts)), true);
  assert.equal(req.writes.length, expectedParts.length);
  assert.match(actualText, /filename="audio\.webm"/);
  assert.match(actualText, /Content-Type: audio\/webm/);
  assert.doesNotMatch(actualText, /name="language"/);
  assertMultipartOrder(actualBody, ['name="file"', 'name="model"', 'name="response_format"']);
});

test('transcribeAudio preserves Whisper HTTP and request error handling', async () => {
  {
    createFakeHttps({ statusCode: 429, responseBody: 'rate limited by test' });

    await assert.rejects(
      transcribeAudio({
        audioBuffer: Buffer.from('audio'),
        apiKey: 'test-api-key',
        model: 'whisper-1',
      }),
      /Whisper API HTTP 429: rate limited by test/,
    );
  }

  {
    createFakeHttps({ requestError: new Error('socket failed') });

    await assert.rejects(
      transcribeAudio({
        audioBuffer: Buffer.from('audio'),
        apiKey: 'test-api-key',
        model: 'whisper-1',
      }),
      /socket failed/,
    );
  }
});

test('transcribeAudio preserves pre-aborted request behavior', async () => {
  const controller = new AbortController();
  controller.abort();
  const https = createFakeHttps();

  await assert.rejects(
    transcribeAudio({
      audioBuffer: Buffer.from('audio'),
      apiKey: 'test-api-key',
      model: 'whisper-1',
      signal: controller.signal,
    }),
    /Transcription aborted/,
  );

  assert.equal(https.requests.length, 1);
  assert.equal(https.requests[0].destroyed, true);
  assert.equal(https.requests[0].ended, false);
  assert.equal(https.requests[0].writes.length, 0);
});

async function instrumentBufferConcat(fn) {
  const originalConcat = Buffer.concat;
  const concatCalls = [];

  Buffer.concat = function instrumentedConcat(list, totalLength) {
    concatCalls.push({
      chunks: list.length,
      totalLength: totalLength ?? list.reduce((total, chunk) => total + chunk.length, 0),
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

function createFakeHttps(options = {}) {
  const requests = [];
  const fakeHttps = {
    requests,
    request(requestOptions, onResponse) {
      const req = new FakeClientRequest(requestOptions, onResponse, options);
      requests.push(req);
      return req;
    },
  };

  globalThis.__supercmdWhisperHttps = fakeHttps;
  return fakeHttps;
}

class FakeClientRequest extends EventEmitter {
  constructor(options, onResponse, responseOptions) {
    super();
    this.options = options;
    this.onResponse = onResponse;
    this.responseOptions = responseOptions;
    this.destroyed = false;
    this.ended = false;
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

      const res = new EventEmitter();
      res.statusCode = this.responseOptions.statusCode ?? 200;
      this.onResponse(res);
      res.emit('data', this.responseOptions.responseBody ?? 'transcript');
      res.emit('end');
    });
  }

  destroy() {
    this.destroyed = true;
  }
}

function extractBoundary(contentType) {
  const match = /^multipart\/form-data; boundary=(.+)$/.exec(contentType);
  assert.ok(match, `expected multipart content type, got ${contentType}`);
  return match[1];
}

function buildExpectedMultipartParts({ audioBuffer, boundary, language, mimeType, model }) {
  const uploadMeta = resolveExpectedUploadMeta(mimeType);
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${uploadMeta.filename}"\r\nContent-Type: ${uploadMeta.contentType}\r\n\r\n`),
    audioBuffer,
    Buffer.from('\r\n'),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`),
  ];

  if (language) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return parts;
}

function resolveExpectedUploadMeta(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('wav')) return { filename: 'audio.wav', contentType: 'audio/wav' };
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return { filename: 'audio.mp3', contentType: 'audio/mpeg' };
  if (normalized.includes('mp4') || normalized.includes('m4a')) return { filename: 'audio.m4a', contentType: 'audio/mp4' };
  if (normalized.includes('ogg') || normalized.includes('oga')) return { filename: 'audio.ogg', contentType: 'audio/ogg' };
  if (normalized.includes('flac')) return { filename: 'audio.flac', contentType: 'audio/flac' };
  return { filename: 'audio.webm', contentType: 'audio/webm' };
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
