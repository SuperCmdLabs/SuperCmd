#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST_RUNTIME_PATH = path.join(repoRoot, 'src/renderer/src/raycast-api/list-runtime.tsx');
const CASES = [5000, 20000];

function buildGroupedItems(itemCount) {
  return [{
    title: 'Emoji',
    items: Array.from({ length: itemCount }, (_, index) => ({
      item: { id: `emoji-${index}` },
      globalIdx: index,
    })),
  }];
}

function buildFlatRows(groupedItems) {
  const rows = [];
  for (let groupIndex = 0; groupIndex < groupedItems.length; groupIndex += 1) {
    const group = groupedItems[groupIndex];
    if (group.title) rows.push({ type: 'header', title: group.title, key: `__h_${groupIndex}` });
    for (const entry of group.items) {
      rows.push({ type: 'item', item: entry.item, globalIdx: entry.globalIdx, key: entry.item.id });
    }
  }
  return rows;
}

function buildConditionalFlatRows(groupedItems, shouldUseEmojiGridValue) {
  if (shouldUseEmojiGridValue) return [];
  return buildFlatRows(groupedItems);
}

function parseListRuntimeSource() {
  return ts.createSourceFile(
    LIST_RUNTIME_PATH,
    fs.readFileSync(LIST_RUNTIME_PATH, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function isIdentifier(node, name) {
  return ts.isIdentifier(node) && node.text === name;
}

function walk(node, visitor) {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}

function findVariableDeclaration(sourceFile, name) {
  let match = null;
  walk(sourceFile, (node) => {
    if (!match && ts.isVariableDeclaration(node) && isIdentifier(node.name, name)) {
      match = node;
    }
  });
  return match;
}

function getUseMemoArguments(declaration) {
  const initializer = declaration?.initializer;
  if (!initializer || !ts.isCallExpression(initializer) || !isIdentifier(initializer.expression, 'useMemo')) {
    return { callback: null, deps: null };
  }
  const [callback, deps] = initializer.arguments;
  return { callback, deps };
}

function returnsEmptyArray(statement) {
  if (ts.isReturnStatement(statement)) {
    return Boolean(statement.expression && ts.isArrayLiteralExpression(statement.expression) && statement.expression.elements.length === 0);
  }
  return ts.isBlock(statement) && statement.statements.length === 1 && returnsEmptyArray(statement.statements[0]);
}

function flatRowsSkipsEmojiGrid(callback) {
  const body = callback?.body;
  if (!body || !ts.isBlock(body)) return false;
  const firstStatement = body.statements[0];
  return Boolean(
    firstStatement &&
    ts.isIfStatement(firstStatement) &&
    isIdentifier(firstStatement.expression, 'shouldUseEmojiGridValue') &&
    returnsEmptyArray(firstStatement.thenStatement)
  );
}

function dependencyArrayIncludes(deps, name) {
  return Boolean(
    deps &&
    ts.isArrayLiteralExpression(deps) &&
    deps.elements.some((element) => isIdentifier(element, name))
  );
}

function selectorTargetsSelectedIndex(argument) {
  if (!argument) return false;
  if (ts.isNoSubstitutionTemplateLiteral(argument) || ts.isStringLiteral(argument)) {
    return argument.text.includes('data-idx') && argument.text.includes('selectedIdx');
  }
  return Boolean(
    ts.isTemplateExpression(argument) &&
    argument.head.text.includes('data-idx') &&
    argument.templateSpans.some((span) => isIdentifier(span.expression, 'selectedIdx'))
  );
}

function hasRenderedEmojiCellScroll(sourceFile) {
  let found = false;
  walk(sourceFile, (node) => {
    if (found || !ts.isCallExpression(node)) return;
    if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'scrollIntoView') return;
    const target = node.expression.expression;
    if (!ts.isCallExpression(target)) return;
    if (!ts.isPropertyAccessExpression(target.expression) || target.expression.name.text !== 'querySelector') return;
    if (!selectorTargetsSelectedIndex(target.arguments[0])) return;
    found = true;
  });
  return found;
}

function analyzeListRuntimeSource() {
  const sourceFile = parseListRuntimeSource();
  const flatRowsDeclaration = findVariableDeclaration(sourceFile, 'flatRows');
  const { callback, deps } = getUseMemoArguments(flatRowsDeclaration);
  return {
    skipsFlatRowsForEmojiGrid: flatRowsSkipsEmojiGrid(callback),
    tracksEmojiGridDependency:
      dependencyArrayIncludes(deps, 'groupedItems') &&
      dependencyArrayIncludes(deps, 'shouldUseEmojiGridValue'),
    scrollsRenderedEmojiCell: hasRenderedEmojiCellScroll(sourceFile),
  };
}

function measureAvoidedRows() {
  return CASES.map((itemCount) => {
    const groupedItems = buildGroupedItems(itemCount);
    const oldEmojiRows = buildFlatRows(groupedItems);
    const newEmojiRows = buildConditionalFlatRows(groupedItems, true);
    const oldNormalRows = buildFlatRows(groupedItems);
    const newNormalRows = buildConditionalFlatRows(groupedItems, false);

    return {
      itemCount,
      oldEmojiRowCount: oldEmojiRows.length,
      newEmojiRowCount: newEmojiRows.length,
      avoidedEmojiRows: oldEmojiRows.length - newEmojiRows.length,
      normalRowCountPreserved: oldNormalRows.length === newNormalRows.length,
    };
  });
}

test('list runtime skips unused linear rows for emoji-grid mode', () => {
  const source = analyzeListRuntimeSource();
  assert.equal(source.skipsFlatRowsForEmojiGrid, true, 'flat row construction should short-circuit in emoji-grid mode');
  assert.equal(source.tracksEmojiGridDependency, true, 'flat row memo should update when the layout mode changes');
  assert.equal(source.scrollsRenderedEmojiCell, true, 'emoji-grid selection should still scroll the rendered selected cell');

  const measurements = measureAvoidedRows();
  for (const measurement of measurements) {
    assert.equal(measurement.newEmojiRowCount, 0, `${measurement.itemCount} emoji items should not build linear rows`);
    assert.equal(measurement.avoidedEmojiRows, measurement.oldEmojiRowCount);
    assert.equal(measurement.normalRowCountPreserved, true, 'normal list row count should be unchanged');
  }
});

if (process.argv.includes('--report')) {
  console.log(JSON.stringify({ listConditionalVirtualRows: measureAvoidedRows() }, null, 2));
}
