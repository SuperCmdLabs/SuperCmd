#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSync } = require('esbuild');

const CHUNK_COUNT = 240;

function loadTsModule(filePath, context = {}) {
  const resolvedPath = path.resolve(filePath);
  const bundled = buildSync({
    bundle: true,
    entryPoints: [resolvedPath],
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    write: false,
  });

  const module = { exports: {} };
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require,
    console,
    setTimeout,
    clearTimeout,
    ...context,
  }, { filename: resolvedPath });
  return module.exports;
}

const {
  AI_CHAT_STREAM_FLUSH_MS,
  createAiChatStreamBuffer,
} = loadTsModule('src/renderer/src/utils/ai-chat-stream-buffer.ts');

function makeChunks(count = CHUNK_COUNT) {
  return Array.from({ length: count }, (_, index) => `chunk-${index}\n`);
}

function simulateUnbatchedStreaming(chunks) {
  let content = '';
  let visibleUpdates = 0;
  let markdownReparseChars = 0;
  let layoutMeasurements = 0;

  const startedAt = performance.now();
  for (const chunk of chunks) {
    content += chunk;
    visibleUpdates += 1;
    markdownReparseChars += content.length;
    layoutMeasurements += 1;
  }

  return {
    content,
    elapsedMs: performance.now() - startedAt,
    layoutMeasurements,
    markdownReparseChars,
    visibleUpdates,
  };
}

