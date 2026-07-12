#!/usr/bin/env node

import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { promisify } = require('util');

const autoQuitManagerPath = path.resolve('src/main/auto-quit-manager.ts');
const metricsMode = process.argv.includes('--metrics');

function loadAutoQuitManager({
  frontmostBundleId = 'com.apple.finder',
  recording = false,
  musicPlaying = false,
} = {}) {
  let now = 0;
  let intervalCallback = null;
  const counts = {
    frontmost: 0,
    recording: 0,
    music: 0,
    quit: 0,
    other: 0,
    osascript: 0,
  };
  const quits = [];

  function classifyAppleScript(args) {
    const script = Array.isArray(args) ? args.join('\n') : '';
    if (script.includes('frontmost is true')) return 'frontmost';
    if (script.includes('AppleHDAEngineInput')) return 'recording';
    if (script.includes('player state is playing')) return 'music';
    if (script.includes('runningApplications()')) return 'quit';
    return 'other';
  }

  function execFile() {
    throw new Error('execFile callback form is not supported by this test harness');
  }

  execFile[promisify.custom] = async (file, args) => {
    if (file === '/usr/bin/osascript') {
      counts.osascript += 1;
      const kind = classifyAppleScript(args);
      counts[kind] += 1;
      if (kind === 'frontmost') return { stdout: `${frontmostBundleId}\n`, stderr: '' };
      if (kind === 'recording') return { stdout: recording ? '1\n' : '0\n', stderr: '' };
      if (kind === 'music') return { stdout: musicPlaying ? 'true\n' : 'false\n', stderr: '' };
      if (kind === 'quit') {
        const script = args.at(-1) || '';
        const match = script.match(/if bid is "([^"]+)"/);
        quits.push(match?.[1] || 'unknown');
        return { stdout: '', stderr: '' };
      }
    }
    return { stdout: '', stderr: '' };
  };

  const source = fs.readFileSync(autoQuitManagerPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: autoQuitManagerPath,
  });

  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === 'child_process') return { execFile };
    return require(request);
  };
  const testDate = {
    now: () => now,
  };
  const sandbox = {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    Date: testDate,
    setInterval: (callback) => {
      intervalCallback = callback;
      return { callback };
    },
    clearInterval: (interval) => {
      if (interval?.callback === intervalCallback) intervalCallback = null;
    },
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: autoQuitManagerPath });

  return {
    counts,
    quits,
    module: module.exports,
    advance(ms) {
      now += ms;
    },
    async tick() {
      assert.equal(typeof intervalCallback, 'function', 'auto-quit interval should be running');
      await intervalCallback();
    },
  };
}

async function runNoTrackedAppDueScenario() {
  const harness = loadAutoQuitManager();
  harness.module.startAutoQuit([
    {
      bundleId: 'com.example.editor',
      appName: 'Example Editor',
      appPath: '/Applications/Example Editor.app',
      timeoutSeconds: 60,
    },
  ]);

  for (let i = 0; i < 3; i += 1) {
    harness.advance(5000);
    await harness.tick();
  }

  harness.module.stopAutoQuit();
  return { counts: harness.counts, quits: harness.quits };
}

async function runOneNonMusicAppDueScenario() {
  const harness = loadAutoQuitManager({ frontmostBundleId: 'com.apple.finder' });
  harness.module.startAutoQuit([
    {
      bundleId: 'com.example.editor',
      appName: 'Example Editor',
      appPath: '/Applications/Example Editor.app',
      timeoutSeconds: 5,
    },
  ]);

  harness.advance(5000);
  await harness.tick();

  harness.module.stopAutoQuit();
  return { counts: harness.counts, quits: harness.quits };
}

