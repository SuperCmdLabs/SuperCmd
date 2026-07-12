#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import zlib from 'node:zlib';
import { importTs } from './lib/ts-import.mjs';

const decodeSourcePath = path.resolve('src/main/http-response-decode.ts');
const { decodeHttpResponseBodyBuffer } = await importTs(decodeSourcePath, {
  browserGlobals: false,
});

function nextTimer() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('HTTP response decompression uses async zlib APIs and preserves decoded text', async () => {
  const source = fs.readFileSync(decodeSourcePath, 'utf8');
  assert.equal(/(?:brotliDecompressSync|gunzipSync|inflateSync)/.test(source), false);

  const fixtureText = 'supercmd-compressed-fixture\n'.repeat(350_000);
  const fixture = Buffer.from(fixtureText, 'utf8');
  const gzipFixture = zlib.gzipSync(fixture);

  const syncTimerStart = performance.now();
  const syncTimer = nextTimer().then(() => performance.now() - syncTimerStart);
  zlib.gunzipSync(gzipFixture);
  const syncTimerDelayMs = await syncTimer;

  const asyncTimerStart = performance.now();
  const asyncTimer = nextTimer().then(() => performance.now() - asyncTimerStart);
  const decodedPromise = decodeHttpResponseBodyBuffer(gzipFixture, 'gzip');
  const asyncTimerDelayMs = await asyncTimer;
  const decoded = await decodedPromise;

  assert.equal(decoded.toString('utf8'), fixtureText);
  console.log(JSON.stringify({
    fixtureBytes: fixture.length,
    gzipBytes: gzipFixture.length,
    syncTimerDelayMs: Number(syncTimerDelayMs.toFixed(3)),
    asyncTimerDelayMs: Number(asyncTimerDelayMs.toFixed(3)),
  }));
});
