#!/usr/bin/env node

import { createRequire } from 'node:module';

if (process.platform !== 'darwin') {
  process.exit(0);
}

const require = createRequire(import.meta.url);
const REQUIRED_PACKAGES = ['electron-liquid-glass'];

let missing = 0;

for (const packageName of REQUIRED_PACKAGES) {
  try {
    require(packageName);
  } catch (error) {
    missing++;
    console.error(`ensure-macos-runtime-deps: failed to load ${packageName}.`);
    console.error(error);
  }
}

if (missing > 0) {
  process.exit(1);
}

console.log('ensure-macos-runtime-deps: macOS runtime packages are available.');
