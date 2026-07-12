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
  const timeouts = new Map();
  const rafs = new Map();
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
    setTimeout(handler, _timeout, ...args) {
      const id = nextTimerId++;
      timeouts.set(id, { handler, args });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    requestAnimationFrame(callback) {
      const id = nextTimerId++;
      rafs.set(id, { callback });
      return id;
    },
    cancelAnimationFrame(id) {
      rafs.delete(id);
    },
    addEventListener: windowTarget.addEventListener,
    removeEventListener: windowTarget.removeEventListener,
  };
  Object.defineProperty(hostWindow, 'nonConfigurableProbe', {
    value: 'descriptor-probe',
    configurable: false,
    enumerable: true,
  });

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
    flushTimeouts() {
      const pending = Array.from(timeouts.entries());
      for (const [id, { handler, args }] of pending) {
        if (!timeouts.has(id)) continue;
        timeouts.delete(id);
        if (typeof handler === 'function') {
          handler.call(hostWindow, ...args);
        }
      }
    },
    flushRafs(timestamp = 16.7) {
      const pending = Array.from(rafs.entries());
      for (const [id, { callback }] of pending) {
        if (!rafs.has(id)) continue;
        rafs.delete(id);
        callback.call(hostWindow, timestamp);
      }
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
      createExtensionTimerBuiltinFacade,
      createExtensionLifecycleScope,
      createTimerRegistry,
      isExtensionTimerBuiltinRequest,
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
  createExtensionTimerBuiltinFacade,
  createExtensionLifecycleScope,
  createTimerRegistry,
  isExtensionTimerBuiltinRequest,
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

function createLegacyImportedTimerFacade(name) {
  const normalized = name.startsWith('node:') ? name.slice(5) : name;
  if (normalized === 'timers/promises') {
    const wait = (ms, value) => new Promise((resolve) => {
      host.hostWindow.setTimeout(() => resolve(value), ms);
    });
    return {
      setTimeout: wait,
      setInterval: async function* (ms, value) {
        while (true) {
          yield await wait(ms, value);
        }
      },
      setImmediate: (value) => Promise.resolve(value),
      scheduler: { wait },
    };
  }

  return {
    setImmediate: (callback, ...args) => host.hostWindow.setTimeout(() => callback(...args), 0),
    clearImmediate: (id) => host.hostWindow.clearTimeout(id),
    setInterval: (...args) => host.hostWindow.setInterval(...args),
    clearInterval: (id) => host.hostWindow.clearInterval(id),
    setTimeout: (...args) => host.hostWindow.setTimeout(...args),
    clearTimeout: (id) => host.hostWindow.clearTimeout(id),
  };
}

function createScopedImportedTimerRequire(lifecycleScope) {
  const facades = new Map();
  return (name) => {
    assert.equal(isExtensionTimerBuiltinRequest(name), true, `expected ${name} to be a timer builtin`);
    const normalized = name.startsWith('node:') ? name.slice(5) : name;
    if (!facades.has(normalized)) {
      facades.set(normalized, createExtensionTimerBuiltinFacade(normalized, lifecycleScope));
    }
    return facades.get(normalized);
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

const importedTimerCode = `
const timers = require("timers");
const nodeTimers = require("node:timers");
const timersPromises = require("timers/promises");
const nodeTimersPromises = require("node:timers/promises");

exports.default = function ImportedTimerProbe() {
  const intervalId = timers.setInterval(() => {}, 60000);
  const timeoutId = nodeTimers.setTimeout(() => {}, 60000);
  const waitPromise = timersPromises.setTimeout(60000, "waited");
  const intervalIterator = nodeTimersPromises.setInterval(60000, "tick");
  const intervalNextPromise = intervalIterator.next();

  return {
    intervalId,
    timeoutId,
    waitPromise,
    intervalIterator,
    intervalNextPromise
  };
};
`;

function runImportedTimerWrapper({ lifecycleScope, scoped }) {
  const moduleExports = {};
  const fakeModule = { exports: moduleExports };
  const fakeRequire = scoped
    ? createScopedImportedTimerRequire(lifecycleScope)
    : (name) => createLegacyImportedTimerFacade(name);
  const wrapper = new Function(...EXTENSION_WRAPPER_ARGUMENTS, importedTimerCode);

  wrapper(
    moduleExports,
    fakeRequire,
    fakeModule,
    '/extension/index.js',
    '/extension',
    { env: {} },
    Buffer,
    host.hostWindow,
    host.hostWindow,
    host.hostWindow.setTimeout,
    host.hostWindow.clearTimeout,
    host.hostWindow.setInterval,
    host.hostWindow.clearInterval,
    host.hostWindow.setTimeout,
    host.hostWindow.clearTimeout,
    host.hostWindow.requestAnimationFrame,
    host.hostWindow.cancelAnimationFrame,
    host.hostWindow,
    host.hostDocument,
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
    assert.notEqual(lifecycleScope.scopedWindow, host.hostWindow);
    assert.notEqual(lifecycleScope.scopedDocument, host.hostDocument);
    assert.equal(lifecycleScope.scopedWindow.window, lifecycleScope.scopedWindow);
    assert.equal(lifecycleScope.scopedWindow.self, lifecycleScope.scopedWindow);
    assert.equal(lifecycleScope.scopedWindow.globalThis, lifecycleScope.scopedWindow);
    assert.equal(lifecycleScope.scopedWindow.document, lifecycleScope.scopedDocument);
    assert.equal(lifecycleScope.scopedDocument.defaultView, lifecycleScope.scopedWindow);
    assert.equal(lifecycleScope.scopedWindow.nonConfigurableProbe, 'descriptor-probe');
    assert.equal(Object.keys(lifecycleScope.scopedWindow).includes('nonConfigurableProbe'), true);
    assert.equal(
      Object.getOwnPropertyDescriptor(lifecycleScope.scopedWindow, 'nonConfigurableProbe')?.configurable,
      true,
      'scoped proxies expose host descriptors as configurable to satisfy proxy invariants'
    );
    lifecycleScope.scopedWindow.proxyWriteProbe = 'written-through-proxy';
    assert.equal(host.hostWindow.proxyWriteProbe, 'written-through-proxy');
    let methodThis = null;
    host.hostWindow.methodProbe = function () {
      methodThis = this;
      return this.navigator.userAgent;
    };
    assert.equal(lifecycleScope.scopedWindow.methodProbe(), 'SuperCmd lifecycle harness');
    assert.equal(methodThis, host.hostWindow);
    assert.equal(beforeClear.intervals, 1);
    assert.equal(beforeClear.windowListeners, 1);
    assert.equal(beforeClear.documentListeners, 1);
    assert.deepEqual(registryBeforeClear, { intervals: 1, eventListeners: 2 });
    assert.equal(afterClear.total, 0);

    console.log('extension lifecycle cleanup after fix:', { beforeClear, registryBeforeClear, afterClear });
  });

  await t.test('documents the pre-fix imported timer module leak', () => {
    host.reset();
    const registry = createTimerRegistry();
    runImportedTimerWrapper({ scoped: false });
    const beforeClear = host.snapshot();

    clearTimerRegistry(registry);
    const afterClear = host.snapshot();

    assert.equal(beforeClear.intervals, 1);
    assert.equal(beforeClear.timeouts, 3);
    assert.equal(registry.intervals.size, 0, 'legacy imported timers bypass the lifecycle registry');
    assert.equal(registry.timeouts.size, 0, 'legacy imported timer promises bypass the lifecycle registry');
    assert.equal(afterClear.intervals, beforeClear.intervals);
    assert.equal(afterClear.timeouts, beforeClear.timeouts);

    console.log('imported timer module leak before scoped facade:', { beforeClear, afterClear });
    host.reset();
  });

  await t.test('cleans imported timer module handles on unmount', () => {
    host.reset();
    const registry = createTimerRegistry();
    const lifecycleScope = createExtensionLifecycleScope(registry, host.hostWindow, host.hostDocument);
    runImportedTimerWrapper({ lifecycleScope, scoped: true });
    const beforeClear = host.snapshot();
    const registryBeforeClear = {
      intervals: registry.intervals.size,
      timeouts: registry.timeouts.size,
    };

    clearTimerRegistry(registry);
    const afterClear = host.snapshot();

    assert.equal(beforeClear.intervals, 1);
    assert.equal(beforeClear.timeouts, 3);
    assert.deepEqual(registryBeforeClear, { intervals: 1, timeouts: 3 });
    assert.equal(afterClear.total, 0);

    console.log('imported timer module cleanup after scoped facade:', {
      beforeClear,
      registryBeforeClear,
      afterClear,
    });
  });

  await t.test('prunes fired imported one-shots from timer builtins', async () => {
    host.reset();
    const registry = createTimerRegistry();
    const lifecycleScope = createExtensionLifecycleScope(registry, host.hostWindow, host.hostDocument);
    const timers = createExtensionTimerBuiltinFacade('timers', lifecycleScope);
    const timersPromises = createExtensionTimerBuiltinFacade('timers/promises', lifecycleScope);
    let callbackCalls = 0;

    timers.setTimeout(() => {
      callbackCalls += 1;
    }, 0);
    const waitPromise = timersPromises.setTimeout(0, 'timeout-value');
    const schedulerPromise = timersPromises.scheduler.wait(0);
    const immediatePromise = timersPromises.setImmediate('immediate-value');

    assert.equal(registry.timeouts.size, 4);
    assert.equal(host.snapshot().timeouts, 4);

    host.flushTimeouts();

    assert.equal(callbackCalls, 1);
    assert.equal(await waitPromise, 'timeout-value');
    assert.equal(await schedulerPromise, undefined);
    assert.equal(await immediatePromise, 'immediate-value');
    assert.equal(registry.timeouts.size, 0);
    assert.equal(registry.timeoutClearers.size, 0);
    assert.equal(host.snapshot().timeouts, 0);

    console.log('imported timer one-shot pruning after scoped facade:', {
      firedOneShots: 4,
      registryTimeoutsAfterFlush: registry.timeouts.size,
      hostTimeoutsAfterFlush: host.snapshot().timeouts,
    });
  });

  await t.test('prunes fired scoped one-shot timers and rafs', () => {
    const oneShotCount = 1000;

    host.reset();
    const staleTimeoutRegistry = createTimerRegistry();
    const staleTimeoutApi = createBareTimerApi(staleTimeoutRegistry);
    for (let i = 0; i < oneShotCount; i += 1) {
      staleTimeoutApi.setTimeout(() => {}, 0);
    }
    host.flushTimeouts();
    const staleTimeoutEntries = staleTimeoutRegistry.timeouts.size;
    clearTimerRegistry(staleTimeoutRegistry);

    host.reset();
    const staleRafRegistry = createTimerRegistry();
    const staleRafApi = createBareTimerApi(staleRafRegistry);
    for (let i = 0; i < oneShotCount; i += 1) {
      staleRafApi.requestAnimationFrame(() => {});
    }
    host.flushRafs();
    const staleRafEntries = staleRafRegistry.rafs.size;
    clearTimerRegistry(staleRafRegistry);

    host.reset();
    const registry = createTimerRegistry();
    const lifecycleScope = createExtensionLifecycleScope(registry, host.hostWindow, host.hostDocument);
    const intervalId = lifecycleScope.setInterval(() => {}, 60000);
    let timeoutCalls = 0;
    let timeoutThis = null;
    let timeoutArgs = null;
    for (let i = 0; i < oneShotCount; i += 1) {
      lifecycleScope.setTimeout(function (...args) {
        timeoutCalls += 1;
        if (timeoutCalls === 1) {
          timeoutThis = this;
          timeoutArgs = args;
        }
      }, 0, i, 'timeout-arg');
    }

    assert.equal(registry.intervals.size, 1);
    assert.equal(registry.timeouts.size, oneShotCount);
    assert.equal(registry.timeoutClearers.size, oneShotCount);

    host.flushTimeouts();

    assert.equal(timeoutCalls, oneShotCount);
    assert.equal(timeoutThis, host.hostWindow);
    assert.deepEqual(timeoutArgs, [0, 'timeout-arg']);
    assert.equal(registry.timeouts.size, 0);
    assert.equal(registry.timeoutClearers.size, 0);
    assert.equal(registry.intervals.size, 1, 'interval remains tracked after one-shot timeouts fire');
    assert.equal(registry.intervalClearers.size, 1);

    let rafCalls = 0;
    let rafThis = null;
    let rafTimestamp = null;
    for (let i = 0; i < oneShotCount; i += 1) {
      lifecycleScope.requestAnimationFrame(function (timestamp) {
        rafCalls += 1;
        if (rafCalls === 1) {
          rafThis = this;
          rafTimestamp = timestamp;
        }
      });
    }

    assert.equal(registry.rafs.size, oneShotCount);
    assert.equal(registry.rafClearers.size, oneShotCount);

    host.flushRafs(123.4);

    assert.equal(rafCalls, oneShotCount);
    assert.equal(rafThis, host.hostWindow);
    assert.equal(rafTimestamp, 123.4);
    assert.equal(registry.rafs.size, 0);
    assert.equal(registry.rafClearers.size, 0);
    assert.equal(registry.intervals.size, 1, 'interval remains tracked after one-shot rafs fire');
    assert.equal(registry.intervalClearers.size, 1);

    lifecycleScope.clearInterval(intervalId);
    assert.equal(registry.intervals.size, 0);
    assert.equal(registry.intervalClearers.size, 0);

    console.log(`${oneShotCount} fired timeouts: before stale registry entries=${staleTimeoutEntries}, after=${registry.timeouts.size}`);
    console.log(`${oneShotCount} fired RAFs: before stale registry entries=${staleRafEntries}, after=${registry.rafs.size}`);
  });

  await t.test('cleared one-shot handles do not fire or stay registered', () => {
    host.reset();
    const registry = createTimerRegistry();
    const lifecycleScope = createExtensionLifecycleScope(registry, host.hostWindow, host.hostDocument);
    let timeoutCalls = 0;
    let rafCalls = 0;

    const timeoutId = lifecycleScope.setTimeout(() => {
      timeoutCalls += 1;
    }, 0);
    lifecycleScope.clearTimeout(timeoutId);
    host.flushTimeouts();

    const rafId = lifecycleScope.requestAnimationFrame(() => {
      rafCalls += 1;
    });
    lifecycleScope.cancelAnimationFrame(rafId);
    host.flushRafs();

    assert.equal(timeoutCalls, 0);
    assert.equal(rafCalls, 0);
    assert.equal(registry.timeouts.size, 0);
    assert.equal(registry.timeoutClearers.size, 0);
    assert.equal(registry.rafs.size, 0);
    assert.equal(registry.rafClearers.size, 0);
  });

  await t.test('clears pending scoped one-shots on unmount', () => {
    host.reset();
    const registry = createTimerRegistry();
    const lifecycleScope = createExtensionLifecycleScope(registry, host.hostWindow, host.hostDocument);
    let callbackCalls = 0;

    lifecycleScope.setTimeout(() => {
      callbackCalls += 1;
    }, 0);
    lifecycleScope.requestAnimationFrame(() => {
      callbackCalls += 1;
    });

    assert.equal(registry.timeouts.size, 1);
    assert.equal(registry.rafs.size, 1);
    assert.equal(host.snapshot().timeouts, 1);
    assert.equal(host.snapshot().rafs, 1);

    clearTimerRegistry(registry);
    host.flushTimeouts();
    host.flushRafs();

    assert.equal(callbackCalls, 0);
    assert.equal(registry.timeouts.size, 0);
    assert.equal(registry.timeoutClearers.size, 0);
    assert.equal(registry.rafs.size, 0);
    assert.equal(registry.rafClearers.size, 0);
    assert.equal(host.snapshot().timeouts, 0);
    assert.equal(host.snapshot().rafs, 0);
  });

  await t.test('prunes one-shot handles when callbacks throw', () => {
    host.reset();
    const registry = createTimerRegistry();
    const lifecycleScope = createExtensionLifecycleScope(registry, host.hostWindow, host.hostDocument);

    lifecycleScope.setTimeout(() => {
      throw new Error('timeout boom');
    }, 0);

    assert.equal(registry.timeouts.size, 1);
    assert.throws(() => host.flushTimeouts(), /timeout boom/);
    assert.equal(registry.timeouts.size, 0);
    assert.equal(registry.timeoutClearers.size, 0);

    lifecycleScope.requestAnimationFrame(() => {
      throw new Error('raf boom');
    });

    assert.equal(registry.rafs.size, 1);
    assert.throws(() => host.flushRafs(), /raf boom/);
    assert.equal(registry.rafs.size, 0);
    assert.equal(registry.rafClearers.size, 0);
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
