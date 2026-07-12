#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITEM_COUNT = Number.parseInt(process.env.SUPERCMD_REGISTRY_DIRTY_ITEMS || '5000', 10);
const REACT_ELEMENT_TYPE = Symbol.for('react.element');

async function importHookModule(absPath) {
  const result = await build({
    entryPoints: [absPath],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  });
  const code = result.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const listHooks = await importHookModule(path.join(root, 'src/renderer/src/raycast-api/list-runtime-hooks.ts'));
const gridHooks = await importHookModule(path.join(root, 'src/renderer/src/raycast-api/grid-runtime-hooks.ts'));

function namedType(displayName) {
  const component = function RuntimeElement() {};
  component.displayName = displayName;
  return component;
}

function makeElement(displayName, props = {}) {
  return {
    $$typeof: REACT_ELEMENT_TYPE,
    type: namedType(displayName),
    key: null,
    props,
  };
}

function makeListItem(index, overrides = {}) {
  const props = {
    id: `list-visible-${index}`,
    title: { value: `Emoji ${index}`, tooltip: `Emoji title ${index}` },
    subtitle: { value: `Subtitle ${index}`, tooltip: `Subtitle tip ${index}` },
    icon: {
      source: index % 2 === 0 ? '\u{1F600}' : { light: `icon-${index}.png`, dark: `icon-${index}-dark.png` },
      tintColor: index % 3 === 0 ? 'blue' : undefined,
    },
    accessories: [
      {
        text: { value: `Accessory ${index}`, color: 'red' },
        icon: { source: 'Icon.Star' },
        tooltip: `Accessory tip ${index}`,
      },
      {
        tag: { value: `Tag ${index % 17}`, color: 'green' },
        date: new Date(1_700_000_000_000 + index * 1000).toISOString(),
      },
    ],
    keywords: [`emoji-${index}`, `group-${index % 25}`, 'common'],
    detail: makeElement('ListItemDetail', {
      markdown: `# Emoji ${index}`,
      metadata: makeElement('Metadata', { children: [`meta-${index}`] }),
      isLoading: false,
    }),
    quickLook: { name: `Emoji ${index}`, path: `/tmp/emoji-${index}.png` },
    actions: makeElement('ActionPanel', {
      children: [makeElement('Action.CopyToClipboard', { title: 'Copy', content: `emoji-${index}` })],
    }),
    ...(overrides.props || {}),
  };

  return {
    id: overrides.id || `list-${index}`,
    order: overrides.order ?? index,
    sectionTitle: overrides.sectionTitle ?? (index < ITEM_COUNT / 2 ? 'Smileys' : 'Symbols'),
    props,
  };
}

function makeGridItem(index, overrides = {}) {
  const defaultSection = index < ITEM_COUNT / 2
    ? { id: 'section-a', title: 'Section A' }
    : { id: 'section-b', title: 'Section B' };
  const props = {
    id: `grid-visible-${index}`,
    title: `Grid ${index}`,
    subtitle: `Grid subtitle ${index}`,
    content: index % 3 === 0
      ? { source: `asset-${index}.png`, tintColor: 'blue', fallback: 'Icon.Image' }
      : { value: `Icon.Circle.${index}`, color: index % 2 === 0 ? 'purple' : 'orange' },
    accessory: {
      icon: { value: 'Icon.Star', color: 'yellow' },
      tooltip: `Pinned ${index}`,
    },
    keywords: [`grid-${index}`, `bucket-${index % 20}`],
    quickLook: { name: `Grid ${index}`, path: `/tmp/grid-${index}.png` },
    actions: makeElement('ActionPanel', {
      children: [makeElement('Action.Open', { title: 'Open', target: `/tmp/grid-${index}.png` })],
    }),
    ...(overrides.props || {}),
  };

  return {
    id: overrides.id || `grid-${index}`,
    order: overrides.order ?? index,
    section: overrides.section ?? defaultSection,
    props,
  };
}

function getReactTypeName(type) {
  return String(type?.displayName || type?.name || type || '');
}

function isReactElement(value) {
  return Boolean(value && value.$$typeof === REACT_ELEMENT_TYPE);
}

function legacyBuildSnapshotSignature(value, seen = new WeakSet()) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `fn:${value.name || 'anonymous'}`;
  if (typeof value === 'symbol') return value.toString();

  if (Array.isArray(value)) {
    return `[${value.map((item) => legacyBuildSnapshotSignature(item, seen)).join(',')}]`;
  }

  if (isReactElement(value)) {
    return `element:${getReactTypeName(value.type)}:${legacyBuildSnapshotSignature(value.props, seen)}`;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    const entries = Object.entries(value)
      .filter(([key]) => key !== '_owner' && key !== '_store' && key !== 'ref' && key !== 'key')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${key}:${legacyBuildSnapshotSignature(entryValue, seen)}`);

    return `{${entries.join(',')}}`;
  }

  return String(value);
}

function legacyListSnapshot(items) {
  let fullSnapshotItemWalks = 0;
  const snapshot = items.map((item) => {
    fullSnapshotItemWalks += 1;
    const actionType = item.props.actions?.type;
    const actionName = actionType?.name || actionType?.displayName || typeof actionType || '';
    return legacyBuildSnapshotSignature({
      actionName,
      accessories: item.props.accessories,
      detail: item.props.detail,
      icon: item.props.icon,
      id: item.id,
      keywords: item.props.keywords,
      order: item.order,
      sectionTitle: item.sectionTitle || '',
      subtitle: item.props.subtitle,
      title: item.props.title,
    });
  }).join('|');
  return { snapshot, fullSnapshotItemWalks };
}

function legacyGridSnapshot(items) {
  let fullSnapshotItemWalks = 0;
  const snapshot = items.map((entry) => {
    fullSnapshotItemWalks += 1;
    const actionType = entry.props.actions?.type;
    const actionName = actionType?.name || actionType?.displayName || typeof actionType || '';
    const section = entry.section;
    return `${entry.id}:${entry.props.title || ''}:${section?.id || ''}:${section?.title || ''}:${actionName}`;
  }).join('|');
  return { snapshot, fullSnapshotItemWalks };
}

function measureLegacySnapshot(baseItems, nextItems, snapshotFn) {
  const beforeSnapshot = snapshotFn(baseItems).snapshot;
  const start = performance.now();
  const after = snapshotFn(nextItems);
  const durationMs = performance.now() - start;
  return {
    fullSnapshotItemWalks: after.fullSnapshotItemWalks,
    itemSignatureBuilds: 0,
    versionUpdates: after.snapshot === beforeSnapshot ? 0 : 1,
    durationMs: Number(durationMs.toFixed(3)),
  };
}

function measurePerItemSignatures(baseItems, nextItems, signatureFn) {
  const signatureById = new Map(baseItems.map((item) => [item.id, signatureFn(item)]));
  let itemSignatureBuilds = 0;
  let visibleChanges = 0;
  const start = performance.now();
  for (const item of nextItems) {
    itemSignatureBuilds += 1;
    const nextSignature = signatureFn(item);
    if (signatureById.get(item.id) !== nextSignature) {
      visibleChanges += 1;
      signatureById.set(item.id, nextSignature);
    }
  }
  const durationMs = performance.now() - start;
  return {
    fullSnapshotItemWalks: 0,
    itemSignatureBuilds,
    versionUpdates: visibleChanges > 0 ? 1 : 0,
    visibleChanges,
    durationMs: Number(durationMs.toFixed(3)),
  };
}

function collectMetrics() {
  const listBaseItems = Array.from({ length: ITEM_COUNT }, (_, index) => makeListItem(index));
  const listEquivalentItems = Array.from({ length: ITEM_COUNT }, (_, index) => makeListItem(index));
  const listSingleEquivalentItems = listBaseItems.slice();
  listSingleEquivalentItems[ITEM_COUNT - 1] = makeListItem(ITEM_COUNT - 1);
  const listOneTitleChange = Array.from({ length: ITEM_COUNT }, (_, index) => (
    index === ITEM_COUNT - 1
      ? makeListItem(index, { props: { title: { value: `Changed ${index}`, tooltip: `Emoji title ${index}` } } })
      : makeListItem(index)
  ));

  const gridBaseItems = Array.from({ length: ITEM_COUNT }, (_, index) => makeGridItem(index));
  const gridEquivalentItems = Array.from({ length: ITEM_COUNT }, (_, index) => makeGridItem(index));
  const gridSingleEquivalentItems = gridBaseItems.slice();
  gridSingleEquivalentItems[ITEM_COUNT - 1] = makeGridItem(ITEM_COUNT - 1);
  const gridOneContentChange = Array.from({ length: ITEM_COUNT }, (_, index) => (
    index === ITEM_COUNT - 1
      ? makeGridItem(index, { props: { content: { source: `changed-${index}.png`, tintColor: 'red' } } })
      : makeGridItem(index)
  ));

  return {
    itemCount: ITEM_COUNT,
    list: {
      singleRecreatedEquivalent: {
        before: measureLegacySnapshot(listBaseItems, listSingleEquivalentItems, legacyListSnapshot),
        after: measurePerItemSignatures(listBaseItems, [makeListItem(ITEM_COUNT - 1)], listHooks.buildListItemVisibleSignature),
      },
      recreatedEquivalent: {
        before: measureLegacySnapshot(listBaseItems, listEquivalentItems, legacyListSnapshot),
        after: measurePerItemSignatures(listBaseItems, listEquivalentItems, listHooks.buildListItemVisibleSignature),
      },
      oneVisibleChange: {
        before: measureLegacySnapshot(listBaseItems, listOneTitleChange, legacyListSnapshot),
        after: measurePerItemSignatures(listBaseItems, listOneTitleChange, listHooks.buildListItemVisibleSignature),
      },
    },
    grid: {
      singleRecreatedEquivalent: {
        before: measureLegacySnapshot(gridBaseItems, gridSingleEquivalentItems, legacyGridSnapshot),
        after: measurePerItemSignatures(gridBaseItems, [makeGridItem(ITEM_COUNT - 1)], gridHooks.buildGridItemVisibleSignature),
      },
      recreatedEquivalent: {
        before: measureLegacySnapshot(gridBaseItems, gridEquivalentItems, legacyGridSnapshot),
        after: measurePerItemSignatures(gridBaseItems, gridEquivalentItems, gridHooks.buildGridItemVisibleSignature),
      },
      oneVisibleChange: {
        before: measureLegacySnapshot(gridBaseItems, gridOneContentChange, legacyGridSnapshot),
        after: measurePerItemSignatures(gridBaseItems, gridOneContentChange, gridHooks.buildGridItemVisibleSignature),
      },
    },
  };
}

function expectSignatureChange(signatureFn, base, next, label) {
  assert.notEqual(signatureFn(base), signatureFn(next), `${label} should change the visible signature`);
}

if (process.argv.includes('--report')) {
  console.log(JSON.stringify(collectMetrics(), null, 2));
} else {
  test('List item visible signatures ignore recreated equivalent props and catch visible fields', () => {
    const base = makeListItem(7);
    assert.equal(listHooks.buildListItemVisibleSignature(base), listHooks.buildListItemVisibleSignature(makeListItem(7)));

    expectSignatureChange(listHooks.buildListItemVisibleSignature, base, makeListItem(7, { props: { title: 'Changed' } }), 'title');
    expectSignatureChange(listHooks.buildListItemVisibleSignature, base, makeListItem(7, { props: { subtitle: 'Changed' } }), 'subtitle');
    expectSignatureChange(listHooks.buildListItemVisibleSignature, base, makeListItem(7, { props: { icon: '\u{1F680}' } }), 'icon');
    expectSignatureChange(listHooks.buildListItemVisibleSignature, base, makeListItem(7, { props: { accessories: [{ text: 'Changed' }] } }), 'accessories');
    expectSignatureChange(listHooks.buildListItemVisibleSignature, base, makeListItem(7, { props: { keywords: ['changed'] } }), 'keywords');
    expectSignatureChange(listHooks.buildListItemVisibleSignature, base, makeListItem(7, { props: { detail: makeElement('ListItemDetail', { markdown: 'Changed' }) } }), 'detail');
    expectSignatureChange(listHooks.buildListItemVisibleSignature, base, makeListItem(7, { props: { quickLook: { path: '/tmp/changed.png' } } }), 'quickLook');
    expectSignatureChange(listHooks.buildListItemVisibleSignature, base, makeListItem(7, { props: { actions: makeElement('DifferentActionPanel') } }), 'action type');
    expectSignatureChange(listHooks.buildListItemVisibleSignature, base, makeListItem(7, { sectionTitle: 'Changed section' }), 'section');
    expectSignatureChange(listHooks.buildListItemVisibleSignature, base, makeListItem(7, { order: 999 }), 'order');
  });

  test('Grid item visible signatures ignore recreated equivalent props and catch visible fields', () => {
    const base = makeGridItem(9);
    assert.equal(gridHooks.buildGridItemVisibleSignature(base), gridHooks.buildGridItemVisibleSignature(makeGridItem(9)));

    expectSignatureChange(gridHooks.buildGridItemVisibleSignature, base, makeGridItem(9, { props: { title: 'Changed' } }), 'title');
    expectSignatureChange(gridHooks.buildGridItemVisibleSignature, base, makeGridItem(9, { props: { subtitle: 'Changed' } }), 'subtitle');
    expectSignatureChange(gridHooks.buildGridItemVisibleSignature, base, makeGridItem(9, { props: { content: { source: 'changed.png' } } }), 'content');
    expectSignatureChange(gridHooks.buildGridItemVisibleSignature, base, makeGridItem(9, { props: { accessory: { tooltip: 'Changed' } } }), 'accessory');
    expectSignatureChange(gridHooks.buildGridItemVisibleSignature, base, makeGridItem(9, { props: { keywords: ['changed'] } }), 'keywords');
    expectSignatureChange(gridHooks.buildGridItemVisibleSignature, base, makeGridItem(9, { props: { quickLook: { path: '/tmp/changed.png' } } }), 'quickLook');
    expectSignatureChange(gridHooks.buildGridItemVisibleSignature, base, makeGridItem(9, { props: { actions: makeElement('DifferentActionPanel') } }), 'action type');
    expectSignatureChange(gridHooks.buildGridItemVisibleSignature, base, makeGridItem(9, { section: { id: 'changed-section', title: 'Changed section' } }), 'section');
    expectSignatureChange(gridHooks.buildGridItemVisibleSignature, base, makeGridItem(9, { order: 999 }), 'order');
  });

  test('Registry dirty-check metrics avoid full-registry walks for recreated equivalent props', () => {
    const metrics = collectMetrics();

    assert.equal(metrics.list.singleRecreatedEquivalent.before.fullSnapshotItemWalks, ITEM_COUNT);
    assert.equal(metrics.list.singleRecreatedEquivalent.after.fullSnapshotItemWalks, 0);
    assert.equal(metrics.list.singleRecreatedEquivalent.after.itemSignatureBuilds, 1);
    assert.equal(metrics.list.singleRecreatedEquivalent.after.versionUpdates, 0);
    assert.equal(metrics.list.recreatedEquivalent.before.fullSnapshotItemWalks, ITEM_COUNT);
    assert.equal(metrics.list.recreatedEquivalent.after.fullSnapshotItemWalks, 0);
    assert.equal(metrics.list.recreatedEquivalent.before.versionUpdates, 0);
    assert.equal(metrics.list.recreatedEquivalent.after.versionUpdates, 0);
    assert.equal(metrics.list.oneVisibleChange.before.versionUpdates, 1);
    assert.equal(metrics.list.oneVisibleChange.after.versionUpdates, 1);

    assert.equal(metrics.grid.singleRecreatedEquivalent.before.fullSnapshotItemWalks, ITEM_COUNT);
    assert.equal(metrics.grid.singleRecreatedEquivalent.after.fullSnapshotItemWalks, 0);
    assert.equal(metrics.grid.singleRecreatedEquivalent.after.itemSignatureBuilds, 1);
    assert.equal(metrics.grid.singleRecreatedEquivalent.after.versionUpdates, 0);
    assert.equal(metrics.grid.recreatedEquivalent.before.fullSnapshotItemWalks, ITEM_COUNT);
    assert.equal(metrics.grid.recreatedEquivalent.after.fullSnapshotItemWalks, 0);
    assert.equal(metrics.grid.recreatedEquivalent.before.versionUpdates, 0);
    assert.equal(metrics.grid.recreatedEquivalent.after.versionUpdates, 0);
    assert.equal(metrics.grid.oneVisibleChange.after.versionUpdates, 1);

    console.log(JSON.stringify({ mode: 'registry-dirty-checks', metrics }, null, 2));
  });
}
