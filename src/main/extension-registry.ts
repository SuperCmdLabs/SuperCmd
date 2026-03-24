/**
 * Extension Registry
 *
 * Fetches, caches, installs, and uninstalls community extensions.
 *
 * Primary strategy: API-based (supercmd-backend)
 *   - No git or npm required on user's machine
 *   - Fast search/discovery via backend API
 *   - Pre-built bundles downloaded from S3
 *
 * Fallback strategy: git sparse-checkout + npm (only when API returns non-2xx)
 *   - Requires git and npm installed on user's machine
 *   - Used as fallback when backend API is unavailable
 */

import { app, dialog } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import {
  getCurrentRaycastPlatform,
  getManifestPlatforms,
  isManifestPlatformCompatible,
} from './extension-platform';
import {
  fetchCatalogFromAPI,
  getExtensionBundleUrl,
  getExtensionScreenshotsFromAPI,
  reportInstall,
  reportUninstall,
} from './extension-api';
import { installDepsWithBun } from './bun-manager';

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

  // Create all directories upfront
  for (const entry of fileEntries) {
    const relativePath = entry.path.slice(prefix.length);
    if (!relativePath) continue;
    const destination = path.join(srcDir, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
  }

  // Download files in parallel (up to 15 concurrent)
  const CONCURRENCY = 30;
  let index = 0;

  const downloadOne = async () => {
    while (index < fileEntries.length) {
      const i = index++;
      const entry = fileEntries[i];
      const relativePath = entry.path.slice(prefix.length);
      if (!relativePath) continue;

      const destination = path.join(srcDir, relativePath);
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
  };

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, fileEntries.length) },
    () => downloadOne()
  );
  await Promise.all(workers);

  console.log(`Downloaded ${fileEntries.length} files for "${name}"`);
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
  installCount?: number; // from backend API
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

  // PRIMARY: Fetch from supercmd-backend API
  try {
    console.log('Fetching extension catalog from API…');
    const entries = await fetchCatalogFromAPI();

    const cache: CatalogCache = {
      entries,
      fetchedAt: Date.now(),
      version: CATALOG_VERSION,
    };
    catalogCache = cache;
    saveCatalogToDisk(cache);

    console.log(`Extension catalog (API): ${entries.length} extensions cached.`);
    return entries;
  } catch (apiError: any) {
    console.warn('API catalog fetch failed, trying git fallback:', apiError?.message || apiError);
  }

  // FALLBACK: git sparse-checkout (requires git on user's machine)
  try {
    const entries = await fetchCatalogFromGitHub();

    const cache: CatalogCache = {
      entries,
      fetchedAt: Date.now(),
      version: CATALOG_VERSION,
    };
    catalogCache = cache;
    saveCatalogToDisk(cache);

    console.log(`Extension catalog (git fallback): ${entries.length} extensions cached.`);
    return entries;
  } catch (gitError: any) {
    console.warn('Git catalog fallback failed:', gitError?.message || gitError);
  }

  // LAST RESORT: disk cache (even if expired)
  const diskCache = loadCatalogFromDisk();
  if (diskCache) {
    catalogCache = diskCache;
    console.log(`Extension catalog (disk cache): ${diskCache.entries.length} extensions from cache.`);
    return diskCache.entries;
  }

  return [];
}

/**
 * Lazily fetch screenshot URLs for one extension.
 * Tries the backend API first, falls back to GitHub API.
 */
