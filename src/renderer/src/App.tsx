/**
 * Launcher App
 * 
 * Dynamically displays all applications and System Settings.
 * Shows category labels like Raycast.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, Power, Settings, Puzzle, Sparkles, ArrowRight, Clipboard, FileText } from 'lucide-react';
import type { CommandInfo, ExtensionBundle, AppSettings } from '../types/electron';
import ExtensionView from './ExtensionView';
import ClipboardManager from './ClipboardManager';
import SnippetManager from './SnippetManager';
import OnboardingExtension from './OnboardingExtension';
import FileSearchExtension from './FileSearchExtension';
import { tryCalculate } from './smart-calculator';

interface LauncherAction {
  id: string;
  title: string;
  shortcut?: string;
  style?: 'default' | 'destructive';
  enabled?: boolean;
  execute: () => void | Promise<void>;
}

/**
 * Filter and sort commands based on search query
 */
function filterCommands(commands: CommandInfo[], query: string): CommandInfo[] {
  if (!query.trim()) {
    return commands;
  }

  const lowerQuery = query.toLowerCase().trim();

  const scored = commands
    .map((cmd) => {
      const lowerTitle = cmd.title.toLowerCase();
      const keywords = cmd.keywords?.map((k) => k.toLowerCase()) || [];

      let score = 0;

      // Exact match
      if (lowerTitle === lowerQuery) {
        score = 200;
      }
      // Title starts with query
      else if (lowerTitle.startsWith(lowerQuery)) {
        score = 100;
      }
      // Title includes query
      else if (lowerTitle.includes(lowerQuery)) {
        score = 75;
      }
      // Keywords start with query
      else if (keywords.some((k) => k.startsWith(lowerQuery))) {
        score = 50;
      }
      // Keywords include query
      else if (keywords.some((k) => k.includes(lowerQuery))) {
        score = 25;
      }

      return { cmd, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ cmd }) => cmd);
}

/**
 * Get category display label
 */
function getCategoryLabel(category: string): string {
  switch (category) {
    case 'settings':
      return 'System Settings';
    case 'system':
      return 'System';
    case 'extension':
      return 'Extension';
    case 'app':
    default:
      return 'Application';
  }
}

function getSystemCommandFallbackIcon(commandId: string): React.ReactNode {
  if (commandId === 'system-clipboard-manager') {
    return (
      <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center">
        <Clipboard className="w-3 h-3 text-cyan-300" />
      </div>
    );
  }

  if (
    commandId === 'system-create-snippet' ||
    commandId === 'system-search-snippets' ||
    commandId === 'system-import-snippets' ||
    commandId === 'system-export-snippets'
  ) {
    return (
      <div className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center">
        <FileText className="w-3 h-3 text-amber-300" />
      </div>
    );
  }

  if (commandId === 'system-search-files') {
    return (
      <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center">
        <Search className="w-3 h-3 text-emerald-300" />
      </div>
    );
  }

  return (
    <div className="w-5 h-5 rounded bg-red-500/20 flex items-center justify-center">
      <Power className="w-3 h-3 text-red-400" />
    </div>
  );
}

function renderShortcutLabel(shortcut?: string): string {
  if (!shortcut) return '';
  return shortcut
    .replace(/Command|Cmd/gi, '⌘')
    .replace(/Control|Ctrl/gi, '⌃')
    .replace(/Alt|Option/gi, '⌥')
    .replace(/Shift/gi, '⇧')
    .replace(/ArrowUp/g, '↑')
    .replace(/ArrowDown/g, '↓')
    .replace(/Backspace|Delete/g, '⌫')
    .replace(/\+/g, ' ');
}

const LAST_EXT_KEY = 'sc-last-extension';
const EXT_PREFS_KEY_PREFIX = 'sc-ext-prefs:';
const CMD_PREFS_KEY_PREFIX = 'sc-ext-cmd-prefs:';
const CMD_ARGS_KEY_PREFIX = 'sc-ext-cmd-args:';
const MAX_RECENT_COMMANDS = 30;

type PreferenceDefinition = NonNullable<ExtensionBundle['preferenceDefinitions']>[number];
type ArgumentDefinition = NonNullable<ExtensionBundle['commandArgumentDefinitions']>[number];

function readJsonObject(key: string): Record<string, any> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonObject(key: string, value: Record<string, any>) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getExtPrefsKey(extName: string): string {
  return `${EXT_PREFS_KEY_PREFIX}${extName}`;
}

function getCmdPrefsKey(extName: string, cmdName: string): string {
  return `${CMD_PREFS_KEY_PREFIX}${extName}/${cmdName}`;
}

function getCmdArgsKey(extName: string, cmdName: string): string {
  return `${CMD_ARGS_KEY_PREFIX}${extName}/${cmdName}`;
}

function hydrateExtensionBundlePreferences(bundle: ExtensionBundle): ExtensionBundle {
  const extName = bundle.extName || bundle.extensionName || '';
  const cmdName = bundle.cmdName || bundle.commandName || '';
  const extStored = extName ? readJsonObject(getExtPrefsKey(extName)) : {};
  const cmdStored = extName && cmdName ? readJsonObject(getCmdPrefsKey(extName, cmdName)) : {};
  const argStored =
    bundle.mode === 'no-view' && extName && cmdName
      ? readJsonObject(getCmdArgsKey(extName, cmdName))
      : {};
  return {
    ...bundle,
    preferences: {
      ...(bundle.preferences || {}),
      ...extStored,
      ...cmdStored,
    },
    launchArguments: {
      ...(bundle as any).launchArguments,
      ...argStored,
    } as any,
  };
}

function isMissingPreferenceValue(def: PreferenceDefinition, value: any): boolean {
  if (!def.required) return false;
  if (def.type === 'checkbox') return value === undefined || value === null;
  if (typeof value === 'string') return value.trim() === '';
  return value === undefined || value === null;
}

function getMissingRequiredPreferences(bundle: ExtensionBundle, values?: Record<string, any>): PreferenceDefinition[] {
  const defs = bundle.preferenceDefinitions || [];
  const prefs = values || bundle.preferences || {};
  return defs.filter((def) => isMissingPreferenceValue(def, prefs[def.name]));
}

function isMissingArgumentValue(def: ArgumentDefinition, value: any): boolean {
  if (!def.required) return false;
  if (typeof value === 'string') return value.trim() === '';
  return value === undefined || value === null;
}

function getMissingRequiredArguments(bundle: ExtensionBundle, values?: Record<string, any>): ArgumentDefinition[] {
  const defs = bundle.commandArgumentDefinitions || [];
  const args = values || (bundle as any).launchArguments || {};
  return defs.filter((def) => isMissingArgumentValue(def, args[def.name]));
}

