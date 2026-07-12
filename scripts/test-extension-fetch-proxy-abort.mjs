#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importTs } from './lib/ts-import.mjs';

const { installExtensionFetchBridge } = await importTs(path.resolve('src/renderer/src/extension-fetch-bridge.ts'));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createTrackedAbortSignal() {
  const listeners = new Set();
  return {
    signal: {
      aborted: false,
      addCount: 0,
      removeCount: 0,
      addEventListener(type, listener) {
        if (type !== 'abort') return;
        this.addCount += 1;
        listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type !== 'abort') return;
        this.removeCount += 1;
        listeners.delete(listener);
      },
    },
    listenerCount: () => listeners.size,
    abort() {
      this.signal.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

function createBridgeHarness() {
  const pending = [];
  const binaryPending = [];
  const requests = [];
  const binaryRequests = [];
  const canceled = [];
  const g = {
    crypto: { randomUUID: () => `uuid-${requests.length + 1}` },
    fetch: async () => new Response('native'),
  };
  const electron = {
    httpRequest: (request) => {
      requests.push(request);
      const run = deferred();
      pending.push(run);
      return run.promise;
    },
    cancelHttpRequest: (requestId) => {
      canceled.push(requestId);
    },
    httpDownloadBinary: (url, requestId) => {
      binaryRequests.push({ url, requestId });
      const run = deferred();
      binaryPending.push(run);
      return run.promise;
    },
  };
  installExtensionFetchBridge(g, () => electron);
  return { binaryPending, binaryRequests, canceled, g, pending, requests };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

test('extension fetch abort sends IPC cancel and removes its abort listener on completion', async () => {
  const { canceled, g, pending, requests } = createBridgeHarness();
  const abort = createTrackedAbortSignal();

  const fetchPromise = g.fetch('https://api.test/slow', { signal: abort.signal });
  await flushAsync();

  assert.equal(requests.length, 1);
  assert.match(requests[0].requestId, /^extensionFetch:/);
  assert.equal(abort.listenerCount(), 1);
  assert.equal(abort.signal.addCount, 1);

  abort.abort();
  abort.abort();
  assert.deepEqual(canceled, [requests[0].requestId]);

  pending[0].resolve({
    status: 0,
    statusText: 'Request canceled',
    headers: {},
    bodyText: '',
    url: 'https://api.test/slow',
  });

  await assert.rejects(fetchPromise, { name: 'AbortError' });
  assert.equal(abort.listenerCount(), 0);
  assert.equal(abort.signal.removeCount, 1);
});

test('extension fetch success path clears abort listener and does not retain request IDs', async () => {
  const { canceled, g, pending, requests } = createBridgeHarness();
  const abort = createTrackedAbortSignal();

  const fetchPromise = g.fetch('https://api.test/items', { signal: abort.signal });
  await flushAsync();
  assert.equal(requests.length, 1);

  pending[0].resolve({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/plain' },
    bodyText: 'done',
    url: 'https://api.test/items',
  });

  const response = await fetchPromise;
  assert.equal(await response.text(), 'done');
  assert.equal(response.url, 'https://api.test/items');
  assert.deepEqual(canceled, []);
  assert.equal(abort.listenerCount(), 0);
  assert.equal(abort.signal.removeCount, 1);
});

test('extension fetch abort cancels binary follow-up and ignores stale bytes', async () => {
  const { binaryPending, binaryRequests, canceled, g, pending, requests } = createBridgeHarness();
  const abort = createTrackedAbortSignal();

  const fetchPromise = g.fetch('https://cdn.test/logo.png', { signal: abort.signal });
  await flushAsync();

  assert.equal(requests.length, 1);
  assert.equal(abort.listenerCount(), 1);

  pending[0].resolve({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'image/png' },
    bodyText: '',
    url: 'https://cdn.test/logo.png',
  });
  await flushAsync();

  assert.equal(binaryRequests.length, 1);
  assert.equal(binaryRequests[0].url, 'https://cdn.test/logo.png');
  assert.equal(binaryRequests[0].requestId, requests[0].requestId);
  assert.equal(abort.listenerCount(), 1);

  abort.abort();
  abort.abort();
  assert.deepEqual(canceled, [requests[0].requestId]);

  binaryPending[0].resolve(new Uint8Array([1, 2, 3]));

  await assert.rejects(fetchPromise, { name: 'AbortError' });
  assert.equal(abort.listenerCount(), 0);
  assert.equal(abort.signal.removeCount, 1);
});

test('extension fetch preserves fallback behavior for non-http and unsupported bodies', async () => {
  const nativeCalls = [];
  const requests = [];
  const g = {
    fetch: async (input) => {
      nativeCalls.push(String(input));
      return new Response('native');
    },
  };
  const electron = {
    httpRequest: (request) => {
      requests.push(request);
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: {},
        bodyText: 'proxied',
        url: request.url,
      });
    },
  };
  installExtensionFetchBridge(g, () => electron);

  assert.equal(await (await g.fetch('data:text/plain,hello')).text(), 'native');
  assert.equal(await (await g.fetch('https://api.test/upload', { method: 'POST', body: new FormData() })).text(), 'native');
  assert.deepEqual(nativeCalls, ['data:text/plain,hello', 'https://api.test/upload']);
  assert.deepEqual(requests, []);
});
