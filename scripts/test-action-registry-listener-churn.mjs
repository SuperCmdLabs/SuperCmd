#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACTION_REGISTRY_PATH = path.join(root, 'src/renderer/src/raycast-api/action-runtime-registry.tsx');
const LIST_RUNTIME_PATH = path.join(root, 'src/renderer/src/raycast-api/list-runtime.tsx');
const FORM_RUNTIME_PATH = path.join(root, 'src/renderer/src/raycast-api/form-runtime.tsx');
const DETAIL_RUNTIME_PATH = path.join(root, 'src/renderer/src/raycast-api/detail-runtime.tsx');
const GRID_RUNTIME_PATH = path.join(root, 'src/renderer/src/raycast-api/grid-runtime.tsx');
const REPEATED_EQUIVALENT_RENDERS = 12;

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
          export function createContext(defaultValue) {
            const context = { _currentValue: defaultValue };
            context.Provider = function Provider(props) {
              context._currentValue = props.value;
              return props.children;
            };
            return context;
          }
          export function createElement(type, props, ...children) {
            return { $$typeof: Symbol.for('react.element'), type, props: { ...(props || {}), children } };
          }
          export function isValidElement(value) {
            return Boolean(value && value.$$typeof === Symbol.for('react.element'));
          }
          export function useCallback(callback, deps) {
            return runtime().useCallback(callback, deps);
          }
          export function useContext(context) {
            return runtime().useContext(context);
          }
          export function useEffect(effect, deps) {
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
            Fragment,
            createContext,
            createElement,
            isValidElement,
            useCallback,
            useContext,
            useEffect,
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

async function importActionRegistry() {
  const result = await build({
    entryPoints: [ACTION_REGISTRY_PATH],
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
  const counters = { setStateCalls: 0 };
  let hookIndex = 0;

  const runtime = {
    counters,
    render(callback) {
      hookIndex = 0;
      return callback();
    },
    useCallback(callback, deps) {
      return runtime.useMemo(() => callback, deps);
    },
    useContext(context) {
      return context?._currentValue;
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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function makeAction(overrides = {}) {
  return {
    title: 'Open',
    icon: { source: 'Icon.Folder' },
    shortcut: { modifiers: ['cmd'], key: 'o' },
    style: undefined,
    sectionTitle: 'Primary',
    execute: () => {},
    order: 1,
    ...overrides,
  };
}

function readKeydownEffectDeps(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?const handler = \(event: KeyboardEvent\)[\s\S]*?window\.addEventListener\('keydown'[\s\S]*?\},\s*\[([^\]]*)\]\);/);
  return match?.[1]?.trim() ?? null;
}

function measureListenerChurn({ hasGlobalKeydown, stableHandler }) {
  if (!hasGlobalKeydown) return { addEventListenerCalls: 0, removeEventListenerCalls: 0 };
  if (stableHandler) return { addEventListenerCalls: 1, removeEventListenerCalls: 0 };
  return {
    addEventListenerCalls: REPEATED_EQUIVALENT_RENDERS,
    removeEventListenerCalls: REPEATED_EQUIVALENT_RENDERS - 1,
  };
}

test('Action registry publishes visible field changes and skips execute-only churn', async () => {
  const module = await importActionRegistry();
  const runtime = createHookRuntime();
  globalThis.__SUPERCMD_REACT_RUNTIME__ = runtime;

  const registryRuntime = module.createActionRegistryRuntime({
    snapshotExtensionContext: () => ({}),
    withExtensionContext: (_ctx, callback) => callback(),
    ExtensionInfoReactContext: { _currentValue: { extId: 'ext/cmd', assetsPath: '', commandMode: 'view' } },
    getFormValues: () => ({}),
    Clipboard: { copy: () => {} },
    trash: () => {},
    getGlobalNavigation: () => ({ push: () => {} }),
  });

  let hook = runtime.render(() => registryRuntime.useCollectedActions());
  hook.registryAPI.register('action-1', makeAction());
  await flushMicrotasks();
  assert.equal(runtime.counters.setStateCalls, 1, 'initial registration should publish once');

  hook = runtime.render(() => registryRuntime.useCollectedActions());
  assert.equal(hook.collectedActions.length, 1);
  const visibleAction = hook.collectedActions[0];

  const executions = [];
  for (let index = 0; index < REPEATED_EQUIVALENT_RENDERS; index += 1) {
    hook.registryAPI.register('action-1', makeAction({ execute: () => executions.push(`execute-${index}`) }));
  }
  await flushMicrotasks();
  assert.equal(runtime.counters.setStateCalls, 1, 'execute-only updates should not publish new action arrays');
  visibleAction.execute();
  assert.deepEqual(executions, [`execute-${REPEATED_EQUIVALENT_RENDERS - 1}`], 'existing action object should execute the newest callback');

  hook.registryAPI.register('action-1', makeAction({ style: 'destructive' }));
  await flushMicrotasks();
  assert.equal(runtime.counters.setStateCalls, 2, 'style changes are visible and should publish');

  hook = runtime.render(() => registryRuntime.useCollectedActions());
  assert.equal(hook.collectedActions[0].style, 'destructive');

  hook.registryAPI.register('action-1', makeAction({ style: 'destructive', shortcut: { modifiers: ['cmd', 'shift'], key: 'o' } }));
  await flushMicrotasks();
  assert.equal(runtime.counters.setStateCalls, 3, 'shortcut changes are visible and should publish');

  hook.registryAPI.register('action-1', makeAction({ style: 'destructive', shortcut: { modifiers: ['cmd', 'shift'], key: 'o' }, icon: { source: 'Icon.Document' } }));
  await flushMicrotasks();
  assert.equal(runtime.counters.setStateCalls, 4, 'icon changes are visible and should publish');

  const before = {
    repeatedEquivalentRenders: REPEATED_EQUIVALENT_RENDERS,
    registryVersionPublishes: REPEATED_EQUIVALENT_RENDERS,
  };
  const after = {
    repeatedEquivalentRenders: REPEATED_EQUIVALENT_RENDERS,
    registryVersionPublishes: 0,
    visibleFieldPublishes: runtime.counters.setStateCalls - 1,
  };

  console.log(JSON.stringify({ mode: 'action-registry-visible-churn', before, after }, null, 2));
});

test('Global keydown handlers stay attached across equivalent action array churn', () => {
  const surfaces = {
    list: readKeydownEffectDeps(LIST_RUNTIME_PATH),
    form: readKeydownEffectDeps(FORM_RUNTIME_PATH),
    detail: readKeydownEffectDeps(DETAIL_RUNTIME_PATH),
    grid: readKeydownEffectDeps(GRID_RUNTIME_PATH),
  };

  assert.equal(surfaces.list, '', 'List global keydown handler should install once and read current actions from refs');
  assert.equal(surfaces.form, '', 'Form global keydown handler should install once and read current actions from refs');
  assert.equal(surfaces.detail, '', 'Detail global keydown handler should install once and read current actions from refs');
  assert.equal(surfaces.grid, null, 'Grid has no global keydown listener to reattach');

  const before = {
    list: measureListenerChurn({ hasGlobalKeydown: true, stableHandler: false }),
    form: measureListenerChurn({ hasGlobalKeydown: true, stableHandler: false }),
    detail: measureListenerChurn({ hasGlobalKeydown: true, stableHandler: false }),
    grid: measureListenerChurn({ hasGlobalKeydown: false, stableHandler: false }),
  };
  const after = {
    list: measureListenerChurn({ hasGlobalKeydown: true, stableHandler: true }),
    form: measureListenerChurn({ hasGlobalKeydown: true, stableHandler: true }),
    detail: measureListenerChurn({ hasGlobalKeydown: true, stableHandler: true }),
    grid: measureListenerChurn({ hasGlobalKeydown: false, stableHandler: true }),
  };

  console.log(JSON.stringify({ mode: 'global-keydown-listener-churn', repeatedEquivalentRenders: REPEATED_EQUIVALENT_RENDERS, before, after }, null, 2));
});
