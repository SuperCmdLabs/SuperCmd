#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { runFileSearchPerfHarness } from './file-search-perf-harness.mjs';

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('file search perf harness covers deterministic temp-home scenarios', async () => {
  const summary = await runFileSearchPerfHarness({
    projects: 8,
    modulesPerProject: 3,
    filesPerModule: 6,
    queryRuns: 2,
    updateCount: 10,
    deleteCount: 10,
    limit: 8,
    thresholds: {
      initialIndexMs: 15_000,
      normalQueryP95Ms: 2_000,
      pathQueryP95Ms: 2_000,
      watchUpdateBatchMs: 5_000,
      deleteBatchMs: 5_000,
    },
  });

  assert.equal(summary.thresholds.passed, true, summary.thresholds.failures.join('\n'));
  assert.equal(summary.verification.homeDirectoryUsed, summary.fixture.homeDir);
  assert.equal(summary.verification.homeIsTempDirectory, true);
  assert.ok(
    summary.fixture.homeDir.startsWith(await fs.realpath(os.tmpdir())),
    'harness must use an OS temp home'
  );
  assert.equal(summary.cleanup.completed, true);
  assert.equal(await pathExists(summary.fixture.tempRoot), false, 'temp fixture should be cleaned up');

  assert.ok(summary.fixture.initialEntryCount >= summary.fixture.initialFileCount);
  assert.ok(summary.metrics.initialIndexMs >= 0);
  assert.ok(summary.metrics.normalQueries.totalResults > 0);
  assert.ok(summary.metrics.pathLikeQueries.totalResults > 0);
  assert.ok(summary.verification.postUpdateResultCount > 0);
  assert.equal(summary.verification.deletedExactMatches, 0);
});
