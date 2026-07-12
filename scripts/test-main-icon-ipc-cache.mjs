#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetFile = path.join(root, 'src/main/icon-ipc-cache.ts');
let importNonce = 0;

async function importMainIconCacheHarness() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [targetFile],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  });
  const dataUrl = [
    'data:text/javascript;base64,',
    Buffer.from(result.outputFiles[0].text).toString('base64'),
    `#main-icon-cache-${importNonce++}`,
  ].join('');
  return import(dataUrl);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeIcon(dataUrl, resizes = []) {
  return {
    isEmpty: () => false,
    resize: (options) => {
      resizes.push(options);
      return {
        toDataURL: () => dataUrl,
      };
    },
  };
}

async function resolveFileIconUncached(getFileIcon, filePath, size = 20) {
  try {
    const bucket = size <= 16 ? 'small' : size >= 64 ? 'large' : 'normal';
    const icon = await getFileIcon(filePath, { size: bucket });
    if (icon && !icon.isEmpty()) {
      return icon.resize({ width: size, height: size }).toDataURL();
    }
    return null;
  } catch {
    return null;
  }
}

async function measureFileIconCalls(api, { useCache, iterations, mode, delayMs = 1 }) {
  const filePath = '/tmp/../tmp/supercmd-main-icon.txt';
  const dataUrl = 'data:image/png;base64,file';
  let nativeCalls = 0;

  const getFileIcon = async () => {
    nativeCalls += 1;
    await delay(delayMs);
    return makeIcon(dataUrl);
  };
  const cache = api.createFileIconDataUrlCache({ getFileIcon, maxEntries: 16 });
  const resolve = useCache
    ? (requestedPath) => cache.resolve(requestedPath, 20)
    : (requestedPath) => resolveFileIconUncached(getFileIcon, requestedPath, 20);

  const startedAt = performance.now();
  if (mode === 'concurrent') {
    await Promise.all(Array.from({ length: iterations }, () => resolve(filePath)));
  } else {
    for (let index = 0; index < iterations; index += 1) {
      await resolve(filePath);
    }
  }

  return {
    nativeCalls,
    elapsedMs: performance.now() - startedAt,
  };
}

async function resolveAppIconUncached(resolveAppIconDataUrl, appPath, size = 32) {
  try {
    return resolveAppIconDataUrl(appPath, size);
  } catch {
    return null;
  }
}

async function measureAppIconCalls(api, { useCache, iterations, mode }) {
  const appPath = '/Applications/../Applications/SuperCmd.app';
  const dataUrl = 'data:image/png;base64,app';
  let nativeCalls = 0;

  const resolveAppIconDataUrl = () => {
    nativeCalls += 1;
    return dataUrl;
  };
  const cache = api.createAppIconDataUrlCache({ resolveAppIconDataUrl, maxEntries: 16 });
  const resolve = useCache
    ? (requestedPath) => cache.resolve(requestedPath, 32)
    : (requestedPath) => resolveAppIconUncached(resolveAppIconDataUrl, requestedPath, 32);

  const startedAt = performance.now();
  if (mode === 'concurrent') {
    await Promise.all(Array.from({ length: iterations }, () => resolve(appPath)));
  } else {
    for (let index = 0; index < iterations; index += 1) {
      await resolve(appPath);
    }
  }

  return {
    nativeCalls,
    elapsedMs: performance.now() - startedAt,
  };
}

