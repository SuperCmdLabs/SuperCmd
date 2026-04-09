#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const whisperVersion = 'v1.8.3';
const frameworkUrl = `https://github.com/ggml-org/whisper.cpp/releases/download/${whisperVersion}/whisper-${whisperVersion}-xcframework.zip`;
// SHA-256 of the xcframework zip. The whisper.cpp project does not publish
// checksums with their releases, so this was computed from the v1.8.3 asset
// and pinned here. Update this when bumping whisperVersion.
const frameworkSha256 = 'a970006f256c8e689bc79e73f7fa7ddb8c1ed2703ad43ee48eb545b5bb6de6af';

const distNativeDir = path.join(repoRoot, 'dist', 'native');
const runtimeDir = path.join(distNativeDir, 'whisper-runtime');
const frameworkDir = path.join(runtimeDir, 'whisper.framework');
const transcriberSource = path.join(repoRoot, 'src', 'native', 'whisper-transcriber.swift');
const transcriberBinary = path.join(distNativeDir, 'whisper-transcriber');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
}

function prepareFramework() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'supercmd-whispercpp-'));
  const archivePath = path.join(tempRoot, 'whisper-xcframework.zip');
  const extractDir = path.join(tempRoot, 'extract');

  mkdirSync(distNativeDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

  console.log(`[whisper.cpp] Downloading macOS framework (${whisperVersion})`);
  run('curl', ['-L', frameworkUrl, '-o', archivePath]);

  const fileBuffer = readFileSync(archivePath);
  const actualHash = createHash('sha256').update(fileBuffer).digest('hex');
  if (actualHash !== frameworkSha256) {
    throw new Error(
      `[whisper.cpp] Integrity check failed!\n` +
      `  Expected SHA-256: ${frameworkSha256}\n` +
      `  Actual SHA-256:   ${actualHash}\n` +
      `  The downloaded file does not match the pinned hash. ` +
      `This could indicate a corrupted download or a compromised release asset.`
    );
  }
  console.log('[whisper.cpp] Integrity check passed (SHA-256)');

  console.log('[whisper.cpp] Extracting framework');
  run('unzip', ['-q', '-o', archivePath, '-d', extractDir]);

  const sourceFrameworkDir = path.join(
    extractDir,
    'build-apple',
    'whisper.xcframework',
    'macos-arm64_x86_64',
    'whisper.framework'
  );
  if (!existsSync(sourceFrameworkDir)) {
    throw new Error('Downloaded whisper.cpp archive did not contain the macOS framework slice');
  }

  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(runtimeDir, { recursive: true });
  // Use cp -a instead of cpSync to preserve relative symlinks in the framework bundle.
  // Node's cpSync converts relative symlinks to absolute paths, which breaks codesign.
  run('cp', ['-a', sourceFrameworkDir, frameworkDir]);
}

function buildTranscriber() {
  const moduleCacheDir = path.join(tmpdir(), 'supercmd-swift-module-cache');
  mkdirSync(moduleCacheDir, { recursive: true });

  console.log('[whisper.cpp] Building whisper-transcriber');
  run('swiftc', [
    '-O',
    '-module-cache-path', moduleCacheDir,
    '-F', runtimeDir,
    '-framework', 'whisper',
    '-Xlinker', '-rpath',
    '-Xlinker', '@executable_path/whisper-runtime',
    '-o', transcriberBinary,
    transcriberSource,
  ]);
}

try {
  // Verify the framework actually has the whisper module, not just an empty directory
  const moduleMapPath = path.join(frameworkDir, 'Modules', 'module.modulemap');
  if (!existsSync(frameworkDir) || !existsSync(moduleMapPath)) {
    prepareFramework();
  } else {
    console.log('[whisper.cpp] Using existing macOS framework');
  }
  buildTranscriber();
  console.log('[whisper.cpp] Ready');
} catch (error) {
  console.error('[whisper.cpp] Build failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
