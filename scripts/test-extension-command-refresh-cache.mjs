#!/usr/bin/env node

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-extension-command-refresh-'));
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
      export function isQuickLinkCommandId(commandId) { return String(commandId || '').startsWith('quicklink-'); }
    `,
    './script-command-runner': `
      export function discoverScriptCommands() { return []; }
    `,
    './settings-store': `
      export function getSearchApplicationsScope() { return []; }
      export function loadSettings() { return globalThis.__superCmdExtensionRefreshSettings || {}; }
    `,
  },
});

after(() => {
  commandsModule.__resetCommandCacheForTesting();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function makeBaseCommands(extraAppCount = 0) {
  const commands = [
    {
      id: 'app-safari',
      title: 'Safari',
      keywords: ['browser'],
      category: 'app',
      path: '/Applications/Safari.app',
    },
    {
      id: 'settings-network',
      title: 'Network',
      keywords: ['wifi'],
      category: 'settings',
      path: 'com.apple.Network-Settings.extension',
    },
    {
      id: 'ext-old-search',
      title: 'Old Search',
      subtitle: 'Old Extension',
      keywords: ['old'],
      category: 'extension',
      path: 'old/search',
      mode: 'view',
      deeplink: 'supercmd://extensions/old/search',
    },
    {
      id: 'script-cleanup',
      title: 'Cleanup',
      subtitle: 'Scripts',
      keywords: ['cleanup'],
      category: 'script',
      path: '/tmp/cleanup.sh',
      mode: 'inline',
    },
    {
      id: 'quicklink-docs',
      title: 'Docs',
      subtitle: 'Quick Link',
      keywords: ['docs'],
      category: 'system',
    },
    {
      id: 'system-open-settings',
      title: 'SuperCmd Settings',
      keywords: ['settings'],
      category: 'system',
    },
  ];

  for (let index = 0; index < extraAppCount; index += 1) {
    commands.unshift({
      id: `app-synthetic-${index}`,
      title: `Synthetic App ${index}`,
      keywords: [`synthetic-${index}`],
      category: 'app',
      path: `/Applications/Synthetic ${index}.app`,
    });
  }

  return commands;
}

function makeExtensionCommands(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    id: `ext-new-command-${index}`,
    title: `New Command ${index}`,
    subtitle: 'New Extension',
    keywords: ['new', `command-${index}`],
    category: 'extension',
    path: `new/command-${index}`,
    mode: 'view',
    deeplink: `supercmd://extensions/new/command-${index}`,
  }));
}

function commandIds(commands) {
  return commands.map((command) => command.id);
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: Number(sorted[0].toFixed(3)),
    median: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

test('extension command refresh swaps installed extensions without structural rediscovery', async () => {
  commandsModule.__resetCommandCacheForTesting();
  globalThis.__superCmdExtensionRefreshSettings = {
    commandMetadata: {
      'new/command-0': { subtitle: 'Runtime status' },
    },
  };

  let structuralDiscoveryRuns = 0;
  let extensionDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    structuralDiscoveryRuns += 1;
    return makeBaseCommands();
  });
  commandsModule.__setExtensionCommandInfoRunnerForTesting(() => {
    extensionDiscoveryRuns += 1;
    return makeExtensionCommands(1);
  });

  commandsModule.__seedCommandCacheForTesting(makeBaseCommands(), { cacheTimestamp: Date.now() });
  const refreshed = await commandsModule.refreshCommandsForExtensionChange();

  assert.equal(structuralDiscoveryRuns, 0);
  assert.equal(commandsModule.__getCommandDiscoveryStartCountForTesting(), 0);
  assert.equal(extensionDiscoveryRuns, 1);
  assert.deepEqual(commandIds(refreshed), [
    'app-safari',
    'settings-network',
    'ext-new-command-0',
    'script-cleanup',
    'quicklink-docs',
    'system-open-settings',
  ]);
  assert.equal(refreshed.find((command) => command.id === 'ext-new-command-0')?.subtitle, 'Runtime status');
  assert.equal(refreshed.some((command) => command.id === 'ext-old-search'), false);
  assert.equal(await commandsModule.getAvailableCommands(), refreshed);
});

