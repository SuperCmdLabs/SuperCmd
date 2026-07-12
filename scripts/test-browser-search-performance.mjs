#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const FIXED_NOW = Date.UTC(2026, 6, 3, 12, 0, 0);
const IS_PERF_CI = process.env.SUPERCMD_PERF_CI === '1';
const IS_PERF_REPORT = IS_PERF_CI
  || process.env.SUPERCMD_PERF_REPORT === '1'
  || process.argv.includes('--report')
  || process.argv.includes('--json');

class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [FIXED_NOW]));
  }

  static now() {
    return FIXED_NOW;
  }
}

const moduleCache = new Map();

function loadTsModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath).exports;

  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: resolvedPath,
  });

  const module = { exports: {} };
  moduleCache.set(resolvedPath, module);
  const localRequire = (request) => {
    if (request.startsWith('.')) {
      const candidate = path.resolve(path.dirname(resolvedPath), request);
      for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
        const nextPath = `${candidate}${suffix}`;
        if (fs.existsSync(nextPath) && fs.statSync(nextPath).isFile()) {
          return /\.[cm]?[tj]sx?$/.test(nextPath) ? loadTsModule(nextPath) : require(nextPath);
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
    Intl,
    Date: FixedDate,
    Math,
    String,
    Number,
    Boolean,
    Set,
    Map,
    Object,
    Array,
    RegExp,
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: resolvedPath });
  return module.exports;
}

function buildSyntheticBrowserData(options = {}) {
  const {
    historyCount = 4_000,
    bookmarkCount = 800,
    tabCount = 120,
  } = options;
  const profiles = ['chrome:Default', 'chrome:Work', 'arc:Default', 'brave:Default'];
  const topics = ['github', 'docs', 'linear', 'notion', 'calendar', 'supercmd', 'typescript', 'electron', 'raycast', 'browser'];
  const entries = [];
  const tabs = [];

  for (let index = 0; index < historyCount; index += 1) {
    const topic = topics[index % topics.length];
    const profile = profiles[index % profiles.length];
    const source = profile.split(':')[0];
    const host = `${topic}${index % 700}.example.com`;
    entries.push({
      id: `h-${index}`,
      type: 'url',
      query: `${topic} history page ${index}`,
      url: `https://${host}/workspace/${index % 200}/item-${index}`,
      host,
      lastUsedAt: FIXED_NOW - index * 371_000,
      useCount: (index % 23) + 1,
      source,
      sourceProfileId: profile,
      sourceProfileName: profile.split(':')[1],
    });
  }

  for (let index = 0; index < bookmarkCount; index += 1) {
    const topic = topics[(index * 3) % topics.length];
    const profile = profiles[index % profiles.length];
    const source = profile.split(':')[0];
    const host = `${topic}-bookmark${index % 600}.example.com`;
    entries.push({
      id: `b-${index}`,
      type: 'bookmark',
      query: `${topic} bookmark reference ${index}`,
      url: `https://${host}/saved/${index % 300}/item-${index}`,
      host,
      lastUsedAt: FIXED_NOW - index * 997_000,
      useCount: (index % 11) + 1,
      source,
      sourceProfileId: profile,
      sourceProfileName: profile.split(':')[1],
      bookmarkFolder: `Folder ${index % 25}`,
      bookmarkOrder: index,
    });
  }

  const nicknameBookmark = {
    id: 'b-nickname-github',
    type: 'bookmark',
    query: 'GitHub Pull Requests',
    url: 'https://github.com/SuperCmdLabs/SuperCmd/pulls',
    host: 'github.com',
    lastUsedAt: FIXED_NOW,
    useCount: 40,
    source: 'chrome',
    sourceProfileId: 'chrome:Default',
    sourceProfileName: 'Default',
    bookmarkFolder: 'Development',
    bookmarkOrder: -1,
  };
  entries.push(nicknameBookmark);

  for (let index = 0; index < tabCount; index += 1) {
    const topic = topics[(index * 7) % topics.length];
    const profile = profiles[index % profiles.length];
    const source = profile.split(':')[0];
    const host = `${topic}-tab${index % 120}.example.com`;
    tabs.push({
      id: `t-${index}`,
      browserId: source,
      browserName: source,
      profileId: profile.split(':')[1],
      profileSourceId: profile,
      profileName: profile.split(':')[1],
      windowId: String(index % 8),
      windowOrdinal: index % 8,
      tabId: String(index),
      tabIndex: index % 40,
      favIconUrl: '',
      title: `${topic} active tab ${index}`,
      url: `https://${host}/open/${index}`,
      host,
      active: index % 37 === 0,
      windowLastFocusedAt: FIXED_NOW - (index % 120) * 60_000,
      updatedAt: FIXED_NOW - index * 60_000,
    });
  }

  const nicknames = [{
    source: nicknameBookmark.source,
    sourceProfileId: nicknameBookmark.sourceProfileId,
    url: nicknameBookmark.url,
    nickname: 'gh',
  }];

  return { entries, tabs, nicknames };
}

