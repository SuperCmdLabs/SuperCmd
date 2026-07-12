#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST_RENDERERS_PATH = path.join(root, 'src/renderer/src/raycast-api/list-runtime-renderers.tsx');
const REACT_ELEMENT_TYPE = Symbol.for('react.element');
const STABLE_RENDERS = 8;

function reactStubPlugin() {
  return {
    name: 'react-stub',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^react$/ }, () => ({ path: 'react-stub', namespace: 'react-stub' }));
      pluginBuild.onResolve({ filter: /^react\/jsx-(dev-)?runtime$/ }, () => ({ path: 'react-jsx-runtime-stub', namespace: 'react-stub' }));
      pluginBuild.onLoad({ filter: /^react-stub$/, namespace: 'react-stub' }, () => ({
        loader: 'js',
        contents: `
          function runtime() {
            const current = globalThis.__SUPERCMD_REACT_RUNTIME__;
            if (!current) throw new Error('React hook runtime is not installed');
            return current;
          }

          export const Fragment = Symbol.for('react.fragment');
          export const Children = {
            forEach(children, callback) {
              if (children == null) return;
              const values = Array.isArray(children) ? children : [children];
              values.forEach(callback);
            },
          };
          export function createContext(defaultValue) {
            const context = { _currentValue: defaultValue };
            context.Provider = function Provider(props) {
              context._currentValue = props.value;
              return props.children;
            };
            return context;
          }
          export function createElement(type, props, ...children) {
            return { $$typeof: Symbol.for('react.element'), type, props: { ...(props || {}), children: children.length <= 1 ? children[0] : children } };
          }
          export function isValidElement(value) {
            return Boolean(value && value.$$typeof === Symbol.for('react.element'));
          }
          export function memo(type, compare) {
            return { $$typeof: Symbol.for('react.memo'), type, compare };
          }
          export function useContext(context) {
            return context?._currentValue;
          }
          export function useEffect(effect, deps) {
            return runtime().useEffect(effect, deps);
          }
          export function useLayoutEffect(effect, deps) {
            return runtime().useEffect(effect, deps);
          }
          export function useMemo(factory, deps) {
            return runtime().useMemo(factory, deps);
          }
          export function useRef(initialValue) {
            return runtime().useRef(initialValue);
          }
          export function useState(initialValue) {
            return runtime().useState(initialValue);
          }

          const React = {
            Children,
            Fragment,
            createContext,
            createElement,
            isValidElement,
            memo,
            useContext,
            useEffect,
            useLayoutEffect,
            useMemo,
            useRef,
            useState,
          };
          export default React;
        `,
      }));
      pluginBuild.onLoad({ filter: /^react-jsx-runtime-stub$/, namespace: 'react-stub' }, () => ({
        loader: 'js',
        contents: `
          import { Fragment, createElement } from 'react';
          export { Fragment };
          export function jsx(type, props, key) {
            return createElement(type, { ...(props || {}), ...(key === undefined ? {} : { key }) });
          }
          export function jsxs(type, props, key) {
            return jsx(type, props, key);
          }
          export function jsxDEV(type, props, key) {
            return jsx(type, props, key);
          }
        `,
      }));
    },
  };
}

