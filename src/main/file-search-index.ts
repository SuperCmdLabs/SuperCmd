import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

export type IndexedFileSearchResult = {
  path: string;
  name: string;
  parentPath: string;
  displayPath: string;
  isDirectory: boolean;
};

export type FileSearchIndexStatus = {
  indexing: boolean;
  ready: boolean;
  indexedEntryCount: number;
  lastIndexedAt: number | null;
  homeDirectory: string;
  includeRoots: string[];
  excludedDirectoryNames: string[];
  excludedTopLevelDirectories: string[];
  protectedTopLevelDirectories: string[];
  includeProtectedHomeRoots: boolean;
  lastError: string | null;
};

type IndexedEntry = {
  path: string;
  name: string;
  parentPath: string;
  normalizedName: string;
  normalizedPath: string;
  compactName: string;
  tokens: string[];
  isDirectory: boolean;
};

type IndexSnapshot = {
  entries: IndexedEntry[];
  prefixToEntryIds: Map<string, number[]>;
  builtAt: number;
};

const SEARCH_TOKEN_SPLIT_REGEX = /[^a-z0-9]+/g;
const MAX_PREFIX_LENGTH = 12;
const MAX_INDEX_ENTRIES = 1_200_000;
const DEFAULT_MAX_RESULTS = 80;
const MAX_QUERY_RESULTS = 5_000;
const MIN_REBUILD_GAP_MS = 45_000;
const DEFAULT_REFRESH_INTERVAL_MS = 8 * 60_000;
const MAX_SPOTLIGHT_CANDIDATES = 10_000;
const SPOTLIGHT_SEARCH_TIMEOUT_MS = 2_400;

const execFileAsync = promisify(execFile);

// Explicitly skip noisy/unhelpful build and dependency folders.
export const FILE_SEARCH_INDEX_EXCLUDED_DIRECTORY_NAMES = [
  'node_modules',
  'dist',
  'build',
  'out',
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'tmp',
  'temp',
  'logs',
  'log',
  'deriveddata',
  '.terraform',
  '.yarn',
  '.pnpm-store',
  '.npm',
] as const;

// Keep indexing inside user content areas and avoid macOS/system-heavy trees.
export const FILE_SEARCH_INDEX_EXCLUDED_HOME_TOP_LEVEL_DIRECTORIES = [
  '.Trash',
  'Library',
] as const;
export const FILE_SEARCH_INDEX_PROTECTED_HOME_TOP_LEVEL_DIRECTORIES = [
  'Desktop',
  'Documents',
  'Downloads',
  'Movies',
  'Music',
  'Pictures',
] as const;

const EXCLUDED_DIRECTORY_NAME_SET = new Set(
  FILE_SEARCH_INDEX_EXCLUDED_DIRECTORY_NAMES.map((name) => name.toLowerCase())
);
const EXCLUDED_TOP_LEVEL_SET = new Set(
  FILE_SEARCH_INDEX_EXCLUDED_HOME_TOP_LEVEL_DIRECTORIES.map((name) => name.toLowerCase())
);
const PROTECTED_TOP_LEVEL_SET = new Set(
  FILE_SEARCH_INDEX_PROTECTED_HOME_TOP_LEVEL_DIRECTORIES.map((name) => name.toLowerCase())
);
const EXCLUDED_FILE_EXTENSIONS = new Set(['.tmp', '.temp', '.log', '.cache', '.crdownload', '.download']);

let activeIndex: IndexSnapshot | null = null;
let rebuildPromise: Promise<void> | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let configuredHomeDir = '';
let includeRoots: string[] = [];
let refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS;
let includeProtectedHomeRoots = false;
let indexing = false;
let lastIndexError: string | null = null;
let lastBuildStartedAt = 0;

type DirectoryQueueEntry = {
  scanPath: string;
  displayPath: string;
  resolvedPath?: string;
};

function normalizeSearchText(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(SEARCH_TOKEN_SPLIT_REGEX, ' ')
    .trim();
}

function normalizePathSearchText(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\\/g, '/')
    .trim();
}

function isPathLikeQuery(rawQuery: string): boolean {
  const trimmed = String(rawQuery || '').trim();
  return trimmed.includes('/') || trimmed.startsWith('~');
}

