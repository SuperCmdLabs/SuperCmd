#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionViewPath = path.join(root, 'src/renderer/src/ExtensionView.tsx');

function captureFromOptions(options) {
  if (typeof options === 'boolean') return options;
  return Boolean(options?.capture);
}

function createFakeEventTarget(label) {
  const listenerIds = new WeakMap();
  const listeners = new Map();
  let nextListenerId = 1;

  function listenerId(listener) {
    if (!listener || (typeof listener !== 'function' && typeof listener !== 'object')) {
      return 'null';
    }
    let id = listenerIds.get(listener);
    if (!id) {
      id = nextListenerId++;
      listenerIds.set(listener, id);
    }
    return id;
  }

  function key(type, listener, options) {
    return `${String(type)}:${captureFromOptions(options)}:${listenerId(listener)}`;
  }

  return {
    label,
    listeners,
    addEventListener(type, listener, options) {
      if (!listener) return;
      listeners.set(key(type, listener, options), { type, listener, options });
    },
    removeEventListener(type, listener, options) {
      listeners.delete(key(type, listener, options));
    },
  };
}

function createHostWindow() {
  let nextTimerId = 1;
  const intervals = new Set();
  const timeouts = new Set();
  const rafs = new Set();
  const windowTarget = createFakeEventTarget('window');
  const documentTarget = createFakeEventTarget('document');

  const hostWindow = {
    document: documentTarget,
    navigator: { userAgent: 'SuperCmd lifecycle harness' },
    location: { href: 'supercmd://lifecycle-harness' },
    electron: { marker: 'electron-facade' },
    setInterval() {
      const id = nextTimerId++;
      intervals.add(id);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout() {
      const id = nextTimerId++;
      timeouts.add(id);
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    requestAnimationFrame() {
      const id = nextTimerId++;
      rafs.add(id);
      return id;
    },
    cancelAnimationFrame(id) {
      rafs.delete(id);
    },
    addEventListener: windowTarget.addEventListener,
    removeEventListener: windowTarget.removeEventListener,
  };

  hostWindow.window = hostWindow;
  hostWindow.self = hostWindow;
  hostWindow.globalThis = hostWindow;
  hostWindow.global = hostWindow;
  hostWindow.top = hostWindow;
  hostWindow.parent = hostWindow;
  documentTarget.defaultView = hostWindow;

  return {
    hostWindow,
    hostDocument: documentTarget,
    snapshot() {
      return {
        intervals: intervals.size,
        timeouts: timeouts.size,
        rafs: rafs.size,
        windowListeners: windowTarget.listeners.size,
        documentListeners: documentTarget.listeners.size,
        total:
          intervals.size +
          timeouts.size +
          rafs.size +
          windowTarget.listeners.size +
          documentTarget.listeners.size,
      };
    },
    reset() {
      intervals.clear();
      timeouts.clear();
      rafs.clear();
      windowTarget.listeners.clear();
      documentTarget.listeners.clear();
    },
  };
}

const host = createHostWindow();
globalThis.window = host.hostWindow;
globalThis.document = host.hostDocument;
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};

function extractLifecycleSource() {
  const source = fs.readFileSync(extensionViewPath, 'utf8');
  const start = source.indexOf('type ExtensionTimerHandle');
  const end = source.indexOf('/**\n * JS shim for the `swift:AppleReminders`', start);
  assert.notEqual(start, -1, 'Could not locate lifecycle registry start marker');
  assert.notEqual(end, -1, 'Could not locate lifecycle registry end marker');
  return source
    .slice(start, end)
    .replace(/\bexport\s+(?=(interface|function)\b)/g, '');
}

function loadLifecycleHarness() {
  const source = `
    ${extractLifecycleSource()}
    globalThis.__extensionLifecycleHarness = {
      clearTimerRegistry,
      createExtensionLifecycleScope,
      createTimerRegistry,
    };
  `;
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: extensionViewPath,
  });
  const sandbox = {
    console,
    window: host.hostWindow,
    document: host.hostDocument,
  };
  vm.createContext(sandbox);
  vm.runInContext(transpiled.outputText, sandbox, { filename: extensionViewPath });
  return sandbox.__extensionLifecycleHarness;
}

