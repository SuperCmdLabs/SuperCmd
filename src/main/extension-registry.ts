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
 *   2. Copy to ~/Library/Application Support/SuperCmd/extensions/
 *   3. Run npm install --production
 */

import { app, dialog } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getCurrentRaycastPlatform,
  getManifestPlatforms,
  isManifestPlatformCompatible,
} from './extension-platform';

const execAsync = promisify(exec);

function shellQuoteSingle(value: string): string {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function buildExecutablePath(primaryDir?: string): string {
  const parts = [
    primaryDir || '',
    String(process.env.PATH || ''),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].filter(Boolean);

  const deduped: string[] = [];
  for (const part of parts) {
    if (!deduped.includes(part)) deduped.push(part);
  }
  return deduped.join(':');
}

function formatExecError(error: any): string {
  const message = String(error?.message || '');
  const stderr = String(error?.stderr || '').trim();
  if (!stderr) return message || 'Unknown error';
  return `${message}\n${stderr}`.trim();
}

function resolveNpmExecutable(): string | null {
  const home = os.homedir();
  const nvmNodesDir = path.join(home, '.nvm', 'versions', 'node');
  const nvmCandidates: string[] = [];
  try {
    const versions = fs
      .readdirSync(nvmNodesDir)
      .map((v) => path.join(nvmNodesDir, v, 'bin', 'npm'))
      .filter((p) => fs.existsSync(p))
      .sort()
      .reverse();
    nvmCandidates.push(...versions);
  } catch {}

  const candidates = [
    String(process.env.npm_execpath || '').trim(),
    String(process.env.NPM || '').trim(),
    path.join(home, '.volta', 'bin', 'npm'),
    path.join(home, '.fnm', 'current', 'bin', 'npm'),
    ...nvmCandidates,
    '/opt/homebrew/bin/npm',
    '/usr/local/bin/npm',
    '/usr/bin/npm',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }

  return null;
}

function resolveGitExecutable(): string | null {
  const home = os.homedir();
  const candidates = [
    String(process.env.GIT || '').trim(),
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
    path.join(home, '.volta', 'bin', 'git'),
    '/usr/bin/git',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

function resolveBrewExecutable(): string | null {
  const home = os.homedir();
  const candidates = [
    String(process.env.HOMEBREW_BIN || '').trim(),
    '/opt/homebrew/bin/brew',
    '/usr/local/bin/brew',
    path.join(home, '.linuxbrew', 'bin', 'brew'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

function isDeveloperToolsGitError(error: any): boolean {
  const text = `${String(error?.message || '')}\n${String(error?.stderr || '')}`.toLowerCase();
  return (
    text.includes('xcode-select') ||
    text.includes('no developer tools were found') ||
    text.includes('xcrun: error') ||
    text.includes('unable to find utility "git"')
  );
}

let brewGitInstallPromise: Promise<void> | null = null;
let brewGitInstalled = false;
let gitSetupDialogPromise: Promise<void> | null = null;

async function showGitSetupDialog(
  message: string,
  detail: string
): Promise<void> {
  if (gitSetupDialogPromise) {
    await gitSetupDialogPromise;
    return;
  }
  gitSetupDialogPromise = (async () => {
    try {
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Quit SuperCmd', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'Git Setup Required',
        message,
        detail,
      });
      if (result.response === 0) {
        app.quit();
      }
    } catch (error) {
      console.error('Failed to show Git setup dialog:', error);
    }
  })();
  try {
    await gitSetupDialogPromise;
  } finally {
    gitSetupDialogPromise = null;
  }
}

async function ensureGitInstalledWithBrew(): Promise<void> {
  if (brewGitInstalled) return;
  if (brewGitInstallPromise) {
    await brewGitInstallPromise;
    return;
  }

  brewGitInstallPromise = (async () => {
    const brewExecutable = resolveBrewExecutable();
    if (!brewExecutable) {
      await showGitSetupDialog(
        'Git is required to install extensions.',
        'Homebrew was not found on this Mac.\n\nInstall Homebrew first:\n/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n\nThen reopen SuperCmd and try again.'
      );
      throw new Error('Git setup required: Homebrew is not installed.');
    }
    const brewBinDir = path.dirname(brewExecutable);
    try {
      await execAsync(
        `"${brewExecutable}" list --versions git >/dev/null 2>&1 || "${brewExecutable}" install git`,
        {
          timeout: 15 * 60_000,
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            PATH: buildExecutablePath(brewBinDir),
          },
        }
      );
    } catch (error) {
      await showGitSetupDialog(
        'Git is required to install extensions.',
        `Automatic Git install failed.\n\nRun this command in Terminal:\n"${brewExecutable}" install git\n\nThen quit and reopen SuperCmd and try again.`
      );
      throw new Error('Git setup required: automatic brew install failed.');
    }
    brewGitInstalled = true;
    await showGitSetupDialog(
      'Git has been installed.',
      'Please quit and reopen SuperCmd, then try installing extensions again.'
    );
    throw new Error('Git was installed. Restart SuperCmd and retry.');
  })();

  try {
    await brewGitInstallPromise;
  } finally {
    brewGitInstallPromise = null;
  }
}

async function runNpmCommand(extPath: string, args: string, timeoutMs: number): Promise<void> {
  const npmExecutable = resolveNpmExecutable();
  let directError: any = null;
  if (npmExecutable) {
    const npmBinDir = path.dirname(npmExecutable);
    try {
      await execAsync(`"${npmExecutable}" ${args}`, {
        cwd: extPath,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: buildExecutablePath(npmBinDir),
        },
      });
      return;
    } catch (error: any) {
      directError = error;
      console.warn(`Direct npm invocation failed, trying shell fallback: ${formatExecError(error)}`);
    }
  }

  // Fallback for GUI-launched app sessions where PATH/env differs from terminal.
  const script = `cd ${shellQuoteSingle(extPath)} && npm ${args}`;
  try {
    await execAsync(`/bin/zsh -ilc ${shellQuoteSingle(script)}`, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: buildExecutablePath(),
      },
    });
  } catch (shellError: any) {
    if (directError) {
      throw new Error(
        `npm failed (direct and shell fallback).\nDirect: ${formatExecError(directError)}\nShell fallback: ${formatExecError(shellError)}`
      );
    }
    throw shellError;
  }
}

