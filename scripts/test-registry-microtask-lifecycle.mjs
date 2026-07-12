#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function menuBarStubsPlugin() {
  return {
    name: 'menubar-stubs',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^\.\/menubar-runtime-config$/ }, () => ({ path: 'menubar-runtime-config', namespace: 'menubar-stubs' }));
      pluginBuild.onResolve({ filter: /^\.\/menubar-runtime-payload-cache$/ }, () => ({ path: 'menubar-runtime-payload-cache', namespace: 'menubar-stubs' }));
      pluginBuild.onResolve({ filter: /^\.\/menubar-runtime-shared$/ }, () => ({ path: 'menubar-runtime-shared', namespace: 'menubar-stubs' }));

      pluginBuild.onLoad({ filter: /^menubar-runtime-config$/, namespace: 'menubar-stubs' }, () => ({
        loader: 'js',
        contents: `
          export function getMenuBarRuntimeDeps() {
            return globalThis.__SUPERCMD_MENUBAR_DEPS__;
          }
        `,
      }));
      pluginBuild.onLoad({ filter: /^menubar-runtime-payload-cache$/, namespace: 'menubar-stubs' }, () => ({
        loader: 'js',
        contents: `
          export function createMenuBarVisiblePayloadHashCache() {
            return {};
          }
          export function shouldSendMenuBarVisiblePayload() {
            return true;
          }
        `,
      }));
      pluginBuild.onLoad({ filter: /^menubar-runtime-shared$/, namespace: 'menubar-stubs' }, () => ({
        loader: 'js',
        contents: `
          import { createContext } from 'react';
          export const MBRegistryContext = createContext(null);
          export function initMenuBarClickListener() {}
          export function removeMenuBarActions() {}
          export function resetMenuBarOrderCounters() {}
          export function setMenuBarActions() {}
          export async function toMenuBarIconPayloadAsync() {
            return undefined;
          }
        `,
      }));
    },
  };
}

