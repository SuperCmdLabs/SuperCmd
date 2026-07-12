#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadBundledRuntime() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supercmd-i18n-runtime-'));
  const outfile = path.join(tempDir, 'runtime.mjs');
  await build({
    entryPoints: [path.join(root, 'src/renderer/src/i18n/runtime.ts')],
    outfile,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    loader: {
      '.json': 'json',
    },
    logLevel: 'silent',
  });

  return import(`${pathToFileURL(outfile).href}?${Date.now()}`);
}

test('locale catalogs load asynchronously and fall back to English before loading', async () => {
  const runtime = await loadBundledRuntime();

  assert.equal(runtime.isAppLocaleLoaded('en'), true);
  assert.equal(runtime.isAppLocaleLoaded('de'), false);
  assert.equal(runtime.translateMessage('de', 'settings.general.language.title'), 'Language');

  await runtime.loadAppLocale('de');

  assert.equal(runtime.isAppLocaleLoaded('de'), true);
  assert.equal(runtime.translateMessage('de', 'settings.general.language.title'), 'Sprache');
});

test('English fallback preserves interpolation for unloaded locales', async () => {
  const runtime = await loadBundledRuntime();

  assert.equal(
    runtime.translateMessage('fr', 'settings.general.about.version', { version: '1.2.3' }),
    'SuperCmd v1.2.3'
  );
});
