#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import {
  bundleExtensionRunner,
} from './measure-extension-bundle-cache.mjs';

const require = createRequire(import.meta.url);
const Module = require('node:module');

function createBuildFixture(commandCount) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sc-extension-multi-build-${commandCount}-`));
  const userDataDir = path.join(tmpDir, 'userData');
  const extName = `multi-build-fixture-${commandCount}`;
  const extDir = path.join(userDataDir, 'extensions', extName);
  const srcDir = path.join(extDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  const commands = Array.from({ length: commandCount }, (_unused, index) => {
    const name = `command-${index}`;
    fs.writeFileSync(
      path.join(srcDir, `${name}.ts`),
      [
        `export default async function ${name.replace(/-/g, '_')}() {`,
        `  return ${JSON.stringify(name)};`,
        `}`,
        '',
      ].join('\n')
    );
    return {
      name,
      title: `Command ${index}`,
      description: `Command ${index}`,
      mode: 'view',
    };
  });

  fs.writeFileSync(
    path.join(extDir, 'package.json'),
    JSON.stringify(
      {
        name: extName,
        title: `Multi Build Fixture ${commandCount}`,
        description: 'Fixture for batched extension builds',
        owner: 'codex',
        commands,
      },
      null,
      2
    )
  );

  return { tmpDir, userDataDir, extDir, extName };
}

async function withBundledRunner(fixture, callback) {
  let bundledRunner;
  const esbuild = require('esbuild');
  const originalBuild = esbuild.build;
  const originalLoad = Module._load;
  const buildCalls = [];
  const patchedBuild = async function patchedBuild(options) {
    if (options?.absWorkingDir === fixture.extDir) {
      const entryCount = Array.isArray(options.entryPoints)
        ? options.entryPoints.length
        : Object.keys(options.entryPoints || {}).length;
      const entryNames = Array.isArray(options.entryPoints)
        ? options.entryPoints.map((entryPoint) => path.basename(entryPoint, path.extname(entryPoint)))
        : Object.keys(options.entryPoints || {});
      const started = performance.now();
      const result = await originalBuild.call(this, options);
      buildCalls.push({
        entryCount,
        entryNames,
        outdir: options.outdir,
        outfile: options.outfile,
        durationMs: Number((performance.now() - started).toFixed(2)),
      });
      return result;
    }
    return originalBuild.call(this, options);
  };
  Module._load = function patchedModuleLoad(request, parent, isMain) {
    if (request === 'esbuild') {
      return { ...esbuild, build: patchedBuild };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    bundledRunner = await bundleExtensionRunner(fixture.userDataDir);
    const runner = require(bundledRunner);
    return await callback({ runner, buildCalls });
  } finally {
    Module._load = originalLoad;
    try {
      if (bundledRunner) fs.unlinkSync(bundledRunner);
    } catch {}
  }
}

function readManifest(extDir) {
  return JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf-8'));
}

function writeManifest(extDir, pkg) {
  fs.writeFileSync(path.join(extDir, 'package.json'), JSON.stringify(pkg, null, 2));
}

function mutateManifest(extDir, mutator) {
  const pkg = readManifest(extDir);
  mutator(pkg);
  writeManifest(extDir, pkg);
}

test('buildAllCommands batches 1/5/20 command fixtures into one esbuild call each', async (t) => {
  for (const commandCount of [1, 5, 20]) {
    await t.test(`${commandCount} command fixture`, async () => {
      const fixture = createBuildFixture(commandCount);
      try {
        await withBundledRunner(fixture, async ({ runner, buildCalls }) => {
          const built = await runner.buildAllCommands(`multi-build-fixture-${commandCount}`, fixture.extDir);

          assert.equal(built, commandCount);
          assert.equal(buildCalls.length, 1, 'expected one esbuild invocation for all commands');
          assert.equal(buildCalls[0].entryCount, commandCount);
          assert.equal(buildCalls[0].outdir, path.join(fixture.extDir, '.sc-build'));
          assert.equal(buildCalls[0].outfile, undefined);

          for (let index = 0; index < commandCount; index += 1) {
            assert.ok(
              fs.existsSync(path.join(fixture.extDir, '.sc-build', `command-${index}.js`)),
              `expected command-${index}.js output`
            );
          }
        });
      } finally {
        try {
          fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
        } catch {}
      }
    });
  }
});

test('buildAllCommands reuses unchanged command bundles', async () => {
  const fixture = createBuildFixture(5);
  try {
    await withBundledRunner(fixture, async ({ runner, buildCalls }) => {
      assert.equal(await runner.buildAllCommands('multi-build-fixture-5', fixture.extDir), 5);
      assert.equal(await runner.buildAllCommands('multi-build-fixture-5', fixture.extDir), 5);

      assert.equal(buildCalls.length, 1, 'expected unchanged rebuild to skip esbuild');
      assert.ok(
        fs.existsSync(path.join(fixture.extDir, '.sc-build', '.sc-build-stamp.json')),
        'expected build stamp'
      );
    });
  } finally {
    fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
  }
});

test('buildAllCommands rebuilds only stale commands in a multi-command extension', async () => {
  const fixture = createBuildFixture(5);
  try {
    await withBundledRunner(fixture, async ({ runner, buildCalls }) => {
      assert.equal(await runner.buildAllCommands('multi-build-fixture-5', fixture.extDir), 5);
      const untouchedOutFile = path.join(fixture.extDir, '.sc-build', 'command-1.js');
      const untouchedBefore = fs.statSync(untouchedOutFile).mtimeMs;

      fs.appendFileSync(path.join(fixture.extDir, 'src', 'command-0.ts'), '\nexport const changed = true;\n');
      assert.equal(await runner.buildAllCommands('multi-build-fixture-5', fixture.extDir), 5);

      assert.equal(buildCalls.length, 2, 'expected one initial build and one partial rebuild');
      assert.equal(buildCalls[1].entryCount, 1, 'expected only the stale command to be rebuilt');
      assert.equal(
        fs.statSync(untouchedOutFile).mtimeMs,
        untouchedBefore,
        'expected unchanged command output to be reused'
      );
    });
  } finally {
    fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
  }
});

test('buildSingleCommand stamp lets buildAllCommands reuse on-demand bundle', async () => {
  const fixture = createBuildFixture(3);
  try {
    await withBundledRunner(fixture, async ({ runner, buildCalls }) => {
      const singleStarted = performance.now();
      assert.equal(await runner.buildSingleCommand(fixture.extName, 'command-0'), true);
      const singleElapsedMs = Number((performance.now() - singleStarted).toFixed(2));

      const fullStarted = performance.now();
      assert.equal(await runner.buildAllCommands(fixture.extName, fixture.extDir), 3);
      const fullElapsedMs = Number((performance.now() - fullStarted).toFixed(2));

      assert.equal(buildCalls.length, 2, 'expected one on-demand build and one partial full build');
      assert.equal(buildCalls[0].entryCount, 1);
      assert.deepEqual(buildCalls[0].entryNames, ['command-0']);
      assert.equal(buildCalls[0].outfile, path.join(fixture.extDir, '.sc-build', 'command-0.js'));
      assert.equal(buildCalls[1].entryCount, 2, 'expected full build to skip on-demand-stamped command');
      assert.deepEqual(buildCalls[1].entryNames.sort(), ['command-1', 'command-2']);
      assert.equal(buildCalls[1].outdir, path.join(fixture.extDir, '.sc-build'));

      const stamp = JSON.parse(
        fs.readFileSync(path.join(fixture.extDir, '.sc-build', '.sc-build-stamp.json'), 'utf-8')
      );
      assert.deepEqual(
        stamp.commands.map((command) => command.name).sort(),
        ['command-0', 'command-1', 'command-2']
      );

      console.log(JSON.stringify({
        scenario: 'on-demand-single-then-full-build',
        elapsedMs: {
          single: singleElapsedMs,
          full: fullElapsedMs,
        },
        esbuildCalls: buildCalls.map((call) => ({
          entryNames: call.entryNames,
          durationMs: call.durationMs,
        })),
      }));
    });
  } finally {
    fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
  }
});

test('buildAllCommands rebuilds when source, manifest, tsconfig, externals, or deps change', async (t) => {
  const cases = [
    {
      name: 'source',
      mutate(fixture) {
        fs.appendFileSync(path.join(fixture.extDir, 'src', 'command-0.ts'), '\nexport const changed = true;\n');
      },
    },
    {
      name: 'manifest command metadata',
      mutate(fixture) {
        mutateManifest(fixture.extDir, (pkg) => {
          pkg.commands[0].title = 'Updated Command Title';
        });
      },
    },
    {
      name: 'tsconfig',
      mutate(fixture) {
        fs.writeFileSync(
          path.join(fixture.extDir, 'tsconfig.json'),
          JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }, null, 2)
        );
      },
    },
    {
      name: 'manifest externals',
      mutate(fixture) {
        mutateManifest(fixture.extDir, (pkg) => {
          pkg.external = ['@example/native-helper'];
        });
      },
    },
    {
      name: 'dependency manifest',
      mutate(fixture) {
        fs.mkdirSync(path.join(fixture.extDir, 'node_modules'), { recursive: true });
        mutateManifest(fixture.extDir, (pkg) => {
          pkg.dependencies = { 'left-pad': '1.3.0' };
        });
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const fixture = createBuildFixture(1);
      try {
        await withBundledRunner(fixture, async ({ runner, buildCalls }) => {
          assert.equal(await runner.buildAllCommands('multi-build-fixture-1', fixture.extDir), 1);
          testCase.mutate(fixture);
          assert.equal(await runner.buildAllCommands('multi-build-fixture-1', fixture.extDir), 1);

          assert.equal(buildCalls.length, 2, `expected ${testCase.name} change to rebuild`);
        });
      } finally {
        fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
      }
    });
  }
});

test('buildAllCommands keeps pre-built output when source files are missing', async () => {
  const fixture = createBuildFixture(1);
  try {
    await withBundledRunner(fixture, async ({ runner, buildCalls }) => {
      assert.equal(await runner.buildAllCommands('multi-build-fixture-1', fixture.extDir), 1);
      const outFile = path.join(fixture.extDir, '.sc-build', 'command-0.js');
      assert.ok(fs.existsSync(outFile), 'expected initial output');

      fs.rmSync(path.join(fixture.extDir, 'src'), { recursive: true, force: true });
      assert.equal(await runner.buildAllCommands('multi-build-fixture-1', fixture.extDir), 1);

      assert.ok(fs.existsSync(outFile), 'expected pre-built output to be preserved');
      assert.equal(buildCalls.length, 1, 'expected no rebuild when only pre-built output is available');
    });
  } finally {
    fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
  }
});

test('buildAllCommands reports repeated build measurements for 1/5/20 command fixtures', async (t) => {
  const enabled = process.env.SUPERCMD_EXTENSION_BUILD_MEASURE === '1';
  if (!enabled) {
    t.skip('set SUPERCMD_EXTENSION_BUILD_MEASURE=1 to print local timing evidence');
    return;
  }

  for (const commandCount of [1, 5, 20]) {
    const fixture = createBuildFixture(commandCount);
    try {
      await withBundledRunner(fixture, async ({ runner, buildCalls }) => {
        const timingsMs = [];
        for (let index = 0; index < 3; index += 1) {
          const started = performance.now();
          assert.equal(
            await runner.buildAllCommands(`multi-build-fixture-${commandCount}`, fixture.extDir),
            commandCount
          );
          timingsMs.push(Number((performance.now() - started).toFixed(2)));
        }
        console.log(JSON.stringify({
          commandCount,
          timingsMs,
          esbuildCalls: buildCalls.length,
        }));
      });
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  }
});
