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
  await t.test('parses Raycast metadata and argument definitions from command headers', async (t) => {
    const { module: runner, scriptsDir } = await withScriptCommandRunner(t, {
      'metadata.js': `#!/usr/bin/env node --no-warnings
${scriptHeader({
  title: 'Deploy Helper',
  prefix: '//',
  extra: `// @raycast.packageName Ops Tools
// @raycast.icon 🚀
// @raycast.description Deploys a selected environment
// @raycast.needsConfirmation yes
// @raycast.currentDirectoryPath ./workdir
// @raycast.argument1 {"type":"text","placeholder":"Service","required":true}
// @raycast.argument2 {"type":"dropdown","placeholder":"Environment","optional":true,"data":[{"title":"Production","value":"prod"},{"title":"Staging","value":"staging"}]}
`,
})}
console.log('ok');
`,
    });
    fs.mkdirSync(path.join(scriptsDir, 'workdir'), { recursive: true });

    const commands = runner.discoverScriptCommands();
    assert.equal(commands.length, 1);
    const command = commands[0];
    assert.equal(command.title, 'Deploy Helper');
    assert.equal(command.mode, 'fullOutput');
    assert.equal(command.packageName, 'Ops Tools');
    assert.equal(command.iconEmoji, '🚀');
    assert.equal(command.description, 'Deploys a selected environment');
    assert.equal(command.needsConfirmation, true);
    assert.equal(command.currentDirectoryPath, path.join(scriptsDir, 'workdir'));
    assert.equal(command.interpreter, '/usr/bin/env');
    assert.deepEqual(command.interpreterArgs, ['node', '--no-warnings']);
    assert.deepEqual(command.arguments, [
      {
        name: 'argument1',
        index: 1,
        type: 'text',
        placeholder: 'Service',
        required: true,
        percentEncoded: undefined,
        data: undefined,
      },
      {
        name: 'argument2',
        index: 2,
        type: 'dropdown',
        placeholder: 'Environment',
        required: false,
        percentEncoded: undefined,
        data: [
          { title: 'Production', value: 'prod' },
          { title: 'Staging', value: 'staging' },
        ],
      },
    ]);
  });

  await t.test('executes shebang scripts with a bounded first-line interpreter lookup', async (t) => {
    const { module: runner, metrics, resetMetrics } = await withScriptCommandRunner(t, {
      'with-shebang.sh': `#!/bin/bash
${scriptHeader({ title: 'Shebang Command' })}
echo "shebang:$RAYCAST_TITLE"
`,
    }, { instrumentFs: true });

    const [command] = runner.discoverScriptCommands();
    assert.equal(command.interpreter, '/bin/bash');
    assert.deepEqual(command.interpreterArgs, []);

    resetMetrics();
    const result = await runner.executeScriptCommand(command.id);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), 'shebang:Shebang Command');
    assert.equal(metrics.readFileSyncBytes, 0);
    assert.ok(
      metrics.readSyncBytes <= 8 * 1024,
      `expected only a bounded first-line read, got ${metrics.readSyncBytes} bytes`,
    );
  });

  await t.test('uses updated shebangs within the discovery cache window', async (t) => {
    const { module: runner, scriptsDir } = await withScriptCommandRunner(t, {
      'fresh-shebang.sh': `#!/bin/sh
${scriptHeader({ title: 'Fresh Shebang' })}
[[ "$RAYCAST_TITLE" == "Fresh Shebang" ]] && echo "fresh"
`,
    });

    const [command] = runner.discoverScriptCommands();
    assert.equal(command.interpreter, '/bin/sh');

    fs.writeFileSync(path.join(scriptsDir, 'fresh-shebang.sh'), `#!/bin/bash
${scriptHeader({ title: 'Fresh Shebang' })}
[[ "$RAYCAST_TITLE" == "Fresh Shebang" ]] && echo "fresh"
`, { mode: 0o755 });

    const result = await runner.executeScriptCommand(command.id);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), 'fresh');
  });

  await t.test('uses the bash fallback when a cached shebang is removed', async (t) => {
    const { module: runner, scriptsDir } = await withScriptCommandRunner(t, {
      'removed-shebang.sh': `#!/bin/false
${scriptHeader({ title: 'Removed Shebang' })}
echo "removed"
`,
    });

    const [command] = runner.discoverScriptCommands();
    assert.equal(command.interpreter, '/bin/false');

    fs.writeFileSync(path.join(scriptsDir, 'removed-shebang.sh'), `${scriptHeader({ title: 'Removed Shebang' })}
echo "removed"
`, { mode: 0o755 });

    const result = await runner.executeScriptCommand(command.id);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), 'removed');
  });

  await t.test('executes no-shebang scripts with the bash fallback', async (t) => {
    const { module: runner } = await withScriptCommandRunner(t, {
      'no-shebang.sh': `${scriptHeader({ title: 'No Shebang Command' })}
echo "fallback:$RAYCAST_MODE"
`,
    });

    const [command] = runner.discoverScriptCommands();
    assert.equal(command.interpreter, undefined);
    assert.deepEqual(command.interpreterArgs, []);

    const result = await runner.executeScriptCommand(command.id);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), 'fallback:fullOutput');
  });

  await t.test('discovers metadata in large scripts with bounded prefix reads', async (t) => {
    const body = `# ${'x'.repeat(1022)}\n`.repeat(2048);
    const { module: runner, metrics } = await withScriptCommandRunner(t, {
      'large.sh': `#!/bin/bash
${scriptHeader({ title: 'Large Command' })}
exit 0
${body}
`,
    }, { instrumentFs: true });

    const commands = runner.discoverScriptCommands();
    assert.equal(commands.length, 1);
    assert.equal(commands[0].title, 'Large Command');
    assert.equal(metrics.readFileSyncBytes, 0);
    assert.ok(
      metrics.readSyncBytes < 512 * 1024,
      `expected a bounded prefix read, got ${metrics.readSyncBytes} bytes`,
    );
  });
});
