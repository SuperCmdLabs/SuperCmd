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

function makeVirtualSectionRow(key, top, height) {
  return {
    kind: 'section',
    key,
    sectionKey: key,
    title: key,
    top,
    height,
  };
}

function getVisibleRowKeys(getVisibleVirtualRows, rows, options) {
  return getVisibleVirtualRows(rows, options).map((row) => row.key);
}

function makeInstrumentedRows(rowCount) {
  const stats = { topReads: 0, heightReads: 0 };
  const rowHeight = 20;
  const rowGap = 4;
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const top = index * (rowHeight + rowGap);

    return {
      kind: 'section',
      key: `instrumented-${index}`,
      sectionKey: 'instrumented',
      get top() {
        stats.topReads += 1;
        return top;
      },
      get height() {
        stats.heightReads += 1;
        return rowHeight;
      },
    };
  });

  return { rows, stats };
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

  await t.test('preserves inclusive visible-row boundary semantics', () => {
    const rows = [
      makeVirtualSectionRow('a', 0, 10),
      makeVirtualSectionRow('b', 20, 10),
      makeVirtualSectionRow('c', 40, 10),
    ];

    assert.deepEqual(
      getVisibleRowKeys(getVisibleVirtualRows, rows, { scrollTop: 10, viewportHeight: 1, overscan: 0 }),
      ['a'],
      'row whose bottom equals the visible start remains included',
    );
    assert.deepEqual(
      getVisibleRowKeys(getVisibleVirtualRows, rows, { scrollTop: 15, viewportHeight: 5, overscan: 0 }),
      ['b'],
      'row whose top equals the visible end remains included',
    );
    assert.deepEqual(
      getVisibleRowKeys(getVisibleVirtualRows, rows, { scrollTop: 11, viewportHeight: 8, overscan: 0 }),
      [],
      'rows outside the unexpanded viewport gap are excluded',
    );
    assert.deepEqual(
      getVisibleRowKeys(getVisibleVirtualRows, rows, { scrollTop: 11, viewportHeight: 8, overscan: 1 }),
      ['a', 'b'],
      'overscan preserves the same inclusive start and end comparisons',
    );
    assert.deepEqual(
      getVisibleRowKeys(getVisibleVirtualRows, rows, { scrollTop: 45, viewportHeight: 1, overscan: 0 }),
      ['c'],
      'partially visible rows remain included',
    );
    assert.deepEqual(
      getVisibleRowKeys(getVisibleVirtualRows, rows, { scrollTop: 51, viewportHeight: 1, overscan: 0 }),
      [],
      'rows whose bottom is before the visible start are excluded',
    );
  });

  await t.test('uses sublinear row-bound lookup for large row sets', () => {
    const { rows, stats } = makeInstrumentedRows(100000);
    const rangeStart = performance.now();
    const visibleRows = getVisibleVirtualRows(rows, {
      scrollTop: 1200000,
      viewportHeight: VIEWPORT_HEIGHT,
      overscan: 320,
    });
    const duration = performance.now() - rangeStart;
    const boundReads = stats.topReads + stats.heightReads;

    console.log(
      `[grid-perf] visibleRange rows=${rows.length} renderedRows=${visibleRows.length} boundReads=${boundReads} durationMs=${duration.toFixed(3)}`,
    );

    assert.ok(visibleRows.length > 0, 'large range returns visible rows');
    assert.ok(visibleRows.length < 100, `expected a small visible window, got ${visibleRows.length}`);
    assert.ok(boundReads < 512, `expected logarithmic bound reads, got ${boundReads}`);
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
