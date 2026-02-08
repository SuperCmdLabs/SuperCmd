import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  Download,
  Trash2,
  RefreshCw,
  Package,
  ExternalLink,
  Users,
  List,
  Info,
  Image as ImageIcon,
} from 'lucide-react';

interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  author: string;
  contributors: string[];
  iconUrl: string;
  screenshotUrls: string[];
  categories: string[];
  commands: { name: string; title: string; description: string }[];
}

type DetailTab = 'overview' | 'commands' | 'screenshots' | 'team';

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

  const filteredCatalog = useMemo(() => {
    if (!searchQuery.trim()) return catalog;
    const q = searchQuery.toLowerCase();
    return catalog.filter((ext) => {
      return (
        ext.title.toLowerCase().includes(q) ||
        ext.description.toLowerCase().includes(q) ||
        ext.author.toLowerCase().includes(q) ||
        ext.name.toLowerCase().includes(q) ||
        ext.categories.some((c) => c.toLowerCase().includes(q))
      );
    });
  }, [catalog, searchQuery]);

  const sortedCatalog = useMemo(() => {
    return [...filteredCatalog].sort((a, b) => {
      const aInstalled = installedNames.has(a.name) ? 1 : 0;
      const bInstalled = installedNames.has(b.name) ? 1 : 0;
      if (aInstalled !== bInstalled) return bInstalled - aInstalled;
      return a.title.localeCompare(b.title);
    });
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
      const success = await window.electron.installExtension(name);
      if (success) {
        setInstalledNames((prev) => new Set([...prev, name]));
      }
    } finally {
      setBusyName(null);
    }
  };

  const handleUninstall = async (name: string) => {
    setBusyName(name);
    try {
      const success = await window.electron.uninstallExtension(name);
      if (success) {
        setInstalledNames((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
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

  return (
    <div className={embedded ? '' : 'h-full flex flex-col'}>
      <div className="flex items-center justify-between mb-2">
        <h2 className={`${embedded ? 'text-base' : 'text-xl'} font-semibold text-white`}>
          {embedded ? 'Community' : 'Store'}
        </h2>
        <button
          onClick={() => loadCatalog(true)}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/50 hover:text-white/80 bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <p className="text-xs text-white/35 mb-4">
        Installed extensions appear first.
      </p>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          placeholder="Search extensions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20 transition-colors"
        />
      </div>

      {isLoading && catalog.length === 0 && (
        <div className="text-center py-20">
          <RefreshCw className="w-6 h-6 text-white/20 animate-spin mx-auto mb-3" />
          <p className="text-sm text-white/40">Loading extension catalog...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 mb-6">
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
        <div className="text-center py-20 text-white/30">
          <Package className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {searchQuery.trim() ? 'No extensions match your search' : 'No extensions available'}
          </p>
        </div>
      )}

      {sortedCatalog.length > 0 && (
        <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
          <div className="col-span-5 border border-white/[0.06] rounded-xl bg-white/[0.02] p-2 min-h-0">
            <div className="space-y-1 h-full overflow-y-auto custom-scrollbar pr-1">
              {sortedCatalog.map((ext) => {
                const selected = selectedName === ext.name;
                const installed = installedNames.has(ext.name);
                return (
                  <button
                    key={ext.name}
                    type="button"
                    onClick={() => {
                      setSelectedName(ext.name);
                      setDetailTab('overview');
                    }}
                    className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      selected ? 'bg-white/[0.10]' : 'hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center overflow-hidden flex-shrink-0">
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
                        <span className="text-sm font-medium text-white/90 truncate">
                          {ext.title}
                        </span>
                        {installed && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-green-500/15 text-green-400/80 rounded">
                            Installed
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-white/35 truncate">{ext.description || ext.name}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="col-span-7 border border-white/[0.06] rounded-xl bg-white/[0.02] p-4 flex flex-col min-h-0">
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
                onInstall={() => handleInstall(selectedExtension.name)}
                onUninstall={() => handleUninstall(selectedExtension.name)}
                onOpenReadme={() => openRepoPage(selectedExtension.name, true)}
                onOpenSource={() => openRepoPage(selectedExtension.name, false)}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-white/35">
                Select an extension to view details
              </div>
            )}
          </div>
        </div>
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
        ? 'bg-white/[0.12] text-white'
        : 'bg-white/[0.04] text-white/60 hover:text-white/85'
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
      <div className="w-5 h-5 rounded-full bg-white/[0.10] overflow-hidden flex items-center justify-center text-[10px] text-white/85">
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
      <span className="text-sm text-white/85 truncate">{name}</span>
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
  onInstall: () => void;
  onUninstall: () => void;
  onOpenReadme: () => void;
  onOpenSource: () => void;
}> = ({ ext, screenshots, screenshotsLoading, detailTab, onTabChange, installed, busy, onInstall, onUninstall, onOpenReadme, onOpenSource }) => {
  const team = ext.contributors?.length ? ext.contributors : ext.author ? [ext.author] : [];
  const visibleCommands = ext.commands.slice(0, 7);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start gap-3 pb-3 border-b border-white/[0.08]">
        <div className="w-12 h-12 rounded-xl bg-white/[0.06] overflow-hidden flex items-center justify-center">
          <img src={ext.iconUrl} alt="" className="w-12 h-12 object-contain" draggable={false} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold text-white truncate">{ext.title}</div>
          <div className="text-sm text-white/50">by {ext.author || 'Unknown'}</div>
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
              <div className="text-white/35 uppercase tracking-wider text-xs mb-1">Description</div>
              <div className="text-white/85 text-sm leading-relaxed">{ext.description || 'No description provided.'}</div>
            </div>
            <div>
              <div className="text-white/35 uppercase tracking-wider text-xs mb-1">Screenshots</div>
              {screenshotsLoading ? (
                <div className="text-sm text-white/40">Loading screenshots...</div>
              ) : screenshots && screenshots.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {screenshots.slice(0, 4).map((url, idx) => (
                    <button
                      key={`${url}-${idx}`}
                      onClick={() => window.electron.openUrl(url)}
                      className="rounded-md overflow-hidden border border-white/[0.08] bg-white/[0.03] hover:border-white/[0.20] transition-colors"
                    >
                      <img src={url} alt="" className="w-full h-24 object-cover" draggable={false} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-white/40">No screenshots declared.</div>
              )}
            </div>
            <div>
              <div className="text-white/35 uppercase tracking-wider text-xs mb-1">Top Commands</div>
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
                      <div className="text-sm text-white/90">{cmd.title || cmd.name}</div>
                      <div className="text-xs text-white/45 line-clamp-1">
                        {cmd.description || 'No description'}
                      </div>
                    </div>
                  </div>
                ))}
                {ext.commands.length === 0 && (
                  <div className="text-sm text-white/40">No commands declared.</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-white/35 uppercase tracking-wider text-xs mb-1">Categories</div>
              <div className="flex flex-wrap gap-1.5">
                {ext.categories.length > 0 ? (
                  ext.categories.map((cat) => (
                    <span
                      key={cat}
                      className="text-[11px] px-2 py-0.5 rounded bg-white/[0.08] text-white/75"
                    >
                      {cat}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-white/40">None</span>
                )}
              </div>
            </div>
          </div>
        )}

        {detailTab === 'commands' && (
          <div className="space-y-2">
            {visibleCommands.length > 0 ? (
              visibleCommands.map((cmd) => (
                <div key={cmd.name || cmd.title} className="pb-2 border-b border-white/[0.06] last:border-b-0">
                  <div className="flex items-start gap-2">
                    <img src={ext.iconUrl} alt="" className="w-4 h-4 object-contain mt-0.5 rounded-sm" draggable={false} />
                    <div>
                      <div className="text-sm font-medium text-white/90">{cmd.title || cmd.name}</div>
                      <div className="text-xs text-white/45">{cmd.description || 'No description'}</div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-white/40">No commands declared.</div>
            )}
            {ext.commands.length > visibleCommands.length && (
              <div className="text-xs text-white/40">
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
              <div className="text-sm text-white/40">No contributors declared.</div>
            )}
          </div>
        )}

        {detailTab === 'screenshots' && (
          <div className="space-y-3">
            {screenshotsLoading ? (
              <div className="text-sm text-white/40">Loading screenshots...</div>
            ) : screenshots && screenshots.length > 0 ? (
              screenshots.map((url, idx) => (
                <button
                  key={`${url}-${idx}`}
                  onClick={() => window.electron.openUrl(url)}
                  className="w-full rounded-lg overflow-hidden border border-white/[0.08] bg-white/[0.02] hover:border-white/[0.18] transition-colors"
                >
                  <img src={url} alt="" className="w-full max-h-56 object-cover" draggable={false} />
                </button>
              ))
            ) : (
              <div className="text-sm text-white/40">No screenshots available for this extension.</div>
            )}
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenReadme}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-white/[0.06] hover:bg-white/[0.10] text-white/80 transition-colors"
          >
            Open README
            <ExternalLink className="w-3 h-3" />
          </button>
          <button
            onClick={onOpenSource}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-white/[0.06] hover:bg-white/[0.10] text-white/80 transition-colors"
          >
            View Code
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        {busy ? (
          <div className="text-xs text-white/50 inline-flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {installed ? 'Removing...' : 'Installing...'}
          </div>
        ) : installed ? (
          <button
            onClick={onUninstall}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-300 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Uninstall
          </button>
        ) : (
          <button
            onClick={onInstall}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Install Extension
          </button>
        )}
      </div>
    </div>
  );
};

export default StoreTab;
