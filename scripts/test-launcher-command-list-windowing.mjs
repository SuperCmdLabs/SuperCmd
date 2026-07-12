#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runMeasurement() {
  const output = execFileSync(
    process.execPath,
    [
      'scripts/measure-launcher-command-list-render.mjs',
      '--rows=5000',
      '--iterations=1',
      '--warmups=0',
      '--json',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }
  );
  const jsonStart = output.lastIndexOf('{\n  "rowCount"');
  assert.notEqual(jsonStart, -1, `Measurement output did not include JSON summary:\n${output}`);
  return JSON.parse(output.slice(jsonStart));
}

test('launcher command list windows large result sets instead of rendering every row', () => {
  const metrics = runMeasurement();
  const fullSizeScenarios = metrics.results.filter((result) => result.commandCount === 5000);
  assert.equal(fullSizeScenarios.length, 4);

  for (const result of fullSizeScenarios) {
    assert.ok(
      result.rowRenderCount < 100,
      `${result.name} rendered ${result.rowRenderCount} rows for ${result.commandCount} commands`
    );
  }

  assert.ok(
    metrics.totalRows < 300,
    `Expected the full scenario sequence to render fewer than 300 rows, got ${metrics.totalRows}`
  );
});
