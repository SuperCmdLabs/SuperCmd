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

function loadHook({ initialNow = Date.UTC(2026, 0, 1, 12), localStorage = createLocalStorage() } = {}) {
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

  const dateController = createDateController(initialNow);
  const reactMock = createReactMock();
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (request) => {
      if (request === 'react') return reactMock.react;
      return require(request);
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

  vm.runInNewContext(transpiled.outputText, sandbox, { filename: hookPath });

  return {
    dateController,
    localStorage,
    render(data, options) {
      reactMock.reset();
      return module.exports.useFrecencySorting(data, options);
    },
  };
}

function ids(items) {
  return Array.from(items, (item) => item.id);
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
      [`sc-frecency-${namespace}`]: JSON.stringify({
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
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(`sc-frecency-${namespace}`)), {
    alpha: { count: 1, lastVisited: now - 4 * 60 * 60 * 1_000 },
    bravo: { count: 2, lastVisited: now - 30 * 60 * 1_000 },
  });

  await result.resetRanking(data[1]);
  result = harness.render(data, { namespace });

  assert.equal(result.data[0].id, 'alpha');
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(`sc-frecency-${namespace}`)), {
    alpha: { count: 1, lastVisited: now - 4 * 60 * 60 * 1_000 },
  });
});
