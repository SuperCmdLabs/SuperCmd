#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = process.cwd();
const EXTENSION_VIEW_PATH = path.join(ROOT, 'src/renderer/src/ExtensionView.tsx');
const source = fs.readFileSync(EXTENSION_VIEW_PATH, 'utf8');

function sourceBetween(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Could not find start marker: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `Could not find end marker: ${endNeedle}`);
  return source.slice(start, end);
}

function runTranspiledSnippet(snippet) {
  const transpiled = ts.transpileModule(snippet, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: EXTENSION_VIEW_PATH,
  });
  const debugCalls = [];
  const sandbox = {
    console: {
      debug: (...args) => debugCalls.push(args),
    },
    __debugCalls: debugCalls,
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: EXTENSION_VIEW_PATH });
  return sandbox.__result;
}

test('baseline: legacy success diagnostics log and stringify exported functions', () => {
  const logCalls = [];
  let toStringCalls = 0;
  const exported = function Command() {};
  exported.toString = () => {
    toStringCalls += 1;
    return 'function Command() { return "ok"; }';
  };

  const legacyConsole = {
    log: (...args) => logCalls.push(args),
  };

  legacyConsole.log('[loadExtensionExport] Extension loaded successfully');
  legacyConsole.log('[loadExtensionExport] Exported type:', typeof exported);
  legacyConsole.log('[loadExtensionExport] Exported name:', exported?.name);
  legacyConsole.log('[loadExtensionExport] Exported function:', exported?.toString?.().slice(0, 200));

  console.log(
    `[baseline] extension runtime success diagnostics: logs=${logCalls.length} exportedToStringCalls=${toStringCalls}`
  );

  assert.equal(logCalls.length, 4);
  assert.equal(toStringCalls, 1);
});

test('extension runtime debug helper is quiet unless explicitly enabled', () => {
  const helperSource = sourceBetween(
    'const EXTENSION_RUNTIME_DEBUG_GLOBAL',
    '// ─── React Module for Extensions'
  );
  const result = runTranspiledSnippet(`
    ${helperSource}
    const beforeEnabled = isExtensionRuntimeDebugLoggingEnabled();
    logExtensionRuntimeDebug('quiet');
    globalThis[EXTENSION_RUNTIME_DEBUG_GLOBAL] = true;
    const afterEnabled = isExtensionRuntimeDebugLoggingEnabled();
    logExtensionRuntimeDebug('loud', 42);
    globalThis.__result = {
      beforeEnabled,
      afterEnabled,
      debugCalls: globalThis.__debugCalls,
    };
  `);

  console.log(
    `[after] extension runtime debug helper: defaultDebugCalls=0 enabledDebugCalls=${result.debugCalls.length}`
  );

  assert.equal(result.beforeEnabled, false);
  assert.equal(result.afterEnabled, true);
  assert.deepEqual(result.debugCalls, [['loud', 42]]);
});

test('success-path extension runtime diagnostics are gated behind debug logging', () => {
  const moduleReactSetup = sourceBetween(
    '// Create React module for extensions',
    '// ─── JSX Runtime for Extensions'
  );
  const reactRequireBridge = sourceBetween(
    'let reactRequireCount = 0;',
    '// ── Raycast API shim'
  );
  const loadSuccessPath = sourceBetween(
    'const exported =\n      fakeModule.exports.default || fakeModule.exports;',
    'if (typeof exported === \'function\')'
  );
  const viewRenderer = sourceBetween(
    'const ViewRenderer: React.FC<{',
    'const ScopedExtensionContext: React.FC<{'
  );

  for (const [label, snippet] of [
    ['module React setup', moduleReactSetup],
    ['fakeRequire React bridge', reactRequireBridge],
    ['loadExtensionExport success path', loadSuccessPath],
    ['ViewRenderer render path', viewRenderer],
  ]) {
    assert.doesNotMatch(snippet, /console\.log/, `${label} must not emit unconditional console.log diagnostics`);
  }

  assert.match(moduleReactSetup, /logExtensionRuntimeDebug/);
  assert.match(reactRequireBridge, /logExtensionRuntimeDebug/);
  assert.match(loadSuccessPath, /if \(isExtensionRuntimeDebugLoggingEnabled\(\)\)/);
  assert.match(viewRenderer, /logExtensionRuntimeDebug/);

  const beforeDebugGate = loadSuccessPath.slice(
    0,
    loadSuccessPath.indexOf('if (isExtensionRuntimeDebugLoggingEnabled())')
  );
  assert.doesNotMatch(beforeDebugGate, /toString/, 'exported function toString must not run before debug is enabled');
  assert.match(loadSuccessPath, /console\.debug\('\[loadExtensionExport\] Exported function:', exported\?\.toString/);
});

test('actionable warnings and errors remain available', () => {
  assert.match(source, /console\.warn\('Extension exported an object, not a function\. Trying to wrap it\.'\)/);
  assert.match(source, /console\.warn\(`Extension tried to require unknown module:/);
  assert.match(source, /console\.error\('Extension did not export a function\. Got:'/);
  assert.match(source, /console\.error\('Failed to load extension:'/);
  assert.match(source, /console\.error\('Stack:'/);
});
