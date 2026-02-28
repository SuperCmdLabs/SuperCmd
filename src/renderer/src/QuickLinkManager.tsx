import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Calendar,
  CalendarClock,
  Check,
  ChevronDown,
  Clipboard,
  Clock,
  ExternalLink,
  Folder,
  Files,
  Globe,
  Pencil,
  Plus,
  Trash2,
  Variable,
  X,
} from 'lucide-react';
import type { QuickLink, QuickLinkDynamicField, QuickLinkIcon } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';
import { useInlineArgumentAnchor } from './hooks/useInlineArgumentAnchor';
import InlineArgumentField, { InlineArgumentLeadingIcon, InlineArgumentOverflowBadge } from './components/InlineArgumentField';
import {
  getQuickLinkIconLabel,
  getQuickLinkIconOption,
  normalizeQuickLinkIconValue,
  QUICK_LINK_DEFAULT_ICON,
  QUICK_LINK_ICON_OPTIONS,
  renderQuickLinkIconGlyph,
} from './utils/quicklink-icons';

interface QuickLinkManagerProps {
  onClose: () => void;
  initialView: 'search' | 'create';
}

interface ApplicationOption {
  name: string;
  path: string;
  bundleId?: string;
  iconDataUrl?: string;
}

type QuickLinkPayload = {
  name: string;
  urlTemplate: string;
  applicationName?: string;
  applicationPath?: string;
  applicationBundleId?: string;
  appIconDataUrl?: string;
  icon: QuickLinkIcon;
};

type PlaceholderGroupItem = {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  subtitle?: string;
  pickerType?: 'path';
};

type PlaceholderGroup = {
  title: string;
  items: PlaceholderGroupItem[];
};

const MAX_VISIBLE_ICON_RESULTS = 4;
const MAX_INLINE_QUICK_LINK_ARGUMENTS = 3;

function isMetaEnterKey(event: { key: string; code?: string; metaKey?: boolean }): boolean {
  return Boolean(event.metaKey) &&
    (event.key === 'Enter' || event.key === 'Return' || event.code === 'Enter' || event.code === 'NumpadEnter');
}

const BASE_PLACEHOLDER_GROUPS: PlaceholderGroup[] = [
  {
    title: 'Dynamic Values',
    items: [
      { label: 'Custom Argument', value: '{argument name="Value"}', icon: Variable },
      { label: 'Clipboard Text', value: '{clipboard}', icon: Clipboard },
      { label: 'Date', value: '{date}', icon: Calendar },
      { label: 'Time', value: '{time}', icon: Clock },
      { label: 'Date + Time', value: '{date:YYYY-MM-DD} {time:HH:mm}', icon: CalendarClock },
      { label: 'File / Folder', value: '', icon: Folder, pickerType: 'path' },
    ],
  },
];

