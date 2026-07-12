#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const extensionViewPath = path.resolve('src/renderer/src/ExtensionView.tsx');
const source = fs.readFileSync(extensionViewPath, 'utf8');

function extractBetween(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Could not locate ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `Could not locate ${endNeedle}`);
  return source.slice(start, end);
}

function loadBuiltinFacadeHarness() {
  const helperSource = extractBetween(
    'const SUPERCMD_BUILTIN_FACADE_MODULES',
    'const superCmdBuiltinFacadeCache'
  );
  const transpiled = ts.transpileModule(
    `${helperSource}
globalThis.__builtinFacadeHarness = {
  shouldUseSuperCmdBuiltinFacade,
  facadeModules: Array.from(SUPERCMD_BUILTIN_FACADE_MODULES),
};`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: extensionViewPath,
    }
  );
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(transpiled.outputText, sandbox, { filename: extensionViewPath });
  return sandbox.__builtinFacadeHarness;
}

test('extension require keeps compatibility facades ahead of real Node builtins', () => {
  const { shouldUseSuperCmdBuiltinFacade, facadeModules } = loadBuiltinFacadeHarness();

  assert.equal(JSON.stringify(facadeModules), JSON.stringify(['fs', 'fs/promises', 'child_process']));
  assert.equal(shouldUseSuperCmdBuiltinFacade('fs'), true);
  assert.equal(shouldUseSuperCmdBuiltinFacade('node:fs'), true);
  assert.equal(shouldUseSuperCmdBuiltinFacade('fs/promises'), true);
  assert.equal(shouldUseSuperCmdBuiltinFacade('child_process'), true);
  assert.equal(shouldUseSuperCmdBuiltinFacade('node:child_process'), true);

  for (const builtin of ['crypto', 'node:crypto', 'zlib', 'node:zlib']) {
    assert.equal(
      shouldUseSuperCmdBuiltinFacade(builtin),
      false,
      `${builtin} should fall through to real Node before the compatibility stub`
    );
  }
});

test('fakeRequire falls back to stubs only after real builtins fail', () => {
  const builtinRequireBlock = extractBetween(
    'Node.js built-in modules',
    'Swift native bridges'
  );

  const timerFacadeIndex = builtinRequireBlock.indexOf('isExtensionTimerBuiltinRequest(name)');
  const superCmdFacadeIndex = builtinRequireBlock.indexOf('shouldUseSuperCmdBuiltinFacade(name)');
  const realRequireIndex = builtinRequireBlock.indexOf('tryRealNodeRequire(name)');
  const stubFallbackIndex = builtinRequireBlock.indexOf('if (name in nodeBuiltinStubs)');

  assert.ok(timerFacadeIndex >= 0, 'timer builtins should keep their scoped facade path');
  assert.ok(superCmdFacadeIndex > timerFacadeIndex, 'SuperCmd-only facades should follow timer facades');
  assert.ok(realRequireIndex > superCmdFacadeIndex, 'real Node require should run after SuperCmd-only facades');
  assert.ok(stubFallbackIndex > realRequireIndex, 'compatibility stubs should be the final builtin fallback');
});
