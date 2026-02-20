import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SpawnCall = {
  command: string;
  args: string[];
  opts: any;
  proc: any;
};

type SpawnScenario = (ctx: { command: string; args: string[]; opts: any; proc: any }) => void;

const mocks = vi.hoisted(() => {
  let userDataDir = '';
  const spawnScenarios: SpawnScenario[] = [];
  const spawnCalls: SpawnCall[] = [];

  return {
    setUserDataDir(value: string) {
      userDataDir = value;
    },
    queueSpawnScenario(scenario: SpawnScenario) {
      spawnScenarios.push(scenario);
    },
    resetSpawn() {
      spawnScenarios.length = 0;
      spawnCalls.length = 0;
    },
    getSpawnCalls(): SpawnCall[] {
      return spawnCalls;
    },
    appGetPath: vi.fn((_name: string) => userDataDir),
    spawn: vi.fn((command: string, args: string[], opts: any) => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn(() => {
        proc.killed = true;
      });

      spawnCalls.push({ command, args, opts, proc });

      const scenario = spawnScenarios.shift();
      if (scenario) {
        setTimeout(() => {
          scenario({ command, args, opts, proc });
        }, 0);
      } else {
        setTimeout(() => {
          proc.emit('close', 0);
        }, 0);
      }

      return proc;
    }),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: mocks.appGetPath,
  },
}));

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}));

async function loadRunner() {
  return import('../script-command-runner');
}

function writeExecutable(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: 'utf-8', mode: 0o755 });
}

let tempDir = '';
let scriptRoot = '';
let originalPaths = '';
let originalHome = '';

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-runner-test-'));
  scriptRoot = path.join(tempDir, 'fixtures');
  fs.mkdirSync(scriptRoot, { recursive: true });

  mocks.setUserDataDir(path.join(tempDir, 'user-data'));

  originalPaths = process.env.SUPERCMD_SCRIPT_COMMAND_PATHS || '';
  process.env.SUPERCMD_SCRIPT_COMMAND_PATHS = scriptRoot;

  originalHome = process.env.HOME || '';
  process.env.HOME = path.join(tempDir, 'home');
  fs.mkdirSync(process.env.HOME, { recursive: true });

  mocks.resetSpawn();
  vi.resetModules();
});

