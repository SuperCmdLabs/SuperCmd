#!/usr/bin/env node
/**
 * scripts/build-native.js
 *
 * Compiles Swift native helpers on macOS.
 * On other platforms this is a no-op — the native features are stubbed out
 * in platform/windows.ts and will be replaced with platform-native
 * implementations in follow-up work.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') {
  console.log('[build-native] Skipping Swift compilation (not macOS).');
  process.exit(0);
}

const outDir = path.join(__dirname, '..', 'dist', 'native');
fs.mkdirSync(outDir, { recursive: true });

const binaries = [
  {
    out: 'color-picker',
    src: 'src/native/color-picker.swift',
    frameworks: ['AppKit'],
  },
  {
    out: 'snippet-expander',
    src: 'src/native/snippet-expander.swift',
    frameworks: ['AppKit'],
  },
  {
    out: 'hotkey-hold-monitor',
    src: 'src/native/hotkey-hold-monitor.swift',
    frameworks: ['CoreGraphics', 'AppKit', 'Carbon'],
  },
  {
    out: 'speech-recognizer',
    src: 'src/native/speech-recognizer.swift',
    frameworks: ['Speech', 'AVFoundation'],
  },
  {
    out: 'microphone-access',
    src: 'src/native/microphone-access.swift',
    frameworks: ['AVFoundation'],
  },
  {
    out: 'input-monitoring-request',
    src: 'src/native/input-monitoring-request.swift',
    frameworks: ['CoreGraphics'],
  },
];

for (const { out, src, frameworks } of binaries) {
  const outPath = path.join(outDir, out);
  const frameworkArgs = frameworks.flatMap((f) => ['-framework', f]);
  const cmd = ['swiftc', '-O', '-o', outPath, src, ...frameworkArgs].join(' ');
  console.log(`[build-native] Compiling ${out}...`);
  execSync(cmd, { stdio: 'inherit' });
}

console.log('[build-native] Done.');
