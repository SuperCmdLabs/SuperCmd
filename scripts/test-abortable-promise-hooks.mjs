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
    AbortController,
    Array,
    console,
    Date,
    Error,
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

function currentController(abortable) {
  const controller = abortable.current;
  assert.ok(controller instanceof AbortController, 'abortable.current should be an AbortController for each run');
  return controller;
}

const { usePromise } = loadTsModule('src/renderer/src/raycast-api/hooks/use-promise.ts');
const { useCachedPromise } = loadTsModule('src/renderer/src/raycast-api/hooks/use-cached-promise.ts');

test('usePromise aborts the previous abortable run before revalidate starts another run', async () => {
  const abortable = { current: null };
  const controllers = [];
  const pending = [];
  const fn = () => {
    controllers.push(currentController(abortable));
    const run = deferred();
    pending.push(run);
    return run.promise;
  };
  const host = new HookHost(() => usePromise(fn, [], { abortable }));

  host.render();
  await flushAsync();
  assert.equal(controllers.length, 1);

  host.output.revalidate();
  await flushAsync();

  assert.equal(controllers.length, 2);
  assert.equal(controllers[0].signal.aborted, true);
  assert.notEqual(controllers[1], controllers[0]);
  assert.equal(controllers[1].signal.aborted, false);

  host.unmount();
});

test('useCachedPromise aborts the previous abortable run before revalidate starts another run', async () => {
  const abortable = { current: null };
  const controllers = [];
  const pending = [];
  const fn = () => {
    controllers.push(currentController(abortable));
    const run = deferred();
    pending.push(run);
    return run.promise;
  };
  const host = new HookHost(() => useCachedPromise(fn, [], { abortable }));

  host.render();
  await flushAsync();
  assert.equal(controllers.length, 1);

  host.output.revalidate();
  await flushAsync();

  assert.equal(controllers.length, 2);
  assert.equal(controllers[0].signal.aborted, true);
  assert.notEqual(controllers[1], controllers[0]);
  assert.equal(controllers[1].signal.aborted, false);

  host.unmount();
});

test('usePromise aborts active abortable work on unmount and clears the abortable ref', async () => {
  const abortable = { current: null };
  const controllers = [];
  const fn = () => {
    controllers.push(currentController(abortable));
    return deferred().promise;
  };
  const host = new HookHost(() => usePromise(fn, [], { abortable }));

  host.render();
  await flushAsync();
  host.unmount();

  assert.equal(controllers.length, 1);
  assert.equal(controllers[0].signal.aborted, true);
  assert.equal(abortable.current, null);
});

test('useCachedPromise aborts active abortable work on unmount and clears the abortable ref', async () => {
  const abortable = { current: null };
  const controllers = [];
  const fn = () => {
    controllers.push(currentController(abortable));
    return deferred().promise;
  };
  const host = new HookHost(() => useCachedPromise(fn, [], { abortable }));

  host.render();
  await flushAsync();
  host.unmount();

  assert.equal(controllers.length, 1);
  assert.equal(controllers[0].signal.aborted, true);
  assert.equal(abortable.current, null);
});

test('usePromise keeps the latest abortable result when an older aborted run resolves later', async () => {
  const abortable = { current: null };
  const pending = [];
  const onDataCalls = [];
  const fn = () => {
    currentController(abortable);
    const run = deferred();
    pending.push(run);
    return run.promise;
  };
  const host = new HookHost(() => usePromise(fn, [], { abortable, onData: (data) => onDataCalls.push(data) }));

  host.render();
  await flushAsync();
  host.output.revalidate();
  await flushAsync();

  pending[1].resolve('latest');
  await flushAsync();
  assert.equal(host.output.data, 'latest');
  assert.deepEqual(onDataCalls, ['latest']);

  pending[0].resolve('stale');
  await flushAsync();
  assert.equal(host.output.data, 'latest');
  assert.deepEqual(onDataCalls, ['latest']);

  host.unmount();
});

test('useCachedPromise keeps the latest abortable result when an older aborted run resolves later', async () => {
  const abortable = { current: null };
  const pending = [];
  const onDataCalls = [];
  const fn = () => {
    currentController(abortable);
    const run = deferred();
    pending.push(run);
    return run.promise;
  };
  const host = new HookHost(() => useCachedPromise(fn, [], { abortable, onData: (data) => onDataCalls.push(data) }));

  host.render();
  await flushAsync();
  host.output.revalidate();
  await flushAsync();

  pending[1].resolve('latest');
  await flushAsync();
  assert.equal(host.output.data, 'latest');
  assert.deepEqual(onDataCalls, ['latest']);

  pending[0].resolve('stale');
  await flushAsync();
  assert.equal(host.output.data, 'latest');
  assert.deepEqual(onDataCalls, ['latest']);

  host.unmount();
});

