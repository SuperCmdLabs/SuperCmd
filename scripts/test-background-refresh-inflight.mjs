#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const { createInFlightBackgroundRefreshTick } = await importTs(
  path.join(rootDir, 'src/renderer/src/hooks/backgroundRefreshTimers.ts')
);

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test('extension background refresh skips overlapping ticks while runExtension is in flight', async () => {
  let starts = 0;
  let active = 0;
  let maxConcurrent = 0;
  let dispatches = 0;
  const firstRun = deferred();
  const secondRun = deferred();
  const runs = [firstRun, secondRun];

  const tick = createInFlightBackgroundRefreshTick(async () => {
    const run = runs[starts];
    starts += 1;
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    await run.promise;
    active -= 1;
    dispatches += 1;
  });

  tick();
  await flushMicrotasks();
  tick();
  tick();
  await flushMicrotasks();

  assert.equal(starts, 1);
  assert.equal(maxConcurrent, 1);
  assert.equal(dispatches, 0);

  firstRun.resolve();
  await flushMicrotasks();

  tick();
  await flushMicrotasks();
  assert.equal(starts, 2);
  assert.equal(maxConcurrent, 1);

  secondRun.resolve();
  await flushMicrotasks();
  assert.equal(dispatches, 2);
});

test('inline script background refresh skips ticks until run and fetchCommands finish', async () => {
  let scriptStarts = 0;
  let fetchStarts = 0;
  let active = 0;
  let maxConcurrent = 0;
  const scriptRun = deferred();
  const fetchRun = deferred();

  const tick = createInFlightBackgroundRefreshTick(async () => {
    scriptStarts += 1;
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    await scriptRun.promise;
    fetchStarts += 1;
    await fetchRun.promise;
    active -= 1;
  });

  tick();
  await flushMicrotasks();
  tick();
  await flushMicrotasks();

  assert.equal(scriptStarts, 1);
  assert.equal(fetchStarts, 0);
  assert.equal(maxConcurrent, 1);

  scriptRun.resolve();
  await flushMicrotasks();
  tick();
  await flushMicrotasks();

  assert.equal(scriptStarts, 1);
  assert.equal(fetchStarts, 1);

  fetchRun.resolve();
  await flushMicrotasks();
  tick();
  await flushMicrotasks();

  assert.equal(scriptStarts, 2);
  assert.equal(maxConcurrent, 1);
});

test('independent background refresh timers can run at the same time', async () => {
  let extensionStarts = 0;
  let scriptStarts = 0;
  let active = 0;
  let maxConcurrent = 0;
  const extensionRun = deferred();
  const scriptRun = deferred();

  const extensionTick = createInFlightBackgroundRefreshTick(async () => {
    extensionStarts += 1;
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    await extensionRun.promise;
    active -= 1;
  });
  const scriptTick = createInFlightBackgroundRefreshTick(async () => {
    scriptStarts += 1;
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    await scriptRun.promise;
    active -= 1;
  });

  extensionTick();
  scriptTick();
  await flushMicrotasks();

  assert.equal(extensionStarts, 1);
  assert.equal(scriptStarts, 1);
  assert.equal(maxConcurrent, 2);

  extensionTick();
  scriptTick();
  await flushMicrotasks();
  assert.equal(extensionStarts, 1);
  assert.equal(scriptStarts, 1);

  extensionRun.resolve();
  scriptRun.resolve();
  await flushMicrotasks();
});
