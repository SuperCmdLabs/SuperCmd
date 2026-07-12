#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const helperPath = path.resolve('src/renderer/src/raycast-api/hooks/use-stable-args.ts');

function loadHelper() {
  const source = fs.readFileSync(helperPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: helperPath,
  });

  const module = { exports: {} };
  const sandbox = {
    Array,
    Error,
    JSON,
    Map,
    Math,
    module,
    Object,
    require: (request) => {
      if (request === 'react') {
        return { useRef: (value) => ({ current: value }) };
      }
      return require(request);
    },
    String,
    Symbol,
    WeakMap,
    WeakSet,
    exports: module.exports,
  };

  vm.runInNewContext(transpiled.outputText, sandbox, { filename: helperPath });
  return module.exports;
}

function measure(label, fn) {
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  return { label, durationMs: Number(durationMs.toFixed(3)), result };
}

const { getStableArgsKey } = loadHelper();
const rows = Array.from({ length: 10000 }, (_, index) => ({
  index,
  label: `row-${index}`,
  payload: 'x'.repeat(64),
}));
const largeArgs = [rows];
const cyclic = { rows };
cyclic.self = cyclic;

const iterations = Number(process.env.SUPERCMD_HOOK_SIGNATURE_ITERATIONS || 500);
const direct = measure('direct JSON.stringify repeated', () => {
  let key = '';
  for (let index = 0; index < iterations; index += 1) {
    key = JSON.stringify(largeArgs);
  }
  return key.length;
});

getStableArgsKey(largeArgs);
const cached = measure('getStableArgsKey repeated same identity', () => {
  let key = '';
  for (let index = 0; index < iterations; index += 1) {
    key = getStableArgsKey(largeArgs);
  }
  return key.length;
});

const cyclicResult = measure('getStableArgsKey cyclic args', () => getStableArgsKey([cyclic]).length);

console.log(JSON.stringify({
  iterations,
  direct,
  cached,
  cyclicResult,
  cachedSpeedup: Number((direct.durationMs / Math.max(cached.durationMs, 0.001)).toFixed(2)),
}, null, 2));