export async function getExtensionScreenshotUrls(name: string): Promise<string[]> {
  if (!name) return [];

  // PRIMARY: Try backend API
  try {
    const urls = await getExtensionScreenshotsFromAPI(name);
    if (urls.length > 0) return urls;
  } catch (apiError: any) {
    console.warn(`API screenshots fetch failed for ${name}:`, apiError?.message || apiError);
  }

  // FALLBACK: GitHub API
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
 *
 * Strategy:
 *   1. PRIMARY: Download pre-built bundle from API (no git/npm needed)
 *   2. FALLBACK: git sparse-checkout + npm install (if API returns non-2xx)
 */
export async function installExtension(name: string): Promise<boolean> {
  if (!/^[A-Za-z0-9._-]+$/.test(String(name || ''))) {
    console.error(`Invalid extension name: "${name}"`);
    return false;
  }

  // 1. FASTEST: Pre-built bundle from S3 (~2-3s, no npm/bun/esbuild needed)
  try {
    const success = await installExtensionFromBundle(name);
    if (success) return true;
  } catch (bundleError: any) {
    console.warn(`Bundle install failed for "${name}":`, bundleError?.message || bundleError);
  }

  // 2. FALLBACK: Download source + bun/npm + esbuild
  try {
    const success = await installExtensionViaAPI(name);
    if (success) return true;
  } catch (apiError: any) {
    console.warn(`API install failed for "${name}":`, apiError?.message || apiError);
  }

  // 3. LAST RESORT: git sparse-checkout
  try {
    const success = await installExtensionViaGit(name);
    if (success) return true;
  } catch (gitError: any) {
    console.warn(`Git install also failed for "${name}":`, gitError?.message || gitError);
  }

  return false;
}

// ─── Pre-built Bundle Install (Fastest) ─────────────────────────────

/**
 * Download a pre-built bundle from S3 via the backend API.
 * The bundle contains package.json + assets/ + .sc-build/ (esbuild output).
 * No npm, no bun, no esbuild needed. ~2-3s total.
 */
async function installExtensionFromBundle(name: string): Promise<boolean> {
  const installPath = getInstalledPath(name);
  const hadExistingInstall = fs.existsSync(installPath);
  const backupPath = hadExistingInstall
    ? path.join(getExtensionsDir(), `${name}.backup-${Date.now()}`)
    : '';
  const tmpDir = path.join(app.getPath('temp'), `supercmd-bundle-${Date.now()}`);

  try {
    const t0 = Date.now();

    // Get pre-signed S3 URL from backend
    const { url } = await getExtensionBundleUrl(name);
    console.log(`Downloading pre-built bundle for "${name}"…`);

    fs.mkdirSync(tmpDir, { recursive: true });
    await downloadAndExtractTarball(url, tmpDir);

    // Find the extension in the extracted directory
    const nestedPath = path.join(tmpDir, name);
    let srcDir = tmpDir;
    if (fs.existsSync(path.join(nestedPath, 'package.json'))) {
      srcDir = nestedPath;
    } else if (!fs.existsSync(path.join(srcDir, 'package.json'))) {
      // Search subdirs
      const subdirs = fs.readdirSync(tmpDir, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const sub of subdirs) {
        if (fs.existsSync(path.join(tmpDir, sub.name, 'package.json'))) {
          srcDir = path.join(tmpDir, sub.name);
          break;
        }
      }
    }

    if (!fs.existsSync(path.join(srcDir, 'package.json'))) {
      throw new Error('Bundle has no package.json');
    }

    // Must have .sc-build/ — otherwise it's not a valid pre-built bundle
    if (!fs.existsSync(path.join(srcDir, '.sc-build'))) {
      throw new Error('Bundle has no .sc-build/ directory — not a pre-built bundle');
    }

    // Backup existing
    if (hadExistingInstall) {
      fs.renameSync(installPath, backupPath);
    }

    // Copy to extensions directory
    fs.cpSync(srcDir, installPath, { recursive: true });

    // Cleanup backup
    if (backupPath && fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }

    // Report install (fire-and-forget)
    reportInstall(name, getMachineId()).catch(() => {});

    console.log(`Extension "${name}" installed from pre-built bundle in ${Date.now() - t0}ms`);
    return true;
  } catch (error) {
    // Rollback
    try { fs.rmSync(installPath, { recursive: true, force: true }); } catch {}
    if (backupPath && fs.existsSync(backupPath)) {
      try { fs.renameSync(backupPath, installPath); } catch {}
    }
    throw error;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (backupPath && fs.existsSync(backupPath)) {
      try { fs.rmSync(backupPath, { recursive: true, force: true }); } catch {}
    }
  }
}

// ─── Source-based Install ───────────────────────────────────────────

/**
 * Download source from GitHub raw, install deps with bun/npm, esbuild.
 * Fallback when no pre-built bundle exists.
 */
async function installExtensionViaAPI(name: string): Promise<boolean> {
  const installPath = getInstalledPath(name);
  const hadExistingInstall = fs.existsSync(installPath);
  const backupPath = hadExistingInstall
    ? path.join(getExtensionsDir(), `${name}.backup-${Date.now()}`)
    : '';
  const tmpDir = path.join(app.getPath('temp'), `supercmd-api-install-${Date.now()}`);

  try {
    const t0 = Date.now();
    console.log(`Installing extension: ${name}…`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Download extension source from GitHub raw (no git needed)
    const srcDir = await downloadExtensionFromTree(name, tmpDir);
    console.log(`  Download: ${Date.now() - t0}ms`);

    if (!srcDir || !fs.existsSync(path.join(srcDir, 'package.json'))) {
      throw new Error(`Extension "${name}" not found or has no package.json`);
    }

    // Platform compatibility check
    const srcPkg = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf-8'));
    if (!isManifestPlatformCompatible(srcPkg)) {
      const supported = getManifestPlatforms(srcPkg);
      console.error(`Extension "${name}" is not compatible with ${getCurrentRaycastPlatform()} (supports: ${supported.join(', ')})`);
      return false;
    }

    // Backup existing installation
    if (hadExistingInstall) {
      fs.renameSync(installPath, backupPath);
    }

    // Copy to local extensions directory
    fs.cpSync(srcDir, installPath, { recursive: true });

    // Install dependencies and build
    {
      const extPkg = JSON.parse(fs.readFileSync(path.join(installPath, 'package.json'), 'utf-8'));
      const allDeps = { ...(extPkg.dependencies || {}), ...(extPkg.optionalDependencies || {}) };
      const thirdPartyDeps = Object.keys(allDeps).filter((d) => !d.startsWith('@raycast/'));

      if (thirdPartyDeps.length === 0) {
        console.log(`No third-party dependencies for "${name}" — skipping install`);
      } else {
        // Try Bun first (faster), fall back to npm
        let depsInstalled = false;

        try {
          depsInstalled = await installDepsWithBun(installPath);
        } catch (bunError: any) {
          console.warn(`Bun install failed for "${name}":`, bunError?.message);
        }

        if (!depsInstalled) {
          console.log(`Bun unavailable or failed, trying npm for "${name}"...`);
          try {
            await installExtensionDeps(installPath);
            depsInstalled = true;
          } catch (npmError: any) {
            console.warn(`npm install also failed for "${name}":`, npmError?.message);
          }
        }

        if (!depsInstalled) {
          console.warn(`Could not install deps for "${name}" — extension may not work fully.`);
        }
      }

      const t1 = Date.now();
      console.log(`  Deps: ${t1 - t0}ms. Pre-building commands for "${name}"…`);
      const { buildAllCommands } = require('./extension-runner');
      const builtCount = await buildAllCommands(name);
      console.log(`  Build: ${Date.now() - t1}ms. Extension "${name}" installed (${builtCount} commands) in ${Date.now() - t0}ms total`);
    }

    // Cleanup backup
    if (backupPath && fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }

    // Report install to backend (fire-and-forget)
    reportInstall(name, getMachineId()).catch(() => {});

    return true;
  } catch (error) {
    console.error(`API install failed for "${name}":`, error);
    // Rollback
    try {
      fs.rmSync(installPath, { recursive: true, force: true });
    } catch {}
    if (backupPath && fs.existsSync(backupPath)) {
      try { fs.renameSync(backupPath, installPath); } catch {}
    }
    throw error; // Re-throw so the caller knows to try git fallback
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (backupPath && fs.existsSync(backupPath)) {
      try { fs.rmSync(backupPath, { recursive: true, force: true }); } catch {}
    }
  }
}

// ─── Git-based Install (Fallback) ───────────────────────────────────

/**
 * Install a community extension via git sparse-checkout + npm install.
 * This is the legacy fallback when the API is unavailable.
 */
async function installExtensionViaGit(name: string): Promise<boolean> {
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
      fs.renameSync(installPath, backupPath);
    }

    // Copy to local extensions directory
    fs.cpSync(srcDir, installPath, { recursive: true });

    // Step 1: Install dependencies (Bun first, npm fallback)
    let depsInstalled = false;
    try {
      depsInstalled = await installDepsWithBun(installPath);
    } catch {}
    if (!depsInstalled) {
      await installExtensionDeps(installPath);
    }

    // Step 2: Pre-build all commands with esbuild
    console.log(`Pre-building commands for "${name}"…`);
    const { buildAllCommands } = require('./extension-runner');
    const builtCount = await buildAllCommands(name);
    console.log(`Extension "${name}" installed (${builtCount} commands) at ${installPath}`);
    if (backupPath && fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }
    return true;
  } catch (error) {
    console.error(`Failed to install extension "${name}" via git:`, error);
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

// ─── Download + Extract Helpers ─────────────────────────────────────

/**
 * Download a .tar.gz from a URL and extract to destDir.
 * Uses Node.js built-in https + zlib + tar-stream parsing — no npm deps.
 */
async function downloadAndExtractTarball(url: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const parsedUrl = new URL(requestUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? require('https') : require('http');

      transport.get(requestUrl, { timeout: 120_000 }, (res: any) => {
        // Follow redirects (S3 pre-signed URLs may redirect)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode} ${res.statusMessage}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks);
            extractTarGz(buffer, destDir);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', reject);
    };

    makeRequest(url);
  });
}

/**
 * Extract a .tar.gz buffer to a directory.
 * Minimal tar parser that handles POSIX ustar format (sufficient for our bundles).
 */
function extractTarGz(buffer: Buffer, destDir: string): void {
  // Decompress gzip
  const decompressed = zlib.gunzipSync(buffer);

  // Parse tar entries (512-byte blocks)
  let offset = 0;
  while (offset < decompressed.length - 512) {
    // Read header
    const header = decompressed.subarray(offset, offset + 512);

    // Check for end-of-archive (two zero blocks)
    if (header.every((b) => b === 0)) break;

    // Parse tar header fields
    const nameRaw = header.subarray(0, 100).toString('utf-8').replace(/\0+$/, '');
    const sizeOctal = header.subarray(124, 136).toString('utf-8').replace(/\0+$/, '').trim();
    const typeFlag = header[156];
    const prefixRaw = header.subarray(345, 500).toString('utf-8').replace(/\0+$/, '');

    const fullName = prefixRaw ? `${prefixRaw}/${nameRaw}` : nameRaw;
    const size = parseInt(sizeOctal, 8) || 0;

    offset += 512; // Move past header

    if (typeFlag === 53 || fullName.endsWith('/')) {
      // Directory entry (type '5' = 53 in ASCII)
      const dirPath = path.join(destDir, fullName);
      fs.mkdirSync(dirPath, { recursive: true });
    } else if (typeFlag === 0 || typeFlag === 48) {
      // Regular file (type '0' = 48 in ASCII, or 0 = null for old tar)
      const filePath = path.join(destDir, fullName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const fileData = decompressed.subarray(offset, offset + size);
      fs.writeFileSync(filePath, fileData);
    }
    // Skip other entry types (symlinks, etc.)

    // Move past data blocks (padded to 512 bytes)
    const dataBlocks = Math.ceil(size / 512);
    offset += dataBlocks * 512;
  }
}

// ─── Machine ID ─────────────────────────────────────────────────────

let _machineId: string | null = null;

/**
 * Get or generate a persistent anonymous machine ID for install tracking.
 * Stored in the user data directory — no PII.
 */
function getMachineId(): string {
  if (_machineId) return _machineId;

  const idPath = path.join(app.getPath('userData'), '.machine-id');
  try {
    const existing = fs.readFileSync(idPath, 'utf-8').trim();
    if (existing) {
      _machineId = existing;
      return existing;
    }
  } catch {}

  // Generate a random UUID
  const id = `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;
  try {
    fs.writeFileSync(idPath, id);
  } catch {}
  _machineId = id;
  return id;
}

function randomHex(length: number): string {
  const bytes = require('crypto').randomBytes(Math.ceil(length / 2));
  return bytes.toString('hex').slice(0, length);
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

    // Report uninstall to backend (fire-and-forget)
    reportUninstall(name, getMachineId()).catch(() => {});

    return true;
  } catch (error) {
    console.error(`Failed to uninstall extension "${name}":`, error);
    return false;
  }
}
