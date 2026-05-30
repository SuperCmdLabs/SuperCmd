#!/usr/bin/env node
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

mkdirSync('dist/native', { recursive: true });

const electronVersion = require('../node_modules/electron/package.json').version;
const arch = process.arch;

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
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
  run(`swiftc -O -o ${out} ${src} ${frameworks}`);
}

// Build native Node addon (native_helpers.node)
run(
  `cd src/native/native-helpers-addon && ` +
  `HOME=~/.electron-gyp npx node-gyp rebuild ` +
  `--target=${electronVersion} --arch=${arch} ` +
  `--dist-url=https://electronjs.org/headers && ` +
  `cp build/Release/native_helpers.node ../../../dist/native/native_helpers.node`
);

run('node scripts/build-whispercpp.mjs');
run('node scripts/build-parakeet.mjs');
run('node scripts/build-soulver-calculator.mjs');
