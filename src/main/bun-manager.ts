/**
 * Bun Manager
 *
 * Downloads and caches the Bun binary on-demand.
 * Used as a fast alternative to npm for installing extension dependencies.
 * No npm/git required on the user's machine.
 *
 * - First install: downloads Bun binary (~50MB) to app data
 * - Subsequent installs: uses cached binary instantly
 * - `bun install` is ~25x faster than `npm install`
 */

import { app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as zlib from 'zlib';

const execAsync = promisify(exec);

const BUN_VERSION = '1.2.5';

function getBunDownloadUrl(): string {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';

  if (process.platform === 'darwin') {
    return `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-darwin-${arch}.zip`;
  }
  if (process.platform === 'linux') {
    return `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${arch}.zip`;
  }
  // Windows not supported yet
  return '';
}

function getBunDir(): string {
  return path.join(app.getPath('userData'), 'bun');
}

function getBunBinaryPath(): string {
  return path.join(getBunDir(), 'bun');
}

/** Check if Bun is already downloaded and cached. */
export function isBunAvailable(): boolean {
  const binPath = getBunBinaryPath();
  try {
    return fs.existsSync(binPath) && fs.statSync(binPath).size > 1_000_000; // sanity check: >1MB
  } catch {
    return false;
  }
}

/** Get the path to the Bun binary, or null if not downloaded yet. */
export function getBunPath(): string | null {
  if (isBunAvailable()) return getBunBinaryPath();
  return null;
}

/**
 * Download the Bun binary if not already cached.
 * Returns the path to the binary on success, null on failure.
 */
export async function ensureBun(): Promise<string | null> {
  if (isBunAvailable()) {
    return getBunBinaryPath();
  }

  const url = getBunDownloadUrl();
  if (!url) {
    console.warn('Bun download not supported on this platform');
    return null;
  }

  const bunDir = getBunDir();
  fs.mkdirSync(bunDir, { recursive: true });

  console.log(`Downloading Bun v${BUN_VERSION}...`);

  try {
    const zipBuffer = await downloadFile(url);
    console.log(`Downloaded Bun (${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB), extracting...`);

    // Extract the zip
    const tmpZipPath = path.join(app.getPath('temp'), `bun-${Date.now()}.zip`);
    fs.writeFileSync(tmpZipPath, zipBuffer);

    // Use unzip command (available on macOS and Linux)
    const tmpExtractDir = path.join(app.getPath('temp'), `bun-extract-${Date.now()}`);
    fs.mkdirSync(tmpExtractDir, { recursive: true });

    await execAsync(`unzip -o "${tmpZipPath}" -d "${tmpExtractDir}"`, {
      timeout: 30_000,
    });

    // Find the bun binary in the extracted directory
    const bunBinary = findFile(tmpExtractDir, 'bun');
    if (!bunBinary) {
      throw new Error('Bun binary not found in downloaded archive');
    }

    // Copy to our cache directory
    const destPath = getBunBinaryPath();
    fs.copyFileSync(bunBinary, destPath);
    fs.chmodSync(destPath, 0o755);

    // Cleanup
    try { fs.rmSync(tmpZipPath, { force: true }); } catch {}
    try { fs.rmSync(tmpExtractDir, { recursive: true, force: true }); } catch {}

    // Verify it works
    const { stdout } = await execAsync(`"${destPath}" --version`, { timeout: 5_000 });
    console.log(`Bun installed successfully: ${stdout.trim()}`);

    return destPath;
  } catch (error: any) {
    console.error('Failed to download/install Bun:', error?.message || error);
    // Cleanup partial install
    try { fs.rmSync(getBunBinaryPath(), { force: true }); } catch {}
    return null;
  }
}

/**
 * Install extension dependencies using Bun.
 * Filters out @raycast/* packages (provided by runtime shim).
 */
export async function installDepsWithBun(
  extPath: string,
): Promise<boolean> {
  const bunPath = await ensureBun();
  if (!bunPath) return false;

  const pkgPath = path.join(extPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return true; // no deps needed

  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return true;
  }

  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  const thirdPartyDeps = Object.entries(deps)
    .filter(([name]) => !name.startsWith('@raycast/'))
    .map(([name, version]) => `${name}@${version}`)
    .filter(Boolean);

  if (thirdPartyDeps.length === 0) {
    console.log(`No third-party deps for ${path.basename(extPath)} — skipping bun install`);
    return true;
  }

  console.log(`Installing ${thirdPartyDeps.length} deps via Bun for ${path.basename(extPath)}...`);

  try {
    // Create a minimal package.json with only third-party deps
    // to avoid @raycast/api resolution errors
    const cleanPkg = {
      name: pkg.name || 'extension',
      version: pkg.version || '1.0.0',
      private: true,
      dependencies: Object.fromEntries(
        Object.entries(deps).filter(([name]) => !name.startsWith('@raycast/')),
      ),
    };
    const originalPkg = fs.readFileSync(pkgPath, 'utf-8');
    fs.writeFileSync(pkgPath, JSON.stringify(cleanPkg, null, 2));

    await execAsync(`"${bunPath}" install --production --no-save`, {
      cwd: extPath,
      timeout: 120_000,
      env: {
        ...process.env,
        PATH: `${path.dirname(bunPath)}:${process.env.PATH || ''}`,
      },
    });

    // Restore original package.json
    fs.writeFileSync(pkgPath, originalPkg);

    const hasNodeModules = fs.existsSync(path.join(extPath, 'node_modules'));
    if (hasNodeModules) {
      console.log(`Bun install succeeded for ${path.basename(extPath)}`);
      return true;
    }

    console.warn(`Bun completed but node_modules missing for ${path.basename(extPath)}`);
    // Restore original package.json in case of failure
    fs.writeFileSync(pkgPath, originalPkg);
    return false;
  } catch (error: any) {
    console.warn(`Bun install failed for ${path.basename(extPath)}:`, error?.message);
    // Restore original package.json
    try {
      const originalContent = JSON.stringify(pkg, null, 2);
      fs.writeFileSync(pkgPath, originalContent);
    } catch {}
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Download a file from a URL, following redirects. */
function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl: string, redirects = 0) => {
      if (redirects > 10) {
        reject(new Error('Too many redirects'));
        return;
      }

      const parsedUrl = new URL(requestUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      transport.get(requestUrl, { timeout: 120_000 }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location, redirects + 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode} ${res.statusMessage}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    };

    makeRequest(url);
  });
}

/** Recursively find a file by name in a directory. */
function findFile(dir: string, name: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === name) return full;
      if (entry.isDirectory()) {
        const found = findFile(full, name);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}