async function runGitCommand(cwd: string, args: string, timeoutMs: number): Promise<void> {
  const runWithResolvedGit = async (): Promise<void> => {
    const gitExecutable = resolveGitExecutable();
    if (!gitExecutable) {
      throw new Error('git executable was not found');
    }
    await execAsync(`"${gitExecutable}" ${args}`, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: buildExecutablePath(path.dirname(gitExecutable)),
      },
    });
  };

  try {
    await runWithResolvedGit();
    return;
  } catch (error: any) {
    const message = String(error?.message || '');
    const missingGit = /not found|enoent/i.test(message);
    if (!missingGit && !isDeveloperToolsGitError(error)) {
      throw error;
    }
  }

  await ensureGitInstalledWithBrew();
  throw new Error('Git setup required. Quit and reopen SuperCmd, then try again.');
}

function hasNodeModules(extPath: string): boolean {
  try {
    return fs.existsSync(path.join(extPath, 'node_modules'));
  } catch {
    return false;
  }
}

const REPO_URL = 'https://github.com/raycast/extensions.git';
const GITHUB_RAW =
  'https://raw.githubusercontent.com/raycast/extensions/main';
const GITHUB_API =
  'https://api.github.com/repos/raycast/extensions/contents';
const GITHUB_TREE_API =
  'https://api.github.com/repos/raycast/extensions/git/trees/main?recursive=1';

type RepoTreeEntry = {
  path: string;
  type: 'blob' | 'tree' | string;
  size?: number;
};
type RepoTreeCache = {
  fetchedAt: number;
  entries: RepoTreeEntry[];
};
const REPO_TREE_TTL_MS = 10 * 60 * 1000;
let repoTreeCache: RepoTreeCache | null = null;

