#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

let activeHost = null;

const fakeReact = {
  useCallback: (...args) => activeHost.useCallback(...args),
  useEffect: (...args) => activeHost.useEffect(...args),
  useMemo: (...args) => activeHost.useMemo(...args),
  useRef: (...args) => activeHost.useRef(...args),
  useState: (...args) => activeHost.useState(...args),
};

const windowShim = {
  electron: {
    httpRequest: () => Promise.reject(new Error('httpRequest stub not configured')),
  },
};

const moduleCache = new Map();

function loadTsModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath).exports;

  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: resolvedPath,
  });

  const module = { exports: {} };
  moduleCache.set(resolvedPath, module);
  const localRequire = (request) => {
    if (request === 'react') return fakeReact;
    if (request.startsWith('.')) {
      const candidate = path.resolve(path.dirname(resolvedPath), request);
      for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
        const nextPath = `${candidate}${suffix}`;
        if (fs.existsSync(nextPath) && fs.statSync(nextPath).isFile()) {
          if (nextPath.endsWith('.ts') || nextPath.endsWith('.tsx')) return loadTsModule(nextPath);
          return require(nextPath);
        }
      }
    }
    return require(request);
  };

  const sandbox = {
    Array,
    Blob,
    console,
    Date,
    Error,
    FormData,
    Headers,
    JSON,
    Map,
    Math,
    module,
    Object,
    Promise,
    queueMicrotask,
    RegExp,
    require: localRequire,
    setTimeout,
    clearTimeout,
    String,
    Symbol,
    URL,
    URLSearchParams,
    window: windowShim,
    exports: module.exports,
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: resolvedPath });
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
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function httpResponse(body, status = 200) {
  return {
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: { 'content-type': 'application/json' },
    url: 'https://api.test/items',
    bodyText: JSON.stringify(body),
  };
}

const { useFetch } = loadTsModule('src/renderer/src/raycast-api/hooks/use-fetch.ts');

test('useFetch keeps the latest revalidate result when an older request resolves later', async () => {
  const pending = [];
  const requestedUrls = [];
  const onDataCalls = [];

  windowShim.electron.httpRequest = (request) => {
    requestedUrls.push(request.url);
    const run = deferred();
    pending.push(run);
    return run.promise;
  };

  const host = new HookHost(() => useFetch('https://api.test/items', {
    onData: (data) => onDataCalls.push(data.value),
  }));

  host.render();
  await flushAsync();
  assert.equal(pending.length, 1);

  host.output.revalidate();
  await flushAsync();
  assert.equal(pending.length, 2);
  assert.deepEqual(requestedUrls, ['https://api.test/items', 'https://api.test/items']);

  pending[1].resolve(httpResponse({ value: 'latest' }));
  await flushAsync();
  assert.deepEqual(host.output.data, { value: 'latest' });
  assert.equal(host.output.isLoading, false);
  assert.deepEqual(onDataCalls, ['latest']);

  pending[0].resolve(httpResponse({ value: 'stale' }));
  await flushAsync();
  assert.deepEqual(host.output.data, { value: 'latest' });
  assert.equal(host.output.error, undefined);
  assert.deepEqual(onDataCalls, ['latest']);

  host.unmount();
});

test('useFetch refetches when a function URL resolves to a new request input', async () => {
  const pending = [];
  const requestedUrls = [];
  let query = 'one';

  windowShim.electron.httpRequest = (request) => {
    requestedUrls.push(request.url);
    const run = deferred();
    pending.push(run);
    return run.promise;
  };

  const host = new HookHost(() => useFetch(() => `https://api.test/search?q=${query}`));

  host.render();
  await flushAsync();
  assert.equal(pending.length, 1);
  assert.deepEqual(requestedUrls, ['https://api.test/search?q=one']);

  query = 'two';
  host.render();
  await flushAsync();
  assert.equal(pending.length, 2);
  assert.deepEqual(requestedUrls, [
    'https://api.test/search?q=one',
    'https://api.test/search?q=two',
  ]);

  pending[1].resolve(httpResponse({ value: 'latest' }));
  await flushAsync();
  assert.deepEqual(host.output.data, { value: 'latest' });
  assert.equal(pending.length, 2);

  pending[0].resolve(httpResponse({ value: 'stale' }));
  await flushAsync();
  assert.deepEqual(host.output.data, { value: 'latest' });
  assert.equal(pending.length, 2);

  host.unmount();
});

test('useFetch does not loop when a function URL resolves non-deterministically', async () => {
  const pending = [];
  const requestedUrls = [];
  let nonce = 0;

  windowShim.electron.httpRequest = (request) => {
    requestedUrls.push(request.url);
    const run = deferred();
    pending.push(run);
    return run.promise;
  };

  const host = new HookHost(() => useFetch(() => `https://api.test/search?nonce=${nonce++}`));

  host.render();
  await flushAsync();
  assert.equal(pending.length, 1);
  assert.deepEqual(requestedUrls, ['https://api.test/search?nonce=0']);

  pending[0].resolve(httpResponse({ value: 'loaded' }));
  await flushAsync();

  assert.deepEqual(host.output.data, { value: 'loaded' });
  assert.equal(host.output.isLoading, false);
  assert.equal(pending.length, 1);
  assert.deepEqual(requestedUrls, ['https://api.test/search?nonce=0']);

  host.unmount();
});
