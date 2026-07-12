#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { transform } from 'esbuild';

async function loadHttpDownloadBinaryHandler() {
  const source = await readFile('src/main/main.ts', 'utf-8');
  const start = source.indexOf("  ipcMain.handle('http-download-binary'");
  const end = source.indexOf('\n\n  // Write raw binary data', start);
  assert.notEqual(start, -1, 'http-download-binary handler should exist');
  assert.notEqual(end, -1, 'http-download-binary handler end marker should exist');

  const snippet = source.slice(start, end);
  const wrapper = `
    const require = globalThis.__supercmdTestRequire;
    const activeHttpRequests = new Map();
    let httpDownloadBinaryHandler;
    const ipcMain = {
      handle(channel, handler) {
        if (channel === 'http-download-binary') httpDownloadBinaryHandler = handler;
      },
    };
    ${snippet}
    export { activeHttpRequests, httpDownloadBinaryHandler };
  `;
  const { code } = await transform(wrapper, {
    loader: 'ts',
    format: 'esm',
    target: 'node20',
  });

  globalThis.__supercmdTestRequire = createRequire(import.meta.url);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return import(moduleUrl);
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function waitUntil(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('http-download-binary keeps URL-only callers working', async () => {
  const { httpDownloadBinaryHandler } = await loadHttpDownloadBinaryHandler();
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(Buffer.from([1, 2, 3, 4]));
  });
  const port = await listen(server);

  try {
    const bytes = await httpDownloadBinaryHandler({}, `http://127.0.0.1:${port}/file.bin`);
    assert.deepEqual([...bytes], [1, 2, 3, 4]);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('http-download-binary cancellation aborts transport and cleans active request map', async () => {
  const { activeHttpRequests, httpDownloadBinaryHandler } = await loadHttpDownloadBinaryHandler();
  let requestClosed = false;
  let markRequestStarted;
  const requestStarted = new Promise((resolve) => {
    markRequestStarted = resolve;
  });
  const server = createServer((req, res) => {
    markRequestStarted();
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    const interval = setInterval(() => {
      res.write(Buffer.alloc(16 * 1024));
    }, 5);
    req.on('close', () => {
      requestClosed = true;
      clearInterval(interval);
    });
  });
  const port = await listen(server);
  const requestId = 'binary-download:test-cancel';

  try {
    const downloadPromise = httpDownloadBinaryHandler(
      {},
      `http://127.0.0.1:${port}/slow.bin`,
      requestId
    );
    await waitUntil(() => activeHttpRequests.has(requestId));
    await requestStarted;

    activeHttpRequests.get(requestId)();

    await assert.rejects(downloadPromise, { name: 'AbortError' });
    await waitUntil(() => requestClosed);
    assert.equal(activeHttpRequests.has(requestId), false);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('axios binary timeout path cancels IPC request and clears its timer', async () => {
  const source = await readFile('src/renderer/src/ExtensionView.tsx', 'utf-8');
  assert.match(source, /timeoutId = setTimeout\(\(\) => \{\s*cancelDownload\(\);\s*reject\(new Error\('Binary download timed out'\)\);/s);
  assert.match(source, /finally \{\s*if \(timeoutId\) clearTimeout\(timeoutId\);/s);
  assert.match(source, /config\.signal\.removeEventListener\('abort', abortListener\);/);
});
