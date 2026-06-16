#!/usr/bin/env node

// This runs the REAL consumeAutoReloadBudget() / clearAutoReloadBudget() 
// (the same code the error boundary calls) against an in-memory sessionStorage 
// and asserts the actual reload decisions.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  consumeAutoReloadBudget,
  clearAutoReloadBudget,
  MAX_AUTO_RELOADS,
  RELOAD_WINDOW_MS,
  RELOAD_TRACKER_KEY,
} = await importTs(path.join(root, 'src/renderer/src/utils/reload-budget.ts'));

// A minimal in-memory stand-in for sessionStorage.
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

// Storage that throws on every access (e.g. sessionStorage disabled/wedged).
const throwingStorage = {
  getItem() { throw new Error('storage unavailable'); },
  setItem() { throw new Error('storage unavailable'); },
  removeItem() { throw new Error('storage unavailable'); },
};

test('Renderer error boundary auto-reload budget', async (t) => {
  await t.test('allows reloads up to the cap, then denies', () => {
    const storage = makeStorage();
    const now = 1000;
    const results = [];
    // One more attempt than the cap allows.
    for (let i = 0; i < MAX_AUTO_RELOADS + 1; i++) {
      results.push(consumeAutoReloadBudget(storage, now + i)); // all in the same window
    }
    const allowed = results.slice(0, MAX_AUTO_RELOADS);
    assert.ok(allowed.every((r) => r === true), `first ${MAX_AUTO_RELOADS} reloads allowed`);
    assert.equal(results[MAX_AUTO_RELOADS], false, 'reload past the cap is denied');
  });

  await t.test('budget resets after the reload window elapses', () => {
    const storage = makeStorage();
    const start = 1000;
    // Exhaust the budget.
    for (let i = 0; i < MAX_AUTO_RELOADS; i++) consumeAutoReloadBudget(storage, start + i);
    assert.equal(consumeAutoReloadBudget(storage, start + 10), false, 'exhausted within window');

    // After RELOAD_WINDOW_MS, a fresh crash gets a fresh budget.
    const later = start + RELOAD_WINDOW_MS + 1;
    assert.equal(consumeAutoReloadBudget(storage, later), true, 'budget resets after the window');
  });

  await t.test('clearAutoReloadBudget restores a full budget mid-window', () => {
    const storage = makeStorage();
    const now = 1000;
    for (let i = 0; i < MAX_AUTO_RELOADS; i++) consumeAutoReloadBudget(storage, now + i);
    assert.equal(consumeAutoReloadBudget(storage, now + 5), false, 'exhausted');

    clearAutoReloadBudget(storage);
    assert.equal(storage.getItem(RELOAD_TRACKER_KEY), null, 'tracker is cleared');
    assert.equal(consumeAutoReloadBudget(storage, now + 6), true, 'full budget after clear');
  });

  await t.test('denies the reload when storage is unavailable (no unbounded loop)', () => {
    // A wedged sessionStorage must NOT grant a reload — otherwise every crash
    // would reload forever. Must return false, not throw.
    assert.equal(consumeAutoReloadBudget(throwingStorage, 1000), false);
  });

  await t.test('clearAutoReloadBudget swallows storage errors', () => {
    assert.doesNotThrow(() => clearAutoReloadBudget(throwingStorage));
  });

  // Guard the wiring so the boundary can't be silently disconnected from this
  // budget by an edit to main.tsx.
  await t.test('main.tsx wires the error boundary to this budget', () => {
    const mainTsx = fs.readFileSync(path.join(root, 'src/renderer/src/main.tsx'), 'utf8');
    assert.ok(mainTsx.includes('consumeAutoReloadBudget'), 'boundary consumes the budget');
    assert.ok(mainTsx.includes('window.location.reload()'), 'boundary reloads on crash');
    assert.ok(
      mainTsx.includes('return <RendererErrorFallback error={this.state.error} />;'),
      'falls back to the manual error card when the budget is exhausted',
    );
  });
});