function resultSignature(results) {
  return results.map((result) => [
    result.id,
    result.kind,
    result.title,
    result.url,
    result.completion || '',
    result.matchKind || '',
    Boolean(result.nicknameMatch),
  ]);
}

function measureAverageMs(iterations, queries, fn) {
  const byQuery = {};
  for (const query of queries) {
    const start = performance.now();
    let checksum = 0;
    for (let index = 0; index < iterations; index += 1) {
      const results = fn(query);
      checksum += results.length + (results[0]?.id?.length || 0);
    }
    byQuery[query] = {
      avgMs: (performance.now() - start) / iterations,
      checksum,
    };
  }
  return byQuery;
}

async function measureBlockedTurn(fn) {
  const scheduledAt = performance.now();
  const delayPromise = new Promise((resolve) => {
    setTimeout(() => resolve(performance.now() - scheduledAt), 0);
  });
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  const eventLoopDelayMs = await delayPromise;
  return {
    result,
    durationMs,
    eventLoopDelayMs,
  };
}

function browserResultGroups() {
  return [
    { kind: 'bookmark', limit: 2 },
    { kind: 'open-tab', limit: 2 },
    { kind: 'history', limit: 2 },
  ];
}

function browserQueries() {
  return [
    'github',
    'hub',
    'gi',
    'supercmd',
    'electron workspace',
    'bookmark reference 42',
    'https://typescript',
    'tab 37',
    'gh',
  ];
}

function assertBrowserSearchEquivalence({
  query,
  groups,
  entries,
  entryIndex,
  tabs,
  nicknames,
  getOrderedBrowserResults,
  getRankedBrowserResults,
}) {
  assert.deepEqual(
    resultSignature(getRankedBrowserResults(query, groups, entries, entryIndex, tabs, nicknames, 60)),
    resultSignature(getRankedBrowserResults(query, groups, entries, null, tabs, nicknames, 60)),
    `ranked results should match the full scan for ${query}`
  );
  assert.deepEqual(
    resultSignature(getOrderedBrowserResults(query, groups, entries, entryIndex, tabs, nicknames, { useConfiguredLimits: true })),
    resultSignature(getOrderedBrowserResults(query, groups, entries, null, tabs, nicknames, { useConfiguredLimits: true })),
    `ordered results should match the full scan for ${query}`
  );
}

function roundReportValues(values) {
  return Object.fromEntries(
    Object.entries(values).map(([query, item]) => [query, {
      avgMs: Number(item.avgMs.toFixed(2)),
      checksum: item.checksum,
    }])
  );
}

function printBrowserSearchPerfReport(report) {
  if (!IS_PERF_REPORT) return;
  console.log(JSON.stringify({ browserSearchPerf: report }, null, 2));
}

