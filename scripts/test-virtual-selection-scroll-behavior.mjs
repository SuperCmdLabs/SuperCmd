#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sourceWindow(source, anchor, radius = 900) {
  const index = source.indexOf(anchor);
  assert.notEqual(index, -1, `Expected to find source anchor: ${anchor}`);
  return source.slice(Math.max(0, index - radius), Math.min(source.length, index + anchor.length + radius));
}

test('selected-item scrolls do not queue smooth animations', () => {
  const listSelectionScroll = sourceWindow(
    readRepoFile('src/renderer/src/raycast-api/list-runtime.tsx'),
    'const rowIdx = itemIdxToRowIdxRef.current[selectedIdx]'
  );
  assert.match(
    listSelectionScroll,
    /el\.scrollTo\(\{\s*top,\s*behavior:\s*'auto'\s*\}\);/,
    'Raycast list selection correction should scroll instantly to the selected virtual row'
  );
  assert.match(
    listSelectionScroll,
    /el\.scrollTo\(\{\s*top:\s*top \+ rowH - el\.clientHeight,\s*behavior:\s*'auto'\s*\}\);/,
    'Raycast list selection correction should scroll instantly when the selected virtual row is below the viewport'
  );
  assert.doesNotMatch(
    listSelectionScroll,
    /querySelector<HTMLElement>\(`\[data-idx="\$\{selectedIdx\}"\]`\)/,
    'Raycast list selection correction must not rely on virtualized selected cells being mounted'
  );
  assert.doesNotMatch(
    listSelectionScroll,
    /scrollIntoView/,
    'Raycast list selection correction must use virtual row offsets for large jumps'
  );
  assert.doesNotMatch(
    listSelectionScroll,
    /behavior:\s*['"]smooth['"]/,
    'Raycast list selection correction must not queue smooth scroll animations'
  );

  const gridSelectionScroll = sourceWindow(
    readRepoFile('src/renderer/src/raycast-api/grid-runtime.tsx'),
    'querySelector(`[data-idx="${selectedIdx}"]`)'
  );
  assert.match(
    gridSelectionScroll,
    /scrollIntoView\(\{\s*block:\s*'nearest',\s*behavior:\s*'auto'\s*\}\);/,
    'Raycast grid selection correction should scroll instantly'
  );
  assert.doesNotMatch(
    gridSelectionScroll,
    /behavior:\s*['"]smooth['"]/,
    'Raycast grid selection correction must not queue smooth scroll animations'
  );

  const launcherSelectionScroll = sourceWindow(
    readRepoFile('src/renderer/src/App.tsx'),
    'const selectedElement = itemRefs.current[selectedIndex]'
  );
  assert.match(
    launcherSelectionScroll,
    /selectedElement\.scrollIntoView\(\{\s*block:\s*['"](?:start|end)['"],\s*behavior:\s*'auto'\s*\}\);/,
    'Launcher command list selected-row correction should scroll instantly'
  );
  assert.doesNotMatch(
    launcherSelectionScroll,
    /behavior:\s*['"]smooth['"]/,
    'Launcher command list selected-row correction must not queue smooth scroll animations'
  );
});
