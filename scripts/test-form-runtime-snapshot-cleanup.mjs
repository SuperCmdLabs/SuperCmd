#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { TextEncoder } from 'node:util';

const require = createRequire(import.meta.url);
const FORM_RUNTIME_PATH = 'src/renderer/src/raycast-api/form-runtime.tsx';
const FORM_RUNTIME_CONTEXT_PATH = 'src/renderer/src/raycast-api/form-runtime-context.tsx';

let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  esbuild = null;
}

function createFakeReact() {
  let activeRuntime = null;

  const areDepsEqual = (left, right) => {
    if (!left || !right || left.length !== right.length) return false;
    return left.every((value, index) => Object.is(value, right[index]));
  };

  const react = {
    createContext(defaultValue) {
      const context = { _currentValue: defaultValue, _lastProviderValue: defaultValue };
      context.Provider = function Provider(props) {
        context._currentValue = props.value;
        context._lastProviderValue = props.value;
        return props.children ?? null;
      };
      return context;
    },

    useContext(context) {
      return context._currentValue;
    },

    useState(initialValue) {
      const runtime = activeRuntime;
      const index = runtime.hookIndex;
      runtime.hookIndex += 1;
      if (!(index in runtime.hooks)) {
        runtime.hooks[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      }
      const setState = (nextValue) => {
        const previous = runtime.hooks[index];
        runtime.hooks[index] = typeof nextValue === 'function' ? nextValue(previous) : nextValue;
      };
      return [runtime.hooks[index], setState];
    },

    useRef(initialValue) {
      const runtime = activeRuntime;
      const index = runtime.hookIndex;
      runtime.hookIndex += 1;
      if (!(index in runtime.hooks)) {
        runtime.hooks[index] = { current: initialValue };
      }
      return runtime.hooks[index];
    },

    useMemo(factory, deps) {
      const runtime = activeRuntime;
      const index = runtime.hookIndex;
      runtime.hookIndex += 1;
      const previous = runtime.hooks[index];
      if (previous && areDepsEqual(previous.deps, deps)) return previous.value;
      const value = factory();
      runtime.hooks[index] = { deps, value };
      return value;
    },

    useCallback(callback, deps) {
      return react.useMemo(() => callback, deps);
    },

    useEffect(effect, deps) {
      const runtime = activeRuntime;
      const index = runtime.hookIndex;
      runtime.hookIndex += 1;
      const previous = runtime.effects[index];
      if (previous && areDepsEqual(previous.deps, deps)) return;
      runtime.pendingEffects.push({ index, deps, effect, previousCleanup: previous?.cleanup });
    },

    createElement(type, props, ...children) {
      const nextProps = {
        ...(props || {}),
        children: children.length <= 1 ? children[0] : children,
      };
      if (typeof type === 'function') {
        return type(nextProps);
      }
      return { type, props: nextProps };
    },
  };

  react.Fragment = Symbol.for('react.fragment');

  react.createRenderer = (Component, props) => {
    const runtime = {
      hooks: [],
      effects: [],
      hookIndex: 0,
      pendingEffects: [],
      output: null,

      render(nextProps = props) {
        props = nextProps;
        runtime.hookIndex = 0;
        runtime.pendingEffects = [];
        activeRuntime = runtime;
        try {
          runtime.output = Component(props);
        } finally {
          activeRuntime = null;
        }
        for (const pending of runtime.pendingEffects) {
          pending.previousCleanup?.();
          runtime.effects[pending.index] = {
            deps: pending.deps,
            cleanup: pending.effect() || undefined,
          };
        }
        return runtime.output;
      },

      unmount() {
        for (const effect of runtime.effects) {
          effect?.cleanup?.();
        }
        runtime.effects = [];
      },
    };
    return runtime;
  };

  return react;
}

function compileModule(modulePath, stubs) {
  const source = fs.readFileSync(modulePath, 'utf8');
  const loader = path.extname(modulePath) === '.tsx' ? 'tsx' : 'ts';
  const { code } = esbuild.transformSync(source, {
    format: 'cjs',
    jsx: 'transform',
    loader,
    target: 'es2020',
  });
  const module = { exports: {} };
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    throw new Error(`Unexpected require(${id}) while compiling ${modulePath}`);
  };

  vm.runInNewContext(code, {
    console,
    exports: module.exports,
    module,
    require: localRequire,
    Symbol,
    TextEncoder,
    window: {
      addEventListener() {},
      removeEventListener() {},
    },
  });
  return module.exports;
}