function getUnsetCriticalPreferences(bundle: ExtensionBundle, values?: Record<string, any>): PreferenceDefinition[] {
  const defs = bundle.preferenceDefinitions || [];
  const prefs = values || bundle.preferences || {};
  const criticalName = /(api[-_ ]?key|token|secret|namespace|binary|protocol|preset)/i;
  return defs.filter((def) => {
    const type = (def.type || '').toLowerCase();
    if (type !== 'textfield' && type !== 'password' && type !== 'dropdown') return false;
    const v = prefs[def.name];
    const empty = (typeof v === 'string' ? v.trim() === '' : v === undefined || v === null);
    if (!empty) return false;
    return Boolean(def.required) || criticalName.test(def.name || '') || criticalName.test(def.title || '');
  });
}

function shouldOpenCommandSetup(bundle: ExtensionBundle): boolean {
  const missingPrefs = getMissingRequiredPreferences(bundle);
  if (missingPrefs.length > 0) return true;

  const args = bundle.commandArgumentDefinitions || [];
  const hasArgs = args.length > 0;
  const missingArgs = getMissingRequiredArguments(bundle);

  if (bundle.mode === 'no-view') {
    // no-view commands have no UI to collect launch arguments at runtime.
    if (hasArgs) return true;
    return missingArgs.length > 0;
  }

  // View/menu-bar commands can collect optional inputs in their own UI.
  return missingArgs.length > 0;
}

function persistExtensionPreferences(
  extName: string,
  cmdName: string,
  defs: PreferenceDefinition[],
  values: Record<string, any>
) {
  const extKey = getExtPrefsKey(extName);
  const cmdKey = getCmdPrefsKey(extName, cmdName);
  const extPrefs = readJsonObject(extKey);
  const cmdPrefs = readJsonObject(cmdKey);

  for (const def of defs) {
    if (!def?.name) continue;
    if (def.scope === 'command') {
      cmdPrefs[def.name] = values[def.name];
    } else {
      extPrefs[def.name] = values[def.name];
    }
  }

  writeJsonObject(extKey, extPrefs);
  writeJsonObject(cmdKey, cmdPrefs);
}

function persistCommandArguments(extName: string, cmdName: string, values: Record<string, any>) {
  writeJsonObject(getCmdArgsKey(extName, cmdName), values);
}

