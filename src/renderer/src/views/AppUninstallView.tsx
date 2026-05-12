/**
 * AppUninstallView.tsx
 * Full-screen view matching Raycast's uninstall UI.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ArrowLeft, Check, Folder, File, ChevronDown, Trash2, Circle, Copy, FolderOpen, Info } from 'lucide-react';
import { useI18n } from '../i18n';
import type { AppUninstallScanResult } from '../../types/electron';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 bytes';
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024)) - 1;
  const val = bytes / Math.pow(1024, i + 1);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

interface ActionItem {
  title: string;
  shortcut: string;
  icon?: React.ReactNode;
  style?: 'destructive';
  separator?: boolean;
  execute: () => void | Promise<void>;
}

interface AppUninstallViewProps {
  appPath: string;
  onClose: () => void;
}

type SortMode = 'path' | 'size';

const KEY_CLASS =
  'inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium';

export default function AppUninstallView({ appPath, onClose }: AppUninstallViewProps) {
  const { t } = useI18n();
  const [scanResult, setScanResult] = useState<AppUninstallScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('path');
  const [uninstalling, setUninstalling] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [appIcon, setAppIcon] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');

  // Scan on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.electron.appUninstallScan(appPath).then((result) => {
      if (cancelled) return;
      setScanResult(result);
      setCheckedPaths(new Set(result.remnants.map((r) => r.path)));
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [appPath]);

  // Fetch app icon (size 20 is safe — size 64 causes V8 crash)
  useEffect(() => {
    let cancelled = false;
    window.electron.getAppIconDataUrl(appPath, 32).then((dataUrl) => {
      if (!cancelled && dataUrl) setAppIcon(dataUrl);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [appPath]);

  // Derived data
  const filteredRemnants = useMemo(() => {
    if (!scanResult) return [];
    let items = scanResult.remnants;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      items = items.filter((r) => r.label.toLowerCase().includes(q) || r.location.toLowerCase().includes(q));
    }
    if (sortMode === 'size') {
      items = [...items].sort((a, b) => b.sizeBytes - a.sizeBytes);
    }
    return items;
  }, [scanResult, filterQuery, sortMode]);

  const checkedSize = useMemo(() => {
    if (!scanResult) return 0;
    return scanResult.remnants.filter((r) => checkedPaths.has(r.path)).reduce((sum, r) => sum + r.sizeBytes, 0);
  }, [scanResult, checkedPaths]);

  const toggleCheck = useCallback((p: string) => {
    setCheckedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const handleUninstall = useCallback(async () => {
    if (!scanResult || checkedPaths.size === 0) return;
    const paths = scanResult.remnants.filter((r) => checkedPaths.has(r.path)).map((r) => r.path);
    const confirmed = window.confirm(
      t('appUninstall.confirmMessage', { count: String(paths.length), size: formatSize(checkedSize) })
    );
    if (!confirmed) return;
    setUninstalling(true);
    try {
      const result = await window.electron.appUninstallExecute(paths);
      if (result && result.errors && result.errors.length > 0) {
        window.alert(t('appUninstall.trashErrors', { errors: result.errors.join('\n') }) || 'Some files could not be moved to Trash:\n' + result.errors.join('\n'));
        window.electron.reportNoViewStatus('error', t('appUninstall.uninstallError', { appName: scanResult.appName }));
      } else {
        window.electron.reportNoViewStatus('success', t('appUninstall.uninstallSuccess', { appName: scanResult.appName }));
      }
      onClose();
      // Hide launcher after successful uninstall
      try { window.electron.hideWindow(); } catch {}
    } catch {
      setUninstalling(false);
    }
  }, [scanResult, checkedPaths, checkedSize, t, onClose]);

  // Actions list
  const actions = useMemo<ActionItem[]>(() => {
    const currentItem = filteredRemnants[selectedIndex] || null;
    return [
      {
        title: t('appUninstall.uninstallButton'),
        shortcut: '↩',
        icon: <Trash2 className="w-4 h-4" />,
        style: 'destructive' as const,
        execute: handleUninstall,
      },
      {
        title: currentItem && checkedPaths.has(currentItem.path)
          ? t('appUninstall.markKeep')
          : t('appUninstall.markRemove'),
        shortcut: '⌘ ↩',
        icon: <Circle className="w-4 h-4" />,
        separator: true,
        execute: () => { if (currentItem) toggleCheck(currentItem.path); },
      },
      {
        title: t('launcher.actions.copyPath'),
        shortcut: '⌘ .',
        icon: <Copy className="w-4 h-4" />,
        execute: () => {
          const item = filteredRemnants[selectedIndex];
          if (item) navigator.clipboard.writeText(item.path);
        },
      },
      {
        title: t('launcher.actions.showInFinder'),
        shortcut: '⇧ ⌘ O',
        icon: <FolderOpen className="w-4 h-4" />,
        execute: () => {
          const item = filteredRemnants[selectedIndex];
          if (item) window.electron.execCommand?.('open', ['-R', item.path]);
        },
      },
      {
        title: t('appUninstall.showInfo'),
        shortcut: '⌘ I',
        icon: <Info className="w-4 h-4" />,
        execute: () => {
          const item = filteredRemnants[selectedIndex];
          if (item) window.electron.execCommand?.('open', ['-R', item.path]);
        },
      },
    ];
  }, [handleUninstall, filteredRemnants, selectedIndex, checkedPaths, toggleCheck, t]);

  // Global keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K toggles actions
      if (e.key.toLowerCase() === 'k' && e.metaKey && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        setShowActions((prev) => !prev);
        setSelectedActionIndex(0);
        return;
      }

      // When actions overlay is open
      if (showActions) {
        e.stopPropagation();
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedActionIndex((prev) => Math.min(prev + 1, actions.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedActionIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const action = actions[selectedActionIndex];
          if (action) Promise.resolve(action.execute());
          setShowActions(false);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setShowActions(false);
        }
        return;
      }

      // Escape closes view
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Arrow navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(i + 1, filteredRemnants.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }

      // Cmd+Enter = toggle check on selected
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const item = filteredRemnants[selectedIndex];
        if (item) toggleCheck(item.path);
        return;
      }

      // Enter = uninstall
      if (e.key === 'Enter' && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        handleUninstall();
        return;
      }

      // Cmd+. = copy path
      if (e.key === '.' && e.metaKey) {
        e.preventDefault();
        const item = filteredRemnants[selectedIndex];
        if (item) navigator.clipboard.writeText(item.path);
        return;
      }

      // Shift+Cmd+O = show in finder
      if (e.key.toLowerCase() === 'o' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        const item = filteredRemnants[selectedIndex];
        if (item) window.electron.execCommand?.('open', ['-R', item.path]);
        return;
      }

      // Cmd+I = show info
      if (e.key.toLowerCase() === 'i' && e.metaKey) {
        e.preventDefault();
        const item = filteredRemnants[selectedIndex];
        if (item) window.electron.execCommand?.('open', ['-R', item.path]);
        return;
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showActions, actions, selectedActionIndex, onClose, filteredRemnants, selectedIndex, toggleCheck, handleUninstall]);

  // Scroll selected into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const row = container.children[selectedIndex] as HTMLElement | undefined;
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ─── Loading state ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-secondary)]">
        <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
        <span className="text-sm">{t('appUninstall.scanning')}</span>
      </div>
    );
  }

  if (!scanResult || scanResult.remnants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-secondary)]">
        <span className="text-sm">{t('appUninstall.noRemnants')}</span>
      </div>
    );
  }

  // ─── Main UI ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ─── Header: back arrow + filter input + sort dropdown ─── */}
      <div className="drag-region flex h-[60px] items-center gap-2 px-4 border-b border-[var(--ui-divider)]">
        <button
          onClick={onClose}
          className="p-1.5 -ml-1 rounded-md hover:bg-[var(--hover-bg)] text-[var(--text-muted)] transition-colors no-drag"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={filterQuery}
          onChange={(e) => { setFilterQuery(e.target.value); setSelectedIndex(0); }}
          placeholder={t('appUninstall.filterPlaceholder')}
          className="flex-1 bg-transparent text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none py-2 no-drag"
        />
        <div className="relative no-drag">
          <button
            onClick={() => setShowSortDropdown(!showSortDropdown)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {sortMode === 'path' ? t('appUninstall.sortByPath') : t('appUninstall.sortBySize')}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showSortDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSortDropdown(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-lg border p-1"
                style={{
                  background: 'var(--card-bg)',
                  borderColor: 'var(--border-primary)',
                  backdropFilter: 'blur(40px)',
                }}
              >
                {(['path', 'size'] as SortMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => { setSortMode(mode); setShowSortDropdown(false); }}
                    className={`w-full px-2.5 py-1.5 rounded-md text-left text-[13px] transition-colors ${
                      sortMode === mode
                        ? 'bg-[var(--action-menu-selected-bg)] text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
                    }`}
                  >
                    {mode === 'path' ? t('appUninstall.sortByPath') : t('appUninstall.sortBySize')}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Summary bar ─── */}
      <div className="px-4 py-1.5 text-[11px] font-medium text-[var(--text-muted)] tracking-wide uppercase border-b border-[var(--ui-divider)]">
        {t('appUninstall.filesCount', { count: String(filteredRemnants.length) })} &nbsp;&nbsp; {formatSize(checkedSize)}
      </div>

      {/* ─── Remnant list ─── */}
      <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar px-1.5">
        {filteredRemnants.map((remnant, idx) => {
          const isSelected = idx === selectedIndex;
          const isChecked = checkedPaths.has(remnant.path);
          // Use isAppBundle and file extension to determine icon
          const hasExtension = remnant.label.includes('.') && !remnant.isAppBundle;
          const isFile = hasExtension && (
            remnant.label.endsWith('.plist') ||
            remnant.label.endsWith('.savedState') ||
            remnant.location.includes('Preferences') ||
            remnant.location.includes('LaunchAgents') ||
            remnant.location.includes('LaunchDaemons')
          );
          return (
            <div
              key={remnant.path}
              className={`flex items-center gap-3 px-3 h-[44px] rounded-lg cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-[var(--action-menu-selected-bg)]'
                  : 'hover:bg-[var(--hover-bg)]'
              }`}
              style={isSelected ? {
                borderColor: 'var(--action-menu-selected-border)',
                boxShadow: 'var(--action-menu-selected-shadow)',
              } : undefined}
              onClick={() => { setSelectedIndex(idx); toggleCheck(remnant.path); }}
            >
              {/* Checkbox */}
              <div
                className={`w-[18px] h-[18px] rounded-[5px] border-[1.5px] flex items-center justify-center flex-shrink-0 transition-colors ${
                  isChecked
                    ? 'bg-[var(--accent)] border-[var(--accent)]'
                    : 'border-[var(--text-muted)]'
                }`}
              >
                {isChecked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </div>

              {/* Icon */}
              {remnant.isAppBundle && appIcon ? (
                <img src={appIcon} alt="" className="w-6 h-6 flex-shrink-0" />
              ) : isFile ? (
                <File className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0" />
              ) : (
                <Folder className="w-5 h-5 text-blue-400 flex-shrink-0" fill="currentColor" />
              )}

              {/* Label + location on same line */}
              <div className="flex items-baseline gap-2.5 flex-1 min-w-0">
                <span className="text-[13px] font-medium text-[var(--text-primary)] truncate flex-shrink-0">
                  {remnant.label}
                </span>
                <span className="text-[13px] text-[var(--text-muted)] truncate">
                  {remnant.location}
                </span>
              </div>

              {/* Size */}
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <span className="text-[13px] text-[var(--text-muted)]">
                  {formatSize(remnant.sizeBytes)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Footer ─── */}
      <div className="sc-glass-footer sc-launcher-footer flex items-center px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs flex-1 min-w-0 font-normal truncate text-[var(--text-subtle)]">
          {appIcon && <img src={appIcon} alt="" className="w-5 h-5 flex-shrink-0" />}
          <span className="truncate">{t('appUninstall.title', { appName: scanResult.appName })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { if (!uninstalling && checkedPaths.size > 0) handleUninstall(); }}
            disabled={uninstalling || checkedPaths.size === 0}
            className="flex items-center gap-1.5 text-[var(--text-primary)] hover:text-[var(--text-secondary)] disabled:text-[var(--text-disabled)] transition-colors"
          >
            <span className="text-xs font-normal truncate max-w-[220px]">{t('appUninstall.uninstallButton')}</span>
            <kbd className={KEY_CLASS}>↩</kbd>
          </button>
          <span className="h-5 w-px bg-[var(--ui-divider)] mx-1" />
          <button
            onClick={() => { setShowActions((prev) => !prev); setSelectedActionIndex(0); }}
            className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <span className="text-xs font-normal">{t('appUninstall.actions')}</span>
            <kbd className={KEY_CLASS}>⌘</kbd>
            <kbd className={KEY_CLASS}>K</kbd>
          </button>
        </div>
      </div>

      {/* ─── Actions overlay ─── */}
      {showActions && (
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
            {actions.map((action, index) => (
              <React.Fragment key={action.title}>
                {action.separator && index > 0 && (
                  <div className="my-1 border-t border-[var(--ui-divider)]" />
                )}
                <button
                  type="button"
                  onClick={async () => {
                    await Promise.resolve(action.execute());
                    setShowActions(false);
                  }}
                  onMouseEnter={() => setSelectedActionIndex(index)}
                  onMouseMove={() => setSelectedActionIndex(index)}
                  className={`w-full px-2.5 py-1.5 rounded-md border border-transparent text-left flex items-center gap-2.5 transition-colors ${
                    action.style === 'destructive' ? 'text-red-500' : ''
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
                  {action.icon && (
                    <span className={action.style === 'destructive' ? 'text-red-500' : 'text-[var(--text-muted)]'}>
                      {action.icon}
                    </span>
                  )}
                  <span className="text-[13px] flex-1">{action.title}</span>
                  <span className="flex items-center gap-0.5">
                    {action.shortcut.split(' ').map((key, ki) => (
                      <kbd key={ki} className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">
                        {key}
                      </kbd>
                    ))}
                  </span>
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
