#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importTs } from './lib/ts-import.mjs';

const CHUNK_COUNT = 500;
const { createCursorPromptResultBatcher } = await importTs(
  path.resolve('src/renderer/src/hooks/cursorPromptResultBatcher.ts')
);

function makeChunks(count) {
  return Array.from({ length: count }, (_, index) => `chunk-${index};`);
}

function simulateLegacyCursorPromptStream(chunks) {
  let visibleResult = '';
  let visibleUpdateCount = 0;

  for (const chunk of chunks) {
    visibleResult += chunk;
    visibleUpdateCount += 1;
  }

  return { visibleResult, visibleUpdateCount };
}

function createManualFrameScheduler() {
  let nextFrameId = 1;
  const callbacks = new Map();

  return {
    requestFrame(callback) {
      const id = nextFrameId;
      nextFrameId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      callbacks.delete(id);
    },
    flushFrames() {
      const queuedCallbacks = Array.from(callbacks.values());
      callbacks.clear();
      for (const callback of queuedCallbacks) {
        callback();
      }
      return queuedCallbacks.length;
    },
    pendingFrameCount() {
      return callbacks.size;
    },
  };
}

function createBatcherHarness() {
  const scheduler = createManualFrameScheduler();
  const resultRef = { current: '' };
  let visibleResult = '';
  let visibleUpdateCount = 0;
  const batcher = createCursorPromptResultBatcher({
    resultRef,
    setVisibleResult(nextResult) {
      visibleResult = nextResult;
      visibleUpdateCount += 1;
    },
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
  });

  return {
    batcher,
    resultRef,
    scheduler,
    get visibleResult() {
      return visibleResult;
    },
    get visibleUpdateCount() {
      return visibleUpdateCount;
    },
  };
}

test('baseline cursor prompt streaming updates visible state once per chunk', () => {
  const chunks = makeChunks(CHUNK_COUNT);
  const expectedResult = chunks.join('');
  const metrics = simulateLegacyCursorPromptStream(chunks);

  assert.equal(metrics.visibleResult, expectedResult);
  assert.equal(metrics.visibleUpdateCount, CHUNK_COUNT);
  console.log(`baseline visible result updates: ${metrics.visibleUpdateCount} for ${CHUNK_COUNT} chunks`);
});

test('cursor prompt result batching coalesces many chunks into one visible update per frame', () => {
  const chunks = makeChunks(CHUNK_COUNT);
  const expectedResult = chunks.join('');
  const harness = createBatcherHarness();

  for (const chunk of chunks) {
    harness.batcher.appendChunk(chunk);
  }

  assert.equal(harness.resultRef.current, expectedResult);
  assert.equal(harness.visibleResult, '');
  assert.equal(harness.visibleUpdateCount, 0);
  assert.equal(harness.scheduler.pendingFrameCount(), 1);

  assert.equal(harness.scheduler.flushFrames(), 1);
  assert.equal(harness.visibleResult, expectedResult);
  assert.equal(harness.visibleUpdateCount, 1);
  console.log(`batched visible result updates: ${harness.visibleUpdateCount} for ${CHUNK_COUNT} chunks`);
});

test('cursor prompt result batching flushes the final pending stream synchronously', () => {
  const harness = createBatcherHarness();

  harness.batcher.appendChunk('final ');
  harness.batcher.appendChunk('answer');
  harness.batcher.flush();

  assert.equal(harness.resultRef.current, 'final answer');
  assert.equal(harness.visibleResult, 'final answer');
  assert.equal(harness.visibleUpdateCount, 1);
  assert.equal(harness.scheduler.pendingFrameCount(), 0);

  assert.equal(harness.scheduler.flushFrames(), 0);
  assert.equal(harness.visibleUpdateCount, 1);
});

test('cursor prompt result batching keeps apply text current before the visible frame flush', () => {
  const harness = createBatcherHarness();

  harness.batcher.appendChunk(' rewrite');
  harness.batcher.appendChunk(' this ');

  const textReadByApply = String(harness.resultRef.current || '').trim();
  assert.equal(textReadByApply, 'rewrite this');
  assert.equal(harness.visibleResult, '');
  assert.equal(harness.visibleUpdateCount, 0);
  assert.equal(harness.scheduler.pendingFrameCount(), 1);
});

test('cursor prompt result batching can cancel a pending repaint without changing authoritative text', () => {
  const harness = createBatcherHarness();

  harness.batcher.appendChunk('partial');
  harness.batcher.cancelPendingFlush();

  assert.equal(harness.resultRef.current, 'partial');
  assert.equal(harness.scheduler.pendingFrameCount(), 0);
  assert.equal(harness.scheduler.flushFrames(), 0);
  assert.equal(harness.visibleResult, '');
  assert.equal(harness.visibleUpdateCount, 0);
});