const App: React.FC = () => {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [pinnedCommands, setPinnedCommands] = useState<string[]>([]);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [extensionView, setExtensionView] = useState<ExtensionBundle | null>(null);
  const [extensionPreferenceSetup, setExtensionPreferenceSetup] = useState<{
    bundle: ExtensionBundle;
    values: Record<string, any>;
    argumentValues: Record<string, any>;
  } | null>(null);
  const [showClipboardManager, setShowClipboardManager] = useState(false);
  const [showSnippetManager, setShowSnippetManager] = useState<'search' | 'create' | null>(null);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [launcherShortcut, setLauncherShortcut] = useState('Command+Space');
  const [showActions, setShowActions] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    commandId: string;
  } | null>(null);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [selectedContextActionIndex, setSelectedContextActionIndex] = useState(0);
  const [menuBarExtensions, setMenuBarExtensions] = useState<ExtensionBundle[]>([]);
  const [aiMode, setAiMode] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const aiRequestIdRef = useRef<string | null>(null);
  const aiResponseRef = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const actionsOverlayRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const pinnedCommandsRef = useRef<string[]>([]);
  const extensionViewRef = useRef<ExtensionBundle | null>(null);
  extensionViewRef.current = extensionView;
  pinnedCommandsRef.current = pinnedCommands;

  const restoreLauncherFocus = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const upsertMenuBarExtension = useCallback((bundle: ExtensionBundle) => {
    setMenuBarExtensions((prev) => {
      const idx = prev.findIndex(
        (ext) =>
          (ext.extName || ext.extensionName) === (bundle.extName || bundle.extensionName) &&
          (ext.cmdName || ext.commandName) === (bundle.cmdName || bundle.commandName)
      );
      if (idx === -1) return [...prev, bundle];
      const next = [...prev];
      next[idx] = bundle;
      return next;
    });
  }, []);

  const loadLauncherPreferences = useCallback(async () => {
    try {
      const settings = (await window.electron.getSettings()) as AppSettings;
      setPinnedCommands(settings.pinnedCommands || []);
      setRecentCommands(settings.recentCommands || []);
      setLauncherShortcut(settings.globalShortcut || 'Command+Space');
      setShowOnboarding(!settings.hasSeenOnboarding);
    } catch (e) {
      console.error('Failed to load launcher preferences:', e);
      setPinnedCommands([]);
      setRecentCommands([]);
      setLauncherShortcut('Command+Space');
      setShowOnboarding(false);
    }
  }, []);

  const fetchCommands = useCallback(async () => {
    setIsLoading(true);
    const fetchedCommands = await window.electron.getCommands();
    setCommands(fetchedCommands);
    setIsLoading(false);
  }, []);

  // Restore last opened extension on initial mount (app restart)
  useEffect(() => {
    const saved = localStorage.getItem(LAST_EXT_KEY);
    if (saved) {
      try {
        const { extName, cmdName } = JSON.parse(saved);
        window.electron.runExtension(extName, cmdName).then(result => {
          if (result && result.code) {
            const hydrated = hydrateExtensionBundlePreferences(result);
            if (hydrated.mode === 'no-view') {
              localStorage.removeItem(LAST_EXT_KEY);
            }
            if (shouldOpenCommandSetup(hydrated)) {
              setShowFileSearch(false);
              setExtensionPreferenceSetup({
                bundle: hydrated,
                values: { ...(hydrated.preferences || {}) },
                argumentValues: { ...((hydrated as any).launchArguments || {}) },
              });
            } else {
              setShowFileSearch(false);
              setExtensionView(hydrated);
            }
          } else {
            localStorage.removeItem(LAST_EXT_KEY);
          }
        }).catch(() => {
          localStorage.removeItem(LAST_EXT_KEY);
        });
      } catch {
        localStorage.removeItem(LAST_EXT_KEY);
      }
    }
  }, []);

  useEffect(() => {
    fetchCommands();
    loadLauncherPreferences();

    window.electron.onWindowShown(() => {
      console.log('[WINDOW-SHOWN] fired');
      // If an extension is open, keep it alive — don't reset
      if (extensionViewRef.current) return;
      setSearchQuery('');
      setSelectedIndex(0);
      setAiMode(false);
      setAiResponse('');
      setAiStreaming(false);
      setAiQuery('');
      setShowSnippetManager(null);
      setShowFileSearch(false);
      // Re-fetch commands every time the window is shown
      // so newly installed extensions appear immediately
      fetchCommands();
      loadLauncherPreferences();
      window.electron.aiIsAvailable().then(setAiAvailable);
      inputRef.current?.focus();
    });
  }, [fetchCommands, loadLauncherPreferences]);

  useEffect(() => {
    const onLaunchBundle = (event: Event) => {
      const custom = event as CustomEvent<{
        bundle?: ExtensionBundle;
        launchOptions?: { type?: string };
        source?: { commandMode?: string; extensionName?: string; commandName?: string };
      }>;
      const incoming = custom.detail?.bundle;
      if (!incoming) return;

      const hydrated = hydrateExtensionBundlePreferences(incoming);
      const launchType = custom.detail?.launchOptions?.type || 'userInitiated';
      const sourceMode = custom.detail?.source?.commandMode || '';

      if (hydrated.mode === 'menu-bar') {
        upsertMenuBarExtension(hydrated);
        return;
      }

      if (launchType === 'background') {
        return;
      }

      // Hidden menu-bar runners should not hijack the launcher by forcing
      // view commands into the foreground (e.g. pomodoro auto transitions).
      if (sourceMode === 'menu-bar' && hydrated.mode === 'view') {
        return;
      }

      if (shouldOpenCommandSetup(hydrated)) {
        setShowFileSearch(false);
        setExtensionPreferenceSetup({
          bundle: hydrated,
          values: { ...(hydrated.preferences || {}) },
          argumentValues: { ...((hydrated as any).launchArguments || {}) },
        });
      } else {
        setShowFileSearch(false);
        setExtensionView(hydrated);
      }
    };

    window.addEventListener('sc-launch-extension-bundle', onLaunchBundle as EventListener);
    return () => window.removeEventListener('sc-launch-extension-bundle', onLaunchBundle as EventListener);
  }, [upsertMenuBarExtension]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load and run menu-bar extensions in the background
  useEffect(() => {
    (window as any).electron?.getMenuBarExtensions?.().then((exts: any[]) => {
      if (exts && exts.length > 0) {
        console.log(`[MenuBar] Loading ${exts.length} menu-bar extension(s)`);
        const runnable = exts
          .map((ext) => hydrateExtensionBundlePreferences(ext))
          .filter((ext) => {
            const missingPrefs = getMissingRequiredPreferences(ext);
            const missingArgs = getMissingRequiredArguments(ext);
            return missingPrefs.length === 0 && missingArgs.length === 0;
          });
        setMenuBarExtensions(runnable);
      }
    }).catch((err: any) => {
      console.error('[MenuBar] Failed to load menu-bar extensions:', err);
    });
  }, []);

  // Check AI availability
  useEffect(() => {
    window.electron.aiIsAvailable().then(setAiAvailable);
  }, []);

  const saveLauncherPreferences = useCallback(
    async (next: { pinnedCommands?: string[]; recentCommands?: string[] }) => {
      const patch: Partial<AppSettings> = {};
      if (next.pinnedCommands) patch.pinnedCommands = next.pinnedCommands;
      if (next.recentCommands) patch.recentCommands = next.recentCommands;
      if (Object.keys(patch).length > 0) {
        await window.electron.saveSettings(patch);
      }
    },
    []
  );

  const updateRecentCommands = useCallback(
    async (commandId: string) => {
      const updated = [
        commandId,
        ...recentCommands.filter((id) => id !== commandId),
      ].slice(0, MAX_RECENT_COMMANDS);
      setRecentCommands(updated);
      await saveLauncherPreferences({ recentCommands: updated });
    },
    [recentCommands, saveLauncherPreferences]
  );

  const updatePinnedCommands = useCallback(
    async (nextPinned: string[]) => {
      setPinnedCommands(nextPinned);
      await saveLauncherPreferences({ pinnedCommands: nextPinned });
    },
    [saveLauncherPreferences]
  );

  const pinToggleForCommand = useCallback(
    async (command: CommandInfo) => {
      console.log('[PIN-TOGGLE] called for command:', command?.id, command?.name);
      const currentPinned = pinnedCommandsRef.current;
      const exists = currentPinned.includes(command.id);
      console.log('[PIN-TOGGLE] currentPinned:', currentPinned, 'exists:', exists);
      if (exists) {
        await updatePinnedCommands(
          currentPinned.filter((id) => id !== command.id)
        );
      } else {
        await updatePinnedCommands([command.id, ...currentPinned]);
      }
      console.log('[PIN-TOGGLE] done, new pinned:', pinnedCommandsRef.current);
    },
    [updatePinnedCommands]
  );

  const disableCommand = useCallback(
    async (command: CommandInfo) => {
      await window.electron.toggleCommandEnabled(command.id, false);
      await updatePinnedCommands(pinnedCommands.filter((id) => id !== command.id));
      const nextRecent = recentCommands.filter((id) => id !== command.id);
      setRecentCommands(nextRecent);
      await saveLauncherPreferences({ recentCommands: nextRecent });
      await fetchCommands();
    },
    [
      pinnedCommands,
      recentCommands,
      updatePinnedCommands,
      saveLauncherPreferences,
      fetchCommands,
    ]
  );

  const uninstallExtensionCommand = useCallback(
    async (command: CommandInfo) => {
      if (command.category !== 'extension' || !command.path) return;
      const [extName] = command.path.split('/');
      if (!extName) return;
      await window.electron.uninstallExtension(extName);
      await updatePinnedCommands(pinnedCommands.filter((id) => id !== command.id));
      const nextRecent = recentCommands.filter((id) => id !== command.id);
      setRecentCommands(nextRecent);
      await saveLauncherPreferences({ recentCommands: nextRecent });
      await fetchCommands();
    },
    [
      pinnedCommands,
      recentCommands,
      updatePinnedCommands,
      saveLauncherPreferences,
      fetchCommands,
    ]
  );

  const movePinnedCommand = useCallback(
    async (command: CommandInfo, direction: 'up' | 'down') => {
      const idx = pinnedCommands.indexOf(command.id);
      if (idx === -1) return;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= pinnedCommands.length) return;
      const next = [...pinnedCommands];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      await updatePinnedCommands(next);
    },
    [pinnedCommands, updatePinnedCommands]
  );

  // AI streaming listeners
  useEffect(() => {
    const handleChunk = (data: { requestId: string; chunk: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        setAiResponse((prev) => prev + data.chunk);
      }
    };
    const handleDone = (data: { requestId: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        setAiStreaming(false);
      }
    };
    const handleError = (data: { requestId: string; error: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        setAiResponse((prev) => prev + `\n\nError: ${data.error}`);
        setAiStreaming(false);
      }
    };

    window.electron.onAIStreamChunk(handleChunk);
    window.electron.onAIStreamDone(handleDone);
    window.electron.onAIStreamError(handleError);
  }, []);

  const startAiChat = useCallback(() => {
    if (!searchQuery.trim() || !aiAvailable) return;
    const requestId = `ai-${Date.now()}`;
    aiRequestIdRef.current = requestId;
    setAiQuery(searchQuery);
    setAiResponse('');
    setAiStreaming(true);
    setAiMode(true);
    window.electron.aiAsk(requestId, searchQuery);
  }, [searchQuery, aiAvailable]);

  const submitAiQuery = useCallback((query: string) => {
    if (!query.trim()) return;
    // Cancel any in-flight request
    if (aiRequestIdRef.current && aiStreaming) {
      window.electron.aiCancel(aiRequestIdRef.current);
    }
    const requestId = `ai-${Date.now()}`;
    aiRequestIdRef.current = requestId;
    setAiQuery(query);
    setAiResponse('');
    setAiStreaming(true);
    window.electron.aiAsk(requestId, query);
  }, [aiStreaming]);

  const exitAiMode = useCallback(() => {
    if (aiRequestIdRef.current && aiStreaming) {
      window.electron.aiCancel(aiRequestIdRef.current);
    }
    aiRequestIdRef.current = null;
    setAiMode(false);
    setAiResponse('');
    setAiStreaming(false);
    setAiQuery('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [aiStreaming]);

  // Auto-scroll AI response
  useEffect(() => {
    if (aiResponseRef.current) {
      aiResponseRef.current.scrollTop = aiResponseRef.current.scrollHeight;
    }
  }, [aiResponse]);

  // Escape to exit AI mode
  useEffect(() => {
    if (!aiMode) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitAiMode();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [aiMode, exitAiMode]);

  useEffect(() => {
    if (!contextMenu) return;
    const onMouseDown = () => setContextMenu(null);
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [contextMenu]);

  useEffect(() => {
    if (!showActions) return;
    setSelectedActionIndex(0);
    setTimeout(() => actionsOverlayRef.current?.focus(), 0);
  }, [showActions]);

  useEffect(() => {
    if (!contextMenu) return;
    setSelectedContextActionIndex(0);
    setTimeout(() => contextMenuRef.current?.focus(), 0);
  }, [contextMenu]);

  useEffect(() => {
    if (!showActions && !contextMenu && !aiMode && !extensionView && !showClipboardManager && !showSnippetManager && !showFileSearch && !showOnboarding) {
      restoreLauncherFocus();
    }
  }, [showActions, contextMenu, aiMode, extensionView, showClipboardManager, showSnippetManager, showFileSearch, showOnboarding, restoreLauncherFocus]);

  const calcResult = useMemo(() => {
    return searchQuery ? tryCalculate(searchQuery) : null;
  }, [searchQuery]);
  const calcOffset = calcResult ? 1 : 0;
  const filteredCommands = useMemo(
    () => filterCommands(commands, searchQuery),
    [commands, searchQuery]
  );

  // When calculator is showing but no commands match, show unfiltered list below
  const sourceCommands =
    calcResult && filteredCommands.length === 0 ? commands : filteredCommands;

  const groupedCommands = useMemo(() => {
    const sourceMap = new Map(sourceCommands.map((cmd) => [cmd.id, cmd]));
    const pinned = pinnedCommands
      .map((id) => sourceMap.get(id))
      .filter(Boolean) as CommandInfo[];
    const pinnedSet = new Set(pinned.map((c) => c.id));

    const recent = recentCommands
      .map((id) => sourceMap.get(id))
      .filter((c): c is CommandInfo => Boolean(c) && !pinnedSet.has((c as CommandInfo).id));
    const recentSet = new Set(recent.map((c) => c.id));

    const other = sourceCommands.filter(
      (c) => !pinnedSet.has(c.id) && !recentSet.has(c.id)
    );

    return { pinned, recent, other };
  }, [sourceCommands, pinnedCommands, recentCommands]);

  const displayCommands = useMemo(
    () => [...groupedCommands.pinned, ...groupedCommands.recent, ...groupedCommands.other],
    [groupedCommands]
  );

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, displayCommands.length + calcOffset);
  }, [displayCommands.length, calcOffset]);

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
  }, [selectedIndex, scrollToSelected]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    const max = Math.max(0, displayCommands.length + calcOffset - 1);
    setSelectedIndex((prev) => (prev > max ? max : prev));
  }, [displayCommands.length, calcOffset]);

  const selectedCommand =
    selectedIndex >= calcOffset
      ? displayCommands[selectedIndex - calcOffset]
      : null;

  const togglePinSelectedCommand = useCallback(async () => {
    if (!selectedCommand) return;
    await pinToggleForCommand(selectedCommand);
  }, [selectedCommand, pinToggleForCommand]);

  const disableSelectedCommand = useCallback(async () => {
    if (!selectedCommand) return;
    await disableCommand(selectedCommand);
  }, [selectedCommand, disableCommand]);

  const uninstallSelectedExtension = useCallback(async () => {
    if (!selectedCommand) return;
    await uninstallExtensionCommand(selectedCommand);
  }, [selectedCommand, uninstallExtensionCommand]);

  const moveSelectedPinnedCommand = useCallback(
    async (direction: 'up' | 'down') => {
      if (!selectedCommand) return;
      await movePinnedCommand(selectedCommand, direction);
    },
    [selectedCommand, movePinnedCommand]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.metaKey && (e.key === 'k' || e.key === 'K') && !e.repeat) {
        e.preventDefault();
        setShowActions((prev) => !prev);
        setContextMenu(null);
        return;
      }
      if (showActions || contextMenu) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (showActions) setShowActions(false);
          if (contextMenu) setContextMenu(null);
          restoreLauncherFocus();
        }
        return;
      }
      if (e.metaKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        togglePinSelectedCommand();
        return;
      }
      if (e.metaKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        disableSelectedCommand();
        return;
      }
      if (e.metaKey && (e.key === 'Backspace' || e.key === 'Delete')) {
        if (selectedCommand?.category === 'extension') {
          e.preventDefault();
          uninstallSelectedExtension();
          return;
        }
      }
      if (e.metaKey && e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelectedPinnedCommand('up');
        return;
      }
      if (e.metaKey && e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelectedPinnedCommand('down');
        return;
      }

      switch (e.key) {
        case 'Tab':
          if (searchQuery.trim() && aiAvailable) {
            e.preventDefault();
            startAiChat();
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => {
            const max = displayCommands.length + calcOffset - 1;
            return prev < max ? prev + 1 : prev;
          });
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;

        case 'Enter':
          e.preventDefault();
          if (calcResult && selectedIndex === 0) {
            navigator.clipboard.writeText(calcResult.result);
            window.electron.hideWindow();
          } else if (displayCommands[selectedIndex - calcOffset]) {
            handleCommandExecute(displayCommands[selectedIndex - calcOffset]);
          }
          break;

        case 'Escape':
          e.preventDefault();
          if (contextMenu) {
            setContextMenu(null);
            return;
          }
          if (showActions) {
            setShowActions(false);
            return;
          }
          setSearchQuery('');
          setSelectedIndex(0);
          window.electron.hideWindow();
          break;
      }
    },
    [
      displayCommands,
      selectedIndex,
      searchQuery,
      aiAvailable,
      startAiChat,
      calcResult,
      calcOffset,
      togglePinSelectedCommand,
      disableSelectedCommand,
      uninstallSelectedExtension,
      moveSelectedPinnedCommand,
      selectedCommand,
      contextMenu,
      showActions,
    ]
  );

  const runLocalSystemCommand = useCallback(async (commandId: string): Promise<boolean> => {
    if (commandId === 'system-open-onboarding') {
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowClipboardManager(false);
      setShowSnippetManager(null);
      setShowFileSearch(false);
      setAiMode(false);
      setShowOnboarding(true);
      return true;
    }
    if (commandId === 'system-clipboard-manager') {
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowOnboarding(false);
      setShowClipboardManager(true);
      setShowSnippetManager(null);
      setShowFileSearch(false);
      setAiMode(false);
      return true;
    }
    if (commandId === 'system-search-snippets') {
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowOnboarding(false);
      setShowClipboardManager(false);
      setShowFileSearch(false);
      setAiMode(false);
      setShowSnippetManager('search');
      return true;
    }
    if (commandId === 'system-create-snippet') {
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowOnboarding(false);
      setShowClipboardManager(false);
      setShowFileSearch(false);
      setAiMode(false);
      setShowSnippetManager('create');
      return true;
    }
    if (commandId === 'system-search-files') {
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowOnboarding(false);
      setShowClipboardManager(false);
      setShowSnippetManager(null);
      setAiMode(false);
      setShowFileSearch(true);
      return true;
    }
    if (commandId === 'system-import-snippets') {
      await window.electron.snippetImport();
      return true;
    }
    if (commandId === 'system-export-snippets') {
      await window.electron.snippetExport();
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    window.electron.onRunSystemCommand(async (commandId: string) => {
      try {
        await runLocalSystemCommand(commandId);
      } catch (error) {
        console.error('Failed to run system command from main process:', error);
      }
    });
  }, [runLocalSystemCommand]);

  const handleCommandExecute = async (command: CommandInfo) => {
    try {
      if (await runLocalSystemCommand(command.id)) {
        await updateRecentCommands(command.id);
        return;
      }

      if (command.category === 'extension' && command.path) {
        // Extension command — build and show extension view
        const [extName, cmdName] = command.path.split('/');
        const result = await window.electron.runExtension(extName, cmdName);
        if (result && result.code) {
          const hydrated = hydrateExtensionBundlePreferences(result);
          if (shouldOpenCommandSetup(hydrated)) {
            setShowFileSearch(false);
            setExtensionPreferenceSetup({
              bundle: hydrated,
              values: { ...(hydrated.preferences || {}) },
              argumentValues: { ...((hydrated as any).launchArguments || {}) },
            });
            return;
          }

          // Menu-bar commands run in the hidden tray runners, not in the overlay.
          // Just hide the window — the tray will show the menu.
          if (hydrated.mode === 'menu-bar') {
            upsertMenuBarExtension(hydrated);
            window.electron.hideWindow();
            setSearchQuery('');
            setSelectedIndex(0);
            await updateRecentCommands(command.id);
            return;
          }
          setShowFileSearch(false);
          setExtensionView(hydrated);
          if (hydrated.mode === 'view') {
            localStorage.setItem(LAST_EXT_KEY, JSON.stringify({ extName, cmdName }));
          } else {
            localStorage.removeItem(LAST_EXT_KEY);
          }
          await updateRecentCommands(command.id);
          return;
        }
        const errMsg = result?.error || 'Failed to build extension';
        console.error('Extension load failed:', errMsg);
        // Show the error in the extension view
        setShowFileSearch(false);
        setExtensionView({
          code: '',
          title: command.title,
          mode: 'view',
          extName,
          cmdName,
          error: errMsg,
        } as any);
        return;
      }

      await window.electron.executeCommand(command.id);
      await updateRecentCommands(command.id);
      setSearchQuery('');
      setSelectedIndex(0);
    } catch (error) {
      console.error('Failed to execute command:', error);
    }
  };

  const getActionsForCommand = useCallback(
    (command: CommandInfo | null): LauncherAction[] => {
      if (!command) return [];
      const isPinned = pinnedCommands.includes(command.id);
      const pinnedIndex = pinnedCommands.indexOf(command.id);
      return [
        {
          id: 'open',
          title: 'Open Command',
          shortcut: 'Enter',
          execute: () => handleCommandExecute(command),
        },
        {
          id: 'pin',
          title: isPinned
            ? 'Unpin Extension'
            : command.category === 'extension'
              ? 'Pin Extension'
              : 'Pin Command',
          shortcut: 'Cmd+Shift+P',
          execute: () => pinToggleForCommand(command),
        },
        {
          id: 'disable',
          title: 'Disable Command',
          shortcut: 'Cmd+Shift+D',
          execute: () => disableCommand(command),
        },
        {
          id: 'uninstall',
          title: 'Uninstall',
          shortcut: 'Cmd+Delete',
          style: 'destructive',
          enabled: command.category === 'extension',
          execute: () => uninstallExtensionCommand(command),
        },
        {
          id: 'move-up',
          title: 'Move Up',
          shortcut: 'Cmd+Alt+Up',
          enabled: isPinned && pinnedIndex > 0,
          execute: () => movePinnedCommand(command, 'up'),
        },
        {
          id: 'move-down',
          title: 'Move Down',
          shortcut: 'Cmd+Alt+Down',
          enabled: isPinned && pinnedIndex >= 0 && pinnedIndex < pinnedCommands.length - 1,
          execute: () => movePinnedCommand(command, 'down'),
        },
      ].filter((action) => action.enabled !== false);
    },
    [
      pinnedCommands,
      handleCommandExecute,
      pinToggleForCommand,
      disableCommand,
      uninstallExtensionCommand,
      movePinnedCommand,
    ]
  );

  const selectedActions = useMemo(
    () => getActionsForCommand(selectedCommand),
    [getActionsForCommand, selectedCommand]
  );

  const contextCommand = useMemo(
    () =>
      contextMenu
        ? displayCommands.find((cmd) => cmd.id === contextMenu.commandId) || null
        : null,
    [contextMenu, displayCommands]
  );

  const contextActions = useMemo(
    () => getActionsForCommand(contextCommand),
    [getActionsForCommand, contextCommand]
  );

  const handleActionsOverlayKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (selectedActions.length === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedActionIndex((prev) =>
            Math.min(prev + 1, selectedActions.length - 1)
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedActionIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          await Promise.resolve(selectedActions[selectedActionIndex]?.execute());
          setShowActions(false);
          restoreLauncherFocus();
          break;
        case 'Escape':
          e.preventDefault();
          setShowActions(false);
          restoreLauncherFocus();
          break;
      }
    },
    [selectedActions, selectedActionIndex, restoreLauncherFocus]
  );

  const handleContextMenuKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (contextActions.length === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedContextActionIndex((prev) =>
            Math.min(prev + 1, contextActions.length - 1)
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedContextActionIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          await Promise.resolve(contextActions[selectedContextActionIndex]?.execute());
          setContextMenu(null);
          restoreLauncherFocus();
          break;
        case 'Escape':
          e.preventDefault();
          setContextMenu(null);
          restoreLauncherFocus();
          break;
      }
    },
    [contextActions, selectedContextActionIndex, restoreLauncherFocus]
  );

  // ─── Hidden menu-bar extension runners (always mounted) ────────────
  // These run "invisibly" so that menu-bar extensions produce native Tray
  // menus via IPC even when the main window is hidden.
  const menuBarRunner = menuBarExtensions.length > 0 ? (
    <div style={{ display: 'none', position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {menuBarExtensions.map((ext) => (
        <ExtensionView
          key={`menubar-${ext.extName}-${ext.cmdName}`}
          code={ext.code}
          title={ext.title}
          mode="menu-bar"
          extensionName={(ext as any).extensionName || ext.extName}
          extensionDisplayName={(ext as any).extensionDisplayName}
          extensionIconDataUrl={(ext as any).extensionIconDataUrl}
          commandName={(ext as any).commandName || ext.cmdName}
          assetsPath={(ext as any).assetsPath}
          supportPath={(ext as any).supportPath}
          owner={(ext as any).owner}
          preferences={(ext as any).preferences}
          launchArguments={(ext as any).launchArguments}
          launchContext={(ext as any).launchContext}
          fallbackText={(ext as any).fallbackText}
          launchType={(ext as any).launchType}
          onClose={() => {}}
        />
      ))}
    </div>
  ) : null;

  // ─── Extension Preferences Setup ────────────────────────────────
  if (extensionPreferenceSetup) {
    const bundle = extensionPreferenceSetup.bundle;
    const defs = (bundle.preferenceDefinitions || []).filter((d) => d?.name);
    const argDefs = (bundle.commandArgumentDefinitions || []).filter((d) => d?.name);
    const missingPrefs = getMissingRequiredPreferences(bundle, extensionPreferenceSetup.values);
    const missingArgs = getMissingRequiredArguments(bundle, extensionPreferenceSetup.argumentValues);
    const criticalUnsetPrefs = getUnsetCriticalPreferences(bundle, extensionPreferenceSetup.values);
    const hasBlockingMissing =
      missingPrefs.length > 0 ||
      missingArgs.length > 0;
    const displayName = (bundle as any).extensionDisplayName || bundle.extensionName || bundle.extName || 'Extension';

    return (
      <>
        {menuBarRunner}
        <div className="w-full h-full">
          <div className="glass-effect overflow-hidden h-full flex flex-col">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.06]">
              <button
                onClick={() => {
                  setExtensionPreferenceSetup(null);
                  setSearchQuery('');
                  setSelectedIndex(0);
                }}
                className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              </button>
              <div className="text-white/85 text-[15px] font-medium truncate">
                Configure {displayName}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-sm text-white/55">Configure command inputs and preferences before running.</p>
              {criticalUnsetPrefs.length > 0 ? (
                <p className="text-xs text-amber-300/80">
                  Some important preferences are empty: {criticalUnsetPrefs.map((p) => p.title || p.name).join(', ')}.
                </p>
              ) : null}
              {argDefs.length > 0 ? (
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-wide text-white/35">Arguments</div>
                  {argDefs.map((arg) => {
                    const value = extensionPreferenceSetup.argumentValues?.[arg.name];
                    return (
                      <div key={`arg:${arg.name}`} className="space-y-1">
                        <label className="text-xs text-white/70 font-medium">
                          {arg.title || arg.name}
                          {arg.required ? <span className="text-red-400"> *</span> : null}
                        </label>
                        <input
                          type="text"
                          value={value ?? ''}
                          placeholder={arg.placeholder || ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setExtensionPreferenceSetup((prev) => prev ? {
                              ...prev,
                              argumentValues: { ...prev.argumentValues, [arg.name]: v },
                            } : prev);
                          }}
                          className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-3 py-2 text-sm text-white/90 placeholder-white/30 outline-none"
                        />
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {defs.length > 0 ? <div className="text-xs uppercase tracking-wide text-white/35">Preferences</div> : null}
              {defs.map((def) => {
                const value = extensionPreferenceSetup.values?.[def.name];
                const type = def.type || 'textfield';
                return (
                  <div key={`${def.scope}:${def.name}`} className="space-y-1">
                    <label className="text-xs text-white/70 font-medium">
                      {def.title || def.name}
                      {def.required ? <span className="text-red-400"> *</span> : null}
                    </label>
                    {type === 'checkbox' ? (
                      <label className="inline-flex items-center gap-2 text-sm text-white/80">
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(e) => {
                            setExtensionPreferenceSetup((prev) => prev ? {
                              ...prev,
                              values: { ...prev.values, [def.name]: e.target.checked },
                            } : prev);
                          }}
                        />
                        <span>Enabled</span>
                      </label>
                    ) : type === 'dropdown' ? (
                      <select
                        value={typeof value === 'string' ? value : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setExtensionPreferenceSetup((prev) => prev ? {
                            ...prev,
                            values: { ...prev.values, [def.name]: v },
                          } : prev);
                        }}
                        className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-3 py-2 text-sm text-white/90 outline-none"
                      >
                        <option value="">Select an option</option>
                        {(def.data || []).map((opt) => (
                          <option key={opt?.value || opt?.title} value={opt?.value || ''}>
                            {opt?.title || opt?.value || ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={type === 'password' ? 'password' : 'text'}
                        value={value ?? ''}
                        placeholder={def.placeholder || ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setExtensionPreferenceSetup((prev) => prev ? {
                            ...prev,
                            values: { ...prev.values, [def.name]: v },
                          } : prev);
                        }}
                        className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-3 py-2 text-sm text-white/90 placeholder-white/30 outline-none"
                      />
                    )}
                    {def.description ? (
                      <p className="text-xs text-white/40">{def.description}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="px-4 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2" style={{ background: 'rgba(28,28,32,0.90)' }}>
              <button
                type="button"
                onClick={() => {
                  const extName = bundle.extName || bundle.extensionName || '';
                  const cmdName = bundle.cmdName || bundle.commandName || '';
                  if (!extName || !cmdName) return;
                  persistExtensionPreferences(extName, cmdName, defs, extensionPreferenceSetup.values);
                  if (bundle.mode === 'no-view') {
                    persistCommandArguments(extName, cmdName, extensionPreferenceSetup.argumentValues || {});
                  }
                  const updatedBundle: ExtensionBundle = {
                    ...bundle,
                    preferences: { ...(bundle.preferences || {}), ...(extensionPreferenceSetup.values || {}) },
                    launchArguments: { ...((bundle as any).launchArguments || {}), ...(extensionPreferenceSetup.argumentValues || {}) } as any,
                  };
                  setExtensionPreferenceSetup(null);

                  if (updatedBundle.mode === 'menu-bar') {
                    upsertMenuBarExtension(updatedBundle);
                    window.electron.hideWindow();
                    setSearchQuery('');
                    setSelectedIndex(0);
                    localStorage.removeItem(LAST_EXT_KEY);
                    return;
                  }

                  setExtensionView(updatedBundle);
                  if (updatedBundle.mode === 'view') {
                    localStorage.setItem(LAST_EXT_KEY, JSON.stringify({ extName, cmdName }));
                  } else {
                    localStorage.removeItem(LAST_EXT_KEY);
                  }
                }}
                disabled={hasBlockingMissing}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  hasBlockingMissing
                    ? 'bg-white/[0.08] text-white/35 cursor-not-allowed'
                    : 'bg-white/[0.16] hover:bg-white/[0.22] text-white'
                }`}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ─── Extension view mode ──────────────────────────────────────────
  if (extensionView) {
    return (
      <>
        {menuBarRunner}
        <div className="w-full h-full">
          <div className="glass-effect overflow-hidden h-full flex flex-col">
            <ExtensionView
              code={extensionView.code}
              title={extensionView.title}
              mode={extensionView.mode}
              error={(extensionView as any).error}
              extensionName={(extensionView as any).extensionName || extensionView.extName}
              extensionDisplayName={(extensionView as any).extensionDisplayName}
              extensionIconDataUrl={(extensionView as any).extensionIconDataUrl}
              commandName={(extensionView as any).commandName || extensionView.cmdName}
              assetsPath={(extensionView as any).assetsPath}
              supportPath={(extensionView as any).supportPath}
              owner={(extensionView as any).owner}
              preferences={(extensionView as any).preferences}
              launchArguments={(extensionView as any).launchArguments}
              launchContext={(extensionView as any).launchContext}
              fallbackText={(extensionView as any).fallbackText}
              launchType={(extensionView as any).launchType}
              onClose={() => {
                setExtensionView(null);
                localStorage.removeItem(LAST_EXT_KEY);
                setSearchQuery('');
                setSelectedIndex(0);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
            />
          </div>
        </div>
      </>
    );
  }

  // ─── Clipboard Manager mode ───────────────────────────────────────
  if (showClipboardManager) {
    return (
      <>
        {menuBarRunner}
        <div className="w-full h-full">
          <div className="glass-effect overflow-hidden h-full flex flex-col">
            <ClipboardManager
              onClose={() => {
                setShowClipboardManager(false);
                setSearchQuery('');
                setSelectedIndex(0);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
            />
          </div>
        </div>
      </>
    );
  }

  // ─── Snippet Manager mode ─────────────────────────────────────────
  if (showSnippetManager) {
    return (
      <>
        {menuBarRunner}
        <div className="w-full h-full">
          <div className="glass-effect overflow-hidden h-full flex flex-col">
            <SnippetManager
              initialView={showSnippetManager}
              onClose={() => {
                setShowSnippetManager(null);
                setSearchQuery('');
                setSelectedIndex(0);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
            />
          </div>
        </div>
      </>
    );
  }

  // ─── File Search mode ─────────────────────────────────────────────
  if (showFileSearch) {
    return (
      <>
        {menuBarRunner}
        <div className="w-full h-full">
          <div className="glass-effect overflow-hidden h-full flex flex-col">
            <FileSearchExtension
              onClose={() => {
                setShowFileSearch(false);
                setSearchQuery('');
                setSelectedIndex(0);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
            />
          </div>
        </div>
      </>
    );
  }

  // ─── AI Chat mode ──────────────────────────────────────────────
  if (aiMode) {
    return (
      <>
        {menuBarRunner}
        <div className="w-full h-full">
          <div className="glass-effect overflow-hidden h-full flex flex-col">
            {/* AI header — editable input */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06]">
              <Sparkles className="w-4 h-4 text-purple-400 flex-shrink-0" />
              <input
                ref={aiInputRef}
                type="text"
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && aiQuery.trim()) {
                    e.preventDefault();
                    submitAiQuery(aiQuery);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    exitAiMode();
                  }
                }}
                placeholder="Ask AI anything..."
                className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-[15px] font-light tracking-wide min-w-0"
                autoFocus
              />
              {aiQuery.trim() && (
                <button
                  onClick={() => submitAiQuery(aiQuery)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/15 hover:bg-purple-500/25 transition-colors flex-shrink-0 group"
                >
                  <span className="text-[11px] text-purple-400/70 group-hover:text-purple-400 transition-colors">Ask</span>
                  <kbd className="text-[10px] text-purple-400/40 bg-purple-500/10 px-1 py-0.5 rounded font-mono leading-none">Enter</kbd>
                </button>
              )}
              <button
                onClick={exitAiMode}
                className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* AI response */}
            <div
              ref={aiResponseRef}
              className="flex-1 overflow-y-auto custom-scrollbar p-5"
            >
              {aiResponse ? (
                <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap font-light">
                  {aiResponse}
                </div>
              ) : aiStreaming ? (
                <div className="flex items-center gap-2 text-white/40 text-sm">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-pulse" />
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-pulse" style={{ animationDelay: '0.4s' }} />
                  </div>
                  Thinking...
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="px-4 py-3.5 border-t border-white/[0.06] flex items-center justify-between text-xs text-white/40 font-medium" style={{ background: 'rgba(28,28,32,0.90)' }}>
              <span>{aiStreaming ? 'Streaming...' : 'AI Response'}</span>
              <div className="flex items-center gap-2">
                <kbd className="text-[10px] text-white/20 bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">Enter</kbd>
                <span className="text-[10px] text-white/20">Ask</span>
                <kbd className="text-[10px] text-white/20 bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">Esc</kbd>
                <span className="text-[10px] text-white/20">Back</span>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ─── Onboarding mode ───────────────────────────────────────────
  if (showOnboarding) {
    return (
      <>
        {menuBarRunner}
        <OnboardingExtension
          initialShortcut={launcherShortcut}
          onClose={() => {
            setShowOnboarding(false);
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          onComplete={async () => {
            await window.electron.saveSettings({ hasSeenOnboarding: true });
            setShowOnboarding(false);
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      </>
    );
  }

  // ─── Launcher mode ──────────────────────────────────────────────
  return (
    <>
    {menuBarRunner}
    <div className="w-full h-full">
      <div className="glass-effect overflow-hidden h-full flex flex-col">
        {/* Search header - transparent background */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06]">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search apps and settings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-none outline-none text-white/95 placeholder-white/45 text-[15px] font-medium tracking-[0.005em]"
            autoFocus
          />
          {searchQuery && aiAvailable && (
            <button
              onClick={startAiChat}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.10] transition-colors flex-shrink-0 group"
            >
              <Sparkles className="w-3 h-3 text-white/30 group-hover:text-purple-400 transition-colors" />
              <span className="text-[11px] text-white/30 group-hover:text-white/50 transition-colors">Ask AI</span>
              <kbd className="text-[10px] text-white/20 bg-white/[0.06] px-1 py-0.5 rounded font-mono leading-none">Tab</kbd>
            </button>
          )}
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto custom-scrollbar p-1.5 list-area"
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Discovering apps...</p>
            </div>
          ) : displayCommands.length === 0 && !calcResult ? (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">No matching results</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* Calculator card */}
              {calcResult && (
                <div
                  ref={(el) => (itemRefs.current[0] = el)}
                  className={`mx-1 mt-0.5 mb-2 px-6 py-4 rounded-xl cursor-pointer transition-colors border ${
                    selectedIndex === 0
                      ? 'bg-white/[0.08] border-white/[0.12]'
                      : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]'
                  }`}
                  onClick={() => {
                    navigator.clipboard.writeText(calcResult.result);
                    window.electron.hideWindow();
                  }}
                  onMouseMove={() => setSelectedIndex(0)}
                >
                  <div className="flex items-center justify-center gap-6">
                    <div className="text-center">
                      <div className="text-white/80 text-xl font-medium">{calcResult.input}</div>
                      <div className="text-white/35 text-xs mt-1">{calcResult.inputLabel}</div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-white/25 flex-shrink-0" />
                    <div className="text-center">
                      <div className="text-white text-xl font-semibold">{calcResult.result}</div>
                      <div className="text-white/35 text-xs mt-1">{calcResult.resultLabel}</div>
                    </div>
                  </div>
                </div>
              )}

              {[
                { title: 'Pinned', items: groupedCommands.pinned },
                { title: 'Recent', items: groupedCommands.recent },
                { title: 'Other', items: groupedCommands.other },
              ]
                .filter((section) => section.items.length > 0)
                .map((section) => section)
                .reduce(
                  (acc, section) => {
                    const startIndex = acc.index;
                    acc.nodes.push(
                      <div
                        key={`section-${section.title}`}
                        className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-white/50 font-semibold"
                      >
                        {section.title}
                      </div>
                    );
                    section.items.forEach((command, i) => {
                      const flatIndex = startIndex + i;
                      acc.nodes.push(
                        <div
                          key={command.id}
                          ref={(el) => (itemRefs.current[flatIndex + calcOffset] = el)}
                          className={`command-item px-3 py-2 rounded-lg cursor-pointer ${
                            flatIndex + calcOffset === selectedIndex ? 'selected' : ''
                          }`}
                          onClick={() => handleCommandExecute(command)}
                          onMouseMove={() => setSelectedIndex(flatIndex + calcOffset)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setSelectedIndex(flatIndex + calcOffset);
                            setShowActions(false);
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              commandId: command.id,
                            });
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                              {command.iconDataUrl ? (
                                <img
                                  src={command.iconDataUrl}
                                  alt=""
                                  className="w-5 h-5 object-contain"
                                  draggable={false}
                                />
                              ) : command.category === 'system' ? (
                                getSystemCommandFallbackIcon(command.id)
                              ) : command.category === 'extension' ? (
                                <div className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">
                                  <Puzzle className="w-3 h-3 text-purple-400" />
                                </div>
                              ) : (
                                <div className="w-5 h-5 rounded bg-gray-500/20 flex items-center justify-center">
                                  <Settings className="w-3 h-3 text-gray-400" />
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="text-white/95 text-[13px] font-medium truncate tracking-[0.004em]">
                                {command.title}
                              </div>
                            </div>

                            <div className="text-white/55 text-[11px] font-semibold flex-shrink-0">
                              {getCategoryLabel(command.category)}
                            </div>
                          </div>
                        </div>
                      );
                    });
                    acc.index += section.items.length;
                    return acc;
                  },
                  { nodes: [] as React.ReactNode[], index: 0 }
                ).nodes}
            </div>
          )}
        </div>
        
        {/* Footer actions */}
        {!isLoading && (
          <div
            className="flex items-center px-4 py-3.5 border-t border-white/[0.06]"
            style={{ background: 'rgba(28,28,32,0.90)' }}
          >
            <div className="flex items-center gap-2 text-white/50 text-xs flex-1 min-w-0 font-medium truncate">
              {selectedCommand ? selectedCommand.title : `${displayCommands.length} results`}
            </div>
            {selectedActions[0] && (
              <div className="flex items-center gap-2 mr-3">
                <button
                  onClick={() => selectedActions[0].execute()}
                  className="text-white text-xs font-semibold hover:text-white/85 transition-colors"
                >
                  {selectedActions[0].title}
                </button>
                {selectedActions[0].shortcut && (
                  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">
                    {renderShortcutLabel(selectedActions[0].shortcut)}
                  </kbd>
                )}
              </div>
            )}
            <button
              onClick={() => {
                setContextMenu(null);
                setShowActions(true);
              }}
              className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors"
            >
              <span className="text-xs font-medium">Actions</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">K</kbd>
            </button>
          </div>
        )}
      </div>
    </div>
    {showActions && selectedActions.length > 0 && (
      <div
        className="fixed inset-0 z-50"
        onClick={() => setShowActions(false)}
        style={{ background: 'rgba(0,0,0,0.15)' }}
      >
        <div
          ref={actionsOverlayRef}
          className="absolute bottom-12 right-3 w-96 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl outline-none focus:outline-none ring-0 focus:ring-0"
          tabIndex={0}
          onKeyDown={handleActionsOverlayKeyDown}
          style={{
            background: 'rgba(30,30,34,0.97)',
            backdropFilter: 'blur(40px)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex-1 overflow-y-auto py-1">
            {selectedActions.map((action, idx) => (
              <div
                key={action.id}
                className={`mx-1 px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 cursor-pointer transition-colors ${
                  idx === selectedActionIndex
                    ? action.style === 'destructive'
                      ? 'bg-white/[0.10] text-red-400'
                      : 'bg-white/[0.10] text-white'
                    : action.style === 'destructive'
                      ? 'hover:bg-white/[0.06] text-red-400'
                      : 'hover:bg-white/[0.06] text-white/80'
                }`}
                onClick={async () => {
                  await Promise.resolve(action.execute());
                  setShowActions(false);
                  restoreLauncherFocus();
                }}
                onMouseMove={() => setSelectedActionIndex(idx)}
              >
                <span className="flex-1 text-sm truncate">{action.title}</span>
                {action.shortcut && (
                  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] font-medium text-white/70">
                    {renderShortcutLabel(action.shortcut)}
                  </kbd>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
    {contextMenu && contextActions.length > 0 && (
      <div
        className="fixed inset-0 z-50"
        onClick={() => setContextMenu(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu(null);
        }}
      >
        <div
          ref={contextMenuRef}
          className="absolute w-80 max-h-[60vh] rounded-xl overflow-hidden flex flex-col shadow-2xl outline-none focus:outline-none ring-0 focus:ring-0"
          tabIndex={0}
          onKeyDown={handleContextMenuKeyDown}
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 340),
            top: Math.min(contextMenu.y, window.innerHeight - 320),
            background: 'rgba(30,30,34,0.97)',
            backdropFilter: 'blur(40px)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex-1 overflow-y-auto py-1">
            {contextActions.map((action, idx) => (
              <div
                key={`ctx-${action.id}`}
                className={`mx-1 px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 cursor-pointer transition-colors ${
                  idx === selectedContextActionIndex
                    ? action.style === 'destructive'
                      ? 'bg-white/[0.10] text-red-400'
                      : 'bg-white/[0.10] text-white'
                    : action.style === 'destructive'
                      ? 'hover:bg-white/[0.06] text-red-400'
                      : 'hover:bg-white/[0.06] text-white/80'
                }`}
                onClick={async () => {
                  console.log('[CTX-MENU] clicked action:', action.id, action.title);
                  try {
                    await Promise.resolve(action.execute());
                    console.log('[CTX-MENU] action executed successfully');
                  } catch (err) {
                    console.error('[CTX-MENU] action.execute() threw:', err);
                  }
                  setContextMenu(null);
                  restoreLauncherFocus();
                }}
                onMouseMove={() => setSelectedContextActionIndex(idx)}
              >
                <span className="flex-1 text-sm truncate">{action.title}</span>
                {action.shortcut && (
                  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] font-medium text-white/70">
                    {renderShortcutLabel(action.shortcut)}
                  </kbd>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default App;
