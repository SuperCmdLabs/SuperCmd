#!/usr/bin/env node
// Regression test for the `center-80` ("Almost Maximize") window preset.
//
// The native helper `dist/native/window-adjust` is a macOS Swift binary built by
// `npm run build:native`. It normally applies a frame to the focused window and
// only reports `{ok,error}`. To make the preset *sizing* observable we added an
// additive `--print-frame` dry-run (see src/native/window-adjust.swift) that
// computes the target frame for a supplied screen area and prints it as JSON,
// without touching Accessibility or any window.
//
// CI runs `npm test` on Linux without building native binaries, so this test
// skips gracefully off-macOS / when the binary is absent. On the macOS worker
// gate (`npm run build && npm test && npm run check:i18n`) the binary IS built
// and this test exercises the real Swift center-80 arithmetic end-to-end.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'dist', 'native', 'window-adjust');

const isMacOS = process.platform === 'darwin';
const binaryPresent = existsSync(binary);
const skipReason =
  !isMacOS
    ? 'native window-adjust is a macOS-only Swift binary'
    : !binaryPresent
      ? 'dist/native/window-adjust not built (run `npm run build:native`)'
      : undefined;

function runPreset(action, area) {
  const stdout = execFileSync(
    binary,
    [
      action,
      '--print-frame',
      '--area-x', String(area.x),
      '--area-y', String(area.y),
      '--area-width', String(area.width),
      '--area-height', String(area.height),
    ],
    { encoding: 'utf-8', timeout: 5000 },
  );
  const line = String(stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse()
    .find((s) => s.startsWith('{') && s.endsWith('}'));
  assert.ok(line, `expected a JSON frame line on stdout, got: ${stdout || ''}`);
  const payload = JSON.parse(line);
  // Guard against a STALE binary that predates --print-frame support: it ignores
  // the unknown flag, falls through to the production path, and emits its normal
  // `{"ok":...}` envelope (and, on an Accessibility-trusted dev box, would also
  // resize the focused window before this assertion runs). Reject that envelope
  // with a clear, actionable message instead of a confusing `frame.width === undefined`.
  assert.ok(
    !('ok' in payload) && ['x', 'y', 'width', 'height'].every((k) => typeof payload[k] === 'number'),
    `window-adjust at ${binary} did not emit a frame via --print-frame (stale binary?). ` +
      `Rebuild native with \`npm run build:native\`. stdout was: ${stdout || ''}`,
  );
  return payload;
}

test('center-80 sizes the window to ~80% of a known 1440x900 screen', { skip: skipReason }, () => {
  const screen = { x: 0, y: 0, width: 1440, height: 900 };
  const frame = runPreset('center-80', screen);

  // 80% of 1440x900 = 1152 x 720, centered at (144, 90). On the pre-fix 0.9 code
  // this would have been 1296 x 810 at (72, 45), so the exact assertions below
  // fail loudly on a regression to 90%.
  assert.equal(frame.width, 1152, `width should be 1152 (80% of 1440), got ${frame.width}`);
  assert.equal(frame.height, 720, `height should be 720 (80% of 900), got ${frame.height}`);
  assert.equal(frame.x, 144, `x should be 144 (centered), got ${frame.x}`);
  assert.equal(frame.y, 90, `y should be 90 (centered), got ${frame.y}`);

  // Ratio guards (robust to unrelated area changes): must be ~80%, never ~90%.
  const widthPct = frame.width / screen.width;
  const heightPct = frame.height / screen.height;
  assert.ok(widthPct >= 0.795 && widthPct <= 0.805, `width ratio should be ~0.80, got ${widthPct.toFixed(4)}`);
  assert.ok(heightPct >= 0.795 && heightPct <= 0.805, `height ratio should be ~0.80, got ${heightPct.toFixed(4)}`);
});

test('center-80 stays ~80% on a different screen size (2560x1440)', { skip: skipReason }, () => {
  const screen = { x: 0, y: 0, width: 2560, height: 1440 };
  const frame = runPreset('center-80', screen);

  const widthPct = frame.width / screen.width;
  const heightPct = frame.height / screen.height;
  assert.ok(widthPct >= 0.795 && widthPct <= 0.805, `width ratio ~0.80, got ${widthPct.toFixed(4)}`);
  assert.ok(heightPct >= 0.795 && heightPct <= 0.805, `height ratio ~0.80, got ${heightPct.toFixed(4)}`);

  // Centered: equal margins on each axis (±1px rounding).
  assert.ok(Math.abs(frame.x - (screen.width - frame.width) / 2) <= 1, `horizontally centered, x=${frame.x}`);
  assert.ok(Math.abs(frame.y - (screen.height - frame.height) / 2) <= 1, `vertically centered, y=${frame.y}`);
});

// Distinct coverage: center-80 ("Almost Maximize", 0.8) must produce a STRICTLY
// larger frame than `center` (0.6) on the same screen. The per-preset exact-value
// tests above cannot, on their own, catch a regression where two presets collapse
// to the same size (e.g. a copy/pasted branch or wrong multiplier); this one can.
test('center-80 is strictly larger than center (0.8 > 0.6) on the same screen', { skip: skipReason }, () => {
  const screen = { x: 0, y: 0, width: 1440, height: 900 };
  const big = runPreset('center-80', screen);
  const small = runPreset('center', screen);

  // Baseline sanity: `center` is 0.6 -> 864 x 540. If this baseline ever drifts
  // the comparison below is meaningless, so assert it explicitly.
  assert.equal(small.width, 864, `center baseline should be 864 (0.6 * 1440), got ${small.width}`);
  assert.equal(small.height, 540, `center baseline should be 540 (0.6 * 900), got ${small.height}`);

  assert.ok(
    big.width > small.width && big.height > small.height,
    `center-80 (${big.width}x${big.height}) should be strictly larger than center (${small.width}x${small.height})`,
  );
});