function shouldUseNetworkFallback(error: any): boolean {
  const text = `${String(error?.message || '')}\n${String(error?.stderr || '')}`.toLowerCase();
  return (
    text.includes('homebrew was not found') ||
    text.includes('git executable was not found') ||
    text.includes('xcode-select') ||
    text.includes('no developer tools were found') ||
    text.includes('unable to find utility "git"') ||
    /enoent|not found/.test(text)
  );
}

function githubApiHeaders(): Record<string, string> {
  return {
    'User-Agent': 'SuperCmd',
    Accept: 'application/vnd.github+json',
  };
}

async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 45_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRepoTreeEntries(forceRefresh = false): Promise<RepoTreeEntry[]> {
  if (
    !forceRefresh &&
    repoTreeCache &&
    Date.now() - repoTreeCache.fetchedAt < REPO_TREE_TTL_MS
  ) {
    return repoTreeCache.entries;
  }

  const response = await fetchWithTimeout(
    GITHUB_TREE_API,
    { headers: githubApiHeaders() },
    90_000
  );
  if (!response.ok) {
    throw new Error(`GitHub tree fetch failed with ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const rawEntries = Array.isArray(data?.tree) ? data.tree : [];
  const entries: RepoTreeEntry[] = rawEntries
    .map((entry: any) => ({
      path: String(entry?.path || ''),
      type: String(entry?.type || ''),
      size: typeof entry?.size === 'number' ? entry.size : undefined,
    }))
    .filter((entry: RepoTreeEntry) => Boolean(entry.path));

  repoTreeCache = {
    fetchedAt: Date.now(),
    entries,
  };
  return entries;
}

function readCatalogEntriesFromExtensionsDir(extensionsDir: string): CatalogEntry[] {
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
      const platforms = getManifestPlatforms(pkg);
      if (!isManifestPlatformCompatible(pkg)) {
        continue;
      }

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
        platforms,
        commands,
      });
    } catch {
      // Skip malformed package.json
    }
  }

  entries.sort((a, b) => a.title.localeCompare(b.title));
  return entries;
}

function buildLightweightCatalogFromTree(
  treeEntries: RepoTreeEntry[],
  previousEntries: CatalogEntry[] = []
): CatalogEntry[] {
  const previousByName = new Map<string, CatalogEntry>();
  for (const entry of previousEntries) {
    previousByName.set(entry.name, entry);
  }

  const extensionNames = new Set<string>();
  for (const entry of treeEntries) {
    const match = /^extensions\/([^/]+)\/package\.json$/.exec(entry.path);
    if (match) extensionNames.add(match[1]);
  }

  const result: CatalogEntry[] = Array.from(extensionNames).map((name) => {
    const previous = previousByName.get(name);
    const fallbackTitle = name.replace(/[-_]+/g, ' ');
    return {
      name,
      title: previous?.title || fallbackTitle || name,
      description: previous?.description || '',
      author: previous?.author || '',
      contributors: previous?.contributors || [],
      icon: previous?.icon || 'assets/icon.png',
      iconUrl: previous?.iconUrl || `${GITHUB_RAW}/extensions/${name}/assets/icon.png`,
      screenshotUrls: previous?.screenshotUrls || [],
      categories: previous?.categories || [],
      platforms: previous?.platforms || [],
      commands: previous?.commands || [],
    };
  });

  result.sort((a, b) => a.title.localeCompare(b.title));
  return result;
}

async function downloadExtensionFromTree(name: string, tmpDir: string): Promise<string | null> {
  const treeEntries = await fetchRepoTreeEntries();
  const prefix = `extensions/${name}/`;
  const fileEntries = treeEntries.filter(
    (entry) => entry.type === 'blob' && entry.path.startsWith(prefix)
  );
  if (fileEntries.length === 0) return null;

  const srcDir = path.join(tmpDir, 'extensions', name);
  fs.mkdirSync(srcDir, { recursive: true });

  for (const entry of fileEntries) {
    const relativePath = entry.path.slice(prefix.length);
    if (!relativePath) continue;

    const destination = path.join(srcDir, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });

    const fileUrl = `${GITHUB_RAW}/${entry.path}`;
    const response = await fetchWithTimeout(
      fileUrl,
      {
        headers: {
          'User-Agent': 'SuperCmd',
          Accept: 'application/octet-stream',
        },
      },
      90_000
    );
    if (!response.ok) {
      throw new Error(`Failed to download ${entry.path} (${response.status} ${response.statusText})`);
    }
    const data = await response.arrayBuffer();
    fs.writeFileSync(destination, Buffer.from(data));
  }

  return srcDir;
}

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
  platforms: string[];
  commands: { name: string; title: string; description: string }[];
}

interface CatalogCache {
  entries: CatalogEntry[];
  fetchedAt: number;
  version: number;
}

const CATALOG_VERSION = 6;
const CATALOG_TTL = 24 * 60 * 60 * 1000; // 24 hours

let catalogCache: CatalogCache | null = null;

function coerceCatalogEntry(raw: any): CatalogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name : '';
  if (!name) return null;

  const commands = Array.isArray(raw.commands)
    ? raw.commands
        .filter((cmd: any) => cmd && typeof cmd === 'object' && cmd.name)
        .map((cmd: any) => ({
          name: String(cmd.name || ''),
          title: String(cmd.title || cmd.name || ''),
          description: String(cmd.description || ''),
        }))
    : [];

  return {
    name,
    title: typeof raw.title === 'string' ? raw.title : name,
    description: typeof raw.description === 'string' ? raw.description : '',
    author: typeof raw.author === 'string' ? raw.author : '',
    contributors: Array.isArray(raw.contributors)
      ? raw.contributors.filter((v: any) => typeof v === 'string')
      : [],
    icon: typeof raw.icon === 'string' ? raw.icon : '',
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : '',
    screenshotUrls: Array.isArray(raw.screenshotUrls)
      ? raw.screenshotUrls.filter((v: any) => typeof v === 'string')
      : [],
    categories: Array.isArray(raw.categories)
      ? raw.categories.filter((v: any) => typeof v === 'string')
      : [],
    platforms: Array.isArray(raw.platforms)
      ? raw.platforms.filter((v: any) => typeof v === 'string')
      : [],
    commands,
  };
}

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
    const parsed = JSON.parse(data) as Partial<CatalogCache>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map((entry: any) => coerceCatalogEntry(entry))
          .filter(Boolean) as CatalogEntry[]
      : [];
    if (entries.length === 0) return null;
    return {
      entries,
      fetchedAt:
        typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : Date.now(),
      version:
        typeof parsed.version === 'number' ? parsed.version : CATALOG_VERSION,
    };
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
    `supercmd-catalog-${Date.now()}`
  );
  const diskCache = loadCatalogFromDisk();

  try {
    console.log('Cloning extension catalog (sparse)…');

    // Sparse clone: only tree structure, no blobs
    await runGitCommand(
      app.getPath('temp'),
      `clone --depth 1 --filter=blob:none --sparse "${REPO_URL}" "${tmpDir}"`,
      60_000
    );

    // Checkout only package manifests (fast); screenshots are fetched lazily.
    await runGitCommand(
      tmpDir,
      'sparse-checkout set --no-cone "extensions/*/package.json"',
      120_000
    );

    const extensionsDir = path.join(tmpDir, 'extensions');
    if (!fs.existsSync(extensionsDir)) return [];
    return readCatalogEntriesFromExtensionsDir(extensionsDir);
  } catch (error: any) {
    console.error('Failed to fetch catalog from GitHub:', error);

    // Fall back to disk cache even if expired
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
        'User-Agent': 'SuperCmd',
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

  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  // Filter out @raycast/* packages (we provide shims) and any already-external modules
  const thirdPartyDeps = Object.entries(deps)
    .filter(([name]) => !name.startsWith('@raycast/'))
    .map(([name, version]) => `${name}@${version}`)
    .filter(Boolean);
  const quotedThirdPartyDeps = thirdPartyDeps
    .map((dep) => `"${String(dep).replace(/"/g, '\\"')}"`)
    .join(' ');

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
    await runNpmCommand(
      extPath,
      `install --no-save --legacy-peer-deps ${quotedThirdPartyDeps}`,
      300_000
    );
    if (!hasNodeModules(extPath)) {
      throw new Error('npm completed but node_modules is still missing');
    }
    console.log(`Dependencies installed for ${path.basename(extPath)}`);
  } catch (e1: any) {
    console.warn(
      `Explicit install failed for ${path.basename(extPath)}: ${e1.message || e1}`
    );
    // Fall back to full npm install (also allow scripts)
    try {
      await runNpmCommand(
        extPath,
        'install --production --legacy-peer-deps',
        300_000
      );
      if (!hasNodeModules(extPath)) {
        throw new Error('npm completed but node_modules is still missing');
      }
      console.log(
        `Fallback npm install succeeded for ${path.basename(extPath)}`
      );
    } catch (e2: any) {
      const reason = String(e2?.message || e2 || 'Unknown npm error');
      console.error(`npm install failed for ${path.basename(extPath)}: ${reason}`);
      throw new Error(`Dependency installation failed for ${path.basename(extPath)}: ${reason}`);
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
  if (!/^[A-Za-z0-9._-]+$/.test(String(name || ''))) {
    console.error(`Invalid extension name: "${name}"`);
    return false;
  }

  const installPath = getInstalledPath(name);
  const hadExistingInstall = fs.existsSync(installPath);
  const backupPath = hadExistingInstall
    ? path.join(getExtensionsDir(), `${name}.backup-${Date.now()}`)
    : '';

  const tmpDir = path.join(
    app.getPath('temp'),
    `supercmd-install-${Date.now()}`
  );

  try {
    console.log(`Installing extension: ${name}…`);
    let srcDir: string | null = null;

    try {
      // Sparse clone
      await runGitCommand(
        app.getPath('temp'),
        `clone --depth 1 --filter=blob:none --sparse "${REPO_URL}" "${tmpDir}"`,
        60_000
      );

      // Checkout only this extension
      await runGitCommand(
        tmpDir,
        `sparse-checkout set "extensions/${name}"`,
        60_000
      );

      srcDir = path.join(tmpDir, 'extensions', name);
    } catch (acquireError: any) {
      throw acquireError;
    }

    if (!srcDir || !fs.existsSync(srcDir)) {
      console.error(`Extension "${name}" not found in repository.`);
      return false;
    }
    const srcPkgPath = path.join(srcDir, 'package.json');
    if (!fs.existsSync(srcPkgPath)) {
      console.error(`Extension "${name}" has no manifest.`);
      return false;
    }
    const srcPkg = JSON.parse(fs.readFileSync(srcPkgPath, 'utf-8'));
    if (!isManifestPlatformCompatible(srcPkg)) {
      const supported = getManifestPlatforms(srcPkg);
      const supportedText = supported.length > 0 ? supported.join(', ') : 'unknown';
      console.error(
        `Extension "${name}" is not compatible with ${getCurrentRaycastPlatform()} (supports: ${supportedText}).`
      );
      return false;
    }

    if (hadExistingInstall) {
      // Move existing install out of the way so this install acts as an update.
      fs.renameSync(installPath, backupPath);
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
    if (backupPath && fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }
    return true;
  } catch (error) {
    console.error(`Failed to install extension "${name}":`, error);
    // Cleanup partial install and roll back previous version when updating.
    try {
      fs.rmSync(installPath, { recursive: true, force: true });
    } catch {}
    if (backupPath && fs.existsSync(backupPath)) {
      try {
        fs.renameSync(backupPath, installPath);
      } catch {}
    }
    return false;
  } finally {
    // Cleanup temp clone
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    if (backupPath && fs.existsSync(backupPath)) {
      try {
        fs.rmSync(backupPath, { recursive: true, force: true });
      } catch {}
    }
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
