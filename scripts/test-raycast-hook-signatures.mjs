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
    execCommand: () => Promise.reject(new Error('execCommand stub not configured')),
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
    WeakMap,
    WeakSet,
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

async function flushAsync() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

const { useCachedPromise } = loadTsModule('src/renderer/src/raycast-api/hooks/use-cached-promise.ts');
const { useExec } = loadTsModule('src/renderer/src/raycast-api/hooks/use-exec.ts');

test('useCachedPromise accepts cyclic large args without render-time signature crashes', async () => {
  const cyclic = {
    rows: Array.from({ length: 2000 }, (_, index) => ({ index, label: `row-${index}` })),
  };
  cyclic.self = cyclic;
  const hookArgs = [cyclic];
  const calls = [];
  const host = new HookHost(() => useCachedPromise(async (...args) => {
    calls.push(args);
    return args[0].rows.length;
  }, hookArgs));

  assert.doesNotThrow(() => host.render());
  await flushAsync();

  assert.equal(calls.length, 1);
  assert.equal(host.output.data, 2000);
  assert.equal(host.output.error, undefined);

  host.render();
  await flushAsync();
  assert.equal(calls.length, 1, 'stable arg identity should not revalidate on unrelated rerenders');

  host.unmount();
});

test('useExec re-runs when command, args, or execution options change', async () => {
  const execCalls = [];
  const onDataCalls = [];
  let command = 'first-command';
  let execArgs = ['one'];
  let cwd = '/tmp/one';

  windowShim.electron.execCommand = async (nextCommand, nextArgs, nextOptions) => {
    execCalls.push({ command: nextCommand, args: nextArgs, cwd: nextOptions.cwd });
    return {
      stdout: `${nextCommand}:${nextArgs.join(',')}:${nextOptions.cwd}\n`,
      stderr: '',
      exitCode: 0,
    };
  };

  const host = new HookHost(() => useExec(command, execArgs, {
    cwd,
    onData: (data) => onDataCalls.push(data),
  }));

  host.render();
  await flushAsync();
  assert.deepEqual(execCalls, [{ command: 'first-command', args: ['one'], cwd: '/tmp/one' }]);

  execArgs = ['two'];
  host.render();
  await flushAsync();
  assert.deepEqual(execCalls.at(-1), { command: 'first-command', args: ['two'], cwd: '/tmp/one' });

  cwd = '/tmp/two';
  host.render();
  await flushAsync();
  assert.deepEqual(execCalls.at(-1), { command: 'first-command', args: ['two'], cwd: '/tmp/two' });

  command = 'second-command';
  host.render();
  await flushAsync();
  assert.deepEqual(execCalls.at(-1), { command: 'second-command', args: ['two'], cwd: '/tmp/two' });
  assert.equal(execCalls.length, 4);
  assert.deepEqual(onDataCalls, [
    'first-command:one:/tmp/one',
    'first-command:two:/tmp/one',
    'first-command:two:/tmp/two',
    'second-command:two:/tmp/two',
  ]);

  host.unmount();
});