async function runNonMusicDueWithMusicTrackedButNotDueScenario() {
  const harness = loadAutoQuitManager({ frontmostBundleId: 'com.apple.finder' });
  harness.module.startAutoQuit([
    {
      bundleId: 'com.example.editor',
      appName: 'Example Editor',
      appPath: '/Applications/Example Editor.app',
      timeoutSeconds: 5,
    },
    {
      bundleId: 'com.spotify.client',
      appName: 'Spotify',
      appPath: '/Applications/Spotify.app',
      timeoutSeconds: 60,
    },
  ]);

  harness.advance(5000);
  await harness.tick();

  harness.module.stopAutoQuit();
  return { counts: harness.counts, quits: harness.quits };
}

async function runDueAppIsFrontmostScenario() {
  const harness = loadAutoQuitManager({ frontmostBundleId: 'com.example.editor' });
  harness.module.startAutoQuit([
    {
      bundleId: 'com.example.editor',
      appName: 'Example Editor',
      appPath: '/Applications/Example Editor.app',
      timeoutSeconds: 5,
    },
  ]);

  harness.advance(5000);
  await harness.tick();

  harness.module.stopAutoQuit();
  return { counts: harness.counts, quits: harness.quits };
}

async function runMusicAppDueAndPlayingScenario() {
  const harness = loadAutoQuitManager({
    frontmostBundleId: 'com.apple.finder',
    musicPlaying: true,
  });
  harness.module.startAutoQuit([
    {
      bundleId: 'com.spotify.client',
      appName: 'Spotify',
      appPath: '/Applications/Spotify.app',
      timeoutSeconds: 5,
    },
  ]);

  harness.advance(5000);
  await harness.tick();

  harness.module.stopAutoQuit();
  return { counts: harness.counts, quits: harness.quits };
}

function compactCounts({ counts, quits }) {
  return {
    osascript: counts.osascript,
    frontmost: counts.frontmost,
    recording: counts.recording,
    music: counts.music,
    quit: counts.quit,
    quitBundleIds: quits,
  };
}

async function printMetrics() {
  const metrics = {
    noTrackedAppDueOver3Ticks: compactCounts(await runNoTrackedAppDueScenario()),
    oneNonMusicAppDue: compactCounts(await runOneNonMusicAppDueScenario()),
  };
  console.log(JSON.stringify(metrics, null, 2));
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('skips AppleScript probes while no tracked app is due', async () => {
  const result = await runNoTrackedAppDueScenario();
  assert.deepEqual(compactCounts(result), {
    osascript: 0,
    frontmost: 0,
    recording: 0,
    music: 0,
    quit: 0,
    quitBundleIds: [],
  });
});

test('only probes frontmost, recording, and quit for a due non-music app', async () => {
  const result = await runOneNonMusicAppDueScenario();
  assert.deepEqual(compactCounts(result), {
    osascript: 3,
    frontmost: 1,
    recording: 1,
    music: 0,
    quit: 1,
    quitBundleIds: ['com.example.editor'],
  });
});

test('does not check music when only non-music candidates are due', async () => {
  const result = await runNonMusicDueWithMusicTrackedButNotDueScenario();
  assert.deepEqual(compactCounts(result), {
    osascript: 3,
    frontmost: 1,
    recording: 1,
    music: 0,
    quit: 1,
    quitBundleIds: ['com.example.editor'],
  });
});

test('does not run recording or music probes when the only due app is frontmost', async () => {
  const result = await runDueAppIsFrontmostScenario();
  assert.deepEqual(compactCounts(result), {
    osascript: 1,
    frontmost: 1,
    recording: 0,
    music: 0,
    quit: 0,
    quitBundleIds: [],
  });
});

test('checks music playback only when a due music app would otherwise quit', async () => {
  const result = await runMusicAppDueAndPlayingScenario();
  assert.deepEqual(compactCounts(result), {
    osascript: 3,
    frontmost: 1,
    recording: 1,
    music: 1,
    quit: 0,
    quitBundleIds: [],
  });
});

if (metricsMode) {
  await printMetrics();
} else {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  }
}
