#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetFile = path.join(root, 'src/renderer/src/raycast-api/icon-runtime-render.tsx');
let importNonce = 0;

const REACT_EFFECT_STUB = `
const noop = () => {};
const createElement = (type, props, ...children) => ({ type, props: { ...(props || {}), children } });
class Component {
  constructor(props) {
    this.props = props || {};
    this.state = {};
  }
  setState(update) {
    this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state, this.props) : update) };
  }
}
const createContext = (value) => ({
  Consumer: ({ children }) => typeof children === 'function' ? children(value) : children,
  Provider: ({ children }) => children,
  _currentValue: value,
});
const React = {
  Component,
  PureComponent: Component,
  Fragment: Symbol.for('react.fragment'),
  createContext,
  createElement,
  createRef: () => ({ current: null }),
  forwardRef: (render) => render,
  lazy: (loader) => loader,
  memo: (component) => component,
  startTransition: (callback) => callback(),
  useCallback: (callback) => callback,
  useContext: (context) => context?._currentValue,
  useEffect: (effect) => {
    effect();
  },
  useId: () => 'test-id',
  useLayoutEffect: noop,
  useMemo: (factory) => factory(),
  useReducer: (reducer, initialArg, init) => [init ? init(initialArg) : initialArg, noop],
  useRef: (value) => ({ current: value }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, noop],
};
module.exports = React;
module.exports.default = React;
module.exports.__esModule = true;
`;

const REACT_DOM_SERVER_STUB = `
export function renderToStaticMarkup() {
  return "";
}
`;

const JSX_RUNTIME_STUB = `
const Fragment = Symbol.for('react.fragment');
const jsx = (type, props, key) => ({ type, key, props: props || {} });
module.exports = { Fragment, jsx, jsxs: jsx };
module.exports.default = module.exports;
module.exports.__esModule = true;
`;

const PHOSPHOR_STUB = `
module.exports = {};
module.exports.default = module.exports;
module.exports.__esModule = true;
`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function installBrowserGlobals(electron) {
  const document = {
    documentElement: {
      classList: {
        contains: () => false,
      },
    },
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
    createElement: () => ({
      style: {},
      setAttribute: () => {},
      appendChild: () => {},
      remove: () => {},
    }),
  };

  globalThis.document = document;
  globalThis.window = {
    document,
    electron,
    matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({
      color: 'rgb(255, 255, 255)',
      getPropertyValue: () => '',
    }),
  };
}

