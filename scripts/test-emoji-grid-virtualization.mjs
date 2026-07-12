#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function importListHooks() {
  const result = await build({
    entryPoints: [path.join(root, 'src/renderer/src/raycast-api/list-runtime-hooks.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  });
  const code = result.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

function makeEmojiItems(totalItems) {
  return Array.from({ length: totalItems }, (_, index) => ({
    id: `emoji-${index}`,
    order: index,
    sectionTitle: index < totalItems / 2 ? 'Smileys' : 'Symbols',
    props: {
      title: `Emoji ${index}`,
      icon: '😀',
    },
  }));
}

function countEmojiCells(rows) {
  return rows.reduce((count, row) => count + (row.type === 'emoji-row' ? row.items.length : 0), 0);
}

const hooks = await importListHooks();

test('Emoji grid virtualization', async (t) => {
  const totalItems = 4096;
  const items = makeEmojiItems(totalItems);
  const groupedItems = hooks.groupListItems(items);
  const gridRows = hooks.buildEmojiGridVirtualRows(groupedItems);
  const rowMetrics = hooks.measureVirtualRows(gridRows);

  await t.test('renders only the visible emoji cells plus overscan', () => {
    assert.equal(hooks.shouldUseEmojiGrid(items, false, () => true), true, 'fixture should use the emoji grid path');
    assert.equal(countEmojiCells(gridRows), totalItems, 'all items are represented by virtual rows');
    assert.ok(gridRows.length < totalItems, 'grid rows compact many cells into fixed rows');

    const range = hooks.getVisibleVirtualRange(gridRows, rowMetrics, 0, 600);
    const visibleCells = countEmojiCells(gridRows.slice(range.visibleStart, range.visibleEnd));

    assert.equal(visibleCells, 112);
    assert.ok(visibleCells < totalItems * 0.05, 'initial window renders less than 5% of the list');
    console.log(JSON.stringify({
      mode: 'after-test',
      totalItems,
      virtualRows: gridRows.length,
      visibleCells,
      visibleStart: range.visibleStart,
      visibleEnd: range.visibleEnd,
    }));
  });

  await t.test('maps selected indices to their grouped grid rows', () => {
    const itemToRow = hooks.buildItemToVirtualRowMap(gridRows, totalItems);

    assert.equal(itemToRow[0], 1, 'first section starts after its header');
    assert.equal(itemToRow[7], 1, 'first row contains eight cells');
    assert.equal(itemToRow[8], 2, 'ninth cell starts the next grid row');
    assert.equal(itemToRow[2047], 256, 'last item in the first section stays in its final row');
    assert.equal(itemToRow[2048], 258, 'second section starts after the next header');

    const selectedRow = itemToRow[3000];
    const selectedTop = rowMetrics.offsets[selectedRow];
    const selectedRange = hooks.getVisibleVirtualRange(gridRows, rowMetrics, selectedTop, 600);
    const visibleCells = countEmojiCells(gridRows.slice(selectedRange.visibleStart, selectedRange.visibleEnd));

    assert.ok(selectedRow >= selectedRange.visibleStart && selectedRow < selectedRange.visibleEnd, 'selected item row is visible');
    assert.ok(visibleCells < 200, 'selection scroll window stays bounded');
  });
});
