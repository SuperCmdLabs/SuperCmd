#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importTs } from './lib/ts-import.mjs';

const FIVE_SECOND_TICKS = 5;

const {
  applyAiModelStatusPatch,
  createEmptyAiModelStatusSnapshot,
  fetchAiModelStatusPollPatch,
} = await importTs(path.resolve('src/renderer/src/settings/aiModelStatusPolling.ts'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeWhisperCppStatus(overrides = {}) {
  return {
    state: 'downloaded',
    modelName: 'base',
    path: '/models/ggml-base.bin',
    bytesDownloaded: 1024,
    totalBytes: 1024,
    ...overrides,
  };
}

function makeParakeetStatus(overrides = {}) {
  return {
    state: 'downloaded',
    modelName: 'parakeet-tdt-0.6b-v3',
    path: '/models/parakeet',
    progress: 1,
    ...overrides,
  };
}

function makeQwen3Status(overrides = {}) {
  return {
    state: 'downloaded',
    modelName: 'qwen3-asr',
    path: '/models/qwen3',
    progress: 1,
    ...overrides,
  };
}

function makeSnapshot(overrides = {}) {
  return {
    whisperCpp: makeWhisperCppStatus(overrides.whisperCpp),
    parakeet: makeParakeetStatus(overrides.parakeet),
    qwen3: makeQwen3Status(overrides.qwen3),
  };
}

function createStaticFetchers(snapshot) {
  const calls = {
    whisperCpp: 0,
    parakeet: 0,
    qwen3: 0,
  };

  return {
    calls,
    fetchers: {
      async whisperCpp() {
        calls.whisperCpp += 1;
        return clone(snapshot.whisperCpp);
      },
      async parakeet() {
        calls.parakeet += 1;
        return clone(snapshot.parakeet);
      },
      async qwen3() {
        calls.qwen3 += 1;
        return clone(snapshot.qwen3);
      },
    },
  };
}

function createFixedPollingHarness(initialSnapshot) {
  let current = initialSnapshot;
  let stateUpdates = 0;
  let profilerCommits = 0;

  function applyPatch(patch) {
    const next = applyAiModelStatusPatch(current, patch);
    if (next === current) return false;

    current = next;
    stateUpdates += 1;
    profilerCommits += 1;
    return true;
  }

  return {
    async poll(fetchers) {
      const patch = await fetchAiModelStatusPollPatch(fetchers);
      applyPatch(patch);
    },
    applyPatch,
    get current() {
      return current;
    },
    get metrics() {
      return { stateUpdates, profilerCommits };
    },
  };
}

async function simulateLegacyIndependentPolling(fetchers, ticks) {
  let stateUpdates = 0;
  let profilerCommits = 0;

  for (let tick = 0; tick < ticks; tick += 1) {
    await fetchers.whisperCpp();
    stateUpdates += 1;
    profilerCommits += 1;

    await fetchers.parakeet();
    stateUpdates += 1;
    profilerCommits += 1;

    await fetchers.qwen3();
    stateUpdates += 1;
    profilerCommits += 1;
  }

  return { stateUpdates, profilerCommits };
}

test('AI model status polling baseline performs three unchanged state writes per second', async () => {
  const snapshot = makeSnapshot();
  const { fetchers, calls } = createStaticFetchers(snapshot);

  const metrics = await simulateLegacyIndependentPolling(fetchers, FIVE_SECOND_TICKS);

  console.log(
    `[ai-status baseline] ticks=${FIVE_SECOND_TICKS} stateUpdates=${metrics.stateUpdates} profilerCommits=${metrics.profilerCommits}`
  );
  assert.deepEqual(calls, { whisperCpp: 5, parakeet: 5, qwen3: 5 });
  assert.deepEqual(metrics, { stateUpdates: 15, profilerCommits: 15 });
});

test('coalesced AI model status polling skips commits when statuses are unchanged', async () => {
  const snapshot = makeSnapshot();
  const { fetchers, calls } = createStaticFetchers(snapshot);
  const harness = createFixedPollingHarness(clone(snapshot));

  for (let tick = 0; tick < FIVE_SECOND_TICKS; tick += 1) {
    await harness.poll(fetchers);
  }

  console.log(
    `[ai-status coalesced unchanged] ticks=${FIVE_SECOND_TICKS} stateUpdates=${harness.metrics.stateUpdates} profilerCommits=${harness.metrics.profilerCommits}`
  );
  assert.deepEqual(calls, { whisperCpp: 5, parakeet: 5, qwen3: 5 });
  assert.deepEqual(harness.metrics, { stateUpdates: 0, profilerCommits: 0 });
});

test('coalesced AI model status polling commits once per tick when all statuses change', async () => {
  let tickValue = 0;
  const calls = {
    whisperCpp: 0,
    parakeet: 0,
    qwen3: 0,
  };
  const harness = createFixedPollingHarness(makeSnapshot({
    whisperCpp: { bytesDownloaded: 0, totalBytes: 100 },
    parakeet: { progress: 0 },
    qwen3: { progress: 0 },
  }));
  const fetchers = {
    async whisperCpp() {
      calls.whisperCpp += 1;
      return makeWhisperCppStatus({
        state: 'downloading',
        bytesDownloaded: tickValue,
        totalBytes: 100,
      });
    },
    async parakeet() {
      calls.parakeet += 1;
      return makeParakeetStatus({
        state: 'downloading',
        progress: tickValue / FIVE_SECOND_TICKS,
      });
    },
    async qwen3() {
      calls.qwen3 += 1;
      return makeQwen3Status({
        state: 'downloading',
        progress: tickValue / FIVE_SECOND_TICKS,
      });
    },
  };

  for (let tick = 1; tick <= FIVE_SECOND_TICKS; tick += 1) {
    tickValue = tick;
    await harness.poll(fetchers);
  }

  console.log(
    `[ai-status coalesced changing] ticks=${FIVE_SECOND_TICKS} stateUpdates=${harness.metrics.stateUpdates} profilerCommits=${harness.metrics.profilerCommits}`
  );
  assert.deepEqual(calls, { whisperCpp: 5, parakeet: 5, qwen3: 5 });
  assert.deepEqual(harness.metrics, { stateUpdates: 5, profilerCommits: 5 });
  assert.equal(harness.current.whisperCpp.bytesDownloaded, FIVE_SECOND_TICKS);
  assert.equal(harness.current.parakeet.progress, 1);
  assert.equal(harness.current.qwen3.progress, 1);
});

test('download progress status patches still commit when progress fields change', () => {
  const harness = createFixedPollingHarness(createEmptyAiModelStatusSnapshot());

  assert.equal(harness.applyPatch({
    whisperCpp: makeWhisperCppStatus({
      state: 'downloading',
      bytesDownloaded: 10,
      totalBytes: 100,
    }),
  }), true);
  assert.equal(harness.applyPatch({
    whisperCpp: makeWhisperCppStatus({
      state: 'downloading',
      bytesDownloaded: 10,
      totalBytes: 100,
    }),
  }), false);
  assert.equal(harness.applyPatch({
    whisperCpp: makeWhisperCppStatus({
      state: 'downloading',
      bytesDownloaded: 25,
      totalBytes: 100,
    }),
  }), true);
  assert.equal(harness.applyPatch({
    parakeet: makeParakeetStatus({ state: 'downloading', progress: 0.25 }),
  }), true);
  assert.equal(harness.applyPatch({
    qwen3: makeQwen3Status({ state: 'downloading', progress: 0.5 }),
  }), true);

  assert.deepEqual(harness.metrics, { stateUpdates: 4, profilerCommits: 4 });
  assert.equal(harness.current.whisperCpp.bytesDownloaded, 25);
  assert.equal(harness.current.parakeet.progress, 0.25);
  assert.equal(harness.current.qwen3.progress, 0.5);
});

test('coalesced poll starts all status requests before awaiting any one result', async () => {
  const started = [];
  const resolvers = [];
  const fetchers = {
    whisperCpp: () => new Promise((resolve) => {
      started.push('whisperCpp');
      resolvers.push(() => resolve(makeWhisperCppStatus()));
    }),
    parakeet: () => new Promise((resolve) => {
      started.push('parakeet');
      resolvers.push(() => resolve(makeParakeetStatus()));
    }),
    qwen3: () => new Promise((resolve) => {
      started.push('qwen3');
      resolvers.push(() => resolve(makeQwen3Status()));
    }),
  };

  const patchPromise = fetchAiModelStatusPollPatch(fetchers);

  assert.deepEqual(started, ['whisperCpp', 'parakeet', 'qwen3']);
  for (const resolve of resolvers) resolve();
  assert.deepEqual(await patchPromise, makeSnapshot());
});
