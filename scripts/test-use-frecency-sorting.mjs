#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const hookPath = path.resolve('src/renderer/src/raycast-api/hooks/use-frecency-sorting.ts');
const contextScopePath = path.resolve('src/renderer/src/raycast-api/context-scope-runtime.ts');

function createLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    entries() {
      return Array.from(store.entries());
    },
  };
}

function createDateController(initialNow) {
  let now = initialNow;
  let nowCalls = 0;

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(now);
        return;
      }
      super(...args);
    }

    static now() {
      nowCalls += 1;
      return now;
    }
  }

  return {
    Date: FakeDate,
    get nowCalls() {
      return nowCalls;
    },
    resetNowCalls() {
      nowCalls = 0;
    },
    setNow(nextNow) {
      now = nextNow;
    },
  };
}

function createReactMock() {
  const hooks = [];
  let hookIndex = 0;

  function depsChanged(previous, next) {
    if (!previous || !next || previous.length !== next.length) return true;
    return previous.some((value, index) => !Object.is(value, next[index]));
  }

  function memoize(factory, deps) {
    const index = hookIndex;
    hookIndex += 1;

    if (!hooks[index] || depsChanged(hooks[index].deps, deps)) {
      hooks[index] = {
        deps: deps ? [...deps] : deps,
        value: factory(),
      };
    }

    return hooks[index].value;
  }

  return {
    reset() {
      hookIndex = 0;
    },
    react: {
      useState(initializer) {
        const index = hookIndex;
        hookIndex += 1;

        if (!hooks[index]) {
          hooks[index] = {
            value: typeof initializer === 'function' ? initializer() : initializer,
          };
        }

        const setState = (nextValue) => {
          hooks[index].value = typeof nextValue === 'function' ? nextValue(hooks[index].value) : nextValue;
        };

        return [hooks[index].value, setState];
      },
      useMemo(factory, deps) {
        return memoize(factory, deps);
      },
      useCallback(callback, deps) {
        return memoize(() => callback, deps);
      },
    },
  };
}

function loadHook({
  extensionName = 'default-extension',
  initialNow = Date.UTC(2026, 0, 1, 12),
  localStorage = createLocalStorage(),
} = {}) {
  const dateController = createDateController(initialNow);
  const reactMock = createReactMock();
  const moduleCache = new Map();

  function resolveTsModule(request, fromPath) {
    if (!request.startsWith('.')) return null;
    const resolved = path.resolve(path.dirname(fromPath), request);
    const candidates = [resolved, `${resolved}.ts`, `${resolved}.tsx`, path.join(resolved, 'index.ts')];
    const match = candidates.find((candidate) => fs.existsSync(candidate));
    if (!match) throw new Error(`Unable to resolve ${request} from ${fromPath}`);
    return match;
  }

  function loadTsModule(filePath) {
    if (moduleCache.has(filePath)) return moduleCache.get(filePath).exports;

    const source = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
      fileName: filePath,
    });

    const module = { exports: {} };
    moduleCache.set(filePath, module);

    const sandbox = {
      module,
      exports: module.exports,
      require: (request) => {
        if (request === 'react') return reactMock.react;
        const resolved = resolveTsModule(request, filePath);
        return resolved ? loadTsModule(resolved) : require(request);
      },
      console,
      Date: dateController.Date,
      JSON,
      localStorage,
      Math,
      Object,
      Promise,
      String,
    };

    vm.runInNewContext(transpiled.outputText, sandbox, { filename: filePath });
    return module.exports;
  }

  const contextScope = loadTsModule(contextScopePath);
  contextScope.configureContextScopeRuntime({
    getExtensionContext: () => ({
      extensionName,
      extensionDisplayName: extensionName,
      extensionIconDataUrl: '',
      commandName: 'test-command',
      assetsPath: '',
      supportPath: '/tmp/supercmd-test',
      owner: 'test-owner',
      preferences: {},
      preferenceDefinitions: [],
      commandMode: 'view',
    }),
    setExtensionContext: () => {},
  });

  const hookModule = loadTsModule(hookPath);

  return {
    dateController,
    localStorage,
    render(data, options) {
      reactMock.reset();
      return hookModule.useFrecencySorting(data, options);
    },
  };
}

