#!/usr/bin/env node

import { existsSync, mkdirSync, cpSync, statSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const packageDir = path.join(repoRoot, 'src', 'native', 'parakeet-transcriber');
const distNativeDir = path.join(repoRoot, 'dist', 'native');
const binaryDest = path.join(distNativeDir, 'parakeet-transcriber');

const sourceFiles = [
  path.join(packageDir, 'Sources', 'main.swift'),
  path.join(packageDir, 'Package.swift'),
];

function needsRebuild() {
  if (!existsSync(binaryDest)) return true;
  const binaryMtime = statSync(binaryDest).mtimeMs;
  return sourceFiles.some((src) => existsSync(src) && statSync(src).mtimeMs > binaryMtime);
}

function run(command, args, options = {}) {
  console.log(`[parakeet] Running: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
}

try {
  if (!needsRebuild()) {
    console.log('[parakeet] Binary is up to date, skipping rebuild');
    process.exit(0);
  }

  mkdirSync(distNativeDir, { recursive: true });

  console.log('[parakeet] Building parakeet-transcriber (swift build -c release)');
  run('swift', ['build', '-c', 'release'], { cwd: packageDir });

  // Find the built binary
  const buildDir = path.join(packageDir, '.build', 'release');
  const builtBinary = path.join(buildDir, 'parakeet-transcriber');

  if (!existsSync(builtBinary)) {
    throw new Error(`Built binary not found at ${builtBinary}`);
  }

  cpSync(builtBinary, binaryDest);
  console.log(`[parakeet] Binary copied to ${binaryDest}`);
  console.log('[parakeet] Ready');
} catch (error) {
  console.error('[parakeet] Build failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
