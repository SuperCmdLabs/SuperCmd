#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { importTs } from './lib/ts-import.mjs';

async function importCanvasStore(root) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supercmd-canvas-store-bundle-'));
  const bundlePath = path.join(tmpDir, 'canvas-store.mjs');
  try {
    await esbuild.build({
      entryPoints: [path.join(root, 'src/main/canvas-store.ts')],
      outfile: bundlePath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
      plugins: [{
        name: 'electron-test-stub',
        setup(build) {
          build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron-test-stub', namespace: 'electron-test-stub' }));
          build.onLoad({ filter: /.*/, namespace: 'electron-test-stub' }, () => ({
            loader: 'js',
            contents: `
              export const app = { getPath: () => process.env.SUPERCMD_TEST_USER_DATA || process.cwd() };
              export const dialog = { showSaveDialog: async () => ({ canceled: true }) };
              export class BrowserWindow {}
            `,
          }));
        },
      }],
    });
    return await import(pathToFileURL(bundlePath).href);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

test('canvas sc-asset serving helpers', async (t) => {
  const root = process.cwd();
  const protocol = await importTs(path.join(root, 'src/main/sc-asset-protocol.ts'));

  await t.test('resolves canvas-lib files under the library root with content and cache headers', () => {
    const canvasLibDir = path.join(os.tmpdir(), 'supercmd canvas lib');
    const resolved = protocol.resolveCanvasLibAssetRequest(
      'sc-asset://canvas-lib/nested/excalidraw-bundle.js',
      canvasLibDir
    );

    assert.equal(resolved.ok, true);
    assert.equal(resolved.asset.filePath, path.join(canvasLibDir, 'nested', 'excalidraw-bundle.js'));
    assert.equal(resolved.asset.headers['Content-Type'], 'application/javascript');
    assert.equal(resolved.asset.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  });

  await t.test('assigns expected content types and falls back to octet-stream', () => {
    assert.equal(protocol.getCanvasLibAssetContentType('/tmp/style.css'), 'text/css');
    assert.equal(protocol.getCanvasLibAssetContentType('/tmp/icon.svg'), 'image/svg+xml');
    assert.equal(protocol.getCanvasLibAssetContentType('/tmp/font.woff2'), 'font/woff2');
    assert.equal(protocol.getCanvasLibAssetContentType('/tmp/file.bin'), 'application/octet-stream');
  });

  await t.test('rejects empty, malformed, and escaping canvas-lib paths', async () => {
    const canvasLibDir = path.join(os.tmpdir(), 'supercmd-canvas-lib');

    const empty = protocol.resolveCanvasLibAssetRequest('sc-asset://canvas-lib/', canvasLibDir);
    assert.equal(empty.ok, false);
    assert.equal(empty.response.status, 400);

    const malformed = protocol.resolveCanvasLibAssetRequest('not a url', canvasLibDir);
    assert.equal(malformed.ok, false);
    assert.equal(malformed.response.status, 400);

    const badEscape = protocol.resolveCanvasLibAssetRequest('sc-asset://canvas-lib/%E0%A4%A', canvasLibDir);
    assert.equal(badEscape.ok, false);
    assert.equal(badEscape.response.status, 400);

    const traversal = protocol.resolveCanvasLibAssetRequest('sc-asset://canvas-lib/%2e%2e%2foutside.js', canvasLibDir);
    assert.equal(traversal.ok, false);
    assert.equal(traversal.response.status, 404);
  });

  await t.test('serves through the provided file fetcher without buffering in the helper', async () => {
    const canvasLibDir = path.join(os.tmpdir(), 'supercmd canvas lib');
    let fetchedUrl = '';

    const response = await protocol.serveCanvasLibAssetFromFile(
      'sc-asset://canvas-lib/excalidraw-bundle.css',
      canvasLibDir,
      async (fileUrl) => {
        fetchedUrl = fileUrl;
        return new Response('css body', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
    );

    assert.equal(fetchedUrl, pathToFileURL(path.join(canvasLibDir, 'excalidraw-bundle.css')).toString());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'text/css');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.equal(await response.text(), 'css body');
  });

  await t.test('returns 404 when the file-backed fetch fails or misses', async () => {
    const canvasLibDir = path.join(os.tmpdir(), 'supercmd-canvas-lib');

    const missing = await protocol.serveCanvasLibAssetFromFile(
      'sc-asset://canvas-lib/missing.js',
      canvasLibDir,
      async () => new Response('', { status: 404 })
    );
    assert.equal(missing.status, 404);

    const failed = await protocol.serveCanvasLibAssetFromFile(
      'sc-asset://canvas-lib/missing.js',
      canvasLibDir,
      async () => {
        throw new Error('missing');
      }
    );
    assert.equal(failed.status, 404);
  });
});

test('canvas store async scene and thumbnail reads', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supercmd-canvas-store-'));
  const previousUserData = process.env.SUPERCMD_TEST_USER_DATA;
  process.env.SUPERCMD_TEST_USER_DATA = tmpDir;

  try {
    const root = process.cwd();
    const store = await importCanvasStore(root);
    const dataDir = path.join(tmpDir, 'canvas', 'data');
    await fs.mkdir(dataDir, { recursive: true });

    const scene = {
      elements: [{ id: 'a' }],
      appState: { viewBackgroundColor: '#fff' },
      files: { image: { id: 'image' } },
    };
    await fs.writeFile(path.join(dataDir, 'scene-id.excalidraw'), JSON.stringify(scene), 'utf-8');
    await fs.writeFile(path.join(dataDir, 'scene-id.thumb.svg'), '<svg></svg>', 'utf-8');
    await fs.writeFile(path.join(dataDir, 'invalid.excalidraw'), '{', 'utf-8');

    await assert.doesNotReject(store.getSceneAsync('scene-id'));
    assert.deepEqual(await store.getSceneAsync('scene-id'), scene);
    assert.deepEqual(await store.getSceneAsync('missing-id'), { elements: [], appState: {}, files: {} });

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await store.getSceneAsync('invalid'), { elements: [], appState: {}, files: {} });
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(await store.getThumbnailAsync('scene-id'), '<svg></svg>');
    assert.equal(await store.getThumbnailAsync('missing-id'), null);
  } finally {
    if (previousUserData === undefined) {
      delete process.env.SUPERCMD_TEST_USER_DATA;
    } else {
      process.env.SUPERCMD_TEST_USER_DATA = previousUserData;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
