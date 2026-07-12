#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build, transform } from 'esbuild';

const CHUNK_COUNT = 600;

let activeFrameScheduler = null;

const testWindow = {
  document: {
    addEventListener() {},
    removeEventListener() {},
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    body: { appendChild() {}, removeChild() {} },
  },
  navigator: { platform: 'test', userAgent: 'node' },
  localStorage: createTestStorage(),
  sessionStorage: createTestStorage(),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
  electron: {},
  location: { href: 'about:blank', reload() {} },
  requestAnimationFrame(callback) {
    if (activeFrameScheduler) return activeFrameScheduler.requestFrame(callback);
    return setTimeout(() => callback(Date.now()), 0);
  },
  cancelAnimationFrame(handle) {
    if (activeFrameScheduler) {
      activeFrameScheduler.cancelFrame(handle);
      return;
    }
    clearTimeout(handle);
  },
};

globalThis.window = testWindow;
globalThis.document = testWindow.document;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: testWindow.navigator,
});
globalThis.requestAnimationFrame = (callback) => testWindow.requestAnimationFrame(callback);
globalThis.cancelAnimationFrame = (handle) => testWindow.cancelAnimationFrame(handle);

const REACT_HOOK_IMPORT_STUB = `
const runtime = () => {
  const current = globalThis.__supercmdReactRuntime;
  if (!current) throw new Error('React hook runtime is not installed');
  return current;
};

const useState = (initialValue) => runtime().useState(initialValue);
const useRef = (initialValue) => runtime().useRef(initialValue);
const useCallback = (callback, deps) => runtime().useCallback(callback, deps);
const useEffect = (effect, deps) => runtime().useEffect(effect, deps);
`;

const {
  createRaycastAIStreamBatcher,
  useAI,
} = await importUseAiModule(path.resolve('src/renderer/src/raycast-api/hooks/use-ai.ts'));

function createTestStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    clear() {
      values.clear();
    },
  };
}

function makeChunks(count = CHUNK_COUNT) {
  return Array.from({ length: count }, (_, index) => `chunk-${index};`);
}

async function importUseAiModule(absPath) {
  const source = fs.readFileSync(absPath, 'utf8');
  const stubbedSource = source.replace(
    "import { useCallback, useEffect, useRef, useState } from 'react';",
    REACT_HOOK_IMPORT_STUB
  );

  assert.notEqual(stubbedSource, source, 'expected use-ai.ts React hook import to be stubbed');

  const { code } = await transform(stubbedSource, {
    loader: 'ts',
    format: 'esm',
    target: 'es2020',
  });
  const bundled = await build({
    bundle: true,
    format: 'esm',
    platform: 'browser',
    stdin: {
      contents: code,
      loader: 'js',
      resolveDir: path.dirname(absPath),
    },
    target: 'es2020',
    write: false,
  });
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64');
  return import(dataUrl);
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
      for (const callback of queuedCallbacks) callback(Date.now());
      return queuedCallbacks.length;
    },
    pendingFrameCount() {
      return callbacks.size;
    },
  };
}