function createRuntimeHarness() {
  const fakeReact = createFakeReact();
  const formRuntimeState = {
    clearFormFieldError(previous, id) {
      if (!Object.prototype.hasOwnProperty.call(previous, id)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    },
    setFormFieldError(previous, id, error) {
      if (previous[id] === error) return previous;
      return { ...previous, [id]: error };
    },
  };
  const contextExports = compileModule(FORM_RUNTIME_CONTEXT_PATH, { react: fakeReact });
  const runtimeExports = compileModule(FORM_RUNTIME_PATH, {
    react: fakeReact,
    './form-runtime-context': contextExports,
    './form-runtime-fields': { attachFormFields() {} },
    './form-runtime-state': formRuntimeState,
    '../i18n': { useI18n: () => ({ t: (key) => key }) },
  });

  const { Form } = runtimeExports.createFormRuntime({
    ExtensionInfoReactContext: fakeReact.createContext({}),
    useNavigation: () => ({ pop() {} }),
    useCollectedActions: () => ({ collectedActions: [], registryAPI: {} }),
    ActionRegistryContext: fakeReact.createContext({}),
    ActionPanelOverlay: () => null,
    matchesShortcut: () => false,
    isMetaK: () => false,
    renderShortcut: () => null,
    getExtensionContext: () => ({ extensionName: 'Snapshot Harness' }),
  });

  const renderer = fakeReact.createRenderer(Form, {
    children: null,
    actions: null,
    navigationTitle: 'Snapshot Harness',
    isLoading: false,
    draftValues: {},
  });

  return { contextExports, renderer };
}

function updateMountedForm(contextExports) {
  const formContext = contextExports.FormContext._lastProviderValue;
  formContext.setValue('submitted', 'value'.repeat(128));
  formContext.setValue('placeholder-backed', '');
  formContext.setPlaceholder('placeholder-backed', 'fallback'.repeat(96));
  formContext.setError('submitted', 'Required'.repeat(32));
}

function exerciseSnapshotLifecycle({ runUnmountCleanup }) {
  const { contextExports, renderer } = createRuntimeHarness();
  renderer.render();
  const afterMount = contextExports.getFormSnapshotRetentionMetrics();

  updateMountedForm(contextExports);
  renderer.render();
  const beforeUnmount = contextExports.getFormSnapshotRetentionMetrics();
  const submittedValues = contextExports.getFormValues();
  const submittedErrors = contextExports.getFormErrors();

  if (runUnmountCleanup) {
    renderer.unmount();
  }

  return {
    afterMount,
    beforeUnmount,
    afterUnmount: contextExports.getFormSnapshotRetentionMetrics(),
    submittedValues,
    submittedErrors,
  };
}

if (process.argv.includes('--report')) {
  if (!esbuild) {
    console.log(JSON.stringify({ skipped: 'esbuild dependency is not installed' }, null, 2));
  } else {
    console.log(
      JSON.stringify(
        {
          previousBehavior: exerciseSnapshotLifecycle({ runUnmountCleanup: false }),
          fixedBehavior: exerciseSnapshotLifecycle({ runUnmountCleanup: true }),
        },
        null,
        2,
      ),
    );
  }
} else if (!esbuild) {
  test('Form runtime unmount clears retained global snapshots', { skip: 'esbuild dependency is not installed' }, () => {});
} else {
  test('Form runtime unmount clears retained global snapshots', () => {
    const previousBehavior = exerciseSnapshotLifecycle({ runUnmountCleanup: false });
    assert.equal(previousBehavior.beforeUnmount.totalKeys > 0, true, 'mounted form should publish global snapshot keys');
    assert.equal(
      previousBehavior.afterUnmount.totalKeys,
      previousBehavior.beforeUnmount.totalKeys,
      'without an unmount cleanup, form snapshot keys remain retained',
    );
    assert.equal(
      previousBehavior.afterUnmount.serializedBytes,
      previousBehavior.beforeUnmount.serializedBytes,
      'without an unmount cleanup, serialized snapshot bytes remain retained',
    );

    const fixedBehavior = exerciseSnapshotLifecycle({ runUnmountCleanup: true });
    assert.equal(
      fixedBehavior.submittedValues['placeholder-backed'],
      'fallback'.repeat(96),
      'placeholder fallback should remain available while the form is mounted',
    );
    assert.equal(fixedBehavior.submittedErrors.submitted, 'Required'.repeat(32));
    assert.equal(fixedBehavior.beforeUnmount.totalKeys, previousBehavior.beforeUnmount.totalKeys);
    assert.equal(fixedBehavior.beforeUnmount.serializedBytes, previousBehavior.beforeUnmount.serializedBytes);
    assert.equal(fixedBehavior.afterUnmount.valueKeys, 0);
    assert.equal(fixedBehavior.afterUnmount.errorKeys, 0);
    assert.equal(fixedBehavior.afterUnmount.placeholderKeys, 0);
    assert.equal(fixedBehavior.afterUnmount.totalKeys, 0);
    assert.equal(fixedBehavior.afterUnmount.serializedBytes, 43);
  });
}
