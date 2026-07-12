#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { importTs } from './lib/ts-import.mjs';

const {
  createLocalAsrHelperStatusProbeCache,
  isCacheableLocalAsrHelperStatus,
} = await importTs(path.resolve('src/main/local-model-status-probe.ts'));

function makeStatus(overrides = {}) {
  return {
    state: 'downloaded',
    modelName: 'parakeet-tdt-0.6b-v3',
    path: '/models/parakeet',
    progress: 1,
    ...overrides,
  };
}

function spinForMs(durationMs) {
  const end = performance.now() + durationMs;
  while (performance.now() < end) {}
}

test('local ASR helper status cache reuses stable statuses within the TTL', () => {
  let now = 1_000;
  let probeCalls = 0;
  const cache = createLocalAsrHelperStatusProbeCache({
    ttlMs: 5_000,
    now: () => now,
    readStatus() {
      probeCalls += 1;
      return makeStatus({ path: `/models/parakeet-${probeCalls}` });
    },
  });

  assert.equal(cache.getStatus().path, '/models/parakeet-1');
  assert.equal(cache.getStatus().path, '/models/parakeet-1');
  assert.equal(probeCalls, 1);

  now += 5_001;
  assert.equal(cache.getStatus().path, '/models/parakeet-2');
  assert.equal(probeCalls, 2);
});

test('local ASR helper status cache bypasses cached stable status when force refreshing', () => {
  let probeCalls = 0;
  const cache = createLocalAsrHelperStatusProbeCache({
    ttlMs: 5_000,
    readStatus() {
      probeCalls += 1;
      return makeStatus({ path: `/models/qwen3-${probeCalls}` });
    },
  });

  assert.equal(cache.getStatus().path, '/models/qwen3-1');
  assert.equal(cache.getStatus({ forceRefresh: true }).path, '/models/qwen3-2');
  assert.equal(cache.getStatus().path, '/models/qwen3-2');
  assert.equal(probeCalls, 2);
});

test('local ASR helper status cache does not retain transient statuses', () => {
  const statuses = [
    makeStatus({ state: 'downloading', path: '', progress: 0.5 }),
    makeStatus({ state: 'error', path: '', progress: 0, error: 'failed' }),
    makeStatus({ state: 'not-downloaded', path: '', progress: 0 }),
  ];
  let probeCalls = 0;
  const cache = createLocalAsrHelperStatusProbeCache({
    ttlMs: 5_000,
    readStatus() {
      const status = statuses[Math.min(probeCalls, statuses.length - 1)];
      probeCalls += 1;
      return status;
    },
  });

  assert.equal(cache.getStatus().state, 'downloading');
  assert.equal(cache.getStatus().state, 'error');
  assert.equal(cache.getStatus().state, 'not-downloaded');
  assert.equal(cache.getStatus().state, 'not-downloaded');
  assert.equal(probeCalls, 3);
});

test('local ASR helper status cache can remember a fresh post-download status', () => {
  let probeCalls = 0;
  const cache = createLocalAsrHelperStatusProbeCache({
    ttlMs: 5_000,
    readStatus() {
      probeCalls += 1;
      return makeStatus({ state: 'not-downloaded', path: '', progress: 0 });
    },
  });

  assert.equal(cache.getStatus().state, 'not-downloaded');
  cache.rememberStatus(makeStatus({ state: 'downloaded', path: '/models/fresh', progress: 1 }));

  const status = cache.getStatus();
  assert.equal(status.state, 'downloaded');
  assert.equal(status.path, '/models/fresh');
  assert.equal(probeCalls, 1);
});

test('local ASR helper status cache measurement avoids repeated fake sync probes', () => {
  const iterations = 60;
  const fakeProbeMs = 1.75;
  let legacyProbeCalls = 0;
  const legacyStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    legacyProbeCalls += 1;
    spinForMs(fakeProbeMs);
  }
  const legacyMs = performance.now() - legacyStart;

  let cachedProbeCalls = 0;
  const cache = createLocalAsrHelperStatusProbeCache({
    ttlMs: 5_000,
    readStatus() {
      cachedProbeCalls += 1;
      spinForMs(fakeProbeMs);
      return makeStatus();
    },
  });

  const cachedStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    cache.getStatus();
  }
  const cachedMs = performance.now() - cachedStart;

  console.log(
    `[local-model-status probe-cache] iterations=${iterations} ` +
    `legacyCalls=${legacyProbeCalls} legacyMs=${legacyMs.toFixed(3)} ` +
    `cachedCalls=${cachedProbeCalls} cachedMs=${cachedMs.toFixed(3)} ` +
    `avoidedCalls=${legacyProbeCalls - cachedProbeCalls}`
  );

  assert.equal(legacyProbeCalls, iterations);
  assert.equal(cachedProbeCalls, 1);
  assert.equal(isCacheableLocalAsrHelperStatus(makeStatus()), true);
  assert.ok(cachedMs < legacyMs / 4);
});
