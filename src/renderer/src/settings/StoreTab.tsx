/**
 * Store Tab
 *
 * Browse, search, install, and uninstall community extensions
 * fetched from the Raycast extensions GitHub repository.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Download,
  Trash2,
  RefreshCw,
  Package,
  ExternalLink,
} from 'lucide-react';

interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  author: string;
  iconUrl: string;
  categories: string[];
  commands: { name: string; title: string; description: string }[];
}

const PAGE_SIZE = 50;

const StoreTab: React.FC = () => {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [installedNames, setInstalledNames] = useState<Set<string>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // ─── Load catalog ───────────────────────────────────────────────

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

  // ─── Filter & paginate ──────────────────────────────────────────

  const filteredCatalog = searchQuery.trim()
    ? catalog.filter((ext) => {
        const q = searchQuery.toLowerCase();
        return (
          ext.title.toLowerCase().includes(q) ||
          ext.description.toLowerCase().includes(q) ||
          ext.author.toLowerCase().includes(q) ||
          ext.name.toLowerCase().includes(q) ||
          ext.categories.some((c) => c.toLowerCase().includes(q))
        );
      })
    : catalog;

  const paginatedCatalog = filteredCatalog.slice(0, page * PAGE_SIZE);
  const hasMore = paginatedCatalog.length < filteredCatalog.length;

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  // ─── Install / Uninstall ────────────────────────────────────────

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

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-semibold text-white">Store</h2>
        <button
          onClick={() => loadCatalog(true)}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/50 hover:text-white/80 bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors disabled:opacity-40"
        >
          <RefreshCw
            className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`}
          />
          Refresh
        </button>
      </div>

      <p className="text-xs text-white/35 mb-5">
        Browse and install community extensions from the{' '}
        <span className="text-blue-400/70">Raycast Extensions</span>{' '}
        repository.
        {catalog.length > 0 && ` ${catalog.length} extensions available.`}
      </p>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          placeholder="Search extensions by name, description, author, or category..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20 transition-colors"
        />
      </div>

      {/* Loading state */}
      {isLoading && catalog.length === 0 && (
        <div className="text-center py-20">
          <RefreshCw className="w-6 h-6 text-white/20 animate-spin mx-auto mb-3" />
          <p className="text-sm text-white/40">
            Loading extension catalog…
          </p>
          <p className="text-xs text-white/25 mt-1">
            This may take a moment the first time.
          </p>
        </div>
      )}

      {/* Error state */}
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

      {/* Empty state */}
      {!isLoading && filteredCatalog.length === 0 && !error && (
        <div className="text-center py-20 text-white/30">
          <Package className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {searchQuery.trim()
              ? 'No extensions match your search'
              : 'No extensions available'}
          </p>
        </div>
      )}

      {/* Extension list */}
      {paginatedCatalog.length > 0 && (
        <div className="space-y-0.5">
          {paginatedCatalog.map((ext) => {
            const installed = installedNames.has(ext.name);
            const busy = busyName === ext.name;

            return (
              <div
                key={ext.name}
                className="flex items-center gap-3 px-4 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group"
              >
                {/* Icon */}
                <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center overflow-hidden flex-shrink-0">
                  <img
                    src={ext.iconUrl}
                    alt=""
                    className="w-9 h-9 object-contain"
                    draggable={false}
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      img.style.display = 'none';
                    }}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white/90 truncate">
                      {ext.title}
                    </span>
                    {ext.author && (
                      <span className="text-[11px] text-white/25 flex-shrink-0">
                        by {ext.author}
                      </span>
                    )}
                    {installed && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-500/15 text-green-400/80 rounded flex-shrink-0">
                        Installed
                      </span>
                    )}
                  </div>
                  {ext.description && (
                    <div className="text-xs text-white/35 truncate mt-0.5">
                      {ext.description}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex-shrink-0">
                  {busy ? (
                    <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-white/40">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      {installed ? 'Removing…' : 'Installing…'}
                    </div>
                  ) : installed ? (
                    <button
                      onClick={() => handleUninstall(ext.name)}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs text-red-400/60 hover:text-red-400 bg-red-500/0 hover:bg-red-500/10 rounded-md transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3 h-3" />
                      Uninstall
                    </button>
                  ) : (
                    <button
                      onClick={() => handleInstall(ext.name)}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-md transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Install
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Load more */}
          {hasMore && (
            <button
              onClick={() => setPage((p) => p + 1)}
              className="w-full py-3 text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Show more ({filteredCatalog.length - paginatedCatalog.length}{' '}
              remaining)
            </button>
          )}
        </div>
      )}

      {/* Footer count */}
      {!isLoading && filteredCatalog.length > 0 && (
        <div className="mt-4 text-[11px] text-white/20">
          Showing {Math.min(paginatedCatalog.length, filteredCatalog.length)}{' '}
          of {filteredCatalog.length} extensions
        </div>
      )}
    </div>
  );
};

export default StoreTab;



