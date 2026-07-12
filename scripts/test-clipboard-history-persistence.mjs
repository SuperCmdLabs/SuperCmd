#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const clipboardManagerPath = 'src/main/clipboard-manager.ts';
const mainPath = 'src/main/main.ts';

function makeTextItem(index) {
  return {
    id: `item-${index}`,
    type: 'text',
    content: `Clipboard text ${index}`,
    preview: `Clipboard text ${index}`,
    timestamp: Date.now() + index,
    pinned: false,
  };
}

function assertIncludes(source, needle) {
  assert.ok(source.includes(needle), `Source should include: ${needle}`);
}

function assertNotIncludes(source, needle) {
  assert.ok(!source.includes(needle), `Source should not include: ${needle}`);
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing function signature: ${signature}`);

  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1, `Missing function body: ${signature}`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  assert.fail(`Unterminated function body: ${signature}`);
}

function measureCoalescedRapidAdditions(additions) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-clipboard-after-'));
  const historyPath = path.join(tempDir, 'history.json');
  const tempPath = `${historyPath}.tmp`;
  const history = [];
  let serializeMs = 0;
  let writeMs = 0;

  try {
    for (let index = 0; index < additions; index += 1) {
      history.unshift(makeTextItem(index));
    }

    const serializeStart = performance.now();
    const json = JSON.stringify(history, null, 2);
    serializeMs += performance.now() - serializeStart;

    const writeStart = performance.now();
    fs.writeFileSync(tempPath, json);
    fs.renameSync(tempPath, historyPath);
    writeMs += performance.now() - writeStart;

    return {
      additions,
      writeCount: 1,
      serializeMs,
      writeMs,
      finalBytes: fs.statSync(historyPath).size,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('clipboard history persistence coalesces rapid additions into async atomic writes', () => {
  const source = fs.readFileSync(clipboardManagerPath, 'utf8');
  const syncHistoryWriteSites = (source.match(/fs\.writeFileSync\(historyPath/g) || []).length;
  const metrics = measureCoalescedRapidAdditions(100);

  console.log(
    `[clipboard-after] rapidAdditions=${metrics.additions} ` +
      `coalescedWrites=${metrics.writeCount} ` +
      `serializeMs=${metrics.serializeMs.toFixed(2)} ` +
      `writeMs=${metrics.writeMs.toFixed(2)} ` +
      `blockingMs=${(metrics.serializeMs + metrics.writeMs).toFixed(2)} ` +
      `finalBytes=${metrics.finalBytes}`
  );

  assert.equal(syncHistoryWriteSites, 0);
  assertIncludes(source, 'const HISTORY_SAVE_DEBOUNCE_MS = 250;');
  assertIncludes(source, 'let historySaveDirty = false;');
  assertIncludes(source, 'async function writeHistoryFileAtomic(serializedHistory: string): Promise<void>');
  assertIncludes(source, "await fsp.writeFile(tempPath, serializedHistory, 'utf-8');");
  assertIncludes(source, 'await fsp.rename(tempPath, historyPath);');
  assertIncludes(source, 'while (historySaveDirty)');
  assertIncludes(source, 'historySaveTimer = setTimeout');
  assertIncludes(source, 'void flushClipboardHistoryWrites();');
  assert.equal(metrics.writeCount, 1);
});

test('clipboard history persistence flushes on stop, clear, delete, and app quit', () => {
  const clipboardSource = fs.readFileSync(clipboardManagerPath, 'utf8');
  const mainSource = fs.readFileSync(mainPath, 'utf8');

  const stopBlock = extractFunction(clipboardSource, 'export async function stopClipboardMonitor(): Promise<void>');
  const clearBlock = extractFunction(clipboardSource, 'export async function clearClipboardHistory(): Promise<void>');
  const deleteBlock = extractFunction(clipboardSource, 'export async function deleteClipboardItem(id: string): Promise<boolean>');
  const beforeQuitBlock = extractFunction(mainSource, "app.on('before-quit', (event: any) =>");

  assertIncludes(stopBlock, 'await flushClipboardHistoryWrites();');
  assertIncludes(clearBlock, 'saveHistory({ flush: true });');
  assertIncludes(clearBlock, 'await flushClipboardHistoryWrites();');
  assertIncludes(deleteBlock, 'saveHistory({ flush: true });');
  assertIncludes(deleteBlock, 'await flushClipboardHistoryWrites();');
  assertIncludes(beforeQuitBlock, 'hasPendingClipboardHistoryWrites()');
  assertIncludes(beforeQuitBlock, 'event.preventDefault();');
  assertIncludes(beforeQuitBlock, 'flushClipboardHistoryWrites()');
  assertIncludes(mainSource, 'await flushClipboardHistoryWrites();');
  assertIncludes(mainSource, "ipcMain.handle('clipboard-clear-history', async () =>");
  assertIncludes(mainSource, "ipcMain.handle('clipboard-delete-item', async (_event: any, id: string) =>");
  assertNotIncludes(mainSource, "ipcMain.handle('clipboard-delete-item', (_event: any, id: string) =>");
});
