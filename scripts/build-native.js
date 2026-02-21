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
  // Probe for a C compiler. Try gcc/clang on PATH first, then search for
  // cl.exe in standard Visual Studio install locations (so this works without
  // needing a Developer Command Prompt or VS on PATH).
  function findCCompiler() {
    const { execSync: probe } = require('child_process');

    // Build a self-contained cl.exe compiler entry with explicit include/lib paths.
    function makeMsvcCompiler(clPath) {
      const msvcBin = path.dirname(clPath); // .../MSVC/<ver>/bin/Hostx64/x64
      // Go up 3 levels: x64 → Hostx64 → bin → <ver>
      const msvcRoot = path.resolve(msvcBin, '..', '..', '..');
      const msvcInc = path.join(msvcRoot, 'include');
      const msvcLib = path.join(msvcRoot, 'lib', 'x64');
      const kitsBase = 'C:\\Program Files (x86)\\Windows Kits\\10';
      let sdkVer = '';
      try {
        const sdks = fs.readdirSync(path.join(kitsBase, 'Include')).filter(Boolean).sort();
        sdkVer = sdks[sdks.length - 1] || '';
      } catch {}
      const incs = [msvcInc];
      const libs = [msvcLib];
      if (sdkVer) {
        incs.push(
          path.join(kitsBase, 'Include', sdkVer, 'ucrt'),
          path.join(kitsBase, 'Include', sdkVer, 'um'),
          path.join(kitsBase, 'Include', sdkVer, 'shared'),
        );
        libs.push(
          path.join(kitsBase, 'Lib', sdkVer, 'ucrt', 'x64'),
          path.join(kitsBase, 'Lib', sdkVer, 'um', 'x64'),
        );
      }
      const incArgs = incs.map(p => `/I"${p}"`).join(' ');
      const libArgs = libs.map(p => `/LIBPATH:"${p}"`).join(' ');
      return {
        bin: `"${clPath}"`,
        flagsFor: (out, src, libNames) =>
          `/nologo /O2 ${incArgs} /Fe:"${out}" "${src}" /link ${libArgs} ${libNames.map(l => `${l}.lib`).join(' ')}`,
      };
    }

    // Search standard VS install locations for cl.exe (x64 host, x64 target).
    function findMsvcCl() {
      const roots = [
        'C:\\Program Files\\Microsoft Visual Studio',
        'C:\\Program Files (x86)\\Microsoft Visual Studio',
      ];
      const editions = ['Community', 'Professional', 'Enterprise', 'BuildTools'];
      const years = ['2022', '2019', '2017'];
      for (const root of roots) {
        for (const year of years) {
          for (const edition of editions) {
            const msvcBase = path.join(root, year, edition, 'VC', 'Tools', 'MSVC');
            if (!fs.existsSync(msvcBase)) continue;
            const versions = fs.readdirSync(msvcBase).sort().reverse();
            for (const ver of versions) {
              const cl = path.join(msvcBase, ver, 'bin', 'Hostx64', 'x64', 'cl.exe');
              if (fs.existsSync(cl)) return cl;
            }
          }
        }
      }
      return null;
    }

    // 1. gcc / clang on PATH (MinGW-w64, LLVM, Git for Windows SDK)
    for (const bin of ['gcc', 'clang']) {
      try {
        probe(`${bin} --version`, { stdio: 'pipe' });
        return {
          bin,
          flagsFor: (out, src, libNames) =>
            `-O2 -o "${out}" "${src}" ${libNames.map(l => `-l${l}`).join(' ')}`,
        };
      } catch {}
    }

    // 2. cl.exe on PATH (Developer Command Prompt / vcvarsall)
    try {
      probe('cl 2>&1', { stdio: 'pipe', shell: true });
      return {
        bin: 'cl',
        flagsFor: (out, src, libNames) =>
          `/nologo /O2 /Fe:"${out}" "${src}" /link ${libNames.map(l => `${l}.lib`).join(' ')}`,
      };
    } catch {}

    // 3. cl.exe in default VS installation (most Windows dev machines)
    const msvcCl = findMsvcCl();
    if (msvcCl) {
      console.log(`[build-native] Found MSVC cl.exe at: ${msvcCl}`);
      return makeMsvcCompiler(msvcCl);
    }

    return null;
  }

  const compiler = findCCompiler();
  if (!compiler) {
    console.warn(
      '[build-native] WARNING: No C compiler found (gcc, clang, or MSVC cl.exe).',
      'hotkey-hold-monitor.exe will not be built.',
      'The app will still run; hold-to-talk will be disabled.',
      'Install MinGW-w64 (scoop install gcc) or Visual Studio 2017+ to enable it.'
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
    {
      out: 'snippet-expander-win.exe',
      src: 'src/native/snippet-expander-win.c',
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

  // ── C# binaries (compiled with csc.exe from .NET Framework — always available on Windows 10/11) ──
  function findCsc() {
    // Try .NET Framework 4.x csc.exe (guaranteed on Windows 10/11)
    const cscPaths = [
      'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
      'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
    ];
    for (const p of cscPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  // System.Speech.dll lives in the WPF subfolder of the .NET Framework directory.
  function findSystemSpeechDll(cscPath) {
    const netDir = path.dirname(cscPath); // e.g. C:\Windows\Microsoft.NET\Framework64\v4.0.30319
    const wpfPath = path.join(netDir, 'WPF', 'System.Speech.dll');
    if (fs.existsSync(wpfPath)) return wpfPath;
    return null;
  }

  const cscBinaries = [
    {
      out: 'speech-recognizer.exe',
      src: 'src/native/speech-recognizer.cs',
    },
  ];

  const csc = findCsc();
  if (!csc) {
    console.warn('[build-native] WARNING: csc.exe not found — speech-recognizer.exe will not be built.');
    console.warn('[build-native] Dictation will fall back to cloud transcription if an API key is configured.');
  } else {
    const speechDll = findSystemSpeechDll(csc);
    if (!speechDll) {
      console.warn('[build-native] WARNING: System.Speech.dll not found — speech-recognizer.exe will not be built.');
    } else {
      for (const { out, src } of cscBinaries) {
        const outPath = path.join(outDir, out);
        const srcPath = path.join(__dirname, '..', src); // absolute path required by csc.exe
        const cmd = `"${csc}" /nologo /target:exe /optimize+ /r:"${speechDll}" /out:"${outPath}" "${srcPath}"`;
        console.log(`[build-native] Compiling ${out} with csc.exe...`);
        try {
          execSync(cmd, { stdio: 'inherit' });
        } catch (err) {
          console.warn(`[build-native] WARNING: Failed to compile ${out}:`, err.message);
          console.warn('[build-native] Dictation will fall back to cloud transcription if an API key is configured.');
        }
      }
    }
  }

  console.log('[build-native] Done (Windows).');
  process.exit(0);
}

// ── Other platforms ────────────────────────────────────────────────────────

console.log(`[build-native] No native binaries for ${process.platform} — skipping.`);
