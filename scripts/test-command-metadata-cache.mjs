#!/usr/bin/env node

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-command-metadata-cache-'));
process.env.SUPERCMD_TEST_USER_DATA = tempRoot;

const commandsModule = await importTs(path.join(root, 'src/main/commands.ts'), {
  root,
  stubs: {
    electron: `
      export const app = {
        getPath() { return ${JSON.stringify(tempRoot)}; },
        quit() {},
      };
    `,
    './extension-runner': `
      export function discoverInstalledExtensionCommands() { return []; }
    `,
    './quicklink-store': `
      export function getAllQuickLinks() { return []; }
      export function getQuickLinkCommandId(link) { return 'quicklink-' + String(link?.id || link?.url || 'unknown'); }
    `,
    './script-command-runner': `
      export function discoverScriptCommands() { return []; }
    `,
    './settings-store': `
      export function getSearchApplicationsScope() { return 'all'; }
      export function loadSettings() { return globalThis.__superCmdCommandMetadataSettings || {}; }
    `,
  },
});

after(() => {
  commandsModule.__resetCommandCacheForTesting();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function makeCommands(count = 250) {
  const commands = [
    {
      id: 'ext-weather-today',
      title: 'Today',
      subtitle: 'Weather',
      keywords: ['weather', 'today'],
      category: 'extension',
      path: 'weather/today',
      mode: 'view',
    },
    {
      id: 'script-stock-ticker',
      title: 'Stock Ticker',
      keywords: ['stock'],
      category: 'script',
      path: '/tmp/stocks.sh',
      mode: 'inline',
    },
    {
      id: 'script-cleanup',
      title: 'Cleanup',
      subtitle: 'Maintenance',
      keywords: ['cleanup'],
      category: 'script',
      path: '/tmp/cleanup.sh',
      mode: 'compact',
    },
  ];

  for (let index = 0; index < count; index += 1) {
    commands.push({
      id: `app-synthetic-${index}`,
      title: `Synthetic App ${index}`,
      subtitle: `Application ${index}`,
      keywords: [`synthetic-${index}`],
      category: 'app',
      path: `/Applications/Synthetic ${index}.app`,
    });
  }

  return commands;
}

function findCommand(commands, id) {
  const command = commands.find((entry) => entry.id === id);
  assert.ok(command, `expected command ${id}`);
  return command;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: Number(sorted[0].toFixed(3)),
    median: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

function seedFreshCache(commands = makeCommands()) {
  commandsModule.__seedCommandCacheForTesting(commands, { cacheTimestamp: Date.now() });
}

test('command metadata updates patch cached subtitles without structural rediscovery', async () => {
  commandsModule.__resetCommandCacheForTesting();
  let structuralDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    structuralDiscoveryRuns += 1;
    return makeCommands();
  });
  seedFreshCache(makeCommands(1_000));

  const update = commandsModule.applyCommandMetadataUpdate('weather/today', { subtitle: '72 F and sunny' });
  const afterExtensionUpdate = await commandsModule.getAvailableCommands();

  assert.deepEqual(
    {
      matchedCommands: update.matchedCommands,
      changedCommands: update.changedCommands,
      patchedCachedCommands: update.patchedCachedCommands,
      patchedStaleCommandsFallback: update.patchedStaleCommandsFallback,
    },
    {
      matchedCommands: 1,
      changedCommands: 1,
      patchedCachedCommands: true,
      patchedStaleCommandsFallback: false,
    }
  );
  assert.equal(findCommand(afterExtensionUpdate, 'ext-weather-today').subtitle, '72 F and sunny');
  assert.equal(structuralDiscoveryRuns, 0);
  assert.equal(commandsModule.__getCommandDiscoveryStartCountForTesting(), 0);

  const inlineUpdate = commandsModule.applyCommandMetadataUpdate('script-stock-ticker', { subtitle: 'AAPL 210.00' });
  const afterInlineUpdate = await commandsModule.getAvailableCommands();
  assert.equal(inlineUpdate.changedCommands, 1);
  assert.equal(findCommand(afterInlineUpdate, 'script-stock-ticker').subtitle, 'AAPL 210.00');
  assert.equal(structuralDiscoveryRuns, 0);

  const ignoredCompactScript = commandsModule.applyCommandMetadataUpdate('script-cleanup', { subtitle: 'Ignored' });
  const afterIgnoredUpdate = await commandsModule.getAvailableCommands();
  assert.equal(ignoredCompactScript.matchedCommands, 0);
  assert.equal(findCommand(afterIgnoredUpdate, 'script-cleanup').subtitle, 'Maintenance');
  assert.equal(structuralDiscoveryRuns, 0);

  const removal = commandsModule.applyCommandMetadataUpdate('weather/today', { subtitle: null });
  const afterRemoval = await commandsModule.getAvailableCommands();
  assert.equal(removal.changedCommands, 1);
  assert.equal(findCommand(afterRemoval, 'ext-weather-today').subtitle, 'Weather');
  assert.equal(structuralDiscoveryRuns, 0);
});

test('legacy invalidation path starts structural discovery from stale fallback', async () => {
  commandsModule.__resetCommandCacheForTesting();
  let structuralDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    structuralDiscoveryRuns += 1;
    return makeCommands();
  });
  const commands = makeCommands(1_000);
  seedFreshCache(commands);

  commandsModule.invalidateCache();
  const returnedCommands = await commandsModule.getAvailableCommands();

  assert.equal(returnedCommands, commands);
  assert.equal(structuralDiscoveryRuns, 1);
  assert.equal(commandsModule.__getCommandDiscoveryStartCountForTesting(), 1);
});