function ids(items) {
  return Array.from(items, (item) => item.id);
}

function serializedBytes(localStorage, key) {
  return Buffer.byteLength(localStorage.getItem(key) || '', 'utf8');
}

function retainedEntryCount(localStorage, key) {
  return Object.keys(JSON.parse(localStorage.getItem(key) || '{}')).length;
}

test('useFrecencySorting reuses sorted data on stable rerender with the default key', () => {
  const harness = loadHook();
  const data = [{ id: 'charlie' }, { id: 'alpha' }, { id: 'bravo' }];
  let comparisons = 0;
  const options = {
    namespace: 'stable-rerender',
    sortUnvisited: (a, b) => {
      comparisons += 1;
      return a.id.localeCompare(b.id);
    },
  };

  const firstRender = harness.render(data, options);

  assert.deepEqual(ids(firstRender.data), ['alpha', 'bravo', 'charlie']);
  assert.ok(comparisons > 0, 'initial render should sort the unvisited items');

  const initialComparisons = comparisons;
  const secondRender = harness.render(data, options);

  assert.deepEqual(ids(secondRender.data), ['alpha', 'bravo', 'charlie']);
  assert.equal(comparisons, initialComparisons, 'stable rerenders should not recompute the sort');
  assert.strictEqual(secondRender.data, firstRender.data, 'stable rerenders should keep the memoized array');
});

test('useFrecencySorting reads the current time once per sorting recompute', () => {
  const now = Date.UTC(2026, 0, 1, 12);
  const namespace = 'single-now';
  const harness = loadHook({
    initialNow: now,
    localStorage: createLocalStorage({
      [`sc-frecency:default-extension:${namespace}`]: JSON.stringify({
        alpha: { count: 1, lastVisited: now - 1_000 },
        bravo: { count: 3, lastVisited: now - 1_000 },
        charlie: { count: 2, lastVisited: now - 1_000 },
      }),
    }),
  });

  harness.dateController.resetNowCalls();
  const result = harness.render([{ id: 'alpha' }, { id: 'bravo' }, { id: 'charlie' }], { namespace });

  assert.deepEqual(ids(result.data), ['bravo', 'charlie', 'alpha']);
  assert.equal(harness.dateController.nowCalls, 1, 'sorting should capture one timestamp per recompute');
});

test('useFrecencySorting preserves visit tracking and reset behavior', async () => {
  const now = Date.UTC(2026, 0, 1, 12);
  const namespace = 'visit-tracking';
  const data = [{ id: 'alpha' }, { id: 'bravo' }, { id: 'charlie' }];
  const harness = loadHook({ initialNow: now });
  let result = harness.render(data, { namespace });

  harness.dateController.setNow(now - 4 * 60 * 60 * 1_000);
  await result.visitItem(data[0]);
  harness.dateController.setNow(now - 60 * 60 * 1_000);
  await result.visitItem(data[1]);
  harness.dateController.setNow(now - 30 * 60 * 1_000);
  await result.visitItem(data[1]);

  harness.dateController.setNow(now);
  result = harness.render(data, { namespace });

  assert.deepEqual(ids(result.data), ['bravo', 'alpha', 'charlie']);
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(`sc-frecency:default-extension:${namespace}`)), {
    alpha: { count: 1, lastVisited: now - 4 * 60 * 60 * 1_000 },
    bravo: { count: 2, lastVisited: now - 30 * 60 * 1_000 },
  });

  await result.resetRanking(data[1]);
  result = harness.render(data, { namespace });

  assert.equal(result.data[0].id, 'alpha');
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(`sc-frecency:default-extension:${namespace}`)), {
    alpha: { count: 1, lastVisited: now - 4 * 60 * 60 * 1_000 },
  });
});

