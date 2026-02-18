/**
 * icons.test.ts
 *
 * Validates that supercmd.icns contains all required macOS icon sizes.
 * Catches regressions where the .icns is regenerated without the full set,
 * which causes macOS to fall back to a blurry scaled version.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT = path.resolve(__dirname, '../../..');
const ICNS = path.join(ROOT, 'supercmd.icns');

// All sizes required for a complete macOS .icns
const REQUIRED_SIZES = [
  'icon_16x16.png',
  'icon_16x16@2x.png',
  'icon_32x32.png',
  'icon_32x32@2x.png',
  'icon_128x128.png',
  'icon_128x128@2x.png',
  'icon_256x256.png',
  'icon_256x256@2x.png',
  'icon_512x512.png',
  'icon_512x512@2x.png',
];

// iconutil is macOS-only — skip this suite on Linux/Windows CI
describe.runIf(process.platform === 'darwin')('supercmd.icns', () => {
  it('exists', () => {
    expect(fs.existsSync(ICNS), `${ICNS} not found`).toBe(true);
  });

  it('contains all required icon sizes', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-'));
    const tmpDir = tmpBase + '.iconset';
    try {
      execSync(`iconutil -c iconset "${ICNS}" -o "${tmpDir}"`);
      const files = fs.readdirSync(tmpDir);
      for (const required of REQUIRED_SIZES) {
        expect(files, `Missing ${required} in .icns`).toContain(required);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