function budgetEntry(actual, budget) {
  return {
    actualMs: actual,
    budgetMs: budget,
    budgetUsedPct: Number(((actual / budget) * 100).toFixed(1)),
  };
}

test('browser search indexed harness preserves full-scan result order', () => {
  const { __browserSearchTestAccess } = loadTsModule('src/renderer/src/hooks/useBrowserSearch.ts');
  const { buildBrowserEntryIndex, getOrderedBrowserResults, getRankedBrowserResults } = __browserSearchTestAccess;
  const { entries, tabs, nicknames } = buildSyntheticBrowserData();
  const entryIndex = buildBrowserEntryIndex(entries);
  const groups = browserResultGroups();
  const queries = browserQueries();

  for (const query of queries) {
    assertBrowserSearchEquivalence({
      query,
      groups,
      entries,
      entryIndex,
      tabs,
      nicknames,
      getOrderedBrowserResults,
      getRankedBrowserResults,
    });
  }
});

test('browser search indexed harness preserves profile filtering', () => {
  const { __browserSearchTestAccess } = loadTsModule('src/renderer/src/hooks/useBrowserSearch.ts');
  const { buildBrowserEntryIndex, filterBrowserResults, getRankedBrowserResults } = __browserSearchTestAccess;
  const { entries, tabs, nicknames } = buildSyntheticBrowserData();
  const entryIndex = buildBrowserEntryIndex(entries);
  const groups = [
    { kind: 'bookmark', limit: 4 },
    { kind: 'open-tab', limit: 4 },
    { kind: 'history', limit: 4 },
  ];
  const profiles = [
    { id: 'chrome:Default', displayName: 'Chrome Default', detectedName: 'Default', profileId: 'Default', browserId: 'chrome', browserName: 'Chrome', order: 0 },
    { id: 'chrome:Work', displayName: 'Chrome Work', detectedName: 'Work', profileId: 'Work', browserId: 'chrome', browserName: 'Chrome', order: 1 },
    { id: 'arc:Default', displayName: 'Arc Default', detectedName: 'Default', profileId: 'Default', browserId: 'arc', browserName: 'Arc', order: 2 },
    { id: 'brave:Default', displayName: 'Brave Default', detectedName: 'Default', profileId: 'Default', browserId: 'brave', browserName: 'Brave', order: 3 },
  ];
  const filters = {
    'open-tab': ['chrome:Default'],
    bookmark: ['chrome:Default'],
    history: ['chrome:Default'],
  };

  const filtered = filterBrowserResults(
    getRankedBrowserResults('github', groups, entries, entryIndex, tabs, nicknames, 60),
    filters,
    profiles
  );

  assert.ok(filtered.length > 0, 'profile-filtered search should keep matching results');
  assert.ok(
    filtered.every((result) => !result.sourceProfileId || result.sourceProfileId === 'chrome:Default'),
    'profile filtering should only keep enabled profile IDs'
  );
});

