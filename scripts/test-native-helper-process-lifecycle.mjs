#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const mainPath = path.resolve('src/main/main.ts');
const mainSource = fs.readFileSync(mainPath, 'utf8');
const nativeHelperLifecyclePath = path.resolve('src/main/native-helper-lifecycle.ts');
const nativeHelperLifecycleSource = fs.readFileSync(nativeHelperLifecyclePath, 'utf8');
const NATIVE_HELPER_LINE_BUFFER_MAX_CHARS = 256 * 1024;

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

function appendBoundedLineBufferForTest(buffer, chunk, maxChars = NATIVE_HELPER_LINE_BUFFER_MAX_CHARS) {
  const combined = buffer + chunk.toString();
  const rawLines = combined.split('\n');
  let nextBuffer = rawLines.pop() ?? '';
  let truncated = false;
  const lines = [];

  for (const line of rawLines) {
    lines.push(line);
  }

  if (nextBuffer.length > maxChars) {
    nextBuffer = nextBuffer.slice(-maxChars);
    truncated = true;
  }

  return { buffer: nextBuffer, lines, truncated };
}

function appendBoundedTextBufferForTest(buffer, chunk, maxChars = NATIVE_HELPER_LINE_BUFFER_MAX_CHARS) {
  const combined = buffer + chunk.toString();
  if (combined.length <= maxChars) {
    return { buffer: combined, truncated: false };
  }
  return { buffer: combined.slice(-maxChars), truncated: true };
}

function createReadinessWaitForTest(options) {
  let settled = false;
  let timeout = null;
  let resolvePromise = null;
  let rejectPromise = null;

  const cleanup = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    resolvePromise = null;
    rejectPromise = null;
  };

  const settle = (error) => {
    if (settled) return;
    settled = true;
    const resolve = resolvePromise;
    const reject = rejectPromise;
    cleanup();
    if (error) {
      reject?.(error);
    } else {
      resolve?.();
    }
  };

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
    timeout = setTimeout(() => {
      if (!options.isActive()) {
        settle(new Error(options.supersededMessage));
        return;
      }
      settle(new Error(options.timeoutMessage));
      options.kill();
    }, options.timeoutMs);
  });

  return {
    promise,
    markReady: () => {
      if (!options.isActive()) {
        settle(new Error(options.supersededMessage));
        return;
      }
      if (options.isKilled()) {
        settle(new Error(options.diedMessage));
        return;
      }
      settle();
    },
    reject: (error) => {
      settle(error);
    },
  };
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
      `kill: () => ${helper.kill}(child)`,
      `${helper.label} startup timeout should only kill the child it started`
    );
    expectContains(
      ensureSource,
      `isActive: () => ${helper.processVar} === child`,
      `${helper.label} startup wait should detect a superseded child by identity`
    );
    expectContains(
      ensureSource,
      'appendNativeHelperLineBuffer',
      `${helper.label} stdout parser should cap partial native-helper lines`
    );
    assert.equal(
      countOccurrences(ensureSource, 'setInterval('),
      0,
      `${helper.label} startup readiness should not poll`
    );
  }
});

test('native helper lifecycle utility source keeps readiness event-driven and buffers bounded', () => {
  expectContains(
    nativeHelperLifecycleSource,
    'export const NATIVE_HELPER_LINE_BUFFER_MAX_CHARS = 256 * 1024;',
    'native helper partial-line buffer cap should be explicit'
  );
  assert.equal(
    countOccurrences(nativeHelperLifecycleSource, 'setInterval('),
    0,
    'native helper readiness utility should not poll'
  );
  assert.equal(
    countOccurrences(nativeHelperLifecycleSource, 'setTimeout('),
    1,
    'native helper readiness utility should keep one startup timeout'
  );
  expectContains(
    nativeHelperLifecycleSource,
    'nextBuffer = nextBuffer.slice(-maxChars);',
    'native helper buffer should keep a bounded suffix for malformed partial lines'
  );
  expectContains(
    nativeHelperLifecycleSource,
    'export function appendNativeHelperTextBuffer',
    'native helper stderr/plain text buffers should have a shared cap'
  );
});