function createManualScheduler() {
  let nextHandle = 1;
  const callbacks = new Map();

  return {
    get size() {
      return callbacks.size;
    },
    schedule(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
    runNext() {
      const next = callbacks.entries().next();
      if (next.done) return false;
      const [handle, callback] = next.value;
      callbacks.delete(handle);
      callback();
      return true;
    },
  };
}

function createRenderCounters() {
  return {
    content: '',
    layoutMeasurements: 0,
    markdownReparseChars: 0,
    visibleUpdates: 0,
    onFlush(content) {
      this.content = content;
      this.visibleUpdates += 1;
      this.layoutMeasurements += 1;
      this.markdownReparseChars += content.length;
    },
  };
}

function simulateBatchedBurstStreaming(chunks) {
  const scheduler = createManualScheduler();
  const counters = createRenderCounters();
  const startedAt = performance.now();
  const buffer = createAiChatStreamBuffer({
    flushIntervalMs: AI_CHAT_STREAM_FLUSH_MS,
    onFlush: (content) => counters.onFlush(content),
    scheduleFlush: scheduler.schedule,
    cancelFlush: scheduler.cancel,
  });

  for (const chunk of chunks) {
    buffer.append(chunk);
  }
  assert.equal(scheduler.size, 1);
  buffer.flushNow();
  assert.equal(scheduler.size, 0);

  return {
    content: counters.content,
    elapsedMs: performance.now() - startedAt,
    layoutMeasurements: counters.layoutMeasurements,
    markdownReparseChars: counters.markdownReparseChars,
    visibleUpdates: counters.visibleUpdates,
  };
}

function createConversationHarness() {
  const scheduler = createManualScheduler();
  let messages = [
    { id: 'user-1', role: 'user', content: 'Question', createdAt: 1 },
    { id: 'assistant-1', role: 'assistant', content: '', createdAt: 2 },
  ];
  const persisted = [];
  const counters = createRenderCounters();
  const buffer = createAiChatStreamBuffer({
    flushIntervalMs: AI_CHAT_STREAM_FLUSH_MS,
    onFlush: (content) => {
      counters.onFlush(content);
      messages = messages.map((message) => (
        message.id === 'assistant-1'
          ? { ...message, content }
          : message
      ));
    },
    scheduleFlush: scheduler.schedule,
    cancelFlush: scheduler.cancel,
  });

  return {
    append(chunk) {
      buffer.append(chunk);
    },
    complete() {
      buffer.flushNow();
      persisted.push(messages.map((message) => ({ ...message })));
      buffer.reset();
    },
    fail(error) {
      const currentContent = buffer.getContent();
      buffer.append(`${currentContent ? '\n\n' : ''}Error: ${error}`);
      buffer.flushNow();
      persisted.push(messages.map((message) => ({ ...message })));
      buffer.reset();
    },
    get counters() {
      return counters;
    },
    get messages() {
      return messages;
    },
    get persisted() {
      return persisted;
    },
    get schedulerSize() {
      return scheduler.size;
    },
    flushScheduled() {
      return scheduler.runNext();
    },
  };
}

function test(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

const chunks = makeChunks();
const baseline = simulateUnbatchedStreaming(chunks);
const batched = simulateBatchedBurstStreaming(chunks);

assert.equal(baseline.content, chunks.join(''));
assert.equal(baseline.visibleUpdates, CHUNK_COUNT);
assert.equal(baseline.layoutMeasurements, CHUNK_COUNT);
assert.equal(batched.content, baseline.content);
assert.ok(batched.visibleUpdates < baseline.visibleUpdates);
assert.ok(batched.markdownReparseChars < baseline.markdownReparseChars);

test('scheduled flush exposes partial streaming content', () => {
  const harness = createConversationHarness();
  harness.append('Hello');
  assert.equal(harness.schedulerSize, 1);
  assert.equal(harness.flushScheduled(), true);
  assert.equal(harness.messages[1].content, 'Hello');
  harness.append(' world');
  assert.equal(harness.flushScheduled(), true);
  assert.equal(harness.messages[1].content, 'Hello world');
  assert.equal(harness.counters.visibleUpdates, 2);
});

test('chat stream batching preserves timer scheduling when requestAnimationFrame exists', () => {
  let frameRequests = 0;
  const browserLikeModule = loadTsModule('src/renderer/src/utils/ai-chat-stream-buffer.ts', {
    window: {
      document: { hidden: false },
      requestAnimationFrame(callback) {
        frameRequests += 1;
        return setTimeout(callback, 0);
      },
      cancelAnimationFrame(handle) {
        clearTimeout(handle);
      },
    },
    document: { hidden: false },
  });
  const scheduler = createManualScheduler();
  const buffer = browserLikeModule.createAiChatStreamBuffer({
    flushIntervalMs: browserLikeModule.AI_CHAT_STREAM_FLUSH_MS,
    onFlush() {},
    scheduleFlush: scheduler.schedule,
    cancelFlush: scheduler.cancel,
  });

  buffer.append('visible browser chunk');

  assert.equal(frameRequests, 0);
  assert.equal(scheduler.size, 1);
  buffer.cancel();
});

test('completion forces final flush before persistence', () => {
  const harness = createConversationHarness();
  chunks.forEach((chunk) => harness.append(chunk));
  assert.equal(harness.messages[1].content, '');
  harness.complete();
  assert.equal(harness.persisted.length, 1);
  assert.equal(harness.persisted[0][1].content, chunks.join(''));
  assert.equal(harness.counters.visibleUpdates, 1);
});

test('error forces authoritative content plus error before persistence', () => {
  const harness = createConversationHarness();
  harness.append('partial');
  harness.append(' answer');
  harness.fail('network failed');
  assert.equal(harness.persisted.length, 1);
  assert.equal(harness.persisted[0][1].content, 'partial answer\n\nError: network failed');
  assert.equal(harness.counters.visibleUpdates, 1);
});

console.log(JSON.stringify({
  mode: 'unbatched-baseline',
  chunks: CHUNK_COUNT,
  visibleUpdates: baseline.visibleUpdates,
  layoutMeasurements: baseline.layoutMeasurements,
  markdownReparseChars: baseline.markdownReparseChars,
  elapsedMs: Number(baseline.elapsedMs.toFixed(3)),
}, null, 2));

console.log(JSON.stringify({
  mode: 'batched-burst',
  chunks: CHUNK_COUNT,
  flushWindowMs: AI_CHAT_STREAM_FLUSH_MS,
  visibleUpdates: batched.visibleUpdates,
  layoutMeasurements: batched.layoutMeasurements,
  markdownReparseChars: batched.markdownReparseChars,
  elapsedMs: Number(batched.elapsedMs.toFixed(3)),
}, null, 2));
