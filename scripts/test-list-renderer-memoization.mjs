#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listRenderersPath = path.join(repoRoot, 'src/renderer/src/raycast-api/list-runtime-renderers.tsx');

async function importListRendererAssertions() {
  const tmpDir = await fs.mkdtemp(path.join(repoRoot, '.list-renderer-memo-test-'));
  const entryPath = path.join(tmpDir, 'entry.tsx');
  const bundlePath = path.join(tmpDir, 'bundle.mjs');

  await fs.writeFile(entryPath, `
import React from 'react';
import assert from 'node:assert/strict';
import { createListRenderers } from ${JSON.stringify(listRenderersPath)};

function renderIcon(icon: any, className?: string, assetsPath?: string) {
  const label = typeof icon === 'string' ? icon : typeof icon?.source === 'string' ? icon.source : 'icon';
  return <span className={className} data-assets-path={assetsPath || ''}>{label}</span>;
}

const { ListItemRenderer, ListEmojiGridItemRenderer } = createListRenderers({
  renderIcon,
  resolveTintColor: (value?: string) => value || undefined,
  resolveReadableTintColor: (value?: string) => value || undefined,
  addHexAlpha: (hex: string, alphaHex: string) => \`\${hex}\${alphaHex}\`,
});

const listCompare = (ListItemRenderer as any).compare;
const emojiCompare = (ListEmojiGridItemRenderer as any).compare;
const renderListItem = (ListItemRenderer as any).type;
const renderEmojiItem = (ListEmojiGridItemRenderer as any).type;

export function assertMemoComparators() {
  assert.equal(typeof listCompare, 'function', 'ListItemRenderer should expose a React.memo comparator');
  assert.equal(typeof emojiCompare, 'function', 'ListEmojiGridItemRenderer should expose a React.memo comparator');
  assert.equal(typeof renderListItem, 'function', 'ListItemRenderer should keep its render function');
  assert.equal(typeof renderEmojiItem, 'function', 'ListEmojiGridItemRenderer should keep its render function');

  const accessories = [{ text: 'Meta', icon: 'Icon.Tag' }];
  const baseListProps = {
    title: 'Title',
    subtitle: 'Subtitle',
    icon: 'Icon.Document',
    accessories,
    assetsPath: '/assets',
    isSelected: false,
    dataIdx: 2,
    onSelect: () => {},
    onActivate: () => {},
    onContextAction: () => {},
  };
  assert.equal(
    listCompare(baseListProps, {
      ...baseListProps,
      onSelect: () => {},
      onActivate: () => {},
      onContextAction: () => {},
    }),
    true,
    'ListItemRenderer should ignore handler identity churn',
  );
  for (const [name, nextProps] of [
    ['title', { ...baseListProps, title: 'Next Title' }],
    ['subtitle', { ...baseListProps, subtitle: 'Next Subtitle' }],
    ['icon', { ...baseListProps, icon: 'Icon.Folder' }],
    ['accessories', { ...baseListProps, accessories: [{ text: 'Next Meta' }] }],
    ['assetsPath', { ...baseListProps, assetsPath: '/next-assets' }],
    ['isSelected', { ...baseListProps, isSelected: true }],
    ['dataIdx', { ...baseListProps, dataIdx: 3 }],
  ] as const) {
    assert.equal(listCompare(baseListProps, nextProps), false, \`ListItemRenderer should update when \${name} changes\`);
  }

  const baseEmojiProps = {
    icon: '😀',
    title: 'Smile',
    isSelected: false,
    dataIdx: 4,
    onSelect: () => {},
    onActivate: () => {},
    onContextAction: () => {},
  };
  assert.equal(
    emojiCompare(baseEmojiProps, {
      ...baseEmojiProps,
      onSelect: () => {},
      onActivate: () => {},
      onContextAction: () => {},
    }),
    true,
    'ListEmojiGridItemRenderer should ignore handler identity churn',
  );
  for (const [name, nextProps] of [
    ['icon', { ...baseEmojiProps, icon: '🚀' }],
    ['title', { ...baseEmojiProps, title: 'Rocket' }],
    ['isSelected', { ...baseEmojiProps, isSelected: true }],
    ['dataIdx', { ...baseEmojiProps, dataIdx: 5 }],
  ] as const) {
    assert.equal(emojiCompare(baseEmojiProps, nextProps), false, \`ListEmojiGridItemRenderer should update when \${name} changes\`);
  }
}

export function assertEventWiring() {
  let selected = 0;
  let activated = 0;
  let contexted = 0;
  const listElement = renderListItem({
    title: 'Title',
    subtitle: 'Subtitle',
    icon: 'Icon.Document',
    accessories: [{ text: 'Meta' }],
    assetsPath: '/assets',
    isSelected: true,
    dataIdx: 7,
    onSelect: () => { selected += 1; },
    onActivate: () => { activated += 1; },
    onContextAction: () => { contexted += 1; },
  });
  assert.equal(listElement.props['data-idx'], 7);
  listElement.props.onMouseMove({});
  listElement.props.onClick({});
  listElement.props.onContextMenu({});
  assert.equal(selected, 1, 'list row mouse move should call onSelect');
  assert.equal(activated, 1, 'list row click should call onActivate');
  assert.equal(contexted, 1, 'list row context menu should call onContextAction');

  let emojiSelected = 0;
  let emojiActivated = 0;
  let emojiContexted = 0;
  let prevented = 0;
  const emojiElement = renderEmojiItem({
    icon: '😀',
    title: 'Smile',
    isSelected: false,
    dataIdx: 8,
    onSelect: () => { emojiSelected += 1; },
    onActivate: () => { emojiActivated += 1; },
    onContextAction: () => { emojiContexted += 1; },
  });
  assert.equal(emojiElement.props['data-idx'], 8);
  emojiElement.props.onMouseMove({});
  emojiElement.props.onPointerDown({ button: 0, preventDefault: () => { prevented += 1; } });
  emojiElement.props.onPointerDown({ button: 1, preventDefault: () => { prevented += 1; } });
  emojiElement.props.onContextMenu({});
  assert.equal(emojiSelected, 1, 'emoji cell mouse move should call onSelect');
  assert.equal(emojiActivated, 1, 'emoji cell primary pointer down should call onActivate');
  assert.equal(prevented, 1, 'emoji cell should only prevent default for primary pointer activation');
  assert.equal(emojiContexted, 1, 'emoji cell context menu should call onContextAction');
}
`);

  try {
    await esbuild.build({
      entryPoints: [entryPath],
      outfile: bundlePath,
      absWorkingDir: repoRoot,
      bundle: true,
      format: 'esm',
      platform: 'node',
      jsx: 'automatic',
      packages: 'external',
      nodePaths: [path.join(repoRoot, 'node_modules')],
      loader: {
        '.svg': 'dataurl',
        '.png': 'dataurl',
      },
      logLevel: 'silent',
    });

    return await import(pathToFileURL(bundlePath).href);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

test('list row renderer memo comparators track visible props and ignore handler churn', async () => {
  const assertions = await importListRendererAssertions();
  assertions.assertMemoComparators();
});

test('memoized list row renderers preserve select, activate, and context-menu wiring', async () => {
  const assertions = await importListRendererAssertions();
  assertions.assertEventWiring();
});
