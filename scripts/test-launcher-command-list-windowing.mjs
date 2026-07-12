#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listPath = path.join(repoRoot, 'src/renderer/src/components/LauncherCommandList.tsx');

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
  assert.equal(fullSizeScenarios.length, 5);

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

test('launcher virtualization pins rendered item heights to the reserved row heights', () => {
  const metrics = runMeasurement();
  const largeResults = metrics.results.filter((result) => result.commandCount === 5000);

  assert.ok(
    largeResults.some((result) => result.hasVirtualCommandSlotHeight),
    'virtualized command slots should reserve the command row height'
  );
  assert.ok(
    largeResults.some((result) => result.hasVirtualCommandBodyHeight),
    'virtualized command rows should pin their body height inside the reserved slot'
  );
  assert.ok(
    largeResults.some((result) => result.hasVirtualSectionHeight),
    'virtualized section headers should pin their rendered height'
  );
  assert.ok(
    largeResults.some((result) => result.hasVirtualCalculatorBodyHeight),
    'virtualized calculator cards should pin their rendered height'
  );
});

test('launcher command list does not own selected-entry smooth scrolling', () => {
  const source = fs.readFileSync(listPath, 'utf8');

  assert.doesNotMatch(
    source,
    /\.scrollTo\(\{\s*top:[\s\S]*behavior:\s*['"]smooth['"]/,
    'App.tsx owns selected-row smooth scrolling; the virtualized list should only maintain viewport measurements'
  );
});
