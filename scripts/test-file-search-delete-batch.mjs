#!/usr/bin/env node

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadFileSearchIndexInternals() {
  const filePath = path.resolve('src/main/file-search-index.ts');
  const source = `${fs.readFileSync(filePath, 'utf8')}

exports.__test = {
  collapseNestedDeletedPaths,
  indexEntry,
  searchIndexedFiles,
  tombstoneDeletedPaths,
  makeSnapshot() {
    return {
      entries: [],
      prefixToEntryIds: new Map(),
      pathToEntryId: new Map(),
      builtAt: Date.now(),
    };
  },
  setActiveIndex(snapshot, homeDir) {
    activeIndex = snapshot;
    configuredHomeDir = homeDir;
    includeRoots = [homeDir];
    includeProtectedHomeRoots = true;
    lastBuildStartedAt = 0;
    lastIndexError = null;
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

const api = loadFileSearchIndexInternals();
const homeDir = '/tmp/supercmd-file-search-delete-tests';

function addEntry(snapshot, filePath, isDirectory = false) {
  api.indexEntry(snapshot, {
    path: filePath,
    name: path.basename(filePath),
    parentPath: path.dirname(filePath),
    isDirectory,
  });
}

function entryForPath(snapshot, filePath) {
  const id = snapshot.pathToEntryId.get(filePath);
  assert.notEqual(id, undefined, `${filePath} should be indexed`);
  return snapshot.entries[id];
}

function isDeleted(snapshot, filePath) {
  return Boolean(entryForPath(snapshot, filePath).deleted);
}

test('file delete tombstones only the exact indexed file', () => {
  const snapshot = api.makeSnapshot();
  const deletedFile = path.join(homeDir, 'notes', 'alpha.txt');
  const prefixSibling = path.join(homeDir, 'notes', 'alpha.txt.backup');
  const survivor = path.join(homeDir, 'notes', 'beta.txt');

  addEntry(snapshot, path.dirname(deletedFile), true);
  addEntry(snapshot, deletedFile);
  addEntry(snapshot, prefixSibling);
  addEntry(snapshot, survivor);

  api.tombstoneDeletedPaths(snapshot, [deletedFile]);

  assert.equal(isDeleted(snapshot, deletedFile), true);
  assert.equal(isDeleted(snapshot, prefixSibling), false);
  assert.equal(isDeleted(snapshot, survivor), false);

  api.indexEntry(snapshot, {
    path: deletedFile,
    name: path.basename(deletedFile),
    parentPath: path.dirname(deletedFile),
    isDirectory: false,
  });
  assert.equal(isDeleted(snapshot, deletedFile), false);
});

test('directory delete tombstones the directory and all indexed descendants', () => {
  const snapshot = api.makeSnapshot();
  const deletedDir = path.join(homeDir, 'project');
  const childDir = path.join(deletedDir, 'src');
  const childFile = path.join(childDir, 'index.ts');
  const survivor = path.join(homeDir, 'other', 'index.ts');

  addEntry(snapshot, deletedDir, true);
  addEntry(snapshot, childDir, true);
  addEntry(snapshot, childFile);
  addEntry(snapshot, path.dirname(survivor), true);
  addEntry(snapshot, survivor);

  api.tombstoneDeletedPaths(snapshot, [deletedDir]);

  assert.equal(isDeleted(snapshot, deletedDir), true);
  assert.equal(isDeleted(snapshot, childDir), true);
  assert.equal(isDeleted(snapshot, childFile), true);
  assert.equal(isDeleted(snapshot, survivor), false);
});

test('nested directory deletes collapse to the outermost deleted root', () => {
  const deletedRoot = path.join(homeDir, 'nested-root');
  const nestedDir = path.join(deletedRoot, 'child');
  const nestedFile = path.join(nestedDir, 'deep.txt');

  assert.deepEqual(
    Array.from(api.collapseNestedDeletedPaths([nestedFile, nestedDir, deletedRoot])),
    [deletedRoot]
  );

  const snapshot = api.makeSnapshot();
  const similarSibling = path.join(homeDir, 'nested-root-copy', 'deep.txt');
  addEntry(snapshot, deletedRoot, true);
  addEntry(snapshot, nestedDir, true);
  addEntry(snapshot, nestedFile);
  addEntry(snapshot, path.dirname(similarSibling), true);
  addEntry(snapshot, similarSibling);

  api.tombstoneDeletedPaths(snapshot, [nestedFile, nestedDir, deletedRoot]);

  assert.equal(isDeleted(snapshot, deletedRoot), true);
  assert.equal(isDeleted(snapshot, nestedDir), true);
  assert.equal(isDeleted(snapshot, nestedFile), true);
  assert.equal(isDeleted(snapshot, similarSibling), false);
});

test('non-matching delete paths do not tombstone prefix-like neighbors', async () => {
  const snapshot = api.makeSnapshot();
  const prefixLikeDelete = path.join(homeDir, 'docs');
  const survivorDir = path.join(homeDir, 'docs-old');
  const survivor = path.join(survivorDir, 'report.txt');
  const searchable = path.join(homeDir, 'searchable', 'needle-survivor.txt');

  addEntry(snapshot, survivorDir, true);
  addEntry(snapshot, survivor);
  addEntry(snapshot, path.dirname(searchable), true);
  addEntry(snapshot, searchable);

  api.tombstoneDeletedPaths(snapshot, [
    prefixLikeDelete,
    path.join(homeDir, 'missing', 'child'),
  ]);

  assert.equal(isDeleted(snapshot, survivor), false);
  assert.equal(isDeleted(snapshot, searchable), false);

  api.setActiveIndex(snapshot, homeDir);
  const results = await api.searchIndexedFiles('needle-survivor', { limit: 1 });
  assert.equal(results.length, 1);
  assert.equal(results[0].path, searchable);
});