test('main icon IPC cache', async (t) => {
  const api = await importMainIconCacheHarness();

  await t.test('coalesces and caches file icon data URL requests', async () => {
    const iterations = 100;
    const beforeConcurrent = await measureFileIconCalls(api, {
      useCache: false,
      iterations,
      mode: 'concurrent',
    });
    const afterConcurrent = await measureFileIconCalls(api, {
      useCache: true,
      iterations,
      mode: 'concurrent',
    });
    const beforeRepeated = await measureFileIconCalls(api, {
      useCache: false,
      iterations,
      mode: 'serial',
    });
    const afterRepeated = await measureFileIconCalls(api, {
      useCache: true,
      iterations,
      mode: 'serial',
    });

    t.diagnostic(
      `file icon native calls for ${iterations} concurrent requests: before=${beforeConcurrent.nativeCalls}, after=${afterConcurrent.nativeCalls}; elapsedMs before=${beforeConcurrent.elapsedMs.toFixed(1)}, after=${afterConcurrent.elapsedMs.toFixed(1)}`,
    );
    t.diagnostic(
      `file icon native calls for ${iterations} repeated requests: before=${beforeRepeated.nativeCalls}, after=${afterRepeated.nativeCalls}; elapsedMs before=${beforeRepeated.elapsedMs.toFixed(1)}, after=${afterRepeated.elapsedMs.toFixed(1)}`,
    );

    assert.equal(beforeConcurrent.nativeCalls, iterations);
    assert.equal(afterConcurrent.nativeCalls, 1);
    assert.equal(beforeRepeated.nativeCalls, iterations);
    assert.equal(afterRepeated.nativeCalls, 1);
  });

  await t.test('keeps file icon cache keys normalized by path, size, and bucket', async () => {
    const dataUrl = 'data:image/png;base64,file-normalized';
    const resizes = [];
    const calls = [];
    const cache = api.createFileIconDataUrlCache({
      maxEntries: 4,
      getFileIcon: async (filePath, options) => {
        calls.push({ filePath, options });
        return makeIcon(dataUrl, resizes);
      },
    });

    assert.equal(await cache.resolve('/tmp/../tmp/supercmd-normalized.txt', 20), dataUrl);
    assert.equal(await cache.resolve('/tmp/supercmd-normalized.txt', 20), dataUrl);
    assert.equal(calls.length, 1, 'normalized path alias should reuse cached data URL');

    assert.equal(await cache.resolve('/tmp/supercmd-normalized.txt', 32), dataUrl);
    assert.equal(await cache.resolve('/tmp/supercmd-normalized.txt', 16), dataUrl);
    assert.equal(calls.length, 3, 'logical size and icon bucket are part of the key');
    assert.deepEqual(calls.map((call) => call.options.size), ['normal', 'normal', 'small']);
    assert.deepEqual(resizes, [
      { width: 20, height: 20 },
      { width: 32, height: 32 },
      { width: 16, height: 16 },
    ]);
  });

  await t.test('invalidates file icon cache when source metadata changes', async () => {
    let sourceToken = 'mtime:1:size:10';
    let calls = 0;
    const cache = api.createFileIconDataUrlCache({
      getFileIconCacheToken: () => sourceToken,
      getFileIcon: async () => {
        calls += 1;
        return makeIcon(`data:image/png;base64,file-${sourceToken}`);
      },
    });

    assert.equal(await cache.resolve('/tmp/supercmd-changing-file.txt', 20), 'data:image/png;base64,file-mtime:1:size:10');
    assert.equal(await cache.resolve('/tmp/../tmp/supercmd-changing-file.txt', 20), 'data:image/png;base64,file-mtime:1:size:10');
    assert.equal(calls, 1, 'unchanged source metadata should reuse cached data URL');

    sourceToken = 'mtime:2:size:10';
    assert.equal(await cache.resolve('/tmp/supercmd-changing-file.txt', 20), 'data:image/png;base64,file-mtime:2:size:10');
    assert.equal(calls, 2, 'changed source metadata should fetch a fresh data URL');
  });

  await t.test('does not permanently cache file icon nulls or errors', async () => {
    const recoveredDataUrl = 'data:image/png;base64,file-recovered';
    let calls = 0;
    const cache = api.createFileIconDataUrlCache({
      getFileIcon: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary file icon failure');
        return makeIcon(recoveredDataUrl);
      },
    });

    assert.deepEqual(
      await Promise.all([
        cache.resolve('/tmp/supercmd-late-file.txt', 20),
        cache.resolve('/tmp/supercmd-late-file.txt', 20),
      ]),
      [null, null],
    );
    assert.equal(calls, 1);
    assert.equal(cache.stats().cacheSize, 0);

    assert.equal(await cache.resolve('/tmp/supercmd-late-file.txt', 20), recoveredDataUrl);
    assert.equal(calls, 2);
    assert.equal(cache.stats().cacheSize, 1);
    assert.equal(await cache.resolve('/tmp/supercmd-late-file.txt', 20), recoveredDataUrl);
    assert.equal(calls, 2);
  });

  await t.test('coalesces and caches app icon data URL requests', async () => {
    const iterations = 100;
    const beforeConcurrent = await measureAppIconCalls(api, {
      useCache: false,
      iterations,
      mode: 'concurrent',
    });
    const afterConcurrent = await measureAppIconCalls(api, {
      useCache: true,
      iterations,
      mode: 'concurrent',
    });
    const beforeRepeated = await measureAppIconCalls(api, {
      useCache: false,
      iterations,
      mode: 'serial',
    });
    const afterRepeated = await measureAppIconCalls(api, {
      useCache: true,
      iterations,
      mode: 'serial',
    });

    t.diagnostic(
      `app icon native calls for ${iterations} concurrent requests: before=${beforeConcurrent.nativeCalls}, after=${afterConcurrent.nativeCalls}; elapsedMs before=${beforeConcurrent.elapsedMs.toFixed(1)}, after=${afterConcurrent.elapsedMs.toFixed(1)}`,
    );
    t.diagnostic(
      `app icon native calls for ${iterations} repeated requests: before=${beforeRepeated.nativeCalls}, after=${afterRepeated.nativeCalls}; elapsedMs before=${beforeRepeated.elapsedMs.toFixed(1)}, after=${afterRepeated.elapsedMs.toFixed(1)}`,
    );

    assert.equal(beforeConcurrent.nativeCalls, iterations);
    assert.equal(afterConcurrent.nativeCalls, 1);
    assert.equal(beforeRepeated.nativeCalls, iterations);
    assert.equal(afterRepeated.nativeCalls, 1);
  });

  await t.test('shares app icon cache with sync callers and does not permanently cache nulls', async () => {
    const recoveredDataUrl = 'data:image/png;base64,app-recovered';
    let calls = 0;
    const cache = api.createAppIconDataUrlCache({
      maxEntries: 2,
      resolveAppIconDataUrl: (appPath, size) => {
        calls += 1;
        if (calls === 1) return null;
        return `${recoveredDataUrl}:${path.basename(appPath)}:${size}`;
      },
    });

    assert.deepEqual(
      await Promise.all([
        cache.resolve('/Applications/SuperCmd.app', 32),
        cache.resolve('/Applications/../Applications/SuperCmd.app', 32),
      ]),
      [null, null],
    );
    assert.equal(calls, 1);
    assert.equal(cache.stats().cacheSize, 0);

    const recovered = await cache.resolve('/Applications/SuperCmd.app', 32);
    assert.equal(recovered, `${recoveredDataUrl}:SuperCmd.app:32`);
    assert.equal(calls, 2);
    assert.equal(cache.resolveSync('/Applications/../Applications/SuperCmd.app', 32), recovered);
    assert.equal(calls, 2);
  });

  await t.test('invalidates app icon cache when app icon metadata changes', async () => {
    let sourceToken = 'plist:1:icns:1';
    let calls = 0;
    const cache = api.createAppIconDataUrlCache({
      maxEntries: 4,
      getAppIconCacheToken: () => sourceToken,
      resolveAppIconDataUrl: (appPath, size) => {
        calls += 1;
        return `data:image/png;base64,app-${sourceToken}:${path.basename(appPath)}:${size}`;
      },
    });

    assert.equal(
      await cache.resolve('/Applications/SuperCmd.app', 32),
      'data:image/png;base64,app-plist:1:icns:1:SuperCmd.app:32',
    );
    assert.equal(
      cache.resolveSync('/Applications/../Applications/SuperCmd.app', 32),
      'data:image/png;base64,app-plist:1:icns:1:SuperCmd.app:32',
    );
    assert.equal(calls, 1, 'unchanged app icon metadata should reuse cached data URL');

    sourceToken = 'plist:1:icns:2';
    assert.equal(
      cache.resolveSync('/Applications/SuperCmd.app', 32),
      'data:image/png;base64,app-plist:1:icns:2:SuperCmd.app:32',
    );
    assert.equal(calls, 2, 'changed app icon metadata should fetch a fresh data URL');
  });

  await t.test('bounds file and app icon caches with LRU eviction', async () => {
    const fileCache = api.createFileIconDataUrlCache({
      maxEntries: 2,
      getFileIcon: async (filePath) => makeIcon(`data:image/png;base64,${Buffer.from(filePath).toString('base64')}`),
    });
    await fileCache.resolve('/tmp/a.txt', 20);
    await fileCache.resolve('/tmp/b.txt', 20);
    await fileCache.resolve('/tmp/a.txt', 20);
    await fileCache.resolve('/tmp/c.txt', 20);
    const fileKeys = fileCache.stats().keys.join('\n');
    assert.equal(fileCache.stats().cacheSize, 2);
    assert.match(fileKeys, /\/tmp\/a\.txt/);
    assert.match(fileKeys, /\/tmp\/c\.txt/);
    assert.doesNotMatch(fileKeys, /\/tmp\/b\.txt/);

    const appCache = api.createAppIconDataUrlCache({
      maxEntries: 2,
      resolveAppIconDataUrl: (appPath) => `data:image/png;base64,${Buffer.from(appPath).toString('base64')}`,
    });
    assert.ok(appCache.resolveSync('/Applications/A.app', 32));
    assert.ok(appCache.resolveSync('/Applications/B.app', 32));
    assert.ok(appCache.resolveSync('/Applications/A.app', 32));
    assert.ok(appCache.resolveSync('/Applications/C.app', 32));
    const appKeys = appCache.stats().keys.join('\n');
    assert.equal(appCache.stats().cacheSize, 2);
    assert.match(appKeys, /\/Applications\/A\.app/);
    assert.match(appKeys, /\/Applications\/C\.app/);
    assert.doesNotMatch(appKeys, /\/Applications\/B\.app/);
  });
});
