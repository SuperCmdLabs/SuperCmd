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
  const testState = {
    spotlightCalls: [],
    spotlightStdout: '',
  };
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
  const testProcess = Object.create(process);
  Object.defineProperty(testProcess, 'platform', { value: 'darwin' });
  const localRequire = (request) => {
    if (request === 'child_process') {
      return {
        execFile(file, args, options, callback) {
          testState.spotlightCalls.push({ file, args, options });
          callback(null, { stdout: testState.spotlightStdout, stderr: '' });
        },
      };
    }
    return require(request);
  };
  const sandbox = {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    Date,
    Map,
    Promise,
    Set,
    clearInterval,
    clearTimeout,
    process: testProcess,
    setInterval,
    setTimeout,
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: filePath });
  module.exports.__test.setSpotlightStdout = (stdout) => {
    testState.spotlightStdout = stdout;
    testState.spotlightCalls = [];
  };
  module.exports.__test.getSpotlightCalls = () => [...testState.spotlightCalls];
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
  const id = snapshot.pathToEntryId.get(path.resolve(filePath));
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

test('batched indexed file deletes do not scan unrelated entries', () => {
  const snapshot = api.makeSnapshot();
  const deletedFiles = [];
  const bulkDir = path.join(homeDir, 'bulk-files');

  addEntry(snapshot, bulkDir, true);
  for (let index = 0; index < 64; index += 1) {
    const filePath = path.join(bulkDir, `deleted-${index}.txt`);
    deletedFiles.push(filePath);
    addEntry(snapshot, filePath);
  }

  snapshot.entries.push({
    get path() {
      throw new Error('direct indexed file deletes should not scan unrelated entry paths');
    },
    name: 'sentinel.txt',
    parentPath: bulkDir,
    normalizedName: 'sentinel txt',
    normalizedPath: 'sentinel',
    normalizedTildePath: 'sentinel',
    compactName: 'sentineltxt',
    tokens: ['sentinel', 'txt'],
    pathTokens: ['sentinel'],
    isDirectory: false,
  });

  api.tombstoneDeletedPaths(snapshot, deletedFiles);

  for (const filePath of deletedFiles) {
    assert.equal(isDeleted(snapshot, filePath), true);
  }
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

test('unknown deleted paths still tombstone indexed descendants', () => {
  const snapshot = api.makeSnapshot();
  const deletedRoot = path.join(homeDir, 'unknown-root');
  const childFile = path.join(deletedRoot, 'child.txt');
  const siblingFile = path.join(homeDir, 'unknown-root-copy', 'child.txt');

  addEntry(snapshot, childFile);
  addEntry(snapshot, path.dirname(siblingFile), true);
  addEntry(snapshot, siblingFile);

  api.tombstoneDeletedPaths(snapshot, [deletedRoot]);

  assert.equal(isDeleted(snapshot, childFile), true);
  assert.equal(isDeleted(snapshot, siblingFile), false);
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

test('delete path matching uses the same resolved form as indexed entries', () => {
  const snapshot = api.makeSnapshot();
  const rawIndexedPath = `${homeDir}/normalized/../normalized/same-name.txt`;
  const resolvedPath = path.resolve(rawIndexedPath);

  addEntry(snapshot, rawIndexedPath);
  api.tombstoneDeletedPaths(snapshot, [resolvedPath]);

  assert.equal(isDeleted(snapshot, resolvedPath), true);
});

test('deleted-name tombstones do not suppress Spotlight fallback for live same-name files', async () => {
  const snapshot = api.makeSnapshot();
  const deletedPath = path.join(homeDir, 'old', 'shared-name.txt');
  const livePath = path.join(homeDir, 'new', 'shared-name.txt');

  addEntry(snapshot, deletedPath);
  api.tombstoneDeletedPaths(snapshot, [deletedPath]);
  api.setActiveIndex(snapshot, homeDir);
  api.setSpotlightStdout(`${deletedPath}\n${livePath}\n`);

  const results = await api.searchIndexedFiles('shared-name.txt', { limit: 3 });

  assert.equal(api.getSpotlightCalls().length, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].path, livePath);
});

test('large tombstone batches compact deleted-heavy prefix buckets before post-delete queries', async () => {
  const snapshot = api.makeSnapshot();
  const deletedFiles = [];
  const deletedDir = path.join(homeDir, 'deleted-heavy');
  const survivorDir = path.join(homeDir, 'survivors');
  const survivor = path.join(survivorDir, 'launch-plan-alpha-survivor.md');

  addEntry(snapshot, deletedDir, true);
  for (let index = 0; index < 5000; index += 1) {
    const filePath = path.join(deletedDir, `launch-plan-alpha-deleted-${index}.md`);
    deletedFiles.push(filePath);
    addEntry(snapshot, filePath);
  }
  addEntry(snapshot, survivorDir, true);
  addEntry(snapshot, survivor);

  const bucketBefore = snapshot.prefixToEntryIds.get('launch') || [];
  assert.ok(bucketBefore.length > 5000, 'fixture should create a deleted-heavy launch bucket');

  api.tombstoneDeletedPaths(snapshot, deletedFiles);

  const bucketAfter = snapshot.prefixToEntryIds.get('launch') || [];
  assert.equal(bucketAfter.length, 1);
  assert.equal(snapshot.entries[bucketAfter[0]].path, survivor);

  api.setActiveIndex(snapshot, homeDir);
  const results = await api.searchIndexedFiles('launch plan alpha survivor', { limit: 3 });
  assert.equal(results.length, 1);
  assert.equal(results[0].path, survivor);

  const restoredFile = deletedFiles[42];
  api.indexEntry(snapshot, {
    path: restoredFile,
    name: path.basename(restoredFile),
    parentPath: path.dirname(restoredFile),
    isDirectory: false,
  });

  const restoredResults = await api.searchIndexedFiles('launch plan alpha deleted 42', { limit: 3 });
  assert.equal(restoredResults.length, 1);
  assert.equal(restoredResults[0].path, restoredFile);
});
