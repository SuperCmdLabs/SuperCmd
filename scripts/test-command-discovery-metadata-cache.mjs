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
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-command-discovery-metadata-'));
const userDataRoot = path.join(tempRoot, 'user-data');
const appsRoot = path.join(tempRoot, 'Applications');
const extraAppsRoot = path.join(tempRoot, 'ExtraApplications');
const extensionsRoot = path.join(tempRoot, 'ExtensionKit', 'Extensions');
const prefPanesRoot = path.join(tempRoot, 'PreferencePanes');
const mdfindAppPaths = [];

process.env.SUPERCMD_TEST_USER_DATA = userDataRoot;

const counters = {
  mdfind: 0,
  osascript: 0,
  plutil: 0,
  plistReads: 0,
  sips: 0,
};

const systemDisplayNames = new Map();

function resetCounters() {
  counters.mdfind = 0;
  counters.osascript = 0;
  counters.plutil = 0;
  counters.plistReads = 0;
  counters.sips = 0;
}

function callbackAsync(callback, error, result) {
  queueMicrotask(() => callback(error, result));
}

function extractQuotedPath(command) {
  const match = command.match(/"([^"]+)"/);
  return match ? match[1].replace(/\\"/g, '"') : '';
}

function extractSipsOutputPath(command) {
  const match = command.match(/--out\s+"([^"]+)"/);
  return match ? match[1].replace(/\\"/g, '"') : '';
}

function delayMs(ms) {
  const start = performance.now();
  while (performance.now() - start < ms) {}
}

const childProcessStub = `
  export function exec(command, callback) {
    const counters = globalThis.__superCmdDiscoveryCounters;
    if (command.includes('/usr/bin/mdfind')) {
      counters.mdfind += 1;
      globalThis.__superCmdDiscoveryDelay(0.2);
      return globalThis.__superCmdDiscoveryCallback(callback, null, {
        stdout: globalThis.__superCmdMdfindAppPaths.join('\\n'),
        stderr: '',
      });
    }

    if (command.includes('/usr/bin/plutil')) {
      counters.plutil += 1;
      counters.plistReads += 1;
      globalThis.__superCmdDiscoveryDelay(0.35);
      const filePath = globalThis.__superCmdExtractQuotedPath(command);
      try {
        const stdout = globalThis.__superCmdFs.readFileSync(filePath, 'utf-8');
        return globalThis.__superCmdDiscoveryCallback(callback, null, { stdout, stderr: '' });
      } catch (error) {
        return globalThis.__superCmdDiscoveryCallback(callback, error);
      }
    }

    if (command.includes('/usr/bin/sips')) {
      counters.sips += 1;
      globalThis.__superCmdDiscoveryDelay(0.1);
      const outputPath = globalThis.__superCmdExtractSipsOutputPath(command);
      if (outputPath) {
        globalThis.__superCmdFs.mkdirSync(globalThis.__superCmdPath.dirname(outputPath), { recursive: true });
        globalThis.__superCmdFs.writeFileSync(outputPath, Buffer.alloc(256, 7));
      }
      return globalThis.__superCmdDiscoveryCallback(callback, null, { stdout: '', stderr: '' });
    }

    return globalThis.__superCmdDiscoveryCallback(callback, new Error('Unexpected exec: ' + command));
  }

  export function execFile(file, args, callback) {
    const counters = globalThis.__superCmdDiscoveryCounters;
    if (file === '/usr/bin/osascript') {
      counters.osascript += 1;
      globalThis.__superCmdDiscoveryDelay(0.9);
      const script = args.join('\\n');
      const match = script.match(/const bundlePath = "([^"]+)"/);
      const bundlePath = match ? JSON.parse('"' + match[1] + '"') : '';
      const stdout = globalThis.__superCmdSystemDisplayNames.get(bundlePath) || '';
      return globalThis.__superCmdDiscoveryCallback(callback, null, { stdout, stderr: '' });
    }
    return globalThis.__superCmdDiscoveryCallback(callback, new Error('Unexpected execFile: ' + file));
  }

  export function spawn() {
    return {
      on() {},
      unref() {},
    };
  }
`;

