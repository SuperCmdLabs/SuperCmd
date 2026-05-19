import type { CommandInfo } from '../../types/electron';

export const FILE_RESULT_COMMAND_PREFIX = 'system-file-result:';
export const MAX_LAUNCHER_FILE_RESULTS = 30;
export const MAX_LAUNCHER_FILE_CANDIDATE_RESULTS = 3000;
export const MAX_LAUNCHER_FILE_RESULT_ICONS = MAX_LAUNCHER_FILE_RESULTS;
export const MIN_LAUNCHER_FILE_QUERY_LENGTH = 2;

export function asTildePath(filePath: string, homeDir: string): string {
  if (!homeDir) return filePath;
  if (filePath === homeDir) return '~';
  if (filePath.startsWith(homeDir)) {
    return `~${filePath.slice(homeDir.length) || '/'}`;
  }
  return filePath;
}

export function buildFileResultCommandId(filePath: string): string {
  return `${FILE_RESULT_COMMAND_PREFIX}${encodeURIComponent(filePath)}`;
}

export function getFileBasename(filePath: string): string {
  const normalized = String(filePath || '').replace(/\/$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

export function getFileDirname(filePath: string): string {
  const normalized = String(filePath || '').replace(/\/$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.slice(0, idx) : '/';
}

export function normalizeLauncherFileSearchText(value: string): string {
  return String(value || '').normalize('NFKD').toLowerCase();
}

export function getLauncherFileSearchTerms(rawQuery: string): string[] {
  return normalizeLauncherFileSearchText(rawQuery)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function normalizeLauncherPathForMatch(value: string): string {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/\\/g, '/');
}

export function isPathLikeLauncherFileQuery(rawQuery: string): boolean {
  const trimmed = String(rawQuery || '').trim();
  return trimmed.includes('/') || trimmed.startsWith('~');
}

export function matchesLauncherPathQuery(filePath: string, rawQuery: string, homeDir: string): boolean {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) return true;
  const normalizedPath = normalizeLauncherPathForMatch(filePath);
  const normalizedRawQuery = normalizeLauncherPathForMatch(trimmed);
  if (!normalizedRawQuery) return true;

  if (normalizedPath.includes(normalizedRawQuery)) return true;

  if (trimmed.startsWith('~') && homeDir) {
    const expanded = `${homeDir}${trimmed.slice(1)}`;
    const normalizedExpanded = normalizeLauncherPathForMatch(expanded);
    if (normalizedExpanded && normalizedPath.includes(normalizedExpanded)) return true;
  }

  const tildePath = normalizeLauncherPathForMatch(asTildePath(filePath, homeDir));
  return Boolean(tildePath && tildePath.includes(normalizedRawQuery));
}

export function splitLauncherFileNameTokens(fileName: string): string[] {
  return normalizeLauncherFileSearchText(fileName)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function matchesLauncherFileNameTerms(fileName: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const normalizedName = normalizeLauncherFileSearchText(fileName);
  const tokens = splitLauncherFileNameTokens(fileName);
  return terms.every((term) => {
    if (/[^a-z0-9]/i.test(term)) {
      return normalizedName.includes(term);
    }
    return tokens.some((token) => token.startsWith(term));
  });
}

export function getFileResultPathFromCommand(command: CommandInfo | null | undefined): string | null {
  if (!command) return null;
  if (command.id.startsWith(FILE_RESULT_COMMAND_PREFIX)) {
    if (command.path) return String(command.path);
    const encoded = command.id.slice(FILE_RESULT_COMMAND_PREFIX.length);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }
  return null;
}
