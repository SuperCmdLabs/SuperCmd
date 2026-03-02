import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  RefreshCw,
  Package,
  Sparkles,
  Users,
  List,
  Info,
  Image as ImageIcon,
} from 'lucide-react';
import { InternalActionPanelOverlay } from '../raycast-api';
import type { ExtractedAction } from '../raycast-api/action-runtime-types';

interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  author: string;
  contributors: string[];
  iconUrl: string;
  screenshotUrls: string[];
  categories: string[];
  platforms: string[];
  commands: { name: string; title: string; description: string }[];
}

type DetailTab = 'overview' | 'commands' | 'screenshots' | 'team';

const SEARCH_TOKEN_SPLIT_REGEX = /[^a-z0-9]+/g;

function normalizeSearchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(SEARCH_TOKEN_SPLIT_REGEX, ' ')
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function isSubsequenceMatch(needle: string, haystack: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;

  let needleIndex = 0;
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) {
      needleIndex += 1;
    }
  }
  return needleIndex === needle.length;
}

function maxAllowedTypoDistance(termLength: number): number {
  if (termLength <= 3) return 0;
  if (termLength <= 5) return 1;
  if (termLength <= 8) return 2;
  return 3;
}

function damerauLevenshteinDistance(a: string, b: string, maxDistance: number): number {
  const aLen = a.length;
  const bLen = b.length;

  if (!aLen) return bLen;
  if (!bLen) return aLen;
  if (Math.abs(aLen - bLen) > maxDistance) {
    return maxDistance + 1;
  }

  const dp: number[][] = Array.from({ length: aLen + 1 }, () => Array<number>(bLen + 1).fill(0));
  for (let i = 0; i <= aLen; i += 1) dp[i][0] = i;
  for (let j = 0; j <= bLen; j += 1) dp[0][j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, dp[i - 2][j - 2] + 1);
      }

      dp[i][j] = distance;
    }
  }

  return dp[aLen][bLen];
}

function scoreTokenMatch(term: string, candidate: string): number {
  if (!term || !candidate) return 0;
  if (candidate === term) return 120;
  if (candidate.startsWith(term)) return 106;
  if (candidate.includes(term)) return 94;

  if (term.length >= 3 && isSubsequenceMatch(term, candidate)) {
    return 78;
  }

  const maxDistance = maxAllowedTypoDistance(term.length);
  if (maxDistance > 0 && Math.abs(candidate.length - term.length) <= maxDistance) {
    const distance = damerauLevenshteinDistance(term, candidate, maxDistance);
    if (distance <= maxDistance) {
      const similarity = 1 - distance / Math.max(term.length, candidate.length);
      if (similarity >= 0.65) {
        return Math.round(50 + similarity * 30 - distance * 8);
      }
    }
  }

  return 0;
}

type SearchCandidate = {
  token: string;
  weight: number;
};

function bestTermScore(term: string, candidates: SearchCandidate[]): number {
  let best = 0;
  for (const candidate of candidates) {
    const baseScore = scoreTokenMatch(term, candidate.token);
    if (baseScore <= 0) continue;
    const weighted = Math.round(baseScore * candidate.weight);
    if (weighted > best) {
      best = weighted;
    }
  }
  return best;
}

