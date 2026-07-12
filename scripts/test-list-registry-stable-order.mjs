#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const LIST_RENDERERS_PATH = 'src/renderer/src/raycast-api/list-runtime-renderers.tsx';
const ITEM_COUNT = 1000;
const SELECTION_MOVES = 25;

function readListItemComponentSource() {
  const source = fs.readFileSync(LIST_RENDERERS_PATH, 'utf8');
  const match = source.match(/function ListItemComponent[\s\S]*?\n  }\n\n  \(ListItemComponent/);
  assert.ok(match, 'ListItemComponent source should be present');
  return match[0];
}

function getLayoutEffectDependencies(source) {
  const match = source.match(/useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[([^\]]*)\]\);/);
  assert.ok(match, 'ListItemComponent should register through useLayoutEffect');
  return match[1]
    .split(',')
    .map((dependency) => dependency.trim())
    .filter(Boolean);
}

function analyzeListRegistration(source) {
  const dependencies = getLayoutEffectDependencies(source);
  const hasSelectedActionsContext = source.includes('useContext(SelectedItemActionsContext)');
  const hasVolatileRenderOrder = /const\s+renderOrder\s*=\s*\+\+itemOrderCounter\s*;/.test(source);
  const effectDependsOnRenderOrder = dependencies.includes('renderOrder');
  const hasStableOrderRef =
    /const\s+orderRef\s*=\s*useRef<\s*number\s*\|\s*null\s*>\(null\)/.test(source) &&
    /orderRef\.current\s*===\s*null/.test(source) &&
    /orderRef\.current\s*=\s*\+\+itemOrderCounter/.test(source);

  const layoutEffectRestartsOnSelectionRender = hasSelectedActionsContext && hasVolatileRenderOrder && effectDependsOnRenderOrder;
  return {
    dependencies,
    hasSelectedActionsContext,
    hasStableOrderRef,
    hasVolatileRenderOrder,
    effectDependsOnRenderOrder,
    layoutEffectRestartsOnSelectionRender,
  };
}

function measureSelectionChurn(analysis) {
  const selectionDrivenItemRenders = ITEM_COUNT * SELECTION_MOVES;
  const layoutEffectRestarts = analysis.layoutEffectRestartsOnSelectionRender ? selectionDrivenItemRenders : 0;
  const registryDeletesOnSelection = layoutEffectRestarts;
  const registrySetsOnSelection = layoutEffectRestarts;
  return {
    itemCount: ITEM_COUNT,
    selectionMoves: SELECTION_MOVES,
    orderMode: analysis.hasStableOrderRef ? 'stable-ref' : 'render-counter',
    selectionDrivenItemRenders,
    layoutEffectRestarts,
    registryMutationsOnSelection: registryDeletesOnSelection + registrySetsOnSelection,
    registryVersionUpdatesOnSelection: analysis.layoutEffectRestartsOnSelectionRender ? SELECTION_MOVES : 0,
  };
}

function getMetrics() {
  const source = readListItemComponentSource();
  const analysis = analyzeListRegistration(source);
  return { analysis, metrics: measureSelectionChurn(analysis) };
}

if (process.argv.includes('--report')) {
  const { analysis, metrics } = getMetrics();
  console.log(JSON.stringify({ analysis, metrics }, null, 2));
} else {
  test('List item registration order is stable across selection context renders', () => {
    const { analysis, metrics } = getMetrics();
    assert.equal(analysis.hasSelectedActionsContext, true, 'List items still render selected item actions in their source context');
    assert.equal(analysis.hasStableOrderRef, true, 'List item render order should be stored in a ref like Grid items');
    assert.equal(analysis.hasVolatileRenderOrder, false, 'List items should not allocate a new order on every render');
    assert.equal(analysis.effectDependsOnRenderOrder, false, 'registration effect should not depend on render-time order');
    assert.equal(metrics.registryMutationsOnSelection, 0, 'selection changes should not unregister/register every list item');
    assert.equal(metrics.registryVersionUpdatesOnSelection, 0, 'selection changes should not publish list registry updates');
  });
}