globalThis.__superCmdDiscoveryCounters = counters;
globalThis.__superCmdMdfindAppPaths = mdfindAppPaths;
globalThis.__superCmdSystemDisplayNames = systemDisplayNames;
globalThis.__superCmdDiscoveryCallback = callbackAsync;
globalThis.__superCmdExtractQuotedPath = extractQuotedPath;
globalThis.__superCmdExtractSipsOutputPath = extractSipsOutputPath;
globalThis.__superCmdDiscoveryDelay = delayMs;
globalThis.__superCmdFs = fs;
globalThis.__superCmdPath = path;

const commandsModule = await importTs(path.join(root, 'src/main/commands.ts'), {
  root,
  stubs: {
    child_process: childProcessStub,
    electron: `
      export const app = {
        getPath(name) {
          if (name === 'temp') return ${JSON.stringify(tempRoot)};
          return ${JSON.stringify(userDataRoot)};
        },
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
      export function getSearchApplicationsScope() { return globalThis.__superCmdApplicationScope || []; }
      export function loadSettings() { return { appLanguage: 'en_US' }; }
    `,
  },
});

after(() => {
  commandsModule.__resetCommandCacheForTesting();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

function writeIcon(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(256, 3));
}

function makeBundle(relativePath, info, resources = {}) {
  const bundlePath = path.join(tempRoot, relativePath);
  writeJson(path.join(bundlePath, 'Contents', 'Info.plist'), info);
  for (const [resourcePath, value] of Object.entries(resources)) {
    const fullPath = path.join(bundlePath, 'Contents', 'Resources', resourcePath);
    if (resourcePath.endsWith('.icns')) {
      writeIcon(fullPath);
    } else {
      writeJson(fullPath, value);
    }
  }
  return bundlePath;
}

function setupFixtures() {
  fs.mkdirSync(appsRoot, { recursive: true });
  fs.mkdirSync(extraAppsRoot, { recursive: true });
  fs.mkdirSync(extensionsRoot, { recursive: true });
  fs.mkdirSync(prefPanesRoot, { recursive: true });

  const alphaApp = makeBundle('Applications/Alpha.app', {
    CFBundlePackageType: 'APPL',
    CFBundleIdentifier: 'com.example.alpha',
    CFBundleDisplayName: 'Alpha',
    CFBundleIconFile: 'AppIcon',
  }, {
    'AppIcon.icns': true,
    'InfoPlist.loctable': { en_US: { CFBundleDisplayName: 'Alpha Localized' } },
  });

  const betaApp = makeBundle('Applications/Beta.app', {
    CFBundlePackageType: 'APPL',
    CFBundleIdentifier: 'com.example.beta',
    CFBundleDisplayName: 'Beta',
    CFBundleIconFile: 'AppIcon.icns',
  }, {
    'AppIcon.icns': true,
    'en_US.lproj/InfoPlist.strings': { CFBundleDisplayName: 'Beta Localized' },
  });

  const hiddenApp = makeBundle('Applications/Hidden.app', {
    CFBundlePackageType: 'APPL',
    CFBundleIdentifier: 'com.example.hidden',
    CFBundleDisplayName: 'Hidden',
    LSBackgroundOnly: true,
  }, {
    'AppIcon.icns': true,
  });

  const gammaApp = makeBundle('ExtraApplications/Gamma.app', {
    CFBundlePackageType: 'APPL',
    CFBundleIdentifier: 'com.example.gamma',
    CFBundleDisplayName: 'Gamma',
    CFBundleIconFile: 'AppIcon',
  }, {
    'AppIcon.icns': true,
  });

  const batteryExtension = makeBundle('ExtensionKit/Extensions/Battery.appex', {
    CFBundleIdentifier: 'com.apple.Battery-Settings.extension',
    CFBundleDisplayName: 'Battery',
    CFBundleIconFile: 'AppIcon',
    EXAppExtensionAttributes: {
      EXExtensionPointIdentifier: 'com.apple.Settings.extension.ui',
      SettingsExtensionAttributes: {
        legacyBundleIdentifier: 'com.apple.preference.battery',
        searchTermsFileName: 'BatteryTerms',
      },
    },
  }, {
    'AppIcon.icns': true,
    'en_US.lproj/BatteryTerms.searchTerms': {
      Power: {
        localizableStrings: [
          { title: 'Low Power Mode', index: 'battery, energy, saver' },
          { title: 'Battery Health', index: 'condition, service' },
        ],
      },
    },
  });

  const fallbackPane = makeBundle('PreferencePanes/Fallback.prefPane', {
    CFBundleIdentifier: 'com.example.fallback',
    CFBundleDisplayName: 'Raw Fallback',
    CFBundleIconFile: 'AppIcon',
  }, {
    'AppIcon.icns': true,
    'InfoPlist.loctable': { en_US: { CFBundleDisplayName: 'Loctable Winner' } },
    'InfoPlist.strings': { CFBundleDisplayName: 'Root Strings Loser' },
    'en_US.lproj/InfoPlist.strings': { CFBundleDisplayName: 'Locale Strings Loser' },
    'Localizable.strings': { CFBundleDisplayName: 'Localizable Loser' },
  });

  const systemPane = makeBundle('PreferencePanes/System.prefPane', {
    CFBundleIdentifier: 'com.example.system',
    CFBundleDisplayName: 'System Raw',
    CFBundleIconFile: 'AppIcon',
  }, {
    'AppIcon.icns': true,
    'InfoPlist.loctable': { en_US: { CFBundleDisplayName: 'Local Should Not Win' } },
  });

  systemDisplayNames.set(systemPane, 'System Winner');
  mdfindAppPaths.splice(0, mdfindAppPaths.length, alphaApp, betaApp, hiddenApp, gammaApp);
  globalThis.__superCmdApplicationScope = [appsRoot];
  commandsModule.__setApplicationSearchScopeForTesting([appsRoot]);
  commandsModule.__setSettingsDiscoveryRootsForTesting({
    extensionDir: extensionsRoot,
    prefDirs: [prefPanesRoot],
  });

  return {
    alphaApp,
    betaApp,
    gammaApp,
    batteryExtension,
    fallbackPane,
    systemPane,
  };
}

const fixtures = setupFixtures();

function commandFingerprint(commands) {
  return commands
    .map((command) => ({
      id: command.id,
      title: command.title,
      subtitle: command.subtitle,
      keywords: command.keywords,
      category: command.category,
      path: command.path,
      hasBundlePath: Boolean(command._bundlePath),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function summarize(commands) {
  return {
    total: commands.length,
    apps: commands.filter((command) => command.category === 'app').length,
    settings: commands.filter((command) => command.category === 'settings').length,
    ids: commands.map((command) => command.id).sort(),
  };
}

async function discoverAppAndSettings() {
  const apps = await commandsModule.__discoverApplicationCommandsForTesting();
  const settings = await commandsModule.__discoverSystemSettingsCommandsForTesting();
  return [...apps, ...settings];
}

async function runDiscoveryScenario(label) {
  resetCounters();
  const startedAt = performance.now();
  const commands = await discoverAppAndSettings();
  const elapsedMs = performance.now() - startedAt;
  return {
    label,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    subprocessCalls: {
      mdfind: counters.mdfind,
      osascript: counters.osascript,
      plutil: counters.plutil,
      sips: counters.sips,
      total: counters.mdfind + counters.osascript + counters.plutil + counters.sips,
    },
    plistReads: counters.plistReads,
    commandSummary: summarize(commands),
    fingerprint: commandFingerprint(commands),
  };
}

function configureDiscovery({ metadataCacheEnabled, appScope = [appsRoot] }) {
  commandsModule.__resetCommandCacheForTesting();
  commandsModule.__setCommandDiscoveryMetadataCacheEnabledForTesting(metadataCacheEnabled);
  commandsModule.__setApplicationSearchScopeForTesting(appScope);
  commandsModule.__setSettingsDiscoveryRootsForTesting({
    extensionDir: extensionsRoot,
    prefDirs: [prefPanesRoot],
  });
  globalThis.__superCmdApplicationScope = appScope;
}

function resetIconCacheFiles() {
  const iconCacheDir = path.join(userDataRoot, 'icon-cache');
  fs.rmSync(iconCacheDir, { recursive: true, force: true });
  fs.mkdirSync(iconCacheDir, { recursive: true });
}

async function runFreshDiscoveryScenario(label, metadataCacheEnabled, appScope = [appsRoot]) {
  configureDiscovery({ metadataCacheEnabled, appScope });
  resetIconCacheFiles();
  return runDiscoveryScenario(label);
}

test('localized display-name fallback order is stable', async () => {
  resetCounters();
  const settings = await commandsModule.__discoverSystemSettingsCommandsForTesting();
  const titles = settings.map((command) => command.title).sort();

  assert.ok(titles.includes('Battery'));
  assert.ok(titles.includes('Loctable Winner'));
  assert.ok(titles.includes('System Winner'));
  assert.ok(!titles.includes('Root Strings Loser'));
  assert.ok(!titles.includes('Local Should Not Win'));
});

test('settings search terms produce child commands and keywords', async () => {
  resetCounters();
  const pane = {
    id: 'settings-battery',
    title: 'Battery',
    keywords: ['battery'],
    category: 'settings',
    path: 'com.apple.preference.battery',
    _bundlePath: fixtures.batteryExtension,
  };
  const commands = await commandsModule.__discoverSettingsSearchTermCommandsForTesting(
    fixtures.batteryExtension,
    pane,
    'com.apple.Battery-Settings.extension',
    'com.apple.preference.battery',
    'BatteryTerms'
  );

  assert.equal(commands.length, 3);
  assert.deepEqual(commands.map((command) => command.title).sort(), [
    'Battery Health',
    'Low Power Mode',
    'Power',
  ]);
  assert.ok(commands.find((command) => command.title === 'Low Power Mode')?.keywords?.includes('energy'));
});

test('app/settings discovery metadata benchmark reports parity and subprocess counts', async () => {
  const legacyCold = await runFreshDiscoveryScenario('legacy/no metadata cache cold full refresh', false);
  const optimizedCold = await runFreshDiscoveryScenario('optimized cold/no disk cache', true);
  const staleRefresh = await runDiscoveryScenario('optimized stale-cache background refresh');
  const quickInvalidation = await runDiscoveryScenario('optimized quick structural invalidation');
  commandsModule.__setApplicationSearchScopeForTesting([appsRoot, extraAppsRoot]);
  globalThis.__superCmdApplicationScope = [appsRoot, extraAppsRoot];
  const scopeChange = await runDiscoveryScenario('optimized app-search-scope change');

  assert.deepEqual(optimizedCold.fingerprint, legacyCold.fingerprint);
  assert.deepEqual(staleRefresh.fingerprint, optimizedCold.fingerprint);
  assert.deepEqual(quickInvalidation.fingerprint, optimizedCold.fingerprint);
  assert.equal(optimizedCold.commandSummary.apps, 2);
  assert.equal(optimizedCold.commandSummary.settings, 3);
  assert.equal(optimizedCold.commandSummary.total, 5);
  assert.equal(scopeChange.commandSummary.apps, 3);
  assert.equal(scopeChange.fingerprint.some((command) => command.id === 'app-hidden'), false);
  assert.equal(scopeChange.fingerprint.some((command) => command.id === 'app-gamma'), true);
  assert.equal(optimizedCold.fingerprint.every((command) => command.hasBundlePath), true);

  const report = {
    fixtureBundles: {
      apps: 4,
      settingsExtensions: 1,
      prefPanes: 2,
    },
    legacyCold,
    optimizedCold,
    staleRefresh,
    quickInvalidation,
    scopeChange,
    discoveredCommandParity: JSON.stringify(legacyCold.fingerprint) === JSON.stringify(optimizedCold.fingerprint),
  };

  console.log('Command discovery metadata benchmark', JSON.stringify(report));
});