function scoreCatalogEntry(entry: CatalogEntry, query: string): number {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const queryTerms = tokenizeSearchText(normalizedQuery);
  const title = normalizeSearchText(entry.title);
  const name = normalizeSearchText(entry.name);
  const description = normalizeSearchText(entry.description);
  const author = normalizeSearchText(entry.author);
  const categoryTokens = entry.categories.flatMap((category) => tokenizeSearchText(category));
  const contributorTokens = entry.contributors.flatMap((contributor) => tokenizeSearchText(contributor));
  const commandTitleTokens = entry.commands.flatMap((command) => tokenizeSearchText(command.title || command.name));
  const commandDescriptionTokens = entry.commands.flatMap((command) => tokenizeSearchText(command.description || ''));

  const candidates: SearchCandidate[] = [
    ...tokenizeSearchText(entry.title).map((token) => ({ token, weight: 1 })),
    ...tokenizeSearchText(entry.name).map((token) => ({ token, weight: 0.98 })),
    ...categoryTokens.map((token) => ({ token, weight: 0.9 })),
    ...tokenizeSearchText(entry.author).map((token) => ({ token, weight: 0.88 })),
    ...contributorTokens.map((token) => ({ token, weight: 0.84 })),
    ...commandTitleTokens.map((token) => ({ token, weight: 0.82 })),
    ...commandDescriptionTokens.map((token) => ({ token, weight: 0.74 })),
    ...tokenizeSearchText(entry.description).map((token) => ({ token, weight: 0.72 })),
  ];

  if (candidates.length === 0) {
    return 0;
  }

  let score = 0;

  if (title === normalizedQuery) {
    score += 440;
  } else if (name === normalizedQuery) {
    score += 420;
  } else if (title.startsWith(normalizedQuery)) {
    score += 320;
  } else if (name.startsWith(normalizedQuery)) {
    score += 305;
  } else if (title.includes(normalizedQuery)) {
    score += 255;
  } else if (name.includes(normalizedQuery)) {
    score += 240;
  } else if (categoryTokens.includes(normalizedQuery)) {
    score += 190;
  } else if (author.includes(normalizedQuery)) {
    score += 165;
  } else if (description.includes(normalizedQuery)) {
    score += 145;
  }

  let termScoreSum = 0;
  for (const term of queryTerms) {
    const termScore = bestTermScore(term, candidates);
    if (termScore <= 0) {
      return 0;
    }
    termScoreSum += termScore;
  }

  score += termScoreSum;

  if (normalizedQuery.length >= 3) {
    const compactQuery = normalizedQuery.replace(/\s+/g, '');
    const compactTitle = title.replace(/\s+/g, '');
    const compactName = name.replace(/\s+/g, '');
    if ((compactTitle && isSubsequenceMatch(compactQuery, compactTitle)) || (compactName && isSubsequenceMatch(compactQuery, compactName))) {
      score += 18;
    }
  }

  score += Math.max(0, 12 - Math.max(0, title.length - normalizedQuery.length));

  return score;
}

const avatarUrlFor = (name: string) =>
  `https://github.com/${encodeURIComponent(name)}.png?size=64`;

const initialFor = (name: string) => (name.trim()[0] || '?').toUpperCase();

