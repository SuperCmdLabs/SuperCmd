#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainTs = fs.readFileSync('src/main/main.ts', 'utf8');

function assertIncludes(source, needle) {
  assert.ok(source.includes(needle), `Source should include: ${needle}`);
}

test('Renderer crash recovery', async (t) => {
  await t.test('render-process-gone handler exists', () => {
    assertIncludes(mainTs, "mainWindow.webContents.on('render-process-gone'");
  });

  await t.test('handler checks isAppQuitting to avoid recovery during shutdown', () => {
    assertIncludes(mainTs, 'if (isAppQuitting) return;');
  });

  await t.test('clean-exit is handled (normal shutdown)', () => {
    assertIncludes(mainTs, "if (reason === 'clean-exit') return;");
  });

  await t.test('rate-limiting prevents crash loops', () => {
    assertIncludes(mainTs, 'rendererReloadCount');
    assertIncludes(mainTs, 'if (now - lastRendererReloadAt > THIRTY_SECONDS) rendererReloadCount = 0;');
    assertIncludes(mainTs, 'if (rendererReloadCount > 3)');
  });

  await t.test('reload is called after crash', () => {
    assertIncludes(mainTs, 'loadWindowUrl(mainWindow, \'/\');');
  });

  await t.test('reload is DEFERRED out of the crash callback (avoids Mach SIGTRAP)', () => {
    // Reloading synchronously inside render-process-gone respawns the renderer
    // mid-teardown and aborts the whole app on macOS. The reload must be in a
    // setTimeout, with a re-guard against isAppQuitting/destroyed at fire time.
    assertIncludes(mainTs, 'const RENDERER_RECOVERY_DELAY_MS =');
    assertIncludes(mainTs, '}, RENDERER_RECOVERY_DELAY_MS);');
  });

  await t.test('unresponsive handler exists', () => {
    assertIncludes(mainTs, "mainWindow.webContents.on('unresponsive'");
  });

  await t.test('unresponsive only reloads while hidden', () => {
    assertIncludes(mainTs, 'if (isVisible) return;');
  });

  await t.test('unresponsive calls reloadIgnoringCache', () => {
    assertIncludes(mainTs, 'mainWindow.webContents.reloadIgnoringCache()');
  });
});
