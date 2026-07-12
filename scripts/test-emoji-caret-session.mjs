#!/usr/bin/env node

import assert from 'assert/strict';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

function canRunSwiftTests() {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('swiftc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!canRunSwiftTests()) {
  console.log('[emoji-caret-session] skipped: Swift compiler is not available on this platform');
  process.exit(0);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-emoji-caret-session-'));
const testSource = path.join(tempDir, 'main.swift');
const testBinary = path.join(tempDir, 'emoji-caret-session-tests');

fs.writeFileSync(testSource, `
import Foundation
@preconcurrency import ApplicationServices

func makeSnapshot(pid: pid_t, bundleId: String = "com.example.Editor") -> AXCaretSessionSnapshot {
  AXCaretSessionSnapshot(
    context: AXCaretApplicationContext(pid: pid, bundleIdentifier: bundleId),
    focusedElement: nil,
    caret: AXCaretRect(x: 20, y: 40, w: 1, h: 18, tier: "unit")
  )
}

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
  if !condition() {
    fputs("failed: " + message + "\\n", stderr)
    exit(1)
  }
}

var cache = EmojiCaretSessionCache()
expect(!cache.isActive, "new cache starts empty")

cache.store(makeSnapshot(pid: 42))
expect(cache.isActive, "store activates the cache")
switch cache.validate(eventTargetPID: 42) {
case .valid(let snapshot):
  expect(snapshot.context.pid == 42, "matching event PID reuses the snapshot")
default:
  expect(false, "matching event PID reuses the snapshot")
}

switch cache.validate(eventTargetPID: nil) {
case .valid(let snapshot):
  expect(snapshot.context.pid == 42, "missing event PID does not force an AX requery")
default:
  expect(false, "missing event PID does not force an AX requery")
}

switch cache.validate(eventTargetPID: 43) {
case .invalidated:
  break
default:
  expect(false, "PID changes invalidate the cache")
}
expect(!cache.isActive, "PID invalidation clears the cache")

cache.store(makeSnapshot(pid: 99))
cache.invalidate()
expect(!cache.isActive, "failed rect/dismiss invalidation clears the cache")

print("emoji caret session cache tests passed")
`);

try {
  execFileSync('swiftc', [
    '-o', testBinary,
    'src/native/ax-caret-query.swift',
    'src/native/emoji-caret-session-cache.swift',
    testSource,
    '-framework', 'AppKit',
    '-framework', 'ApplicationServices',
  ], { stdio: 'inherit' });
  const output = execFileSync(testBinary, { encoding: 'utf8' }).trim();
  assert.equal(output, 'emoji caret session cache tests passed');
  console.log(`[emoji-caret-session] ${output}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
