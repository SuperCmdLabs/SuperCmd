#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const root = path.resolve('.');
const {
  buildLauncherFileCandidates,
  buildLauncherFileResultCommandByPath,
} = await importBundledTs(path.join(root, 'src/renderer/src/utils/launcher-file-candidates.ts'));

async function importBundledTs(absPath) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [absPath],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.js': 'js',
      '.jsx': 'jsx',
      '.json': 'json',
    },
  });
  const code = result.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return import(dataUrl);
}

function makeResult(index, overrides = {}) {
  const parentPath = `/Users/test/Documents/project-${String(index % 30).padStart(2, '0')}`;
  const name = `alpha-file-${String(index).padStart(4, '0')}.txt`;
  const filePath = `${parentPath}/${name}`;
  return {
    path: filePath,
    name,
    parentPath,
    displayPath: `~/Documents/project-${String(index % 30).padStart(2, '0')}`,
    isDirectory: false,
    mtimeMs: Date.now() - (index % 24) * 60 * 60 * 1000,
    birthtimeMs: Date.now() - (index % 24) * 60 * 60 * 1000,
    topLevelRoot: 'Documents',
    homeRelativeDepth: 3,
    depth: 3,
    noisyPathSegmentCount: 0,
    ...overrides,
  };
}

function makeCommand(result, index, overrides = {}) {
  return {
    id: `system-file-result:${index}`,
    title: result.name,
    subtitle: result.displayPath,
    keywords: [result.name, result.parentPath, result.displayPath],
    category: 'system',
    path: result.path,
    ...overrides,
  };
}

function candidateSignature(candidates) {
  return candidates.map((candidate) => [
    candidate.stableKey,
    candidate.label,
    candidate.pathOrUrl,
    candidate.matchKind,
    candidate.matchScore,
    candidate.subtype,
    candidate.command.id,
    candidate.command.title,
    candidate.command.path,
    candidate.finalScore,
  ]);
}

function checksumCandidates(candidates) {
  let checksum = candidates.length;
  for (const candidate of candidates) {
    checksum += candidate.command.id.length;
    checksum += candidate.stableKey.length;
    checksum += Math.round(candidate.finalScore);
  }
  return checksum;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: Number(sorted[0].toFixed(3)),
    median: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

function measure(iterations, fn) {
  const times = [];
  let checksum = 0;
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    checksum += checksumCandidates(fn());
    times.push(performance.now() - started);
  }
  return { ...stats(times), checksum };
}

test('launcher file command map preserves first path match and result order', () => {
  const duplicatePath = '/Users/test/Documents/alpha-duplicate.txt';
  const duplicateResult = makeResult(1, {
    path: duplicatePath,
    name: 'alpha-duplicate.txt',
    parentPath: '/Users/test/Documents',
    displayPath: '~/Documents',
  });
  const missingCommandResult = makeResult(2, {
    path: '/Users/test/Documents/alpha-missing.txt',
    name: 'alpha-missing.txt',
    parentPath: '/Users/test/Documents',
    displayPath: '~/Documents',
  });
  const tailResult = makeResult(3, {
    path: '/Users/test/Documents/alpha-tail.txt',
    name: 'alpha-tail.txt',
    parentPath: '/Users/test/Documents',
    displayPath: '~/Documents',
  });

  const firstDuplicateCommand = makeCommand(duplicateResult, 1, { title: 'First duplicate command' });
  const secondDuplicateCommand = makeCommand(duplicateResult, 2, { title: 'Second duplicate command' });
  const tailCommand = makeCommand(tailResult, 3, { title: 'Tail command' });
  const commandByPath = buildLauncherFileResultCommandByPath([
    firstDuplicateCommand,
    secondDuplicateCommand,
    tailCommand,
  ]);

  assert.equal(commandByPath.get(duplicatePath), firstDuplicateCommand);

  const candidates = buildLauncherFileCandidates({
    launcherFileResults: [duplicateResult, missingCommandResult, tailResult],
    fileResultCommandByPath: commandByPath,
    searchQuery: 'alpha',
    rootSearchRanking: {},
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.command.title),
    ['First duplicate command', 'Tail command']
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.pathOrUrl),
    [duplicatePath, tailResult.path]
  );
});

test('launcher file candidate assembly handles 3000 results with path-map lookup', () => {
  const count = 3000;
  const iterations = 25;
  const launcherFileResults = Array.from({ length: count }, (_, index) => makeResult(index));
  const fileResultCommands = launcherFileResults.map((result, index) => makeCommand(result, index));
  const fileResultCommandByPath = buildLauncherFileResultCommandByPath(fileResultCommands);
  const findBackedLookup = {
    get(filePath) {
      return fileResultCommands.find((command) => command.path === filePath);
    },
  };

  const input = {
    launcherFileResults,
    searchQuery: 'alpha',
    rootSearchRanking: {},
  };
  const mapCandidates = buildLauncherFileCandidates({
    ...input,
    fileResultCommandByPath,
  });
  const findCandidates = buildLauncherFileCandidates({
    ...input,
    fileResultCommandByPath: findBackedLookup,
  });

  assert.equal(mapCandidates.length, count);
  assert.deepEqual(candidateSignature(mapCandidates), candidateSignature(findCandidates));

  const mapStats = measure(iterations, () => buildLauncherFileCandidates({
    ...input,
    fileResultCommandByPath,
  }));
  const findStats = measure(iterations, () => buildLauncherFileCandidates({
    ...input,
    fileResultCommandByPath: findBackedLookup,
  }));

  assert.equal(mapStats.checksum, findStats.checksum);
  assert.ok(
    mapStats.median < findStats.median,
    `expected path-map assembly median ${mapStats.median}ms to be below find-backed median ${findStats.median}ms`
  );

  console.log('Launcher file candidate assembly benchmark', JSON.stringify({
    count,
    iterations,
    mapStats,
    findStats,
    speedup: Number((findStats.median / mapStats.median).toFixed(2)),
  }));
});
