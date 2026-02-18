#!/usr/bin/env node
/**
 * scripts/build-native.js
 *
 * Compiles platform-native helpers.
 *
 * macOS  — Swift binaries (requires swiftc)
 * Windows — C binaries   (requires gcc from MinGW-w64, available on the
 *                          GitHub Actions windows-latest runner and in most
 *                          Node.js-on-Windows developer setups via Git for
 *                          Windows / Scoop / Chocolatey)
 * Other  — no-op
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'dist', 'native');
fs.mkdirSync(outDir, { recursive: true });

// ── macOS ──────────────────────────────────────────────────────────────────

if (process.platform === 'darwin') {
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

  console.log('[build-native] Done (macOS).');
  process.exit(0);
}

// ── Windows ────────────────────────────────────────────────────────────────

if (process.platform === 'win32') {
  const binaries = [
    {
      out: 'hotkey-hold-monitor.exe',
      src: 'src/native/hotkey-hold-monitor.c',
      libs: ['user32'],
    },
  ];

  for (const { out, src, libs } of binaries) {
    const outPath = path.join(outDir, out);
    const libArgs = libs.map((l) => `-l${l}`).join(' ');
    const cmd = `gcc -O2 -o "${outPath}" "${src}" ${libArgs}`;
    console.log(`[build-native] Compiling ${out}...`);
    execSync(cmd, { stdio: 'inherit' });
  }

  console.log('[build-native] Done (Windows).');
  process.exit(0);
}

// ── Other platforms ────────────────────────────────────────────────────────

console.log(`[build-native] No native binaries for ${process.platform} — skipping.`);
