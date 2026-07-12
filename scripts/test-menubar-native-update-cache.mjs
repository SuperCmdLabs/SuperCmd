#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(repoRoot, 'src/main/main.ts'), 'utf8');

test('native menubar skips unchanged file-backed tray image refreshes', () => {
  assert.match(source, /const menuBarTrayUpdateStates = new Map/);
  assert.match(source, /function getMenuBarTrayIconKey\(data: any\): string/);
  assert.match(source, /function getMenuBarFileIconIdentityKey\(iconPath: unknown\): string \| null/);
  assert.match(source, /statSync\(pathValue\)/);
  assert.match(source, /mtimeMs=\$\{mtimeMs\}\|bytes=\$\{size\}/);
  assert.match(source, /updateState\.iconKey !== nextIconKey \|\| updateState\.iconFileIdentityKey !== nextIconFileIdentityKey/);
});

test('native menubar preserves title fallback state when image refresh is skipped', () => {
  assert.match(source, /lastResolvedTrayIconOk: boolean/);
  assert.match(source, /let lastResolvedTrayIconOk = updateState\.lastResolvedTrayIconOk;/);
  assert.match(source, /updateState\.lastResolvedTrayIconOk = lastResolvedTrayIconOk;/);
  assert.match(source, /menuBarTrayUpdateStates\.delete\(extId\);/);
});
