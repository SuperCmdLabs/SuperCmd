#!/usr/bin/env node

// Regression test for the `center-80` ("Almost Maximize") window-management preset.
//
// The real resizing lives in the macOS native helper `src/native/window-adjust.swift`,
// which CI (ubuntu-latest, `npm test`) cannot compile or run. So this test reads the
// Swift source, extracts the `center80` size formula, and asserts the resulting frame
// is ~80% of a known screen. It fails loudly if the multiplier drifts away from 0.8
// (it was 0.9 — sizing the window to 90% — before the fix).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SWIFT_PATH = path.resolve('src/native/window-adjust.swift');
const TS_PREVIEW_PATH = path.resolve('src/renderer/src/WindowManagerPanel.tsx');

function readSource(file) {
  return fs.readFileSync(file, 'utf8');
}

// Extract the body of a single `case .<name>:` arm from a Swift switch, bounded by the
// next sibling case arm ("  case ." at column 0) or end of the switch.
function extractCaseBody(source, caseName) {
  const startMatch = new RegExp(`case \\.${caseName}:`).exec(source);
  if (!startMatch) return null;
  const rest = source.slice(startMatch.index + startMatch[0].length);
  const nextCase = /\n  case \./.exec(rest);
  return nextCase ? rest.slice(0, nextCase.index) : rest;
}

// Pull the first ratio applied to `area.<dimension>` out of a code body.
// e.g. `round(area.width * 0.8)` -> 0.8
function extractMultiplier(body, dimension) {
  const m = new RegExp(`area\\.${dimension}\\s*\\*\\s*([0-9]+(?:\\.[0-9]+)?)`).exec(body);
  return m ? Number(m[1]) : null;
}

function extractCGFloatLet(source, name) {
  const m = new RegExp(`let ${name}:\\s*CGFloat\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)`).exec(source);
  return m ? Number(m[1]) : null;
}

// First `area.<dimension> * <ratio>` that appears after a marker string (used to read
// the TS preview layer, which has no Swift-style case arms).
function extractMultiplierAfter(source, marker, dimension) {
  const idx = source.indexOf(marker);
  if (idx < 0) return null;
  const m = new RegExp(`area\\.${dimension}\\s*\\*\\s*([0-9]+(?:\\.[0-9]+)?)`).exec(source.slice(idx, idx + 400));
  return m ? Number(m[1]) : null;
}

test('center-80 ("Almost Maximize") sizes the window to ~80% of the screen', () => {
  const source = readSource(SWIFT_PATH);

  const body = extractCaseBody(source, 'center80');
  assert.ok(body, 'expected a `case .center80:` arm in window-adjust.swift');

  const widthMult = extractMultiplier(body, 'width');
  const heightMult = extractMultiplier(body, 'height');
  assert.ok(widthMult !== null, 'center80 must multiply area.width by a ratio');
  assert.ok(heightMult !== null, 'center80 must multiply area.height by a ratio');

  // Hard regression guard: before the fix both were 0.9 (90%), contradicting the
  // "Almost Maximize" / center-80 intent shared with the `center` (60%) preset.
  assert.equal(widthMult, 0.8, 'center80 width multiplier must be 0.8 (was 0.9)');
  assert.equal(heightMult, 0.8, 'center80 height multiplier must be 0.8 (was 0.9)');

  const minWidth = extractCGFloatLet(source, 'minWidth') ?? 120;
  const minHeight = extractCGFloatLet(source, 'minHeight') ?? 60;

  // Faithful reproduction of the Swift math for known screens:
  //   width  = max(minWidth,  round(area.width  * mult))
  //   height = max(minHeight, round(area.height * mult))
  //   x      = area.origin.x + round((area.width  - width)  / 2)
  //   y      = area.origin.y + round((area.height - height) / 2)
  const screens = [
    { name: '2560x1440', x: 0, y: 0, width: 2560, height: 1440 },
    { name: '1920x1080', x: 0, y: 0, width: 1920, height: 1080 },
    { name: '1440x900', x: 0, y: 0, width: 1440, height: 900 },
  ];

  for (const area of screens) {
    const width = Math.max(minWidth, Math.round(area.width * widthMult));
    const height = Math.max(minHeight, Math.round(area.height * heightMult));
    const frame = {
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round((area.height - height) / 2),
      width,
      height,
    };

    const widthRatio = frame.width / area.width;
    const heightRatio = frame.height / area.height;

    // ~80% within at most one rounded pixel.
    assert.ok(
      Math.abs(widthRatio - 0.8) <= 1 / area.width,
      `${area.name}: width ratio ${widthRatio} is not ~0.8 (frame width=${frame.width})`
    );
    assert.ok(
      Math.abs(heightRatio - 0.8) <= 1 / area.height,
      `${area.name}: height ratio ${heightRatio} is not ~0.8 (frame height=${frame.height})`
    );

    // Lock the specific fix: must NOT be the old 90% size.
    assert.notEqual(
      frame.width,
      Math.round(area.width * 0.9),
      `${area.name}: still the old 90% width`
    );

    // Centered within the screen (inset from every edge).
    assert.ok(frame.x > area.x, `${area.name}: frame should be inset from the left edge`);
    assert.ok(frame.x + frame.width < area.x + area.width, `${area.name}: frame should be inset from the right edge`);
  }

  // Cross-layer parity: the TS preview layout for `center-80` must agree on 80%.
  const ts = readSource(TS_PREVIEW_PATH);
  const tsWidthMult = extractMultiplierAfter(ts, "presetId === 'center-80'", 'width');
  if (tsWidthMult !== null) {
    assert.equal(
      tsWidthMult,
      widthMult,
      'TS preview center-80 width multiplier must match the Swift helper'
    );
  }
});
