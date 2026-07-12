#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';

const RAYCAST_API_PATH = path.resolve('src/renderer/src/raycast-api/index.tsx');

test('AI.ask detaches caller abort listeners on every terminal path', async (t) => {
  await t.test('stream success', async () => {
    const { AI, electron } = await loadRaycastAIShim();
    const tracked = createTrackedAbortController();

    const stream = AI.ask('success prompt', { signal: tracked.signal });
    const requestId = electron.aiAskCalls[0].requestId;

    electron.handlers.chunk({ requestId, chunk: 'hello ' });
    electron.handlers.chunk({ requestId, chunk: 'world' });
    electron.handlers.done({ requestId });

    assert.equal(await stream, 'hello world');
    assertDetached('success', tracked);
  });

  await t.test('stream error', async () => {
    const { AI, electron } = await loadRaycastAIShim();
    const tracked = createTrackedAbortController();

    const stream = AI.ask('error prompt', { signal: tracked.signal });
    const requestId = electron.aiAskCalls[0].requestId;

    electron.handlers.error({ requestId, error: 'stream failed' });

    await assert.rejects(stream, /stream failed/);
    assertDetached('stream error', tracked);
  });

  await t.test('aiAsk rejection', async () => {
    const { AI } = await loadRaycastAIShim({ rejectAiAsk: true });
    const tracked = createTrackedAbortController();

    const stream = AI.ask('ipc rejection prompt', { signal: tracked.signal });

    await assert.rejects(stream, /aiAsk rejected/);
    assertDetached('aiAsk rejection', tracked);
  });

  await t.test('explicit abort', async () => {
    const { AI, electron } = await loadRaycastAIShim();
    const tracked = createTrackedAbortController();

    const stream = AI.ask('abort prompt', { signal: tracked.signal });
    const requestId = electron.aiAskCalls[0].requestId;

    tracked.controller.abort();

    await assert.rejects(stream, /Request aborted/);
    assert.deepEqual(electron.cancellations, [requestId]);
    assertDetached('explicit abort', tracked);
  });
});

function assertDetached(label, tracked) {
  const stats = tracked.stats();
  console.log(
    `AI.ask abort listeners after ${label}: active=${stats.active}, added=${stats.added}, removed=${stats.removed}`
  );
  assert.equal(stats.active, 0, `${label} should not retain caller abort listeners`);
  assert.equal(stats.added, 1, `${label} should attach one caller abort listener`);
  assert.equal(stats.removed, 1, `${label} should detach the caller abort listener`);
}

async function loadRaycastAIShim(options = {}) {
  const electron = createFakeElectron(options);
  const importNonce = `${Date.now()}-${Math.random()}`;
  const testWindow = {
    electron,
    addEventListener() {},
    removeEventListener() {},
  };
  const testDocument = {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  };

  globalThis.window = testWindow;
  globalThis.document = testDocument;

  const source = fs.readFileSync(RAYCAST_API_PATH, 'utf8');
  const start = source.indexOf('type AICreativity =');
  const aiExport = source.indexOf('export const AI =', start);
  const end = source.indexOf('// =====================================================================', aiExport);

  assert.notEqual(start, -1, 'expected to find AI section start');
  assert.notEqual(aiExport, -1, 'expected to find AI export');
  assert.notEqual(end, -1, 'expected to find AI section end');

  const moduleSource = `
async function refreshAIAvailabilityCache() {}
${source.slice(start, end)}
export const __testImportNonce = ${JSON.stringify(importNonce)};
`;

  const { code } = await transform(moduleSource, {
    loader: 'tsx',
    format: 'esm',
    target: 'es2020',
  });
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  const module = await import(dataUrl);
  return { AI: module.AI, electron };
}

function createFakeElectron(options = {}) {
  const handlers = {
    chunk: undefined,
    done: undefined,
    error: undefined,
  };
  const aiAskCalls = [];
  const cancellations = [];

  return {
    handlers,
    aiAskCalls,
    cancellations,
    onAIStreamChunk(handler) {
      handlers.chunk = handler;
      return () => {
        if (handlers.chunk === handler) handlers.chunk = undefined;
      };
    },
    onAIStreamDone(handler) {
      handlers.done = handler;
      return () => {
        if (handlers.done === handler) handlers.done = undefined;
      };
    },
    onAIStreamError(handler) {
      handlers.error = handler;
      return () => {
        if (handlers.error === handler) handlers.error = undefined;
      };
    },
    aiAsk(requestId, prompt, askOptions) {
      aiAskCalls.push({ requestId, prompt, askOptions });
      if (options.rejectAiAsk) {
        return Promise.reject(new Error('aiAsk rejected'));
      }
      return Promise.resolve();
    },
    aiCancel(requestId) {
      cancellations.push(requestId);
      return Promise.resolve();
    },
  };
}

function createTrackedAbortController() {
  const controller = new AbortController();
  const signal = controller.signal;
  const originalAddEventListener = signal.addEventListener.bind(signal);
  const originalRemoveEventListener = signal.removeEventListener.bind(signal);
  const activeAbortListeners = new Set();
  let added = 0;
  let removed = 0;

  Object.defineProperty(signal, 'addEventListener', {
    configurable: true,
    value(type, listener, options) {
      if (type === 'abort') {
        activeAbortListeners.add(listener);
        added += 1;
      }
      return originalAddEventListener(type, listener, options);
    },
  });

  Object.defineProperty(signal, 'removeEventListener', {
    configurable: true,
    value(type, listener, options) {
      if (type === 'abort' && activeAbortListeners.delete(listener)) {
        removed += 1;
      }
      return originalRemoveEventListener(type, listener, options);
    },
  });

  return {
    controller,
    signal,
    stats() {
      return {
        active: activeAbortListeners.size,
        added,
        removed,
      };
    },
  };
}
