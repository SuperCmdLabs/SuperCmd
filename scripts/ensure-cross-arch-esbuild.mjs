#!/usr/bin/env node
/**
 * Ensure every `esbuild` instance in node_modules ships native binaries for
 * both macOS architectures (darwin-x64 + darwin-arm64).
 *
 * Why:
 *   esbuild ships its native binary via `optionalDependencies` that resolve
 *   based on the *current* host platform. When SuperCmd is built on Apple
 *   Silicon, only `@esbuild/darwin-arm64` ends up in node_modules; the same
 *   node_modules is then packed into both the x64 and arm64 DMGs by
 *   electron-builder, so the x64 DMG ships an unusable arm64 binary and every
 *   extension whose on-demand build invokes esbuild fails at runtime with:
 *
 *     "You installed esbuild for another platform than the one you're
 *      currently using. … the '@esbuild/darwin-arm64' package is present but
 *      this platform needs the '@esbuild/darwin-x64' package instead."
 *
 *   The top-level esbuild is pinned in package.json, but @raycast/api nests
 *   its own copy at a different version, which `npm install` populates
 *   identically. This script walks every esbuild folder it finds and runs
 *   `npm pack` for the missing platform package at the matching version,
 *   then drops it next to the existing one.
 *
 * Idempotent. Safe to run repeatedly. No-op outside macOS.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

if (process.platform !== 'darwin') {
  process.exit(0);
}

const REQUIRED_PLATFORMS = ['darwin-x64', 'darwin-arm64'];
const ROOT = resolve(process.cwd());

function findEsbuildDirs(start) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name === 'esbuild' && dirname(full).endsWith('node_modules')) {
        if (existsSync(join(full, 'package.json'))) results.push(full);
      } else if (entry.name === 'node_modules' || entry.name.startsWith('@')) {
        walk(full);
      } else if (existsSync(join(full, 'node_modules'))) {
        walk(join(full, 'node_modules'));
      }
    }
  }
  walk(join(start, 'node_modules'));
  return results;
}

function ensurePlatform(esbuildDir, platform) {
  const platformRoot = join(dirname(esbuildDir), '@esbuild', platform);
  if (existsSync(join(platformRoot, 'bin', 'esbuild'))) return false;

  const pkg = JSON.parse(readFileSync(join(esbuildDir, 'package.json'), 'utf8'));
  const version = pkg.version;
  console.log(`  → installing @esbuild/${platform}@${version} for ${esbuildDir}`);

  const work = mkdtempSync(join(tmpdir(), 'sc-esbuild-'));
  try {
    execSync(`npm pack @esbuild/${platform}@${version}`, { cwd: work, stdio: 'inherit' });
    const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
    if (!tarball) throw new Error(`npm pack produced no tarball for @esbuild/${platform}@${version}`);
    execSync(`tar -xzf ${tarball}`, { cwd: work, stdio: 'inherit' });
    const extracted = join(work, 'package');
    if (!existsSync(extracted)) throw new Error(`unexpected tarball layout: ${tarball}`);
    if (!existsSync(dirname(platformRoot))) {
      execSync(`mkdir -p ${JSON.stringify(dirname(platformRoot))}`);
    }
    if (existsSync(platformRoot)) rmSync(platformRoot, { recursive: true, force: true });
    renameSync(extracted, platformRoot);
    return true;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const dirs = findEsbuildDirs(ROOT);
if (dirs.length === 0) {
  console.log('ensure-cross-arch-esbuild: no esbuild installations found, skipping.');
  process.exit(0);
}

let added = 0;
for (const dir of dirs) {
  for (const platform of REQUIRED_PLATFORMS) {
    if (ensurePlatform(dir, platform)) added++;
  }
}

if (added === 0) {
  console.log('ensure-cross-arch-esbuild: all esbuild instances already have both macOS binaries.');
} else {
  console.log(`ensure-cross-arch-esbuild: added ${added} missing platform package(s).`);
}