const {
  clearTimerRegistry,
  createExtensionLifecycleScope,
  createTimerRegistry,
} = loadLifecycleHarness();

const extensionCode = `
const onResize = () => {};
const onVisibilityChange = () => {};
const intervalId = window.setInterval(() => {}, 60000);
window.addEventListener("resize", onResize);
window.document.addEventListener("visibilitychange", onVisibilityChange);

exports.default = function LifecycleProbe() {
  return {
    intervalId,
    compatibility: {
      documentRead: Boolean(window.document) && window.document === document,
      navigatorRead: window.navigator.userAgent,
      locationRead: window.location.href,
      electronRead: window.electron.marker,
      globalWindowRead: globalThis.window === window,
      defaultViewRead: document.defaultView === window
    }
  };
};
`;

const EXTENSION_WRAPPER_ARGUMENTS = [
  'exports',
  'require',
  'module',
  '__filename',
  '__dirname',
  'process',
  'Buffer',
  'global',
  'globalThis',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'window',
  'document',
  'navigator',
  '__scDynamicImport',
];

function createBareTimerApi(registry) {
  const setIntervalTracked = (callback, timeout, ...args) => {
    const id = host.hostWindow.setInterval(callback, timeout, ...args);
    registry.intervals.add(id);
    registry.intervalClearers.set(id, host.hostWindow.clearInterval);
    return id;
  };
  const clearIntervalTracked = (id) => {
    registry.intervals.delete(id);
    registry.intervalClearers.delete(id);
    host.hostWindow.clearInterval(id);
  };
  const setTimeoutTracked = (callback, timeout, ...args) => {
    const id = host.hostWindow.setTimeout(callback, timeout, ...args);
    registry.timeouts.add(id);
    registry.timeoutClearers.set(id, host.hostWindow.clearTimeout);
    return id;
  };
  const clearTimeoutTracked = (id) => {
    registry.timeouts.delete(id);
    registry.timeoutClearers.delete(id);
    host.hostWindow.clearTimeout(id);
  };
  const requestAnimationFrameTracked = (callback) => {
    const id = host.hostWindow.requestAnimationFrame(callback);
    registry.rafs.add(id);
    registry.rafClearers.set(id, host.hostWindow.cancelAnimationFrame);
    return id;
  };
  const cancelAnimationFrameTracked = (id) => {
    registry.rafs.delete(id);
    registry.rafClearers.delete(id);
    host.hostWindow.cancelAnimationFrame(id);
  };
  return {
    setImmediate: (callback, ...args) => setTimeoutTracked(() => callback(...args), 0),
    clearImmediate: clearTimeoutTracked,
    setInterval: setIntervalTracked,
    clearInterval: clearIntervalTracked,
    setTimeout: setTimeoutTracked,
    clearTimeout: clearTimeoutTracked,
    requestAnimationFrame: requestAnimationFrameTracked,
    cancelAnimationFrame: cancelAnimationFrameTracked,
  };
}

function runWrapper({ lifecycleScope, registry, scoped }) {
  const moduleExports = {};
  const fakeModule = { exports: moduleExports };
  const bareTimerApi = scoped ? lifecycleScope : createBareTimerApi(registry);
  const wrapperWindow = scoped ? lifecycleScope.scopedWindow : host.hostWindow;
  const wrapperDocument = scoped ? lifecycleScope.scopedDocument : host.hostDocument;
  const globalObject = scoped ? lifecycleScope.scopedWindow : host.hostWindow;
  const wrapper = new Function(...EXTENSION_WRAPPER_ARGUMENTS, extensionCode);

  wrapper(
    moduleExports,
    () => ({}),
    fakeModule,
    '/extension/index.js',
    '/extension',
    { env: {} },
    Buffer,
    globalObject,
    globalObject,
    bareTimerApi.setImmediate,
    bareTimerApi.clearImmediate,
    bareTimerApi.setInterval,
    bareTimerApi.clearInterval,
    bareTimerApi.setTimeout,
    bareTimerApi.clearTimeout,
    bareTimerApi.requestAnimationFrame,
    bareTimerApi.cancelAnimationFrame,
    wrapperWindow,
    wrapperDocument,
    undefined,
    async () => ({}),
  );

  return fakeModule.exports.default();
}