function createManualTimerScheduler() {
  let nextTimerId = 1;
  const callbacks = new Map();

  return {
    setTimer(callback) {
      const id = nextTimerId;
      nextTimerId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimer(id) {
      callbacks.delete(id);
    },
    flushTimers() {
      const queuedCallbacks = Array.from(callbacks.values());
      callbacks.clear();
      for (const callback of queuedCallbacks) callback();
      return queuedCallbacks.length;
    },
    pendingTimerCount() {
      return callbacks.size;
    },
  };
}

function createFakeRaycastAI(chunks, options = {}) {
  const fullText = options.fullText ?? chunks.join('');
  const requests = [];

  return {
    requests,
    ask(prompt, askOptions = {}) {
      const dataHandlers = [];
      const signal = askOptions.signal;
      let settled = false;
      let resolvePromise;
      let rejectPromise;

      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });

      const request = {
        prompt,
        askOptions,
        promise,
        get settled() {
          return settled;
        },
        get signal() {
          return signal;
        },
        emitChunks(nextChunks = chunks) {
          for (const chunk of nextChunks) {
            if (signal?.aborted) return;
            for (const handler of dataHandlers) handler(chunk);
          }
        },
        resolve(text = fullText) {
          if (settled) return;
          settled = true;
          resolvePromise(text);
        },
        reject(error) {
          if (settled) return;
          settled = true;
          rejectPromise(error);
        },
        complete(nextChunks = chunks, text = fullText) {
          this.emitChunks(nextChunks);
          if (!signal?.aborted) this.resolve(text);
        },
      };

      signal?.addEventListener('abort', () => {
        request.reject(new Error('aborted'));
      }, { once: true });

      requests.push(request);

      const streamPromise = {
        on(event, handler) {
          if (event === 'data') dataHandlers.push(handler);
          return streamPromise;
        },
        then(onFulfilled, onRejected) {
          return promise.then(onFulfilled, onRejected);
        },
        catch(onRejected) {
          return promise.catch(onRejected);
        },
        finally(onFinally) {
          return promise.finally(onFinally);
        },
      };

      if (options.autoComplete) {
        queueMicrotask(() => request.complete());
      }

      return streamPromise;
    },
  };
}

function depsChanged(previousDeps, nextDeps) {
  if (!previousDeps || !nextDeps) return true;
  if (previousDeps.length !== nextDeps.length) return true;
  return previousDeps.some((value, index) => !Object.is(value, nextDeps[index]));
}

