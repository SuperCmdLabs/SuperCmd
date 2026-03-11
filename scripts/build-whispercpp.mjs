#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const whisperVersion = 'v1.8.3';
const frameworkUrl = `https://github.com/ggml-org/whisper.cpp/releases/download/${whisperVersion}/whisper-${whisperVersion}-xcframework.zip`;

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
  cpSync(sourceFrameworkDir, frameworkDir, { recursive: true });
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
  if (!existsSync(frameworkDir)) {
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
