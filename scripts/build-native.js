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
  // Probe for a C compiler. Try gcc (MinGW-w64) first, then clang, then cl
  // (MSVC). Any of these can compile the single-file Windows native helpers.
  function findCCompiler() {
    const { execSync: probe } = require('child_process');
    const candidates = [
      { bin: 'gcc',   flagsFor: (out, src, libs) => `-O2 -o "${out}" "${src}" ${libs.map(l => `-l${l}`).join(' ')}` },
      { bin: 'clang', flagsFor: (out, src, libs) => `-O2 -o "${out}" "${src}" ${libs.map(l => `-l${l}`).join(' ')}` },
      { bin: 'cl',    flagsFor: (out, src, libs) => `/Fe:"${out}" "${src}" /link ${libs.map(l => `${l}.lib`).join(' ')}` },
    ];
    for (const c of candidates) {
      try {
        probe(`${c.bin} --version`, { stdio: 'pipe' });
        return c;
      } catch {
        // not found — try next
      }
    }
    return null;
  }

  const compiler = findCCompiler();
  if (!compiler) {
    console.warn(
      '[build-native] WARNING: No C compiler (gcc/clang/cl) found on PATH.',
      'hotkey-hold-monitor.exe will not be built.',
      'The app will still run; the hold-hotkey feature will be disabled.',
      'To enable it, install MinGW-w64 (e.g. via Scoop: scoop install gcc).'
    );
    console.log('[build-native] Done (Windows — native binaries skipped).');
    process.exit(0);
  }

  const binaries = [
    {
      out: 'hotkey-hold-monitor.exe',
      src: 'src/native/hotkey-hold-monitor.c',
      libs: ['user32'],
    },
  ];

  for (const { out, src, libs } of binaries) {
    const outPath = path.join(outDir, out);
    const cmd = `${compiler.bin} ${compiler.flagsFor(outPath, src, libs)}`;
    console.log(`[build-native] Compiling ${out} with ${compiler.bin}...`);
    try {
      execSync(cmd, { stdio: 'inherit' });
    } catch (err) {
      console.warn(`[build-native] WARNING: Failed to compile ${out}:`, err.message);
      console.warn('[build-native] The app will still run; the hold-hotkey feature will be disabled.');
    }
  }

  console.log('[build-native] Done (Windows).');
  process.exit(0);
}

// ── Other platforms ────────────────────────────────────────────────────────

console.log(`[build-native] No native binaries for ${process.platform} — skipping.`);
