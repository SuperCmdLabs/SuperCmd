#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('Raycast list and emoji selection only re-render changed visible items', async () => {
  const selectionSteps = 200;
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/measure-raycast-list-render-churn.mjs',
    '--iterations=2',
    '--warmups=1',
    `--selection-steps=${selectionSteps}`,
    '--json',
  ], {
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  const summary = JSON.parse(stdout);
  const expectedRenderCeiling = selectionSteps * 2;

  assert.equal(summary.selectionSteps, selectionSteps);
  assert.ok(
    summary.selectionRenderChurn.listItemRenderCount <= expectedRenderCeiling,
    `list selection rendered ${summary.selectionRenderChurn.listItemRenderCount} items, expected <= ${expectedRenderCeiling}`,
  );
  assert.ok(
    summary.selectionRenderChurn.emojiGridItemRenderCount <= expectedRenderCeiling,
    `emoji selection rendered ${summary.selectionRenderChurn.emojiGridItemRenderCount} items, expected <= ${expectedRenderCeiling}`,
  );
});
