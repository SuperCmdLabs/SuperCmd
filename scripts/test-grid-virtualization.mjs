#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperPath = path.join(root, 'src/renderer/src/raycast-api/grid-runtime-virtualization.ts');

const ITEM_COUNT = 5000;
const VIEWPORT_HEIGHT = 640;
const CONTAINER_WIDTH = 800;
const DEFAULT_COLUMNS = 5;

function makeLargeGridGroups() {
  const firstItems = [];
  const secondItems = [];

  for (let index = 0; index < ITEM_COUNT; index += 1) {
    const item = {
      item: {
        id: `item-${index}`,
        order: index,
        props: {
          id: `visible-${index}`,
          title: `Item ${index}`,
          subtitle: `Subtitle ${index}`,
          content: index % 3 === 0
            ? { source: `asset-${index}.png`, tintColor: index % 2 === 0 ? 'blue' : undefined }
            : { value: `Icon.Circle.${index}`, tooltip: `Icon ${index}` },
        },
        section: index < ITEM_COUNT / 2
          ? { id: 'section-a', title: 'Section A' }
          : { id: 'section-b', title: 'Section B', columns: 4, aspectRatio: '3/2', fit: 'fill', inset: 'lg' },
      },
      globalIdx: index,
    };

    if (index < ITEM_COUNT / 2) firstItems.push(item);
    else secondItems.push(item);
  }

  return [
    { key: 'section-a', title: 'Section A', section: { id: 'section-a', title: 'Section A' }, items: firstItems },
    {
      key: 'section-b',
      title: 'Section B',
      section: { id: 'section-b', title: 'Section B', columns: 4, aspectRatio: '3/2', fit: 'fill', inset: 'lg' },
      items: secondItems,
    },
  ];
}

function countEagerRenderedCells(groups) {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

function simulateCellContentResolution(groups) {
  let checksum = 0;
  for (const group of groups) {
    for (const { item } of group.items) {
      const content = item.props.content;
      if (typeof content?.source === 'string') checksum += content.source.length;
      if (typeof content?.value === 'string') checksum += content.value.length;
      if (typeof item.props.title === 'string') checksum += item.props.title.length;
    }
  }
  return checksum;
}

function countItemsInRows(rows) {
  return rows.reduce((total, row) => total + (row.kind === 'items' ? row.items.length : 0), 0);
}

function rowContainsIndex(rows, index) {
  return rows.some((row) => row.kind === 'items' && row.items.some((entry) => entry.globalIdx === index));
}

test('Grid virtualization keeps large grids to visible cells', async (t) => {
  const groups = makeLargeGridGroups();
  const eagerStart = performance.now();
  const eagerCells = countEagerRenderedCells(groups);
  const checksum = simulateCellContentResolution(groups);
  const eagerDuration = performance.now() - eagerStart;

  console.log(
    `[grid-perf] baseline eager cells=${eagerCells} contentResolutions=${ITEM_COUNT} durationMs=${eagerDuration.toFixed(3)} checksum=${checksum}`,
  );

  assert.equal(eagerCells, ITEM_COUNT, 'legacy grid renders every cell in a large grid');

  if (!fs.existsSync(helperPath)) {
    console.log('[grid-perf] virtualization helper not present yet; baseline captured before renderer edits');
    return;
  }

  const {
    buildVirtualGridLayout,
    countVirtualizedRowItems,
    getScrollTopForItemIndex,
    getVisibleVirtualRows,
  } = await importTs(helperPath);

  await t.test('renders only visible item cells plus overscan', () => {
    const layout = buildVirtualGridLayout(groups, {
      defaultColumns: DEFAULT_COLUMNS,
      containerWidth: CONTAINER_WIDTH,
    });
    const visibleRows = getVisibleVirtualRows(layout.rows, {
      scrollTop: 0,
      viewportHeight: VIEWPORT_HEIGHT,
    });
    const visibleCells = countVirtualizedRowItems(visibleRows);

    console.log(
      `[grid-perf] virtualized visibleCells=${visibleCells} totalCells=${layout.itemCount} renderedRows=${visibleRows.length} totalRows=${layout.rows.length} totalHeight=${layout.totalHeight.toFixed(1)}`,
    );

    assert.equal(layout.itemCount, ITEM_COUNT);
    assert.equal(visibleCells, countItemsInRows(visibleRows));
    assert.ok(visibleCells > 0, 'initial viewport renders visible cells');
    assert.ok(visibleCells < 80, `expected a small visible window, got ${visibleCells}`);
  });

  await t.test('scrolls selected items into the virtual window', () => {
    const layout = buildVirtualGridLayout(groups, {
      defaultColumns: DEFAULT_COLUMNS,
      containerWidth: CONTAINER_WIDTH,
    });
    const targetIndex = 4242;
    const scrollTop = getScrollTopForItemIndex(layout, targetIndex, {
      currentScrollTop: 0,
      viewportHeight: VIEWPORT_HEIGHT,
    });
    const selectedRows = getVisibleVirtualRows(layout.rows, {
      scrollTop,
      viewportHeight: VIEWPORT_HEIGHT,
    });

    assert.ok(rowContainsIndex(selectedRows, targetIndex), 'selected off-screen item is rendered after selection scroll');
  });

  await t.test('preserves section layout options', () => {
    const layout = buildVirtualGridLayout(groups, {
      defaultColumns: DEFAULT_COLUMNS,
      containerWidth: CONTAINER_WIDTH,
    });
    const sectionRow = layout.rows.find((row) => row.kind === 'items' && row.sectionKey === 'section-b');

    assert.ok(sectionRow, 'section row exists');
    assert.equal(sectionRow.layout.columns, 4);
    assert.equal(sectionRow.layout.fit, 'fill');
    assert.equal(sectionRow.layout.inset, 'lg');
    assert.notEqual(sectionRow.itemHeight, 160, 'aspect ratio creates a section-specific item row height');
  });
});
