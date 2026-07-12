#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const hookPath = path.resolve('src/renderer/src/raycast-api/hooks/use-stream-json.ts');

let activeHost = null;
let activeFetch = null;

const fakeReact = {
  useCallback: (...args) => activeHost.useCallback(...args),
  useEffect: (...args) => activeHost.useEffect(...args),
  useMemo: (...args) => activeHost.useMemo(...args),
  useRef: (...args) => activeHost.useRef(...args),
  useState: (...args) => activeHost.useState(...args),
};

const { useStreamJSON } = loadUseStreamJson();

function loadUseStreamJson() {
  const source = fs.readFileSync(hookPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: hookPath,
  });

  const module = { exports: {} };
  const sandbox = {
    AbortController,
    AbortSignal,
    Array,
    Blob,
    console,
    Error,
    FormData,
    Headers,
    JSON,
    Map,
    Math,
    module,
    Object,
    Promise,
    RegExp,
    Request,
    Response,
    String,
    URL,
    URLSearchParams,
    exports: module.exports,
    fetch: (...args) => {
      if (!activeFetch) throw new Error('test fetch is not installed');
      return activeFetch(...args);
    },
    queueMicrotask,
    require: (request) => {
      if (request === 'react') return fakeReact;
      return require(request);
    },
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(transpiled.outputText, sandbox, { filename: hookPath });
  return module.exports;
}

class HookHost {
  constructor(renderHook) {
    this.renderHook = renderHook;
    this.hookIndex = 0;
    this.hooks = [];
    this.pendingEffects = [];
    this.output = undefined;
    this.isRendering = false;
    this.isFlushingEffects = false;
    this.needsRender = false;
    this.unmounted = false;
    this.stateUpdatesAfterUnmount = 0;
  }

  render() {
    if (this.unmounted) return this.output;
    this.hookIndex = 0;
    this.pendingEffects = [];
    this.isRendering = true;
    const previousHost = activeHost;
    activeHost = this;
    try {
      this.output = this.renderHook();
    } finally {
      activeHost = previousHost;
      this.isRendering = false;
    }
    this.flushEffects();
    return this.output;
  }

