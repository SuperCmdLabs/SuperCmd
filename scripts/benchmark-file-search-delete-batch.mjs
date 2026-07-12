#!/usr/bin/env node

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadFileSearchIndexInternals() {
  const filePath = path.resolve('src/main/file-search-index.ts');
  const source = `${fs.readFileSync(filePath, 'utf8')}

exports.__test = {
  indexEntry,
  tombstoneDeletedPaths,
  makeSnapshot() {
    return {
      entries: [],
      prefixToEntryIds: new Map(),
      pathToEntryId: new Map(),
      builtAt: Date.now(),
    };
  },
};
`;

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: filePath,
  });

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    Date,
    Map,
    Promise,
    Set,
    clearInterval,
    clearTimeout,
    process,
    setInterval,
    setTimeout,
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: filePath });
  return module.exports.__test;
}

function addEntry(api, snapshot, filePath, isDirectory = false) {
  api.indexEntry(snapshot, {
    path: filePath,
    name: path.basename(filePath),
    parentPath: path.dirname(filePath),
    isDirectory,
  });
}

function buildDirectoryScenario(api) {
  const homeDir = '/tmp/supercmd-file-index-bench';
  const snapshot = api.makeSnapshot();
  const deletedRoot = path.join(homeDir, 'deleted-root');
  const survivorRoot = path.join(homeDir, 'survivors');
  const deletePaths = [deletedRoot];

  addEntry(api, snapshot, deletedRoot, true);
  for (let group = 0; group < 40; group += 1) {
    const groupDir = path.join(deletedRoot, `group-${group}`);
    addEntry(api, snapshot, groupDir, true);
    deletePaths.push(groupDir);
    for (let item = 0; item < 100; item += 1) {
      const nestedDir = path.join(groupDir, `nested-${item}`);
      addEntry(api, snapshot, nestedDir, true);
      addEntry(api, snapshot, path.join(nestedDir, `deleted-${group}-${item}.txt`));
      deletePaths.push(nestedDir);
    }
  }

  addEntry(api, snapshot, survivorRoot, true);
  for (let dir = 0; dir < 120; dir += 1) {
    const dirPath = path.join(survivorRoot, `dir-${dir}`);
    addEntry(api, snapshot, dirPath, true);
    for (let file = 0; file < 500; file += 1) {
      addEntry(api, snapshot, path.join(dirPath, `survivor-${dir}-${file}.txt`));
    }
  }

  return {
    deletePaths,
    deletedRoot,
    expectedDeletedCount: 1 + (40 * 100) + 40 + (40 * 100),
    name: 'directory-tree-batch',
    snapshot,
    survivorPath: path.join(survivorRoot, 'dir-119', 'survivor-119-499.txt'),
  };
}

function buildDirectFileScenario(api) {
  const homeDir = '/tmp/supercmd-file-index-bench-direct';
  const snapshot = api.makeSnapshot();
  const rootDir = path.join(homeDir, 'projects');
  const deletePaths = [];

  addEntry(api, snapshot, rootDir, true);
  for (let dir = 0; dir < 160; dir += 1) {
    const dirPath = path.join(rootDir, `dir-${dir}`);
    addEntry(api, snapshot, dirPath, true);
    for (let file = 0; file < 500; file += 1) {
      const filePath = path.join(dirPath, `file-${dir}-${file}.txt`);
      addEntry(api, snapshot, filePath);
      if (deletePaths.length < 500 && file % 8 === 0) {
        deletePaths.push(filePath);
      }
    }
  }

  return {
    deletePaths,
    expectedDeletedCount: deletePaths.length,
    name: 'direct-file-batch',
    snapshot,
    survivorPath: path.join(rootDir, 'dir-159', 'file-159-499.txt'),
  };
}

function measureScenario(api, scenario) {
  const started = performance.now();
  api.tombstoneDeletedPaths(scenario.snapshot, scenario.deletePaths);
  const elapsedMs = performance.now() - started;

  let deletedCount = 0;
  for (const entry of scenario.snapshot.entries) {
    if (entry.deleted) deletedCount += 1;
  }

  const survivorId = scenario.snapshot.pathToEntryId.get(scenario.survivorPath);
  assert.equal(deletedCount, scenario.expectedDeletedCount);
  assert.notEqual(survivorId, undefined);
  assert.equal(scenario.snapshot.entries[survivorId].deleted, undefined);

  return {
    name: scenario.name,
    entries: scenario.snapshot.entries.length,
    deletePaths: scenario.deletePaths.length,
    deletedCount,
    elapsedMs: Number(elapsedMs.toFixed(3)),
  };
}

const api = loadFileSearchIndexInternals();
const scenarios = [
  measureScenario(api, buildDirectFileScenario(api)),
  measureScenario(api, buildDirectoryScenario(api)),
];

console.log(JSON.stringify({
  benchmark: 'file-search-delete-batch',
  scenarios,
}, null, 2));
