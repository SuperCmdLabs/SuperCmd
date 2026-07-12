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
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-quicklink-command-refresh-'));
process.env.SUPERCMD_TEST_USER_DATA = tempRoot;

globalThis.__superCmdQuickLinks = [];
globalThis.__superCmdQuickLinkDiscoveryRuns = 0;
globalThis.__superCmdQuickLinkRefreshSettings = {};
globalThis.__superCmdQuickLinksShouldThrow = false;

const commandsModule = await importTs(path.join(root, 'src/main/commands.ts'), {
  root,
  stubs: {
    electron: `
      export const app = {
        getPath(name) {
          if (name === 'temp') return ${JSON.stringify(tempRoot)};
          return ${JSON.stringify(tempRoot)};
        },
        quit() {},
      };
    `,
    './extension-runner': `
      export function discoverInstalledExtensionCommands() { return []; }
    `,
    './quicklink-store': `
      export function getAllQuickLinks() {
        globalThis.__superCmdQuickLinkDiscoveryRuns = (globalThis.__superCmdQuickLinkDiscoveryRuns || 0) + 1;
        if (globalThis.__superCmdQuickLinksShouldThrow) {
          throw new Error('quicklink discovery failed');
        }
        return [...(globalThis.__superCmdQuickLinks || [])];
      }
      export function getQuickLinkCommandId(quickLinkId) { return 'quicklink-' + String(quickLinkId || '').trim(); }
      export function isQuickLinkCommandId(commandId) { return String(commandId || '').trim().startsWith('quicklink-'); }
    `,
    './script-command-runner': `
      export function discoverScriptCommands() { return []; }
    `,
    './settings-store': `
      export function getSearchApplicationsScope() { return []; }
      export function loadSettings() { return globalThis.__superCmdQuickLinkRefreshSettings || {}; }
    `,
  },
});

after(() => {
  commandsModule.__resetCommandCacheForTesting();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const QUICKLINK_ICON_DATA_URL = 'data:image/png;base64,aWNvbg==';

function setQuickLinks(quickLinks) {
  globalThis.__superCmdQuickLinks = quickLinks;
  globalThis.__superCmdQuickLinkDiscoveryRuns = 0;
  globalThis.__superCmdQuickLinksShouldThrow = false;
}

function makeQuickLinks(count = 2) {
  return Array.from({ length: count }, (_, index) => {
    const id = index === 0 ? 'docs' : `search-${index}`;
    return {
      id,
      name: index === 0 ? 'Docs' : `Search ${index}`,
      urlTemplate: index === 0 ? 'https://docs.example.com/{query}' : `https://search${index}.example.com/?q={query}`,
      applicationName: index === 0 ? 'Browser' : undefined,
      applicationPath: undefined,
      applicationBundleId: undefined,
      appIconDataUrl: index === 0 ? QUICKLINK_ICON_DATA_URL : undefined,
      icon: index === 0 ? 'default' : 'Link',
      createdAt: 1_700_000_000_000 + index,
      updatedAt: 1_700_000_000_000 + index,
    };
  });
}

function makeBaseCommands(extraAppCount = 0, includeQuickLinks = true) {
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
      id: 'ext-existing-search',
      title: 'Existing Extension Search',
      subtitle: 'Existing Extension',
      keywords: ['extension'],
      category: 'extension',
      path: 'existing/search',
      mode: 'view',
      deeplink: 'supercmd://extensions/existing/search',
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
      id: 'system-search-quicklinks',
      title: 'Search Quick Links',
      keywords: ['quicklink'],
      category: 'system',
    },
    {
      id: 'system-open-settings',
      title: 'SuperCmd Settings',
      keywords: ['settings'],
      category: 'system',
    },
  ];

  if (includeQuickLinks) {
    commands.splice(
      4,
      0,
      {
        id: 'quicklink-old-docs',
        title: 'Old Docs',
        subtitle: 'Old Quick Link',
        keywords: ['old'],
        iconName: 'Globe',
        category: 'system',
      },
      {
        id: 'quicklink-old-search',
        title: 'Old Search',
        subtitle: 'Old Quick Link',
        keywords: ['old'],
        iconName: 'Search',
        category: 'system',
      }
    );
  }

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

test('quicklink command refresh swaps quicklinks without structural rediscovery', async () => {
  commandsModule.__resetCommandCacheForTesting();
  globalThis.__superCmdQuickLinkRefreshSettings = {
    commandMetadata: {
      'quicklink-docs': { subtitle: 'Live Docs' },
    },
    commandAliases: {
      'quicklink-docs': 'qd',
    },
  };
  setQuickLinks(makeQuickLinks(2));

  let structuralDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    structuralDiscoveryRuns += 1;
    return makeBaseCommands();
  });

  commandsModule.__seedCommandCacheForTesting(makeBaseCommands(), { cacheTimestamp: Date.now() });
  const refreshed = await commandsModule.refreshCommandsForQuickLinkChange();

  assert.equal(structuralDiscoveryRuns, 0);
  assert.equal(commandsModule.__getCommandDiscoveryStartCountForTesting(), 0);
  assert.equal(globalThis.__superCmdQuickLinkDiscoveryRuns, 1);
  assert.deepEqual(commandIds(refreshed), [
    'app-safari',
    'settings-network',
    'ext-existing-search',
    'script-cleanup',
    'quicklink-docs',
    'quicklink-search-1',
    'system-search-quicklinks',
    'system-open-settings',
  ]);

  const docsCommand = refreshed.find((command) => command.id === 'quicklink-docs');
  assert.equal(docsCommand?.deeplink, 'supercmd://commands/quicklink-docs');
  assert.equal(docsCommand?.subtitle, 'Live Docs');
  assert.equal(docsCommand?.iconDataUrl, QUICKLINK_ICON_DATA_URL);
  assert.equal(docsCommand?.iconName, undefined);
  assert.equal(docsCommand?.keywords?.includes('qd'), true);
  assert.equal(docsCommand?.keywords?.includes('docs.example.com'), true);

  const searchCommand = refreshed.find((command) => command.id === 'quicklink-search-1');
  assert.equal(searchCommand?.subtitle, 'Quick Link');
  assert.equal(searchCommand?.iconName, 'Link');
  assert.equal(searchCommand?.iconDataUrl, undefined);
  assert.equal(searchCommand?.deeplink, 'supercmd://commands/quicklink-search-1');

  assert.equal(refreshed.some((command) => command.id === 'quicklink-old-docs'), false);
  assert.equal(await commandsModule.getAvailableCommands(), refreshed);

  const diskCache = JSON.parse(fs.readFileSync(path.join(tempRoot, 'commands-disk-cache.json'), 'utf8'));
  const diskDocsCommand = diskCache.commands.find((command) => command.id === 'quicklink-docs');
  assert.equal(diskDocsCommand.subtitle, 'Browser');
  assert.equal(diskDocsCommand.iconDataUrl, undefined);
});

