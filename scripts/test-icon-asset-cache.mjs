#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function createIconRuntimeHarness() {
  const moduleCache = new Map();
  const existingPaths = new Set();
  let statCalls = 0;
  let nowMs = 0;

  const windowStub = {
    electron: {
      statSync(filePath) {
        statCalls += 1;
        const exists = existingPaths.has(filePath);
        return {
          exists,
          isDirectory: false,
          isFile: exists,
          size: exists ? 123 : 0,
        };
      },
    },
  };
  const performanceStub = {
    now() {
      return nowMs;
    },
  };

  function loadTsModule(filePath) {
    const resolvedPath = path.resolve(filePath);
    if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath).exports;

    const source = fs.readFileSync(resolvedPath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
      fileName: resolvedPath,
    });

    const module = { exports: {} };
    moduleCache.set(resolvedPath, module);

    const localRequire = (request) => {
      if (request.startsWith('.')) {
        const candidate = path.resolve(path.dirname(resolvedPath), request);
        for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
          const nextPath = `${candidate}${suffix}`;
          if (fs.existsSync(nextPath) && fs.statSync(nextPath).isFile()) {
            if (nextPath.endsWith('.ts') || nextPath.endsWith('.tsx')) return loadTsModule(nextPath);
            return require(nextPath);
          }
        }
      }
      return require(request);
    };

    const sandbox = {
      module,
      exports: module.exports,
      require: localRequire,
      console,
      URL,
      window: windowStub,
      performance: performanceStub,
      document: {
        documentElement: {
          classList: {
            contains: () => false,
          },
        },
      },
    };

    vm.runInNewContext(transpiled.outputText, sandbox, { filename: resolvedPath });
    return module.exports;
  }

  return {
    assets: loadTsModule('src/renderer/src/raycast-api/icon-runtime-assets.tsx'),
    config: loadTsModule('src/renderer/src/raycast-api/icon-runtime-config.ts'),
    addExistingPath(filePath) {
      existingPaths.add(filePath);
    },
    advanceTime(ms) {
      nowMs += ms;
    },
    get statCalls() {
      return statCalls;
    },
  };
}

test('icon asset existence cache', async (t) => {
  await t.test('caches positive extension-relative asset checks by local path', () => {
    const harness = createIconRuntimeHarness();
    const assetsPath = '/tmp/supercmd-assets';
    const iconPath = `${assetsPath}/icon.png`;
    const expectedUrl = harness.assets.toScAssetUrl(iconPath);
    harness.addExistingPath(iconPath);

    for (let i = 0; i < 5; i += 1) {
      assert.equal(harness.assets.resolveIconSrc('icon.png', assetsPath), expectedUrl);
    }

    assert.equal(harness.statCalls, 1);
  });

  await t.test('shares positive cache entries across sc-asset and absolute path resolution', () => {
    const harness = createIconRuntimeHarness();
    const iconPath = '/tmp/supercmd-assets/shared icon.png';
    const expectedUrl = harness.assets.toScAssetUrl(iconPath);
    harness.addExistingPath(iconPath);

    assert.equal(harness.assets.resolveIconSrc(expectedUrl), expectedUrl);
    assert.equal(harness.assets.resolveIconSrc(iconPath), expectedUrl);

    assert.equal(harness.statCalls, 1);
  });

  await t.test('does not permanently cache misses so newly available assets resolve after the stale window', () => {
    const harness = createIconRuntimeHarness();
    const assetsPath = '/tmp/supercmd-assets';
    const iconPath = `${assetsPath}/late.png`;
    const expectedUrl = harness.assets.toScAssetUrl(iconPath);

    assert.equal(harness.assets.resolveIconSrc('late.png', assetsPath), '');
    harness.addExistingPath(iconPath);
    assert.equal(harness.assets.resolveIconSrc('late.png', assetsPath), '');

    harness.advanceTime(300);
    assert.equal(harness.assets.resolveIconSrc('late.png', assetsPath), expectedUrl);

    assert.equal(harness.statCalls, 2);
  });

  await t.test('uses configured assetsPath fallback without changing asset URL semantics', () => {
    const harness = createIconRuntimeHarness();
    const assetsPath = '/tmp/supercmd-extension-assets';
    const iconPath = `${assetsPath}/nested/icon dark.png`;
    const expectedUrl = harness.assets.toScAssetUrl(iconPath);
    harness.addExistingPath(iconPath);
    harness.config.configureIconRuntime({
      getExtensionContext: () => ({ assetsPath }),
    });

    assert.equal(harness.assets.resolveIconSrc('nested/icon dark.png'), expectedUrl);
    assert.equal(expectedUrl, 'sc-asset://ext-asset/tmp/supercmd-extension-assets/nested/icon%20dark.png');
    assert.equal(harness.statCalls, 1);
  });

  await t.test('repeated positive measurement avoids repeated statSync calls', () => {
    const harness = createIconRuntimeHarness();
    const assetsPath = '/tmp/supercmd-assets';
    const iconPath = `${assetsPath}/measured.png`;
    const expectedUrl = harness.assets.toScAssetUrl(iconPath);
    const iterations = 10_000;
    harness.addExistingPath(iconPath);

    const start = performance.now();
    let result = '';
    for (let i = 0; i < iterations; i += 1) {
      result = harness.assets.resolveIconSrc('measured.png', assetsPath);
    }
    const elapsedMs = performance.now() - start;

    assert.equal(result, expectedUrl);
    assert.equal(harness.statCalls, 1);
    console.log(`icon-asset-cache measurement: iterations=${iterations} statSync=${harness.statCalls} elapsedMs=${elapsedMs.toFixed(3)}`);
  });

  await t.test('repeated missing measurement avoids repeated statSync calls within the stale window', () => {
    const harness = createIconRuntimeHarness();
    const assetsPath = '/tmp/supercmd-assets';
    const iterations = 10_000;

    const start = performance.now();
    let result = 'not-run';
    for (let i = 0; i < iterations; i += 1) {
      result = harness.assets.resolveIconSrc('missing.png', assetsPath);
    }
    const elapsedMs = performance.now() - start;

    assert.equal(result, '');
    assert.equal(harness.statCalls, 1);
    console.log(`icon-asset-miss-cache measurement: iterations=${iterations} statSync=${harness.statCalls} elapsedMs=${elapsedMs.toFixed(3)}`);
  });
});