async function importBundledModule(relativePath, plugins = []) {
  const result = await build({
    entryPoints: [path.join(root, relativePath)],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    jsx: 'transform',
    tsconfigRaw: {
      compilerOptions: {
        jsx: 'react',
      },
    },
    plugins: [reactStubPlugin(), ...plugins],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function depsChanged(previous, next) {
  if (!previous || !next || previous.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, previous[index]));
}

function createHookRuntime(label) {
  const hooks = [];
  const counters = {
    label,
    setStateCalls: 0,
    postUnmountSetStateCalls: 0,
  };
  let hookIndex = 0;
  let mounted = true;

  const runtime = {
    counters,
    render(callback) {
      mounted = true;
      hookIndex = 0;
      return callback();
    },
    unmount() {
      mounted = false;
      for (let index = hooks.length - 1; index >= 0; index -= 1) {
        const cleanup = hooks[index]?.cleanup;
        if (typeof cleanup === 'function') {
          cleanup();
          hooks[index].cleanup = undefined;
        }
      }
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
      const cleanup = effect();
      hooks[index] = { deps, cleanup };
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
        const setState = (nextValue) => {
          counters.setStateCalls += 1;
          if (!mounted) counters.postUnmountSetStateCalls += 1;
          state.value = typeof nextValue === 'function' ? nextValue(state.value) : nextValue;
        };
        hooks[index] = { state, setState };
      }
      return [hooks[index].state.value, hooks[index].setState];
    },
  };

  return runtime;
}

function createLegacyRegistryScheduler(label) {
  const counters = {
    label,
    setStateCalls: 0,
    postUnmountSetStateCalls: 0,
    pendingCallbacks: 0,
  };
  let mounted = true;
  let pending = false;

  return {
    counters,
    schedule() {
      if (pending) return;
      pending = true;
      counters.pendingCallbacks += 1;
      queueMicrotask(() => {
        pending = false;
        counters.setStateCalls += 1;
        if (!mounted) counters.postUnmountSetStateCalls += 1;
      });
    },
    unmount() {
      mounted = false;
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function installRuntime(runtime) {
  globalThis.__SUPERCMD_REACT_RUNTIME__ = runtime;
}

test('legacy registry microtask scheduler calls setState after unmount', async () => {
  const legacySurfaces = ['actions', 'list', 'grid', 'menubar'].map(createLegacyRegistryScheduler);

  for (const surface of legacySurfaces) {
    surface.schedule();
    surface.unmount();
  }
  await flushMicrotasks();

  const metrics = Object.fromEntries(legacySurfaces.map((surface) => [surface.counters.label, surface.counters]));
  for (const surface of legacySurfaces) {
    assert.equal(surface.counters.pendingCallbacks, 1, `${surface.counters.label} should have queued one callback`);
    assert.equal(surface.counters.postUnmountSetStateCalls, 1, `${surface.counters.label} legacy callback should set state after unmount`);
  }

  console.log(JSON.stringify({ mode: 'registry-microtask-legacy-reproduction', metrics }, null, 2));
});

test('registry microtasks scheduled before unmount are suppressed by runtime hooks', async () => {
  const [actionModule, listModule, gridModule, menuBarModule] = await Promise.all([
    importBundledModule('src/renderer/src/raycast-api/action-runtime-registry.tsx'),
    importBundledModule('src/renderer/src/raycast-api/list-runtime-hooks.ts'),
    importBundledModule('src/renderer/src/raycast-api/grid-runtime-hooks.ts'),
    importBundledModule('src/renderer/src/raycast-api/menubar-runtime-parent.tsx', [menuBarStubsPlugin()]),
  ]);

  const actionRuntime = createHookRuntime('actions');
  installRuntime(actionRuntime);
  const actionRegistryRuntime = actionModule.createActionRegistryRuntime({
    snapshotExtensionContext: () => ({}),
    withExtensionContext: (_ctx, callback) => callback(),
    ExtensionInfoReactContext: { _currentValue: { extId: 'ext/cmd', assetsPath: '', commandMode: 'view' } },
    getFormValues: () => ({}),
    Clipboard: { copy: () => {} },
    trash: () => {},
    getGlobalNavigation: () => ({ push: () => {} }),
  });
  const actionHook = actionRuntime.render(() => actionRegistryRuntime.useCollectedActions());
  actionHook.registryAPI.register('action-1', { title: 'Action', execute: () => {}, order: 1 });
  actionRuntime.unmount();
  actionHook.registryAPI.register('action-after-unmount', { title: 'Late', execute: () => {}, order: 2 });

  const listRuntime = createHookRuntime('list');
  installRuntime(listRuntime);
  const listHook = listRuntime.render(() => listModule.useListRegistry());
  listHook.registryAPI.set('list-1', { props: { id: 'list-1', title: 'List' }, order: 1 });
  listRuntime.unmount();
  listHook.registryAPI.set('list-after-unmount', { props: { id: 'late', title: 'Late' }, order: 2 });

  const gridRuntime = createHookRuntime('grid');
  installRuntime(gridRuntime);
  const gridHook = gridRuntime.render(() => gridModule.useGridRegistry());
  gridHook.registryAPI.set('grid-1', { props: { id: 'grid-1', title: 'Grid' }, order: 1 });
  gridRuntime.unmount();
  gridHook.registryAPI.set('grid-after-unmount', { props: { id: 'late', title: 'Late' }, order: 2 });

  const menuBarRuntime = createHookRuntime('menubar');
  globalThis.window = { electron: { removeMenuBar: () => {}, updateMenuBar: () => {} } };
  globalThis.__SUPERCMD_MENUBAR_DEPS__ = {
    ExtensionInfoReactContext: { _currentValue: { extId: 'ext/cmd', assetsPath: '', commandMode: 'menu-bar' } },
    getExtensionContext: () => ({ extensionName: 'ext', commandName: 'cmd', assetsPath: '', commandMode: 'menu-bar' }),
    setExtensionContext: () => {},
    isEmojiOrSymbol: () => false,
  };
  installRuntime(menuBarRuntime);
  const menuTree = menuBarRuntime.render(() => menuBarModule.MenuBarExtraComponent({ children: null, title: 'Menu' }));
  const menuRegistryAPI = menuTree.props.value;
  menuRegistryAPI.register({ id: 'menu-1', type: 'item', title: 'Menu', order: 1 });
  menuBarRuntime.unmount();
  menuRegistryAPI.register({ id: 'menu-after-unmount', type: 'item', title: 'Late', order: 2 });

  await flushMicrotasks();

  const metrics = {
    actions: actionRuntime.counters,
    list: listRuntime.counters,
    grid: gridRuntime.counters,
    menubar: menuBarRuntime.counters,
  };
  for (const [label, counters] of Object.entries(metrics)) {
    assert.equal(counters.setStateCalls, 0, `${label} should suppress queued post-unmount updates`);
    assert.equal(counters.postUnmountSetStateCalls, 0, `${label} should not call state after unmount`);
  }

  console.log(JSON.stringify({ mode: 'registry-microtask-lifecycle-fixed', metrics }, null, 2));
});