function tokenizeSearchText(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function asTildePath(value: string, homeDir: string): string {
  if (!homeDir) return value;
  if (value === homeDir) return '~';
  if (value.startsWith(`${homeDir}${path.sep}`)) {
    return `~${value.slice(homeDir.length)}`;
  }
  return value;
}

function isPathWithinRoot(candidatePath: string, rootDir: string): boolean {
  const relative = path.relative(rootDir, candidatePath);
  return Boolean(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)));
}

function isSubsequenceMatch(needle: string, haystack: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  let needleIndex = 0;
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) needleIndex += 1;
  }
  return needleIndex === needle.length;
}

function shouldSkipDirectory(absolutePath: string, dirName: string, homeDir: string): boolean {
  const trimmedName = String(dirName || '').trim();
  if (!trimmedName) return true;
  if (trimmedName.startsWith('.')) return true;

  const lowerName = trimmedName.toLowerCase();
  if (EXCLUDED_DIRECTORY_NAME_SET.has(lowerName)) return true;

  const relative = path.relative(homeDir, absolutePath);
  if (!relative || relative.startsWith('..')) return true;

  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.length > 0 && EXCLUDED_TOP_LEVEL_SET.has(segments[0].toLowerCase())) return true;
  if (segments.length > 0 && PROTECTED_TOP_LEVEL_SET.has(segments[0].toLowerCase()) && !includeProtectedHomeRoots) {
    return true;
  }
  return false;
}

function shouldSkipFile(fileName: string): boolean {
  const trimmedName = String(fileName || '').trim();
  if (!trimmedName) return true;
  if (trimmedName.startsWith('.')) return true;
  const extension = path.extname(trimmedName).toLowerCase();
  if (EXCLUDED_FILE_EXTENSIONS.has(extension)) return true;
  return false;
}

function addPrefixIndexValue(prefixToEntryIds: Map<string, number[]>, key: string, entryId: number): void {
  if (!key) return;
  const bucket = prefixToEntryIds.get(key);
  if (!bucket) {
    prefixToEntryIds.set(key, [entryId]);
    return;
  }
  bucket.push(entryId);
}

function indexEntry(
  snapshot: IndexSnapshot,
  entry: Omit<IndexedEntry, 'normalizedName' | 'normalizedPath' | 'compactName' | 'tokens'>
): void {
  const normalizedName = normalizeSearchText(entry.name);
  if (!normalizedName) return;
  const normalizedPath = normalizePathSearchText(entry.path);
  if (!normalizedPath) return;

  const tokens = tokenizeSearchText(entry.name);
  const compactName = normalizedName.replace(/\s+/g, '');
  const entryId = snapshot.entries.length;

  const nextEntry: IndexedEntry = {
    ...entry,
    normalizedName,
    normalizedPath,
    compactName,
    tokens,
  };
  snapshot.entries.push(nextEntry);

  const seenIndexKeys = new Set<string>();
  for (const token of tokens) {
    if (!token) continue;
    const maxLen = Math.min(MAX_PREFIX_LENGTH, token.length);
    for (let length = 1; length <= maxLen; length += 1) {
      seenIndexKeys.add(token.slice(0, length));
    }
  }
  seenIndexKeys.add(compactName.slice(0, Math.min(MAX_PREFIX_LENGTH, compactName.length)));

  for (const key of seenIndexKeys) {
    addPrefixIndexValue(snapshot.prefixToEntryIds, key, entryId);
  }
}

async function resolveRealPath(candidatePath: string): Promise<string | null> {
  try {
    return await fs.promises.realpath(candidatePath);
  } catch {
    return null;
  }
}

