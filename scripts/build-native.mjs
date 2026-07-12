#!/usr/bin/env node
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);

mkdirSync('dist/native', { recursive: true });

const electronVersion = require('../node_modules/electron/package.json').version;
const arch = process.arch;
const stampVersion = 1;

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function readStamp(stampPath) {
  try {
    return JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch {
    return null;
  }
}

function inputState(filePath) {
  if (!existsSync(filePath)) return null;
  const stats = statSync(filePath);
  return {
    path: filePath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

function isUpToDate(out, stampPath, stamp) {
  if (!existsSync(out)) return false;
  const currentInputs = stamp.inputs.map(inputState);
  if (currentInputs.some((input) => input === null)) return false;

  const previous = readStamp(stampPath);
  if (JSON.stringify(previous) !== JSON.stringify({ ...stamp, inputState: currentInputs })) {
    return false;
  }

  const outputMtime = statSync(out).mtimeMs;
  return currentInputs.every((input) => input.mtimeMs <= outputMtime);
}

function writeStamp(stampPath, stamp) {
  const currentInputs = stamp.inputs.map(inputState);
  writeFileSync(stampPath, JSON.stringify({ ...stamp, inputState: currentInputs }, null, 2));
}

function buildIfStale({ label, out, inputs, command }) {
  const stampPath = `${out}.stamp.json`;
  const stamp = {
    version: stampVersion,
    label,
    command,
    inputs,
  };

  if (isUpToDate(out, stampPath, stamp)) {
    console.log(`[native] ${path.basename(out)} is up to date, skipping rebuild`);
    return;
  }

  run(command);
  writeStamp(stampPath, stamp);
}

const swift = [
  ['dist/native/get-selected-text', 'src/native/get-selected-text.swift',
    '-framework Foundation -framework ApplicationServices -framework AppKit'],
  ['dist/native/color-picker', 'src/native/color-picker.swift',
    '-framework AppKit'],
  ['dist/native/keyboard-lock', 'src/native/keyboard-lock.swift',
    '-framework CoreGraphics -framework Foundation'],
  ['dist/native/screen-ocr', 'src/native/screen-ocr.swift',
    '-framework AppKit -framework CoreGraphics -framework Foundation -framework Vision'],
  ['dist/native/snippet-expander', 'src/native/snippet-expander.swift',
    '-framework AppKit'],
  ['dist/native/menu-item-search', 'src/native/menu-item-search.swift',
    '-framework AppKit -framework ApplicationServices'],
  ['dist/native/emoji-trigger-monitor',
    'src/native/emoji-trigger-monitor.swift src/native/ax-caret-query.swift',
    '-framework AppKit -framework ApplicationServices'],
  ['dist/native/hotkey-hold-monitor', 'src/native/hotkey-hold-monitor.swift',
    '-framework CoreGraphics -framework AppKit -framework Carbon'],
  ['dist/native/speech-recognizer', 'src/native/speech-recognizer.swift',
    '-framework Speech -framework AVFoundation'],
  ['dist/native/microphone-access', 'src/native/microphone-access.swift',
    '-framework AVFoundation'],
  ['dist/native/input-monitoring-request', 'src/native/input-monitoring-request.swift',
    '-framework CoreGraphics'],
  ['dist/native/window-adjust', 'src/native/window-adjust.swift',
    '-framework ApplicationServices -framework AppKit'],
  ['dist/native/calendar-events', 'src/native/calendar-events.swift',
    '-framework EventKit'],
  ['dist/native/settings-coordinator', 'src/native/settings-coordinator.swift',
    '-framework Foundation'],
  ['dist/native/audio-capturer', 'src/native/audio-capturer.swift',
    '-framework AVFoundation -framework Foundation'],
];

for (const [out, src, frameworks] of swift) {
  const inputs = [...src.split(' '), __filename];
  buildIfStale({
    label: path.basename(out),
    out,
    inputs,
    command: `swiftc -O -o ${out} ${src} ${frameworks}`,
  });
}

// Build native Node addon (native_helpers.node)
buildIfStale({
  label: 'native_helpers.node',
  out: 'dist/native/native_helpers.node',
  inputs: [
    'src/native/native-helpers-addon/binding.gyp',
    'src/native/native-helpers-addon/native_helpers.mm',
    'package.json',
    'package-lock.json',
    'node_modules/electron/package.json',
    __filename,
  ],
  command:
    `cd src/native/native-helpers-addon && ` +
    `HOME=~/.electron-gyp npx node-gyp rebuild ` +
    `--target=${electronVersion} --arch=${arch} ` +
    `--dist-url=https://electronjs.org/headers && ` +
    `cp build/Release/native_helpers.node ../../../dist/native/native_helpers.node`,
});

run('node scripts/build-whispercpp.mjs');
run('node scripts/build-parakeet.mjs');
run('node scripts/build-soulver-calculator.mjs');
