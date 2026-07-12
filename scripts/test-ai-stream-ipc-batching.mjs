#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importTs } from './lib/ts-import.mjs';

const CHUNK_COUNT = 600;

const {
  AI_STREAM_IPC_FLUSH_MS,
  createAIStreamIpcCoalescer,
  forwardAIStreamChunksToIpc,
} = await importTs(path.resolve('src/main/ai-stream-ipc.ts'));

function makeChunks(count = CHUNK_COUNT) {
  return Array.from({ length: count }, (_, index) => `chunk-${index};`);
}

async function* streamChunks(chunks) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function createManualScheduler() {
  let nextHandle = 1;
  const callbacks = new Map();

  return {
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
    pendingCount() {
      return callbacks.size;
    },
  };
}

function createSender() {
  const events = [];
  return {
    events,
    send(channel, payload) {
      events.push({ channel, payload });
    },
  };
}

function aiStreamChunkEvents(events) {
  return events.filter((event) => event.channel === 'ai-stream-chunk');
}

function joinedChunkText(events) {
  return aiStreamChunkEvents(events).map((event) => event.payload.chunk).join('');
}

async function simulateLegacyIpcSend(chunks) {
  const sender = createSender();
  for await (const chunk of streamChunks(chunks)) {
    sender.send('ai-stream-chunk', { requestId: 'request-1', chunk });
  }
  return sender.events;
}

async function simulateBatchedIpcSend(chunks) {
  const sender = createSender();
  const scheduler = createManualScheduler();
  const controller = new AbortController();
  const coalescer = createAIStreamIpcCoalescer({
    requestId: 'request-1',
    sender,
    flushIntervalMs: AI_STREAM_IPC_FLUSH_MS,
    scheduleFlush: scheduler.schedule,
    cancelFlush: scheduler.cancel,
  });

  await forwardAIStreamChunksToIpc(streamChunks(chunks), coalescer, controller.signal);

  assert.equal(sender.events.length, 0, 'burst should wait for the scheduled IPC flush');
  assert.equal(scheduler.pendingCount(), 1, 'burst should schedule one coalesced IPC flush');
  coalescer.flush();
  assert.equal(scheduler.pendingCount(), 0);

  return sender.events;
}

test('main-process AI stream IPC batching coalesces provider chunk bursts', async (t) => {
  const chunks = makeChunks();
  const expectedText = chunks.join('');

  const legacyEvents = await simulateLegacyIpcSend(chunks);
  const batchedEvents = await simulateBatchedIpcSend(chunks);

  const legacyChunkSends = aiStreamChunkEvents(legacyEvents).length;
  const batchedChunkSends = aiStreamChunkEvents(batchedEvents).length;

  assert.equal(legacyChunkSends, CHUNK_COUNT);
  assert.equal(joinedChunkText(legacyEvents), expectedText);
  assert.equal(joinedChunkText(batchedEvents), expectedText);
  assert.ok(batchedChunkSends < legacyChunkSends / 10);

  t.diagnostic(`baseline ai-stream-chunk IPC sends: ${legacyChunkSends} for ${CHUNK_COUNT} provider chunks`);
  t.diagnostic(`batched ai-stream-chunk IPC sends: ${batchedChunkSends} for ${CHUNK_COUNT} provider chunks`);
});

test('main-process AI stream IPC flushes pending text before done', () => {
  const sender = createSender();
  const scheduler = createManualScheduler();
  const coalescer = createAIStreamIpcCoalescer({
    requestId: 'done-request',
    sender,
    scheduleFlush: scheduler.schedule,
    cancelFlush: scheduler.cancel,
  });

  coalescer.appendChunk('final ');
  coalescer.appendChunk('answer');
  coalescer.flush();
  sender.send('ai-stream-done', { requestId: 'done-request' });

  assert.deepEqual(sender.events.map((event) => event.channel), [
    'ai-stream-chunk',
    'ai-stream-done',
  ]);
  assert.equal(joinedChunkText(sender.events), 'final answer');
  assert.equal(scheduler.pendingCount(), 0);
});

test('main-process AI stream IPC flushes pending text before error', async () => {
  const sender = createSender();
  const scheduler = createManualScheduler();
  const controller = new AbortController();
  const coalescer = createAIStreamIpcCoalescer({
    requestId: 'error-request',
    sender,
    scheduleFlush: scheduler.schedule,
    cancelFlush: scheduler.cancel,
  });

  async function* failingStream() {
    yield 'partial ';
    yield 'answer';
    throw new Error('provider failed');
  }

  try {
    await forwardAIStreamChunksToIpc(failingStream(), coalescer, controller.signal);
    assert.fail('expected provider stream to fail');
  } catch (error) {
    coalescer.flush();
    sender.send('ai-stream-error', {
      requestId: 'error-request',
      error: error instanceof Error ? error.message : 'AI request failed',
    });
  }

  assert.deepEqual(sender.events.map((event) => event.channel), [
    'ai-stream-chunk',
    'ai-stream-error',
  ]);
  assert.equal(joinedChunkText(sender.events), 'partial answer');
  assert.equal(sender.events[1].payload.error, 'provider failed');
  assert.equal(scheduler.pendingCount(), 0);
});

test('main-process AI stream IPC flushes pending text during cancellation cleanup', () => {
  const sender = createSender();
  const scheduler = createManualScheduler();
  const controller = new AbortController();
  const coalescer = createAIStreamIpcCoalescer({
    requestId: 'cancel-request',
    sender,
    scheduleFlush: scheduler.schedule,
    cancelFlush: scheduler.cancel,
  });

  coalescer.appendChunk('visible before cancel');
  assert.equal(coalescer.hasPendingChunk(), true);
  assert.equal(coalescer.hasPendingFlush(), true);

  coalescer.flush();
  controller.abort();

  assert.equal(controller.signal.aborted, true);
  assert.equal(joinedChunkText(sender.events), 'visible before cancel');
  assert.equal(aiStreamChunkEvents(sender.events).length, 1);
  assert.equal(coalescer.hasPendingChunk(), false);
  assert.equal(coalescer.hasPendingFlush(), false);
  assert.equal(scheduler.pendingCount(), 0);
});

test('main-process AI stream IPC flushes the previous buffer before request replacement', () => {
  const sender = createSender();
  const scheduler = createManualScheduler();
  const previous = createAIStreamIpcCoalescer({
    requestId: 'same-request',
    sender,
    scheduleFlush: scheduler.schedule,
    cancelFlush: scheduler.cancel,
  });

  previous.appendChunk('old buffered text');
  previous.flush();

  const replacement = createAIStreamIpcCoalescer({
    requestId: 'same-request',
    sender,
    scheduleFlush: scheduler.schedule,
    cancelFlush: scheduler.cancel,
  });
  replacement.appendChunk('new buffered text');
  replacement.flush();

  assert.deepEqual(
    aiStreamChunkEvents(sender.events).map((event) => event.payload.chunk),
    ['old buffered text', 'new buffered text'],
  );
  assert.equal(scheduler.pendingCount(), 0);
});
