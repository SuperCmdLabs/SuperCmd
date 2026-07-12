#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { transform } from 'esbuild';

const require = createRequire(import.meta.url);
const repoRoot = process.cwd();
const notesStorePath = path.join(repoRoot, 'src/main/notes-store.ts');

function createMetrics() {
  return {
    notesJsonWriteCount: 0,
    syncWriteFileCount: 0,
    asyncWriteFileCount: 0,
    syncWriteMs: 0,
    asyncWriteMs: 0,
  };
}

function resetMetrics(metrics) {
  metrics.notesJsonWriteCount = 0;
  metrics.syncWriteFileCount = 0;
  metrics.asyncWriteFileCount = 0;
  metrics.syncWriteMs = 0;
  metrics.asyncWriteMs = 0;
}

function isNotesJsonPath(filePath) {
  const normalizedPath = String(filePath);
  return (
    path.basename(path.dirname(normalizedPath)) === 'notes' &&
    (path.basename(normalizedPath) === 'notes.json' || path.basename(normalizedPath).startsWith('notes.json.'))
  );
}

function blockForMs(durationMs) {
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    // Deliberately burn a tiny amount of CPU to make sync write blocking visible.
  }
}

async function loadNotesStore({ writeDelayMs = 0 } = {}) {
  const testRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'supercmd-notes-store-'));
  const userData = path.join(testRoot, 'user-data');
  const compiledPath = path.join(testRoot, 'notes-store.cjs');

  const source = fs.readFileSync(notesStorePath, 'utf8');
  const { code } = await transform(source, {
    loader: 'ts',
    format: 'cjs',
    platform: 'node',
    target: 'node20',
  });
  await fsp.writeFile(compiledPath, code, 'utf8');

  const realFs = require('node:fs');
  const realFsPromises = require('node:fs/promises');
  const originalWriteFileSync = realFs.writeFileSync;
  const originalFsPromisesWriteFile = realFs.promises.writeFile;
  const originalStandaloneWriteFile = realFsPromises.writeFile;
  const originalModuleLoad = Module._load;
  const metrics = createMetrics();

  function recordWrite(filePath, kind, elapsedMs) {
    if (!isNotesJsonPath(filePath)) return;
    metrics.notesJsonWriteCount += 1;
    if (kind === 'sync') {
      metrics.syncWriteFileCount += 1;
      metrics.syncWriteMs += elapsedMs;
    } else {
      metrics.asyncWriteFileCount += 1;
      metrics.asyncWriteMs += elapsedMs;
    }
  }

  realFs.writeFileSync = function patchedWriteFileSync(filePath, ...args) {
    const isNotesWrite = isNotesJsonPath(filePath);
    const startedAt = performance.now();
    if (isNotesWrite && writeDelayMs > 0) {
      blockForMs(writeDelayMs);
    }
    try {
      return originalWriteFileSync.apply(this, [filePath, ...args]);
    } finally {
      recordWrite(filePath, 'sync', performance.now() - startedAt);
    }
  };

  async function patchedAsyncWriteFile(filePath, ...args) {
    const startedAt = performance.now();
    try {
      return await originalStandaloneWriteFile.apply(this, [filePath, ...args]);
    } finally {
      recordWrite(filePath, 'async', performance.now() - startedAt);
    }
  }

  realFs.promises.writeFile = patchedAsyncWriteFile;

  const fsPromisesStub = {
    ...realFsPromises,
    writeFile: patchedAsyncWriteFile,
  };

  Module._load = function patchedModuleLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath(name) {
            assert.equal(name, 'userData');
            return userData;
          },
        },
        clipboard: { writeText() {} },
        dialog: {
          async showSaveDialog() {
            return { canceled: true };
          },
          async showOpenDialog() {
            return { canceled: true, filePaths: [] };
          },
        },
        BrowserWindow: class BrowserWindow {},
      };
    }
    if (request === 'fs/promises' || request === 'node:fs/promises') {
      return fsPromisesStub;
    }
    return originalModuleLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const store = require(compiledPath);
    return {
      store,
      metrics,
      resetMetrics: () => resetMetrics(metrics),
      getNotesFilePath: () => path.join(userData, 'notes', 'notes.json'),
      async cleanup() {
        Module._load = originalModuleLoad;
        realFs.writeFileSync = originalWriteFileSync;
        realFs.promises.writeFile = originalFsPromisesWriteFile;
        realFsPromises.writeFile = originalStandaloneWriteFile;
        delete require.cache[compiledPath];
        await fsp.rm(testRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    Module._load = originalModuleLoad;
    realFs.writeFileSync = originalWriteFileSync;
    realFs.promises.writeFile = originalFsPromisesWriteFile;
    realFsPromises.writeFile = originalStandaloneWriteFile;
    await fsp.rm(testRoot, { recursive: true, force: true });
    throw error;
  }
}

async function flushStore(store) {
  assert.equal(
    typeof store.flushNotesToDisk,
    'function',
    'notes store must export flushNotesToDisk() so app quit can persist queued saves'
  );
  await store.flushNotesToDisk();
}

async function readPersistedNotes(notesFilePath) {
  return JSON.parse(await fsp.readFile(notesFilePath, 'utf8'));
}

test('Notes autosave persistence coalesces repeated updates off the synchronous path', async () => {
  const harness = await loadNotesStore({ writeDelayMs: 1 });
  try {
    harness.store.initNoteStore();
    const note = harness.store.createNote({ title: 'Autosave baseline', content: 'initial' });
    if (typeof harness.store.flushNotesToDisk === 'function') {
      await harness.store.flushNotesToDisk();
    }

    harness.resetMetrics();
    const startedAt = performance.now();
    for (let index = 0; index < 20; index += 1) {
      const updated = harness.store.updateNote(note.id, {
        title: `Autosave ${index}`,
        content: `body ${index}`,
      });
      assert.equal(updated?.content, `body ${index}`);
    }
    const loopMs = performance.now() - startedAt;

    assert.equal(harness.store.getNoteById(note.id)?.content, 'body 19');
    if (typeof harness.store.flushNotesToDisk !== 'function') {
      console.log(
        `[Notes autosave baseline] repeatedUpdates=20 writes=${harness.metrics.notesJsonWriteCount} ` +
        `syncWrites=${harness.metrics.syncWriteFileCount} asyncWrites=${harness.metrics.asyncWriteFileCount} ` +
        `loopMs=${loopMs.toFixed(2)} syncWriteMs=${harness.metrics.syncWriteMs.toFixed(2)}`
      );
    }
    await flushStore(harness.store);
    const persisted = await readPersistedNotes(harness.getNotesFilePath());
    assert.equal(persisted[0]?.content, 'body 19');

    console.log(
      `[Notes autosave metrics] repeatedUpdates=20 writes=${harness.metrics.notesJsonWriteCount} ` +
      `syncWrites=${harness.metrics.syncWriteFileCount} asyncWrites=${harness.metrics.asyncWriteFileCount} ` +
      `loopMs=${loopMs.toFixed(2)} syncWriteMs=${harness.metrics.syncWriteMs.toFixed(2)}`
    );

    assert.equal(harness.metrics.syncWriteFileCount, 0);
    assert.ok(
      harness.metrics.notesJsonWriteCount <= 1,
      `expected repeated autosaves to coalesce to <= 1 physical write, got ${harness.metrics.notesJsonWriteCount}`
    );
  } finally {
    await harness.cleanup();
  }
});

test('Notes flush persists the latest queued state before shutdown', async () => {
  const harness = await loadNotesStore();
  try {
    harness.store.initNoteStore();
    const note = harness.store.createNote({ title: 'Flush baseline', content: 'initial' });
    await flushStore(harness.store);

    harness.resetMetrics();
    harness.store.updateNote(note.id, { content: 'queued one' });
    harness.store.updateNote(note.id, { content: 'queued two' });

    assert.equal(harness.store.getNoteById(note.id)?.content, 'queued two');
    await flushStore(harness.store);

    const persisted = await readPersistedNotes(harness.getNotesFilePath());
    assert.equal(persisted[0]?.content, 'queued two');
    assert.equal(harness.metrics.syncWriteFileCount, 0);
    assert.ok(
      harness.metrics.notesJsonWriteCount <= 1,
      `expected flush to persist the latest state once, got ${harness.metrics.notesJsonWriteCount} writes`
    );
  } finally {
    await harness.cleanup();
  }
});