  flushEffects() {
    this.isFlushingEffects = true;
    try {
      for (const { index, effect } of this.pendingEffects) {
        const record = this.hooks[index];
        if (record.cleanup) record.cleanup();
        const cleanup = effect();
        record.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
    } finally {
      this.isFlushingEffects = false;
    }

    if (this.needsRender && !this.unmounted) {
      this.needsRender = false;
      this.render();
    }
  }

  scheduleRender() {
    if (this.unmounted) return;
    if (this.isRendering || this.isFlushingEffects) {
      this.needsRender = true;
      return;
    }
    this.render();
  }

  useState(initialValue) {
    const index = this.hookIndex++;
    if (!this.hooks[index]) {
      this.hooks[index] = {
        state: typeof initialValue === 'function' ? initialValue() : initialValue,
      };
    }
    const setState = (nextValue) => {
      const record = this.hooks[index];
      const next = typeof nextValue === 'function' ? nextValue(record.state) : nextValue;
      if (Object.is(record.state, next)) return;
      if (this.unmounted) {
        this.stateUpdatesAfterUnmount += 1;
        return;
      }
      record.state = next;
      this.scheduleRender();
    };
    return [this.hooks[index].state, setState];
  }

  useRef(initialValue) {
    const index = this.hookIndex++;
    if (!this.hooks[index]) {
      this.hooks[index] = { current: initialValue };
    }
    return this.hooks[index];
  }

  useEffect(effect, deps) {
    const index = this.hookIndex++;
    const record = this.hooks[index] || {};
    const changed = !record.deps || !depsEqual(record.deps, deps);
    this.hooks[index] = { ...record, deps };
    if (changed) {
      this.pendingEffects.push({ index, effect });
    }
  }

  useCallback(callback, deps) {
    return this.useMemo(() => callback, deps);
  }

  useMemo(factory, deps) {
    const index = this.hookIndex++;
    const record = this.hooks[index];
    if (record && depsEqual(record.deps, deps)) return record.value;
    const value = factory();
    this.hooks[index] = { value, deps };
    return value;
  }

  unmount() {
    this.unmounted = true;
    for (const record of this.hooks) {
      if (record?.cleanup) {
        record.cleanup();
        record.cleanup = undefined;
      }
    }
  }
}

function depsEqual(previousDeps, nextDeps) {
  if (!previousDeps || !nextDeps || previousDeps.length !== nextDeps.length) return false;
  return previousDeps.every((value, index) => Object.is(value, nextDeps[index]));
}

function createFetchMock() {
  const requests = [];

  return {
    requests,
    fetch(url, init = {}) {
      const pending = deferred();
      const request = {
        url,
        init,
        promise: pending.promise,
        resolveJson(value, responseOptions) {
          pending.resolve(jsonResponse(value, responseOptions));
        },
        reject(error) {
          pending.reject(error);
        },
      };
      requests.push(request);
      return pending.promise;
    },
  };
}

function jsonResponse(value, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return value;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushAsync() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

test('useStreamJSON keeps the latest revalidation result and callbacks', async () => {
  const fetchMock = createFetchMock();
  activeFetch = fetchMock.fetch;
  const onData = [];
  const host = new HookHost(() => useStreamJSON('https://example.test/items', {
    onData: (item) => onData.push(item.id),
  }));

  host.render();
  await flushAsync();
  assert.equal(fetchMock.requests.length, 1);

  host.output.revalidate();
  await flushAsync();
  assert.equal(fetchMock.requests.length, 2);

  fetchMock.requests[1].resolveJson([{ id: 'latest' }]);
  await flushAsync();
  assert.deepEqual(host.output.data, [{ id: 'latest' }]);
  assert.deepEqual(onData, ['latest']);

  fetchMock.requests[0].resolveJson([{ id: 'stale' }]);
  await flushAsync();

  assert.deepEqual(host.output.data, [{ id: 'latest' }]);
  assert.deepEqual(onData, ['latest']);
  assert.equal(fetchMock.requests[0].init.signal?.aborted, true, 'previous fetch signal should be aborted');

  host.unmount();
});

test('useStreamJSON suppresses stale errors from older runs', async () => {
  const fetchMock = createFetchMock();
  activeFetch = fetchMock.fetch;
  const onError = [];
  const host = new HookHost(() => useStreamJSON('https://example.test/items', {
    onError: (error) => onError.push(error.message),
  }));

  host.render();
  await flushAsync();

  host.output.revalidate();
  await flushAsync();
  assert.equal(fetchMock.requests.length, 2);

  fetchMock.requests[1].resolveJson([{ id: 'latest' }]);
  await flushAsync();
  fetchMock.requests[0].reject(new Error('stale failure'));
  await flushAsync();

  assert.equal(host.output.error, undefined);
  assert.deepEqual(onError, []);
  assert.deepEqual(host.output.data, [{ id: 'latest' }]);

  host.unmount();
});

test('useStreamJSON aborts and ignores active work after unmount', async () => {
  const fetchMock = createFetchMock();
  activeFetch = fetchMock.fetch;
  const onData = [];
  const onError = [];
  const host = new HookHost(() => useStreamJSON('https://example.test/items', {
    onData: (item) => onData.push(item.id),
    onError: (error) => onError.push(error.message),
  }));

  host.render();
  await flushAsync();
  assert.equal(fetchMock.requests.length, 1);

  host.unmount();
  assert.equal(fetchMock.requests[0].init.signal?.aborted, true, 'active fetch signal should be aborted on unmount');

  fetchMock.requests[0].resolveJson([{ id: 'late-after-unmount' }]);
  await flushAsync();

  assert.equal(host.stateUpdatesAfterUnmount, 0);
  assert.deepEqual(onData, []);
  assert.deepEqual(onError, []);
});

test('useStreamJSON composes caller signal with lifecycle aborts', async () => {
  const fetchMock = createFetchMock();
  activeFetch = fetchMock.fetch;
  const callerController = new AbortController();
  const host = new HookHost(() => useStreamJSON('https://example.test/items', {
    signal: callerController.signal,
  }));

  host.render();
  await flushAsync();
  assert.equal(fetchMock.requests.length, 1);
  const firstSignal = fetchMock.requests[0].init.signal;
  assert.ok(firstSignal instanceof AbortSignal, 'fetch should receive an abort signal');

  host.output.revalidate();
  await flushAsync();
  assert.equal(fetchMock.requests.length, 2);
  assert.equal(firstSignal.aborted, true, 'lifecycle abort should cancel the previous composed signal');
  assert.equal(callerController.signal.aborted, false, 'lifecycle abort should not abort the caller-owned signal');

  const secondSignal = fetchMock.requests[1].init.signal;
  assert.ok(secondSignal instanceof AbortSignal, 'revalidated fetch should receive an abort signal');
  callerController.abort();
  assert.equal(secondSignal.aborted, true, 'caller abort should cancel the composed signal');

  host.unmount();
});
