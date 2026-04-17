#!/usr/bin/env node

import { existsSync, mkdirSync, cpSync, rmSync, statSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const packageDir = path.join(repoRoot, 'src', 'native', 'soulver-calculator');
const outDir = path.join(repoRoot, 'dist', 'native', 'soulver-calculator');
const binaryDest = path.join(outDir, 'soulver-calculator');
const frameworkDest = path.join(outDir, 'SoulverCore.framework');

const sourceFiles = [
  path.join(packageDir, 'Sources', 'main.swift'),
  path.join(packageDir, 'Package.swift'),
];

function needsRebuild() {
  if (!existsSync(binaryDest) || !existsSync(frameworkDest)) return true;
  const binaryMtime = statSync(binaryDest).mtimeMs;
  return sourceFiles.some((src) => existsSync(src) && statSync(src).mtimeMs > binaryMtime);
}

function run(command, args, options = {}) {
  console.log(`[soulver] Running: ${command} ${args.join(' ')}`);
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
    console.log('[soulver] Binary is up to date, skipping rebuild');
    process.exit(0);
  }

  mkdirSync(outDir, { recursive: true });

  console.log('[soulver] Building soulver-calculator (swift build -c release)');
  run('swift', ['build', '-c', 'release'], { cwd: packageDir });

  const buildDir = path.join(packageDir, '.build', 'release');
  const builtBinary = path.join(buildDir, 'soulver-calculator');
  const builtFramework = path.join(buildDir, 'SoulverCore.framework');

  if (!existsSync(builtBinary)) {
    throw new Error(`Built binary not found at ${builtBinary}`);
  }
  if (!existsSync(builtFramework)) {
    throw new Error(`SoulverCore.framework not found at ${builtFramework}`);
  }

  // Replace destination atomically — framework Version symlinks mean a stale
  // copy will break future ones.
  if (existsSync(frameworkDest)) rmSync(frameworkDest, { recursive: true, force: true });

  cpSync(builtBinary, binaryDest);
  // preserveSymlinks + dereference:false keeps the framework's Version/A symlink intact.
  cpSync(builtFramework, frameworkDest, { recursive: true, verbatimSymlinks: true });

  console.log(`[soulver] Binary + framework copied to ${outDir}`);
  console.log('[soulver] Ready');
} catch (error) {
  console.error('[soulver] Build failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
