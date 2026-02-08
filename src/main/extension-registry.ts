/**
 * Extension Registry
 *
 * Fetches, caches, installs, and uninstalls community extensions
 * from the Raycast extensions GitHub repository.
 *
 * Catalog Strategy:
 *   1. git sparse-checkout to get only package.json files (fast, no full clone)
 *   2. Parse each package.json for metadata (title, description, icon, author)
 *   3. Cache the full catalog locally as JSON
 *   4. Refresh every 24 hours
 *
 * Install Strategy:
 *   1. git sparse-checkout of the specific extension directory
 *   2. Copy to ~/Library/Application Support/SuperCommand/extensions/
 *   3. Run npm install --production
 */

import { app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

const REPO_URL = 'https://github.com/raycast/extensions.git';
const GITHUB_RAW =
  'https://raw.githubusercontent.com/raycast/extensions/main';
const GITHUB_API =
  'https://api.github.com/repos/raycast/extensions/contents';

// ─── Types ──────────────────────────────────────────────────────────

export interface CatalogEntry {
  name: string; // directory name in repo
  title: string;
  description: string;
  author: string;
  contributors: string[];
  icon: string; // icon filename
  iconUrl: string; // full GitHub raw URL to icon
  screenshotUrls: string[];
  categories: string[];
  commands: { name: string; title: string; description: string }[];
}

interface CatalogCache {
  entries: CatalogEntry[];
  fetchedAt: number;
  version: number;
}

const CATALOG_VERSION = 5;
const CATALOG_TTL = 24 * 60 * 60 * 1000; // 24 hours

let catalogCache: CatalogCache | null = null;

// ─── Paths ──────────────────────────────────────────────────────────

function getCatalogPath(): string {
  return path.join(app.getPath('userData'), 'extension-catalog.json');
}

function getExtensionsDir(): string {
  const dir = path.join(app.getPath('userData'), 'extensions');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getInstalledPath(name: string): string {
  return path.join(getExtensionsDir(), name);
}

// ─── Catalog: Disk Cache ────────────────────────────────────────────

function loadCatalogFromDisk(): CatalogCache | null {
  try {
    const data = fs.readFileSync(getCatalogPath(), 'utf-8');
    const cache: CatalogCache = JSON.parse(data);
    if (cache.version === CATALOG_VERSION && Array.isArray(cache.entries)) {
      return cache;
    }
  } catch {}
  return null;
}

function saveCatalogToDisk(catalog: CatalogCache): void {
  try {
    fs.writeFileSync(getCatalogPath(), JSON.stringify(catalog));
  } catch (e) {
    console.error('Failed to save catalog:', e);
  }
}

// ─── Catalog: Fetch from GitHub ─────────────────────────────────────

/**
 * Fetch the full extension catalog.
 * Uses git sparse-checkout to efficiently get only package.json files.
 */
async function fetchCatalogFromGitHub(): Promise<CatalogEntry[]> {
  const tmpDir = path.join(
    app.getPath('temp'),
    `supercommand-catalog-${Date.now()}`
  );

  try {
    console.log('Cloning extension catalog (sparse)…');

    // Sparse clone: only tree structure, no blobs
    await execAsync(
      `git clone --depth 1 --filter=blob:none --sparse "${REPO_URL}" "${tmpDir}"`,
      { timeout: 60_000 }
    );

    // Checkout only package manifests (fast); screenshots are fetched lazily.
    await execAsync(
      `cd "${tmpDir}" && git sparse-checkout set --no-cone "extensions/*/package.json"`,
      { timeout: 120_000 }
    );

    const extensionsDir = path.join(tmpDir, 'extensions');
    if (!fs.existsSync(extensionsDir)) return [];

    const dirs = fs.readdirSync(extensionsDir);
    const entries: CatalogEntry[] = [];

    for (const dir of dirs) {
      const pkgPath = path.join(extensionsDir, dir, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;

      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

        const toAssetUrl = (value: string): string => {
          if (!value) return '';
          if (/^https?:\/\//i.test(value)) return value;
          const normalized = value.replace(/^\.?\//, '');
          if (normalized.startsWith('extensions/')) {
            return `${GITHUB_RAW}/${normalized}`;
          }
          return `${GITHUB_RAW}/extensions/${dir}/${normalized}`;
        };

        const iconFile = pkg.icon || 'assets/icon.png';
        const iconUrl = toAssetUrl(
          iconFile.includes('/') ? iconFile : `assets/${iconFile}`
        );

        const commands = (pkg.commands || []).map((c: any) => ({
          name: c.name || '',
          title: c.title || '',
          description: c.description || '',
        }));

        const normalizePerson = (p: any): string | null => {
          if (!p) return null;
          if (typeof p === 'string') {
            const cleaned = p.split('<')[0].split('(')[0].trim();
            return cleaned || null;
          }
          if (typeof p === 'object') {
            const name = typeof p.name === 'string' ? p.name.trim() : '';
            return name || null;
          }
          return null;
        };

        const contributors: string[] = [];
        const addContributor = (name: string | null) => {
          if (!name) return;
          if (!contributors.includes(name)) contributors.push(name);
        };

        addContributor(normalizePerson(pkg.author));
        if (Array.isArray(pkg.contributors)) {
          for (const person of pkg.contributors) {
            addContributor(normalizePerson(person));
          }
        }

        const authorName = normalizePerson(pkg.author) || '';
        const screenshotUrlsFromPackage: string[] = Array.isArray(pkg.screenshots)
          ? pkg.screenshots
              .map((entry: any) => {
                if (typeof entry === 'string') return toAssetUrl(entry);
                if (entry && typeof entry === 'object') {
                  if (typeof entry.path === 'string') return toAssetUrl(entry.path);
                  if (typeof entry.src === 'string') return toAssetUrl(entry.src);
                  if (typeof entry.url === 'string') return toAssetUrl(entry.url);
                }
                return '';
              })
              .filter(Boolean)
          : [];

        const screenshotUrls = screenshotUrlsFromPackage;

        entries.push({
          name: dir,
          title: pkg.title || dir,
          description: pkg.description || '',
          author: authorName,
          contributors,
          icon: iconFile,
          iconUrl,
          screenshotUrls,
          categories: pkg.categories || [],
          commands,
        });
      } catch {
        // Skip malformed package.json
      }
    }

    entries.sort((a, b) => a.title.localeCompare(b.title));
    return entries;
  } catch (error) {
    console.error('Failed to fetch catalog from GitHub:', error);
    // Fall back to disk cache even if expired
    const diskCache = loadCatalogFromDisk();
    if (diskCache) return diskCache.entries;
    return [];
  } finally {
    // Cleanup temp clone
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// ─── Catalog: Public API ────────────────────────────────────────────

export async function getCatalog(
  forceRefresh = false
): Promise<CatalogEntry[]> {
  // In-memory cache
  if (
    !forceRefresh &&
    catalogCache &&
    Date.now() - catalogCache.fetchedAt < CATALOG_TTL
  ) {
    return catalogCache.entries;
  }

  // Disk cache
  if (!forceRefresh) {
    const diskCache = loadCatalogFromDisk();
    if (diskCache && Date.now() - diskCache.fetchedAt < CATALOG_TTL) {
      catalogCache = diskCache;
      return diskCache.entries;
    }
  }

  // Fetch fresh from GitHub
  const entries = await fetchCatalogFromGitHub();

  const cache: CatalogCache = {
    entries,
    fetchedAt: Date.now(),
    version: CATALOG_VERSION,
  };

  catalogCache = cache;
  saveCatalogToDisk(cache);

  console.log(`Extension catalog: ${entries.length} extensions cached.`);
  return entries;
}

/**
 * Lazily fetch screenshot URLs for one extension from its metadata folder.
 * This avoids pulling all screenshot files into the catalog step.
 */
export async function getExtensionScreenshotUrls(name: string): Promise<string[]> {
  if (!name) return [];
  try {
    const url = `${GITHUB_API}/extensions/${encodeURIComponent(name)}/metadata`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SuperCommand',
        Accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    const imagePattern = /\.(png|jpe?g|webp|gif)$/i;
    return data
      .filter((entry: any) => entry?.type === 'file' && imagePattern.test(entry?.name || ''))
      .sort((a: any, b: any) =>
        String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {
          numeric: true,
        })
      )
      .map((entry: any) => String(entry?.download_url || ''))
      .filter(Boolean);
  } catch (e) {
    console.warn(`Failed to load screenshots for ${name}:`, e);
    return [];
  }
}

// ─── Dependency Installation ────────────────────────────────────────

/**
 * Install an extension's npm dependencies.
 *
 * Strategy:
 *   1. Read the extension's package.json
 *   2. Collect non-Raycast, non-dev dependencies
 *   3. Install them explicitly (avoids issues with @raycast/api peer deps)
 *   4. If that fails, fall back to `npm install --production --legacy-peer-deps`
 */
export async function installExtensionDeps(
  extPath: string
): Promise<void> {
  const pkgPath = path.join(extPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return;

  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return;
  }

  const deps = pkg.dependencies || {};
  // Filter out @raycast/* packages (we provide shims) and any already-external modules
  const thirdPartyDeps = Object.entries(deps)
    .filter(([name]) => !name.startsWith('@raycast/'))
    .map(([name, version]) => `${name}@${version}`)
    .filter(Boolean);

  if (thirdPartyDeps.length === 0) {
    console.log(`No third-party dependencies for ${path.basename(extPath)}`);
    return;
  }

  console.log(
    `Installing ${thirdPartyDeps.length} dependencies for ${path.basename(extPath)}: ${thirdPartyDeps.join(', ')}`
  );

  try {
    // Install only third-party deps explicitly — avoids @raycast/api issues
    // REMOVED --ignore-scripts to allow postinstall scripts for binaries
    await execAsync(
      `npm install --no-save --legacy-peer-deps ${thirdPartyDeps.join(' ')}`,
      { cwd: extPath, timeout: 120_000 }
    );
    console.log(`Dependencies installed for ${path.basename(extPath)}`);
  } catch (e1: any) {
    console.warn(
      `Explicit install failed for ${path.basename(extPath)}: ${e1.message || e1}`
    );
    // Fall back to full npm install (also allow scripts)
    try {
      await execAsync(
        `npm install --production --legacy-peer-deps`,
        { cwd: extPath, timeout: 120_000 }
      );
      console.log(
        `Fallback npm install succeeded for ${path.basename(extPath)}`
      );
    } catch (e2: any) {
      console.error(
        `npm install failed for ${path.basename(extPath)}: ${e2.message || e2}`
      );
    }
  }
}

// ─── Install / Uninstall ────────────────────────────────────────────

export function isExtensionInstalled(name: string): boolean {
  const p = getInstalledPath(name);
  return (
    fs.existsSync(p) && fs.existsSync(path.join(p, 'package.json'))
  );
}

export function getInstalledExtensionNames(): string[] {
  try {
    return fs.readdirSync(getExtensionsDir()).filter((d) => {
      const p = getInstalledPath(d);
      return (
        fs.statSync(p).isDirectory() &&
        fs.existsSync(path.join(p, 'package.json'))
      );
    });
  } catch {
    return [];
  }
}

/**
 * Install a community extension by name.
 * Uses git sparse-checkout to download only the specific extension directory.
 */
export async function installExtension(name: string): Promise<boolean> {
  const installPath = getInstalledPath(name);

  if (fs.existsSync(installPath)) {
    console.log(`Extension ${name} is already installed.`);
    return true;
  }

  const tmpDir = path.join(
    app.getPath('temp'),
    `supercommand-install-${Date.now()}`
  );

  try {
    console.log(`Installing extension: ${name}…`);

    // Sparse clone
    await execAsync(
      `git clone --depth 1 --filter=blob:none --sparse "${REPO_URL}" "${tmpDir}"`,
      { timeout: 60_000 }
    );

    // Checkout only this extension
    await execAsync(
      `cd "${tmpDir}" && git sparse-checkout set "extensions/${name}"`,
      { timeout: 60_000 }
    );

    const srcDir = path.join(tmpDir, 'extensions', name);
    if (!fs.existsSync(srcDir)) {
      console.error(`Extension "${name}" not found in repository.`);
      return false;
    }

    // Copy to local extensions directory
    fs.cpSync(srcDir, installPath, { recursive: true });

    // Step 1: Install npm dependencies
    await installExtensionDeps(installPath);

    // Step 2: Pre-build all commands with esbuild
    console.log(`Pre-building commands for "${name}"…`);
    const { buildAllCommands } = require('./extension-runner');
    const builtCount = await buildAllCommands(name);
    console.log(`Extension "${name}" installed and pre-built (${builtCount} commands) at ${installPath}`);
    return true;
  } catch (error) {
    console.error(`Failed to install extension "${name}":`, error);
    // Cleanup partial install
    try {
      fs.rmSync(installPath, { recursive: true, force: true });
    } catch {}
    return false;
  } finally {
    // Cleanup temp clone
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Uninstall a community extension by name.
 */
export async function uninstallExtension(name: string): Promise<boolean> {
  const installPath = getInstalledPath(name);

  if (!fs.existsSync(installPath)) {
    return true; // Already gone
  }

  try {
    fs.rmSync(installPath, { recursive: true, force: true });
    console.log(`Extension "${name}" uninstalled.`);
    return true;
  } catch (error) {
    console.error(`Failed to uninstall extension "${name}":`, error);
    return false;
  }
}