async function buildIndexSnapshot(homeDir: string): Promise<IndexSnapshot> {
  const snapshot: IndexSnapshot = {
    entries: [],
    prefixToEntryIds: new Map<string, number[]>(),
    builtAt: Date.now(),
  };

  const walkQueue: DirectoryQueueEntry[] = includeRoots.map((root) => ({
    scanPath: root,
    displayPath: root,
  }));
  const visitedRealDirectories = new Set<string>();
  let queueIndex = 0;
  let scannedDirectories = 0;

  while (queueIndex < walkQueue.length) {
    if (snapshot.entries.length >= MAX_INDEX_ENTRIES) {
      break;
    }

    const currentEntry = walkQueue[queueIndex];
    queueIndex += 1;
    if (!currentEntry?.scanPath) break;

    const currentDir = currentEntry.scanPath;
    const currentDisplayPath = currentEntry.displayPath || currentDir;
    const currentRealPath = currentEntry.resolvedPath || (await resolveRealPath(currentDir)) || currentDir;
    if (!isPathWithinRoot(currentRealPath, homeDir)) {
      continue;
    }
    if (visitedRealDirectories.has(currentRealPath)) {
      continue;
    }
    visitedRealDirectories.add(currentRealPath);

    let dirents: fs.Dirent[] = [];
    try {
      dirents = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      const name = dirent.name;
      const absoluteScanPath = path.join(currentDir, name);
      const absoluteDisplayPath = path.join(currentDisplayPath, name);

      if (dirent.isDirectory()) {
        if (shouldSkipDirectory(absoluteDisplayPath, name, homeDir)) continue;
        indexEntry(snapshot, {
          path: absoluteDisplayPath,
          name,
          parentPath: currentDisplayPath,
          isDirectory: true,
        });
        walkQueue.push({ scanPath: absoluteScanPath, displayPath: absoluteDisplayPath });
        continue;
      }

      if (dirent.isSymbolicLink()) {
        const resolvedPath = await resolveRealPath(absoluteScanPath);
        if (!resolvedPath || !isPathWithinRoot(resolvedPath, homeDir)) {
          continue;
        }

        let stats: fs.Stats | null = null;
        try {
          stats = await fs.promises.stat(absoluteScanPath);
        } catch {
          continue;
        }

        if (stats.isDirectory()) {
          if (shouldSkipDirectory(absoluteDisplayPath, name, homeDir)) continue;
          indexEntry(snapshot, {
            path: absoluteDisplayPath,
            name,
            parentPath: currentDisplayPath,
            isDirectory: true,
          });
          walkQueue.push({
            scanPath: absoluteScanPath,
            displayPath: absoluteDisplayPath,
            resolvedPath,
          });
          continue;
        }

        if (stats.isFile()) {
          if (shouldSkipFile(name)) continue;
          indexEntry(snapshot, {
            path: absoluteDisplayPath,
            name,
            parentPath: currentDisplayPath,
            isDirectory: false,
          });
        }
        continue;
      }

      if (!dirent.isFile()) {
        continue;
      }

      if (shouldSkipFile(name)) continue;
      indexEntry(snapshot, {
        path: absoluteDisplayPath,
        name,
        parentPath: currentDisplayPath,
        isDirectory: false,
      });
    }

    scannedDirectories += 1;
    if (scannedDirectories % 120 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  snapshot.builtAt = Date.now();
  return snapshot;
}

function scoreEntryMatch(entry: IndexedEntry, normalizedQuery: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;

  let score = 0;

  for (const term of queryTerms) {
    let termScore = 0;
    if (entry.normalizedName === term) {
      termScore = 140;
    } else if (entry.normalizedName.startsWith(term)) {
      termScore = 118;
    } else if (entry.compactName.startsWith(term)) {
      termScore = 106;
    } else if (entry.tokens.includes(term)) {
      termScore = 102;
    } else if (entry.tokens.some((token) => token.startsWith(term))) {
      termScore = 88;
    } else if (entry.normalizedName.includes(term)) {
      termScore = 70;
    } else if (isSubsequenceMatch(term, entry.compactName)) {
      termScore = 44;
    } else {
      return 0;
    }
    score += termScore;
  }

  if (entry.normalizedName === normalizedQuery) {
    score += 240;
  } else if (entry.normalizedName.startsWith(normalizedQuery)) {
    score += 180;
  } else if (entry.normalizedName.includes(normalizedQuery)) {
    score += 122;
  }

  if (entry.isDirectory) {
    score -= 10;
  } else {
    score += 8;
  }

  score += Math.max(0, 20 - Math.max(0, entry.name.length - normalizedQuery.length));
  return score;
}

function intersectCandidates(lists: number[][]): number[] {
  if (lists.length === 0) return [];
  if (lists.length === 1) return [...lists[0]];

  const [first, ...rest] = [...lists].sort((a, b) => a.length - b.length);
  const candidates = new Set(first);
  for (const list of rest) {
    if (candidates.size === 0) break;
    const allowed = new Set(list);
    for (const entryId of candidates) {
      if (!allowed.has(entryId)) {
        candidates.delete(entryId);
      }
    }
  }
  return [...candidates];
}

function resolveCandidateIds(snapshot: IndexSnapshot, terms: string[]): number[] {
  const indexedLists: number[][] = [];
  for (const term of terms) {
    const key = term.slice(0, Math.min(MAX_PREFIX_LENGTH, term.length));
    const matches = snapshot.prefixToEntryIds.get(key);
    if (!matches || matches.length === 0) return [];
    indexedLists.push(matches);
  }
  return intersectCandidates(indexedLists);
}

function resolveHomeDir(inputHomeDir?: string): string {
  const candidate = String(inputHomeDir || '').trim();
  if (candidate) return path.resolve(candidate);
  return path.resolve(os.homedir());
}

function resolveIncludeRoots(homeDir: string): string[] {
  if (!homeDir) return [];
  if (fs.existsSync(homeDir)) return [homeDir];
  return [];
}

function ensureConfigured(inputHomeDir?: string): void {
  const nextHome = resolveHomeDir(inputHomeDir || configuredHomeDir);
  if (!nextHome) return;
  if (configuredHomeDir && configuredHomeDir === nextHome && includeRoots.length > 0) return;

  configuredHomeDir = nextHome;
  includeRoots = resolveIncludeRoots(configuredHomeDir);
}

export function getFileSearchIndexStatus(): FileSearchIndexStatus {
  return {
    indexing,
    ready: Boolean(activeIndex),
    indexedEntryCount: activeIndex?.entries.length || 0,
    lastIndexedAt: activeIndex?.builtAt || null,
    homeDirectory: configuredHomeDir,
    includeRoots: [...includeRoots],
    excludedDirectoryNames: [...FILE_SEARCH_INDEX_EXCLUDED_DIRECTORY_NAMES],
    excludedTopLevelDirectories: [...FILE_SEARCH_INDEX_EXCLUDED_HOME_TOP_LEVEL_DIRECTORIES],
    protectedTopLevelDirectories: [...FILE_SEARCH_INDEX_PROTECTED_HOME_TOP_LEVEL_DIRECTORIES],
    includeProtectedHomeRoots,
    lastError: lastIndexError,
  };
}

export async function rebuildFileSearchIndex(reason = 'manual'): Promise<void> {
  ensureConfigured();
  if (includeRoots.length === 0) return;
  if (rebuildPromise) return rebuildPromise;

  const now = Date.now();
  if (now - lastBuildStartedAt < MIN_REBUILD_GAP_MS) return;
  lastBuildStartedAt = now;

  rebuildPromise = (async () => {
    indexing = true;
    try {
      const snapshot = await buildIndexSnapshot(configuredHomeDir);
      activeIndex = snapshot;
      lastIndexError = null;
      if (reason) {
        console.log(
          `[FileIndex] Rebuilt (${reason}): ${snapshot.entries.length} entries under ${configuredHomeDir}`
        );
      }
    } catch (error) {
      lastIndexError = error instanceof Error ? error.message : String(error || 'Unknown indexing error');
      console.error('[FileIndex] Rebuild failed:', error);
    } finally {
      indexing = false;
      rebuildPromise = null;
    }
  })();

  return rebuildPromise;
}

export function requestFileSearchIndexRefresh(reason = 'manual'): void {
  if (rebuildPromise) return;
  void rebuildFileSearchIndex(reason);
}

export function startFileSearchIndexing(options?: {
  homeDir?: string;
  refreshIntervalMs?: number;
  includeProtectedHomeRoots?: boolean;
}): void {
  ensureConfigured(options?.homeDir);
  if (typeof options?.refreshIntervalMs === 'number' && Number.isFinite(options.refreshIntervalMs)) {
    refreshIntervalMs = Math.max(30_000, Math.floor(options.refreshIntervalMs));
  }
  if (typeof options?.includeProtectedHomeRoots === 'boolean') {
    includeProtectedHomeRoots = options.includeProtectedHomeRoots;
  }

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  refreshTimer = setInterval(() => {
    requestFileSearchIndexRefresh('interval');
  }, refreshIntervalMs);

  requestFileSearchIndexRefresh('startup');
}

export function stopFileSearchIndexing(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export async function searchIndexedFiles(
  rawQuery: string,
  options?: { limit?: number }
): Promise<IndexedFileSearchResult[]> {
  const trimmedQuery = String(rawQuery || '').trim();
  const pathLikeQuery = isPathLikeQuery(trimmedQuery);
  const normalizedQuery = normalizeSearchText(rawQuery);
  const terms = tokenizeSearchText(rawQuery);
  if (!pathLikeQuery && (!normalizedQuery || terms.length === 0)) return [];

  const limit = Math.max(1, Math.min(MAX_QUERY_RESULTS, Number(options?.limit) || DEFAULT_MAX_RESULTS));

  if (!activeIndex && !rebuildPromise) {
    requestFileSearchIndexRefresh('query-bootstrap');
  }

  const indexedResults: IndexedFileSearchResult[] = [];
  const snapshot = activeIndex;
  if (snapshot) {
    if (pathLikeQuery) {
      const rawNeedle = normalizePathSearchText(trimmedQuery);
      if (rawNeedle) {
        const expandedNeedle = trimmedQuery.startsWith('~') && configuredHomeDir
          ? normalizePathSearchText(`${configuredHomeDir}${trimmedQuery.slice(1)}`)
          : rawNeedle;

        const scored: Array<{ entry: IndexedEntry; score: number }> = [];
        for (const entry of snapshot.entries) {
          const pathIndex = entry.normalizedPath.indexOf(expandedNeedle);
          const tildePath = normalizePathSearchText(asTildePath(entry.path, configuredHomeDir));
          const tildeIndex = tildePath.indexOf(rawNeedle);
          const matchIndex = pathIndex >= 0 ? pathIndex : tildeIndex;
          if (matchIndex < 0) continue;

          let score = 1000 - Math.min(420, matchIndex);
          if (entry.normalizedPath.endsWith(`/${expandedNeedle}`) || entry.normalizedPath.endsWith(expandedNeedle)) {
            score += 180;
          }
          if (entry.isDirectory) {
            score -= 10;
          } else {
            score += 12;
          }
          score -= Math.min(120, Math.floor(entry.path.length / 4));
          scored.push({ entry, score });
        }

        scored.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.entry.path.length !== b.entry.path.length) return a.entry.path.length - b.entry.path.length;
          return a.entry.name.localeCompare(b.entry.name);
        });

        indexedResults.push(
          ...scored.slice(0, limit).map(({ entry }) => ({
            path: entry.path,
            name: entry.name,
            parentPath: entry.parentPath,
            displayPath: asTildePath(entry.parentPath, configuredHomeDir),
            isDirectory: entry.isDirectory,
          }))
        );
      }
    } else {
      const candidateIds = resolveCandidateIds(snapshot, terms);
      if (candidateIds.length > 0) {
        const scored: Array<{ entry: IndexedEntry; score: number }> = [];
        for (const entryId of candidateIds) {
          const entry = snapshot.entries[entryId];
          if (!entry) continue;
          const score = scoreEntryMatch(entry, normalizedQuery, terms);
          if (score <= 0) continue;
          scored.push({ entry, score });
        }

        scored.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.entry.name.localeCompare(b.entry.name);
        });

        indexedResults.push(
          ...scored.slice(0, limit).map(({ entry }) => ({
            path: entry.path,
            name: entry.name,
            parentPath: entry.parentPath,
            displayPath: asTildePath(entry.parentPath, configuredHomeDir),
            isDirectory: entry.isDirectory,
          }))
        );
      }
    }
  }

  if (process.platform !== 'darwin') {
    return indexedResults;
  }
  if (!configuredHomeDir) {
    return indexedResults;
  }
  if (indexedResults.length >= limit) {
    return indexedResults;
  }

  const existingPaths = new Set(indexedResults.map((entry) => entry.path));
  const spotlightSearchTerm = pathLikeQuery
    ? (() => {
        const normalized = trimmedQuery
          .replace(/\\/g, '/')
          .replace(/^~\//, '')
          .replace(/^~$/, '')
          .replace(/\/+$/, '');
        if (!normalized) return '';
        return path.posix.basename(normalized);
      })()
    : trimmedQuery;

  const spotlightTerm = String(spotlightSearchTerm || '').trim();
  if (!spotlightTerm) return indexedResults;

  let spotlightStdout = '';
  try {
    const { stdout } = await execFileAsync('/usr/bin/mdfind', ['-onlyin', configuredHomeDir, '-name', spotlightTerm], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: SPOTLIGHT_SEARCH_TIMEOUT_MS,
    });
    spotlightStdout = String(stdout || '');
  } catch (error: any) {
    spotlightStdout = String(error?.stdout || '');
  }

  if (!spotlightStdout) return indexedResults;

  const rawNeedle = pathLikeQuery ? normalizePathSearchText(trimmedQuery) : '';
  const expandedNeedle = pathLikeQuery && trimmedQuery.startsWith('~') && configuredHomeDir
    ? normalizePathSearchText(`${configuredHomeDir}${trimmedQuery.slice(1)}`)
    : rawNeedle;
  const spotlightScored: Array<{ path: string; score: number }> = [];
  const spotlightCandidateLimit = Math.min(MAX_SPOTLIGHT_CANDIDATES, Math.max(320, limit * 8));

  for (const line of spotlightStdout.split(/\r?\n/)) {
    if (spotlightScored.length >= spotlightCandidateLimit) break;
    const candidateRawPath = String(line || '').trim();
    if (!candidateRawPath) continue;

    const candidatePath = path.resolve(candidateRawPath);
    if (existingPaths.has(candidatePath)) continue;
    if (!isPathWithinRoot(candidatePath, configuredHomeDir)) continue;

    const candidateName = path.basename(candidatePath);
    if (!candidateName) continue;
    if (shouldSkipFile(candidateName)) continue;

    let score = 0;
    if (pathLikeQuery) {
      const normalizedPath = normalizePathSearchText(candidatePath);
      const tildePath = normalizePathSearchText(asTildePath(candidatePath, configuredHomeDir));
      const pathIndex = expandedNeedle ? normalizedPath.indexOf(expandedNeedle) : -1;
      const tildeIndex = rawNeedle ? tildePath.indexOf(rawNeedle) : -1;
      const matchIndex = pathIndex >= 0 ? pathIndex : tildeIndex;
      if (matchIndex < 0) continue;

      score = 960 - Math.min(420, matchIndex);
      if (normalizedPath.endsWith(`/${expandedNeedle}`) || normalizedPath.endsWith(expandedNeedle)) {
        score += 140;
      }
      score -= Math.min(120, Math.floor(candidatePath.length / 4));
    } else {
      const normalizedName = normalizeSearchText(candidateName);
      if (!normalizedName) continue;
      const pseudoEntry: IndexedEntry = {
        path: candidatePath,
        name: candidateName,
        parentPath: path.dirname(candidatePath),
        normalizedName,
        normalizedPath: normalizePathSearchText(candidatePath),
        compactName: normalizedName.replace(/\s+/g, ''),
        tokens: tokenizeSearchText(candidateName),
        isDirectory: false,
      };
      score = scoreEntryMatch(pseudoEntry, normalizedQuery, terms);
      if (score <= 0) continue;
      // Keep index-backed results ahead of Spotlight when ranking is similar.
      score -= 5;
    }

    existingPaths.add(candidatePath);
    spotlightScored.push({ path: candidatePath, score });
  }

  if (spotlightScored.length === 0) return indexedResults;

  spotlightScored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    return a.path.localeCompare(b.path);
  });

  const merged = [...indexedResults];
  for (const candidate of spotlightScored) {
    if (merged.length >= limit) break;
    const parentPath = path.dirname(candidate.path);
    merged.push({
      path: candidate.path,
      name: path.basename(candidate.path),
      parentPath,
      displayPath: asTildePath(parentPath, configuredHomeDir),
      isDirectory: false,
    });
  }

  return merged;
}
