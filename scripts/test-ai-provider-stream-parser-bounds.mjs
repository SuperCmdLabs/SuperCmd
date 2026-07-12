#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { setImmediate as waitImmediate } from 'node:timers/promises';
import { importTs } from './lib/ts-import.mjs';

const REQUEST_STUB = `
import { EventEmitter } from 'node:events';
export function request(options, callback) {
  const harness = globalThis.__aiProviderStreamParserHarness;
  if (!harness) throw new Error('AI provider stream parser harness is not installed');
  return harness.request(options, callback);
}
export default { request };
`;

const {
  AI_STREAM_PARSER_MAX_BUFFER_CHARS,
  streamAI,
} = await importTs(path.resolve('src/main/ai-provider.ts'), {
  stubs: {
    http: REQUEST_STUB,
    https: REQUEST_STUB,
  },
});

const OPENAI_CONFIG = {
  enabled: true,
  provider: 'openai',
  openaiApiKey: 'test-openai-key',
};

const OLLAMA_CONFIG = {
  enabled: true,
  provider: 'ollama',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
};

function createRequestHarness() {
  const requests = [];

  return {
    requests,
    request(options, callback) {
      const record = {
        options,
        body: '',
        destroyed: false,
        response: null,
      };

      const req = new EventEmitter();
      req.write = (chunk) => {
        record.body += chunk.toString();
        return true;
      };
      req.end = () => {
        const response = new PassThrough();
        response.statusCode = 200;
        record.response = response;
        callback(response);
      };
      req.destroy = () => {
        record.destroyed = true;
        record.response?.destroy();
      };

      requests.push(record);
      return req;
    },
  };
}

function installHarness() {
  const harness = createRequestHarness();
  globalThis.__aiProviderStreamParserHarness = harness;
  return harness;
}

async function waitForRequestResponse(harness) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const request = harness.requests[0];
    if (request?.response) return request;
    await waitImmediate();
  }
  assert.fail('timed out waiting for AI provider request');
}

function openAISseFrame(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

function ollamaNdjsonLine(text) {
  return `${JSON.stringify({ response: text })}\n`;
}

function splitInsideUtf8Sequence(text, sequence) {
  const buffer = Buffer.from(text);
  const needle = Buffer.from(sequence);
  const index = buffer.indexOf(needle);
  assert.notEqual(index, -1, `expected payload to contain ${sequence}`);
  return [
    buffer.subarray(0, index + 1),
    buffer.subarray(index + 1),
  ];
}

async function startStream(config, options = {}) {
  const harness = installHarness();
  const chunks = [];
  const collecting = (async () => {
    for await (const chunk of streamAI(config, {
      prompt: 'stream parser harness prompt',
      creativity: 0.2,
      ...options,
    })) {
      chunks.push(chunk);
    }
    return chunks;
  })();

  const request = await waitForRequestResponse(harness);
  return { collecting, chunks, request };
}

test('SSE parser preserves UTF-8 characters split across provider chunks', async (t) => {
  const expected = 'Hello 🙂 world';
  const frame = openAISseFrame(expected);
  const parts = splitInsideUtf8Sequence(frame, '🙂');
  const { collecting, request } = await startStream(OPENAI_CONFIG);

  request.response.write(parts[0]);
  request.response.write(parts[1]);
  request.response.end('data: [DONE]\n\n');

  assert.deepEqual(await collecting, [expected]);

  const legacyDecoded = parts.map((part) => part.toString()).join('');
  assert.notEqual(legacyDecoded, frame);
  t.diagnostic(`legacy split-SSE decode matched source: ${legacyDecoded === frame}`);
  t.diagnostic('TextDecoder streaming split-SSE decode matched source: true');
});

test('NDJSON parser preserves UTF-8 characters split across provider chunks', async (t) => {
  const expected = 'Ollama says 🙂';
  const line = ollamaNdjsonLine(expected);
  const parts = splitInsideUtf8Sequence(line, '🙂');
  const { collecting, request } = await startStream(OLLAMA_CONFIG);

  request.response.write(parts[0]);
  request.response.write(parts[1]);
  request.response.end();

  assert.deepEqual(await collecting, [expected]);

  const legacyDecoded = parts.map((part) => part.toString()).join('');
  assert.notEqual(legacyDecoded, line);
  t.diagnostic(`legacy split-NDJSON decode matched source: ${legacyDecoded === line}`);
  t.diagnostic('TextDecoder streaming split-NDJSON decode matched source: true');
});

test('stream parsers keep valid long provider payloads below the buffer limit working', async () => {
  const longText = 'provider-payload-'.repeat(16 * 1024);
  const sse = await startStream(OPENAI_CONFIG);
  sse.request.response.end(openAISseFrame(longText) + 'data: [DONE]\n\n');
  assert.deepEqual(await sse.collecting, [longText]);

  const ndjson = await startStream(OLLAMA_CONFIG);
  ndjson.request.response.end(ollamaNdjsonLine(longText));
  assert.deepEqual(await ndjson.collecting, [longText]);
});

test('SSE parser allows an incomplete line at the configured buffer limit', async (t) => {
  const { collecting, request } = await startStream(OPENAI_CONFIG);

  request.response.write('x'.repeat(AI_STREAM_PARSER_MAX_BUFFER_CHARS));
  request.response.end('\n');

  assert.deepEqual(await collecting, []);
  t.diagnostic(`bounded SSE retained-buffer limit accepted: ${AI_STREAM_PARSER_MAX_BUFFER_CHARS} characters`);
});

test('SSE parser rejects an unterminated line above the configured buffer limit', async (t) => {
  const { collecting, request } = await startStream(OPENAI_CONFIG);

  request.response.write('x'.repeat(AI_STREAM_PARSER_MAX_BUFFER_CHARS + 1));

  await assert.rejects(
    collecting,
    /AI stream parser exceeded \d+ buffered characters without a line break/,
  );
  request.response.destroy();
  t.diagnostic(`legacy retained incomplete SSE characters: ${AI_STREAM_PARSER_MAX_BUFFER_CHARS + 1}`);
  t.diagnostic(`bounded retained incomplete SSE characters: ${AI_STREAM_PARSER_MAX_BUFFER_CHARS}`);
});

test('NDJSON parser rejects an unterminated line above the configured buffer limit', async (t) => {
  const { collecting, request } = await startStream(OLLAMA_CONFIG);

  request.response.write('x'.repeat(AI_STREAM_PARSER_MAX_BUFFER_CHARS + 1));

  await assert.rejects(
    collecting,
    /AI stream parser exceeded \d+ buffered characters without a line break/,
  );
  request.response.destroy();
  t.diagnostic(`legacy retained incomplete NDJSON characters: ${AI_STREAM_PARSER_MAX_BUFFER_CHARS + 1}`);
  t.diagnostic(`bounded retained incomplete NDJSON characters: ${AI_STREAM_PARSER_MAX_BUFFER_CHARS}`);
});