test('quicklink command refresh keeps runtime subtitle overlays out of the cached base', async () => {
  commandsModule.__resetCommandCacheForTesting();
  setQuickLinks(makeQuickLinks(1));

  globalThis.__superCmdQuickLinkRefreshSettings = {
    commandMetadata: {
      'ext-existing-search': { subtitle: 'Live Extension Subtitle' },
    },
  };

  commandsModule.__seedCommandCacheForTesting(makeBaseCommands(), { cacheTimestamp: Date.now() });
  const overlaid = await commandsModule.refreshCommandsForQuickLinkChange();
  assert.equal(
    overlaid.find((command) => command.id === 'ext-existing-search')?.subtitle,
    'Live Extension Subtitle'
  );

  globalThis.__superCmdQuickLinkRefreshSettings = {};
  setQuickLinks([
    {
      ...makeQuickLinks(1)[0],
      name: 'Docs Updated',
      updatedAt: 1_700_000_010_000,
    },
  ]);

  const restored = await commandsModule.refreshCommandsForQuickLinkChange();
  const extensionCommand = restored.find((command) => command.id === 'ext-existing-search');
  assert.equal(extensionCommand?.subtitle, 'Existing Extension');

  const diskCache = JSON.parse(fs.readFileSync(path.join(tempRoot, 'commands-disk-cache.json'), 'utf8'));
  const diskExtensionCommand = diskCache.commands.find((command) => command.id === 'ext-existing-search');
  assert.equal(diskExtensionCommand.subtitle, 'Existing Extension');
});

test('quicklink command refresh inserts newly created quicklinks before built-in system commands', async () => {
  commandsModule.__resetCommandCacheForTesting();
  globalThis.__superCmdQuickLinkRefreshSettings = {};
  setQuickLinks(makeQuickLinks(1));

  commandsModule.__seedCommandCacheForTesting(makeBaseCommands(0, false), { cacheTimestamp: Date.now() });
  const refreshed = await commandsModule.refreshCommandsForQuickLinkChange();

  assert.deepEqual(commandIds(refreshed), [
    'app-safari',
    'settings-network',
    'ext-existing-search',
    'script-cleanup',
    'quicklink-docs',
    'system-search-quicklinks',
    'system-open-settings',
  ]);
});

