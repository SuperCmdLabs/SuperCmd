#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(repoRoot, 'src/renderer/src/raycast-api/menubar-runtime-parent.tsx'), 'utf8');

test('MenuBarExtra renderer reuses serialized items for title-only ticks', () => {
  assert.match(source, /type SerializedMenuBarItemsCache = \{[\s\S]*registryVersion: number;[\s\S]*assetsPath: string;[\s\S]*items: any\[\];[\s\S]*actions: Map<string, \(\) => void>;/);
  assert.match(source, /const serializedItemsCacheRef = useRef<SerializedMenuBarItemsCache \| null>\(null\);/);
  assert.match(source, /cachedItems\?\.registryVersion === registryVersion[\s\S]*cachedItems\.assetsPath === assetsPath/);
  assert.match(source, /actions = cachedItems\.actions;[\s\S]*dividedSerialized = cachedItems\.items;/);
  assert.match(source, /serializedItemsCacheRef\.current = \{[\s\S]*registryVersion,[\s\S]*assetsPath,[\s\S]*actions,[\s\S]*items: dividedSerialized,[\s\S]*\};/);
});

test('MenuBarExtra renderer still installs actions before sending payloads', () => {
  const setActionsIndex = source.indexOf('setMenuBarActions(extId, actions');
  const updateIndex = source.indexOf('updateMenuBar?.(payload)');
  assert.notEqual(setActionsIndex, -1, 'expected setMenuBarActions call');
  assert.notEqual(updateIndex, -1, 'expected updateMenuBar call');
  assert.ok(setActionsIndex < updateIndex, 'actions should be refreshed before visible payload send');
});
