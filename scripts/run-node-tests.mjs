#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const TEST_DIR = path.join(REPO_ROOT, 'scripts');
const EXCLUDED_PERF_TESTS = new Set([
  'test-browser-search-performance.mjs',
  'test-file-search-perf-harness.mjs',
  'test-root-search-perf.mjs',
]);

const args = new Set(process.argv.slice(2));
const excludePerf = args.has('--exclude-perf');
const entries = await fs.readdir(TEST_DIR);
const testFiles = entries
  .filter((entry) => /^test-.*\.mjs$/.test(entry))
  .filter((entry) => !excludePerf || !EXCLUDED_PERF_TESTS.has(entry))
  .sort()
  .map((entry) => path.join('scripts', entry));

if (testFiles.length === 0) {
  throw new Error('No Node test files matched the requested filters.');
}

if (excludePerf) {
  console.log(`Running ${testFiles.length} Node test files; excluded ${EXCLUDED_PERF_TESTS.size} perf harness files.`);
}

const child = spawn(process.execPath, ['--test', ...testFiles], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
