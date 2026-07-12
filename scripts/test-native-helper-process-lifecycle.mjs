#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const mainPath = path.resolve('src/main/main.ts');
const mainSource = fs.readFileSync(mainPath, 'utf8');

const helpers = [
  {
    label: 'Parakeet',
    ensure: 'ensureParakeetServer',
    kill: 'killParakeetServer',
    processVar: 'parakeetServerProcess',
  },
  {
    label: 'Qwen3',
    ensure: 'ensureQwen3Server',
    kill: 'killQwen3Server',
    processVar: 'qwen3ServerProcess',
  },
  {
    label: 'Whisper.cpp',
    ensure: 'ensureWhisperCppServer',
    kill: 'killWhisperCppServer',
    processVar: 'whisperCppServerProcess',
  },
  {
    label: 'Audio capturer',
    ensure: 'warmAudioCapturer',
    kill: 'killAudioCapturer',
    processVar: 'audioCapturerProcess',
  },
];

function extractFunction(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`Could not find end of ${functionName}`);
}

function expectContains(haystack, needle, message) {
  assert.ok(haystack.includes(needle), `${message}\nExpected to find: ${needle}`);
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

class FakeChild extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.killed = false;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = {
      writes: [],
      write: (value) => {
        this.stdin.writes.push(value);
      },
    };
  }

  kill() {
    this.killed = true;
  }
}

function createLifecycleHarness({ guarded, label }) {
  let activeProcess = null;
  let ready = false;
  let starting = null;
  let buffer = '';
  let pendingRequest = null;
  const rejections = [];

  function rejectPending(message) {
    if (!pendingRequest) return;
    pendingRequest.reject(new Error(message));
    pendingRequest = null;
  }

  function attach(child) {
    child.on('exit', (code) => {
      if (guarded && activeProcess !== child) return;
      ready = false;
      activeProcess = null;
      starting = null;
      buffer = '';
      rejectPending(`${label} exited with code ${code}`);
    });

    child.stdout.on('data', (chunk) => {
      if (guarded && activeProcess !== child) return;
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const json = JSON.parse(trimmed);
        if (json.ready) {
          ready = true;
          continue;
        }
        if (pendingRequest) {
          const req = pendingRequest;
          pendingRequest = null;
          req.resolve(json);
        }
      }
    });
  }

  return {
    spawn(name) {
      const child = new FakeChild(name);
      activeProcess = child;
      ready = false;
      starting = Promise.resolve();
      attach(child);
      return child;
    },
    kill(childToKill = activeProcess) {
      if (childToKill) {
        childToKill.stdin.write('{"command":"exit"}\n');
        childToKill.kill();
      }
      if (guarded && childToKill && activeProcess !== childToKill) return;
      activeProcess = null;
      ready = false;
      starting = null;
      buffer = '';
      rejectPending(`${label} killed`);
    },
    setPending() {
      pendingRequest = {
        resolve: () => {},
        reject: (error) => {
          rejections.push(error.message);
        },
      };
    },
    get activeProcess() {
      return activeProcess;
    },
    get ready() {
      return ready;
    },
    get starting() {
      return starting;
    },
    get pendingRequest() {
      return pendingRequest;
    },
    get rejections() {
      return rejections;
    },
  };
}

test('native helper lifecycle source uses active-child guards', () => {
  for (const helper of helpers) {
    const killSource = extractFunction(mainSource, helper.kill);
    const ensureSource = extractFunction(mainSource, helper.ensure);

    expectContains(
      killSource,
      `${helper.kill}(processToKill: any = ${helper.processVar})`,
      `${helper.label} kill helper should accept the child being killed`
    );
    expectContains(
      killSource,
      `if (processToKill && ${helper.processVar} !== processToKill) return;`,
      `${helper.label} kill helper should not clear replacement state for a stale child`
    );
    assert.ok(
      countOccurrences(ensureSource, `if (${helper.processVar} !== child) return;`) >= 2,
      `${helper.label} exit and stdout handlers should ignore stale child events`
    );
    expectContains(
      ensureSource,
      `${helper.kill}(child);`,
      `${helper.label} startup timeout should only kill the child it started`
    );
    expectContains(
      ensureSource,
      `if (${helper.processVar} !== child) {`,
      `${helper.label} startup wait should detect a superseded child by identity`
    );
  }
});

test('legacy reproduction shows why stale exits are dangerous', () => {
  const harness = createLifecycleHarness({ guarded: false, label: 'legacy helper' });
  const oldChild = harness.spawn('old');
  harness.kill(oldChild);
  const replacement = harness.spawn('replacement');
  harness.setPending();

  oldChild.emit('exit', 0);

  assert.equal(harness.activeProcess, null);
  assert.equal(harness.pendingRequest, null);
  assert.deepEqual(harness.rejections, ['legacy helper exited with code 0']);
  assert.notEqual(replacement, null);
});

test('guarded lifecycle preserves replacement process and pending request', () => {
  for (const helper of helpers) {
    const harness = createLifecycleHarness({ guarded: true, label: helper.label });
    const oldChild = harness.spawn('old');
    harness.kill(oldChild);
    const replacement = harness.spawn('replacement');
    harness.setPending();

    oldChild.emit('exit', 0);
    oldChild.stdout.emit('data', Buffer.from('{"ready":true}\n'));

    assert.equal(harness.activeProcess, replacement, `${helper.label} replacement should remain active`);
    assert.equal(harness.ready, false, `${helper.label} stale stdout should not mark replacement ready`);
    assert.notEqual(harness.starting, null, `${helper.label} replacement startup should remain tracked`);
    assert.notEqual(harness.pendingRequest, null, `${helper.label} replacement pending request should remain pending`);
    assert.deepEqual(harness.rejections, [], `${helper.label} stale exit should not reject replacement request`);
  }
});
