#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const fileSizeMb = Number.parseInt(process.env.SUPERCMD_CANVAS_ASSET_MB || '32', 10);
const iterations = Number.parseInt(process.env.SUPERCMD_CANVAS_ASSET_ITERATIONS || '8', 10);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-canvas-asset-delay-'));
const assetPath = path.join(tmpDir, 'asset.bin');

function summarize(histogram, elapsedMs) {
  return {
    elapsedMs: Number(elapsedMs.toFixed(3)),
    meanDelayMs: Number((histogram.mean / 1e6).toFixed(3)),
    maxDelayMs: Number((histogram.max / 1e6).toFixed(3)),
    p95DelayMs: Number((histogram.percentile(95) / 1e6).toFixed(3)),
  };
}

async function measure(label, fn) {
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  const started = performance.now();
  await fn();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const elapsedMs = performance.now() - started;
  histogram.disable();
  return { label, ...summarize(histogram, elapsedMs) };
}

async function readResponseBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return 0;
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
  }
  return bytes;
}

async function createServingServer(mode) {
  const server = http.createServer(async (_req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    if (mode === 'buffered') {
      const data = await fs.promises.readFile(assetPath);
      res.end(data);
      return;
    }

    fs.createReadStream(assetPath).pipe(res);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/asset.bin`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function measureHttpServing(label, mode) {
  const server = await createServingServer(mode);
  try {
    return await measure(label, async () => {
      for (let index = 0; index < iterations; index += 1) {
        const response = await fetch(server.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.arrayBuffer();
      }
    });
  } finally {
    await server.close();
  }
}

try {
  fs.writeFileSync(assetPath, Buffer.alloc(fileSizeMb * 1024 * 1024, 7));

  const syncRead = await measure('sync-readFileSync-baseline', async () => {
    for (let index = 0; index < iterations; index += 1) {
      fs.readFileSync(assetPath);
    }
  });

  const asyncRead = await measure('async-fs.promises.readFile-baseline', async () => {
    for (let index = 0; index < iterations; index += 1) {
      await fs.promises.readFile(assetPath);
    }
  });

  const bufferedResponse = await measure('old-buffered-response-readFile', async () => {
    for (let index = 0; index < iterations; index += 1) {
      const response = new Response(await fs.promises.readFile(assetPath), {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      await readResponseBody(response);
    }
  });

  const streamResponse = await measure('new-file-stream-response', async () => {
    for (let index = 0; index < iterations; index += 1) {
      const stream = fs.createReadStream(assetPath);
      const response = new Response(Readable.toWeb(stream), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
      await readResponseBody(response);
    }
  });

  const bufferedHttp = await measureHttpServing('old-buffered-http-serving', 'buffered');
  const streamHttp = await measureHttpServing('new-stream-http-serving', 'stream');

  console.log(JSON.stringify({
    fileSizeMb,
    iterations,
    bytesServedPerMeasurement: fileSizeMb * 1024 * 1024 * iterations,
    measurements: [
      syncRead,
      asyncRead,
      bufferedResponse,
      streamResponse,
      bufferedHttp,
      streamHttp,
    ],
  }, null, 2));
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
