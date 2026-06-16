#!/usr/bin/env node

// Behavioral test for the main-process renderer crash-recovery decision.
// This runs the evaluateRendererCrash() (the same code main.ts calls) 
// through actual crash sequences and asserts the recovery decisions it makes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  getRendererCrashState,
  evaluateRendererCrash,
  RENDERER_RECOVERY_MAX_RELOADS,
  RENDERER_RECOVERY_STABLE_SESSION_MS,
} = await importTs(path.join(root, 'src/main/renderer-recovery.ts'));

// Drive a sequence of crashes through the decision function, threading state the
// same way main.ts does, and return the list of decisions.
function runCrashes(crashes) {
  let state = getRendererCrashState();
  const decisions = [];
  for (const { reason = 'crashed', now } of crashes) {
    const d = evaluateRendererCrash(state, reason, now);
    state = d.nextState;
    decisions.push(d);
  }
  return decisions;
}

test('Renderer crash recovery (main process)', async (t) => {
  await t.test('first crash triggers a reload', () => {
    const [d] = runCrashes([{ now: 1000 }]);
    assert.equal(d.reload, true);
    assert.equal(d.giveUp, false);
  });

  await t.test('reloads up to the cap, then gives up on the next crash', () => {
    // MAX_AUTO_RELOADS rapid crashes should all reload; the one after must not.
    const crashes = [];
    for (let i = 0; i <= RENDERER_RECOVERY_MAX_RELOADS; i++) {
      crashes.push({ now: 1000 + i * 100 }); // all well within the stable window
    }
    const decisions = runCrashes(crashes);
    const reloaded = decisions.slice(0, RENDERER_RECOVERY_MAX_RELOADS);
    const lastOne = decisions[RENDERER_RECOVERY_MAX_RELOADS];

    assert.ok(reloaded.every((d) => d.reload === true), 'all crashes up to the cap reload');
    assert.equal(lastOne.reload, false, 'crash past the cap does not reload');
    assert.equal(lastOne.giveUp, true, 'and is reported as giving up');
  });

  await t.test('a crash after a quiet stretch starts a fresh burst', () => {
    // Exhaust the budget...
    const burst = [];
    for (let i = 0; i <= RENDERER_RECOVERY_MAX_RELOADS; i++) burst.push({ now: 1000 + i * 100 });
    // ...then crash again long after the stable window — should reload again.
    const afterQuiet = 1000 + RENDERER_RECOVERY_STABLE_SESSION_MS + 5000;
    burst.push({ now: afterQuiet });

    const decisions = runCrashes(burst);
    const recovered = decisions[decisions.length - 1];
    assert.equal(recovered.reload, true, 'budget resets after a quiet stretch');
    assert.equal(recovered.giveUp, false);
  });

  await t.test("'clean-exit' is ignored and does not consume the budget", () => {
    let state = getRendererCrashState();
    // A normal teardown...
    const clean = evaluateRendererCrash(state, 'clean-exit', 1000);
    assert.equal(clean.reload, false, 'clean-exit never reloads');
    assert.equal(clean.giveUp, false);
    assert.deepEqual(clean.nextState, state, 'clean-exit does not advance the budget');

    // ...followed by real crashes still gets the full reload budget.
    state = clean.nextState;
    for (let i = 0; i < RENDERER_RECOVERY_MAX_RELOADS; i++) {
      const d = evaluateRendererCrash(state, 'crashed', 2000 + i * 100);
      assert.equal(d.reload, true, `crash ${i + 1} after a clean-exit still reloads`);
      state = d.nextState;
    }
  });

  // The behavioral checks above prove the LOGIC; this guards the WIRING so the
  // logic can't be acidentally bypassed by an edit to main.ts.
  await t.test('main.ts wires the render-process-gone handler to this logic', () => {
    const mainTs = fs.readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
    assert.ok(
      mainTs.includes("mainWindow.webContents.on('render-process-gone'"),
      'render-process-gone handler is installed',
    );
    assert.ok(mainTs.includes('evaluateRendererCrash('), 'handler delegates to evaluateRendererCrash');
    assert.ok(
      mainTs.includes("mainWindow.webContents.on('unresponsive'"),
      'unresponsive handler is installed',
    );
  });
});