test('extension lifecycle sandbox cleanup', async (t) => {
  await t.test('documents the pre-fix window API leak', () => {
    host.reset();
    const registry = createTimerRegistry();
    const result = runWrapper({ registry, scoped: false });
    const beforeClear = host.snapshot();

    clearTimerRegistry(registry);
    const afterClear = host.snapshot();

    assert.deepEqual(result.compatibility, {
      documentRead: true,
      navigatorRead: 'SuperCmd lifecycle harness',
      locationRead: 'supercmd://lifecycle-harness',
      electronRead: 'electron-facade',
      globalWindowRead: true,
      defaultViewRead: true,
    });
    assert.equal(beforeClear.intervals, 1);
    assert.equal(beforeClear.windowListeners, 1);
    assert.equal(beforeClear.documentListeners, 1);
    assert.equal(registry.intervals.size, 0, 'legacy window.setInterval bypasses the bare timer registry');
    assert.equal(registry.eventListeners.size, 0, 'legacy window.addEventListener bypasses lifecycle cleanup');
    assert.equal(afterClear.total, beforeClear.total, 'legacy registry cleanup leaves window handles behind');

    console.log('extension lifecycle leak before fix:', { beforeClear, afterClear });
  });

  await t.test('cleans scoped window timers and listeners on unmount', () => {
    host.reset();
    const registry = createTimerRegistry();
    const lifecycleScope = createExtensionLifecycleScope(registry, host.hostWindow, host.hostDocument);
    const result = runWrapper({ lifecycleScope, registry, scoped: true });
    const beforeClear = host.snapshot();
    const registryBeforeClear = {
      intervals: registry.intervals.size,
      eventListeners: registry.eventListeners.size,
    };

    clearTimerRegistry(registry);
    const afterClear = host.snapshot();

    assert.deepEqual(result.compatibility, {
      documentRead: true,
      navigatorRead: 'SuperCmd lifecycle harness',
      locationRead: 'supercmd://lifecycle-harness',
      electronRead: 'electron-facade',
      globalWindowRead: true,
      defaultViewRead: true,
    });
    assert.equal(beforeClear.intervals, 1);
    assert.equal(beforeClear.windowListeners, 1);
    assert.equal(beforeClear.documentListeners, 1);
    assert.deepEqual(registryBeforeClear, { intervals: 1, eventListeners: 2 });
    assert.equal(afterClear.total, 0);

    console.log('extension lifecycle cleanup after fix:', { beforeClear, registryBeforeClear, afterClear });
  });

  await t.test('cleans prior scoped handles before re-evaluation', () => {
    host.reset();
    const registry = createTimerRegistry();
    const lifecycleScope = createExtensionLifecycleScope(registry, host.hostWindow, host.hostDocument);

    runWrapper({ lifecycleScope, registry, scoped: true });
    const firstEvaluation = host.snapshot();
    clearTimerRegistry(registry);
    const afterReevaluationCleanup = host.snapshot();
    runWrapper({ lifecycleScope, registry, scoped: true });
    const secondEvaluation = host.snapshot();
    clearTimerRegistry(registry);
    const afterUnmount = host.snapshot();

    assert.equal(firstEvaluation.total, 3);
    assert.equal(afterReevaluationCleanup.total, 0);
    assert.equal(secondEvaluation.total, 3);
    assert.equal(afterUnmount.total, 0);

    console.log('extension lifecycle re-evaluation cleanup:', {
      firstEvaluation,
      afterReevaluationCleanup,
      secondEvaluation,
      afterUnmount,
    });
  });
});
