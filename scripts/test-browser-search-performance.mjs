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

function buildSyntheticBrowserData() {
  const profiles = ['chrome:Default', 'chrome:Work', 'arc:Default', 'brave:Default'];
  const topics = ['github', 'docs', 'linear', 'notion', 'calendar', 'supercmd', 'typescript', 'electron', 'raycast', 'browser'];
  const entries = [];
  const tabs = [];

  for (let index = 0; index < 20_000; index += 1) {
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

  for (let index = 0; index < 4_000; index += 1) {
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

  for (let index = 0; index < 300; index += 1) {
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

test('browser search indexed harness preserves full-scan result order', () => {
  const { __browserSearchTestAccess } = loadTsModule('src/renderer/src/hooks/useBrowserSearch.ts');
  const { buildBrowserEntryIndex, getOrderedBrowserResults, getRankedBrowserResults } = __browserSearchTestAccess;
  const { entries, tabs, nicknames } = buildSyntheticBrowserData();
  const entryIndex = buildBrowserEntryIndex(entries);
  const groups = [
    { kind: 'bookmark', limit: 2 },
    { kind: 'open-tab', limit: 2 },
    { kind: 'history', limit: 2 },
  ];
  const queries = [
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

  for (const query of queries) {
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
});

test('browser search indexed harness stays under generous query thresholds', () => {
  const { __browserSearchTestAccess } = loadTsModule('src/renderer/src/hooks/useBrowserSearch.ts');
  const { buildBrowserEntryIndex, getOrderedBrowserResults, getRankedBrowserResults } = __browserSearchTestAccess;
  const { entries, tabs, nicknames } = buildSyntheticBrowserData();
  const groups = [
    { kind: 'bookmark', limit: 2 },
    { kind: 'open-tab', limit: 2 },
    { kind: 'history', limit: 2 },
  ];
  const queries = [
    'github',
    'supercmd',
    'electron workspace',
    'bookmark reference 42',
    'https://typescript',
    'tab 37',
  ];

  const indexStart = performance.now();
  const entryIndex = buildBrowserEntryIndex(entries);
  const indexMs = performance.now() - indexStart;
  const rankedFullScan = measureAverageMs(3, queries, (query) =>
    getRankedBrowserResults(query, groups, entries, null, tabs, nicknames, 60)
  );
  const orderedFullScan = measureAverageMs(3, queries, (query) =>
    getOrderedBrowserResults(query, groups, entries, null, tabs, nicknames, { useConfiguredLimits: true })
  );
  const rankedIndexed = measureAverageMs(15, queries, (query) =>
    getRankedBrowserResults(query, groups, entries, entryIndex, tabs, nicknames, 60)
  );
  const orderedIndexed = measureAverageMs(15, queries, (query) =>
    getOrderedBrowserResults(query, groups, entries, entryIndex, tabs, nicknames, { useConfiguredLimits: true })
  );
  const rankedMaxMs = Math.max(...Object.values(rankedIndexed).map((item) => item.avgMs));
  const orderedMaxMs = Math.max(...Object.values(orderedIndexed).map((item) => item.avgMs));

  console.log(JSON.stringify({
    browserSearchPerf: {
      dataset: { entries: entries.length, tabs: tabs.length },
      indexMs: Number(indexMs.toFixed(2)),
      rankedFullScanAvgMs: Object.fromEntries(Object.entries(rankedFullScan).map(([query, item]) => [query, Number(item.avgMs.toFixed(2))])),
      orderedFullScanAvgMs: Object.fromEntries(Object.entries(orderedFullScan).map(([query, item]) => [query, Number(item.avgMs.toFixed(2))])),
      rankedIndexedAvgMs: Object.fromEntries(Object.entries(rankedIndexed).map(([query, item]) => [query, Number(item.avgMs.toFixed(2))])),
      orderedIndexedAvgMs: Object.fromEntries(Object.entries(orderedIndexed).map(([query, item]) => [query, Number(item.avgMs.toFixed(2))])),
    },
  }));

  assert.ok(indexMs < 2_000, `index build should stay below 2000ms, got ${indexMs.toFixed(2)}ms`);
  assert.ok(rankedMaxMs < 120, `ranked indexed search should stay below 120ms, got ${rankedMaxMs.toFixed(2)}ms`);
  assert.ok(orderedMaxMs < 120, `ordered indexed search should stay below 120ms, got ${orderedMaxMs.toFixed(2)}ms`);
});
