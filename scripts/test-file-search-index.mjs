#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const SOURCE_PATH = path.resolve('src/main/file-search-index.ts');
const BASELINE_MODE = process.env.SUPERCMD_FILE_INDEX_BASELINE === '1';
const HEALTHY_INTERVAL_TICKS = 3;
const CLOCK_STEP_MS = 60_000;
const moduleCache = new Map();

function createFakeDate(clock) {
  return class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length > 0 ? args : [clock.now]));
    }

    static now() {
      return clock.now;
    }
  };
}

function transpileSource(source, fileName) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName,
  }).outputText;
}

function loadFileSearchIndexModule({ clock, logs }) {
  const source = `${fs.readFileSync(SOURCE_PATH, 'utf8')}

export const __fileSearchIndexTestInternals = {
  configureForTest(homeDir: string) {
    configuredHomeDir = path.resolve(homeDir);
    includeRoots = resolveIncludeRoots(configuredHomeDir);
    includeProtectedHomeRoots = false;
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS;
    lastBuildStartedAt = 0;
  },
  async applyWatchEventBatchForTest(paths: string[]) {
    await applyWatchEventBatch(paths);
  },
  setWatcherAvailableForTest(available: boolean) {
    activeWatcher = available ? ({ close() {} } as fs.FSWatcher) : null;
    watchedHomeDir = available ? configuredHomeDir : '';
    if (available && typeof lastWatcherError !== 'undefined') lastWatcherError = null;
  },
  async waitForIdleForTest() {
    while (rebuildPromise || indexing) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  },
};
`;

  const module = { exports: {} };
  const localRequire = (request) => require(request);
  const quietConsole = {
    ...console,
    log: (...args) => {
      logs.push(args.map(String).join(' '));
    },
    warn: (...args) => {
      logs.push(args.map(String).join(' '));
    },
    error: (...args) => {
      logs.push(args.map(String).join(' '));
    },
  };
  const sandboxProcess = Object.create(process);
  Object.defineProperty(sandboxProcess, 'platform', { value: 'linux' });

  const sandbox = {
    module,
    exports: module.exports,
    require: localRequire,
    console: quietConsole,
    URL,
    Date: createFakeDate(clock),
    Math,
    String,
    Number,
    Boolean,
    Set,
    Map,
    WeakMap,
    Object,
    Array,
    RegExp,
    Promise,
    process: sandboxProcess,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpileSource(source, SOURCE_PATH), sandbox, { filename: SOURCE_PATH });
  return module.exports;
}

function loadTsModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath).exports;

  const source = fs.readFileSync(resolvedPath, 'utf8');
  const module = { exports: {} };
  moduleCache.set(resolvedPath, module);
  const localRequire = (request) => {
    if (request.startsWith('.')) {
      const candidate = path.resolve(path.dirname(resolvedPath), request);
      for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
        const nextPath = `${candidate}${suffix}`;
        if (fs.existsSync(nextPath) && fs.statSync(nextPath).isFile()) {
          if (nextPath.endsWith('.ts') || nextPath.endsWith('.tsx')) return loadTsModule(nextPath);
          return require(nextPath);
        }
      }
    }
    return require(request);
  };
  const sandbox = {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    URL,
    Date,
    Math,
    String,
    Number,
    Boolean,
    Set,
    Map,
    WeakMap,
    Object,
    Array,
    RegExp,
    Promise,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(transpileSource(source, resolvedPath), sandbox, { filename: resolvedPath });
  return module.exports;
}

async function createFixtureTree(rootDir) {
  const projectRoot = path.join(rootDir, 'Projects');
  await fs.promises.mkdir(projectRoot, { recursive: true });

  for (let dirIndex = 0; dirIndex < 40; dirIndex += 1) {
    const dir = path.join(projectRoot, `bucket-${String(dirIndex).padStart(2, '0')}`);
    await fs.promises.mkdir(dir, { recursive: true });
    const writes = [];
    for (let fileIndex = 0; fileIndex < 25; fileIndex += 1) {
      writes.push(
        fs.promises.writeFile(
          path.join(dir, `alpha-file-${String(dirIndex).padStart(2, '0')}-${String(fileIndex).padStart(2, '0')}.txt`),
          `fixture ${dirIndex} ${fileIndex}\n`
        )
      );
    }
    await Promise.all(writes);
  }
}