const StoreTab: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [installedNames, setInstalledNames] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [screenshotsByName, setScreenshotsByName] = useState<Record<string, string[]>>({});
  const [loadingScreenshotsFor, setLoadingScreenshotsFor] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const loadCatalog = useCallback(async (force = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const [entries, installed] = await Promise.all([
        window.electron.getCatalog(force),
        window.electron.getInstalledExtensionNames(),
      ]);
      setCatalog(entries);
      setInstalledNames(new Set(installed));
    } catch (e: any) {
      setError(e?.message || 'Failed to load extension catalog.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    const dispose = window.electron.onExtensionsChanged(() => {
      window.electron
        .getInstalledExtensionNames()
        .then((installed) => setInstalledNames(new Set(installed)))
        .catch(() => {});
    });
    return () => {
      dispose?.();
    };
  }, []);

  const filteredCatalog = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) {
      return catalog.map((entry) => ({ entry, score: 0 }));
    }

    return catalog
      .map((entry) => ({ entry, score: scoreCatalogEntry(entry, query) }))
      .filter((entry) => entry.score > 0);
  }, [catalog, searchQuery]);

  const sortedCatalog = useMemo(() => {
    return [...filteredCatalog].sort((a, b) => {
      const aInstalled = installedNames.has(a.entry.name) ? 1 : 0;
      const bInstalled = installedNames.has(b.entry.name) ? 1 : 0;
      if (aInstalled !== bInstalled) return bInstalled - aInstalled;
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.title.localeCompare(b.entry.title);
    }).map(({ entry }) => entry);
  }, [filteredCatalog, installedNames]);

  useEffect(() => {
    if (sortedCatalog.length === 0) {
      setSelectedName(null);
      return;
    }
    const selectedExists = selectedName
      ? sortedCatalog.some((e) => e.name === selectedName)
      : false;
    if (!selectedExists) {
      setSelectedName(sortedCatalog[0].name);
    }
  }, [sortedCatalog, selectedName]);

  const selectedExtension = useMemo(
    () => sortedCatalog.find((entry) => entry.name === selectedName) || null,
    [sortedCatalog, selectedName]
  );
  const selectedInstalled = selectedExtension ? installedNames.has(selectedExtension.name) : false;
  const isSelectedBusy = selectedExtension ? busyName === selectedExtension.name : false;
  const busyExtension = useMemo(
    () => (busyName ? catalog.find((entry) => entry.name === busyName) || null : null),
    [busyName, catalog]
  );

  useEffect(() => {
    if (!selectedExtension?.name) return;
    if (screenshotsByName[selectedExtension.name]) return;
    let cancelled = false;
    setLoadingScreenshotsFor(selectedExtension.name);
    window.electron
      .getExtensionScreenshots(selectedExtension.name)
      .then((urls) => {
        if (cancelled) return;
        setScreenshotsByName((prev) => ({
          ...prev,
          [selectedExtension.name]: urls,
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setScreenshotsByName((prev) => ({
          ...prev,
          [selectedExtension.name]: selectedExtension.screenshotUrls || [],
        }));
      })
      .finally(() => {
        if (!cancelled) setLoadingScreenshotsFor((curr) => (curr === selectedExtension.name ? null : curr));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedExtension, screenshotsByName]);

  const handleInstall = async (name: string) => {
    setBusyName(name);
    try {
      setError(null);
      const success = await window.electron.installExtension(name);
      if (success) {
        setInstalledNames((prev) => new Set([...prev, name]));
      } else {
        setError(`Failed to install "${name}".`);
      }
    } catch (e: any) {
      setError(e?.message || `Failed to install "${name}".`);
    } finally {
      setBusyName(null);
    }
  };

  const handleUninstall = async (name: string) => {
    setBusyName(name);
    try {
      setError(null);
      const success = await window.electron.uninstallExtension(name);
      if (success) {
        setInstalledNames((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      } else {
        setError(`Failed to uninstall "${name}".`);
      }
    } catch (e: any) {
      setError(e?.message || `Failed to uninstall "${name}".`);
    } finally {
      setBusyName(null);
    }
  };

  const openRepoPage = async (extName: string, readme = false) => {
    const url = readme
      ? `https://github.com/raycast/extensions/blob/main/extensions/${extName}/README.md`
      : `https://github.com/raycast/extensions/tree/main/extensions/${extName}`;
    await window.electron.openUrl(url);
  };

  const handlePrimaryAction = useCallback(async () => {
    if (!selectedExtension || isSelectedBusy) return;
    await handleInstall(selectedExtension.name);
  }, [handleInstall, isSelectedBusy, selectedExtension]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (sortedCatalog.length === 0) return;
      const currentIndex = selectedName
        ? sortedCatalog.findIndex((entry) => entry.name === selectedName)
        : 0;
      const safeCurrent = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = Math.max(0, Math.min(safeCurrent + delta, sortedCatalog.length - 1));
      const next = sortedCatalog[nextIndex];
      if (next && next.name !== selectedName) {
        setSelectedName(next.name);
      }
    },
    [selectedName, sortedCatalog]
  );

  const storeActions = useMemo<ExtractedAction[]>(() => {
    const actions: ExtractedAction[] = [
      {
        title: selectedInstalled ? 'Update Extension' : 'Install Extension',
        shortcut: { modifiers: ['cmd'], key: 'enter' },
        execute: () => void handlePrimaryAction(),
      },
      {
        title: 'Refresh Catalog',
        shortcut: { modifiers: ['cmd'], key: 'r' },
        execute: () => void loadCatalog(true),
      },
    ];

    if (!selectedExtension) return actions;

    actions.push({
      title: 'Open README',
      shortcut: { modifiers: ['cmd'], key: 'o' },
      execute: () => void openRepoPage(selectedExtension.name, true),
    });
    actions.push({
      title: 'View Source',
      shortcut: { modifiers: ['cmd', 'shift'], key: 'o' },
      execute: () => void openRepoPage(selectedExtension.name, false),
    });
    if (selectedInstalled) {
      actions.push({
        title: 'Uninstall Extension',
        shortcut: { modifiers: ['cmd'], key: 'backspace' },
        style: 'destructive',
        execute: () => void handleUninstall(selectedExtension.name),
      });
    }

    return actions;
  }, [
    handlePrimaryAction,
    handleUninstall,
    loadCatalog,
    openRepoPage,
    selectedExtension,
    selectedInstalled,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMetaK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const isMetaEnter = (event.metaKey || event.ctrlKey) && (event.key === 'Enter' || event.code === 'NumpadEnter');

      if (isMetaK) {
        event.preventDefault();
        setShowActions((prev) => !prev);
        return;
      }

      if (isMetaEnter) {
        if (showActions) return;
        event.preventDefault();
        void handlePrimaryAction();
        return;
      }

      if (showActions) {
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveSelection(1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveSelection(-1);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePrimaryAction, moveSelection, showActions]);

  useEffect(() => {
    if (!selectedName) return;
    const row = listRef.current?.querySelector<HTMLButtonElement>(`button[data-ext-name="${selectedName}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedName]);

  return (
    <div className={embedded ? '' : 'h-full flex flex-col'}>
      <div className="w-full h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ui-divider)]">
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{embedded ? 'Community' : 'Store'}</h2>
          <span className="text-[12px] text-[var(--text-subtle)]">Installed extensions appear first.</span>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--ui-divider)] flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-subtle)]" />
              <input
                type="text"
                placeholder="Search extensions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-lg pl-10 pr-4 py-2 text-sm text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--ui-segment-border)] transition-colors"
              />
            </div>
            <button
              onClick={() => loadCatalog(true)}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--ui-panel-border)] bg-[var(--ui-segment-bg)] hover:bg-[var(--ui-segment-hover-bg)] rounded-lg transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {isLoading && catalog.length === 0 && (
            <div className="text-center py-20">
              <RefreshCw className="w-6 h-6 text-[var(--text-subtle)] animate-spin mx-auto mb-3" />
              <p className="text-sm text-[var(--text-subtle)]">Loading extension catalog...</p>
            </div>
          )}

          {error && (
            <div className="mx-4 mt-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={() => loadCatalog(true)}
                className="text-xs text-red-400/70 hover:text-red-400 underline mt-2"
              >
                Try again
              </button>
            </div>
          )}

          {!isLoading && sortedCatalog.length === 0 && !error && (
            <div className="flex-1 min-h-0 flex items-center justify-center px-6 py-8">
              <div className="w-full max-w-[520px] rounded-2xl border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)]/70 px-6 py-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--ui-segment-border)] bg-[var(--ui-segment-hover-bg)] text-[var(--text-subtle)]">
                  {searchQuery.trim() ? <Sparkles className="w-6 h-6" /> : <Package className="w-6 h-6" />}
                </div>
                <p className="text-base font-semibold text-[var(--text-primary)]">
                  {searchQuery.trim() ? 'No extensions match your search' : 'No extensions available'}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-subtle)]">
                  {searchQuery.trim()
                    ? 'Try a shorter query, another keyword, or a fuzzy match like part of the extension name.'
                    : 'Refresh the catalog or try again in a moment.'}
                </p>
                <div className="mt-5 flex items-center justify-center gap-2">
                  {searchQuery.trim() ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-hover-bg)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--ui-segment-border)] hover:bg-[var(--ui-segment-active-bg)] transition-colors"
                    >
                      Clear Search
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => loadCatalog(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-hover-bg)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--ui-segment-border)] hover:bg-[var(--ui-segment-active-bg)] transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh Catalog
                  </button>
                </div>
              </div>
            </div>
          )}

          {sortedCatalog.length > 0 && (
            <div className="grid grid-cols-12 flex-1 min-h-0">
              <div className="col-span-5 border-r border-[var(--ui-divider)] min-h-0">
                <div ref={listRef} className="space-y-1 h-full overflow-y-auto custom-scrollbar px-2 py-2">
                  {sortedCatalog.map((ext) => {
                    const selected = selectedName === ext.name;
                    const installed = installedNames.has(ext.name);
                    return (
                      <button
                        key={ext.name}
                        data-ext-name={ext.name}
                        type="button"
                        onClick={() => {
                          setSelectedName(ext.name);
                          setDetailTab('overview');
                        }}
                        className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                          selected ? 'bg-[var(--ui-segment-active-bg)]' : 'hover:bg-[var(--ui-segment-bg)]'
                        }`}
                      >
                        <div className="w-9 h-9 rounded-lg bg-[var(--ui-segment-bg)] flex items-center justify-center overflow-hidden flex-shrink-0">
                          <img
                            src={ext.iconUrl}
                            alt=""
                            className="w-9 h-9 object-contain"
                            draggable={false}
                            onError={(e) => {
                              const target = e.currentTarget;
                              target.style.display = 'none';
                            }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--text-secondary)] truncate">
                              {ext.title}
                            </span>
                            {installed && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-[color:var(--status-success)] bg-[color:var(--status-success-soft)] text-[color:var(--status-success)]">
                                Installed
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--text-subtle)] truncate">{ext.description || ext.name}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="col-span-7 flex flex-col min-h-0 p-4">
                {selectedExtension ? (
                  <CommunityDetails
                    ext={selectedExtension}
                    screenshots={
                      screenshotsByName[selectedExtension.name] ?? selectedExtension.screenshotUrls ?? []
                    }
                    screenshotsLoading={loadingScreenshotsFor === selectedExtension.name}
                    detailTab={detailTab}
                    onTabChange={setDetailTab}
                    installed={installedNames.has(selectedExtension.name)}
                    busy={busyName === selectedExtension.name}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-subtle)]">
                    Select an extension to view details
                  </div>
                )}
              </div>
            </div>
          )}

          {!isLoading && (
            <div
              className="flex items-center px-4 py-3.5 border-t border-[var(--ui-panel-border)]"
              style={{
                background:
                  'var(--menu-overlay-bg)',
                backdropFilter: 'blur(48px) saturate(170%)',
                WebkitBackdropFilter: 'blur(48px) saturate(170%)',
              }}
            >
              <div className="flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-medium truncate">
                {busyExtension ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-[var(--text-muted)]" />
                    <span className="truncate text-[var(--text-muted)]">Installing {busyExtension.title}...</span>
                  </>
                ) : selectedExtension ? (
                  <>
                    <img
                      src={selectedExtension.iconUrl}
                      alt=""
                      className="w-4 h-4 object-contain rounded-sm flex-shrink-0"
                      draggable={false}
                    />
                    <span className="truncate">{selectedExtension.title}</span>
                  </>
                ) : (
                  <span>{sortedCatalog.length} extensions</span>
                )}
              </div>

              {selectedExtension && (
                <div className="flex items-center gap-2 mr-3">
                  <button
                    onClick={() => void handlePrimaryAction()}
                    disabled={isSelectedBusy}
                    className="text-[var(--text-primary)] text-xs font-semibold hover:text-[var(--text-secondary)] disabled:text-[var(--text-subtle)] transition-colors"
                  >
                    {selectedInstalled ? 'Update Extension' : 'Install Extension'}
                  </button>
                  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--ui-segment-hover-bg)] text-[11px] text-[var(--text-subtle)] font-medium">
                    ⌘
                  </kbd>
                  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--ui-segment-hover-bg)] text-[11px] text-[var(--text-subtle)] font-medium">
                    ↩
                  </kbd>
                </div>
              )}

              <button
                onClick={() => setShowActions(true)}
                className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-muted)] transition-colors"
              >
                <span className="text-xs font-medium">Actions</span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--ui-segment-hover-bg)] text-[11px] text-[var(--text-subtle)] font-medium">⌘</kbd>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--ui-segment-hover-bg)] text-[11px] text-[var(--text-subtle)] font-medium">K</kbd>
              </button>
            </div>
          )}
        </div>
      </div>

      {showActions && storeActions.length > 0 && (
        <InternalActionPanelOverlay
          actions={storeActions}
          onClose={() => setShowActions(false)}
          onExecute={(action) => {
            setShowActions(false);
            action.execute();
          }}
        />
      )}
    </div>
  );
};

const DetailTabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
      active
        ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)]'
        : 'bg-[var(--ui-segment-bg)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
    }`}
  >
    {icon}
    {label}
  </button>
);

const ContributorAvatar: React.FC<{ name: string }> = ({ name }) => {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="w-5 h-5 rounded-full bg-[var(--ui-segment-active-bg)] overflow-hidden flex items-center justify-center text-[10px] text-[var(--text-secondary)]">
        {!imgFailed ? (
          <img
            src={avatarUrlFor(name)}
            alt={name}
            className="w-5 h-5 object-cover"
            onError={() => setImgFailed(true)}
            draggable={false}
          />
        ) : (
          <span>{initialFor(name)}</span>
        )}
      </div>
      <span className="text-sm text-[var(--text-secondary)] truncate">{name}</span>
    </div>
  );
};

const CommunityDetails: React.FC<{
  ext: CatalogEntry;
  screenshots: string[];
  screenshotsLoading: boolean;
  detailTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  installed: boolean;
  busy: boolean;
}> = ({ ext, screenshots, screenshotsLoading, detailTab, onTabChange, installed, busy }) => {
  const team = ext.contributors?.length ? ext.contributors : ext.author ? [ext.author] : [];
  const visibleCommands = ext.commands.slice(0, 7);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start gap-3 pb-3 border-b border-[var(--ui-divider)]">
        <div className="w-12 h-12 rounded-xl bg-[var(--ui-segment-bg)] overflow-hidden flex items-center justify-center">
          <img src={ext.iconUrl} alt="" className="w-12 h-12 object-contain" draggable={false} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold text-[var(--text-primary)] truncate">{ext.title}</div>
          <div className="text-sm text-[var(--text-muted)]">by {ext.author || 'Unknown'}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <DetailTabButton
          active={detailTab === 'overview'}
          onClick={() => onTabChange('overview')}
          icon={<Info className="w-3 h-3" />}
          label="Overview"
        />
        <DetailTabButton
          active={detailTab === 'commands'}
          onClick={() => onTabChange('commands')}
          icon={<List className="w-3 h-3" />}
          label="Commands"
        />
        <DetailTabButton
          active={detailTab === 'screenshots'}
          onClick={() => onTabChange('screenshots')}
          icon={<ImageIcon className="w-3 h-3" />}
          label="Screenshots"
        />
        <DetailTabButton
          active={detailTab === 'team'}
          onClick={() => onTabChange('team')}
          icon={<Users className="w-3 h-3" />}
          label="Team"
        />
      </div>

      <div className="mt-3 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
        {detailTab === 'overview' && (
          <div className="space-y-4">
            <div>
              <div className="text-[var(--text-subtle)] uppercase tracking-wider text-xs mb-1">Description</div>
              <div className="text-[var(--text-secondary)] text-sm leading-relaxed">{ext.description || 'No description provided.'}</div>
            </div>
            <div>
              <div className="text-[var(--text-subtle)] uppercase tracking-wider text-xs mb-1">Screenshots</div>
              {screenshotsLoading ? (
                <div className="text-sm text-[var(--text-subtle)]">Loading screenshots...</div>
              ) : screenshots && screenshots.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {screenshots.slice(0, 4).map((url, idx) => (
                    <button
                      key={`${url}-${idx}`}
                      onClick={() => window.electron.openUrl(url)}
                      className="rounded-md overflow-hidden border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] hover:border-[var(--ui-segment-border)] transition-colors"
                    >
                      <img src={url} alt="" className="w-full h-24 object-cover" draggable={false} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-[var(--text-subtle)]">No screenshots declared.</div>
              )}
            </div>
            <div>
              <div className="text-[var(--text-subtle)] uppercase tracking-wider text-xs mb-1">Top Commands</div>
              <div className="space-y-1.5">
                {ext.commands.slice(0, 4).map((cmd) => (
                  <div key={cmd.name || cmd.title} className="flex items-start gap-2">
                    <img
                      src={ext.iconUrl}
                      alt=""
                      className="w-4 h-4 object-contain mt-0.5 rounded-sm"
                      draggable={false}
                    />
                    <div>
                      <div className="text-sm text-[var(--text-secondary)]">{cmd.title || cmd.name}</div>
                      <div className="text-xs text-[var(--text-subtle)] line-clamp-1">
                        {cmd.description || 'No description'}
                      </div>
                    </div>
                  </div>
                ))}
                {ext.commands.length === 0 && (
                  <div className="text-sm text-[var(--text-subtle)]">No commands declared.</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-[var(--text-subtle)] uppercase tracking-wider text-xs mb-1">Categories</div>
              <div className="flex flex-wrap gap-1.5">
                {ext.categories.length > 0 ? (
                  ext.categories.map((cat) => (
                    <span
                      key={cat}
                      className="text-[11px] px-2 py-0.5 rounded bg-[var(--ui-segment-hover-bg)] text-[var(--text-secondary)]"
                    >
                      {cat}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-[var(--text-subtle)]">None</span>
                )}
              </div>
            </div>
          </div>
        )}

        {detailTab === 'commands' && (
          <div className="space-y-2">
            {visibleCommands.length > 0 ? (
              visibleCommands.map((cmd) => (
                <div key={cmd.name || cmd.title} className="pb-2 border-b border-[var(--ui-divider)] last:border-b-0">
                  <div className="flex items-start gap-2">
                    <img src={ext.iconUrl} alt="" className="w-4 h-4 object-contain mt-0.5 rounded-sm" draggable={false} />
                    <div>
                      <div className="text-sm font-medium text-[var(--text-secondary)]">{cmd.title || cmd.name}</div>
                      <div className="text-xs text-[var(--text-subtle)]">{cmd.description || 'No description'}</div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-[var(--text-subtle)]">No commands declared.</div>
            )}
            {ext.commands.length > visibleCommands.length && (
              <div className="text-xs text-[var(--text-subtle)]">
                +{ext.commands.length - visibleCommands.length} more commands
              </div>
            )}
          </div>
        )}

        {detailTab === 'team' && (
          <div className="space-y-2">
            {team.length > 0 ? (
              team.slice(0, 8).map((name) => <ContributorAvatar key={name} name={name} />)
            ) : (
              <div className="text-sm text-[var(--text-subtle)]">No contributors declared.</div>
            )}
          </div>
        )}

        {detailTab === 'screenshots' && (
          <div className="space-y-3">
            {screenshotsLoading ? (
              <div className="text-sm text-[var(--text-subtle)]">Loading screenshots...</div>
            ) : screenshots && screenshots.length > 0 ? (
              screenshots.map((url, idx) => (
                <button
                  key={`${url}-${idx}`}
                  onClick={() => window.electron.openUrl(url)}
                  className="w-full rounded-lg overflow-hidden border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] hover:border-[var(--ui-segment-border)] transition-colors"
                >
                  <img src={url} alt="" className="w-full max-h-56 object-cover" draggable={false} />
                </button>
              ))
            ) : (
              <div className="text-sm text-[var(--text-subtle)]">No screenshots available for this extension.</div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};

export default StoreTab;
