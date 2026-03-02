import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, FolderOpen, Search } from 'lucide-react';
import ExtensionActionFooter from './components/ExtensionActionFooter';
import type { FileSearchIndexStatus } from '../types/electron';

interface FileSearchExtensionProps {
  onClose: () => void;
  initialDetailPath?: string | null;
}

interface SearchScope {
  id: string;
  label: string;
  path: string;
}

interface FileMetadata {
  name: string;
  where: string;
  type: string;
  size: string;
  created: string;
  modified: string;
}

interface ActionItem {
  title: string;
  shortcut: string;
  execute: () => void | Promise<void>;
}

const IMAGE_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.bmp',
  '.tiff',
  '.tif',
  '.heic',
  '.avif',
]);
const FILE_SEARCH_CANDIDATE_LIMIT = 5000;

function basename(filePath: string): string {
  const normalized = filePath.replace(/\/$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\/$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.slice(0, idx) : '/';
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function humanFileType(filePath: string): string {
  const name = basename(filePath);
  const lower = name.toLowerCase();
  if (lower.endsWith('.app')) return 'Application';
  if (lower.endsWith('.dmg')) return 'Disk Image';
  if (lower.endsWith('.pdf')) return 'PDF Document';
  if (isImageFilePath(filePath)) {
    return 'Image';
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return 'File';
  return `${name.slice(dot + 1).toUpperCase()} File`;
}

function isImageFilePath(filePath: string): boolean {
  const lower = basename(filePath).toLowerCase();
  for (const ext of IMAGE_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function toFileUrl(filePath: string): string {
  return `file://${encodeURI(filePath)}`;
}

function asTildePath(filePath: string, homeDir: string): string {
  if (homeDir && filePath.startsWith(homeDir)) {
    return `~${filePath.slice(homeDir.length) || '/'}`;
  }
  return filePath;
}

function getNormalizedTerms(rawQuery: string): string[] {
  return rawQuery
    .normalize('NFKD')
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function normalizeForMatch(value: string): string {
  return value.normalize('NFKD').toLowerCase();
}

function splitNameTokens(fileName: string): string[] {
  return normalizeForMatch(fileName)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesFileNameTerms(filePath: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const name = basename(filePath);
  const normalizedName = normalizeForMatch(name);
  const tokens = splitNameTokens(name);
  return terms.every((term) => {
    // If query includes punctuation (e.g. ".js"), allow direct substring check.
    if (/[^a-z0-9]/i.test(term)) {
      return normalizedName.includes(term);
    }
    // Otherwise require token-prefix matching to avoid mid-word false positives.
    return tokens.some((token) => token.startsWith(term));
  });
}

function normalizePathForMatch(value: string): string {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/\\/g, '/');
}

function isPathLikeQuery(rawQuery: string): boolean {
  const trimmed = String(rawQuery || '').trim();
  return trimmed.includes('/') || trimmed.startsWith('~');
}

function matchesPathQuery(filePath: string, rawQuery: string, homeDir: string): boolean {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) return true;
  const normalizedPath = normalizePathForMatch(filePath);
  const normalizedRawQuery = normalizePathForMatch(trimmed);
  if (!normalizedRawQuery) return true;

  if (normalizedPath.includes(normalizedRawQuery)) {
    return true;
  }

  if (trimmed.startsWith('~') && homeDir) {
    const expanded = `${homeDir}${trimmed.slice(1)}`;
    const normalizedExpanded = normalizePathForMatch(expanded);
    if (normalizedExpanded && normalizedPath.includes(normalizedExpanded)) {
      return true;
    }
  }

  const tildePath = normalizePathForMatch(asTildePath(filePath, homeDir));
  return Boolean(tildePath && tildePath.includes(normalizedRawQuery));
}

const FileSearchExtension: React.FC<FileSearchExtensionProps> = ({ onClose, initialDetailPath }) => {
  const [query, setQuery] = useState('');
  const [scopes, setScopes] = useState<SearchScope[]>([]);
  const [scopeId, setScopeId] = useState('home');
  const [results, setResults] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [seededDetailPath, setSeededDetailPath] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');
  const [iconsByPath, setIconsByPath] = useState<Record<string, string>>({});
  const [failedImagePreviewByPath, setFailedImagePreviewByPath] = useState<Record<string, true>>({});
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [opening, setOpening] = useState(false);
  const [indexStatus, setIndexStatus] = useState<FileSearchIndexStatus | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const searchRequestRef = useRef(0);

  useEffect(() => {
    const homeDir = (window.electron as any).homeDir || '';
    const username = homeDir ? basename(homeDir) || 'User' : 'User';
    setScopes([{ id: 'home', label: `User (${username})`, path: homeDir || '/' }]);
    setScopeId('home');
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const normalized = String(initialDetailPath || '').trim();
    if (!normalized) return;
    setSeededDetailPath(normalized);
    setQuery(basename(normalized));
    setResults((prev) => [normalized, ...prev.filter((value) => value !== normalized)]);
    setSelectedIndex(0);
    setShowDetails(true);
    setIsLoading(false);
  }, [initialDetailPath]);

  useEffect(() => {
    let cancelled = false;
    const syncStatus = async () => {
      try {
        const next = await window.electron.getFileSearchIndexStatus();
        if (!cancelled) setIndexStatus(next);
      } catch {
        if (!cancelled) setIndexStatus(null);
      }
    };

    void syncStatus();
    const intervalId = window.setInterval(() => {
      void syncStatus();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const selectedScope = useMemo(
    () => scopes.find((scope) => scope.id === scopeId) || scopes[0] || null,
    [scopeId, scopes]
  );

  const visibleResults = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return results;
    if (isPathLikeQuery(trimmedQuery)) {
      return results.filter((filePath) => matchesPathQuery(filePath, trimmedQuery, selectedScope?.path || ''));
    }
    const terms = getNormalizedTerms(trimmedQuery);
    if (terms.length === 0) return results;
    return results.filter((filePath) => matchesFileNameTerms(filePath, terms));
  }, [results, query, selectedScope]);

  const selectedPath = visibleResults[selectedIndex] || null;
  const selectedImagePreviewSrc = useMemo(() => {
    if (!selectedPath) return null;
    if (!isImageFilePath(selectedPath)) return null;
    if (failedImagePreviewByPath[selectedPath]) return null;
    return toFileUrl(selectedPath);
  }, [failedImagePreviewByPath, selectedPath]);
  const metadataRows = useMemo<[string, string][]>(() => {
    if (!metadata) return [];
    return [
      ['Name', metadata.name],
      ['Where', metadata.where],
      ['Type', metadata.type],
      ['Size', metadata.size],
      ['Created', metadata.created],
      ['Modified', metadata.modified],
    ];
  }, [metadata]);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, visibleResults.length);
  }, [visibleResults.length]);

  useEffect(() => {
    setSelectedIndex((prev) => {
      if (visibleResults.length === 0) return 0;
      return Math.min(prev, visibleResults.length - 1);
    });
  }, [visibleResults.length]);

  useEffect(() => {
    if (!selectedPath) {
      setShowDetails(false);
    }
  }, [selectedPath]);

  useEffect(() => {
    if (!showDetails) {
      inputRef.current?.focus();
    }
  }, [showDetails]);

  useEffect(() => {
    if (!seededDetailPath || showDetails) return;
    const trimmed = query.trim();
    if (!trimmed || trimmed === basename(seededDetailPath)) return;
    setSeededDetailPath(null);
  }, [query, seededDetailPath, showDetails]);

  const scrollToSelected = useCallback(() => {
    const selectedElement = itemRefs.current[selectedIndex];
    const scrollContainer = listRef.current;
    if (!selectedElement || !scrollContainer) return;

    const containerRect = scrollContainer.getBoundingClientRect();
    const elementRect = selectedElement.getBoundingClientRect();

    if (elementRect.top < containerRect.top) {
      selectedElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else if (elementRect.bottom > containerRect.bottom) {
      selectedElement.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  useEffect(() => {
    scrollToSelected();
  }, [selectedIndex, scrollToSelected]);

  useEffect(() => {
    const currentScope = selectedScope;
    const trimmed = query.trim();
    searchRequestRef.current += 1;
    const requestId = searchRequestRef.current;

    if (!currentScope) {
      setResults([]);
      setSelectedIndex(0);
      setIsLoading(false);
      return;
    }

    if (!trimmed) {
      if (seededDetailPath && showDetails) {
        setResults([seededDetailPath]);
        setSelectedIndex(0);
      } else {
        setResults([]);
        setSelectedIndex(0);
      }
      setIsLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        let indexed = await window.electron.searchIndexedFiles(trimmed, { limit: FILE_SEARCH_CANDIDATE_LIMIT });
        if (searchRequestRef.current !== requestId) return;

        if (indexed.length === 0) {
          const status = await window.electron.getFileSearchIndexStatus().catch(() => null);
          if (searchRequestRef.current !== requestId) return;

          if (status && !status.ready && !status.indexing) {
            await window.electron.refreshFileSearchIndex('file-search-query').catch(() => null);
          }

          if (status && (!status.ready || status.indexing)) {
            await new Promise((resolve) => window.setTimeout(resolve, 220));
            if (searchRequestRef.current !== requestId) return;
            indexed = await window.electron.searchIndexedFiles(trimmed, { limit: FILE_SEARCH_CANDIDATE_LIMIT });
            if (searchRequestRef.current !== requestId) return;
          }
        }

        const pathLikeQuery = isPathLikeQuery(trimmed);
        const terms = pathLikeQuery ? [] : getNormalizedTerms(trimmed);
        const scopePrefix = `${currentScope.path.replace(/\/$/, '')}/`;
        const strictNameMatches = indexed
          .map((entry) => entry.path)
          .filter((filePath) => filePath.startsWith(scopePrefix) || filePath === currentScope.path)
          .filter((filePath) =>
            pathLikeQuery
              ? matchesPathQuery(filePath, trimmed, currentScope.path)
              : matchesFileNameTerms(filePath, terms)
          );

        let deduped = Array.from(new Set(strictNameMatches));
        if (seededDetailPath && (showDetails || trimmed === basename(seededDetailPath))) {
          deduped = [seededDetailPath, ...deduped.filter((value) => value !== seededDetailPath)];
        }
        setResults(deduped);
        setSelectedIndex(0);

        const top = deduped.slice(0, 36);
        const iconEntries = await Promise.all(
          top.map(async (filePath) => {
            try {
              const dataUrl = await window.electron.getFileIconDataUrl(filePath, 20);
              return [filePath, dataUrl || ''] as const;
            } catch {
              return [filePath, ''] as const;
            }
          })
        );

        if (searchRequestRef.current !== requestId) return;
        setIconsByPath((prev) => {
          const next = { ...prev };
          for (const [filePath, icon] of iconEntries) {
            if (icon) next[filePath] = icon;
          }
          return next;
        });
      } catch (error) {
        console.error('File search failed:', error);
        if (searchRequestRef.current === requestId) {
          setResults([]);
          setSelectedIndex(0);
        }
      } finally {
        if (searchRequestRef.current === requestId) {
          setIsLoading(false);
        }
      }
    }, 140);

    return () => window.clearTimeout(timer);
  }, [query, selectedScope, seededDetailPath, showDetails]);

  useEffect(() => {
      const filePath = selectedPath;
    if (!filePath || !selectedScope) {
      setMetadata(null);
      return;
    }

    let cancelled = false;

    const loadMetadata = async () => {
      const scopePath = selectedScope.path;
      const statResult = await window.electron.execCommand(
        'stat',
        ['-f', '%z|%SB|%Sm', '-t', '%b %e, %Y at %I:%M:%S %p', filePath]
      );

      if (cancelled) return;

      const parsed = statResult.stdout.trim().split('|');
      const bytes = parsed.length > 0 ? Number(parsed[0]) : NaN;
      const created = parsed.length > 1 ? parsed[1] : '-';
      const modified = parsed.length > 2 ? parsed[2] : '-';

      setMetadata({
        name: basename(filePath),
        where: asTildePath(dirname(filePath), scopePath),
        type: humanFileType(filePath),
        size: formatSize(bytes),
        created: created || '-',
        modified: modified || '-',
      });
    };

    loadMetadata().catch((error) => {
      console.error('Failed to load file metadata:', error);
      if (!cancelled) {
        setMetadata({
          name: basename(filePath),
          where: dirname(filePath),
          type: humanFileType(filePath),
          size: '-',
          created: '-',
          modified: '-',
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedPath, selectedScope]);

  const openSelectedFile = useCallback(async () => {
    if (!selectedPath || opening) return;
    setOpening(true);
    try {
      await window.electron.execCommand('open', [selectedPath]);
      await window.electron.hideWindow();
    } catch (error) {
      console.error('Failed to open file:', error);
    } finally {
      setOpening(false);
    }
  }, [selectedPath, opening]);

  const revealSelectedFile = useCallback(async () => {
    if (!selectedPath) return;
    try {
      await window.electron.execCommand('open', ['-R', selectedPath]);
    } catch (error) {
      console.error('Failed to reveal file:', error);
    }
  }, [selectedPath]);

  const showSelectedDetails = useCallback(() => {
    if (!selectedPath) return;
    setShowDetails(true);
  }, [selectedPath]);

  const copySelectedFile = useCallback(async () => {
    if (!selectedPath) return;
    try {
      const copied = await window.electron.clipboardWrite({ file: selectedPath });
      if (!copied) {
        await window.electron.clipboardWrite({ text: selectedPath });
      }
    } catch (error) {
      console.error('Failed to copy file:', error);
    }
  }, [selectedPath]);

  const handleSelectedImagePreviewError = useCallback(() => {
    if (!selectedPath) return;
    setFailedImagePreviewByPath((prev) => {
      if (prev[selectedPath]) return prev;
      return { ...prev, [selectedPath]: true };
    });
  }, [selectedPath]);

  const selectedActions = useMemo<ActionItem[]>(() => {
    if (!selectedPath) return [];
    return [
      { title: 'Open', shortcut: '↩', execute: openSelectedFile },
      { title: 'Show Details', shortcut: '⌘ D', execute: showSelectedDetails },
      { title: 'Copy File', shortcut: '⌘ ⇧ C', execute: copySelectedFile },
      { title: 'Reveal in Finder', shortcut: '⌘ ↩', execute: revealSelectedFile },
    ];
  }, [selectedPath, openSelectedFile, showSelectedDetails, copySelectedFile, revealSelectedFile]);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key.toLowerCase() === 'k' && e.metaKey && !e.repeat) {
        e.preventDefault();
        setShowActions((prev) => !prev);
        return;
      }

      if (showActions) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedActionIndex((prev) => Math.min(prev + 1, selectedActions.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedActionIndex((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const action = selectedActions[selectedActionIndex];
          if (action) await Promise.resolve(action.execute());
          setShowActions(false);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowActions(false);
          return;
        }
        return;
      }

      if (showDetails) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.metaKey) {
            await revealSelectedFile();
            return;
          }
          await openSelectedFile();
          return;
        }
        if (e.key.toLowerCase() === 'c' && e.metaKey && e.shiftKey) {
          e.preventDefault();
          await copySelectedFile();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowDetails(false);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < visibleResults.length - 1 ? prev + 1 : prev));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.metaKey) {
          await revealSelectedFile();
          return;
        }
        await openSelectedFile();
        return;
      }
      if (e.key.toLowerCase() === 'd' && e.metaKey) {
        e.preventDefault();
        showSelectedDetails();
        return;
      }
      if (e.key.toLowerCase() === 'c' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        await copySelectedFile();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [
      showActions,
      selectedActions,
      selectedActionIndex,
      showDetails,
      visibleResults.length,
      revealSelectedFile,
      openSelectedFile,
      showSelectedDetails,
      copySelectedFile,
      onClose,
    ]
  );

  useEffect(() => {
    if (!showActions) return;
    setSelectedActionIndex(0);
  }, [showActions]);

  return (
    <div className="w-full h-full flex flex-col relative" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-[var(--ui-divider)]">
        <button
          onClick={() => {
            if (showDetails) {
              setShowDetails(false);
              return;
            }
            onClose();
          }}
          className="text-white/35 hover:text-white/70 transition-colors flex-shrink-0 focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
          aria-label={showDetails ? 'Back to search' : 'Back'}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        {showDetails ? (
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-white/90">File Details</div>
            <div className="text-[11px] text-white/45 truncate">{selectedPath ? basename(selectedPath) : 'No file selected'}</div>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Files"
              className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/35 text-[13px] font-medium tracking-wide min-w-0"
              autoFocus
            />
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] text-[var(--text-secondary)] min-w-[160px] justify-between">
              <span className="text-[10px] uppercase tracking-wide text-white/45">Scope</span>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="bg-transparent border-none outline-none focus:outline-none text-[11px] font-medium text-[var(--text-primary)] pr-4 appearance-none"
              >
                {scopes.map((scope) => (
                  <option key={scope.id} value={scope.id} className="bg-[var(--bg-overlay)]">
                    {scope.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            </div>
          </>
        )}
      </div>

      {showDetails ? (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3.5">
          {selectedPath ? (
            <>
              <div className="flex justify-center mb-3">
                {selectedImagePreviewSrc ? (
                  <div className="w-full max-w-[520px] h-[220px] rounded-xl bg-[var(--launcher-card-bg)] border border-[var(--ui-divider)] overflow-hidden flex items-center justify-center p-2.5">
                    <img
                      src={selectedImagePreviewSrc}
                      alt={basename(selectedPath)}
                      className="max-w-full max-h-full object-contain"
                      draggable={false}
                      onError={handleSelectedImagePreviewError}
                    />
                  </div>
                ) : iconsByPath[selectedPath] ? (
                  <img src={iconsByPath[selectedPath]} alt="" className="w-20 h-20 object-contain" draggable={false} />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-[var(--launcher-card-bg)] border border-[var(--ui-divider)] flex items-center justify-center">
                    <FolderOpen className="w-5 h-5 text-white/30" />
                  </div>
                )}
              </div>
              <div className="text-[15px] font-semibold text-white/90 mb-2">Metadata</div>
              {metadataRows.length > 0 ? (
                <div className="space-y-1">
                  {metadataRows.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[100px_1fr] items-center gap-2 pb-1.5 border-b border-[var(--ui-divider)]">
                      <div className="text-white/55 text-[11px] font-semibold">{label}</div>
                      <div className="text-white/92 text-[12px] font-semibold text-right truncate">{value}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-white/35 text-sm">Select a file to view details</div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <div ref={listRef} className="w-[40%] border-r border-[var(--ui-divider)] overflow-y-auto custom-scrollbar">
            {isLoading ? (
              <div className="h-full flex items-center justify-center text-white/45 text-[13px]">Searching files…</div>
            ) : !query.trim() ? (
              <div className="h-full flex items-center justify-center text-white/35 text-[13px]">
                {indexStatus?.indexing ? 'Indexing home files…' : 'Type to search files'}
              </div>
            ) : visibleResults.length === 0 ? (
              <div className="h-full flex items-center justify-center text-white/35 text-[13px]">
                {indexStatus?.indexing ? 'Indexing in progress. Results will improve shortly.' : 'No files found'}
              </div>
            ) : (
              <div className="p-1.5 space-y-0.5">
                <div className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/45 font-semibold">Files</div>
                <div className="space-y-0.5">
                  {visibleResults.map((filePath, index) => {
                    const selected = index === selectedIndex;
                    const icon = iconsByPath[filePath];
                    return (
                      <div
                        key={`${filePath}-${index}`}
                        ref={(el) => {
                          itemRefs.current[index] = el;
                        }}
                        role="button"
                        tabIndex={-1}
                        onClick={() => setSelectedIndex(index)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onMouseMove={() => setSelectedIndex(index)}
                        onDoubleClick={() => openSelectedFile()}
                        className={`w-full text-left px-2 py-1.5 rounded-md border cursor-pointer select-none transition-colors ${
                          selected
                            ? 'bg-[var(--launcher-card-selected-bg)] border-[var(--launcher-card-border)]'
                            : 'bg-transparent border-transparent hover:bg-[var(--launcher-card-hover-bg)] hover:border-[var(--launcher-card-border)]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {icon ? (
                            <img src={icon} alt="" className="w-[18px] h-[18px] object-contain flex-shrink-0" draggable={false} />
                          ) : (
                            <div className="w-[18px] h-[18px] rounded-md bg-[var(--launcher-card-bg)] flex items-center justify-center flex-shrink-0">
                              <Search className="w-3 h-3 text-white/35" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-white/90 text-[12px] leading-tight font-medium truncate">{basename(filePath)}</div>
                            <div className="text-white/35 text-[10px] leading-tight truncate">{asTildePath(dirname(filePath), selectedScope?.path || '')}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 p-3.5 flex flex-col">
            {selectedPath ? (
              <>
                <div className="flex-1 min-h-0 flex items-center justify-center">
                  {selectedImagePreviewSrc ? (
                    <div className="w-full h-full rounded-xl bg-[var(--launcher-card-bg)] border border-[var(--ui-divider)] overflow-hidden flex items-center justify-center p-2">
                      <img
                        src={selectedImagePreviewSrc}
                        alt={basename(selectedPath)}
                        className="w-full h-full object-contain"
                        draggable={false}
                        onError={handleSelectedImagePreviewError}
                      />
                    </div>
                  ) : iconsByPath[selectedPath] ? (
                    <img src={iconsByPath[selectedPath]} alt="" className="w-14 h-14 object-contain" draggable={false} />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-[var(--launcher-card-bg)] border border-[var(--ui-divider)] flex items-center justify-center">
                      <FolderOpen className="w-[18px] h-[18px] text-white/30" />
                    </div>
                  )}
                </div>
                <div className="shrink-0 pt-2.5 mt-2 border-t border-[var(--ui-divider)]">
                  <div className="text-[14px] font-semibold text-white/90 mb-2">Metadata</div>
                  {metadataRows.length > 0 ? (
                    <div className="space-y-1">
                      {metadataRows.map(([label, value]) => (
                        <div key={label} className="grid grid-cols-[84px_1fr] items-center gap-2 pb-1 border-b border-[var(--ui-divider)]">
                          <div className="text-white/55 text-[10px] font-semibold">{label}</div>
                          <div className="text-white/90 text-[11px] font-semibold text-right truncate">{value}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-white/35 text-sm">Select a file to view details</div>
            )}
          </div>
        </div>
      )}

      <ExtensionActionFooter
        leftContent={
          <div className="flex items-center gap-2 text-white/55 min-w-0">
            <Search className="w-4 h-4 text-white/45" />
            <span className="truncate">{showDetails ? 'File Details' : 'Search Files'}</span>
          </div>
        }
        primaryAction={{
          label: 'Open',
          onClick: () => {
            if (!selectedPath) return;
            void openSelectedFile();
          },
          disabled: !selectedPath || opening,
          shortcut: ['↩'],
        }}
        actionsButton={{
          label: 'Actions',
          onClick: () => setShowActions((prev) => !prev),
          shortcut: ['⌘', 'K'],
        }}
      />

      {showActions ? (
        <div
          className="fixed inset-0 z-50"
          style={{ background: 'var(--bg-scrim)' }}
          onClick={() => setShowActions(false)}
        >
          <div
            className="absolute w-[380px] max-h-[65vh] rounded-xl border p-1.5 overflow-y-auto custom-scrollbar"
            style={
              isGlassyTheme
                ? {
                    right: '12px',
                    bottom: '52px',
                    maxWidth: 'calc(100vw - 24px)',
                    background:
                      'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                    backdropFilter: 'blur(96px) saturate(190%)',
                    WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                    borderColor: 'rgba(var(--on-surface-rgb), 0.05)',
                  }
                : {
                    right: '12px',
                    bottom: '52px',
                    maxWidth: 'calc(100vw - 24px)',
                    background: 'var(--card-bg)',
                    backdropFilter: 'blur(40px)',
                    WebkitBackdropFilter: 'blur(40px)',
                    borderColor: 'var(--border-primary)',
                  }
            }
            onClick={(e) => e.stopPropagation()}
          >
            {selectedActions.length === 0 ? (
              <div className="px-2.5 py-1.5 text-white/45 text-[13px]">No actions</div>
            ) : (
              selectedActions.map((action, index) => (
                <button
                  key={action.title}
                  type="button"
                  onClick={async () => {
                    await Promise.resolve(action.execute());
                    setShowActions(false);
                  }}
                  onMouseEnter={() => setSelectedActionIndex(index)}
                  onMouseMove={() => setSelectedActionIndex(index)}
                  className={`w-full px-2.5 py-1.5 rounded-md border border-transparent text-left flex items-center justify-between transition-colors ${
                    index === selectedActionIndex
                      ? 'bg-white/[0.18] text-white'
                      : 'text-white/80 hover:bg-white/[0.08]'
                  }`}
                  style={
                    index === selectedActionIndex
                      ? {
                          background: 'var(--action-menu-selected-bg)',
                          borderColor: 'var(--action-menu-selected-border)',
                          boxShadow: 'var(--action-menu-selected-shadow)',
                        }
                      : undefined
                  }
                >
                  <span className="text-[13px]">{action.title}</span>
                  <span className="text-[11px] text-white/40">{action.shortcut}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default FileSearchExtension;
