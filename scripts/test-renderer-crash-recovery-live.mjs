#!/usr/bin/env node

// END-TO-END reproduction of the blank-window bug. This launches a real
// Electron process, opens a window, crashes its renderer for real with
// process.crash(), and asserts the window recovers and paints content again —
// running the actual production recovery logic against an actual crashed
// renderer rather than asserting on source text.
//
// It's heavier than the pure-logic tests, so it self-skips when Electron can't
// be launched (e.g. a headless CI box with no display, or
// SUPERCMD_SKIP_ELECTRON_TESTS=1).

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = path.join(root, 'scripts/fixtures/crash-recovery-harness.cjs');

function resolveElectronBinary() {
  try {
    // The 'electron' package's main export is the path to the binary.
    const require = createRequire(import.meta.url);
    const electronPath = require('electron');
    return typeof electronPath === 'string' ? electronPath : null;
  } catch {
    return null;
  }
}

const electronBin = resolveElectronBinary();
const shouldSkip = !electronBin || process.env.SUPERCMD_SKIP_ELECTRON_TESTS === '1'
  || (process.platform === 'linux' && !process.env.DISPLAY);

function runHarness() {
  return new Promise((resolve) => {
    // Strip ELECTRON_RUN_AS_NODE — if it leaks in from the parent, Electron runs
    // as plain Node and `require('electron')` yields no app/BrowserWindow.
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronBin, [harness], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const killTimer = setTimeout(() => child.kill('SIGKILL'), 30000);

    child.on('close', () => {
      clearTimeout(killTimer);
      const line = stdout.split('\n').find((l) => l.startsWith('RESULT '));
      if (!line) {
        resolve({ ok: false, error: 'no-result', stdout, stderr });
        return;
      }
      try {
        resolve(JSON.parse(line.slice('RESULT '.length)));
      } catch (err) {
        resolve({ ok: false, error: 'bad-result: ' + String(err), stdout, stderr });
      }
    });
  });
}

test('Renderer crash recovery (live Electron)', { skip: shouldSkip ? 'Electron not launchable here' : false }, async (t) => {
  const result = await runHarness();

  await t.test('the renderer actually crashed', () => {
    assert.equal(result.crashObserved, true, `expected a real crash; got ${JSON.stringify(result)}`);
  });

  await t.test('the window recovered and painted content again (not blank)', () => {
    assert.equal(result.ok, true, `window did not recover: ${JSON.stringify(result)}`);
    assert.equal(result.paintedText, 'RENDERED', 'recovered renderer painted its content');
    assert.ok(result.mountCount >= 2, 'renderer mounted again after the crash');
  });
});