test('native helper readiness wait uses one timeout and no polling interval', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  let timeoutCount = 0;
  let intervalCount = 0;
  const timers = new Map();
  let nextTimerId = 1;

  globalThis.setTimeout = (callback, delay) => {
    const id = nextTimerId++;
    timeoutCount += 1;
    timers.set(id, { callback, delay, cleared: false });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    const timer = timers.get(id);
    if (timer) timer.cleared = true;
  };
  globalThis.setInterval = () => {
    intervalCount += 1;
    throw new Error('readiness wait must not allocate an interval');
  };
  globalThis.clearInterval = () => {};

  try {
    let active = true;
    let killed = false;
    const wait = createReadinessWaitForTest({
      timeoutMs: 120_000,
      timeoutMessage: 'timeout',
      supersededMessage: 'superseded',
      diedMessage: 'died',
      isActive: () => active,
      isKilled: () => killed,
      kill: () => {
        killed = true;
        active = false;
      },
    });

    assert.equal(timeoutCount, 1, 'event-driven readiness should keep only the startup timeout');
    assert.equal(intervalCount, 0, 'event-driven readiness should not allocate polling intervals');

    wait.markReady();
    await wait.promise;
    assert.ok([...timers.values()].every((timer) => timer.cleared), 'ready event should clear the startup timeout');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('native helper line buffers cap partial output while preserving complete lines', () => {
  const oversizedCompleteLine = `{"text":"${'z'.repeat(NATIVE_HELPER_LINE_BUFFER_MAX_CHARS + 128)}"}`;
  const complete = appendBoundedLineBufferForTest('', `${oversizedCompleteLine}\n`);

  assert.equal(complete.truncated, false);
  assert.deepEqual(complete.lines, [oversizedCompleteLine]);
  assert.equal(complete.buffer, '');

  const oversizedPartial = 'x'.repeat(NATIVE_HELPER_LINE_BUFFER_MAX_CHARS + 128);
  const first = appendBoundedLineBufferForTest('', oversizedPartial);

  assert.equal(first.truncated, true);
  assert.equal(first.lines.length, 0);
  assert.equal(first.buffer.length, NATIVE_HELPER_LINE_BUFFER_MAX_CHARS);

  const second = appendBoundedLineBufferForTest(first.buffer, '\n{"ready":true}\n{"text":"hel');
  assert.equal(second.truncated, false, 'complete newline-terminated lines should be emitted');
  assert.equal(second.lines[0].length, NATIVE_HELPER_LINE_BUFFER_MAX_CHARS);
  assert.equal(second.lines[1], '{"ready":true}');
  assert.equal(second.buffer, '{"text":"hel');

  const third = appendBoundedLineBufferForTest(second.buffer, 'lo"}\n');
  assert.equal(third.truncated, false);
  assert.deepEqual(third.lines, ['{"text":"hello"}']);
  assert.equal(third.buffer, '');
});

test('native helper text buffers cap stderr and plain output suffixes', () => {
  const oversized = `prefix-${'y'.repeat(NATIVE_HELPER_LINE_BUFFER_MAX_CHARS)}-tail`;
  const result = appendBoundedTextBufferForTest('', oversized);

  assert.equal(result.truncated, true);
  assert.equal(result.buffer.length, NATIVE_HELPER_LINE_BUFFER_MAX_CHARS);
  assert.ok(result.buffer.endsWith('-tail'));
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

test('guarded lifecycle rejects and clears the active pending request on kill', () => {
  for (const helper of helpers) {
    const harness = createLifecycleHarness({ guarded: true, label: helper.label });
    const child = harness.spawn('active');
    harness.setPending();

    harness.kill(child);

    assert.equal(harness.activeProcess, null, `${helper.label} active process should clear on kill`);
    assert.equal(harness.pendingRequest, null, `${helper.label} pending request should clear on kill`);
    assert.deepEqual(harness.rejections, [`${helper.label} killed`]);
  }
});