test('command metadata fallback invalidates when the target is absent from a fresh cache', async () => {
  commandsModule.__resetCommandCacheForTesting();
  let structuralDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    structuralDiscoveryRuns += 1;
    return makeCommands();
  });
  const commands = makeCommands(1_000);
  seedFreshCache(commands);

  const patchResult = commandsModule.applyCommandMetadataUpdateWithCacheFallback('missing-extension-command', {
    subtitle: 'Queued subtitle',
  });
  const returnedCommands = await commandsModule.getAvailableCommands();

  assert.equal(patchResult.matchedCommands, 0);
  assert.equal(patchResult.changedCommands, 0);
  assert.equal(returnedCommands, commands);
  assert.equal(structuralDiscoveryRuns, 1);
  assert.equal(commandsModule.__getCommandDiscoveryStartCountForTesting(), 1);
});

test('command metadata cache benchmark', async () => {
  const commandCount = 5_000;
  const iterations = 60;
  const targetCommandId = 'script-stock-ticker';

  commandsModule.__resetCommandCacheForTesting();
  let legacyStructuralDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    legacyStructuralDiscoveryRuns += 1;
    return makeCommands(commandCount);
  });

  const legacyTimes = [];
  for (let index = 0; index < iterations; index += 1) {
    seedFreshCache(makeCommands(commandCount));
    const startedAt = performance.now();
    commandsModule.invalidateCache();
    await commandsModule.getAvailableCommands();
    legacyTimes.push(performance.now() - startedAt);
  }

  commandsModule.__resetCommandCacheForTesting();
  let optimizedStructuralDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    optimizedStructuralDiscoveryRuns += 1;
    return makeCommands(commandCount);
  });

  const optimizedTimes = [];
  for (let index = 0; index < iterations; index += 1) {
    seedFreshCache(makeCommands(commandCount));
    const startedAt = performance.now();
    commandsModule.applyCommandMetadataUpdate(targetCommandId, { subtitle: `Tick ${index}` });
    await commandsModule.getAvailableCommands();
    optimizedTimes.push(performance.now() - startedAt);
  }

  const report = {
    commandCount,
    iterations,
    legacy: {
      structuralDiscoveryStarts: legacyStructuralDiscoveryRuns,
      getCommandsMs: stats(legacyTimes),
    },
    optimized: {
      structuralDiscoveryStarts: optimizedStructuralDiscoveryRuns,
      getCommandsMs: stats(optimizedTimes),
    },
    avoidedStructuralDiscoveryStarts: legacyStructuralDiscoveryRuns - optimizedStructuralDiscoveryRuns,
  };

  console.log('Command metadata cache benchmark', JSON.stringify(report));
  assert.equal(legacyStructuralDiscoveryRuns, iterations);
  assert.equal(optimizedStructuralDiscoveryRuns, 0);
  assert.equal(report.avoidedStructuralDiscoveryStarts, iterations);
});