function createHookRunner(renderHook, initialArgs) {
  let args = initialArgs;
  let hookIndex = 0;
  let mounted = false;
  let pendingRender = false;
  let result;
  let renderCount = 0;
  let stateUpdateCount = 0;
  let dataVisibleUpdateCount = 0;
  let hasDataSnapshot = false;
  let lastDataSnapshot;
  const hooks = [];

  const runtime = {
    useState(initialValue) {
      const index = hookIndex;
      hookIndex += 1;

      if (!hooks[index]) {
        hooks[index] = {
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        };
      }

      const setState = (nextValueOrUpdater) => {
        const currentValue = hooks[index].value;
        const nextValue = typeof nextValueOrUpdater === 'function'
          ? nextValueOrUpdater(currentValue)
          : nextValueOrUpdater;

        if (Object.is(currentValue, nextValue)) return;

        hooks[index].value = nextValue;
        stateUpdateCount += 1;
        if (mounted) pendingRender = true;
      };

      return [hooks[index].value, setState];
    },
    useRef(initialValue) {
      const index = hookIndex;
      hookIndex += 1;

      if (!hooks[index]) hooks[index] = { current: initialValue };
      return hooks[index];
    },
    useCallback(callback, deps) {
      const index = hookIndex;
      hookIndex += 1;
      const previous = hooks[index];

      if (previous && !depsChanged(previous.deps, deps)) {
        return previous.callback;
      }

      hooks[index] = { callback, deps };
      return callback;
    },
    useEffect(effect, deps) {
      const index = hookIndex;
      hookIndex += 1;
      const previous = hooks[index];

      hooks[index] = {
        cleanup: previous?.cleanup,
        deps,
        effect,
        pending: !previous || depsChanged(previous.deps, deps),
      };
    },
  };

  const render = () => {
    hookIndex = 0;
    globalThis.__supercmdReactRuntime = runtime;
    result = renderHook(...args);
    renderCount += 1;

    if (result && typeof result === 'object' && 'data' in result) {
      if (hasDataSnapshot && result.data !== lastDataSnapshot) {
        dataVisibleUpdateCount += 1;
      }
      hasDataSnapshot = true;
      lastDataSnapshot = result.data;
    }

    for (const hook of hooks) {
      if (!hook?.pending) continue;
      hook.pending = false;
      if (typeof hook.cleanup === 'function') hook.cleanup();
      const cleanup = hook.effect();
      hook.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
  };

  const flush = () => {
    while (pendingRender) {
      pendingRender = false;
      render();
    }
  };

  return {
    mount() {
      mounted = true;
      render();
      flush();
      return result;
    },
    rerender(nextArgs = args) {
      args = nextArgs;
      pendingRender = true;
      flush();
      return result;
    },
    flush,
    unmount() {
      mounted = false;
      for (const hook of hooks) {
        if (typeof hook?.cleanup === 'function') {
          hook.cleanup();
          hook.cleanup = undefined;
        }
      }
    },
    get result() {
      return result;
    },
    get renderCount() {
      return renderCount;
    },
    get stateUpdateCount() {
      return stateUpdateCount;
    },
    get dataVisibleUpdateCount() {
      return dataVisibleUpdateCount;
    },
  };
}

async function drainMicrotasks(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

test('baseline fake Raycast useAI streaming updates visible state once per chunk', async () => {
  const chunks = makeChunks();
  const expectedData = chunks.join('');
  const ai = createFakeRaycastAI(chunks);
  let visibleData = '';
  let visibleUpdateCount = 0;

  testWindow.__supercmdRaycastAI = ai;
  const stream = testWindow.__supercmdRaycastAI.ask('baseline prompt', {
    signal: new AbortController().signal,
  });
  stream.on('data', (chunk) => {
    visibleData += chunk;
    visibleUpdateCount += 1;
  });

  ai.requests[0].complete();
  const finalData = await ai.requests[0].promise;

  assert.equal(finalData, expectedData);
  assert.equal(visibleData, expectedData);
  assert.equal(visibleUpdateCount, CHUNK_COUNT);
  console.log(`baseline useAI visible updates: ${visibleUpdateCount} for ${CHUNK_COUNT} chunks`);
});

test('Raycast useAI stream batcher coalesces many chunks into one visible frame update', () => {
  const chunks = makeChunks();
  const expectedData = chunks.join('');
  const ai = createFakeRaycastAI(chunks);
  const scheduler = createManualFrameScheduler();
  const dataRef = { current: '' };
  let visibleData = '';
  let visibleUpdateCount = 0;
  const batcher = createRaycastAIStreamBatcher({
    dataRef,
    setVisibleData(nextData) {
      visibleData = nextData;
      visibleUpdateCount += 1;
    },
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
  });

  const stream = ai.ask('batched prompt', {
    signal: new AbortController().signal,
  });
  stream.on('data', (chunk) => batcher.appendChunk(chunk));
  ai.requests[0].emitChunks();

  assert.equal(dataRef.current, expectedData);
  assert.equal(visibleData, '');
  assert.equal(visibleUpdateCount, 0);
  assert.equal(scheduler.pendingFrameCount(), 1);

  assert.equal(scheduler.flushFrames(), 1);
  assert.equal(visibleData, expectedData);
  assert.equal(visibleUpdateCount, 1);
  assert.ok(visibleUpdateCount < CHUNK_COUNT / 10);
  console.log(`batched useAI visible updates: ${visibleUpdateCount} for ${CHUNK_COUNT} chunks`);
});

test('Raycast useAI stream batcher uses timer flushes while the document is hidden', () => {
  const frameScheduler = createManualFrameScheduler();
  const timerScheduler = createManualTimerScheduler();
  const dataRef = { current: '' };
  let visibleData = '';
  let visibleUpdateCount = 0;
  const batcher = createRaycastAIStreamBatcher({
    dataRef,
    setVisibleData(nextData) {
      visibleData = nextData;
      visibleUpdateCount += 1;
    },
    requestFrame: frameScheduler.requestFrame,
    cancelFrame: frameScheduler.cancelFrame,
    setTimer: timerScheduler.setTimer,
    clearTimer: timerScheduler.clearTimer,
    isDocumentHidden: () => true,
  });

  batcher.appendChunk('background ');
  batcher.appendChunk('stream');

  assert.equal(frameScheduler.pendingFrameCount(), 0);
  assert.equal(timerScheduler.pendingTimerCount(), 1);
  assert.equal(timerScheduler.flushTimers(), 1);
  assert.equal(visibleData, 'background stream');
  assert.equal(visibleUpdateCount, 1);
});

test('useAI flushes complete final data and preserves final onData behavior', async () => {
  const chunks = makeChunks();
  const expectedData = chunks.join('');
  const scheduler = createManualFrameScheduler();
  const ai = createFakeRaycastAI(chunks, { autoComplete: true });
  const onDataCalls = [];

  activeFrameScheduler = scheduler;
  testWindow.__supercmdRaycastAI = ai;
  const runner = createHookRunner(useAI, [
    'final prompt',
    {
      stream: true,
      onData: (data) => onDataCalls.push(data),
    },
  ]);

  runner.mount();
  assert.equal(ai.requests.length, 1);

  await ai.requests[0].promise;
  await drainMicrotasks();
  runner.flush();

  assert.equal(runner.result.data, expectedData);
  assert.equal(runner.result.isLoading, false);
  assert.equal(runner.result.error, undefined);
  assert.deepEqual(onDataCalls, [expectedData]);
  assert.equal(scheduler.pendingFrameCount(), 0);
  assert.equal(runner.dataVisibleUpdateCount, 1);
  assert.ok(runner.renderCount < CHUNK_COUNT / 10);
  console.log(`hook useAI renders: ${runner.renderCount}; visible data updates: ${runner.dataVisibleUpdateCount} for ${CHUNK_COUNT} chunks`);

  activeFrameScheduler = null;
});

test('useAI flushes pending streamed data before surfacing an error', async () => {
  const chunks = ['partial ', 'answer'];
  const expectedData = chunks.join('');
  const scheduler = createManualFrameScheduler();
  const ai = createFakeRaycastAI(chunks);
  const onErrorCalls = [];

  activeFrameScheduler = scheduler;
  testWindow.__supercmdRaycastAI = ai;
  const runner = createHookRunner(useAI, [
    'error prompt',
    {
      stream: true,
      onError: (error) => onErrorCalls.push(error),
    },
  ]);

  runner.mount();
  const request = ai.requests[0];
  request.emitChunks();
  assert.equal(scheduler.pendingFrameCount(), 1);

  request.reject(new Error('network failed'));
  await request.promise.catch(() => {});
  await drainMicrotasks();
  runner.flush();

  assert.equal(runner.result.data, expectedData);
  assert.equal(runner.result.isLoading, false);
  assert.equal(runner.result.error?.message, 'network failed');
  assert.equal(onErrorCalls.length, 1);
  assert.equal(onErrorCalls[0].message, 'network failed');
  assert.equal(scheduler.pendingFrameCount(), 0);
  assert.equal(scheduler.flushFrames(), 0);

  activeFrameScheduler = null;
});

test('useAI abort cancels a pending stream flush', async () => {
  const chunks = ['stale partial'];
  const scheduler = createManualFrameScheduler();
  const ai = createFakeRaycastAI(chunks);

  activeFrameScheduler = scheduler;
  testWindow.__supercmdRaycastAI = ai;
  const runner = createHookRunner(useAI, ['abort prompt', { stream: true }]);

  runner.mount();
  const request = ai.requests[0];
  request.emitChunks();

  assert.equal(runner.result.data, '');
  assert.equal(scheduler.pendingFrameCount(), 1);

  runner.unmount();
  await request.promise.catch(() => {});
  await drainMicrotasks();

  assert.equal(request.signal.aborted, true);
  assert.equal(scheduler.pendingFrameCount(), 0);
  assert.equal(scheduler.flushFrames(), 0);
  assert.equal(runner.result.data, '');

  activeFrameScheduler = null;
});
