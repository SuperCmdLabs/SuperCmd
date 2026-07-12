#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadScriptCommandRunner } from './lib/script-command-runner-harness.mjs';

async function withScriptCommandRunner(t, files, { instrumentFs = false } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-script-runner-test-'));
  const scriptsDir = path.join(tempRoot, 'script-commands');
  const userDataDir = path.join(tempRoot, 'user-data');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  for (const [name, contents] of Object.entries(files)) {
    const filePath = path.join(scriptsDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, { mode: 0o755 });
  }

  const previousPaths = process.env.SUPERCMD_SCRIPT_COMMAND_PATHS;
  process.env.SUPERCMD_SCRIPT_COMMAND_PATHS = scriptsDir;
  t.after(() => {
    if (previousPaths === undefined) {
      delete process.env.SUPERCMD_SCRIPT_COMMAND_PATHS;
    } else {
      process.env.SUPERCMD_SCRIPT_COMMAND_PATHS = previousPaths;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const loaded = await loadScriptCommandRunner({
    userDataDir,
    scriptCommandFolders: [],
    instrumentFs,
  });

  return { ...loaded, scriptsDir, tempRoot };
}

function scriptHeader({
  title = 'Test Command',
  mode = 'fullOutput',
  prefix = '#',
  extra = '',
} = {}) {
  return `${prefix} @raycast.schemaVersion 1
${prefix} @raycast.title ${title}
${prefix} @raycast.mode ${mode}
${extra}`;
}

test('Script command runner', async (t) => {
  await t.test('caches file icon data across invalidated discoveries and refreshes changed icons', async (t) => {
    const { module: runner, scriptsDir, metrics, resetMetrics } = await withScriptCommandRunner(t, {}, {
      instrumentFs: true,
    });
    const iconsDir = path.join(scriptsDir, '.icons');
    const iconPath = path.join(iconsDir, 'icon.png');
    const scriptPath = path.join(scriptsDir, 'with-file-icon.sh');
    const firstIcon = Buffer.alloc(4096, 1);
    const secondIcon = Buffer.alloc(8192, 2);

    fs.mkdirSync(iconsDir, { recursive: true });
    fs.writeFileSync(iconPath, firstIcon);
    fs.writeFileSync(scriptPath, `#!/bin/bash
${scriptHeader({
  title: 'File Icon Command',
  extra: '# @raycast.icon .icons/icon.png\n',
})}
echo ok
`, { mode: 0o755 });

    resetMetrics();
    const [initialCommand] = runner.discoverScriptCommands();
    assert.equal(initialCommand.title, 'File Icon Command');
    assert.ok(initialCommand.iconDataUrl?.startsWith('data:image/png;base64,'));
    const initialReadBytes = metrics.readFileSyncBytes;
    assert.ok(
      initialReadBytes >= firstIcon.byteLength,
      `expected first discovery to read the icon, got ${initialReadBytes} bytes`,
    );

    resetMetrics();
    runner.invalidateScriptCommandsCache();
    const [cachedCommand] = runner.discoverScriptCommands();
    assert.equal(cachedCommand.iconDataUrl, initialCommand.iconDataUrl);
    assert.ok(
      metrics.readFileSyncBytes < firstIcon.byteLength,
      `expected cached discovery to skip unchanged icon bytes, got ${metrics.readFileSyncBytes} bytes`,
    );

    fs.writeFileSync(iconPath, secondIcon);
    resetMetrics();
    runner.invalidateScriptCommandsCache();
    const [changedCommand] = runner.discoverScriptCommands();
    assert.notEqual(changedCommand.iconDataUrl, initialCommand.iconDataUrl);
    assert.ok(
      metrics.readFileSyncBytes >= secondIcon.byteLength,
      `expected changed icon to be read again, got ${metrics.readFileSyncBytes} bytes`,
    );
  });

  await t.test('does not cache transient icon read failures', async (t) => {
    const { module: runner, scriptsDir, metrics, resetMetrics } = await withScriptCommandRunner(t, {}, {
      instrumentFs: true,
    });
    const iconsDir = path.join(scriptsDir, '.icons');
    const iconPath = path.join(iconsDir, 'icon.png');
    const scriptPath = path.join(scriptsDir, 'with-transient-icon.sh');
    const icon = Buffer.alloc(2048, 3);

    fs.mkdirSync(iconsDir, { recursive: true });
    fs.writeFileSync(iconPath, icon);
    fs.writeFileSync(scriptPath, `#!/bin/bash
${scriptHeader({
  title: 'Transient Icon Command',
  extra: '# @raycast.icon .icons/icon.png\n',
})}
echo ok
`, { mode: 0o755 });

    fs.chmodSync(iconPath, 0o000);
    try {
      fs.readFileSync(iconPath);
      t.skip('filesystem permits reading chmod 000 files');
      return;
    } catch {}

    resetMetrics();
    const [initialCommand] = runner.discoverScriptCommands();
    assert.equal(initialCommand.title, 'Transient Icon Command');
    assert.equal(initialCommand.iconDataUrl, undefined);
    assert.equal(metrics.readFileSyncErrors, 1);

    fs.chmodSync(iconPath, 0o644);
    resetMetrics();
    runner.invalidateScriptCommandsCache();
    const [recoveredCommand] = runner.discoverScriptCommands();
    assert.ok(recoveredCommand.iconDataUrl?.startsWith('data:image/png;base64,'));
    assert.equal(metrics.readFileSyncErrors, 0);
    assert.ok(
      metrics.readFileSyncBytes >= icon.byteLength,
      `expected readable icon to be retried, got ${metrics.readFileSyncBytes} bytes`,
    );
  });
});