test('extension command refresh removes uninstalled extensions from cached command list', async () => {
  commandsModule.__resetCommandCacheForTesting();
  globalThis.__superCmdExtensionRefreshSettings = {};

  let extensionDiscoveryRuns = 0;
  commandsModule.__setExtensionCommandInfoRunnerForTesting(() => {
    extensionDiscoveryRuns += 1;
    return [];
  });

  commandsModule.__seedCommandCacheForTesting(makeBaseCommands(), { cacheTimestamp: Date.now() });
  const refreshed = await commandsModule.refreshCommandsForExtensionChange();

  assert.equal(extensionDiscoveryRuns, 1);
  assert.equal(refreshed.some((command) => command.category === 'extension'), false);
  assert.deepEqual(commandIds(refreshed), [
    'app-safari',
    'settings-network',
    'script-cleanup',
    'quicklink-docs',
    'system-open-settings',
  ]);
});

test('extension command refresh falls back to full discovery without a command cache', async () => {
  commandsModule.__resetCommandCacheForTesting();
  globalThis.__superCmdExtensionRefreshSettings = {};

  let structuralDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    structuralDiscoveryRuns += 1;
    return makeBaseCommands();
  });

  const refreshed = await commandsModule.refreshCommandsForExtensionChange();

  assert.equal(structuralDiscoveryRuns, 1);
  assert.equal(commandsModule.__getCommandDiscoveryStartCountForTesting(), 1);
  assert.equal(refreshed.some((command) => command.id === 'app-safari'), true);
});

test('extension command refresh benchmark avoids full discovery starts with a warm cache', async () => {
  const iterations = 40;
  const baseCommandCount = 2_000;
  const simulatedStructuralDiscoveryMs = 8;

  commandsModule.__resetCommandCacheForTesting();
  globalThis.__superCmdExtensionRefreshSettings = {};
  let legacyStructuralDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    legacyStructuralDiscoveryRuns += 1;
    await delay(simulatedStructuralDiscoveryMs);
    return makeBaseCommands(baseCommandCount);
  });

  const legacyTimes = [];
  for (let index = 0; index < iterations; index += 1) {
    commandsModule.__seedCommandCacheForTesting(makeBaseCommands(baseCommandCount), { cacheTimestamp: Date.now() });
    const startedAt = performance.now();
    commandsModule.invalidateCache();
    await commandsModule.refreshCommandsNow();
    legacyTimes.push(performance.now() - startedAt);
  }

  commandsModule.__resetCommandCacheForTesting();
  let targetedStructuralDiscoveryRuns = 0;
  let targetedExtensionDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    targetedStructuralDiscoveryRuns += 1;
    await delay(simulatedStructuralDiscoveryMs);
    return makeBaseCommands(baseCommandCount);
  });
  commandsModule.__setExtensionCommandInfoRunnerForTesting(() => {
    targetedExtensionDiscoveryRuns += 1;
    return makeExtensionCommands(3);
  });

  const targetedTimes = [];
  for (let index = 0; index < iterations; index += 1) {
    commandsModule.__seedCommandCacheForTesting(makeBaseCommands(baseCommandCount), { cacheTimestamp: Date.now() });
    const startedAt = performance.now();
    await commandsModule.refreshCommandsForExtensionChange();
    targetedTimes.push(performance.now() - startedAt);
  }

  const report = {
    iterations,
    baseCommandCount: makeBaseCommands(baseCommandCount).length,
    simulatedStructuralDiscoveryMs,
    legacy: {
      structuralDiscoveryStarts: legacyStructuralDiscoveryRuns,
      refreshMs: stats(legacyTimes),
    },
    targeted: {
      structuralDiscoveryStarts: targetedStructuralDiscoveryRuns,
      extensionDiscoveryStarts: targetedExtensionDiscoveryRuns,
      refreshMs: stats(targetedTimes),
    },
    avoidedStructuralDiscoveryStarts: legacyStructuralDiscoveryRuns - targetedStructuralDiscoveryRuns,
  };

  console.log('Extension command refresh benchmark', JSON.stringify(report));
  assert.equal(legacyStructuralDiscoveryRuns, iterations);
  assert.equal(targetedStructuralDiscoveryRuns, 0);
  assert.equal(targetedExtensionDiscoveryRuns, iterations);
  assert.equal(report.avoidedStructuralDiscoveryStarts, iterations);
});
