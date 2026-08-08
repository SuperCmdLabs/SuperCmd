#!/usr/bin/env node

// Regression test for the IME composition guard (issues #637 / #296).
// Mirrors scripts/test-exec-command-timeout-cleanup.mjs: imports the *real*
// production predicate via esbuild transpile so the test runs against the
// actual source, not a copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { isImeComposing } = await importTs(
  path.join(root, 'src/renderer/src/utils/keyboard.ts'),
);

test('isImeComposing (IME composition guard)', async (t) => {
  await t.test('treats the composition-confirming Enter (isComposing=true) as composing', () => {
    // The Enter that confirms a kana-kanji / pinyin candidate.
    assert.equal(isImeComposing({ isComposing: true }, 13), true);
  });

  await t.test('treats the legacy keyCode 229 as composing', () => {
    // Older Chromium engines report 229 instead of setting isComposing.
    assert.equal(isImeComposing({}, 229), true);
  });

  await t.test('treats a plain (non-composing) Enter as NOT composing', () => {
    assert.equal(isImeComposing({ isComposing: false }, 13), false);
  });

  await t.test('treats a non-IME key without isComposing as NOT composing', () => {
    assert.equal(isImeComposing({}, 13), false);
  });

  await t.test('tolerates a null/undefined native event', () => {
    assert.equal(isImeComposing(null, 229), true);
    assert.equal(isImeComposing(undefined, 13), false);
  });
});
