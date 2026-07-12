#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { runFileSearchPerfHarness } from './file-search-perf-harness.mjs';

const IS_PERF_CI = process.env.SUPERCMD_PERF_CI === '1';
const IS_PERF_REPORT = IS_PERF_CI || process.env.SUPERCMD_PERF_REPORT === '1';

function budgetEntry(actual, budget) {
  return {
    actualMs: actual,
    budgetMs: budget,
    budgetUsedPct: budget > 0 ? Number(((actual / budget) * 100).toFixed(1)) : null,
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function pickBudgetEvidence(summary) {
  const thresholds = summary.thresholds.applied;
  return {
    label: summary.label,
    config: summary.config,
    fixture: {
      indexedEntries: summary.fixture.initialEntryCount,
      indexedFiles: summary.fixture.initialFileCount,
      updateCount: summary.fixture.updateCount,
      deleteCount: summary.fixture.deleteCount,
    },
    budgets: {
      initialIndexMs: budgetEntry(summary.metrics.initialIndexMs, thresholds.initialIndexMs),
      normalQueryP95Ms: budgetEntry(summary.metrics.normalQueries.p95Ms, thresholds.normalQueryP95Ms),
      pathQueryP95Ms: budgetEntry(summary.metrics.pathLikeQueries.p95Ms, thresholds.pathQueryP95Ms),
      eventLoopLagP95Ms: budgetEntry(summary.metrics.eventLoopLag.p95Ms, thresholds.eventLoopLagP95Ms),
      watchUpdateBatchMs: budgetEntry(summary.metrics.watchUpdateBatchMs, thresholds.watchUpdateBatchMs),
      deleteBatchMs: budgetEntry(summary.metrics.deleteBatchMs, thresholds.deleteBatchMs),
    },
    metrics: {
      initialIndexMs: summary.metrics.initialIndexMs,
      initialIndexEventLoopDelayP95Ms: summary.metrics.initialIndexEventLoopDelay.p95Ms,
      normalQueryP95Ms: summary.metrics.normalQueries.p95Ms,
      pathQueryP95Ms: summary.metrics.pathLikeQueries.p95Ms,
      eventLoopLagP95Ms: summary.metrics.eventLoopLag.p95Ms,
      eventLoopLagMaxMs: summary.metrics.eventLoopLag.maxMs,
      watchUpdateBatchMs: summary.metrics.watchUpdateBatchMs,
      deleteBatchMs: summary.metrics.deleteBatchMs,
      postUpdateQueryMs: summary.metrics.postUpdateQueryMs,
      postDeleteQueryMs: summary.metrics.postDeleteQueryMs,
    },
    thresholds: summary.thresholds,
    thresholdStatus: summary.thresholds.passed ? 'passed' : 'failed',
    cleanup: summary.cleanup,
  };
}

function printFileSearchPerfReport(label, summary) {
  if (!IS_PERF_REPORT) return;
  console.log(JSON.stringify({ fileSearchPerf: pickBudgetEvidence({ ...summary, label }) }, null, 2));
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
      eventLoopLagP95Ms: 2_000,
      watchUpdateBatchMs: 5_000,
      deleteBatchMs: 5_000,
    },
  });

  assert.equal(summary.thresholds.passed, true, summary.thresholds.failures.join('\n'));
  printFileSearchPerfReport('deterministic-small', summary);
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
  assert.ok(summary.metrics.eventLoopLag.p95Ms >= 0);
  assert.ok(summary.verification.postUpdateResultCount > 0);
  assert.equal(summary.verification.deletedExactMatches, 0);
});

test('file search perf CI covers large path-query p95 and event-loop lag budgets', { skip: !IS_PERF_CI }, async () => {
  const summary = await runFileSearchPerfHarness({
    projects: 120,
    modulesPerProject: 8,
    filesPerModule: 32,
    queryRuns: 3,
    updateCount: 64,
    deleteCount: 64,
    limit: 16,
    thresholds: {
      initialIndexMs: 60_000,
      normalQueryP95Ms: 3_000,
      pathQueryP95Ms: 3_000,
      eventLoopLagP95Ms: 5_000,
      watchUpdateBatchMs: 10_000,
      deleteBatchMs: 10_000,
    },
  });

  assert.equal(summary.thresholds.passed, true, summary.thresholds.failures.join('\n'));
  printFileSearchPerfReport('ci-large', summary);
  assert.ok(
    summary.fixture.initialEntryCount >= 30_000 && summary.fixture.initialEntryCount <= 60_000,
    `expected 30k-60k indexed entries, got ${summary.fixture.initialEntryCount}`
  );
  assert.ok(summary.metrics.pathLikeQueries.p95Ms <= summary.thresholds.applied.pathQueryP95Ms);
  assert.ok(summary.metrics.eventLoopLag.p95Ms <= summary.thresholds.applied.eventLoopLagP95Ms);
  assert.equal(summary.cleanup.completed, true);
  assert.equal(await pathExists(summary.fixture.tempRoot), false, 'large temp fixture should be cleaned up');
});
