#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { importTs } from './lib/ts-import.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const FILE_SEARCH_INDEX_TS = path.join(REPO_ROOT, 'src/main/file-search-index.ts');

const DEFAULT_CONFIG = {
  projects: 24,
  modulesPerProject: 4,
  filesPerModule: 8,
  queryRuns: 5,
  updateCount: 32,
  deleteCount: 32,
  limit: 12,
  keep: false,
  json: false,
  output: '',
  includeProtectedHomeRoots: true,
  thresholds: {},
};

const FILE_NAME_PATTERNS = [
  'command-palette-{project}-{module}-{file}.ts',
  'launch-plan-alpha-{project}-{module}-{file}.md',
  'invoice-report-{project}-{module}-{file}.json',
  'notes-search-index-{project}-{module}-{file}.txt',
  'shortcut-resolver-{project}-{module}-{file}.tsx',
  'settings-migration-{project}-{module}-{file}.ts',
  'quick-action-workflow-{project}-{module}-{file}.md',
  'browser-history-cache-{project}-{module}-{file}.json',
];

function pad(value, width = 3) {
  return String(value).padStart(width, '0');
}

function formatPattern(pattern, values) {
  return pattern
    .replaceAll('{project}', values.project)
    .replaceAll('{module}', values.module)
    .replaceAll('{file}', values.file);
}

function readNumber(value, fallback, min = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function readOptionalNumber(value) {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getArgValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return undefined;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function getUsage() {
  return [
    'Usage: node scripts/file-search-perf-harness.mjs [options]',
    '',
    'Options:',
    '  --projects <n>                         Number of synthetic projects',
    '  --modules <n>                          Modules per project',
    '  --files-per-module <n>                 Files per module',
    '  --query-runs <n>                       Query repetitions per query',
    '  --updates <n>                          Watcher-style added paths',
    '  --deletes <n>                          Deleted paths in the tombstone batch',
    '  --limit <n>                            Search result limit',
    '  --json                                 Print JSON output',
    '  --output <path>                        Write the same output to a file',
    '  --keep                                 Keep the temp fixture for inspection',
    '  --threshold-index-ms <n>               Fail if initial indexing exceeds n ms',
    '  --threshold-normal-query-p95-ms <n>    Fail if normal query p95 exceeds n ms',
    '  --threshold-path-query-p95-ms <n>      Fail if path-like query p95 exceeds n ms',
    '  --threshold-event-loop-lag-p95-ms <n> Fail if measured event-loop lag p95 exceeds n ms',
    '  --threshold-watch-update-ms <n>        Fail if watcher-style batch exceeds n ms',
    '  --threshold-delete-ms <n>              Fail if delete batch exceeds n ms',
  ].join('\n');
}

export function parseFileSearchPerfHarnessArgs(args = process.argv.slice(2)) {
  return {
    projects: readNumber(getArgValue(args, '--projects'), DEFAULT_CONFIG.projects),
    modulesPerProject: readNumber(getArgValue(args, '--modules'), DEFAULT_CONFIG.modulesPerProject),
    filesPerModule: readNumber(getArgValue(args, '--files-per-module'), DEFAULT_CONFIG.filesPerModule),
    queryRuns: readNumber(getArgValue(args, '--query-runs'), DEFAULT_CONFIG.queryRuns),
    updateCount: readNumber(getArgValue(args, '--updates'), DEFAULT_CONFIG.updateCount),
    deleteCount: readNumber(getArgValue(args, '--deletes'), DEFAULT_CONFIG.deleteCount),
    limit: readNumber(getArgValue(args, '--limit'), DEFAULT_CONFIG.limit),
    keep: hasFlag(args, '--keep'),
    json: hasFlag(args, '--json'),
    output: getArgValue(args, '--output') || '',
    includeProtectedHomeRoots: !hasFlag(args, '--exclude-protected-home-roots'),
    thresholds: {
      initialIndexMs: readOptionalNumber(getArgValue(args, '--threshold-index-ms')),
      normalQueryP95Ms: readOptionalNumber(getArgValue(args, '--threshold-normal-query-p95-ms')),
      pathQueryP95Ms: readOptionalNumber(getArgValue(args, '--threshold-path-query-p95-ms')),
      eventLoopLagP95Ms: readOptionalNumber(getArgValue(args, '--threshold-event-loop-lag-p95-ms')),
      watchUpdateBatchMs: readOptionalNumber(getArgValue(args, '--threshold-watch-update-ms')),
      deleteBatchMs: readOptionalNumber(getArgValue(args, '--threshold-delete-ms')),
    },
  };
}

function mergeConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...(overrides.thresholds || {}),
    },
  };
}