function rebuildLogCount(logs) {
  return logs.filter((line) => line.includes('[FileIndex] Rebuilt')).length;
}

async function measure(label, fn) {
  const startedAt = performance.now();
  const value = await fn();
  return {
    label,
    value,
    ms: Number((performance.now() - startedAt).toFixed(2)),
  };
}

async function runRequestedRefresh(indexModule, reason, logs) {
  const before = rebuildLogCount(logs);
  const measurement = await measure(reason, async () => {
    indexModule.requestFileSearchIndexRefresh(reason);
    await indexModule.__fileSearchIndexTestInternals.waitForIdleForTest();
  });
  return {
    rebuilds: rebuildLogCount(logs) - before,
    ms: measurement.ms,
  };
}

async function runWatcherScenario() {
  const tempParent = await fs.promises.realpath(os.tmpdir());
  const tempHome = await fs.promises.mkdtemp(path.join(tempParent, 'supercmd-file-index-'));
  const clock = { now: 1_800_000_000_000 };
  const logs = [];
  const indexModule = loadFileSearchIndexModule({ clock, logs });
  const internals = indexModule.__fileSearchIndexTestInternals;

  try {
    await createFixtureTree(tempHome);
    internals.configureForTest(tempHome);

    const startupBefore = rebuildLogCount(logs);
    const startup = await measure('startup', () => indexModule.rebuildFileSearchIndex('startup'));
    const startupRebuilds = rebuildLogCount(logs) - startupBefore;
    assert.equal(startupRebuilds, 1, 'startup should perform one full rebuild');

    internals.setWatcherAvailableForTest(true);

    internals.setWatcherAvailableForTest(false);
    const watcherErrorRecovery = await runRequestedRefresh(indexModule, 'watcher-error', logs);
    internals.setWatcherAvailableForTest(true);

    const existingFile = path.join(tempHome, 'Projects', 'bucket-00', 'alpha-file-00-00.txt');
    await fs.promises.writeFile(existingFile, 'updated fixture\n');
    const updateBefore = rebuildLogCount(logs);
    await internals.applyWatchEventBatchForTest([existingFile]);
    const updatedResults = await indexModule.searchIndexedFiles('alpha file 00 00', { limit: 5 });
    assert.ok(updatedResults.some((result) => result.path === existingFile), 'updated file should remain searchable');
    const updateRebuilds = rebuildLogCount(logs) - updateBefore;

    const createdFile = path.join(tempHome, 'Projects', 'bucket-00', 'new-alpha-special.txt');
    await fs.promises.writeFile(createdFile, 'new fixture\n');
    const createBefore = rebuildLogCount(logs);
    await internals.applyWatchEventBatchForTest([createdFile]);
    const createdResults = await indexModule.searchIndexedFiles('new alpha special', { limit: 5 });
    assert.ok(createdResults.some((result) => result.path === createdFile), 'created file should be searchable');
    const createRebuilds = rebuildLogCount(logs) - createBefore;

    await fs.promises.unlink(createdFile);
    const deleteBefore = rebuildLogCount(logs);
    await internals.applyWatchEventBatchForTest([createdFile]);
    const deletedResults = await indexModule.searchIndexedFiles('new alpha special', { limit: 5 });
    assert.equal(deletedResults.some((result) => result.path === createdFile), false, 'deleted file should be tombstoned');
    const deleteRebuilds = rebuildLogCount(logs) - deleteBefore;

    const addedDir = path.join(tempHome, 'Projects', 'fresh-folder');
    const nestedFile = path.join(addedDir, 'nested-special-note.md');
    await fs.promises.mkdir(addedDir, { recursive: true });
    await fs.promises.writeFile(nestedFile, 'nested fixture\n');
    const directoryBefore = rebuildLogCount(logs);
    await internals.applyWatchEventBatchForTest([addedDir]);
    const nestedResults = await indexModule.searchIndexedFiles('nested special note', { limit: 5 });
    assert.ok(nestedResults.some((result) => result.path === nestedFile), 'new directory contents should be indexed');
    const directoryRebuilds = rebuildLogCount(logs) - directoryBefore;

    const healthyIntervalRuns = [];
    for (let tick = 0; tick < HEALTHY_INTERVAL_TICKS; tick += 1) {
      clock.now += CLOCK_STEP_MS;
      healthyIntervalRuns.push(await runRequestedRefresh(indexModule, 'interval', logs));
    }

    internals.setWatcherAvailableForTest(false);
    clock.now += CLOCK_STEP_MS;
    const fallbackInterval = await runRequestedRefresh(indexModule, 'interval', logs);

    return {
      startupMs: startup.ms,
      startupRebuilds,
      watcherErrorRecoveryRebuilds: watcherErrorRecovery.rebuilds,
      watcherErrorRecoveryMs: watcherErrorRecovery.ms,
      watcherBatchRebuilds: updateRebuilds + createRebuilds + deleteRebuilds + directoryRebuilds,
      healthyIntervalRebuilds: healthyIntervalRuns.reduce((sum, run) => sum + run.rebuilds, 0),
      healthyIntervalMs: Number(healthyIntervalRuns.reduce((sum, run) => sum + run.ms, 0).toFixed(2)),
      fallbackIntervalRebuilds: fallbackInterval.rebuilds,
      fallbackIntervalMs: fallbackInterval.ms,
      indexedEntryCount: indexModule.getFileSearchIndexStatus().indexedEntryCount,
    };
  } finally {
    indexModule.stopFileSearchIndexing();
    await fs.promises.rm(tempHome, { recursive: true, force: true });
  }
}

