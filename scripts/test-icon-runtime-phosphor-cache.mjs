#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetFile = path.join(root, 'src/renderer/src/raycast-api/icon-runtime-phosphor.tsx');

async function importIconRuntimeForTest() {
  const outputFile = path.join(os.tmpdir(), `supercmd-icon-runtime-test-${process.pid}-${Date.now()}.mjs`);
  const normalizedTarget = path.normalize(targetFile);

  try {
    await build({
      entryPoints: [targetFile],
      outfile: outputFile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      jsx: 'automatic',
      logLevel: 'silent',
      plugins: [
        {
          name: 'expose-icon-runtime-test-hooks',
          setup(buildApi) {
            buildApi.onLoad({ filter: /icon-runtime-phosphor\.tsx$/ }, async (args) => {
              if (path.normalize(args.path) !== normalizedTarget) return undefined;
              const source = await fs.readFile(args.path, 'utf8');
              return {
                contents: `${source}
export const __testIconRuntimePhosphor = {
  resolvePhosphorIconFromRaycast,
  tryResolvePhosphorByName,
  clearIconResolutionCaches: () => {
    phosphorIconResolutionCache.clear();
    phosphorNameResolutionCache.clear();
    raycastIconNameResolutionCache.clear();
  },
  caches: {
    phosphorIconResolutionCache,
    phosphorNameResolutionCache,
    raycastIconNameResolutionCache,
  },
};
`,
                loader: 'tsx',
                resolveDir: path.dirname(args.path),
              };
            });
          },
        },
        {
          name: 'stub-server-rendering-for-icon-runtime-tests',
          setup(buildApi) {
            buildApi.onResolve({ filter: /^react-dom\/server$/ }, () => ({
              path: 'react-dom-server-test-stub',
              namespace: 'test-stub',
            }));
            buildApi.onLoad({ filter: /.*/, namespace: 'test-stub' }, () => ({
              contents: 'export function renderToStaticMarkup() { return ""; }',
              loader: 'js',
            }));
          },
        },
      ],
    });

    const runtime = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`);
    return runtime.__testIconRuntimePhosphor;
  } finally {
    await fs.unlink(outputFile).catch(() => {});
  }
}

test('Phosphor icon runtime resolution cache', async (t) => {
  const iconRuntime = await importIconRuntimeForTest();
  const {
    resolvePhosphorIconFromRaycast,
    tryResolvePhosphorByName,
    clearIconResolutionCaches,
    caches,
  } = iconRuntime;

  await t.test('resolves direct Raycast icon names without changing weight', () => {
    clearIconResolutionCaches();

    const expected = tryResolvePhosphorByName('MagnifyingGlass');
    const resolved = resolvePhosphorIconFromRaycast('MagnifyingGlass');

    assert.ok(expected, 'expected Phosphor MagnifyingGlass export to exist');
    assert.equal(resolved?.icon, expected);
    assert.equal(resolved?.weight, 'regular');
  });

  await t.test('preserves explicit Raycast aliases and filled weight compatibility', () => {
    clearIconResolutionCaches();

    const stopwatch = resolvePhosphorIconFromRaycast('Stopwatch');
    assert.equal(stopwatch?.icon, tryResolvePhosphorByName('Timer'));
    assert.equal(stopwatch?.weight, 'regular');

    const filled = resolvePhosphorIconFromRaycast('XMarkCircleFilled');
    assert.equal(filled?.icon, tryResolvePhosphorByName('XCircle'));
    assert.equal(filled?.weight, 'fill');
  });

  await t.test('keeps unknown icons on the existing fallback glyph', () => {
    clearIconResolutionCaches();

    const fallback = tryResolvePhosphorByName('Question') || tryResolvePhosphorByName('Circle');
    const resolved = resolvePhosphorIconFromRaycast('QzxvPqmn999');

    assert.ok(fallback, 'expected a Phosphor fallback glyph to exist');
    assert.equal(resolved?.icon, fallback);
    assert.equal(resolved?.weight, 'regular');
  });

  await t.test('caches successful and failed resolutions while allowing whole-cache clear', () => {
    clearIconResolutionCaches();

    const first = resolvePhosphorIconFromRaycast('TotallyMissingIconName');
    const second = resolvePhosphorIconFromRaycast('TotallyMissingIconName');
    assert.equal(second, first, 'repeated final resolution should return the cached result object');

    assert.equal(tryResolvePhosphorByName('DefinitelyNotAPhosphorIcon'), undefined);
    assert.equal(
      caches.phosphorNameResolutionCache.get('DefinitelyNotAPhosphorIcon'),
      null,
      'failed Phosphor export lookups are memoized as misses',
    );

    clearIconResolutionCaches();
    assert.equal(caches.phosphorIconResolutionCache.size, 0);
    assert.equal(caches.phosphorNameResolutionCache.size, 0);
    assert.equal(caches.raycastIconNameResolutionCache.size, 0);

    const afterClear = resolvePhosphorIconFromRaycast('TotallyMissingIconName');
    assert.equal(afterClear?.icon, first?.icon);
    assert.equal(afterClear?.weight, first?.weight);
  });
});
