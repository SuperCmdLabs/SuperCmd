import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, FolderOpen, Search } from 'lucide-react';
import ExtensionActionFooter from './components/ExtensionActionFooter';

interface FileSearchExtensionProps {
  onClose: () => void;
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
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif') || lower.endsWith('.svg')) {
    return 'Image';
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return 'File';
  return `${name.slice(dot + 1).toUpperCase()} File`;
}

function asTildePath(filePath: string, homeDir: string): string {
  if (homeDir && filePath.startsWith(homeDir)) {
    return `~${filePath.slice(homeDir.length) || '/'}`;
  }
  return filePath;
}

function escapeSpotlightValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildNameOnlySpotlightQuery(rawQuery: string): string {
  const terms = rawQuery
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return 'kMDItemFSName == "*"cd';
  }

  // Name-only matching. This prevents matches from parent directory names.
  return terms
    .map((term) => `kMDItemFSName == "*${escapeSpotlightValue(term)}*"cd`)
    .join(' && ');
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

const FileSearchExtension: React.FC<FileSearchExtensionProps> = ({ onClose }) => {
  const isMac = window.electron.platform === 'darwin';
  const primaryModifierLabel = isMac ? '⌘' : 'Ctrl';
  const primaryModifierPressed = (e: React.KeyboardEvent<HTMLDivElement>) => (isMac ? e.metaKey : e.ctrlKey);
  const [query, setQuery] = useState('');
  const [scopes, setScopes] = useState<SearchScope[]>([]);
  const [scopeId, setScopeId] = useState('home');
  const [results, setResults] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [iconsByPath, setIconsByPath] = useState<Record<string, string>>({});
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [opening, setOpening] = useState(false);

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

  const selectedScope = useMemo(
    () => scopes.find((scope) => scope.id === scopeId) || scopes[0] || null,
    [scopeId, scopes]
  );

  const visibleResults = useMemo(() => {
    const terms = getNormalizedTerms(query.trim());
    if (terms.length === 0) return results;
    return results.filter((filePath) => matchesFileNameTerms(filePath, terms));
  }, [results, query]);

  const selectedPath = visibleResults[selectedIndex] || null;

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, visibleResults.length);
  }, [visibleResults.length]);

  useEffect(() => {
    setSelectedIndex((prev) => {
      if (visibleResults.length === 0) return 0;
      return Math.min(prev, visibleResults.length - 1);
    });
  }, [visibleResults.length]);

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

    if (!currentScope || !trimmed) {
      setResults([]);
      setSelectedIndex(0);
      setIsLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const spotlightQuery = buildNameOnlySpotlightQuery(trimmed);
        const response = await window.electron.execCommand('mdfind', ['-onlyin', currentScope.path, spotlightQuery]);
        if (searchRequestRef.current !== requestId) return;

        const terms = getNormalizedTerms(trimmed);
        const lines = response.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);

        // Hard guard: keep only entries whose own file/folder name matches all terms.
        const strictNameMatches = lines.filter((filePath) => matchesFileNameTerms(filePath, terms));

        const deduped = Array.from(new Set(strictNameMatches));
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
  }, [query, selectedScope]);

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
      if (window.electron.platform === 'win32') {
        await window.electron.openUrl(selectedPath);
      } else {
        await window.electron.execCommand('open', [selectedPath]);
      }
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
      if (window.electron.platform === 'win32') {
        await window.electron.execCommand('explorer.exe', ['/select,', selectedPath]);
      } else {
        await window.electron.execCommand('open', ['-R', selectedPath]);
      }
    } catch (error) {
      console.error('Failed to reveal file:', error);
    }
  }, [selectedPath]);

  const copySelectedPath = useCallback(async () => {
    if (!selectedPath) return;
    try {
      await window.electron.clipboardWrite({ text: selectedPath });
    } catch (error) {
      console.error('Failed to copy file path:', error);
    }
  }, [selectedPath]);

  const selectedActions = useMemo<ActionItem[]>(() => {
    if (!selectedPath) return [];
    return [
      { title: 'Open', shortcut: '↩', execute: openSelectedFile },
      { title: isMac ? 'Reveal in Finder' : 'Reveal in Explorer', shortcut: `${primaryModifierLabel} ↩`, execute: revealSelectedFile },
      { title: 'Copy Path', shortcut: `${primaryModifierLabel} ⇧ C`, execute: copySelectedPath },
    ];
  }, [selectedPath, openSelectedFile, revealSelectedFile, copySelectedPath, isMac, primaryModifierLabel]);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key.toLowerCase() === 'k' && primaryModifierPressed(e) && !e.repeat) {
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
        if (primaryModifierPressed(e)) {
          await revealSelectedFile();
          return;
        }
        await openSelectedFile();
        return;
      }
      if (e.key.toLowerCase() === 'c' && primaryModifierPressed(e) && e.shiftKey) {
        e.preventDefault();
        await copySelectedPath();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [showActions, selectedActions, selectedActionIndex, visibleResults.length, revealSelectedFile, openSelectedFile, copySelectedPath, onClose]
  );

  useEffect(() => {
    if (!showActions) return;
    setSelectedActionIndex(0);
  }, [showActions]);

  return (
    <div className="w-full h-full flex flex-col relative" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06]">
        <button
          onClick={onClose}
          className="text-white/35 hover:text-white/70 transition-colors flex-shrink-0"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Files"
          className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/35 text-[14px] font-medium tracking-wide min-w-0"
          autoFocus
        />
        <div className="flex items-center gap-1 px-3 py-2 rounded-xl border border-white/[0.12] bg-white/[0.04] text-white/80 min-w-[190px] justify-between">
          <span className="text-[11px] uppercase tracking-wide text-white/45">Scope</span>
          <select
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="bg-transparent border-none outline-none text-[14px] font-medium text-white/85 pr-4 appearance-none"
          >
            {scopes.map((scope) => (
              <option key={scope.id} value={scope.id} className="bg-[#16161a]">
                {scope.label}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-white/45" />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div ref={listRef} className="w-[38%] border-r border-white/[0.08] overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-white/45 text-sm">Searching files…</div>
          ) : !query.trim() ? (
            <div className="h-full flex items-center justify-center text-white/35 text-sm">Type to search files</div>
          ) : visibleResults.length === 0 ? (
            <div className="h-full flex items-center justify-center text-white/35 text-sm">No files found</div>
          ) : (
            <div className="p-2.5">
              <div className="px-2 py-1 text-[13px] uppercase tracking-wide text-white/45 font-semibold">Files</div>
              <div className="space-y-1 mt-2">
                {visibleResults.map((filePath, index) => {
                  const selected = index === selectedIndex;
                  const icon = iconsByPath[filePath];
                  return (
                    <button
                      key={`${filePath}-${index}`}
                      ref={(el) => {
                        itemRefs.current[index] = el;
                      }}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      onDoubleClick={() => openSelectedFile()}
                      className={`w-full text-left px-3 py-2 rounded-2xl border transition-colors ${
                        selected
                          ? 'bg-white/[0.12] border-white/[0.18]'
                          : 'bg-transparent border-transparent hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {icon ? (
                          <img src={icon} alt="" className="w-8 h-8 object-contain flex-shrink-0" draggable={false} />
                        ) : (
                          <div className="w-8 h-8 rounded-md bg-white/[0.08] flex items-center justify-center flex-shrink-0">
                            <Search className="w-4 h-4 text-white/35" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-white/90 text-[16px] leading-tight font-medium truncate">{basename(filePath)}</div>
                          <div className="text-white/35 text-[13px] truncate">{asTildePath(dirname(filePath), selectedScope?.path || '')}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          {selectedPath ? (
            <>
              <div className="flex justify-center mb-6">
                {iconsByPath[selectedPath] ? (
                  <img src={iconsByPath[selectedPath]} alt="" className="w-40 h-40 object-contain" draggable={false} />
                ) : (
                  <div className="w-40 h-40 rounded-3xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                    <FolderOpen className="w-10 h-10 text-white/30" />
                  </div>
                )}
              </div>
              <div className="text-[24px] font-semibold text-white/90 mb-4">Metadata</div>
              {metadata ? (
                <div className="space-y-1.5">
                  {[
                    ['Name', metadata.name],
                    ['Where', metadata.where],
                    ['Type', metadata.type],
                    ['Size', metadata.size],
                    ['Created', metadata.created],
                    ['Modified', metadata.modified],
                  ].map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[120px_1fr] items-center gap-3 pb-2 border-b border-white/[0.08]">
                      <div className="text-white/55 text-[13px] font-semibold">{label}</div>
                      <div className="text-white/92 text-[14px] font-semibold text-right truncate">{value}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-white/35 text-sm">
              Select a file to view details
            </div>
          )}
        </div>
      </div>

      <ExtensionActionFooter
        leftContent={
          <div className="flex items-center gap-2 text-white/55 min-w-0">
            <Search className="w-5 h-5 text-white/45" />
            <span className="truncate">Search Files</span>
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
          shortcut: [primaryModifierLabel, 'K'],
        }}
      />

      {showActions ? (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center" onClick={() => setShowActions(false)}>
          <div
            className="w-[430px] rounded-2xl border border-white/[0.1] bg-[#1a1a1f]/95 backdrop-blur-xl p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedActions.length === 0 ? (
              <div className="px-3 py-2 text-white/45 text-sm">No actions</div>
            ) : (
              selectedActions.map((action, index) => (
                <button
                  key={action.title}
                  type="button"
                  onClick={async () => {
                    await Promise.resolve(action.execute());
                    setShowActions(false);
                  }}
                  className={`w-full px-3 py-2 rounded-lg text-left flex items-center justify-between transition-colors ${
                    index === selectedActionIndex ? 'bg-white/[0.12] text-white' : 'text-white/80 hover:bg-white/[0.07]'
                  }`}
                >
                  <span className="text-sm">{action.title}</span>
                  <span className="text-xs text-white/40">{action.shortcut}</span>
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
