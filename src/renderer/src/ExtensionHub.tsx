/**
 * ExtensionHub.tsx — SuperCmd Extensions Store
 *
 * Three tabs:
 *   Store    — the REGISTRY of available SuperCmd extensions (modular, open-source)
 *   Installed — added store extensions + Raycast-compatible extensions on disk
 *   Develop  — docs and guides for building / contributing extensions
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * HOW TO ADD AN EXTENSION TO THE STORE
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. Add an entry to the REGISTRY array below — see the commented template.
 * 2. Create the corresponding setup panel component (e.g. MyExtensionSetup.tsx).
 * 3. Register a system command in src/main/commands.ts.
 * 4. Wire the command in src/renderer/src/App.tsx (runLocalSystemCommand +
 *    render waterfall) and src/renderer/src/hooks/useAppViewManager.ts.
 * 5. Open a PR to SuperCmdLabs/SuperCmd — community extensions are welcome!
 *
 * Full guide: docs/EXTENSIONS.md
 * ──────────────────────────────────────────────────────────────────────────────
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle,
  Circle,
  Code2,
  Download,
  ExternalLink,
  GitPullRequest,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import supercmdLogo from '../../../supercmd.svg';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ExtensionHubProps {
  onClose: () => void;
  /** Called when the user clicks "Add to SuperCmd" or "Open / Settings" */
  onOpenIntegration: (commandId: string) => void;
}

// ─── Registry entry interface ─────────────────────────────────────────────────
// This is the contract for every extension in the SuperCmd store.
// Add your extension by appending a conforming object to REGISTRY below.

export interface RegistryEntry {
  /** Unique slug — used to key status state */
  id: string;
  /** Display name shown in the store card */
  name: string;
  /** One-line tagline */
  tagline: string;
  /** 1–3 sentence description */
  description: string;
  /**
   * Icon: either a URL string to a PNG/SVG,
   * or a React node (e.g. an emoji, or an SVG element).
   */
  icon: string | React.ReactNode;
  /** Hex colour used to tint the card accent (e.g. '#6366f1') */
  accentColor: string;
  /** The SuperCmd system command ID invoked for setup / open */
  commandId: string;
  /** URL to the extension's documentation */
  docsUrl: string;
  /** Category shown as a badge */
  category: 'AI' | 'Productivity' | 'Communication' | 'Developer' | 'Media' | 'System';
  /**
   * Optional custom confirmation text shown in the remove confirmation panel.
   * If omitted, the generic "resets SuperCmd setup" message is shown.
   */
  removeConfirmText?: string;
  /**
   * Async function that returns true when the extension is already
   * set up / configured on this machine.
   */
  checkInstalled: () => Promise<boolean>;
  /**
   * Async function that completely removes this extension from SuperCmd.
   * Should clear any stored state so checkInstalled() returns false again.
   */
  remove: () => Promise<void>;
}

// ─── Installed-extension shape (Raycast-compatible) ──────────────────────────

interface InstalledExt {
  name: string;
  title: string;
  commands: number;
}

// ─── Catalog entry shape (from window.electron.getCatalog) ────────────────────

interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  author: string;
  contributors: string[];
  iconUrl: string;
  categories: string[];
  commands: { name: string; title: string; description: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HOME = window.electron.homeDir;

/** Convert a 6-digit hex colour to rgba(). */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
// Open-source contributions welcome!
// To add your extension, copy the template below, fill in the fields,
// implement the setup panel, and open a PR to SuperCmdLabs/SuperCmd.
// See docs/EXTENSIONS.md for the full contributor guide.
// ─────────────────────────────────────────────────────────────────────────────

const REGISTRY: RegistryEntry[] = [

  // ── OpenClaw ──────────────────────────────────────────────────────────────
  {
    id: 'openclaw',
    name: 'OpenClaw',
    tagline: 'Self-hosted AI agent gateway',
    description:
      'Run a private AI assistant that responds to your messages on WhatsApp, Telegram, iMessage, Discord, and more — entirely on your Mac. No cloud required.',
    icon: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/openclaw.png',
    accentColor: '#ea4647',
    commandId: 'system-openclaw-open',
    docsUrl: 'https://openclaw.ai/',
    category: 'AI',
    removeConfirmText: 'This will stop the OpenClaw gateway, remove the macOS LaunchAgent daemon, and uninstall the openclaw CLI from your Mac. Your config and data in ~/.openclaw/ will remain on disk — delete that folder manually if you want a full wipe.',
    checkInstalled: async () => {
      // The localStorage flag is the canonical "added to SuperCmd" marker.
      // It is set when the user completes the setup wizard and cleared by remove().
      return localStorage.getItem('openclaw_setup_done') === 'true';
    },
    remove: async () => {
      const HOME = window.electron.homeDir;
      // Stop gateway, remove daemon, uninstall CLI — ignore individual failures
      await window.electron.execCommand(
        '/bin/zsh',
        ['-l', '-c', 'openclaw gateway stop 2>/dev/null; openclaw daemon uninstall 2>/dev/null; npm uninstall -g openclaw 2>/dev/null; true'],
        { shell: false, env: { HOME } },
      ).catch(() => {});
      // Clear SuperCmd tracking state
      localStorage.removeItem('openclaw_setup_done');
      localStorage.removeItem('openclaw_wizard_step');
    },
  },

  // ── Template — copy this block to add your extension ─────────────────────
  // {
  //   id: 'my-extension',            // unique slug
  //   name: 'My Extension',          // display name
  //   tagline: 'One-line summary',   // shown beneath the name
  //   description: 'Longer description (1–3 sentences) of what this does.',
  //   icon: '🔌',                    // emoji, URL to PNG, or React node
  //   accentColor: '#6366f1',        // hex — used for card tinting
  //   commandId: 'system-my-ext',    // system command wired in App.tsx
  //   docsUrl: 'https://github.com/you/my-extension',
  //   category: 'Productivity',      // AI | Productivity | Communication | Developer | Media | System
  //   checkInstalled: async () => {
  //     // Return true when the user has already set this up.
  //     return false;
  //   },
  //   remove: async () => {
  //     // Clear any state so checkInstalled() returns false again.
  //     // Document any manual cleanup steps (files, daemons, etc.) in a comment.
  //   },
  // },

];

// ─── Component ────────────────────────────────────────────────────────────────

const ExtensionHub: React.FC<ExtensionHubProps> = ({ onClose, onOpenIntegration }) => {
  const [tab, setTab] = useState<'store' | 'installed' | 'develop'>('store');
  const [status, setStatus] = useState<Record<string, boolean | null>>({});
  const [installedExts, setInstalledExts] = useState<InstalledExt[]>([]);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [iconErrors, setIconErrors] = useState<Record<string, boolean>>({});
  const [searchText, setSearchText] = useState('');
  // id of the extension pending remove confirmation, null otherwise
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Record<string, boolean>>({});
  // id of Raycast extension pending remove confirmation
  const [confirmRemoveRaycast, setConfirmRemoveRaycast] = useState<string | null>(null);
  const [removingRaycast, setRemovingRaycast] = useState<Record<string, boolean>>({});
  // Catalog (community extensions from Raycast-compatible store)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogInstalled, setCatalogInstalled] = useState<Set<string>>(new Set());
  const [busyCatalogName, setBusyCatalogName] = useState<string | null>(null);

  // ── Check configured status for every registry entry ──────────────────────
  const checkAllStatuses = useCallback(async () => {
    const result: Record<string, boolean | null> = {};
    await Promise.all(
      REGISTRY.map(async (ext) => {
        try { result[ext.id] = await ext.checkInstalled(); }
        catch { result[ext.id] = false; }
      })
    );
    setStatus(result);
  }, []);

  useEffect(() => { void checkAllStatuses(); }, [checkAllStatuses]);

  // ── Load community catalog on mount ───────────────────────────────────────
  const loadCatalog = useCallback(async (force = false) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [entries, installed] = await Promise.all([
        window.electron.getCatalog(force),
        window.electron.getInstalledExtensionNames(),
      ]);
      setCatalog(entries as CatalogEntry[]);
      setCatalogInstalled(new Set(installed));
    } catch (e: any) {
      setCatalogError(e?.message || 'Failed to load extension catalog.');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const handleCatalogInstall = useCallback(async (name: string) => {
    setBusyCatalogName(name);
    try {
      const ok = await window.electron.installExtension(name);
      if (ok) setCatalogInstalled((prev) => new Set([...prev, name]));
    } catch { /* ignore */ } finally {
      setBusyCatalogName(null);
    }
  }, []);

  const handleCatalogUninstall = useCallback(async (name: string) => {
    setBusyCatalogName(name);
    try {
      const ok = await window.electron.uninstallExtension(name);
      if (ok) setCatalogInstalled((prev) => { const s = new Set(prev); s.delete(name); return s; });
    } catch { /* ignore */ } finally {
      setBusyCatalogName(null);
    }
  }, []);

  // ── Load Raycast-compatible installed extensions ───────────────────────────
  const loadInstalledExts = useCallback(() => {
    setInstalledLoading(true);
    window.electron.getInstalledExtensionNames()
      .then(async (names) => {
        const all = await window.electron.getAllCommands();
        setInstalledExts(names.map((name) => ({
          name,
          title: name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          commands: all.filter(
            (c) => c.category === 'extension' && c.path?.startsWith(`${name}/`)
          ).length,
        })));
      })
      .catch(() => setInstalledExts([]))
      .finally(() => setInstalledLoading(false));
  }, []);

  // Load Raycast installed extensions when switching to the Installed tab
  useEffect(() => {
    if (tab !== 'installed') return;
    loadInstalledExts();
  }, [tab, loadInstalledExts]);

  // ── Remove a store extension ───────────────────────────────────────────────
  const removeStoreExt = useCallback(async (ext: RegistryEntry) => {
    setRemoving((r) => ({ ...r, [ext.id]: true }));
    setConfirmRemoveId(null);
    try {
      await ext.remove();
      // Re-check status
      const newStatus = await ext.checkInstalled();
      setStatus((s) => ({ ...s, [ext.id]: newStatus }));
    } catch (err) {
      console.error('Failed to remove extension:', err);
    } finally {
      setRemoving((r) => ({ ...r, [ext.id]: false }));
    }
  }, []);

  // ── Remove a Raycast extension ─────────────────────────────────────────────
  const removeRaycastExt = useCallback(async (name: string) => {
    setRemovingRaycast((r) => ({ ...r, [name]: true }));
    setConfirmRemoveRaycast(null);
    try {
      await window.electron.uninstallExtension(name);
      loadInstalledExts();
    } catch (err) {
      console.error('Failed to uninstall extension:', err);
    } finally {
      setRemovingRaycast((r) => ({ ...r, [name]: false }));
    }
  }, [loadInstalledExts]);

  // ── Derived: added store extensions ───────────────────────────────────────
  const addedStoreExts = REGISTRY.filter((ext) => status[ext.id] === true);

  // ── Filter registry by search ─────────────────────────────────────────────
  const filtered = REGISTRY.filter((ext) =>
    !searchText ||
    ext.name.toLowerCase().includes(searchText.toLowerCase()) ||
    ext.tagline.toLowerCase().includes(searchText.toLowerCase()) ||
    ext.category.toLowerCase().includes(searchText.toLowerCase())
  );

  // ── Filter catalog by search ───────────────────────────────────────────────
  const filteredCatalog = useMemo(() => {
    const q = searchText.toLowerCase();
    return catalog.filter((ext) =>
      !q ||
      ext.title.toLowerCase().includes(q) ||
      ext.description.toLowerCase().includes(q) ||
      ext.author.toLowerCase().includes(q) ||
      ext.categories.some((c) => c.toLowerCase().includes(q))
    );
  }, [catalog, searchText]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="w-full h-full flex flex-col"
      style={{ background: 'linear-gradient(140deg, rgba(5,8,17,0.97) 0%, rgba(10,8,12,0.98) 52%, rgba(8,6,14,0.97) 100%)' }}
    >

      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-5 py-3.5 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors p-0.5 shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <img src={supercmdLogo} alt="" className="w-4 h-4 object-contain" draggable={false} />
          <span className="text-white/90 text-[14px] font-semibold">SuperCmd Store</span>
        </div>

        {/* Tab strip */}
        <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
          {([
            { id: 'store'     as const, label: 'Store' },
            {
              id: 'installed' as const,
              label: 'Installed',
              badge: addedStoreExts.length + catalogInstalled.size || undefined,
            },
            { id: 'develop'   as const, label: 'Develop' },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-3 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1"
              style={{
                background: tab === t.id ? 'rgba(255,255,255,0.10)' : 'transparent',
                color:      tab === t.id ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.40)',
              }}
            >
              {t.label}
              {'badge' in t && t.badge ? (
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                  style={{ background: 'rgba(99,102,241,0.50)', color: 'rgba(199,210,254,0.90)' }}
                >
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ════════════════════════════════ STORE TAB ════════════════════════════════ */}
        {tab === 'store' && (
          <div className="px-5 py-4 space-y-3 max-w-2xl mx-auto">

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search extensions…"
                className="w-full rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(255,255,255,0.85)',
                }}
              />
            </div>

            {/* ── SuperCmd native extensions — featured at top ── */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <img src={supercmdLogo} alt="" className="w-3.5 h-3.5 object-contain" draggable={false} />
                <p className="text-white/50 text-[11px] font-semibold uppercase tracking-wider">SuperCmd Extensions</p>
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide"
                  style={{ background: 'rgba(99,102,241,0.22)', color: 'rgba(165,180,252,0.85)', border: '1px solid rgba(99,102,241,0.30)' }}
                >
                  Featured
                </span>
              </div>

              {filtered.map((ext) => {
                const installed = status[ext.id];
                const checking = installed === null || installed === undefined;
                const accentBorder = hexToRgba(ext.accentColor, 0.35);
                const accentBg    = hexToRgba(ext.accentColor, 0.10);

                return (
                  <div
                    key={ext.id}
                    className="rounded-2xl overflow-hidden"
                    style={{ border: `1px solid ${accentBorder}`, background: 'rgba(255,255,255,0.03)' }}
                  >
                    {/* Card body */}
                    <div className="p-4 flex items-start gap-4">
                      {/* Icon */}
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: accentBg, border: `1px solid ${accentBorder}` }}
                      >
                        {typeof ext.icon === 'string' ? (
                          iconErrors[ext.id] ? (
                            <span style={{ fontSize: 24 }}>🔌</span>
                          ) : (
                            <img
                              src={ext.icon}
                              alt={ext.name}
                              width={32}
                              height={32}
                              className="object-contain"
                              draggable={false}
                              onError={() => setIconErrors((e) => ({ ...e, [ext.id]: true }))}
                            />
                          )
                        ) : (
                          <span style={{ fontSize: 24 }}>{ext.icon}</span>
                        )}
                      </div>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <p className="text-white/90 text-sm font-semibold">{ext.name}</p>
                          <span
                            className="inline-flex px-1.5 py-0.5 rounded-full text-[10px]"
                            style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.45)' }}
                          >
                            {ext.category}
                          </span>
                          {checking ? (
                            <Loader2 className="w-3 h-3 animate-spin text-white/30" />
                          ) : installed ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
                              style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(110,231,183,0.30)', color: '#6ee7b7' }}
                            >
                              <CheckCircle className="w-2.5 h-2.5" /> Added
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
                              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.40)' }}
                            >
                              <Circle className="w-2.5 h-2.5" /> Not added
                            </span>
                          )}
                        </div>
                        <p className="text-white/50 text-[11px] mb-1">{ext.tagline}</p>
                        <p className="text-white/65 text-xs leading-relaxed">{ext.description}</p>
                      </div>
                    </div>

                    {/* Action bar */}
                    <div
                      className="px-4 py-3 flex items-center gap-2 flex-wrap"
                      style={{ borderTop: `1px solid ${accentBorder}`, background: accentBg }}
                    >
                      <button
                        onClick={() => onOpenIntegration(ext.commandId)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white transition-all"
                        style={{ background: ext.accentColor, border: `1px solid ${accentBorder}` }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                      >
                        {installed
                          ? <><Settings className="w-3.5 h-3.5" /> Open / Settings</>
                          : <><Plus className="w-3.5 h-3.5" /> Add to SuperCmd</>
                        }
                      </button>
                      <button
                        onClick={() => window.electron.openUrl(ext.docsUrl)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                        style={{ border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.85)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.55)'; }}
                      >
                        <BookOpen className="w-3.5 h-3.5" /> Docs <ExternalLink className="w-2.5 h-2.5" />
                      </button>
                      <button
                        onClick={() => {
                          setStatus((s) => ({ ...s, [ext.id]: null }));
                          void ext.checkInstalled().then((v) =>
                            setStatus((s) => ({ ...s, [ext.id]: v }))
                          );
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-all text-white/30 hover:text-white/60"
                        title="Refresh status"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {filtered.length === 0 && searchText && (
                <p className="text-white/35 text-xs px-1 py-2">No SuperCmd extensions match "{searchText}"</p>
              )}
            </div>

            {/* ── Community extensions catalog ── */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <p className="text-white/50 text-[11px] font-semibold uppercase tracking-wider">
                  Community Extensions
                  {catalogInstalled.size > 0 && (
                    <span className="normal-case font-normal text-white/30 ml-1">— {catalogInstalled.size} installed</span>
                  )}
                </p>
                {!catalogLoading && (
                  <button
                    onClick={() => void loadCatalog(true)}
                    className="text-white/25 hover:text-white/55 transition-colors"
                    title="Refresh catalog"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
              </div>

              {catalogError && (
                <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}>
                  <p className="text-red-300/80 text-xs">{catalogError}</p>
                  <button onClick={() => void loadCatalog(true)} className="text-red-400/60 hover:text-red-400 text-[11px] underline mt-1">Try again</button>
                </div>
              )}

              {catalogLoading && catalog.length === 0 ? (
                <div className="flex items-center gap-2 text-white/30 text-xs px-1 py-4">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading catalog…
                </div>
              ) : filteredCatalog.length === 0 && searchText ? (
                <p className="text-white/30 text-xs px-1 py-2">No extensions match "{searchText}"</p>
              ) : (
                <div className="space-y-1.5">
                  {filteredCatalog.map((ext) => {
                    const isInstalled = catalogInstalled.has(ext.name);
                    const isBusy = busyCatalogName === ext.name;
                    return (
                      <div
                        key={ext.name}
                        className="rounded-xl p-3 flex items-center gap-3"
                        style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.03)' }}
                      >
                        {/* Icon */}
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
                          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)' }}
                        >
                          <img
                            src={ext.iconUrl}
                            alt=""
                            width={36}
                            height={36}
                            className="object-contain"
                            draggable={false}
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        </div>

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-white/85 text-sm font-medium truncate">{ext.title}</p>
                            {isInstalled && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                                style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(110,231,183,0.25)', color: '#6ee7b7' }}>
                                <Check className="w-2.5 h-2.5" /> Installed
                              </span>
                            )}
                          </div>
                          <p className="text-white/35 text-[11px] truncate">{ext.description || `by ${ext.author}`}</p>
                        </div>

                        {/* Action */}
                        {isBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin text-white/30 shrink-0" />
                        ) : isInstalled ? (
                          <button
                            onClick={() => void handleCatalogUninstall(ext.name)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all shrink-0"
                            style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.40)' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(239,68,68,0.80)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.40)'; }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            onClick={() => void handleCatalogInstall(ext.name)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 text-white"
                            style={{ background: 'rgba(99,102,241,0.30)', border: '1px solid rgba(99,102,241,0.40)' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.50)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.30)'; }}
                          >
                            <Download className="w-3 h-3" /> Install
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Contribute CTA */}
            <div
              className="rounded-xl p-3.5 flex items-center justify-between gap-3"
              style={{ border: '1px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.07)' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <GitPullRequest className="w-4 h-4 shrink-0" style={{ color: 'rgba(165,180,252,0.80)' }} />
                <div className="min-w-0">
                  <p className="text-indigo-200/85 text-xs font-medium">Want to add your extension here?</p>
                  <p className="text-indigo-200/50 text-[11px]">SuperCmd is open source — submit a PR to the registry</p>
                </div>
              </div>
              <button
                onClick={() => window.electron.openUrl('https://github.com/SuperCmdLabs/SuperCmd/blob/main/docs/EXTENSIONS.md')}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all shrink-0 font-medium"
                style={{ color: 'rgba(165,180,252,0.80)', border: '1px solid rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.15)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(165,180,252,1)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(165,180,252,0.80)'; }}
              >
                Contributor guide <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════ INSTALLED TAB ════════════════════════════════ */}
        {tab === 'installed' && (
          <div className="px-5 py-4 space-y-4 max-w-2xl mx-auto">

            {/* ── Store extensions that have been added ── */}
            {addedStoreExts.length > 0 && (
              <div className="space-y-2">
                <p className="text-white/38 text-[11px] font-semibold uppercase tracking-wider px-1">
                  SuperCmd Extensions
                </p>

                {addedStoreExts.map((ext) => {
                  const accentBorder = hexToRgba(ext.accentColor, 0.35);
                  const accentBg    = hexToRgba(ext.accentColor, 0.08);
                  const isConfirming = confirmRemoveId === ext.id;
                  const isRemoving   = removing[ext.id];

                  return (
                    <div
                      key={ext.id}
                      className="rounded-xl overflow-hidden"
                      style={{ border: `1px solid ${accentBorder}`, background: 'rgba(255,255,255,0.03)' }}
                    >
                      <div className="p-3.5 flex items-center gap-3">
                        {/* Icon */}
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: accentBg, border: `1px solid ${accentBorder}` }}
                        >
                          {typeof ext.icon === 'string' ? (
                            iconErrors[ext.id] ? (
                              <span style={{ fontSize: 18 }}>🔌</span>
                            ) : (
                              <img
                                src={ext.icon}
                                alt={ext.name}
                                width={22}
                                height={22}
                                className="object-contain"
                                draggable={false}
                                onError={() => setIconErrors((e) => ({ ...e, [ext.id]: true }))}
                              />
                            )
                          ) : (
                            <span style={{ fontSize: 18 }}>{ext.icon}</span>
                          )}
                        </div>

                        {/* Name + tagline */}
                        <div className="flex-1 min-w-0">
                          <p className="text-white/85 text-sm font-medium truncate">{ext.name}</p>
                          <p className="text-white/38 text-[11px] truncate">{ext.tagline}</p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => onOpenIntegration(ext.commandId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white transition-all"
                            style={{ background: hexToRgba(ext.accentColor, 0.70), border: `1px solid ${accentBorder}` }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.80'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                          >
                            <Settings className="w-3 h-3" /> Open
                          </button>
                          <button
                            onClick={() => setConfirmRemoveId(isConfirming ? null : ext.id)}
                            disabled={isRemoving}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-all"
                            style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(239,68,68,0.80)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)'; }}
                            title="Remove"
                          >
                            {isRemoving
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Trash2 className="w-3.5 h-3.5" />
                            }
                          </button>
                        </div>
                      </div>

                      {/* Inline remove confirmation */}
                      {isConfirming && (
                        <div
                          className="px-4 py-3 flex items-start gap-3"
                          style={{ borderTop: '1px solid rgba(239,68,68,0.20)', background: 'rgba(239,68,68,0.07)' }}
                        >
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'rgba(248,113,113,0.80)' }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-red-300/85 text-xs font-medium mb-0.5">Remove {ext.name} from SuperCmd?</p>
                            <p className="text-red-300/55 text-[11px] leading-relaxed mb-2.5">
                              {ext.removeConfirmText || `This resets ${ext.name}'s SuperCmd setup. Any installed CLI tools, config files, or daemons on your system will not be removed — check the extension's docs for full uninstall steps.`}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => void removeStoreExt(ext)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                                style={{ background: 'rgba(239,68,68,0.25)', border: '1px solid rgba(239,68,68,0.40)', color: 'rgba(252,165,165,0.90)' }}
                              >
                                <Trash2 className="w-3 h-3" /> Yes, remove
                              </button>
                              <button
                                onClick={() => setConfirmRemoveId(null)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                                style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.50)' }}
                              >
                                <X className="w-3 h-3" /> Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Community extensions installed ── */}
            <div className="space-y-2">
              {addedStoreExts.length > 0 && (
                <p className="text-white/38 text-[11px] font-semibold uppercase tracking-wider px-1">
                  Community Extensions
                </p>
              )}
              <p className="text-white/38 text-xs leading-relaxed px-1">
                Extensions installed from the SuperCmd Store.
              </p>

              {installedLoading ? (
                <div className="flex items-center justify-center py-10 gap-2 text-white/40 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : installedExts.length === 0 ? (
                <div
                  className="rounded-2xl p-6 text-center space-y-3"
                  style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                >
                  <Package className="w-8 h-8 text-white/20 mx-auto" />
                  <p className="text-white/55 text-sm font-medium">No extensions installed yet</p>
                  <p className="text-white/35 text-xs leading-relaxed max-w-xs mx-auto">
                    Head to the Store tab to browse and install extensions.
                  </p>
                  <button
                    onClick={() => setTab('store')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white transition-all"
                    style={{ background: 'rgba(99,102,241,0.30)', border: '1px solid rgba(99,102,241,0.40)' }}
                  >
                    Go to Store <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {installedExts.map((ext) => {
                    const isConfirming = confirmRemoveRaycast === ext.name;
                    const isRemoving   = removingRaycast[ext.name];

                    return (
                      <div
                        key={ext.name}
                        className="rounded-xl overflow-hidden"
                        style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.03)' }}
                      >
                        <div className="p-3.5 flex items-center gap-3">
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)' }}
                          >
                            <Package className="w-4 h-4 text-white/40" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white/85 text-sm font-medium truncate">{ext.title}</p>
                            <p className="text-white/38 text-[11px]">
                              {ext.commands} {ext.commands === 1 ? 'command' : 'commands'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'rgba(110,231,183,0.75)' }}>
                              <Check className="w-3 h-3" /> Installed
                            </span>
                            <button
                              onClick={() => setConfirmRemoveRaycast(isConfirming ? null : ext.name)}
                              disabled={isRemoving}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-all ml-1"
                              style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)' }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(239,68,68,0.80)'; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)'; }}
                              title="Remove"
                            >
                              {isRemoving
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />
                              }
                            </button>
                          </div>
                        </div>

                        {/* Inline remove confirmation */}
                        {isConfirming && (
                          <div
                            className="px-4 py-3 flex items-start gap-3"
                            style={{ borderTop: '1px solid rgba(239,68,68,0.20)', background: 'rgba(239,68,68,0.07)' }}
                          >
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'rgba(248,113,113,0.80)' }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-red-300/85 text-xs font-medium mb-2">
                                Uninstall {ext.title}?
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => void removeRaycastExt(ext.name)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                                  style={{ background: 'rgba(239,68,68,0.25)', border: '1px solid rgba(239,68,68,0.40)', color: 'rgba(252,165,165,0.90)' }}
                                >
                                  <Trash2 className="w-3 h-3" /> Yes, uninstall
                                </button>
                                <button
                                  onClick={() => setConfirmRemoveRaycast(null)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                                  style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.50)' }}
                                >
                                  <X className="w-3 h-3" /> Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ════════════════════════════════ DEVELOP TAB ════════════════════════════════ */}
        {tab === 'develop' && (
          <div className="px-5 py-4 space-y-4 max-w-2xl mx-auto">

            {/* Hero */}
            <div
              className="rounded-2xl p-5 flex gap-4 items-start"
              style={{ border: '1px solid rgba(99,102,241,0.30)', background: 'rgba(99,102,241,0.08)' }}
            >
              <img src={supercmdLogo} alt="" className="w-10 h-10 object-contain shrink-0" draggable={false} />
              <div>
                <p className="text-indigo-100/90 text-sm font-semibold mb-1">Build for SuperCmd</p>
                <p className="text-indigo-200/60 text-xs leading-relaxed">
                  SuperCmd is open source and built for extensibility. Build UI extensions, register a
                  native panel in the store, or write script commands — all with the same documented API.
                </p>
              </div>
            </div>

            {/* Extension types */}
            <div className="space-y-2.5">
              {([
                {
                  icon: <Package className="w-4 h-4" style={{ color: 'rgba(165,180,252,0.80)' }} />,
                  title: 'SuperCmd Extension',
                  description:
                    'Build UI extensions with React and the SuperCmd Extension API. Compatible with the open-source extension ecosystem — thousands of community extensions work out of the box.',
                  cta: 'Extension API Docs',
                  url: 'https://github.com/SuperCmdLabs/SuperCmd/blob/main/docs/EXTENSIONS.md',
                },
                {
                  icon: <Code2 className="w-4 h-4" style={{ color: 'rgba(165,180,252,0.80)' }} />,
                  title: 'Native Panel Extension (Store)',
                  description:
                    'Register a first-class panel with its own wizard, settings, and icon in the SuperCmd Store. Add an entry to the REGISTRY in ExtensionHub.tsx and open a PR.',
                  cta: 'Registry Contributor Guide',
                  url: 'https://github.com/SuperCmdLabs/SuperCmd/blob/main/docs/EXTENSIONS.md#adding-to-the-store',
                },
                {
                  icon: <Zap className="w-4 h-4" style={{ color: 'rgba(165,180,252,0.80)' }} />,
                  title: 'Script Commands',
                  description:
                    'Write a shell/Python/Node script with a few metadata comment lines and run it instantly from SuperCmd.',
                  cta: 'Script Command Docs',
                  url: 'https://github.com/SuperCmdLabs/SuperCmd/blob/main/docs/EXTENSIONS.md#script-commands',
                },
              ] as const).map((item) => (
                <div
                  key={item.title}
                  className="rounded-xl p-4 flex items-start gap-3"
                  style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.03)' }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.30)' }}
                  >
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/85 text-sm font-medium mb-1">{item.title}</p>
                    <p className="text-white/50 text-xs leading-relaxed mb-2.5">{item.description}</p>
                    <button
                      onClick={() => window.electron.openUrl(item.url)}
                      className="inline-flex items-center gap-1.5 text-xs transition-all"
                      style={{ color: 'rgba(165,180,252,0.80)' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(165,180,252,1)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(165,180,252,0.80)'; }}
                    >
                      {item.cta} <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* GitHub CTA */}
            <button
              onClick={() => window.electron.openUrl('https://github.com/SuperCmdLabs/SuperCmd')}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium text-white/75 hover:text-white transition-colors"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.11)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)'; }}
            >
              View SuperCmd on GitHub <ExternalLink className="w-4 h-4 text-white/40" />
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default ExtensionHub;