test('usePromise keeps the latest default result when an older run resolves later', async () => {
  const pending = [];
  const onDataCalls = [];
  const fn = () => {
    const run = deferred();
    pending.push(run);
    return run.promise;
  };
  const host = new HookHost(() => usePromise(fn, [], { onData: (data) => onDataCalls.push(data) }));

  host.render();
  await flushAsync();
  host.output.revalidate();
  await flushAsync();

  pending[1].resolve('latest');
  await flushAsync();
  assert.equal(host.output.data, 'latest');
  assert.deepEqual(onDataCalls, ['latest']);

  pending[0].resolve('stale');
  await flushAsync();
  assert.equal(host.output.data, 'latest');
  assert.deepEqual(onDataCalls, ['latest']);

  host.unmount();
});

test('useCachedPromise keeps the latest default result when an older run resolves later', async () => {
  const pending = [];
  const onDataCalls = [];
  const fn = () => {
    const run = deferred();
    pending.push(run);
    return run.promise;
  };
  const host = new HookHost(() => useCachedPromise(fn, [], { onData: (data) => onDataCalls.push(data) }));

  host.render();
  await flushAsync();
  host.output.revalidate();
  await flushAsync();

  pending[1].resolve('latest');
  await flushAsync();
  assert.equal(host.output.data, 'latest');
  assert.deepEqual(onDataCalls, ['latest']);

  pending[0].resolve('stale');
  await flushAsync();
  assert.equal(host.output.data, 'latest');
  assert.deepEqual(onDataCalls, ['latest']);

  host.unmount();
});

test('usePromise ignores stale default results while a newer run is still loading', async () => {
  const pending = [];
  const onDataCalls = [];
  const fn = () => {
    const run = deferred();
    pending.push(run);
    return run.promise;
  };
  const host = new HookHost(() => usePromise(fn, [], { onData: (data) => onDataCalls.push(data) }));

  host.render();
  await flushAsync();
  host.output.revalidate();
  await flushAsync();

  pending[0].resolve('stale');
  await flushAsync();
  assert.equal(host.output.data, undefined);
  assert.equal(host.output.isLoading, true);
  assert.deepEqual(onDataCalls, []);

  pending[1].resolve('latest');
  await flushAsync();
  assert.equal(host.output.data, 'latest');
  assert.equal(host.output.isLoading, false);
  assert.deepEqual(onDataCalls, ['latest']);

  host.unmount();
});

test('useCachedPromise ignores stale default results while a newer run is still loading', async () => {
  const pending = [];
  const onDataCalls = [];
  const fn = () => {
    const run = deferred();
    pending.push(run);
    return run.promise;
  };
  const host = new HookHost(() => useCachedPromise(fn, [], { onData: (data) => onDataCalls.push(data) }));

  host.render();
  await flushAsync();
  host.output.revalidate();
  await flushAsync();

  pending[0].resolve('stale');
  await flushAsync();
  assert.equal(host.output.data, undefined);
  assert.equal(host.output.isLoading, true);
  assert.deepEqual(onDataCalls, []);

  pending[1].resolve('latest');
  await flushAsync();
  assert.equal(host.output.data, 'latest');
  assert.equal(host.output.isLoading, false);
  assert.deepEqual(onDataCalls, ['latest']);

  host.unmount();
});

test('usePromise ignores stale default errors after a newer run resolves', async () => {
  const pending = [];
  const onErrorCalls = [];
  const fn = () => {
    const run = deferred();
    pending.push(run);
    return run.promise;
  };
  const host = new HookHost(() => usePromise(fn, [], { onError: (error) => onErrorCalls.push(error.message) }));

  host.render();
  await flushAsync();
  host.output.revalidate();
  await flushAsync();

  pending[1].resolve('latest');
  await flushAsync();
  pending[0].reject(new Error('stale failure'));
  await flushAsync();

  assert.equal(host.output.data, 'latest');
  assert.equal(host.output.error, undefined);
  assert.deepEqual(onErrorCalls, []);

  host.unmount();
});

test('useCachedPromise ignores stale default errors after a newer run resolves', async () => {
  const pending = [];
  const onErrorCalls = [];
  const fn = () => {
    const run = deferred();
    pending.push(run);
    return run.promise;
  };
  const host = new HookHost(() => useCachedPromise(fn, [], { onError: (error) => onErrorCalls.push(error.message) }));

  host.render();
  await flushAsync();
  host.output.revalidate();
  await flushAsync();

  pending[1].resolve('latest');
  await flushAsync();
  pending[0].reject(new Error('stale failure'));
  await flushAsync();

  assert.equal(host.output.data, 'latest');
  assert.equal(host.output.error, undefined);
  assert.deepEqual(onErrorCalls, []);

  host.unmount();
});