test('quicklink command refresh removes deleted quicklinks from cached command list', async () => {
  commandsModule.__resetCommandCacheForTesting();
  globalThis.__superCmdQuickLinkRefreshSettings = {};
  setQuickLinks([]);

  commandsModule.__seedCommandCacheForTesting(makeBaseCommands(), { cacheTimestamp: Date.now() });
  const refreshed = await commandsModule.refreshCommandsForQuickLinkChange();

  assert.equal(globalThis.__superCmdQuickLinkDiscoveryRuns, 1);
  assert.equal(refreshed.some((command) => command.id.startsWith('quicklink-')), false);
  assert.deepEqual(commandIds(refreshed), [
    'app-safari',
    'settings-network',
    'ext-existing-search',
    'script-cleanup',
    'system-search-quicklinks',
    'system-open-settings',
  ]);
});

test('quicklink command refresh falls back to full discovery without a command cache', async () => {
  commandsModule.__resetCommandCacheForTesting();
  globalThis.__superCmdQuickLinkRefreshSettings = {};

  let structuralDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    structuralDiscoveryRuns += 1;
    return makeBaseCommands();
  });

  const refreshed = await commandsModule.refreshCommandsForQuickLinkChange();

  assert.equal(structuralDiscoveryRuns, 1);
  assert.equal(commandsModule.__getCommandDiscoveryStartCountForTesting(), 1);
  assert.equal(refreshed.some((command) => command.id === 'app-safari'), true);
});

test('quicklink command refresh rejects discovery errors without mutating the warm cache', async () => {
  commandsModule.__resetCommandCacheForTesting();
  globalThis.__superCmdQuickLinkRefreshSettings = {};
  setQuickLinks(makeQuickLinks(1));

  const originalCommands = makeBaseCommands();
  commandsModule.__seedCommandCacheForTesting(originalCommands, { cacheTimestamp: Date.now() });
  globalThis.__superCmdQuickLinksShouldThrow = true;

  await assert.rejects(
    commandsModule.refreshCommandsForQuickLinkChange(),
    /quicklink discovery failed/
  );
  assert.equal(await commandsModule.getAvailableCommands(), originalCommands);
});

test('quicklink command refresh benchmark avoids full discovery starts with a warm cache', async () => {
  const iterations = 40;
  const baseCommandCount = 2_000;
  const quickLinkCount = 80;
  const simulatedStructuralDiscoveryMs = 8;

  commandsModule.__resetCommandCacheForTesting();
  globalThis.__superCmdQuickLinkRefreshSettings = {};
  setQuickLinks(makeQuickLinks(quickLinkCount));

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
  globalThis.__superCmdQuickLinkRefreshSettings = {};
  setQuickLinks(makeQuickLinks(quickLinkCount));
  let targetedStructuralDiscoveryRuns = 0;
  commandsModule.__setCommandDiscoveryRunnerForTesting(async () => {
    targetedStructuralDiscoveryRuns += 1;
    await delay(simulatedStructuralDiscoveryMs);
    return makeBaseCommands(baseCommandCount);
  });

  const targetedTimes = [];
  for (let index = 0; index < iterations; index += 1) {
    commandsModule.__seedCommandCacheForTesting(makeBaseCommands(baseCommandCount), { cacheTimestamp: Date.now() });
    const startedAt = performance.now();
    await commandsModule.refreshCommandsForQuickLinkChange();
    targetedTimes.push(performance.now() - startedAt);
  }

  const report = {
    iterations,
    baseCommandCount: makeBaseCommands(baseCommandCount).length,
    quickLinkCount,
    simulatedStructuralDiscoveryMs,
    legacy: {
      structuralDiscoveryStarts: legacyStructuralDiscoveryRuns,
      refreshMs: stats(legacyTimes),
    },
    targeted: {
      structuralDiscoveryStarts: targetedStructuralDiscoveryRuns,
      quickLinkDiscoveryStarts: globalThis.__superCmdQuickLinkDiscoveryRuns,
      refreshMs: stats(targetedTimes),
    },
    avoidedStructuralDiscoveryStarts: legacyStructuralDiscoveryRuns - targetedStructuralDiscoveryRuns,
  };

  console.log('Quicklink command refresh benchmark', JSON.stringify(report));
  assert.equal(legacyStructuralDiscoveryRuns, iterations);
  assert.equal(targetedStructuralDiscoveryRuns, 0);
  assert.equal(globalThis.__superCmdQuickLinkDiscoveryRuns, iterations);
  assert.equal(report.avoidedStructuralDiscoveryStarts, iterations);
});