function writeFile(filePath, contents = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function makeTempHome(label) {
  const tmpRoot = fs.realpathSync(os.tmpdir());
  return fs.mkdtempSync(path.join(tmpRoot, `supercmd-file-search-${label}-`));
}

function removeTempHome(homeDir) {
  try {
    fs.rmSync(homeDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup for temp fixtures.
  }
}

async function withIndexedHome(homeDir, fn) {
  moduleCache.delete(SOURCE_PATH);
  const fileSearch = loadTsModule(SOURCE_PATH);
  fileSearch.startFileSearchIndexing({
    homeDir,
    refreshIntervalMs: 30_000,
    includeProtectedHomeRoots: true,
  });
  await fileSearch.rebuildFileSearchIndex('test');
  try {
    await fn(fileSearch);
  } finally {
    fileSearch.stopFileSearchIndexing();
  }
}

function resultPaths(results) {
  return results.map((result) => result.path);
}

function populateSyntheticTree(homeDir, targetEntries) {
  const projectsDir = path.join(homeDir, 'Projects');
  const filesPerApp = 48;
  const appCount = Math.max(1, Math.ceil(targetEntries / (filesPerApp + 2)));

  for (let appIndex = 0; appIndex < appCount; appIndex += 1) {
    const appName = `app-${String(appIndex).padStart(4, '0')}`;
    const srcDir = path.join(projectsDir, appName, 'src');
    const docsDir = path.join(projectsDir, appName, 'docs');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(docsDir, { recursive: true });
    for (let fileIndex = 0; fileIndex < filesPerApp; fileIndex += 1) {
      const bucket = fileIndex % 2 === 0 ? srcDir : docsDir;
      const name = `module-${String(fileIndex).padStart(3, '0')}-${appName}.ts`;
      fs.writeFileSync(path.join(bucket, name), '');
    }
  }

  return {
    appCount,
    filesPerApp,
    indexedEntryEstimate: appCount * (filesPerApp + 3) + 1,
  };
}

async function runPathQueryPerformanceHarness() {
  const targetEntries = Number(process.env.FILE_SEARCH_PERF_ENTRIES || 60000);
  const iterations = Number(process.env.FILE_SEARCH_PERF_ITERATIONS || 24);
  const homeDir = makeTempHome('perf');
  try {
    const fixture = populateSyntheticTree(homeDir, targetEntries);
    await withIndexedHome(homeDir, async ({ getFileSearchIndexStatus, searchIndexedFiles }) => {
      const status = getFileSearchIndexStatus();
      const queryAppIds = [7, 42, 137, Math.floor(fixture.appCount / 2), fixture.appCount - 3]
        .filter((value, index, values) => value >= 0 && value < fixture.appCount && values.indexOf(value) === index)
        .map((value) => String(value).padStart(4, '0'));
      const queries = queryAppIds.flatMap((id) => [
        path.join(homeDir, 'Projects', `app-${id}`, 'src'),
        `~/Projects/app-${id}/src`,
        `Projects/app-${id}/src`,
      ]);

      const startedAt = performance.now();
      let totalResults = 0;
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        for (const query of queries) {
          const results = await searchIndexedFiles(query, { limit: 1 });
          totalResults += results.length;
        }
      }
      const elapsedMs = performance.now() - startedAt;
      const queryCount = iterations * queries.length;
      const metric = {
        entries: status.indexedEntryCount,
        estimatedEntries: fixture.indexedEntryEstimate,
        queries: queryCount,
        elapsedMs: Number(elapsedMs.toFixed(2)),
        avgMsPerQuery: Number((elapsedMs / queryCount).toFixed(3)),
        totalResults,
      };
      console.log(`FILE_SEARCH_PERF ${JSON.stringify(metric)}`);
    });
  } finally {
    removeTempHome(homeDir);
  }
}

test('file search index uses watcher batches and avoids healthy interval rebuilds', async () => {
  const metrics = await runWatcherScenario();
  console.log(`[FileIndexTest] ${JSON.stringify({ mode: BASELINE_MODE ? 'baseline' : 'assert', ...metrics })}`);

  assert.equal(metrics.watcherBatchRebuilds, 0, 'watcher-style updates should not trigger full rebuilds');
  assert.equal(metrics.watcherErrorRecoveryRebuilds, 1, 'watcher-error recovery should bypass the rebuild throttle');
  assert.equal(metrics.fallbackIntervalRebuilds, 1, 'interval should rebuild when watcher state is unavailable');

  if (!BASELINE_MODE) {
    assert.equal(metrics.healthyIntervalRebuilds, 0, 'healthy watcher interval ticks should use incremental state');
  }
});

test('path-like queries match absolute, tilde, and relative paths', async () => {
  const homeDir = makeTempHome('correctness');
  try {
    const srcDir = path.join(homeDir, 'Projects', 'app-042', 'src');
    const exactFile = path.join(srcDir, 'Report Final.txt');
    writeFile(exactFile, 'report');
    writeFile(path.join(srcDir, 'Report Notes.md'), 'notes');
    writeFile(path.join(homeDir, 'Projects', 'app-042', 'README.md'), 'readme');
    writeFile(path.join(homeDir, 'Archive', 'Reports', 'src', 'Q2 Plan.txt'), 'plan');

    await withIndexedHome(homeDir, async ({ searchIndexedFiles }) => {
      const absolute = await searchIndexedFiles(srcDir, { limit: 8 });
      assert.equal(absolute[0]?.path, srcDir);
      assert.ok(resultPaths(absolute).includes(exactFile));

      const tilde = await searchIndexedFiles('~/Projects/app-042/src', { limit: 8 });
      assert.equal(tilde[0]?.path, srcDir);
      assert.ok(resultPaths(tilde).includes(exactFile));

      const relative = await searchIndexedFiles('Projects/app-042/src', { limit: 8 });
      assert.equal(relative[0]?.path, srcDir);
      assert.ok(resultPaths(relative).includes(exactFile));

      const exact = await searchIndexedFiles('~/Projects/app-042/src/Report Final.txt', { limit: 4 });
      assert.equal(exact[0]?.path, exactFile);
      assert.equal(exact[0]?.matchKind, 'path');
    });
  } finally {
    removeTempHome(homeDir);
  }
});

test('path-like fallback preserves mid-token slash matches', async () => {
  const homeDir = makeTempHome('fallback');
  try {
    const fallbackFile = path.join(homeDir, 'Archive', 'Reports', 'src', 'Q2 Plan.txt');
    writeFile(fallbackFile, 'plan');
    writeFile(path.join(homeDir, 'Archive', 'Exports', 'src', 'Other.txt'), 'other');

    await withIndexedHome(homeDir, async ({ searchIndexedFiles }) => {
      const midToken = await searchIndexedFiles('ports/src', { limit: 8 });
      assert.ok(resultPaths(midToken).includes(fallbackFile));

      const trailingSlash = await searchIndexedFiles('ports/', { limit: 8 });
      assert.ok(resultPaths(trailingSlash).includes(fallbackFile));

      const noMatch = await searchIndexedFiles('~/Archive/Missing/src', { limit: 8 });
      assert.equal(noMatch.length, 0);
    });
  } finally {
    removeTempHome(homeDir);
  }
});

if (process.env.SUPERCMD_FILE_SEARCH_PERF === '1') {
  test('path-like file search performance harness', async () => {
    await runPathQueryPerformanceHarness();
  });
}