test('browser search indexed harness stays under generous query thresholds', async () => {
  const { __browserSearchTestAccess } = loadTsModule('src/renderer/src/hooks/useBrowserSearch.ts');
  const { buildBrowserEntryIndex, getOrderedBrowserResults, getRankedBrowserResults } = __browserSearchTestAccess;
  const { entries, tabs, nicknames } = buildSyntheticBrowserData();
  const groups = browserResultGroups();
  const queries = [
    'github',
    'supercmd',
    'electron workspace',
    'bookmark reference 42',
    'https://typescript',
    'tab 37',
  ];

  const indexMeasurement = await measureBlockedTurn(() => buildBrowserEntryIndex(entries));
  const entryIndex = indexMeasurement.result;
  const rankedIndexed = measureAverageMs(15, queries, (query) =>
    getRankedBrowserResults(query, groups, entries, entryIndex, tabs, nicknames, 60)
  );
  const orderedIndexed = measureAverageMs(15, queries, (query) =>
    getOrderedBrowserResults(query, groups, entries, entryIndex, tabs, nicknames, { useConfiguredLimits: true })
  );
  const rankedMaxMs = Math.max(...Object.values(rankedIndexed).map((item) => item.avgMs));
  const orderedMaxMs = Math.max(...Object.values(orderedIndexed).map((item) => item.avgMs));
  const report = {
    dataset: { entries: entries.length, tabs: tabs.length },
    indexMs: Number(indexMeasurement.durationMs.toFixed(2)),
    indexEventLoopDelayMs: Number(indexMeasurement.eventLoopDelayMs.toFixed(2)),
    rankedIndexedAvgMs: roundReportValues(rankedIndexed),
    orderedIndexedAvgMs: roundReportValues(orderedIndexed),
  };

  if (IS_PERF_REPORT) {
    report.rankedFullScanAvgMs = roundReportValues(measureAverageMs(3, queries, (query) =>
      getRankedBrowserResults(query, groups, entries, null, tabs, nicknames, 60)
    ));
    report.orderedFullScanAvgMs = roundReportValues(measureAverageMs(3, queries, (query) =>
      getOrderedBrowserResults(query, groups, entries, null, tabs, nicknames, { useConfiguredLimits: true })
    ));
  }
  printBrowserSearchPerfReport(report);

  assert.ok(indexMeasurement.durationMs < 1_500, `index build should stay below 1500ms, got ${indexMeasurement.durationMs.toFixed(2)}ms`);
  assert.ok(rankedMaxMs < 120, `ranked indexed search should stay below 120ms, got ${rankedMaxMs.toFixed(2)}ms`);
  assert.ok(orderedMaxMs < 120, `ordered indexed search should stay below 120ms, got ${orderedMaxMs.toFixed(2)}ms`);
});

