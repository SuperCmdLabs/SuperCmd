#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const BASE_ENV = {
  ...process.env,
  SUPERCMD_ROOT_SEARCH_PERF_COMMANDS: '50',
  SUPERCMD_ROOT_SEARCH_PERF_ITERATIONS: '1',
  SUPERCMD_ROOT_SEARCH_PERF_WARMUPS: '0',
};

function runRootSearchPerf(extraEnv) {
  return spawnSync(process.execPath, ['scripts/test-root-search-perf.mjs'], {
    cwd: process.cwd(),
    env: { ...BASE_ENV, ...extraEnv },
    encoding: 'utf8',
  });
}

test('root search perf harness passes when configured budgets are met', () => {
  const result = runRootSearchPerf({
    SUPERCMD_ROOT_SEARCH_PERF_OPTIMIZED_MEDIAN_MS: '100000',
    SUPERCMD_ROOT_SEARCH_PERF_INDEXED_MEDIAN_MS: '100000',
    SUPERCMD_ROOT_SEARCH_PERF_COMPILE_MEDIAN_MS: '100000',
    SUPERCMD_ROOT_SEARCH_PERF_INDEXED_SPEEDUP_MIN: '0',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Root search perf harness/);
  assert.match(result.stdout, /optimized command scoring path: median=/);
  assert.match(result.stdout, /optimized-vs-indexed-speedup=/);
  assert.doesNotMatch(result.stderr, /Root search perf budget failures/);
});

test('root search perf harness exits nonzero when configured budgets fail', () => {
  const result = runRootSearchPerf({
    SUPERCMD_ROOT_SEARCH_PERF_OPTIMIZED_MEDIAN_MS: '0.001',
    SUPERCMD_ROOT_SEARCH_PERF_INDEXED_MEDIAN_MS: '0.001',
    SUPERCMD_ROOT_SEARCH_PERF_COMPILE_MEDIAN_MS: '0.001',
    SUPERCMD_ROOT_SEARCH_PERF_INDEXED_SPEEDUP_MIN: '999999',
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /Root search perf harness/);
  assert.match(result.stdout, /optimized command scoring path: median=/);
  assert.match(result.stderr, /Root search perf budget failures:/);
  assert.match(result.stderr, /SUPERCMD_ROOT_SEARCH_PERF_OPTIMIZED_MEDIAN_MS/);
  assert.match(result.stderr, /SUPERCMD_ROOT_SEARCH_PERF_INDEXED_MEDIAN_MS/);
  assert.match(result.stderr, /SUPERCMD_ROOT_SEARCH_PERF_COMPILE_MEDIAN_MS/);
  assert.match(result.stderr, /SUPERCMD_ROOT_SEARCH_PERF_INDEXED_SPEEDUP_MIN/);
});