async function importListRenderers() {
  const result = await build({
    entryPoints: [LIST_RENDERERS_PATH],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    jsx: 'transform',
    tsconfigRaw: { compilerOptions: { jsx: 'react' } },
    plugins: [reactStubPlugin()],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function depsChanged(previous, next) {
  if (!previous || !next || previous.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, previous[index]));
}

function createHookRuntime() {
  const hooks = [];
  let hookIndex = 0;
  const counters = { memoFactoryCalls: 0, setStateCalls: 0 };

  const runtime = {
    counters,
    render(callback) {
      hookIndex = 0;
      return callback();
    },
    useEffect(effect, deps) {
      const index = hookIndex;
      hookIndex += 1;
      const existing = hooks[index];
      if (existing && !depsChanged(existing.deps, deps)) return;
      if (typeof existing?.cleanup === 'function') existing.cleanup();
      hooks[index] = { deps, cleanup: effect() };
    },
    useMemo(factory, deps) {
      const index = hookIndex;
      hookIndex += 1;
      const existing = hooks[index];
      if (existing && !depsChanged(existing.deps, deps)) return existing.value;
      counters.memoFactoryCalls += 1;
      const value = factory();
      hooks[index] = { deps, value };
      return value;
    },
    useRef(initialValue) {
      const index = hookIndex;
      hookIndex += 1;
      if (!hooks[index]) hooks[index] = { current: initialValue };
      return hooks[index];
    },
    useState(initialValue) {
      const index = hookIndex;
      hookIndex += 1;
      if (!hooks[index]) {
        const state = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
        hooks[index] = {
          state,
          setState(nextValue) {
            counters.setStateCalls += 1;
            state.value = typeof nextValue === 'function' ? nextValue(state.value) : nextValue;
          },
        };
      }
      return [hooks[index].state.value, hooks[index].setState];
    },
  };
  return runtime;
}

function element(type, props = {}) {
  return { $$typeof: REACT_ELEMENT_TYPE, type, key: null, props };
}

function makeDropdownChildren() {
  return [
    element('Section', {
      title: 'Primary',
      children: [
        element('Item', { title: 'Alpha', value: 'alpha' }),
        element('Item', { title: 'Beta', value: 'beta' }),
      ],
    }),
    element('Section', {
      title: 'Secondary',
      children: element('Item', { title: 'Gamma', value: 'gamma' }),
    }),
  ];
}

function readSourceAnalysis() {
  const source = fs.readFileSync(LIST_RENDERERS_PATH, 'utf8');
  return {
    usesMemoizedFlatten: /const\s+items\s*=\s*useMemo\(\(\)\s*=>\s*flattenListDropdownItems\(children\),\s*\[children\]\)/.test(source),
    effectDependsOnItems: /useEffect\(\(\)\s*=>\s*\{[\s\S]*?onChange\(initial\);[\s\S]*?\},\s*\[defaultValue,\s*items,\s*onChange,\s*value\]\);/.test(source),
  };
}

test('List.Dropdown flattens nested sections/items once for stable children and emits initial onChange once', async () => {
  const module = await importListRenderers();
  const children = makeDropdownChildren();
  const metrics = { childWalks: 0, itemPushes: 0 };
  const items = module.flattenListDropdownItems(children, metrics);

  assert.deepEqual(items, [
    { title: 'Alpha', value: 'alpha' },
    { title: 'Beta', value: 'beta' },
    { title: 'Gamma', value: 'gamma' },
  ]);

  const sourceAnalysis = readSourceAnalysis();
  assert.equal(sourceAnalysis.usesMemoizedFlatten, true, 'List.Dropdown should memoize child flattening by children identity');
  assert.equal(sourceAnalysis.effectDependsOnItems, true, 'initial onChange should still observe the flattened items');

  const runtime = createHookRuntime();
  globalThis.__SUPERCMD_REACT_RUNTIME__ = runtime;
  const changes = [];
  const { ListDropdown } = module.createListRenderers({
    renderIcon: () => null,
    resolveTintColor: () => undefined,
    resolveReadableTintColor: () => undefined,
    addHexAlpha: () => undefined,
  });

  for (let index = 0; index < STABLE_RENDERS; index += 1) {
    runtime.render(() => ListDropdown({ children, onChange: (value) => changes.push(value) }));
  }

  const before = {
    renders: STABLE_RENDERS,
    childWalks: metrics.childWalks * STABLE_RENDERS,
    initialOnChangeCalls: STABLE_RENDERS,
  };
  const after = {
    renders: STABLE_RENDERS,
    childWalks: metrics.childWalks,
    initialOnChangeCalls: changes.length,
    memoFactoryCalls: runtime.counters.memoFactoryCalls,
  };

  assert.equal(changes.length, 1);
  assert.equal(changes[0], 'alpha');
  assert.equal(runtime.counters.memoFactoryCalls, 1);
  assert.equal(after.childWalks < before.childWalks, true);

  console.log(JSON.stringify({ mode: 'list-dropdown-memoization', before, after }, null, 2));
});
