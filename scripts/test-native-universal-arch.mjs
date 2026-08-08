#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeDir = path.join(root, 'dist', 'native');

// The 15 Swift helper binaries produced by the `swift` array in scripts/build-native.mjs.
// Each must be a universal Mach-O (arm64 + x86_64) so Intel Macs stop seeing
// "bad CPU type in executable" (SuperCmd issue #634).
//
// `native_helpers.node` (node-gyp addon, already arch-aware via `--arch=${arch}`) is deliberately
// EXCLUDED — it is arch-specific by design. whisper/parakeet/soulver binaries come
// from separate build pipelines and are also excluded.
const UNIVERSAL_SWIFT_BINARIES = [
  'get-selected-text',
  'color-picker',
  'keyboard-lock',
  'screen-ocr',
  'snippet-expander',
  'menu-item-search',
  'emoji-trigger-monitor',
  'hotkey-hold-monitor',
  'speech-recognizer',
  'microphone-access',
  'input-monitoring-request',
  'window-adjust',
  'calendar-events',
  'settings-coordinator',
  'audio-capturer',
];

// CI runs `npm test` on Linux (.github/workflows/test.yml uses ubuntu-latest) where dist/native/
// is never built and `lipo` does not exist. Universal-arch is a macOS-only property, so skip (not
// fail) off macOS — mirrors the { skip } pattern in scripts/test-renderer-crash-recovery-live.mjs.
const shouldSkip = process.platform !== 'darwin';
const skipReason = 'macOS-only: native helpers are built by scripts/build-native.mjs and need lipo';

// One test per binary so node --test reports each failure individually (15 failures on stock,
// not just the first). A missing file FAILS (it means build:native did not run) — never skipped.
for (const name of UNIVERSAL_SWIFT_BINARIES) {
  test(`${name} is a universal Mach-O (x86_64 + arm64)`, { skip: shouldSkip ? skipReason : false }, () => {
    const binaryPath = path.join(nativeDir, name);
    assert.ok(
      existsSync(binaryPath),
      `${name}: expected binary at ${binaryPath} — run \`npm run build:native\` first`
    );
    const stdout = execFileSync('lipo', ['-archs', binaryPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const arches = stdout.trim().split(/\s+/);
    assert.ok(
      arches.includes('x86_64') && arches.includes('arm64'),
      `${name} (${binaryPath}) must contain BOTH x86_64 and arm64; lipo -archs reports only [${arches.join(', ')}] — missing ${[
        'x86_64',
        'arm64',
      ].filter((a) => !arches.includes(a)).join(' and ')}`
    );
  });
}
