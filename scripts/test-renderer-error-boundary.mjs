#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainTsx = fs.readFileSync('src/renderer/src/main.tsx', 'utf8');

function assertIncludes(source, needle) {
  assert.ok(source.includes(needle), `Source should include: ${needle}`);
}

test('Renderer error boundary auto-recovery', async (t) => {
  await t.test('budget constants are defined', () => {
    assertIncludes(mainTsx, "const RELOAD_TRACKER_KEY = 'sc-renderer-reload-tracker';");
    assertIncludes(mainTsx, 'const RELOAD_WINDOW_MS = 30_000;');
    assertIncludes(mainTsx, 'const MAX_AUTO_RELOADS = 3;');
    assertIncludes(mainTsx, 'const STABLE_SESSION_MS = 15_000;');
  });

  await t.test('budget is tracked in sessionStorage so it survives the reload', () => {
    assertIncludes(mainTsx, 'sessionStorage.getItem(RELOAD_TRACKER_KEY)');
    assertIncludes(mainTsx, 'sessionStorage.setItem(RELOAD_TRACKER_KEY');
  });

  await t.test('budget window resets after RELOAD_WINDOW_MS', () => {
    assertIncludes(mainTsx, 'now - tracker.firstAt > RELOAD_WINDOW_MS');
  });

  await t.test('reloads are capped at MAX_AUTO_RELOADS', () => {
    assertIncludes(mainTsx, 'if (tracker.count >= MAX_AUTO_RELOADS) return false;');
  });

  await t.test('budget read failure does not risk an unbounded reload loop', () => {
    // The catch returns false (no auto-reload) when sessionStorage is unavailable.
    assertIncludes(mainTsx, 'function consumeAutoReloadBudget()');
    assertIncludes(mainTsx, 'return false;');
  });

  await t.test('a stable session clears the budget', () => {
    assertIncludes(mainTsx, 'function clearAutoReloadBudget()');
    assertIncludes(mainTsx, 'setTimeout(clearAutoReloadBudget, STABLE_SESSION_MS)');
  });

  await t.test('render crash auto-reloads when budget allows', () => {
    assertIncludes(mainTsx, 'if (consumeAutoReloadBudget()) {');
    assertIncludes(mainTsx, 'window.location.reload();');
  });

  await t.test('a quiet placeholder is shown while reloading (no crash flash)', () => {
    assertIncludes(mainTsx, 'this.setState({ reloading: true });');
    assertIncludes(mainTsx, 'if (this.state.reloading) return <RendererRecovering />;');
  });

  await t.test('falls back to the manual error card when budget is exhausted', () => {
    assertIncludes(mainTsx, 'return <RendererErrorFallback error={this.state.error} />;');
  });
});
