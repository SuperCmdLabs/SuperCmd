#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createAerospaceWorkspaceMover } = await importTs(path.join(root, 'src/main/aerospace-workspace.ts'));

test('AeroSpace workspace mover', async (t) => {
  await t.test('coalesces concurrent move requests into one follow-up run', async () => {
    const calls = [];
    const mover = createAerospaceWorkspaceMover({
      platform: 'darwin',
      runCommand: async (args) => {
        calls.push(args);
        await delay(10);
        if (args[0] === 'list-workspaces') return 'work\n';
        if (args[0] === 'list-windows') return '42 other\n';
        return '';
      },
    });

    mover.requestMove();
    mover.requestMove();
    mover.requestMove();

    await mover.whenIdle();

    assert.deepEqual(
      calls.map((args) => args[0]),
      [
        'list-workspaces',
        'list-windows',
        'move-node-to-workspace',
        'list-workspaces',
        'list-windows',
        'move-node-to-workspace',
      ],
    );
    assert.deepEqual(mover.getState(), { available: true, inFlight: false, queued: false });
  });

  await t.test('marks missing aerospace binary unavailable and skips later requests', async () => {
    let calls = 0;
    const mover = createAerospaceWorkspaceMover({
      platform: 'darwin',
      runCommand: async () => {
        calls += 1;
        const error = new Error('spawn aerospace ENOENT');
        error.code = 'ENOENT';
        throw error;
      },
    });

    mover.requestMove();
    await mover.whenIdle();
    mover.requestMove();
    await delay(0);

    assert.equal(calls, 1);
    assert.deepEqual(mover.getState(), { available: false, inFlight: false, queued: false });
  });

  await t.test('does not block the event loop while slow commands are in flight', async () => {
    const slowCommandDelayMs = 80;
    const calls = [];
    const mover = createAerospaceWorkspaceMover({
      platform: 'darwin',
      runCommand: async (args) => {
        calls.push(args);
        await delay(slowCommandDelayMs);
        if (args[0] === 'list-workspaces') return 'work\n';
        if (args[0] === 'list-windows') return '42 other\n';
        return '';
      },
    });

    const startedAt = performance.now();
    let zeroDelayTimerFiredAfterMs = Number.POSITIVE_INFINITY;
    const timerPromise = new Promise((resolve) => {
      setTimeout(() => {
        zeroDelayTimerFiredAfterMs = performance.now() - startedAt;
        resolve();
      }, 0);
    });

    mover.requestMove();
    await timerPromise;
    await mover.whenIdle();

    assert.ok(calls.length >= 1, 'first command should start');
    assert.ok(
      zeroDelayTimerFiredAfterMs < slowCommandDelayMs,
      `zero-delay timer fired after ${zeroDelayTimerFiredAfterMs}ms`,
    );
  });
});
