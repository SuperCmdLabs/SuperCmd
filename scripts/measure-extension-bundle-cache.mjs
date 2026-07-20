#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iterations = Number.parseInt(process.env.SUPERCMD_EXTENSION_BUNDLE_MEASURE_ITERATIONS || '20', 10);

export function createFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-extension-bundle-cache-'));
  const userDataDir = path.join(tmpDir, 'userData');
  const extensionsDir = path.join(userDataDir, 'extensions');
  const extDir = path.join(extensionsDir, 'bundle-cache-fixture');
  const buildDir = path.join(extDir, '.sc-build');

  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(
    path.join(extDir, 'package.json'),
    JSON.stringify(
      {
        name: 'bundle-cache-fixture',
        title: 'Bundle Cache Fixture',
        description: 'Fixture for extension bundle cache measurement',
        owner: 'codex',
        commands: [
          {
            name: 'background',
            title: 'Background',
            description: 'No-view command',
            mode: 'no-view',
            preferences: [
              {
                name: 'freshCommandPref',
                title: 'Fresh Command Pref',
                type: 'textfield',
                default: 'default-command',
              },
            ],
          },
          {
            name: 'menu',
            title: 'Menu',
            description: 'Menu-bar command',
            mode: 'menu-bar',
          },
        ],
        preferences: [
          {
            name: 'freshExtensionPref',
            title: 'Fresh Extension Pref',
            type: 'textfield',
            default: 'default-extension',
          },
        ],
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(buildDir, 'background.js'), 'module.exports = { name: "background" };\n');
  fs.writeFileSync(path.join(buildDir, 'menu.js'), 'module.exports = { name: "menu" };\n');

  return { tmpDir, userDataDir, extDir };
}

export async function bundleExtensionRunner(userDataDir) {
  const outFile = path.join(
    os.tmpdir(),
    `sc-extension-runner-measure-${process.pid}-${Date.now()}.cjs`
  );

  const stubModule = (filter, source) => ({
    name: `stub-${filter}`,
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter }, () => ({
        path: filter.source,
        namespace: `stub-${filter.source}`,
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: `stub-${filter.source}` }, () => ({
        contents: source,
        loader: 'js',
      }));
    },
  });

  await build({
    entryPoints: [path.join(root, 'src/main/extension-runner.ts')],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
    plugins: [
      stubModule(
        /^electron$/,
        `
          module.exports = {
            app: {
              getPath(name) {
                if (name === 'userData') return ${JSON.stringify(userDataDir)};
                return ${JSON.stringify(userDataDir)};
              }
            }
          };
        `
      ),
      stubModule(
        /extension-preferences-store$/,
        `
          module.exports = {
            getExtensionPreferences(extName, cmdName) {
              const values = globalThis.__extensionPreferenceValues || {};
              if (cmdName) return values[extName + '/' + cmdName] || {};
              return values[extName] || {};
            }
          };
        `
      ),
      stubModule(
        /settings-store$/,
        `
          module.exports = {
            loadSettings() {
              return { customExtensionFolders: [] };
            }
          };
        `
      ),
    ],
  });

  return outFile;
}

export function createCounters(extDir) {
  const counters = {
    readFileSync: 0,
    packageJsonReads: 0,
    bundleReads: 0,
    jsonParseCalls: 0,
    existsSync: 0,
    statSync: 0,
    readdirSync: 0,
  };
  const restore = [];
  const packageJsonPath = path.join(extDir, 'package.json');
  const buildDir = path.join(extDir, '.sc-build');

  const patch = (target, key, wrapper) => {
    const original = target[key];
    target[key] = wrapper(original);
    restore.push(() => {
      target[key] = original;
    });
  };

  patch(fs, 'readFileSync', (original) => function patchedReadFileSync(filePath, ...args) {
    const normalizedPath = typeof filePath === 'string' ? filePath : String(filePath);
    counters.readFileSync++;
    if (path.resolve(normalizedPath) === packageJsonPath) counters.packageJsonReads++;
    if (path.resolve(normalizedPath).startsWith(buildDir + path.sep)) counters.bundleReads++;
    return original.call(this, filePath, ...args);
  });
  patch(fs, 'existsSync', (original) => function patchedExistsSync(filePath) {
    counters.existsSync++;
    return original.call(this, filePath);
  });
  patch(fs, 'statSync', (original) => function patchedStatSync(filePath, ...args) {
    counters.statSync++;
    return original.call(this, filePath, ...args);
  });
  patch(fs, 'readdirSync', (original) => function patchedReaddirSync(filePath, ...args) {
    counters.readdirSync++;
    return original.call(this, filePath, ...args);
  });
  patch(JSON, 'parse', (original) => function patchedJsonParse(source, ...args) {
    counters.jsonParseCalls++;
    return original.call(this, source, ...args);
  });

  return {
    counters,
    restore() {
      while (restore.length > 0) restore.pop()();
    },
  };
}

export async function measure(label, extDir, fn) {
  const { counters, restore } = createCounters(extDir);
  const started = performance.now();
  try {
    await fn();
  } finally {
    counters.elapsedMs = Number((performance.now() - started).toFixed(3));
    restore();
  }
  return { label, iterations, ...counters };
}

async function main() {
  const fixture = createFixture();
  let bundledRunner;
  try {
    bundledRunner = await bundleExtensionRunner(fixture.userDataDir);
    const runner = require(bundledRunner);

    globalThis.__extensionPreferenceValues = {
      'bundle-cache-fixture': { freshExtensionPref: 'stored-extension-1' },
      'bundle-cache-fixture/background': { freshCommandPref: 'stored-command-1' },
    };

    const noView = await measure('repeated-getExtensionBundle-no-view', fixture.extDir, async () => {
      for (let i = 0; i < iterations; i++) {
        const bundle = await runner.getExtensionBundle('bundle-cache-fixture', 'background');
        assert.equal(bundle.mode, 'no-view');
        assert.equal(bundle.preferences.freshExtensionPref, 'stored-extension-1');
        assert.equal(bundle.preferences.freshCommandPref, 'stored-command-1');
      }
    });

    const menuBar = await measure('repeated-menu-bar-background-prep', fixture.extDir, async () => {
      for (let i = 0; i < iterations; i++) {
        const commands = (await runner.discoverInstalledExtensionCommands())
          .filter((command) => command.mode === 'menu-bar');
        assert.equal(commands.length, 1);
        const bundle = await runner.getExtensionBundle(commands[0].extName, commands[0].cmdName);
        assert.equal(bundle.mode, 'menu-bar');
      }
    });

    console.log(JSON.stringify({ iterations, measurements: [noView, menuBar] }, null, 2));
  } finally {
    try {
      if (bundledRunner) fs.unlinkSync(bundledRunner);
    } catch {}
    try {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