function exposeIconRuntimeRenderHooksPlugin() {
  const normalizedTarget = path.normalize(targetFile);
  return {
    name: 'expose-icon-runtime-render-test-hooks',
    setup(buildApi) {
      buildApi.onLoad({ filter: /icon-runtime-render\.tsx$/ }, async (args) => {
        if (path.normalize(args.path) !== normalizedTarget) return undefined;
        const source = await fs.readFile(args.path, 'utf8');
        return {
          contents: `${source}
export const __testIconRuntimeRender = {
  FILE_ICON_CACHE_MAX_ENTRIES,
  FileIcon,
  fileIconCache,
  inFlightFileIconRequests,
  loadFileIconDataUrl,
  readCachedFileIcon,
  renderIcon,
  clearFileIconCaches: () => {
    fileIconCache.clear();
    inFlightFileIconRequests.clear();
  },
  cacheStats: () => ({
    cacheSize: fileIconCache.size,
    inFlightSize: inFlightFileIconRequests.size,
    keys: Array.from(fileIconCache.keys()),
    limit: FILE_ICON_CACHE_MAX_ENTRIES,
  }),
};
`,
          loader: 'tsx',
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}

function iconRuntimeStubPlugin() {
  const stubs = new Map([
    ['@phosphor-icons/react', PHOSPHOR_STUB],
    ['react', REACT_EFFECT_STUB],
    ['react-dom/server', REACT_DOM_SERVER_STUB],
    ['react/jsx-dev-runtime', JSX_RUNTIME_STUB],
    ['react/jsx-runtime', JSX_RUNTIME_STUB],
  ]);

  return {
    name: 'icon-runtime-file-cache-stubs',
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, (args) => {
        if (!stubs.has(args.path)) return null;
        return { path: args.path, namespace: 'icon-runtime-file-cache-stub' };
      });

      buildApi.onLoad({ filter: /.*/, namespace: 'icon-runtime-file-cache-stub' }, (args) => ({
        contents: stubs.get(args.path) || '',
        loader: 'js',
      }));
    },
  };
}

async function importIconRuntimeHarness(electron = {}) {
  installBrowserGlobals(electron);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [targetFile],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    jsx: 'automatic',
    logLevel: 'silent',
    banner: {
      js: 'var window = globalThis.window; var document = globalThis.document;',
    },
    plugins: [iconRuntimeStubPlugin(), exposeIconRuntimeRenderHooksPlugin()],
  });
  const dataUrl = [
    'data:text/javascript;base64,',
    Buffer.from(result.outputFiles[0].text).toString('base64'),
    `#icon-runtime-file-cache-${importNonce++}`,
  ].join('');
  const module = await import(dataUrl);
  const runtime = module.__testIconRuntimeRender;
  assert.ok(runtime, 'expected icon runtime render test hooks to be exposed');
  runtime.clearFileIconCaches();
  return runtime;
}

test('file icon runtime cache', async (t) => {
  await t.test('coalesces 100 concurrently mounted identical file icons into one IPC call', async () => {
    const filePath = '/tmp/supercmd-same-file.txt';
    const dataUrl = 'data:image/png;base64,same-file';
    const gate = deferred();
    let calls = 0;

    const runtime = await importIconRuntimeHarness({
      getFileIconDataUrl(requestedPath, size) {
        calls += 1;
        assert.equal(requestedPath, filePath);
        assert.equal(size, 20);
        return gate.promise;
      },
      statSync: () => ({ exists: true, isDirectory: false }),
    });

    for (let index = 0; index < 100; index += 1) {
      runtime.FileIcon({ filePath, className: 'w-4 h-4' });
    }

    assert.equal(calls, 1);
    assert.equal(runtime.cacheStats().inFlightSize, 1);

    const pending = Array.from(runtime.inFlightFileIconRequests.values())[0];
    gate.resolve(dataUrl);
    await pending;

    assert.equal(runtime.cacheStats().cacheSize, 1);
    assert.equal(runtime.cacheStats().inFlightSize, 0);
    assert.equal(runtime.readCachedFileIcon(filePath), dataUrl);

    assert.equal(await runtime.loadFileIconDataUrl(filePath), dataUrl);
    assert.equal(calls, 1, 'cached file icon should not issue another IPC call');
  });

  await t.test('does not keep rejected IPC results as permanent negative cache entries', async () => {
    const filePath = '/tmp/supercmd-late-success.txt';
    const recoveredDataUrl = 'data:image/png;base64,recovered';
    let calls = 0;

    const runtime = await importIconRuntimeHarness({
      async getFileIconDataUrl() {
        calls += 1;
        if (calls === 1) throw new Error('temporary icon IPC failure');
        return recoveredDataUrl;
      },
    });

    assert.equal(await runtime.loadFileIconDataUrl(filePath), null);
    assert.equal(calls, 1);
    assert.equal(runtime.cacheStats().cacheSize, 0);
    assert.equal(runtime.cacheStats().inFlightSize, 0);

    assert.equal(await runtime.loadFileIconDataUrl(filePath), recoveredDataUrl);
    assert.equal(calls, 2);
    assert.equal(runtime.cacheStats().cacheSize, 1);
  });

  await t.test('caps unique file icon cache entries and evicts least recently used paths', async () => {
    let calls = 0;
    const runtime = await importIconRuntimeHarness({
      async getFileIconDataUrl(filePath) {
        calls += 1;
        return `data:image/png;base64,${Buffer.from(filePath).toString('base64')}`;
      },
    });

    const { limit } = runtime.cacheStats();
    assert.ok(limit < 5_000, 'test expects a bounded cache below the old 5k growth case');

    for (let index = 0; index < limit; index += 1) {
      await runtime.loadFileIconDataUrl(`/tmp/supercmd-icon-${index}`);
    }
    assert.equal(runtime.cacheStats().cacheSize, limit);

    const firstPath = '/tmp/supercmd-icon-0';
    const secondPath = '/tmp/supercmd-icon-1';
    const overflowPath = `/tmp/supercmd-icon-${limit}`;
    assert.ok(runtime.readCachedFileIcon(firstPath), 'reading should refresh LRU order');

    await runtime.loadFileIconDataUrl(overflowPath);

    const afterOverflow = runtime.cacheStats();
    assert.equal(afterOverflow.cacheSize, limit);
    assert.equal(calls, limit + 1);
    assert.ok(afterOverflow.keys.includes(firstPath), 'recently read path should survive overflow');
    assert.ok(!afterOverflow.keys.includes(secondPath), 'least recently used path should be evicted');
    assert.ok(afterOverflow.keys.includes(overflowPath), 'new path should be cached');

    for (let index = limit + 1; index < 5_000; index += 1) {
      await runtime.loadFileIconDataUrl(`/tmp/supercmd-icon-${index}`);
    }

    assert.equal(runtime.cacheStats().cacheSize, limit);
  });

  await t.test('leaves non-file image icons on the existing render path without IPC', async () => {
    let calls = 0;
    const runtime = await importIconRuntimeHarness({
      async getFileIconDataUrl() {
        calls += 1;
        return 'data:image/png;base64,file-icon';
      },
    });

    const remoteIcon = runtime.renderIcon('https://example.com/icon.png', 'w-5 h-5');

    assert.equal(calls, 0);
    assert.equal(remoteIcon?.props?.src, 'https://example.com/icon.png');
    assert.equal(remoteIcon?.props?.className, 'w-5 h-5');
  });
});