afterEach(() => {
  process.env.SUPERCMD_SCRIPT_COMMAND_PATHS = originalPaths;
  process.env.HOME = originalHome;
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('discoverScriptCommands', () => {
  it('parses valid metadata and normalizes mode/refresh/arguments', async () => {
    const runner = await loadRunner();

    const validScript = path.join(scriptRoot, 'My Script.sh');
    writeExecutable(
      validScript,
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Build Report
# @raycast.mode inline
# @raycast.refreshTime 5s
# @raycast.packageName Utilities
# @raycast.description Generates report output
# @raycast.needsConfirmation true
# @raycast.argument1 {"type":"text","placeholder":"Name","required":true,"percentEncoded":true}
# @raycast.argument2 {"type":"dropdown","placeholder":"Env","optional":true,"data":[{"title":"Prod","value":"prod"}]}

echo "ok"
`
    );

    const compactInlineNoRefresh = path.join(scriptRoot, 'Quick Task.sh');
    writeExecutable(
      compactInlineNoRefresh,
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Quick Task
# @raycast.mode inline

echo "ok"
`
    );

    writeExecutable(
      path.join(scriptRoot, 'invalid-no-schema.sh'),
      `#!/bin/bash
# @raycast.title Invalid
# @raycast.mode fullOutput
`
    );

    writeExecutable(
      path.join(scriptRoot, 'invalid-mode.sh'),
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Invalid Mode
# @raycast.mode nope
`
    );

    const commands = runner.discoverScriptCommands();
    expect(commands).toHaveLength(2);

    const build = commands.find((cmd) => cmd.title === 'Build Report');
    expect(build).toBeTruthy();
    expect(build?.mode).toBe('inline');
    expect(build?.refreshTime).toBe('10s');
    expect(build?.interval).toBe('10s');
    expect(build?.slug).toBe('my-script');
    expect(build?.id.startsWith('script-')).toBe(true);
    expect(build?.needsConfirmation).toBe(true);
    expect(build?.keywords).toContain('build');
    expect(build?.keywords).toContain('script');
    expect(build?.arguments).toEqual([
      {
        name: 'argument1',
        index: 1,
        type: 'text',
        placeholder: 'Name',
        required: true,
        percentEncoded: true,
        data: undefined,
      },
      {
        name: 'argument2',
        index: 2,
        type: 'dropdown',
        placeholder: 'Env',
        required: false,
        percentEncoded: undefined,
        data: [{ title: 'Prod', value: 'prod' }],
      },
    ]);

    const quick = commands.find((cmd) => cmd.title === 'Quick Task');
    expect(quick?.mode).toBe('compact');
    expect(quick?.refreshTime).toBeUndefined();
  });

  it('ignores hidden/template/node_modules/.git files', async () => {
    const runner = await loadRunner();

    writeExecutable(
      path.join(scriptRoot, 'visible.sh'),
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Visible
# @raycast.mode fullOutput
`
    );

    writeExecutable(
      path.join(scriptRoot, '.hidden.sh'),
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Hidden
# @raycast.mode fullOutput
`
    );

    writeExecutable(
      path.join(scriptRoot, 'skip.template.sh'),
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Template
# @raycast.mode fullOutput
`
    );

    writeExecutable(
      path.join(scriptRoot, 'node_modules', 'ignored.sh'),
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Ignored Node
# @raycast.mode fullOutput
`
    );

    writeExecutable(
      path.join(scriptRoot, '.git', 'ignored.sh'),
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Ignored Git
# @raycast.mode fullOutput
`
    );

    const commands = runner.discoverScriptCommands();
    expect(commands.map((cmd) => cmd.title)).toEqual(['Visible']);
  });

  it('supports lookups by id and slug', async () => {
    const runner = await loadRunner();

    const scriptPath = path.join(scriptRoot, 'Lookup Command.sh');
    writeExecutable(
      scriptPath,
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Lookup Command
# @raycast.mode fullOutput
`
    );

    const [cmd] = runner.discoverScriptCommands();
    expect(runner.getScriptCommandById(cmd.id)?.title).toBe('Lookup Command');
    expect(runner.getScriptCommandBySlug('lookup-command')?.id).toBe(cmd.id);
  });

  it('uses cache until invalidated', async () => {
    const runner = await loadRunner();

    writeExecutable(
      path.join(scriptRoot, 'one.sh'),
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title One
# @raycast.mode fullOutput
`
    );

    const first = runner.discoverScriptCommands();
    expect(first).toHaveLength(1);

    writeExecutable(
      path.join(scriptRoot, 'two.sh'),
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Two
# @raycast.mode fullOutput
`
    );

    const stillCached = runner.discoverScriptCommands();
    expect(stillCached).toHaveLength(1);

    runner.invalidateScriptCommandsCache();
    const refreshed = runner.discoverScriptCommands();
    expect(refreshed).toHaveLength(2);
  });
});

describe('executeScriptCommand', () => {
  it('returns missingArguments when required args are not provided', async () => {
    const runner = await loadRunner();

    const scriptPath = path.join(scriptRoot, 'needs-arg.sh');
    writeExecutable(
      scriptPath,
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Needs Arg
# @raycast.mode fullOutput
# @raycast.argument1 {"type":"text","placeholder":"Input","required":true}
`
    );

    const [cmd] = runner.discoverScriptCommands();
    const result = await runner.executeScriptCommand(cmd.id, {});

    expect('missingArguments' in result).toBe(true);
    if ('missingArguments' in result) {
      expect(result.missingArguments).toHaveLength(1);
      expect(result.missingArguments[0].name).toBe('argument1');
    }
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('uses shebang command and percent-encodes configured arguments', async () => {
    const runner = await loadRunner();

    const scriptPath = path.join(scriptRoot, 'shebang.sh');
    writeExecutable(
      scriptPath,
      `#!/usr/bin/env bash -e
# @raycast.schemaVersion 1
# @raycast.title Shebang Test
# @raycast.mode fullOutput
# @raycast.argument1 {"type":"text","required":true,"percentEncoded":true}
`
    );

    mocks.queueSpawnScenario(({ proc }) => {
      proc.stdout.emit('data', 'ok\n');
      proc.emit('close', 0);
    });

    const [cmd] = runner.discoverScriptCommands();
    const result = await runner.executeScriptCommand(cmd.id, { argument1: 'hello world' });

    expect('exitCode' in result && result.exitCode).toBe(0);

    const [spawnCall] = mocks.getSpawnCalls();
    expect(spawnCall.command).toBe('/usr/bin/env');
    expect(spawnCall.args.slice(0, 3)).toEqual(['bash', '-e', scriptPath]);
    expect(spawnCall.args[3]).toBe('hello%20world');
  });

  it('times out, kills process, and returns exit code 124', async () => {
    vi.useFakeTimers();
    const runner = await loadRunner();

    const scriptPath = path.join(scriptRoot, 'timeout.sh');
    writeExecutable(
      scriptPath,
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Timeout Test
# @raycast.mode fullOutput
`
    );

    mocks.queueSpawnScenario(() => {
      // Intentionally never closes to trigger timeout.
    });

    const [cmd] = runner.discoverScriptCommands();
    const promise = runner.executeScriptCommand(cmd.id, {}, 50);

    await vi.advanceTimersByTimeAsync(60);
    const result = await promise;

    expect('exitCode' in result && result.exitCode).toBe(124);
    if ('exitCode' in result) {
      expect(result.stderr).toContain('Script timed out after 0s.');
    }

    const [spawnCall] = mocks.getSpawnCalls();
    expect(spawnCall.proc.kill).toHaveBeenCalled();
  });

  it('stops oversized stdout and reports 2MB limit', async () => {
    const runner = await loadRunner();

    const scriptPath = path.join(scriptRoot, 'big-output.sh');
    writeExecutable(
      scriptPath,
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Big Output
# @raycast.mode fullOutput
`
    );

    mocks.queueSpawnScenario(({ proc }) => {
      proc.stdout.emit('data', 'a'.repeat(2 * 1024 * 1024 + 64));
    });

    const [cmd] = runner.discoverScriptCommands();
    const result = await runner.executeScriptCommand(cmd.id);

    expect('exitCode' in result && result.exitCode).toBe(1);
    if ('exitCode' in result) {
      expect(result.stderr).toContain('Output exceeded 2MB limit.');
    }

    const [spawnCall] = mocks.getSpawnCalls();
    expect(spawnCall.proc.kill).toHaveBeenCalled();
  });

  it('computes firstLine, lastLine, and message from output', async () => {
    const runner = await loadRunner();

    const scriptPath = path.join(scriptRoot, 'format-output.sh');
    writeExecutable(
      scriptPath,
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Output Format
# @raycast.mode fullOutput
`
    );

    mocks.queueSpawnScenario(({ proc }) => {
      proc.stdout.emit('data', '\u001b[32mfirst\u001b[0m\nsecond\n');
      proc.stderr.emit('data', 'warn line\n');
      proc.emit('close', 0);
    });

    const [cmd] = runner.discoverScriptCommands();
    const result = await runner.executeScriptCommand(cmd.id);

    if ('exitCode' in result) {
      expect(result.firstLine).toBe('first');
      expect(result.lastLine).toBe('warn line');
      expect(result.message).toBe('warn line');
      expect(result.output).toContain('second');
      expect(result.output).toContain('warn line');
    } else {
      throw new Error('Expected execution result');
    }
  });
});