test('browser search perf CI covers large indexed responsiveness budgets', { skip: !IS_PERF_CI }, async () => {
  const { __browserSearchTestAccess } = loadTsModule('src/renderer/src/hooks/useBrowserSearch.ts');
  const { buildBrowserEntryIndex, getOrderedBrowserResults, getRankedBrowserResults } = __browserSearchTestAccess;
  const groups = browserResultGroups();
  const queries = ['github', 'supercmd', 'electron workspace', 'bookmark reference 42', 'https://typescript', 'gh'];
  const datasets = [
    {
      label: '25k',
      options: { historyCount: 21_000, bookmarkCount: 3_999, tabCount: 240 },
      budgets: { indexMs: 3_500, eventLoopDelayMs: 4_000, queryAvgMs: 180, queryEventLoopDelayMs: 4_000 },
    },
    {
      label: '50k',
      options: { historyCount: 45_000, bookmarkCount: 4_999, tabCount: 360 },
      budgets: { indexMs: 7_000, eventLoopDelayMs: 7_500, queryAvgMs: 300, queryEventLoopDelayMs: 8_000 },
    },
  ];
  const reports = [];

  for (const dataset of datasets) {
    const { entries, tabs, nicknames } = buildSyntheticBrowserData(dataset.options);
    const indexMeasurement = await measureBlockedTurn(() => buildBrowserEntryIndex(entries));
    const entryIndex = indexMeasurement.result;

    for (const query of queries) {
      assertBrowserSearchEquivalence({
        query,
        groups,
        entries,
        entryIndex,
        tabs,
        nicknames,
        getOrderedBrowserResults,
        getRankedBrowserResults,
      });
    }

    const rankedMeasurement = await measureBlockedTurn(() => measureAverageMs(5, queries, (query) =>
      getRankedBrowserResults(query, groups, entries, entryIndex, tabs, nicknames, 60)
    ));
    const orderedMeasurement = await measureBlockedTurn(() => measureAverageMs(5, queries, (query) =>
      getOrderedBrowserResults(query, groups, entries, entryIndex, tabs, nicknames, { useConfiguredLimits: true })
    ));
    const rankedMaxMs = Math.max(...Object.values(rankedMeasurement.result).map((item) => item.avgMs));
    const orderedMaxMs = Math.max(...Object.values(orderedMeasurement.result).map((item) => item.avgMs));

    reports.push({
      dataset: { label: dataset.label, entries: entries.length, tabs: tabs.length },
      indexMs: Number(indexMeasurement.durationMs.toFixed(2)),
      indexEventLoopDelayMs: Number(indexMeasurement.eventLoopDelayMs.toFixed(2)),
      rankedIndexedMaxAvgMs: Number(rankedMaxMs.toFixed(2)),
      orderedIndexedMaxAvgMs: Number(orderedMaxMs.toFixed(2)),
      rankedEventLoopDelayMs: Number(rankedMeasurement.eventLoopDelayMs.toFixed(2)),
      orderedEventLoopDelayMs: Number(orderedMeasurement.eventLoopDelayMs.toFixed(2)),
      budgets: {
        indexMs: budgetEntry(Number(indexMeasurement.durationMs.toFixed(2)), dataset.budgets.indexMs),
        indexEventLoopDelayMs: budgetEntry(Number(indexMeasurement.eventLoopDelayMs.toFixed(2)), dataset.budgets.eventLoopDelayMs),
        rankedIndexedMaxAvgMs: budgetEntry(Number(rankedMaxMs.toFixed(2)), dataset.budgets.queryAvgMs),
        orderedIndexedMaxAvgMs: budgetEntry(Number(orderedMaxMs.toFixed(2)), dataset.budgets.queryAvgMs),
        rankedEventLoopDelayMs: budgetEntry(Number(rankedMeasurement.eventLoopDelayMs.toFixed(2)), dataset.budgets.queryEventLoopDelayMs),
        orderedEventLoopDelayMs: budgetEntry(Number(orderedMeasurement.eventLoopDelayMs.toFixed(2)), dataset.budgets.queryEventLoopDelayMs),
      },
    });

    assert.ok(indexMeasurement.durationMs < dataset.budgets.indexMs, `${dataset.label} index build should stay below ${dataset.budgets.indexMs}ms, got ${indexMeasurement.durationMs.toFixed(2)}ms`);
    assert.ok(indexMeasurement.eventLoopDelayMs < dataset.budgets.eventLoopDelayMs, `${dataset.label} index event-loop delay should stay below ${dataset.budgets.eventLoopDelayMs}ms, got ${indexMeasurement.eventLoopDelayMs.toFixed(2)}ms`);
    assert.ok(rankedMaxMs < dataset.budgets.queryAvgMs, `${dataset.label} ranked indexed search should stay below ${dataset.budgets.queryAvgMs}ms, got ${rankedMaxMs.toFixed(2)}ms`);
    assert.ok(orderedMaxMs < dataset.budgets.queryAvgMs, `${dataset.label} ordered indexed search should stay below ${dataset.budgets.queryAvgMs}ms, got ${orderedMaxMs.toFixed(2)}ms`);
    assert.ok(rankedMeasurement.eventLoopDelayMs < dataset.budgets.queryEventLoopDelayMs, `${dataset.label} ranked query event-loop delay should stay below ${dataset.budgets.queryEventLoopDelayMs}ms, got ${rankedMeasurement.eventLoopDelayMs.toFixed(2)}ms`);
    assert.ok(orderedMeasurement.eventLoopDelayMs < dataset.budgets.queryEventLoopDelayMs, `${dataset.label} ordered query event-loop delay should stay below ${dataset.budgets.queryEventLoopDelayMs}ms, got ${orderedMeasurement.eventLoopDelayMs.toFixed(2)}ms`);
  }

  printBrowserSearchPerfReport({ largeDatasets: reports });
});