test('useFrecencySorting scopes storage by extension and migrates legacy rankings without loss', async () => {
  const now = Date.UTC(2026, 0, 1, 12);
  const namespace = 'shared-namespace';
  const legacyKey = `sc-frecency-${namespace}`;
  const alphaKey = `sc-frecency:alpha-extension:${namespace}`;
  const bravoKey = `sc-frecency:bravo-extension:${namespace}`;
  const localStorage = createLocalStorage({
    [legacyKey]: JSON.stringify({
      alpha: { count: 2, lastVisited: now - 2 * 60 * 60 * 1_000 },
      legacyOnly: { count: 1, lastVisited: now - 6 * 60 * 60 * 1_000 },
    }),
  });
  const legacyBytes = serializedBytes(localStorage, legacyKey);

  assert.equal(retainedEntryCount(localStorage, legacyKey), 2, 'legacy fixture should start with two retained entries');
  assert.equal(legacyBytes, 102, 'legacy fixture should start with 102 serialized bytes');

  const alphaHarness = loadHook({ extensionName: 'alpha-extension', initialNow: now, localStorage });
  let alphaResult = alphaHarness.render([{ id: 'alpha' }, { id: 'bravo' }, { id: 'legacyOnly' }], { namespace });

  assert.deepEqual(ids(alphaResult.data), ['alpha', 'legacyOnly', 'bravo']);
  assert.deepEqual(JSON.parse(localStorage.getItem(alphaKey)), JSON.parse(localStorage.getItem(legacyKey)));
  assert.equal(retainedEntryCount(localStorage, alphaKey), 2, 'migration should retain all legacy entries');
  assert.equal(serializedBytes(localStorage, alphaKey), legacyBytes, 'migration should copy the full serialized payload');

  alphaHarness.dateController.setNow(now + 1_000);
  await alphaResult.visitItem({ id: 'bravo' });
  alphaResult = alphaHarness.render([{ id: 'alpha' }, { id: 'bravo' }, { id: 'legacyOnly' }], { namespace });

  assert.deepEqual(ids(alphaResult.data), ['alpha', 'bravo', 'legacyOnly']);
  assert.equal(retainedEntryCount(localStorage, alphaKey), 3, 'new visits should preserve migrated rankings');
  assert.equal(serializedBytes(localStorage, alphaKey), 150, 'alpha scoped storage should retain three serialized entries');
  assert.equal(retainedEntryCount(localStorage, legacyKey), 2, 'legacy migration should not mutate the legacy payload');

  const bravoHarness = loadHook({ extensionName: 'bravo-extension', initialNow: now, localStorage });
  let bravoResult = bravoHarness.render([{ id: 'alpha' }, { id: 'bravo' }, { id: 'legacyOnly' }], { namespace });

  assert.deepEqual(ids(bravoResult.data), ['alpha', 'legacyOnly', 'bravo']);
  assert.deepEqual(JSON.parse(localStorage.getItem(bravoKey)), JSON.parse(localStorage.getItem(legacyKey)));
  assert.notDeepEqual(JSON.parse(localStorage.getItem(bravoKey)), JSON.parse(localStorage.getItem(alphaKey)));

  bravoHarness.dateController.setNow(now + 2_000);
  await bravoResult.visitItem({ id: 'legacyOnly' });
  bravoResult = bravoHarness.render([{ id: 'alpha' }, { id: 'bravo' }, { id: 'legacyOnly' }], { namespace });

  assert.deepEqual(ids(bravoResult.data), ['legacyOnly', 'alpha', 'bravo']);
  assert.equal(retainedEntryCount(localStorage, bravoKey), 2, 'visiting an existing migrated entry should not prune entries');
  assert.equal(serializedBytes(localStorage, bravoKey), legacyBytes, 'bravo scoped storage should retain two serialized entries');
  assert.equal(retainedEntryCount(localStorage, alphaKey), 3, 'other extension scoped storage should be isolated');
  assert.ok(serializedBytes(localStorage, alphaKey) > serializedBytes(localStorage, legacyKey));
  assert.ok(serializedBytes(localStorage, bravoKey) >= serializedBytes(localStorage, legacyKey));
});
