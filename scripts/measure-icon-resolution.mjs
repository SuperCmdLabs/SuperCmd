#!/usr/bin/env node

import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetFile = path.join(root, 'src/renderer/src/raycast-api/icon-runtime-phosphor.tsx');
const outputFile = path.join(os.tmpdir(), `supercmd-icon-resolution-${process.pid}-${Date.now()}.mjs`);

const exactInputs = [
  'AddPerson',
  'Icon.ArrowLeftCircleFilled',
  'MagnifyingGlass',
  'Stopwatch',
  'Temperature',
  'Dot',
  'XMarkCircleFilled',
  'Folder',
];

const unknownAndFuzzyInputs = [
  'TotallyMissingIconName',
  'HyperSpecificSparkleClockWidget',
  'SuperCmdTimerStopwatchShape',
  'UnmappedTerminalCommandLineIcon',
  'MysteryNetworkCloudBolt',
  'Noise___No_Such_Icon_999',
];

function exposeResolverPlugin() {
  const normalizedTarget = path.normalize(targetFile);
  return {
    name: 'expose-icon-resolution-for-measurement',
    setup(buildApi) {
      buildApi.onLoad({ filter: /icon-runtime-phosphor\.tsx$/ }, async (args) => {
        if (path.normalize(args.path) !== normalizedTarget) return undefined;
        const source = await fs.readFile(args.path, 'utf8');
        return {
          contents: `${source}\nexport const __measureResolvePhosphorIconFromRaycast = resolvePhosphorIconFromRaycast;\n`,
          loader: 'tsx',
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}

function stubServerRenderingPlugin() {
  return {
    name: 'stub-server-rendering-for-measurement',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^react-dom\/server$/ }, () => ({
        path: 'react-dom-server-measurement-stub',
        namespace: 'measurement-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'measurement-stub' }, () => ({
        contents: 'export function renderToStaticMarkup() { return ""; }',
        loader: 'js',
      }));
    },
  };
}

function measureCase(resolveIcon, { name, inputs, iterations }) {
  const calls = inputs.length * iterations;
  const start = performance.now();
  let resolved = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const input of inputs) {
      if (resolveIcon(input)?.icon) resolved += 1;
    }
  }

  const durationMs = performance.now() - start;
  return {
    name,
    calls,
    resolved,
    durationMs: Number(durationMs.toFixed(3)),
    callsPerMs: Number((calls / Math.max(durationMs, 0.001)).toFixed(3)),
  };
}

async function main() {
  await build({
    entryPoints: [targetFile],
    outfile: outputFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [exposeResolverPlugin(), stubServerRenderingPlugin()],
  });

  const moduleUrl = `${pathToFileURL(outputFile).href}?t=${Date.now()}`;
  const runtime = await import(moduleUrl);
  const resolveIcon = runtime.__measureResolvePhosphorIconFromRaycast;
  if (typeof resolveIcon !== 'function') {
    throw new Error('Failed to expose resolvePhosphorIconFromRaycast for measurement.');
  }

  const results = [
    measureCase(resolveIcon, {
      name: 'exact/repeated',
      inputs: exactInputs,
      iterations: 2500,
    }),
    measureCase(resolveIcon, {
      name: 'unknown-fuzzy/repeated',
      inputs: unknownAndFuzzyInputs,
      iterations: 250,
    }),
  ];

  console.log('Icon resolution measurement');
  for (const result of results) {
    console.log(
      `${result.name}: ${result.calls} calls, ${result.durationMs} ms, ${result.callsPerMs} calls/ms, resolved ${result.resolved}`
    );
  }
  console.log(JSON.stringify({ results }, null, 2));
}

try {
  await main();
} finally {
  await fs.unlink(outputFile).catch(() => {});
}