function isLikelyUrlTemplate(template: string): boolean {
  const normalized = String(template || '').trim();
  if (!normalized) return false;

  const candidate = normalized.replace(/\{[^}]+\}/g, 'placeholder');
  if (/^mailto:/i.test(candidate)) return true;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return false;

  try {
    const parsed = new URL(candidate);
    return Boolean(parsed.protocol);
  } catch {
    return false;
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getApplicationSortKey(app: ApplicationOption): string {
  return String(app.name || '').trim().toLowerCase();
}

function pickDefaultApplication(apps: ApplicationOption[]): ApplicationOption | null {
  if (!apps.length) return null;

  const browserHints = ['chrome', 'safari', 'firefox', 'arc', 'edge', 'brave', 'opera', 'vivaldi'];
  const browser = apps.find((app) => {
    const key = `${app.name} ${app.bundleId || ''}`.toLowerCase();
    return browserHints.some((hint) => key.includes(hint));
  });
  return browser || apps[0] || null;
}

function pickFinderApplication(apps: ApplicationOption[]): ApplicationOption | null {
  return apps.find((app) => {
    const bundleId = String(app.bundleId || '').toLowerCase();
    const name = String(app.name || '').toLowerCase();
    const path = String(app.path || '').toLowerCase();
    return bundleId === 'com.apple.finder' || name === 'finder' || path.endsWith('/finder.app');
  }) || null;
}

function toFileUrl(pathValue: string): string {
  const raw = String(pathValue || '').trim();
  if (!raw) return raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;

  const normalized = raw.replace(/\\/g, '/');
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${encodeURI(withLeadingSlash)}`;
}

function normalizeMatchToken(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function buildApplicationMatchTokens(app: ApplicationOption): string[] {
  const set = new Set<string>();
  const add = (value: string | undefined) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return;
    const parts = raw.split(/[^a-z0-9]+/g).filter((part) => part.length >= 2);
    for (const part of parts) set.add(part);
    const compact = normalizeMatchToken(raw);
    if (compact.length >= 2) set.add(compact);
  };

  add(app.name);
  add(app.bundleId);

  const pathParts = String(app.path || '').split('/');
  const appNameFromPath = String(pathParts[pathParts.length - 1] || '')
    .replace(/\.app$/i, '')
    .trim();
  add(appNameFromPath);

  return Array.from(set);
}

function extractQuickLinkTemplateTokens(urlTemplate: string): string[] {
  const normalized = String(urlTemplate || '').trim();
  if (!normalized) return [];

  const candidate = normalized.replace(/\{[^}]+\}/g, 'placeholder');
  try {
    const parsed = new URL(candidate);
    const tokens = new Set<string>();

    const protocol = String(parsed.protocol || '').replace(':', '').trim().toLowerCase();
    if (protocol && !['http', 'https', 'file'].includes(protocol)) {
      tokens.add(protocol);
    }

    const host = String(parsed.hostname || '').trim().toLowerCase();
    if (host) {
      const hostParts = host.split('.').filter(Boolean);
      const ignored = new Set(['www', 'com', 'net', 'org', 'io', 'co', 'app', 'dev', 'ai', 'gg']);
      for (const part of hostParts) {
        if (part.length < 2) continue;
        if (ignored.has(part)) continue;
        tokens.add(part);
      }
      const compactHost = normalizeMatchToken(host);
      if (compactHost.length >= 3) tokens.add(compactHost);
    }

    return Array.from(tokens);
  } catch {
    return [];
  }
}

function findBestApplicationForPastedQuickLink(
  urlTemplate: string,
  applications: ApplicationOption[]
): ApplicationOption | null {
  const templateTokens = extractQuickLinkTemplateTokens(urlTemplate);
  if (templateTokens.length === 0) return null;

  let bestMatch: ApplicationOption | null = null;
  let bestScore = 0;

  for (const app of applications) {
    const appTokens = buildApplicationMatchTokens(app);
    if (appTokens.length === 0) continue;

    let score = 0;
    for (const token of templateTokens) {
      if (appTokens.includes(token)) {
        score += 4;
        continue;
      }
      if (appTokens.some((appToken) => appToken.includes(token) || token.includes(appToken))) {
        score += 2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = app;
    }
  }

  return bestScore >= 4 ? bestMatch : null;
}

function normalizeQuickLinkDynamicFields(fields: QuickLinkDynamicField[]): QuickLinkDynamicField[] {
  const map = new Map<string, QuickLinkDynamicField>();
  for (const field of fields || []) {
    const key = String(field?.key || field?.name || '').trim();
    if (!key) continue;
    const normalizedKey = key.toLowerCase();
    if (map.has(normalizedKey)) continue;
    map.set(normalizedKey, {
      key,
      name: String(field?.name || key),
      defaultValue: field?.defaultValue,
    });
  }
  return Array.from(map.values());
}

const QuickLinkIconPreview: React.FC<{
  icon: QuickLinkIcon;
  appIconDataUrl?: string;
}> = ({ icon, appIconDataUrl }) => {
  const normalizedIcon = normalizeQuickLinkIconValue(icon);
  if (normalizedIcon === QUICK_LINK_DEFAULT_ICON && appIconDataUrl) {
    return <img src={appIconDataUrl} alt="" className="w-4 h-4 object-contain" draggable={false} />;
  }
  return <>{renderQuickLinkIconGlyph(normalizedIcon, 'w-4 h-4 text-white/70')}</>;
};

interface QuickLinkFormProps {
  quickLink?: QuickLink;
  onSave: (payload: QuickLinkPayload) => Promise<void> | void;
  onCancel: () => void;
}

const QuickLinkForm: React.FC<QuickLinkFormProps> = ({ quickLink, onSave, onCancel }) => {
  const [name, setName] = useState(quickLink?.name || '');
  const [urlTemplate, setUrlTemplate] = useState(quickLink?.urlTemplate || '');
  const [icon, setIcon] = useState<QuickLinkIcon>(normalizeQuickLinkIconValue(quickLink?.icon || QUICK_LINK_DEFAULT_ICON));
  const [applications, setApplications] = useState<ApplicationOption[]>([]);
  const [selectedAppPath, setSelectedAppPath] = useState(quickLink?.applicationPath || '');
  const [appIconDataUrl, setAppIconDataUrl] = useState<string | undefined>(quickLink?.appIconDataUrl);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showPlaceholderMenu, setShowPlaceholderMenu] = useState(false);
  const [showApplicationMenu, setShowApplicationMenu] = useState(false);
  const [showIconMenu, setShowIconMenu] = useState(false);
  const [selectedPlaceholderIndex, setSelectedPlaceholderIndex] = useState(-1);
  const [selectedApplicationIndex, setSelectedApplicationIndex] = useState(-1);
  const [selectedIconIndex, setSelectedIconIndex] = useState(-1);
  const [applicationQuery, setApplicationQuery] = useState('');
  const [iconQuery, setIconQuery] = useState('');
  const [applicationIcons, setApplicationIcons] = useState<Record<string, string>>({});
  const [shouldAutoSelectAppFromPaste, setShouldAutoSelectAppFromPaste] = useState(false);
  const appIconFetchAttemptedRef = useRef<Set<string>>(new Set());
  const [placeholderMenuPos, setPlaceholderMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 0,
    width: 280,
    maxHeight: 260,
  });
  const [applicationMenuPos, setApplicationMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 0,
    width: 340,
    maxHeight: 280,
  });
  const [iconMenuPos, setIconMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 0,
    width: 300,
    maxHeight: 260,
  });

  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const placeholderButtonRef = useRef<HTMLButtonElement>(null);
  const placeholderItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const applicationButtonRef = useRef<HTMLButtonElement>(null);
  const applicationSearchRef = useRef<HTMLInputElement>(null);
  const applicationItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const iconButtonRef = useRef<HTMLButtonElement>(null);
  const iconSearchRef = useRef<HTMLInputElement>(null);
  const iconItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const loadContextData = useCallback(async () => {
    try {
      const appsRaw = await window.electron.getApplications();

      const apps = (appsRaw || [])
        .map((app) => ({
          name: String(app?.name || '').trim(),
          path: String(app?.path || '').trim(),
          bundleId: String(app?.bundleId || '').trim() || undefined,
          iconDataUrl: String(app?.iconDataUrl || '').trim() || undefined,
        }))
        .filter((app) => Boolean(app.name) && Boolean(app.path))
        .sort((a, b) => getApplicationSortKey(a).localeCompare(getApplicationSortKey(b)));

      setApplications(apps);
      setApplicationIcons((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const app of apps) {
          if (!app.iconDataUrl || next[app.path]) continue;
          next[app.path] = app.iconDataUrl;
          changed = true;
        }
        return changed ? next : prev;
      });
      if (!selectedAppPath && !quickLink?.applicationPath) {
        const fallbackApp = pickDefaultApplication(apps);
        if (fallbackApp) {
          setSelectedAppPath(fallbackApp.path);
        }
      }
    } catch (error) {
      console.error('Failed to load quick link setup data:', error);
    }
  }, [quickLink?.applicationPath]);

  useEffect(() => {
    void loadContextData();
  }, [loadContextData]);

  useEffect(() => {
    const pending = applications.filter((app) => {
      if (!app.path) return false;
      if (applicationIcons[app.path]) return false;
      if (appIconFetchAttemptedRef.current.has(app.path)) return false;
      return true;
    });
    if (pending.length === 0) return;

    let alive = true;
    for (const app of pending) {
      appIconFetchAttemptedRef.current.add(app.path);
    }

    void Promise.all(
      pending.map(async (app) => {
        try {
          const dataUrl = await window.electron.getFileIconDataUrl(app.path, 20);
          return [app.path, dataUrl] as const;
        } catch {
          return [app.path, null] as const;
        }
      })
    ).then((entries) => {
      if (!alive) return;
      setApplicationIcons((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [appPath, iconDataUrl] of entries) {
          if (!iconDataUrl || next[appPath]) continue;
          next[appPath] = iconDataUrl;
          changed = true;
        }
        return changed ? next : prev;
      });
    });

    return () => {
      alive = false;
    };
  }, [applicationIcons, applications]);

  useEffect(() => {
    let alive = true;

    const selectedApp = applications.find((app) => app.path === selectedAppPath);
    if (!selectedApp?.path) {
      if (!quickLink?.appIconDataUrl) {
        setAppIconDataUrl(undefined);
      }
      return;
    }

    const knownIconDataUrl = applicationIcons[selectedApp.path] || selectedApp.iconDataUrl;
    if (knownIconDataUrl) {
      setAppIconDataUrl(knownIconDataUrl);
    }

    void window.electron.getFileIconDataUrl(selectedApp.path, 32)
      .then((iconDataUrl) => {
        if (!alive) return;
        if (iconDataUrl) {
          setApplicationIcons((prev) => (prev[selectedApp.path] ? prev : { ...prev, [selectedApp.path]: iconDataUrl }));
        }
        // Prefer cached/discovered app icons so we don't downgrade to generic file icons.
        setAppIconDataUrl(knownIconDataUrl || iconDataUrl || quickLink?.appIconDataUrl || undefined);
      })
      .catch(() => {
        if (!alive) return;
        setAppIconDataUrl(knownIconDataUrl || quickLink?.appIconDataUrl || undefined);
      });

    return () => {
      alive = false;
    };
  }, [applicationIcons, applications, quickLink?.appIconDataUrl, selectedAppPath]);

  const refreshPlaceholderMenuPos = useCallback(() => {
    const rect = placeholderButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 10;
    const desiredWidth = 280;
    const estimatedMenuHeight = 250;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < 260 && spaceAbove > 130;
    const top = openAbove ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - 8) : rect.bottom + 8;
    const maxHeight = Math.max(130, Math.floor((openAbove ? spaceAbove : spaceBelow) - 12));
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - desiredWidth - viewportPadding)
    );

    setPlaceholderMenuPos({
      top,
      left,
      width: desiredWidth,
      maxHeight,
    });
  }, []);

  const refreshApplicationMenuPos = useCallback(() => {
    const rect = applicationButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportPadding = 10;
    const desiredWidth = Math.max(300, rect.width);
    const estimatedMenuHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < 240 && spaceAbove > 160;
    const top = openAbove ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - 8) : rect.bottom + 8;
    const maxHeight = Math.max(140, Math.floor((openAbove ? spaceAbove : spaceBelow) - 12));
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - desiredWidth - viewportPadding)
    );

    setApplicationMenuPos({
      top,
      left,
      width: desiredWidth,
      maxHeight,
    });
  }, []);

  const refreshIconMenuPos = useCallback((anchorRect?: DOMRect) => {
    const rect = anchorRect || iconButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportPadding = 10;
    const desiredWidth = Math.max(260, rect.width);
    const estimatedMenuHeight = 300;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    // Prefer opening below; only open above when below space is really constrained.
    const openAbove = spaceBelow < 140 && spaceAbove > 170;
    const top = openAbove ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - 8) : rect.bottom + 8;
    const maxHeight = Math.max(130, Math.floor((openAbove ? spaceAbove : spaceBelow) - 12));
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - desiredWidth - viewportPadding)
    );

    setIconMenuPos({
      top,
      left,
      width: desiredWidth,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!showPlaceholderMenu) return;
    refreshPlaceholderMenuPos();
    const onResize = () => refreshPlaceholderMenuPos();
    const onScroll = () => refreshPlaceholderMenuPos();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [refreshPlaceholderMenuPos, showPlaceholderMenu]);

  useEffect(() => {
    if (!showApplicationMenu) return;
    refreshApplicationMenuPos();
    const onResize = () => refreshApplicationMenuPos();
    const onScroll = () => refreshApplicationMenuPos();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [refreshApplicationMenuPos, showApplicationMenu]);

  useEffect(() => {
    if (!showIconMenu) return;
    refreshIconMenuPos();
    const onResize = () => refreshIconMenuPos();
    const onScroll = () => refreshIconMenuPos();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [refreshIconMenuPos, showIconMenu]);

  useEffect(() => {
    if (!showPlaceholderMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const menu = document.getElementById('quicklink-placeholder-menu');
      if (menu?.contains(target)) return;
      if (placeholderButtonRef.current?.contains(target)) return;
      setShowPlaceholderMenu(false);
      setSelectedPlaceholderIndex(-1);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [showPlaceholderMenu]);

  useEffect(() => {
    if (!showApplicationMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const menu = document.getElementById('quicklink-application-menu');
      if (menu?.contains(target)) return;
      if (applicationButtonRef.current?.contains(target)) return;
      setShowApplicationMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [showApplicationMenu]);

  useEffect(() => {
    if (!showIconMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const menu = document.getElementById('quicklink-icon-menu');
      if (menu?.contains(target)) return;
      if (iconButtonRef.current?.contains(target)) return;
      setShowIconMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [showIconMenu]);

  const placeholderGroups = useMemo(() => BASE_PLACEHOLDER_GROUPS, []);
  const indexedPlaceholderGroups = useMemo(() => {
    let index = 0;
    return placeholderGroups.map((group) => ({
      title: group.title,
      items: group.items.map((item) => ({ item, index: index++ })),
    }));
  }, [placeholderGroups]);
  const placeholderMenuItems = useMemo(
    () => indexedPlaceholderGroups.flatMap((group) => group.items.map((entry) => entry.item)),
    [indexedPlaceholderGroups]
  );

  const selectedApp = useMemo(
    () => applications.find((app) => app.path === selectedAppPath) || null,
    [applications, selectedAppPath]
  );
  const selectedAppName = selectedApp?.name || 'Default Browser';
  const selectedAppResolvedIconDataUrl =
    (selectedAppPath
      ? applicationIcons[selectedAppPath] || selectedApp?.iconDataUrl || appIconDataUrl
      : undefined) || undefined;
  const selectedIconOption = getQuickLinkIconOption(icon) || QUICK_LINK_ICON_OPTIONS[0];
  const filteredApplications = useMemo(() => {
    const query = applicationQuery.trim().toLowerCase();
    if (!query) return applications;
    return applications.filter((app) => {
      const name = String(app.name || '').toLowerCase();
      const bundleId = String(app.bundleId || '').toLowerCase();
      const appPath = String(app.path || '').toLowerCase();
      return name.includes(query) || bundleId.includes(query) || appPath.includes(query);
    });
  }, [applicationQuery, applications]);
  const filteredIconOptions = useMemo(() => {
    const query = iconQuery.trim().toLowerCase();
    if (!query) return QUICK_LINK_ICON_OPTIONS;
    return QUICK_LINK_ICON_OPTIONS.filter((option) => option.searchText.includes(query));
  }, [iconQuery]);
  const visibleIconOptions = useMemo(() => {
    const query = iconQuery.trim().toLowerCase();
    if (query) {
      return filteredIconOptions.slice(0, MAX_VISIBLE_ICON_RESULTS);
    }

    // Keep the current selection visible while limiting initial render to 5 entries.
    const seen = new Set<string>();
    const list = [];
    if (selectedIconOption) {
      list.push(selectedIconOption);
      seen.add(selectedIconOption.value);
    }
    for (const option of QUICK_LINK_ICON_OPTIONS) {
      if (seen.has(option.value)) continue;
      list.push(option);
      seen.add(option.value);
      if (list.length >= MAX_VISIBLE_ICON_RESULTS) break;
    }
    return list;
  }, [filteredIconOptions, iconQuery, selectedIconOption]);
  const applicationMenuItems = useMemo(() => {
    const normalizedQuery = applicationQuery.trim().toLowerCase();
    const includeDefaultBrowser =
      normalizedQuery.length === 0 ||
      'default browser'.includes(normalizedQuery) ||
      'browser'.includes(normalizedQuery);

    const items = filteredApplications.map((app) => ({ type: 'app' as const, app }));
    if (includeDefaultBrowser) {
      items.unshift({ type: 'default' as const, app: null });
    }
    return items;
  }, [applicationQuery, filteredApplications]);

  useEffect(() => {
    applicationItemRefs.current = applicationItemRefs.current.slice(0, applicationMenuItems.length);
  }, [applicationMenuItems.length]);

  useEffect(() => {
    iconItemRefs.current = iconItemRefs.current.slice(0, visibleIconOptions.length);
  }, [visibleIconOptions.length]);

  useEffect(() => {
    if (!showApplicationMenu) {
      setSelectedApplicationIndex(-1);
      return;
    }
    if (applicationMenuItems.length === 0) {
      setSelectedApplicationIndex(-1);
      return;
    }

    const boundedIndex = Math.min(Math.max(selectedApplicationIndex, 0), applicationMenuItems.length - 1);
    if (boundedIndex !== selectedApplicationIndex) {
      setSelectedApplicationIndex(boundedIndex);
    }
  }, [applicationMenuItems.length, selectedApplicationIndex, showApplicationMenu]);

  useEffect(() => {
    if (!showIconMenu) {
      setSelectedIconIndex(-1);
      return;
    }
    if (visibleIconOptions.length === 0) {
      setSelectedIconIndex(-1);
      return;
    }

    const boundedIndex = Math.min(Math.max(selectedIconIndex, 0), visibleIconOptions.length - 1);
    if (boundedIndex !== selectedIconIndex) {
      setSelectedIconIndex(boundedIndex);
    }
  }, [selectedIconIndex, showIconMenu, visibleIconOptions.length]);

  useEffect(() => {
    placeholderItemRefs.current = placeholderItemRefs.current.slice(0, placeholderMenuItems.length);
  }, [placeholderMenuItems.length]);

  useEffect(() => {
    if (!showPlaceholderMenu) return;
    if (placeholderMenuItems.length === 0) return;

    const boundedIndex = Math.min(
      Math.max(selectedPlaceholderIndex >= 0 ? selectedPlaceholderIndex : 0, 0),
      placeholderMenuItems.length - 1
    );

    if (boundedIndex !== selectedPlaceholderIndex) {
      setSelectedPlaceholderIndex(boundedIndex);
      return;
    }

    requestAnimationFrame(() => {
      const target = placeholderItemRefs.current[boundedIndex];
      if (!target) return;
      if (document.activeElement !== target) {
        target.focus();
      }
      target.scrollIntoView({ block: 'nearest' });
    });
  }, [placeholderMenuItems.length, selectedPlaceholderIndex, showPlaceholderMenu]);

  const insertPlaceholder = useCallback((placeholder: string) => {
    const input = urlRef.current;
    if (!input) return;

    const start = input.selectionStart ?? urlTemplate.length;
    const end = input.selectionEnd ?? urlTemplate.length;
    const hasOpeningBraceBeforeCursor = start > 0 && urlTemplate[start - 1] === '{';
    let insertion = placeholder;
    if (hasOpeningBraceBeforeCursor && insertion.startsWith('{')) {
      insertion = insertion.slice(1);
    } else if (!hasOpeningBraceBeforeCursor && !insertion.startsWith('{')) {
      insertion = `{${insertion}`;
    }
    if (!insertion.endsWith('}')) {
      insertion = `${insertion}}`;
    }

    const next = `${urlTemplate.slice(0, start)}${insertion}${urlTemplate.slice(end)}`;
    setUrlTemplate(next);

    requestAnimationFrame(() => {
      input.focus();
      const nextPos = start + insertion.length;
      input.setSelectionRange(nextPos, nextPos);
    });
  }, [urlTemplate]);

  useEffect(() => {
    if (!shouldAutoSelectAppFromPaste) return;
    if (!applications.length) return;

    const matchedApplication = findBestApplicationForPastedQuickLink(urlTemplate, applications);
    if (matchedApplication?.path) {
      setSelectedAppPath(matchedApplication.path);
    }
    setShouldAutoSelectAppFromPaste(false);
  }, [applications, shouldAutoSelectAppFromPaste, urlTemplate]);

  const handlePlaceholderSelection = useCallback(async (item: PlaceholderGroupItem) => {
    if (!item.pickerType) {
      insertPlaceholder(item.value);
      setShowPlaceholderMenu(false);
      setSelectedPlaceholderIndex(-1);
      return;
    }

    try {
      const picked = await window.electron.pickFiles({
        allowMultipleSelection: false,
        canChooseFiles: true,
        canChooseDirectories: true,
      });
      const selectedPath = String(picked?.[0] || '').trim();
      if (selectedPath) {
        const fileUrl = toFileUrl(selectedPath);
        setUrlTemplate(fileUrl);
        requestAnimationFrame(() => {
          urlRef.current?.focus();
          const pos = fileUrl.length;
          urlRef.current?.setSelectionRange(pos, pos);
        });

        const stat = window.electron.statSync(selectedPath);
        if (stat?.isDirectory) {
          const finder = pickFinderApplication(applications);
          if (finder?.path) setSelectedAppPath(finder.path);
        } else if (stat?.isFile) {
          try {
            const defaultApp = await window.electron.getDefaultApplication(selectedPath);
            const matchingApp =
              applications.find((app) => app.path === defaultApp?.path) ||
              applications.find((app) => app.bundleId && defaultApp?.bundleId && app.bundleId === defaultApp.bundleId) ||
              applications.find((app) => app.name === defaultApp?.name);
            if (matchingApp?.path) {
              setSelectedAppPath(matchingApp.path);
            } else if (defaultApp?.path) {
              setSelectedAppPath(defaultApp.path);
            }
          } catch (error) {
            console.error('Failed to resolve default application for file:', error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to pick file/folder:', error);
    } finally {
      setShowPlaceholderMenu(false);
      setSelectedPlaceholderIndex(-1);
    }
  }, [applications, insertPlaceholder]);

  const handlePlaceholderMenuKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!showPlaceholderMenu) return;
    if (placeholderMenuItems.length === 0) return;

    const currentIndex = selectedPlaceholderIndex >= 0 ? selectedPlaceholderIndex : 0;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setSelectedPlaceholderIndex((prev) => Math.min((prev >= 0 ? prev : 0) + 1, placeholderMenuItems.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setSelectedPlaceholderIndex((prev) => Math.max((prev >= 0 ? prev : 0) - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const selectedItem = placeholderMenuItems[currentIndex];
      if (selectedItem) {
        void handlePlaceholderSelection(selectedItem);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setShowPlaceholderMenu(false);
      setSelectedPlaceholderIndex(-1);
      requestAnimationFrame(() => {
        urlRef.current?.focus();
      });
    }
  }, [handlePlaceholderSelection, placeholderMenuItems, selectedPlaceholderIndex, showPlaceholderMenu]);

  const commitApplicationSelection = useCallback((index: number) => {
    if (applicationMenuItems.length === 0) return;
    const bounded = Math.min(Math.max(index, 0), Math.max(0, applicationMenuItems.length - 1));
    const selectedEntry = applicationMenuItems[bounded];
    if (!selectedEntry) return;
    if (selectedEntry?.type === 'app' && selectedEntry.app?.path) {
      setSelectedAppPath(selectedEntry.app.path);
    } else {
      setSelectedAppPath('');
    }
    setShowApplicationMenu(false);
    requestAnimationFrame(() => {
      applicationButtonRef.current?.focus();
    });
  }, [applicationMenuItems]);

  const focusApplicationItem = useCallback((index: number) => {
    requestAnimationFrame(() => {
      const target = applicationItemRefs.current[index];
      if (!target) return;
      target.focus();
      target.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  const handleApplicationMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (!showApplicationMenu) return;
    if (applicationMenuItems.length === 0) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setShowApplicationMenu(false);
        requestAnimationFrame(() => {
          applicationButtonRef.current?.focus();
        });
      }
      return;
    }
    const maxIndex = Math.max(0, applicationMenuItems.length - 1);
    const currentIndex = Math.min(Math.max(selectedApplicationIndex >= 0 ? selectedApplicationIndex : 0, 0), maxIndex);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      const nextIndex = Math.min(currentIndex + 1, maxIndex);
      setSelectedApplicationIndex(nextIndex);
      focusApplicationItem(nextIndex);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const nextIndex = Math.max(currentIndex - 1, 0);
      setSelectedApplicationIndex(nextIndex);
      focusApplicationItem(nextIndex);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commitApplicationSelection(currentIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setShowApplicationMenu(false);
      requestAnimationFrame(() => {
        applicationButtonRef.current?.focus();
      });
    }
  }, [applicationMenuItems.length, commitApplicationSelection, focusApplicationItem, selectedApplicationIndex, showApplicationMenu]);

  const commitIconSelection = useCallback((index: number) => {
    if (visibleIconOptions.length === 0) return;
    const bounded = Math.min(Math.max(index, 0), Math.max(0, visibleIconOptions.length - 1));
    const selectedOption = visibleIconOptions[bounded];
    if (selectedOption) {
      setIcon(selectedOption.value as QuickLinkIcon);
    }
    setShowIconMenu(false);
    requestAnimationFrame(() => {
      iconButtonRef.current?.focus();
    });
  }, [visibleIconOptions]);

  const focusIconItem = useCallback((index: number) => {
    requestAnimationFrame(() => {
      const target = iconItemRefs.current[index];
      if (!target) return;
      target.focus();
      target.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  const handleIconMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (!showIconMenu) return;
    if (visibleIconOptions.length === 0) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setShowIconMenu(false);
        requestAnimationFrame(() => {
          iconButtonRef.current?.focus();
        });
      }
      return;
    }
    const maxIndex = Math.max(0, visibleIconOptions.length - 1);
    const currentIndex = Math.min(Math.max(selectedIconIndex >= 0 ? selectedIconIndex : 0, 0), maxIndex);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      const nextIndex = Math.min(currentIndex + 1, maxIndex);
      setSelectedIconIndex(nextIndex);
      focusIconItem(nextIndex);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const nextIndex = Math.max(currentIndex - 1, 0);
      setSelectedIconIndex(nextIndex);
      focusIconItem(nextIndex);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commitIconSelection(currentIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setShowIconMenu(false);
      requestAnimationFrame(() => {
        iconButtonRef.current?.focus();
      });
    }
  }, [commitIconSelection, focusIconItem, selectedIconIndex, showIconMenu, visibleIconOptions.length]);

  const submit = async () => {
    if (saving) return;
    const nextErrors: Record<string, string> = {};
    const trimmedName = name.trim();
    const trimmedTemplate = urlTemplate.trim();

    if (!trimmedName) {
      nextErrors.name = 'Name is required.';
    }
    if (!trimmedTemplate) {
      nextErrors.urlTemplate = 'URL is required.';
    } else if (!isLikelyUrlTemplate(trimmedTemplate)) {
      nextErrors.urlTemplate = 'Use a valid URL template (for example: https://example.com?q={clipboard}).';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: trimmedName,
        urlTemplate: trimmedTemplate,
        applicationName: selectedApp?.name,
        applicationPath: selectedApp?.path,
        applicationBundleId: selectedApp?.bundleId,
        appIconDataUrl,
        icon,
      });
      setErrors((prev) => ({ ...prev, form: '' }));
    } catch (error: any) {
      const message = String(error?.message || 'Failed to save quick link.').trim() || 'Failed to save quick link.';
      setErrors((prev) => ({ ...prev, form: message }));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!isMetaEnterKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      void submit();
    };

    window.addEventListener('keydown', onWindowKeyDown, true);
    return () => window.removeEventListener('keydown', onWindowKeyDown, true);
  }, [submit]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (isMetaEnterKey(event)) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (showPlaceholderMenu) {
        setShowPlaceholderMenu(false);
        setSelectedPlaceholderIndex(-1);
        return;
      }
      if (showApplicationMenu) {
        setShowApplicationMenu(false);
        return;
      }
      if (showIconMenu) {
        setShowIconMenu(false);
        return;
      }
      onCancel();
      return;
    }
  };

  return (
    <div className="snippet-view w-full h-full flex flex-col" onKeyDown={handleKeyDown}>
      <div className="snippet-header flex items-center gap-3 px-5 py-3.5">
        <button
          onClick={onCancel}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-white/90 text-[15px] font-light">
          {quickLink ? 'Edit Quick Link' : 'Create Quick Link'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5">
        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">Name</label>
          <div className="flex-1">
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setErrors((prev) => ({ ...prev, name: '' }));
              }}
              placeholder="Quick link name"
              className="w-full bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-white/90 text-[13px] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)] transition-colors"
            />
            {errors.name ? <p className="text-red-400 text-xs mt-1">{errors.name}</p> : null}
          </div>
        </div>

        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">Link</label>
          <div className="flex-1">
            <div className="relative">
              <input
                ref={urlRef}
                type="text"
                value={urlTemplate}
                onChange={(event) => {
                  setUrlTemplate(event.target.value);
                  setErrors((prev) => ({ ...prev, urlTemplate: '' }));
                }}
                onPaste={() => {
                  setShouldAutoSelectAppFromPaste(true);
                }}
                onKeyDown={(event) => {
                  if (showPlaceholderMenu) {
                    handlePlaceholderMenuKeyDown(event);
                    if (event.defaultPrevented) return;
                  }
                  if (event.key === '{' && !event.metaKey && !event.ctrlKey && !event.altKey) {
                    requestAnimationFrame(() => {
                      refreshPlaceholderMenuPos();
                      setSelectedPlaceholderIndex(0);
                      setShowPlaceholderMenu(true);
                    });
                  }
                }}
                placeholder="https://example.com/search?q={clipboard}"
                className="w-full bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 pr-10 text-white/90 text-[13px] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)] transition-colors"
              />
              <button
                ref={placeholderButtonRef}
                type="button"
                onClick={() => {
                  refreshPlaceholderMenuPos();
                  if (showPlaceholderMenu) {
                    setShowPlaceholderMenu(false);
                    setSelectedPlaceholderIndex(-1);
                    return;
                  }
                  setSelectedPlaceholderIndex(0);
                  setShowPlaceholderMenu(true);
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2 rounded-md border border-[rgba(124,136,154,0.24)] bg-white/[0.04] text-white/60 hover:text-white/80 hover:bg-white/[0.08] transition-colors"
                title="Add dynamic placeholder"
              >
                <Variable className="w-3.5 h-3.5" />
              </button>
            </div>
            {errors.urlTemplate ? <p className="text-red-400 text-xs mt-1">{errors.urlTemplate}</p> : null}
            <p className="text-white/25 text-xs mt-2">
              You can add <strong className="text-white/45">{'{Custom Arguments}'}</strong> to add dynamic values like custom arguments, clipboard text, and time.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">Open With</label>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md border border-[var(--snippet-divider)] bg-white/[0.04] flex items-center justify-center overflow-hidden">
                <QuickLinkIconPreview icon="default" appIconDataUrl={selectedAppResolvedIconDataUrl} />
              </div>
              <button
                ref={applicationButtonRef}
                type="button"
                onClick={() => {
                  refreshApplicationMenuPos();
                  setApplicationQuery('');
                  setShowApplicationMenu((prev) => {
                    const next = !prev;
                    if (next) {
                      setSelectedApplicationIndex(0);
                    }
                    return next;
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    refreshApplicationMenuPos();
                    setApplicationQuery('');
                    setSelectedApplicationIndex(0);
                    setShowApplicationMenu(true);
                    return;
                  }
                  if (event.key === 'Escape' && showApplicationMenu) {
                    event.preventDefault();
                    setShowApplicationMenu(false);
                  }
                }}
                className="flex-1 bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-white/90 text-[13px] outline-none hover:border-[var(--snippet-divider-strong)] transition-colors text-left flex items-center justify-between gap-2"
              >
                <span className="min-w-0 flex items-center gap-2">
                  <span className="w-4 h-4 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {selectedAppPath && selectedAppResolvedIconDataUrl ? (
                      <img src={selectedAppResolvedIconDataUrl} alt="" className="w-4 h-4 object-contain" draggable={false} />
                    ) : (
                      <Globe className="w-3.5 h-3.5 text-white/65" />
                    )}
                  </span>
                  <span className="truncate">{selectedAppName}</span>
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">Icon</label>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md border border-[var(--snippet-divider)] bg-white/[0.04] flex items-center justify-center overflow-hidden">
                <QuickLinkIconPreview icon={icon} appIconDataUrl={selectedAppResolvedIconDataUrl} />
              </div>
              <button
                ref={iconButtonRef}
                type="button"
                onClick={(event) => {
                  const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  refreshIconMenuPos(rect);
                  setShowIconMenu((prev) => {
                    const next = !prev;
                    if (next) {
                      setSelectedIconIndex(0);
                    }
                    return next;
                  });
                  setIconQuery('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    refreshIconMenuPos();
                    setIconQuery('');
                    setSelectedIconIndex(0);
                    setShowIconMenu(true);
                    return;
                  }
                  if (event.key === 'Escape' && showIconMenu) {
                    event.preventDefault();
                    setShowIconMenu(false);
                  }
                }}
                className="flex-1 bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-white/90 text-[13px] outline-none hover:border-[var(--snippet-divider-strong)] transition-colors text-left flex items-center justify-between gap-2"
              >
                <span className="min-w-0 flex items-center gap-2">
                  <QuickLinkIconPreview icon={icon} appIconDataUrl={selectedAppResolvedIconDataUrl} />
                  <span className="truncate">{selectedIconOption.label}</span>
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="sc-glass-footer flex items-center px-4 py-2.5">
        <div className="flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-normal">
          <span className="truncate">{errors.form || (quickLink ? 'Edit Quick Link' : 'Create Quick Link')}</span>
        </div>
        <button
          onClick={() => void submit()}
          disabled={saving}
          className="flex items-center gap-1.5 text-[var(--text-primary)] hover:text-[var(--text-secondary)] disabled:text-[var(--text-disabled)] transition-colors cursor-pointer"
        >
          <span className="text-xs font-normal">{saving ? 'Saving...' : 'Save Quick Link'}</span>
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">⌘</kbd>
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">↩</kbd>
        </button>
      </div>

      {showApplicationMenu && createPortal(
        <div
          id="quicklink-application-menu"
          className="fixed z-[120] rounded-lg overflow-hidden sc-dropdown-surface"
          onKeyDown={handleApplicationMenuKeyDown}
          style={{
            top: applicationMenuPos.top,
            left: applicationMenuPos.left,
            width: applicationMenuPos.width,
          }}
        >
          <div className="px-2 py-1.5 border-b sc-dropdown-divider">
            <input
              ref={applicationSearchRef}
              type="text"
              value={applicationQuery}
              onChange={(event) => setApplicationQuery(event.target.value)}
              onKeyDown={handleApplicationMenuKeyDown}
              placeholder="Search applications..."
              className="w-full px-1.5 py-1 bg-transparent text-[13px] text-white/75 placeholder:text-[color:var(--text-subtle)] outline-none"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto py-1" style={{ maxHeight: Math.min(applicationMenuPos.maxHeight, 180) }}>
            {applicationMenuItems.map((entry, index) => {
              const app = entry.type === 'app' ? entry.app : null;
              const iconDataUrl = app ? (applicationIcons[app.path] || app.iconDataUrl) : null;
              const isSelectedChoice = app ? selectedAppPath === app.path : !selectedAppPath;
              const isHighlighted = selectedApplicationIndex === index;
              return (
                <button
                  key={app?.path || '__default_browser__'}
                  type="button"
                  ref={(el) => {
                    applicationItemRefs.current[index] = el;
                  }}
                  tabIndex={isHighlighted ? 0 : -1}
                  onFocus={() => setSelectedApplicationIndex(index)}
                  onMouseMove={() => setSelectedApplicationIndex(index)}
                  onKeyDown={handleApplicationMenuKeyDown}
                  onClick={() => commitApplicationSelection(index)}
                  className="sc-dropdown-item w-full text-left px-2.5 py-1.5 text-[13px] text-white/85 flex items-center gap-2 outline-none focus-visible:outline-none"
                  aria-selected={isHighlighted}
                >
                  <span className="w-4 h-4 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {iconDataUrl ? (
                      <img src={iconDataUrl} alt="" className="w-4 h-4 object-contain" draggable={false} />
                    ) : (
                      <Globe className="w-3.5 h-3.5 text-white/65" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{app?.name || 'Default Browser'}</span>
                  {isSelectedChoice ? <Check className="w-3.5 h-3.5 text-white/65 flex-shrink-0" /> : null}
                </button>
              );
            })}
            {applicationMenuItems.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-white/35">No applications found</div>
            ) : null}
          </div>
        </div>,
        document.body
      )}

      {showIconMenu && createPortal(
        <div
          id="quicklink-icon-menu"
          className="fixed z-[120] rounded-lg overflow-hidden sc-dropdown-surface"
          onKeyDown={handleIconMenuKeyDown}
          style={{
            top: iconMenuPos.top,
            left: iconMenuPos.left,
            width: iconMenuPos.width,
          }}
        >
          <div className="px-2 py-1.5 border-b sc-dropdown-divider">
            <input
              ref={iconSearchRef}
              type="text"
              value={iconQuery}
              onChange={(event) => setIconQuery(event.target.value)}
              onKeyDown={handleIconMenuKeyDown}
              placeholder="Search icons..."
              className="w-full px-1.5 py-1 bg-transparent text-[13px] text-white/75 placeholder:text-[color:var(--text-subtle)] outline-none"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto py-1" style={{ maxHeight: Math.min(iconMenuPos.maxHeight, 136) }}>
            {visibleIconOptions.map((option, index) => {
              const isSelected = icon === option.value;
              const isHighlighted = selectedIconIndex === index;
              return (
                <button
                  key={option.value}
                  type="button"
                  ref={(el) => {
                    iconItemRefs.current[index] = el;
                  }}
                  tabIndex={isHighlighted ? 0 : -1}
                  onFocus={() => setSelectedIconIndex(index)}
                  onMouseMove={() => setSelectedIconIndex(index)}
                  onKeyDown={handleIconMenuKeyDown}
                  onClick={() => commitIconSelection(index)}
                  className="sc-dropdown-item w-full text-left px-2.5 py-1.5 text-[13px] text-white/85 flex items-center gap-2 outline-none focus-visible:outline-none"
                  aria-selected={isHighlighted}
                >
                  <span className="w-4 h-4 flex items-center justify-center overflow-hidden flex-shrink-0">
                    <QuickLinkIconPreview icon={option.value} appIconDataUrl={selectedAppResolvedIconDataUrl} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected ? <Check className="w-3.5 h-3.5 text-white/65 flex-shrink-0" /> : null}
                </button>
              );
            })}
            {filteredIconOptions.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-white/35">No icons found</div>
            ) : null}
            {filteredIconOptions.length > visibleIconOptions.length ? (
              <div className="px-2.5 py-2 text-[11px] text-white/35 border-t sc-dropdown-divider">
                {iconQuery.trim()
                  ? `Showing top ${MAX_VISIBLE_ICON_RESULTS} results. Refine search to narrow more.`
                  : `Showing ${MAX_VISIBLE_ICON_RESULTS} icons. Search to find more.`}
              </div>
            ) : null}
          </div>
        </div>,
        document.body
      )}

      {showPlaceholderMenu && createPortal(
        <div
          id="quicklink-placeholder-menu"
          className="fixed z-[120] rounded-lg overflow-hidden sc-dropdown-surface"
          onKeyDown={handlePlaceholderMenuKeyDown}
          style={{
            top: placeholderMenuPos.top,
            left: placeholderMenuPos.left,
            width: placeholderMenuPos.width,
          }}
        >
          <div className="overflow-y-auto py-1" style={{ maxHeight: Math.min(placeholderMenuPos.maxHeight, 136) }}>
            {indexedPlaceholderGroups.map((group) => (
              <div key={group.title} className="mb-1">
                <div className="px-2.5 py-1 text-[11px] uppercase tracking-wider text-white/30">{group.title}</div>
                {group.items.map(({ item, index }) => {
                  const Icon = item.icon;
                  const isSelected = selectedPlaceholderIndex === index;
                  return (
                    <button
                      key={`${group.title}-${index}-${item.value}`}
                      type="button"
                      ref={(el) => {
                        placeholderItemRefs.current[index] = el;
                      }}
                      tabIndex={isSelected ? 0 : -1}
                      aria-selected={isSelected}
                      onFocus={() => setSelectedPlaceholderIndex(index)}
                      onClick={() => void handlePlaceholderSelection(item)}
                      className={`sc-dropdown-item w-full text-left px-2.5 py-1 text-[13px] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 ${
                        isSelected ? 'text-white/90' : 'text-white/80'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {Icon ? <Icon className="w-3.5 h-3.5 text-white/45" /> : null}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </span>
                      {item.subtitle ? (
                        <div className="pl-5 text-[11px] text-white/35 truncate">{item.subtitle}</div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
            {placeholderGroups.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-white/35">No placeholders found</div>
            ) : null}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const QuickLinkManager: React.FC<QuickLinkManagerProps> = ({ onClose, initialView }) => {
  const [view, setView] = useState<'search' | 'create' | 'edit'>(initialView);
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>([]);
  const [filteredQuickLinks, setFilteredQuickLinks] = useState<QuickLink[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [quickLinkDynamicFieldsById, setQuickLinkDynamicFieldsById] = useState<Record<string, QuickLinkDynamicField[]>>({});
  const [inlineDynamicValuesByQuickLinkId, setInlineDynamicValuesByQuickLinkId] = useState<
    Record<string, Record<string, string>>
  >({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [editingQuickLink, setEditingQuickLink] = useState<QuickLink | undefined>(undefined);
  const [dynamicPrompt, setDynamicPrompt] = useState<{
    quickLink: QuickLink;
    fields: QuickLinkDynamicField[];
    values: Record<string, string>;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const inlineArgumentLaneRef = useRef<HTMLDivElement>(null);
  const inlineArgumentClusterRef = useRef<HTMLDivElement>(null);
  const inlineDynamicInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const firstDynamicInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const actionsOverlayRef = useRef<HTMLDivElement>(null);

  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass =
    document.documentElement.classList.contains('sc-native-liquid-glass') ||
    document.body.classList.contains('sc-native-liquid-glass');

  const loadQuickLinks = useCallback(async () => {
    setIsLoading(true);
    try {
      const all = await window.electron.quickLinkGetAll();
      setQuickLinks(Array.isArray(all) ? all : []);
    } catch (error) {
      console.error('Failed to load quick links:', error);
      setQuickLinks([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuickLinks();
    if (view === 'search') {
      inputRef.current?.focus();
    }
  }, [loadQuickLinks, view]);

  useEffect(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) {
      setFilteredQuickLinks(quickLinks);
      setSelectedIndex(0);
      return;
    }

    const filtered = quickLinks.filter((quickLink) => {
      return (
        quickLink.name.toLowerCase().includes(normalized) ||
        quickLink.urlTemplate.toLowerCase().includes(normalized) ||
        String(quickLink.applicationName || '').toLowerCase().includes(normalized)
      );
    });
    setFilteredQuickLinks(filtered);
    setSelectedIndex(0);
  }, [quickLinks, searchQuery]);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, filteredQuickLinks.length);
  }, [filteredQuickLinks.length]);

  const focusActionsOverlay = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
      active.blur();
    }
    actionsOverlayRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!showActions) return;
    setSelectedActionIndex(0);
    const timer = window.setTimeout(() => {
      focusActionsOverlay();
      requestAnimationFrame(() => {
        focusActionsOverlay();
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusActionsOverlay, showActions]);

  const scrollToSelected = useCallback(() => {
    const selectedElement = itemRefs.current[selectedIndex];
    const scrollContainer = listRef.current;

    if (selectedElement && scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elementRect = selectedElement.getBoundingClientRect();

      if (elementRect.top < containerRect.top) {
        selectedElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (elementRect.bottom > containerRect.bottom) {
        selectedElement.scrollIntoView({ block: 'end', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  useEffect(() => {
    scrollToSelected();
  }, [scrollToSelected]);

  const selectedQuickLink = filteredQuickLinks[selectedIndex];
  const selectedQuickLinkDynamicFields = selectedQuickLink
    ? quickLinkDynamicFieldsById[selectedQuickLink.id] || []
    : [];
  const selectedInlineDynamicFields = selectedQuickLinkDynamicFields.slice(0, MAX_INLINE_QUICK_LINK_ARGUMENTS);
  const hasInlineDynamicFields = selectedInlineDynamicFields.length > 0;
  const selectedHasOverflowDynamicFields = selectedQuickLinkDynamicFields.length > selectedInlineDynamicFields.length;
  const selectedInlineDynamicValues = selectedQuickLink
    ? inlineDynamicValuesByQuickLinkId[selectedQuickLink.id] || {}
    : {};
  const selectedInlineLeadingIcon = useMemo(() => {
    if (!hasInlineDynamicFields || !selectedQuickLink) return null;
    return (
      <QuickLinkIconPreview
        icon={selectedQuickLink.icon}
        appIconDataUrl={selectedQuickLink.appIconDataUrl}
      />
    );
  }, [hasInlineDynamicFields, selectedQuickLink]);
  const inlineArgumentStartPx = useInlineArgumentAnchor({
    enabled: hasInlineDynamicFields,
    query: searchQuery,
    searchInputRef: inputRef,
    laneRef: inlineArgumentLaneRef,
    inlineRef: inlineArgumentClusterRef,
    minStartRatio: 0.3,
  });

  const getDynamicFieldsForQuickLink = useCallback(
    async (quickLinkId: string): Promise<QuickLinkDynamicField[]> => {
      const normalizedId = String(quickLinkId || '').trim();
      if (!normalizedId) return [];
      const cached = quickLinkDynamicFieldsById[normalizedId];
      if (cached) return cached;
      try {
        const fetched = await window.electron.quickLinkGetDynamicFields(normalizedId);
        const normalizedFields = normalizeQuickLinkDynamicFields(Array.isArray(fetched) ? fetched : []);
        setQuickLinkDynamicFieldsById((prev) => ({
          ...prev,
          [normalizedId]: normalizedFields,
        }));
        return normalizedFields;
      } catch (error) {
        console.error('Failed to load quick link dynamic fields:', error);
        return [];
      }
    },
    [quickLinkDynamicFieldsById]
  );

  const getResolvedDynamicValues = useCallback(
    (quickLink: QuickLink, fields: QuickLinkDynamicField[]) => {
      const values = inlineDynamicValuesByQuickLinkId[quickLink.id] || {};
      return fields.reduce((acc, field) => {
        const key = String(field.key || '').trim();
        if (!key) return acc;
        acc[key] = String(values[key] ?? field.defaultValue ?? '');
        return acc;
      }, {} as Record<string, string>);
    },
    [inlineDynamicValuesByQuickLinkId]
  );

  useEffect(() => {
    if (!selectedQuickLink) return;
    void getDynamicFieldsForQuickLink(selectedQuickLink.id);
  }, [getDynamicFieldsForQuickLink, selectedQuickLink]);

  useEffect(() => {
    if (!selectedQuickLink || selectedQuickLinkDynamicFields.length === 0) return;
    setInlineDynamicValuesByQuickLinkId((prev) => {
      const existing = prev[selectedQuickLink.id] || {};
      let changed = !prev[selectedQuickLink.id];
      const nextValues = { ...existing };
      for (const field of selectedQuickLinkDynamicFields) {
        const key = String(field.key || '').trim();
        if (!key || nextValues[key] !== undefined) continue;
        nextValues[key] = String(field.defaultValue || '');
        changed = true;
      }
      if (!changed) return prev;
      return {
        ...prev,
        [selectedQuickLink.id]: nextValues,
      };
    });
  }, [selectedQuickLink, selectedQuickLinkDynamicFields]);

  useEffect(() => {
    inlineDynamicInputRefs.current = inlineDynamicInputRefs.current.slice(0, selectedInlineDynamicFields.length);
  }, [selectedInlineDynamicFields.length]);

  useEffect(() => {
    if (!dynamicPrompt) return;
    const timer = window.setTimeout(() => {
      firstDynamicInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dynamicPrompt?.quickLink.id]);

  const handleConfirmDynamicPrompt = useCallback(async () => {
    if (!dynamicPrompt) return;
    try {
      const opened = await window.electron.quickLinkOpen(dynamicPrompt.quickLink.id, dynamicPrompt.values);
      if (opened) {
        setDynamicPrompt(null);
        await window.electron.hideWindow();
      }
    } catch (error) {
      console.error('Failed to open quick link with dynamic values:', error);
    }
  }, [dynamicPrompt]);

  const handleOpen = useCallback(async (quickLink?: QuickLink) => {
    const target = quickLink || selectedQuickLink;
    if (!target) return;
    try {
      const fields = await getDynamicFieldsForQuickLink(target.id);
      if (fields.length > 0) {
        const resolvedValues = getResolvedDynamicValues(target, fields);
        if (selectedQuickLink && selectedQuickLink.id === target.id && selectedInlineDynamicFields.length > 0) {
          selectedInlineDynamicFields.forEach((field, index) => {
            const liveValue = inlineDynamicInputRefs.current[index]?.value;
            if (liveValue !== undefined) {
              resolvedValues[field.key] = liveValue;
            }
          });
        }
        if (fields.length <= MAX_INLINE_QUICK_LINK_ARGUMENTS) {
          const opened = await window.electron.quickLinkOpen(target.id, resolvedValues);
          if (opened) {
            await window.electron.hideWindow();
          }
          return;
        }
        setDynamicPrompt({
          quickLink: target,
          fields,
          values: resolvedValues,
        });
        return;
      }

      const opened = await window.electron.quickLinkOpen(target.id);
      if (opened) {
        await window.electron.hideWindow();
      }
    } catch (error) {
      console.error('Failed to open quick link:', error);
    }
  }, [getDynamicFieldsForQuickLink, getResolvedDynamicValues, selectedInlineDynamicFields, selectedQuickLink]);

  const handleEdit = useCallback(() => {
    if (!selectedQuickLink) return;
    setEditingQuickLink(selectedQuickLink);
    setView('edit');
  }, [selectedQuickLink]);

  const handleDelete = useCallback(async () => {
    if (!selectedQuickLink) return;
    try {
      await window.electron.quickLinkDelete(selectedQuickLink.id);
      await loadQuickLinks();
      setSearchQuery('');
    } catch (error) {
      console.error('Failed to delete quick link:', error);
    }
  }, [loadQuickLinks, selectedQuickLink]);

  const handleDuplicate = useCallback(async () => {
    if (!selectedQuickLink) return;
    try {
      await window.electron.quickLinkDuplicate(selectedQuickLink.id);
      await loadQuickLinks();
    } catch (error) {
      console.error('Failed to duplicate quick link:', error);
    }
  }, [loadQuickLinks, selectedQuickLink]);

  const handleSave = useCallback(async (payload: QuickLinkPayload) => {
    try {
      if (view === 'edit' && editingQuickLink) {
        await window.electron.quickLinkUpdate(editingQuickLink.id, payload);
      } else {
        await window.electron.quickLinkCreate(payload);
      }
      await loadQuickLinks();
      setEditingQuickLink(undefined);
      setView('search');
      setTimeout(() => inputRef.current?.focus(), 40);
    } catch (error: any) {
      console.error('Failed to save quick link:', error);
      throw error;
    }
  }, [editingQuickLink, loadQuickLinks, view]);

  const actions = useMemo(() => {
    const list: Array<{
      title: string;
      execute: () => void | Promise<void>;
      icon?: React.ReactNode;
      shortcut?: string[];
      style?: 'default' | 'destructive';
    }> = [
      {
        title: 'Open Quick Link',
        execute: () => handleOpen(),
        icon: <ExternalLink className="w-4 h-4" />,
        shortcut: ['↩'],
      },
      {
        title: 'Create Quick Link',
        execute: () => {
          setEditingQuickLink(undefined);
          setView('create');
        },
        icon: <Plus className="w-4 h-4" />,
        shortcut: ['⌘', 'N'],
      },
      {
        title: 'Edit Quick Link',
        execute: handleEdit,
        icon: <Pencil className="w-4 h-4" />,
        shortcut: ['⌘', 'E'],
      },
      {
        title: 'Duplicate Quick Link',
        execute: handleDuplicate,
        icon: <Files className="w-4 h-4" />,
        shortcut: ['⌘', 'D'],
      },
      {
        title: 'Delete Quick Link',
        execute: handleDelete,
        icon: <Trash2 className="w-4 h-4" />,
        shortcut: ['⌃', 'X'],
        style: 'destructive',
      },
    ];

    return list;
  }, [handleDelete, handleDuplicate, handleEdit, handleOpen]);

  const isMetaEnter = (event: React.KeyboardEvent) =>
    event.metaKey &&
    (event.key === 'Enter' || event.key === 'Return' || event.code === 'Enter' || event.code === 'NumpadEnter');

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'k' && event.metaKey && !event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      setShowActions((prev) => {
        const next = !prev;
        if (next) {
          const active = document.activeElement as HTMLElement | null;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
            active.blur();
          }
        }
        return next;
      });
      return;
    }

    if (dynamicPrompt) {
      const plainEnter =
        (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey;
      if (event.key === 'Escape') {
        event.preventDefault();
        setDynamicPrompt(null);
        return;
      }
      if (plainEnter || (event.key === 'Enter' && event.metaKey)) {
        event.preventDefault();
        void handleConfirmDynamicPrompt();
        return;
      }
    }

    if (showActions) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedActionIndex((prev) => (prev < actions.length - 1 ? prev + 1 : prev));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedActionIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const action = actions[selectedActionIndex];
        if (action) {
          void Promise.resolve(action.execute());
        }
        setShowActions(false);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowActions(false);
        return;
      }
    }

    if (event.key.toLowerCase() === 'n' && event.metaKey) {
      event.preventDefault();
      setEditingQuickLink(undefined);
      setView('create');
      return;
    }
    if (event.key.toLowerCase() === 'e' && event.metaKey) {
      event.preventDefault();
      handleEdit();
      return;
    }
    if (event.key.toLowerCase() === 'd' && event.metaKey) {
      event.preventDefault();
      void handleDuplicate();
      return;
    }
    if (event.key.toLowerCase() === 'x' && event.ctrlKey) {
      event.preventDefault();
      void handleDelete();
      return;
    }
    if (isMetaEnter(event)) {
      event.preventDefault();
      void handleOpen();
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex((prev) => (prev < filteredQuickLinks.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (!event.repeat) {
          void handleOpen();
        }
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
    }
  }, [actions, dynamicPrompt, filteredQuickLinks.length, handleConfirmDynamicPrompt, handleDelete, handleDuplicate, handleEdit, handleOpen, onClose, selectedActionIndex, showActions]);

  if (view === 'create' || view === 'edit') {
    return (
      <QuickLinkForm
        quickLink={view === 'edit' ? editingQuickLink : undefined}
        onSave={handleSave}
        onCancel={() => {
          setEditingQuickLink(undefined);
          setView('search');
          setTimeout(() => inputRef.current?.focus(), 40);
        }}
      />
    );
  }

  return (
    <div className="snippet-view w-full h-full flex flex-col" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="snippet-header flex h-16 items-center gap-2 px-4">
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div ref={inlineArgumentLaneRef} className="relative min-w-0 flex-1">
          <div className="flex h-full items-center">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search quick links..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Tab' && hasInlineDynamicFields) {
                  event.preventDefault();
                  const targetIndex = event.shiftKey ? selectedInlineDynamicFields.length - 1 : 0;
                  inlineDynamicInputRefs.current[targetIndex]?.focus();
                }
              }}
              className="min-w-0 w-full bg-transparent border-none outline-none text-white/95 placeholder:text-[color:var(--text-subtle)] text-[15px] font-medium tracking-[0.005em]"
              autoFocus
            />
          </div>
          {hasInlineDynamicFields ? (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-x-hidden overflow-y-visible">
              <div
                ref={inlineArgumentClusterRef}
                className="pointer-events-auto inline-flex min-w-0 items-center gap-1"
                style={{ marginLeft: inlineArgumentStartPx != null ? `${inlineArgumentStartPx}px` : '30%' }}
              >
                {selectedInlineLeadingIcon ? (
                  <InlineArgumentLeadingIcon>{selectedInlineLeadingIcon}</InlineArgumentLeadingIcon>
                ) : null}
                {selectedInlineDynamicFields.map((field, index) => (
                  <InlineArgumentField
                    key={`quicklink-inline-arg-${selectedQuickLink?.id || 'none'}-${field.key}`}
                    inputRef={(el) => {
                      inlineDynamicInputRefs.current[index] = el;
                    }}
                    value={selectedInlineDynamicValues[field.key] || ''}
                    onChange={(nextValue) => {
                      if (!selectedQuickLink) return;
                      setInlineDynamicValuesByQuickLinkId((prev) => ({
                        ...prev,
                        [selectedQuickLink.id]: {
                          ...(prev[selectedQuickLink.id] || {}),
                          [field.key]: nextValue,
                        },
                      }));
                    }}
                    onKeyDown={(event) => {
                      if (showActions) {
                        return;
                      }
                      if (event.key === 'Tab') {
                        event.preventDefault();
                        event.stopPropagation();
                        const total = selectedInlineDynamicFields.length;
                        const nextIndex = event.shiftKey ? index - 1 : index + 1;
                        if (nextIndex >= 0 && nextIndex < total) {
                          inlineDynamicInputRefs.current[nextIndex]?.focus();
                        } else {
                          inputRef.current?.focus();
                        }
                        return;
                      }
                      if (
                        (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !event.altKey &&
                        !event.shiftKey
                      ) {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleOpen();
                        return;
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        inputRef.current?.focus();
                        return;
                      }
                      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
                        event.stopPropagation();
                      }
                    }}
                    placeholder={field.defaultValue || field.name}
                  />
                ))}
                {selectedHasOverflowDynamicFields ? (
                  <InlineArgumentOverflowBadge
                    count={selectedQuickLinkDynamicFields.length - selectedInlineDynamicFields.length}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {searchQuery ? (
            <button
              onClick={() => setSearchQuery('')}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
              aria-label="Clear"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
          <button
            onClick={() => {
              setEditingQuickLink(undefined);
              setView('create');
            }}
            className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
            title="Create Quick Link"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div ref={listRef} className="snippet-split w-[40%] overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Loading quick links...</p>
            </div>
          ) : filteredQuickLinks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/50 gap-3">
              <p className="text-sm">{searchQuery ? 'No quick links found' : 'No quick links yet'}</p>
              {!searchQuery ? (
                <button
                  onClick={() => {
                    setEditingQuickLink(undefined);
                    setView('create');
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-white/[0.08] text-white/60 hover:bg-white/[0.12] hover:text-white/80 transition-colors"
                >
                  Create your first quick link
                </button>
              ) : null}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredQuickLinks.map((quickLink, index) => (
                <div
                  key={quickLink.id}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  className={`px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? 'bg-[var(--launcher-card-selected-bg)] border-[var(--launcher-card-border)]'
                      : 'border-transparent hover:bg-[var(--launcher-card-hover-bg)] hover:border-[var(--launcher-card-border)]'
                  }`}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => void handleOpen(quickLink)}
                >
                  <div className="flex items-start gap-2">
                    <div className="w-4 h-4 mt-0.5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      <QuickLinkIconPreview icon={quickLink.icon} appIconDataUrl={quickLink.appIconDataUrl} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white/80 text-[13px] truncate font-medium leading-tight">{quickLink.name}</div>
                      <div className="text-white/35 text-[11px] truncate mt-0.5 leading-tight">
                        {quickLink.applicationName || 'Default Browser'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {selectedQuickLink ? (
            <div className="p-5 space-y-4">
              <div className="rounded-lg border border-[var(--snippet-divider)] bg-white/[0.03] px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-white/35 mb-1">URL Template</div>
                <div className="text-sm text-white/85 break-all font-mono">{selectedQuickLink.urlTemplate}</div>
              </div>

              <div className="pt-1 space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Open With</span>
                  <span className="text-white/65 text-right truncate">
                    {selectedQuickLink.applicationName || 'Default Browser'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Icon</span>
                  <span className="text-white/65 text-right truncate">
                    {getQuickLinkIconLabel(selectedQuickLink.icon)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Updated</span>
                  <span className="text-white/65 text-right truncate">{formatDate(selectedQuickLink.updatedAt)}</span>
                </div>
              </div>

              {selectedQuickLink.urlTemplate.match(/\{[^}]+\}/g)?.length ? (
                <div className="pt-2 border-t border-[var(--snippet-divider)]">
                  <div className="text-[11px] uppercase tracking-wider text-white/35 mb-2">Placeholders</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedQuickLink.urlTemplate.match(/\{[^}]+\}/g) || []).map((token, idx) => (
                      <span
                        key={`${selectedQuickLink.id}-${token}-${idx}`}
                        className="px-1.5 py-0.5 rounded bg-white/[0.07] text-white/55 text-[11px] font-mono"
                      >
                        {token}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Select a quick link to preview</p>
            </div>
          )}
        </div>
      </div>

      <ExtensionActionFooter
        leftContent={<span className="truncate">{filteredQuickLinks.length} quick links</span>}
        primaryAction={
          selectedQuickLink
            ? {
                label: 'Open Quick Link',
                onClick: () => handleOpen(),
                shortcut: ['↩'],
              }
            : undefined
        }
        actionsButton={{
          label: 'Actions',
          onClick: () => setShowActions(true),
          shortcut: ['⌘', 'K'],
        }}
      />

      {dynamicPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(var(--backdrop-rgb), 0.25)' }}>
          <div
            className="w-[520px] max-w-[92vw] rounded-xl overflow-hidden"
            style={
              isGlassyTheme
                ? {
                    background: 'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                    backdropFilter: 'blur(96px) saturate(190%)',
                    WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.08)',
                  }
                : {
                    background: 'var(--bg-overlay-strong)',
                    backdropFilter: 'blur(28px)',
                    WebkitBackdropFilter: 'blur(28px)',
                    border: '1px solid var(--snippet-divider)',
                  }
            }
          >
            <div className="px-4 py-3 border-b border-[var(--snippet-divider)] text-white/85 text-sm font-medium">
              Fill Dynamic Values
            </div>
            <div className="p-4 space-y-3">
              {dynamicPrompt.fields.map((field, index) => (
                <div key={field.key}>
                  <label className="block text-xs text-white/45 mb-1.5">{field.name}</label>
                  <input
                    ref={index === 0 ? firstDynamicInputRef : undefined}
                    type="text"
                    value={dynamicPrompt.values[field.key] || ''}
                    onChange={(event) =>
                      setDynamicPrompt((prev) =>
                        prev
                          ? {
                              ...prev,
                              values: {
                                ...prev.values,
                                [field.key]: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    placeholder={field.defaultValue || ''}
                    className="w-full bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-[13px] text-white/85 placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)]"
                  />
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-[var(--snippet-divider)] flex items-center justify-end gap-2">
              <button
                onClick={() => setDynamicPrompt(null)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--snippet-divider)] bg-white/[0.03] text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/[0.08] transition-colors"
              >
                <span>Cancel</span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">Esc</kbd>
              </button>
              <button
                onClick={() => void handleConfirmDynamicPrompt()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--snippet-divider-strong)] bg-white/[0.14] text-xs text-[var(--text-primary)] hover:bg-white/[0.2] transition-colors"
              >
                <span>Open</span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">↩</kbd>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showActions ? (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setShowActions(false)}
          style={{ background: 'var(--bg-scrim)' }}
        >
          <div
            ref={actionsOverlayRef}
            className="absolute bottom-12 right-3 w-80 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0"
            tabIndex={0}
            style={
              isNativeLiquidGlass
                ? {
                    background: 'rgba(var(--surface-base-rgb), 0.72)',
                    backdropFilter: 'blur(44px) saturate(155%)',
                    WebkitBackdropFilter: 'blur(44px) saturate(155%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
                    boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26)',
                  }
                : isGlassyTheme
                ? {
                    background: 'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                    backdropFilter: 'blur(96px) saturate(190%)',
                    WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.05)',
                  }
                : {
                    background: 'var(--card-bg)',
                    backdropFilter: 'blur(40px)',
                    WebkitBackdropFilter: 'blur(40px)',
                    border: '1px solid var(--border-primary)',
                  }
            }
            onFocus={(e) => {
              (e.currentTarget as HTMLDivElement).style.outline = 'none';
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto py-1">
              {actions.map((action, index) => (
                <div
                  key={`${action.title}-${index}`}
                  className={`mx-1 px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-2.5 cursor-pointer transition-colors ${
                    index === selectedActionIndex
                      ? action.style === 'destructive'
                        ? 'bg-[var(--action-menu-selected-bg)] text-[var(--status-danger-faded)]'
                        : 'bg-[var(--action-menu-selected-bg)] text-[var(--text-primary)]'
                      : ''
                  } ${
                    action.style === 'destructive'
                      ? 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--status-danger-faded)]'
                      : 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--text-secondary)]'
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
                  onMouseMove={() => setSelectedActionIndex(index)}
                  onClick={() => {
                    void Promise.resolve(action.execute());
                    setShowActions(false);
                  }}
                >
                  {action.icon ? (
                    <span className={action.style === 'destructive' ? 'text-[var(--status-danger-faded)]' : 'text-[var(--text-muted)]'}>
                      {action.icon}
                    </span>
                  ) : null}
                  <span className="flex-1 text-sm truncate">
                    {action.title}
                  </span>
                  {action.shortcut ? (
                    <span className="flex items-center gap-0.5">
                      {action.shortcut.map((key, keyIdx) => (
                        <kbd
                          key={`${index}-${key}-${keyIdx}`}
                          className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] font-medium text-[var(--text-muted)]"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default QuickLinkManager;