async function writeFile(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

async function createSyntheticHome(config) {
  const tempRootRaw = await fs.mkdtemp(path.join(os.tmpdir(), 'supercmd-file-search-perf-'));
  const tempRoot = await fs.realpath(tempRootRaw);
  const homeDir = path.join(tempRoot, 'home');
  const benchRoot = path.join(homeDir, 'BenchRoot');
  const projectsRoot = path.join(benchRoot, 'Projects');
  const archiveRoot = path.join(benchRoot, 'Archive');
  const referenceRoot = path.join(benchRoot, 'References');
  const filePaths = [];
  const deleteCandidates = [];

  await fs.mkdir(projectsRoot, { recursive: true });
  await fs.mkdir(archiveRoot, { recursive: true });
  await fs.mkdir(referenceRoot, { recursive: true });

  for (let projectIndex = 0; projectIndex < config.projects; projectIndex += 1) {
    const project = `project-${pad(projectIndex)}`;
    for (let moduleIndex = 0; moduleIndex < config.modulesPerProject; moduleIndex += 1) {
      const moduleName = `module-${pad(moduleIndex, 2)}`;
      const srcDir = path.join(projectsRoot, project, moduleName, 'src');
      const docsDir = path.join(projectsRoot, project, moduleName, 'docs');

      for (let fileIndex = 0; fileIndex < config.filesPerModule; fileIndex += 1) {
        const file = pad(fileIndex, 2);
        const pattern = FILE_NAME_PATTERNS[fileIndex % FILE_NAME_PATTERNS.length];
        const targetDir = fileIndex % 2 === 0 ? srcDir : docsDir;
        const fileName = formatPattern(pattern, { project, module: moduleName, file });
        const filePath = path.join(targetDir, fileName);
        await writeFile(
          filePath,
          [
            `project=${project}`,
            `module=${moduleName}`,
            `file=${file}`,
            `intent=${fileName}`,
            '',
          ].join('\n')
        );
        filePaths.push(filePath);
        if (fileName.startsWith('launch-plan-alpha') || fileName.startsWith('invoice-report')) {
          deleteCandidates.push(filePath);
        }
      }
    }

    await writeFile(
      path.join(archiveRoot, `release-notes-command-palette-${project}.md`),
      `release notes for ${project}\n`
    );
    await writeFile(
      path.join(referenceRoot, `path-query-reference-${project}.txt`),
      `path reference for ${project}\n`
    );
  }

  return {
    tempRoot,
    homeDir,
    benchRoot,
    projectsRoot,
    filePaths,
    deleteCandidates,
  };
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarizeDurations(samples) {
  const totalMs = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
  const durations = samples.map((sample) => sample.durationMs);
  return {
    runs: samples.length,
    minMs: Number(Math.min(...durations).toFixed(3)),
    meanMs: Number((totalMs / Math.max(1, samples.length)).toFixed(3)),
    medianMs: Number(percentile(durations, 50).toFixed(3)),
    p95Ms: Number(percentile(durations, 95).toFixed(3)),
    maxMs: Number(Math.max(...durations).toFixed(3)),
    totalResults: samples.reduce((sum, sample) => sum + sample.resultCount, 0),
  };
}

function summarizeLag(samples) {
  if (samples.length === 0) {
    return {
      samples: 0,
      p95Ms: 0,
      maxMs: 0,
    };
  }
  return {
    samples: samples.length,
    p95Ms: Number(percentile(samples, 95).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
  };
}

async function measureEventLoopLagDuring(fn, intervalMs = 10) {
  const samples = [];
  let expectedAt = performance.now() + intervalMs;
  const timer = setInterval(() => {
    const now = performance.now();
    samples.push(Math.max(0, now - expectedAt));
    expectedAt = now + intervalMs;
  }, intervalMs);
  timer.unref?.();

  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = await fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      result,
      eventLoopLag: summarizeLag(samples),
    };
  } finally {
    clearInterval(timer);
  }
}

async function measureDuration(fn) {
  const startedAt = performance.now();
  const measured = await measureEventLoopLagDuring(fn);
  return {
    durationMs: performance.now() - startedAt,
    result: measured.result,
    eventLoopLag: measured.eventLoopLag,
  };
}

function summarizeEventLoopDelay(histogram) {
  return {
    meanMs: Number((histogram.mean / 1_000_000).toFixed(3)),
    maxMs: Number((histogram.max / 1_000_000).toFixed(3)),
    p95Ms: Number((histogram.percentile(95) / 1_000_000).toFixed(3)),
  };
}

async function measureDurationWithEventLoopDelay(fn) {
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  await new Promise((resolve) => setImmediate(resolve));
  const measured = await measureDuration(fn);
  await new Promise((resolve) => setImmediate(resolve));
  histogram.disable();
  return {
    ...measured,
    eventLoopDelay: summarizeEventLoopDelay(histogram),
  };
}

async function measureQueries(searchIndexedFiles, queries, config) {
  const samples = [];
  const lagMeasured = await measureEventLoopLagDuring(async () => {
    for (let run = 0; run < config.queryRuns; run += 1) {
      for (const query of queries) {
        const measured = await measureDuration(() => searchIndexedFiles(query, { limit: config.limit }));
        samples.push({
          query,
          run,
          durationMs: measured.durationMs,
          resultCount: measured.result.length,
          eventLoopLagP95Ms: measured.eventLoopLag.p95Ms,
        });
      }
    }
  });
  return {
    ...summarizeDurations(samples),
    eventLoopLag: lagMeasured.eventLoopLag,
    samples: samples.map((sample) => ({
      ...sample,
      durationMs: Number(sample.durationMs.toFixed(3)),
    })),
  };
}

function buildQueries(homeDir) {
  return {
    normal: [
      'command palette',
      'launch plan alpha',
      'invoice report',
      'notes search index',
    ],
    pathLike: [
      '~/BenchRoot/Projects/project-',
      '~/BenchRoot/Archive/release-notes-command',
      `${homeDir}/BenchRoot/References/path-query-reference`,
    ],
  };
}

async function createUpdateFiles(fixture, config) {
  const updatePaths = [];
  for (let index = 0; index < config.updateCount; index += 1) {
    const project = `project-${pad(index % config.projects)}`;
    const moduleName = `module-${pad(index % config.modulesPerProject, 2)}`;
    const filePath = path.join(
      fixture.projectsRoot,
      project,
      moduleName,
      'src',
      `watcher-added-command-${pad(index)}.ts`
    );
    await writeFile(filePath, `watcher added command ${index}\n`);
    updatePaths.push(filePath);
  }
  return updatePaths;
}

async function deleteFixtureFiles(fixture, config) {
  const deletePaths = fixture.deleteCandidates.slice(0, config.deleteCount);
  for (const filePath of deletePaths) {
    await fs.rm(filePath, { force: true });
  }
  return deletePaths;
}

function evaluateThresholds(metrics, thresholds = {}) {
  const checks = [
    ['initialIndexMs', metrics.initialIndexMs, thresholds.initialIndexMs],
    ['normalQueryP95Ms', metrics.normalQueries.p95Ms, thresholds.normalQueryP95Ms],
    ['pathQueryP95Ms', metrics.pathLikeQueries.p95Ms, thresholds.pathQueryP95Ms],
    ['eventLoopLagP95Ms', metrics.eventLoopLag.p95Ms, thresholds.eventLoopLagP95Ms],
    ['watchUpdateBatchMs', metrics.watchUpdateBatchMs, thresholds.watchUpdateBatchMs],
    ['deleteBatchMs', metrics.deleteBatchMs, thresholds.deleteBatchMs],
  ];
  const failures = checks
    .filter(([, actual, threshold]) => typeof threshold === 'number' && actual > threshold)
    .map(([name, actual, threshold]) => `${name} ${actual.toFixed(3)}ms exceeded ${threshold}ms`);

  return {
    passed: failures.length === 0,
    failures,
    applied: Object.fromEntries(
      checks
        .filter(([, , threshold]) => typeof threshold === 'number')
        .map(([name, , threshold]) => [name, threshold])
    ),
  };
}

function roundMetric(value) {
  return Number(value.toFixed(3));
}

function toDisplayLines(summary) {
  const thresholdLine = summary.thresholds.applied && Object.keys(summary.thresholds.applied).length > 0
    ? summary.thresholds.passed
      ? 'Thresholds: passed'
      : `Thresholds: failed (${summary.thresholds.failures.join('; ')})`
    : 'Thresholds: not applied';

  return [
    'File search perf harness',
    `Home fixture: ${summary.fixture.homeDir}`,
    `Indexed entries: ${summary.fixture.initialEntryCount}`,
    `Initial indexing: ${summary.metrics.initialIndexMs.toFixed(3)}ms (event-loop delay p95 ${summary.metrics.initialIndexEventLoopDelay.p95Ms.toFixed(3)}ms, max ${summary.metrics.initialIndexEventLoopDelay.maxMs.toFixed(3)}ms)`,
    `Normal queries: mean ${summary.metrics.normalQueries.meanMs.toFixed(3)}ms, p95 ${summary.metrics.normalQueries.p95Ms.toFixed(3)}ms, results ${summary.metrics.normalQueries.totalResults}`,
    `Path-like queries: mean ${summary.metrics.pathLikeQueries.meanMs.toFixed(3)}ms, p95 ${summary.metrics.pathLikeQueries.p95Ms.toFixed(3)}ms, results ${summary.metrics.pathLikeQueries.totalResults}`,
    `Event-loop lag: p95 ${summary.metrics.eventLoopLag.p95Ms.toFixed(3)}ms, max ${summary.metrics.eventLoopLag.maxMs.toFixed(3)}ms`,
    `Watcher-style updates: ${summary.metrics.watchUpdateBatchMs.toFixed(3)}ms for ${summary.fixture.updateCount} paths`,
    `Delete batch: ${summary.metrics.deleteBatchMs.toFixed(3)}ms for ${summary.fixture.deleteCount} paths`,
    `Post-update query: ${summary.metrics.postUpdateQueryMs.toFixed(3)}ms (${summary.verification.postUpdateResultCount} results)`,
    `Deleted exact matches after tombstone: ${summary.verification.deletedExactMatches}`,
    thresholdLine,
  ];
}

export async function runFileSearchPerfHarness(overrides = {}) {
  const config = mergeConfig(overrides);
  const fixture = await createSyntheticHome(config);
  let fileSearchIndexPerfHarness = null;
  let summary = null;
  let cleanupCompleted = false;
  try {
    const fileSearchIndex = await importTs(FILE_SEARCH_INDEX_TS);
    const {
      __fileSearchIndexPerfHarness,
      getFileSearchIndexStatus,
      searchIndexedFiles,
    } = fileSearchIndex;
    fileSearchIndexPerfHarness = __fileSearchIndexPerfHarness;

    if (!fileSearchIndexPerfHarness) {
      throw new Error('Missing __fileSearchIndexPerfHarness export from file-search-index.ts');
    }

    const queries = buildQueries(fixture.homeDir);
    const initialIndex = await measureDurationWithEventLoopDelay(() =>
      fileSearchIndexPerfHarness.rebuild({
        homeDir: fixture.homeDir,
        includeProtectedHomeRoots: config.includeProtectedHomeRoots,
      })
    );
    const statusAfterIndex = getFileSearchIndexStatus();

    const normalQueries = await measureQueries(searchIndexedFiles, queries.normal, config);
    const pathLikeQueries = await measureQueries(searchIndexedFiles, queries.pathLike, config);

    const updatePaths = await createUpdateFiles(fixture, config);
    const watchUpdate = await measureDuration(() =>
      fileSearchIndexPerfHarness.applyWatchEventBatch(updatePaths)
    );
    const postUpdateQuery = await measureDuration(() =>
      searchIndexedFiles('watcher added command', { limit: config.limit })
    );

    const deletePaths = await deleteFixtureFiles(fixture, config);
    const deleteBatch = await measureDuration(() =>
      fileSearchIndexPerfHarness.applyWatchEventBatch(deletePaths)
    );
    const deletedNeedle = deletePaths[0] ? path.basename(deletePaths[0]) : '';
    const postDeleteQuery = await measureDuration(() =>
      deletedNeedle ? searchIndexedFiles(deletedNeedle, { limit: config.limit }) : Promise.resolve([])
    );
    const deletedExactMatches = deletedNeedle
      ? postDeleteQuery.result.filter((result) => result.name === deletedNeedle).length
      : 0;

    const metrics = {
      initialIndexMs: roundMetric(initialIndex.durationMs),
      initialIndexEventLoopDelay: initialIndex.eventLoopDelay,
      normalQueries,
      pathLikeQueries,
      watchUpdateBatchMs: roundMetric(watchUpdate.durationMs),
      postUpdateQueryMs: roundMetric(postUpdateQuery.durationMs),
      deleteBatchMs: roundMetric(deleteBatch.durationMs),
      postDeleteQueryMs: roundMetric(postDeleteQuery.durationMs),
    };
    const eventLoopLagSamples = [
      initialIndex.eventLoopLag,
      normalQueries.eventLoopLag,
      pathLikeQueries.eventLoopLag,
      watchUpdate.eventLoopLag,
      postUpdateQuery.eventLoopLag,
      deleteBatch.eventLoopLag,
      postDeleteQuery.eventLoopLag,
    ];
    metrics.eventLoopLag = {
      p95Ms: Math.max(...eventLoopLagSamples.map((sample) => sample.p95Ms)),
      maxMs: Math.max(...eventLoopLagSamples.map((sample) => sample.maxMs)),
      samples: eventLoopLagSamples.reduce((sum, sample) => sum + sample.samples, 0),
    };
    const realTempDir = await fs.realpath(os.tmpdir());

    summary = {
      config: {
        projects: config.projects,
        modulesPerProject: config.modulesPerProject,
        filesPerModule: config.filesPerModule,
        queryRuns: config.queryRuns,
        updateCount: config.updateCount,
        deleteCount: config.deleteCount,
        limit: config.limit,
      },
      fixture: {
        tempRoot: fixture.tempRoot,
        homeDir: fixture.homeDir,
        initialFileCount: fixture.filePaths.length + config.projects * 2,
        initialEntryCount: statusAfterIndex.indexedEntryCount,
        updateCount: updatePaths.length,
        deleteCount: deletePaths.length,
      },
      metrics,
      verification: {
        postUpdateResultCount: postUpdateQuery.result.length,
        postDeleteResultCount: postDeleteQuery.result.length,
        deletedExactMatches,
        homeDirectoryUsed: statusAfterIndex.homeDirectory,
        homeIsTempDirectory: fixture.homeDir.startsWith(realTempDir),
      },
      thresholds: evaluateThresholds(metrics, config.thresholds),
      cleanup: {
        keptFixture: Boolean(config.keep),
        completed: false,
      },
    };

    return summary;
  } finally {
    fileSearchIndexPerfHarness?.reset();
    if (!config.keep) {
      await fs.rm(fixture.tempRoot, { recursive: true, force: true });
      cleanupCompleted = true;
    }
    if (summary) {
      summary.cleanup.completed = cleanupCompleted;
    }
  }
}

async function runCli() {
  if (hasFlag(process.argv, '--help')) {
    process.stdout.write(`${getUsage()}\n`);
    return;
  }

  const config = parseFileSearchPerfHarnessArgs();
  const summary = await runFileSearchPerfHarness(config);
  const output = config.json ? `${JSON.stringify(summary, null, 2)}\n` : `${toDisplayLines(summary).join('\n')}\n`;

  if (config.output) {
    await fs.writeFile(path.resolve(config.output), output);
  }
  process.stdout.write(output);

  if (!summary.thresholds.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
