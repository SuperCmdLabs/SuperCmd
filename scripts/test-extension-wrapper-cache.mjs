#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  clearCompiledExtensionWrapperCache,
  getCompiledExtensionWrapper,
  getCompiledExtensionWrapperCacheStats,
} = await importTs(path.join(root, 'src/renderer/src/utils/extension-wrapper-cache.ts'));

function createRunEnv() {
  const moduleExports = {};
  const fakeModule = { exports: moduleExports };
  const timers = new Set();
  const trackTimeout = (cb, ms, ...rest) => {
    const id = setTimeout(cb, ms, ...rest);
    timers.add(id);
    return id;
  };
  const trackClearTimeout = (id) => {
    timers.delete(id);
    clearTimeout(id);
  };

  return {
    fakeModule,
    timers,
    args: [
      moduleExports,
      () => ({}),
      fakeModule,
      '/extension/index.js',
      '/extension',
      { env: {} },
      Buffer,
      globalThis,
      globalThis,
      globalThis,
      globalThis,
      globalThis.document,
      (fn, ...args) => trackTimeout(() => fn(...args), 0),
      trackClearTimeout,
      () => 0,
      () => {},
      trackTimeout,
      trackClearTimeout,
      () => 0,
      () => {},
      undefined,
      async () => ({}),
    ],
    cleanup: () => {
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
    },
  };
}

function runWrapper(wrapper) {
  const env = createRunEnv();
  wrapper(...env.args);
  return env;
}

test('Extension wrapper cache', async (t) => {
  await t.test('reuses the compiled wrapper for the same extension code', () => {
    clearCompiledExtensionWrapperCache();
    const code = 'exports.default = function Command() { return "ok"; };';

    const first = getCompiledExtensionWrapper({
      extensionIdentity: 'owner/extension/command',
      code,
    });
    const second = getCompiledExtensionWrapper({
      extensionIdentity: 'owner/extension/command',
      code,
    });

    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.strictEqual(second.wrapper, first.wrapper);
    assert.equal(getCompiledExtensionWrapperCacheStats().wrapperCreationCount, 1);
  });

  await t.test('invalidates when code changes even if the length is unchanged', () => {
    clearCompiledExtensionWrapperCache();
    const codeA = 'exports.default = function Command() { return "a"; };';
    const codeB = 'exports.default = function Command() { return "b"; };';
    assert.equal(codeA.length, codeB.length, 'fixture code must keep equal length');

    const first = getCompiledExtensionWrapper({
      extensionIdentity: 'owner/extension/command',
      code: codeA,
    });
    const changed = getCompiledExtensionWrapper({
      extensionIdentity: 'owner/extension/command',
      code: codeB,
    });

    assert.equal(first.cacheHit, false);
    assert.equal(changed.cacheHit, false);
    assert.notEqual(changed.cacheKey, first.cacheKey);
    assert.notStrictEqual(changed.wrapper, first.wrapper);

    const envA = runWrapper(first.wrapper);
    const envB = runWrapper(changed.wrapper);
    try {
      assert.equal(envA.fakeModule.exports.default(), 'a');
      assert.equal(envB.fakeModule.exports.default(), 'b');
    } finally {
      envA.cleanup();
      envB.cleanup();
    }
  });

  await t.test('keeps module exports and timer handles fresh across cached runs', () => {
    clearCompiledExtensionWrapperCache();
    const code = `
let moduleScopedCounter = 0;
moduleScopedCounter += 1;
const timerId = setTimeout(() => {}, 60000);
exports.default = {
  moduleScopedCounter,
  timerId,
  previousTouchedValue: exports.touched
};
exports.touched = "mutated";
`;

    const first = getCompiledExtensionWrapper({
      extensionIdentity: 'owner/extension/command',
      code,
    });
    const second = getCompiledExtensionWrapper({
      extensionIdentity: 'owner/extension/command',
      code,
    });
    assert.equal(second.cacheHit, true);
    assert.strictEqual(second.wrapper, first.wrapper);

    const envA = runWrapper(second.wrapper);
    const envB = runWrapper(second.wrapper);
    try {
      assert.notStrictEqual(envA.fakeModule.exports, envB.fakeModule.exports);
      assert.equal(envA.fakeModule.exports.default.moduleScopedCounter, 1);
      assert.equal(envB.fakeModule.exports.default.moduleScopedCounter, 1);
      assert.equal(envA.fakeModule.exports.default.previousTouchedValue, undefined);
      assert.equal(envB.fakeModule.exports.default.previousTouchedValue, undefined);
      assert.equal(envA.timers.size, 1);
      assert.equal(envB.timers.size, 1);
      assert.notStrictEqual(
        envA.fakeModule.exports.default.timerId,
        envB.fakeModule.exports.default.timerId
      );
    } finally {
      envA.cleanup();
      envB.cleanup();
    }

    assert.equal(envA.timers.size, 0);
    assert.equal(envB.timers.size, 0);
  });
});
