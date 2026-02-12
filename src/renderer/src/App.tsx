/**
 * Launcher App
 * 
 * Dynamically displays all applications and System Settings.
 * Shows category labels like Raycast.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Power, Settings, Puzzle, Sparkles, ArrowRight, Clipboard, FileText, Mic, Volume2, Loader2, CornerDownLeft, Brain } from 'lucide-react';
import type { CommandInfo, ExtensionBundle, AppSettings } from '../types/electron';
import ExtensionView from './ExtensionView';
import ClipboardManager from './ClipboardManager';
import SnippetManager from './SnippetManager';
import OnboardingExtension from './OnboardingExtension';
import WhisperOnboardingExtension from './WhisperOnboardingExtension';
import FileSearchExtension from './FileSearchExtension';
import SuperCmdWhisper from './SuperCmdWhisper';
import SuperCmdRead from './SuperCmdRead';
import { tryCalculate } from './smart-calculator';
import { useDetachedPortalWindow } from './useDetachedPortalWindow';
import supercmdLogo from '../../../supercmd.svg';

interface LauncherAction {
  id: string;
  title: string;
  shortcut?: string;
  style?: 'default' | 'destructive';
  enabled?: boolean;
  execute: () => void | Promise<void>;
}

type MemoryFeedback = {
  type: 'success' | 'error';
  text: string;
} | null;

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

function formatShortcutLabel(shortcut: string): string {
  return String(shortcut || '')
    .replace(/Command/g, '\u2318')
    .replace(/Control/g, '\u2303')
    .replace(/Alt/g, '\u2325')
    .replace(/Shift/g, '\u21E7')
    .replace(/Period/g, '.')
    .replace(/\+/g, ' ');
}

function isSuperCmdAppTitle(title: string): boolean {
  const key = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key === 'supercommand' || key === 'supercmd';
}

function isSuperCmdSystemCommand(commandId: string): boolean {
  return (
    commandId === 'system-open-settings' ||
    commandId === 'system-open-ai-settings' ||
    commandId === 'system-open-extensions-settings' ||
    commandId === 'system-open-onboarding' ||
    commandId === 'system-quit-launcher'
  );
}

function renderSuperCmdLogoIcon(): React.ReactNode {
  return (
    <img
      src={supercmdLogo}
      alt=""
      className="w-5 h-5 object-contain"
      draggable={false}
    />
  );
}

function getCommandDisplayTitle(command: CommandInfo): string {
  if (command.category === 'app' && isSuperCmdAppTitle(command.title)) return 'SuperCmd';
  return command.title;
}

function renderCommandIcon(command: CommandInfo): React.ReactNode {
  if (command.category === 'app' && isSuperCmdAppTitle(command.title)) {
    return renderSuperCmdLogoIcon();
  }
  if (command.iconDataUrl) {
    return (
      <img
        src={command.iconDataUrl}
        alt=""
        className="w-5 h-5 object-contain"
        draggable={false}
      />
    );
  }
  if (command.category === 'system') {
    return getSystemCommandFallbackIcon(command.id);
  }
  if (command.category === 'extension') {
    return (
      <div className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">
        <Puzzle className="w-3 h-3 text-purple-400" />
      </div>
    );
  }
  return (
    <div className="w-5 h-5 rounded bg-gray-500/20 flex items-center justify-center">
      <Settings className="w-3 h-3 text-gray-400" />
    </div>
  );
}

function getSystemCommandFallbackIcon(commandId: string): React.ReactNode {
  if (isSuperCmdSystemCommand(commandId)) {
    return renderSuperCmdLogoIcon();
  }

  if (commandId === 'system-cursor-prompt') {
    return (
      <div className="w-5 h-5 rounded bg-violet-500/20 flex items-center justify-center">
        <Sparkles className="w-3 h-3 text-violet-300" />
      </div>
    );
  }

  if (commandId === 'system-add-to-memory') {
    return (
      <div className="w-5 h-5 rounded bg-fuchsia-500/20 flex items-center justify-center">
        <Brain className="w-3 h-3 text-fuchsia-200" />
      </div>
    );
  }

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

  if (commandId === 'system-supercommand-whisper') {
    return (
      <div className="w-5 h-5 rounded bg-sky-500/20 flex items-center justify-center">
        <Mic className="w-3 h-3 text-sky-300" />
      </div>
    );
  }

  if (commandId === 'system-whisper-onboarding') {
    return (
      <div className="w-5 h-5 rounded bg-sky-500/20 flex items-center justify-center">
        <Sparkles className="w-3 h-3 text-sky-200" />
      </div>
    );
  }

  if (commandId === 'system-supercommand-speak') {
    return (
      <div className="w-5 h-5 rounded bg-indigo-500/20 flex items-center justify-center">
        <Volume2 className="w-3 h-3 text-indigo-200" />
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

function parseIntervalToMs(interval?: string): number | null {
  if (!interval) return null;
  const trimmed = interval.trim();
  const match = trimmed.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2].toLowerCase();
  const unitMs =
    unit === 's' ? 1_000 :
    unit === 'm' ? 60_000 :
    unit === 'h' ? 60 * 60_000 :
    24 * 60 * 60_000;
  return value * unitMs;
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
  const [showCursorPrompt, setShowCursorPrompt] = useState(false);
  const [cursorPromptText, setCursorPromptText] = useState('');
  const [cursorPromptStatus, setCursorPromptStatus] = useState<'idle' | 'processing' | 'ready' | 'error'>('idle');
  const [cursorPromptResult, setCursorPromptResult] = useState('');
  const [cursorPromptError, setCursorPromptError] = useState('');
  const [cursorPromptSourceText, setCursorPromptSourceText] = useState('');
  const [showWhisper, setShowWhisper] = useState(false);
  const [showSpeak, setShowSpeak] = useState(false);
  const [showWhisperOnboarding, setShowWhisperOnboarding] = useState(false);
  const [showWhisperHint, setShowWhisperHint] = useState(false);
  const [whisperOnboardingPracticeText, setWhisperOnboardingPracticeText] = useState('');
  const [whisperSpeakToggleLabel, setWhisperSpeakToggleLabel] = useState('\u2318 .');
  const [speakStatus, setSpeakStatus] = useState<{
    state: 'idle' | 'loading' | 'speaking' | 'done' | 'error';
    text: string;
    index: number;
    total: number;
    message?: string;
    wordIndex?: number;
  }>({ state: 'idle', text: '', index: 0, total: 0 });
  const [speakOptions, setSpeakOptions] = useState<{ voice: string; rate: string }>({
    voice: 'en-US-JennyNeural',
    rate: '+0%',
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingRequiresShortcutFix, setOnboardingRequiresShortcutFix] = useState(false);
  const [launcherShortcut, setLauncherShortcut] = useState('Command+Space');
  const [showActions, setShowActions] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    commandId: string;
  } | null>(null);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [selectedContextActionIndex, setSelectedContextActionIndex] = useState(0);
  const [menuBarExtensions, setMenuBarExtensions] = useState<
    Array<{ key: string; bundle: ExtensionBundle }>
  >([]);
  const [backgroundNoViewRuns, setBackgroundNoViewRuns] = useState<
    Array<{ runId: string; bundle: ExtensionBundle }>
  >([]);
  const [aiMode, setAiMode] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [selectedTextSnapshot, setSelectedTextSnapshot] = useState('');
  const [memoryFeedback, setMemoryFeedback] = useState<MemoryFeedback>(null);
  const [memoryActionLoading, setMemoryActionLoading] = useState(false);
  const aiRequestIdRef = useRef<string | null>(null);
  const cursorPromptRequestIdRef = useRef<string | null>(null);
  const cursorPromptResultRef = useRef('');
  const cursorPromptSourceTextRef = useRef('');
  const memoryFeedbackTimerRef = useRef<number | null>(null);
  const aiResponseRef = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);
  const cursorPromptInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const actionsOverlayRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const pinnedCommandsRef = useRef<string[]>([]);
  const extensionViewRef = useRef<ExtensionBundle | null>(null);
  const intervalTimerIdsRef = useRef<number[]>([]);
  const menuBarRemountTimestampsRef = useRef<Record<string, number>>({});
  const whisperSessionRef = useRef(false);
  extensionViewRef.current = extensionView;
  pinnedCommandsRef.current = pinnedCommands;

  const whisperPortalTarget = useDetachedPortalWindow(showWhisper, {
    name: 'supercommand-whisper-window',
    title: 'SuperCmd Whisper',
    width: showWhisperHint ? 620 : 272,
    height: showWhisperHint ? 88 : 52,
    anchor: 'center-bottom',
    onClosed: () => {
      whisperSessionRef.current = false;
      setShowWhisper(false);
    },
  });

  const whisperOnboardingPortalTarget = useDetachedPortalWindow(showWhisperOnboarding, {
    name: 'supercommand-whisper-onboarding-window',
    title: 'SuperCmd Whisper Onboarding',
    width: 920,
    height: 640,
    anchor: 'center',
    onClosed: () => {
      setShowWhisperOnboarding(false);
    },
  });

  const speakPortalTarget = useDetachedPortalWindow(showSpeak, {
    name: 'supercommand-speak-window',
    title: 'SuperCmd Read',
    width: 520,
    height: 112,
    anchor: 'top-right',
    onClosed: () => {
      setShowSpeak(false);
      void window.electron.speakStop();
    },
  });

  const cursorPromptPortalTarget = useDetachedPortalWindow(showCursorPrompt, {
    name: 'supercommand-prompt-window',
    title: 'SuperCmd Prompt',
    width: 500,
    height: 132,
    anchor: 'caret',
    onClosed: () => {
      setShowCursorPrompt(false);
    },
  });

  const restoreLauncherFocus = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const showMemoryFeedback = useCallback((type: 'success' | 'error', text: string) => {
    if (memoryFeedbackTimerRef.current !== null) {
      window.clearTimeout(memoryFeedbackTimerRef.current);
      memoryFeedbackTimerRef.current = null;
    }
    setMemoryFeedback({ type, text });
    memoryFeedbackTimerRef.current = window.setTimeout(() => {
      setMemoryFeedback(null);
      memoryFeedbackTimerRef.current = null;
    }, 2800);
  }, []);

  const refreshSelectedTextSnapshot = useCallback(async () => {
    try {
      const selected = String(await window.electron.getSelectedTextStrict() || '').trim();
      setSelectedTextSnapshot(selected);
    } catch {
      setSelectedTextSnapshot('');
    }
  }, []);

  const appendWhisperOnboardingPracticeText = useCallback((chunk: string) => {
    const nextChunk = String(chunk || '');
    if (!nextChunk.trim()) return;
    setWhisperOnboardingPracticeText((prev) => {
      if (!prev) return nextChunk.trimStart();
      const prevTrim = prev.replace(/\s+$/g, '');
      const needsSpace = /[A-Za-z0-9)]$/.test(prevTrim) && /^[A-Za-z0-9(]/.test(nextChunk.trimStart());
      return needsSpace ? `${prevTrim} ${nextChunk.trimStart()}` : `${prev}${nextChunk}`;
    });
  }, []);

  const upsertMenuBarExtension = useCallback((bundle: ExtensionBundle, options?: { remount?: boolean }) => {
    const remount = Boolean(options?.remount);
    setMenuBarExtensions((prev) => {
      const extName = bundle.extName || bundle.extensionName || '';
      const cmdName = bundle.cmdName || bundle.commandName || '';
      const idx = prev.findIndex(
        (entry) =>
          (entry.bundle.extName || entry.bundle.extensionName) === extName &&
          (entry.bundle.cmdName || entry.bundle.commandName) === cmdName
      );
      if (idx === -1) {
        return [...prev, { key: `${extName}:${cmdName}:${Date.now()}`, bundle }];
      }
      const next = [...prev];
      next[idx] = {
        key: remount ? `${extName}:${cmdName}:${Date.now()}` : next[idx].key,
        bundle,
      };
      return next;
    });
  }, []);

  const remountMenuBarExtensionsForExtension = useCallback((extensionName: string) => {
    const normalized = (extensionName || '').trim();
    if (!normalized) return;
    const now = Date.now();
    const lastTs = menuBarRemountTimestampsRef.current[normalized] || 0;
    if (now - lastTs < 200) return;
    menuBarRemountTimestampsRef.current[normalized] = now;
    setMenuBarExtensions((prev) => {
      let changed = false;
      const next = prev.map((entry) => {
        const entryExt = (entry.bundle.extName || entry.bundle.extensionName || '').trim();
        if (!entryExt || entryExt !== normalized) return entry;
        changed = true;
        const cmdName = entry.bundle.cmdName || entry.bundle.commandName || '';
        return {
          key: `${normalized}:${cmdName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          bundle: entry.bundle,
        };
      });
      return changed ? next : prev;
    });
  }, []);

  const loadLauncherPreferences = useCallback(async () => {
    try {
      const settings = (await window.electron.getSettings()) as AppSettings;
      const shortcutStatus = await window.electron.getGlobalShortcutStatus();
      setPinnedCommands(settings.pinnedCommands || []);
      setRecentCommands(settings.recentCommands || []);
      setLauncherShortcut(settings.globalShortcut || 'Command+Space');
      const speakToggleHotkey = settings.commandHotkeys?.['system-supercommand-whisper-speak-toggle'] || 'Command+.';
      setWhisperSpeakToggleLabel(formatShortcutLabel(speakToggleHotkey));
      const shouldShowOnboarding = !settings.hasSeenOnboarding;
      setShowOnboarding(shouldShowOnboarding);
      setOnboardingRequiresShortcutFix(shouldShowOnboarding && !shortcutStatus.ok);
    } catch (e) {
      console.error('Failed to load launcher preferences:', e);
      setPinnedCommands([]);
      setRecentCommands([]);
      setLauncherShortcut('Command+Space');
      setShowOnboarding(false);
      setOnboardingRequiresShortcutFix(false);
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

    window.electron.onWindowShown((payload) => {
      console.log('[WINDOW-SHOWN] fired', payload);
      const isWhisperMode = payload?.mode === 'whisper';
      const isSpeakMode = payload?.mode === 'speak';
      const isPromptMode = payload?.mode === 'prompt';
      if (isWhisperMode) {
        whisperSessionRef.current = true;
        setSelectedTextSnapshot('');
        setMemoryFeedback(null);
        setMemoryActionLoading(false);
        setShowCursorPrompt(false);
        setShowWhisper(true);
        setShowSpeak(false);
        setShowWhisperOnboarding(false);
        setShowWhisperHint(false);
        setShowSnippetManager(null);
        setShowFileSearch(false);
        setShowClipboardManager(false);
        setShowOnboarding(false);
        setExtensionPreferenceSetup(null);
        setExtensionView(null);
        setAiMode(false);
        return;
      }
      if (isSpeakMode) {
        whisperSessionRef.current = false;
        setSelectedTextSnapshot('');
        setMemoryFeedback(null);
        setMemoryActionLoading(false);
        setShowCursorPrompt(false);
        setShowWhisper(false);
        setShowSpeak(true);
        setShowWhisperOnboarding(false);
        setShowWhisperHint(false);
        setShowSnippetManager(null);
        setShowFileSearch(false);
        setShowClipboardManager(false);
        setShowOnboarding(false);
        setExtensionPreferenceSetup(null);
        setExtensionView(null);
        setAiMode(false);
        return;
      }
      if (isPromptMode) {
        whisperSessionRef.current = false;
        setSelectedTextSnapshot('');
        setMemoryFeedback(null);
        setMemoryActionLoading(false);
        setShowWhisper(false);
        setShowSpeak(false);
        setShowWhisperOnboarding(false);
        setShowWhisperHint(false);
        setShowSnippetManager(null);
        setShowFileSearch(false);
        setShowClipboardManager(false);
        setShowOnboarding(false);
        setExtensionPreferenceSetup(null);
        setExtensionView(null);
        setAiMode(false);
        setCursorPromptText('');
        setCursorPromptStatus('idle');
        setCursorPromptResult('');
        setCursorPromptError('');
        setCursorPromptSourceText('');
        cursorPromptRequestIdRef.current = null;
        setShowCursorPrompt(true);
        return;
      }

      whisperSessionRef.current = false;
      setShowCursorPrompt(false);
      setShowWhisperHint(false);
      setMemoryFeedback(null);
      setMemoryActionLoading(false);
      void refreshSelectedTextSnapshot();

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
  }, [fetchCommands, loadLauncherPreferences, refreshSelectedTextSnapshot]);

  useEffect(() => {
    window.electron.setDetachedOverlayState('whisper', showWhisper);
  }, [showWhisper]);

  useEffect(() => {
    window.electron.setDetachedOverlayState('speak', showSpeak);
  }, [showSpeak]);

  useEffect(() => {
    let disposed = false;
    window.electron.speakGetOptions().then((options) => {
      if (!disposed && options) setSpeakOptions(options);
    }).catch(() => {});
    window.electron.speakGetStatus().then((status) => {
      if (!disposed && status) setSpeakStatus(status);
    }).catch(() => {});
    const disposeSpeak = window.electron.onSpeakStatus((payload) => {
      setSpeakStatus(payload);
    });
    return () => {
      disposed = true;
      disposeSpeak();
    };
  }, []);

  const handleSpeakVoiceChange = useCallback(async (voice: string) => {
    const next = await window.electron.speakUpdateOptions({
      voice,
      restartCurrent: true,
    });
    setSpeakOptions(next);
  }, []);

  const handleSpeakRateChange = useCallback(async (rate: string) => {
    const next = await window.electron.speakUpdateOptions({
      rate,
      restartCurrent: true,
    });
    setSpeakOptions(next);
  }, []);

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
        upsertMenuBarExtension(hydrated, { remount: launchType === 'background' });
        return;
      }

      if (launchType === 'background') {
        if (hydrated.mode === 'no-view') {
          const runId = `${hydrated.extensionName || hydrated.extName}/${hydrated.commandName || hydrated.cmdName}/${Date.now()}`;
          setBackgroundNoViewRuns((prev) => [...prev, { runId, bundle: hydrated }]);
        }
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

  // LocalStorage changes should refresh menu-bar commands for the same extension.
  // This matches Raycast behavior where menu-bar commands observe state changes quickly.
  useEffect(() => {
    const onStorageChanged = (event: Event) => {
      const custom = event as CustomEvent<{ extensionName?: string }>;
      const extensionName = (custom.detail?.extensionName || '').trim();
      if (!extensionName) return;
      remountMenuBarExtensionsForExtension(extensionName);
    };
    window.addEventListener('sc-extension-storage-changed', onStorageChanged as EventListener);
    return () => {
      window.removeEventListener('sc-extension-storage-changed', onStorageChanged as EventListener);
    };
  }, [remountMenuBarExtensionsForExtension]);

  // Launch background-refresh extension commands from manifest `interval`.
  useEffect(() => {
    for (const timerId of intervalTimerIdsRef.current) {
      window.clearInterval(timerId);
    }
    intervalTimerIdsRef.current = [];

    const extensionCommands = commands.filter(
      (cmd) => cmd.category === 'extension' && typeof cmd.interval === 'string' && cmd.path
    );
    if (extensionCommands.length === 0) return;

    for (const cmd of extensionCommands) {
      const ms = parseIntervalToMs(cmd.interval);
      if (!ms) continue;

      const [extName, cmdName] = (cmd.path || '').split('/');
      if (!extName || !cmdName) continue;

      const timerId = window.setInterval(async () => {
        try {
          const result = await window.electron.runExtension(extName, cmdName);
          if (!result || !result.code) return;

          const hydrated = hydrateExtensionBundlePreferences(result);
          if (hydrated.mode !== 'no-view' && hydrated.mode !== 'menu-bar') return;

          const missingPrefs = getMissingRequiredPreferences(hydrated);
          const missingArgs = getMissingRequiredArguments(hydrated);
          if (missingPrefs.length > 0 || missingArgs.length > 0) return;

          window.dispatchEvent(
            new CustomEvent('sc-launch-extension-bundle', {
              detail: {
                bundle: hydrated,
                launchOptions: { type: 'background' },
                source: {
                  commandMode: 'background',
                  extensionName: hydrated.extensionName || hydrated.extName,
                  commandName: hydrated.commandName || hydrated.cmdName,
                },
              },
            })
          );
        } catch (error) {
          console.error('[BackgroundRefresh] Failed to run command:', cmd.id, error);
        }
      }, ms);

      intervalTimerIdsRef.current.push(timerId);
    }

    return () => {
      for (const timerId of intervalTimerIdsRef.current) {
        window.clearInterval(timerId);
      }
      intervalTimerIdsRef.current = [];
    };
  }, [commands]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!showCursorPrompt) return;
    setTimeout(() => cursorPromptInputRef.current?.focus(), 0);
  }, [showCursorPrompt]);

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
          })
          .map((bundle) => ({
            key: `${bundle.extName || bundle.extensionName}:${bundle.cmdName || bundle.commandName}:initial`,
            bundle,
          }));
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

  useEffect(() => {
    void refreshSelectedTextSnapshot();
  }, [refreshSelectedTextSnapshot]);

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

  const submitCursorPrompt = useCallback(async () => {
    const instruction = cursorPromptText.trim();
    if (!instruction || cursorPromptStatus === 'processing') return;

    if (cursorPromptRequestIdRef.current) {
      try {
        await window.electron.aiCancel(cursorPromptRequestIdRef.current);
      } catch {}
      cursorPromptRequestIdRef.current = null;
    }

    setCursorPromptStatus('processing');
    setCursorPromptResult('');
    setCursorPromptError('');
    setCursorPromptSourceText('');
    cursorPromptResultRef.current = '';
    cursorPromptSourceTextRef.current = '';

    const selectedText = String(await window.electron.getSelectedText()).trim();
    const hasSelection = selectedText.length > 0;
    if (hasSelection) {
      setCursorPromptSourceText(selectedText);
      cursorPromptSourceTextRef.current = selectedText;
    }

    const requestId = `cursor-prompt-${Date.now()}`;
    cursorPromptRequestIdRef.current = requestId;
    const compositePrompt = hasSelection
      ? [
          'Rewrite the selected text based on the instruction.',
          'Return only the rewritten text. Do not include explanations.',
          '',
          `Instruction: ${instruction}`,
          '',
          'Selected text:',
          selectedText,
        ].join('\n')
      : [
          'Generate text to insert at the current cursor position, based on the instruction.',
          'Return only the generated text. Do not include explanations.',
          '',
          `Instruction: ${instruction}`,
        ].join('\n');
    await window.electron.aiAsk(requestId, compositePrompt);
  }, [cursorPromptStatus, cursorPromptText]);

  const applyCursorPromptResultToEditor = useCallback(async () => {
    const previousText = cursorPromptSourceTextRef.current;
    const nextText = String(cursorPromptResultRef.current || '').trim();
    if (!nextText) {
      setCursorPromptStatus('error');
      setCursorPromptError('Model returned an empty response.');
      return;
    }
    const applied = previousText
      ? await window.electron.replaceLiveText(previousText, nextText)
      : await window.electron.typeTextLive(nextText);
    if (applied) {
      setCursorPromptStatus('ready');
      setCursorPromptError('');
      return;
    }
    setCursorPromptStatus('error');
    setCursorPromptError('Could not apply update. Re-select text or place cursor and try again.');
  }, []);

  const closeCursorPrompt = useCallback(async () => {
    if (cursorPromptRequestIdRef.current) {
      try {
        await window.electron.aiCancel(cursorPromptRequestIdRef.current);
      } catch {}
      cursorPromptRequestIdRef.current = null;
    }
    setShowCursorPrompt(false);
    window.electron.hideWindow();
  }, []);

  // AI streaming listeners
  useEffect(() => {
    const handleChunk = (data: { requestId: string; chunk: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        setAiResponse((prev) => prev + data.chunk);
        return;
      }
      if (data.requestId === cursorPromptRequestIdRef.current) {
        cursorPromptResultRef.current += data.chunk;
        setCursorPromptResult((prev) => prev + data.chunk);
      }
    };
    const handleDone = (data: { requestId: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        setAiStreaming(false);
        return;
      }
      if (data.requestId === cursorPromptRequestIdRef.current) {
        cursorPromptRequestIdRef.current = null;
        void applyCursorPromptResultToEditor();
      }
    };
    const handleError = (data: { requestId: string; error: string }) => {
      if (data.requestId === aiRequestIdRef.current) {
        setAiResponse((prev) => prev + `\n\nError: ${data.error}`);
        setAiStreaming(false);
        return;
      }
      if (data.requestId === cursorPromptRequestIdRef.current) {
        cursorPromptRequestIdRef.current = null;
        setCursorPromptStatus('error');
        setCursorPromptError(data.error || 'Failed to process this prompt.');
      }
    };

    window.electron.onAIStreamChunk(handleChunk);
    window.electron.onAIStreamDone(handleDone);
    window.electron.onAIStreamError(handleError);
  }, [applyCursorPromptResultToEditor]);

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
    if (!showActions && !contextMenu && !aiMode && !extensionView && !showClipboardManager && !showSnippetManager && !showFileSearch && !showCursorPrompt && !showWhisper && !showSpeak && !showOnboarding) {
      restoreLauncherFocus();
    }
  }, [showActions, contextMenu, aiMode, extensionView, showClipboardManager, showSnippetManager, showFileSearch, showCursorPrompt, showWhisper, showSpeak, showOnboarding, showWhisperOnboarding, restoreLauncherFocus]);

  useEffect(() => {
    return () => {
      if (memoryFeedbackTimerRef.current !== null) {
        window.clearTimeout(memoryFeedbackTimerRef.current);
        memoryFeedbackTimerRef.current = null;
      }
    };
  }, []);

  const calcResult = useMemo(() => {
    return searchQuery ? tryCalculate(searchQuery) : null;
  }, [searchQuery]);
  const calcOffset = calcResult ? 1 : 0;
  const contextualCommands = useMemo(() => {
    const hasSelection = selectedTextSnapshot.trim().length > 0;
    return commands.filter((command) => {
      if (command.id === 'system-add-to-memory') return hasSelection;
      return true;
    });
  }, [commands, selectedTextSnapshot]);
  const filteredCommands = useMemo(
    () => filterCommands(contextualCommands, searchQuery),
    [contextualCommands, searchQuery]
  );

  // When calculator is showing but no commands match, show unfiltered list below
  const sourceCommands =
    calcResult && filteredCommands.length === 0 ? contextualCommands : filteredCommands;

  const groupedCommands = useMemo(() => {
    const sourceMap = new Map(sourceCommands.map((cmd) => [cmd.id, cmd]));
    const hasSelection = selectedTextSnapshot.trim().length > 0;
    const contextual = hasSelection
      ? (sourceMap.get('system-add-to-memory') ? [sourceMap.get('system-add-to-memory') as CommandInfo] : [])
      : [];
    const contextualIds = new Set(contextual.map((c) => c.id));

    const pinned = pinnedCommands
      .map((id) => sourceMap.get(id))
      .filter((cmd): cmd is CommandInfo => Boolean(cmd) && !contextualIds.has((cmd as CommandInfo).id));
    const pinnedSet = new Set(pinned.map((c) => c.id));

    const recent = recentCommands
      .map((id) => sourceMap.get(id))
      .filter(
        (c): c is CommandInfo =>
          Boolean(c) &&
          !pinnedSet.has((c as CommandInfo).id) &&
          !contextualIds.has((c as CommandInfo).id)
      );
    const recentSet = new Set(recent.map((c) => c.id));

    const other = sourceCommands.filter(
      (c) => !pinnedSet.has(c.id) && !recentSet.has(c.id) && !contextualIds.has(c.id)
    );

    return { contextual, pinned, recent, other };
  }, [sourceCommands, pinnedCommands, recentCommands, selectedTextSnapshot]);

  const displayCommands = useMemo(
    () => [
      ...groupedCommands.contextual,
      ...groupedCommands.pinned,
      ...groupedCommands.recent,
      ...groupedCommands.other,
    ],
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
      whisperSessionRef.current = false;
      setShowCursorPrompt(false);
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowClipboardManager(false);
      setShowSnippetManager(null);
      setShowFileSearch(false);
      setShowWhisper(false);
      setShowSpeak(false);
      setShowWhisperOnboarding(false);
      setShowWhisperHint(false);
      setAiMode(false);
      setShowOnboarding(true);
      return true;
    }
    if (commandId === 'system-whisper-onboarding') {
      whisperSessionRef.current = false;
      setShowCursorPrompt(false);
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowClipboardManager(false);
      setShowSnippetManager(null);
      setShowFileSearch(false);
      setShowWhisper(true);
      setShowSpeak(false);
      setShowOnboarding(false);
      setShowWhisperHint(false);
      setAiMode(false);
      setWhisperOnboardingPracticeText('');
      setShowWhisperOnboarding(true);
      return true;
    }
    if (commandId === 'system-clipboard-manager') {
      whisperSessionRef.current = false;
      setShowCursorPrompt(false);
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowOnboarding(false);
      setShowClipboardManager(true);
      setShowSnippetManager(null);
      setShowFileSearch(false);
      setShowWhisper(false);
      setShowSpeak(false);
      setShowWhisperOnboarding(false);
      setShowWhisperHint(false);
      setAiMode(false);
      return true;
    }
    if (commandId === 'system-search-snippets') {
      whisperSessionRef.current = false;
      setShowCursorPrompt(false);
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowOnboarding(false);
      setShowClipboardManager(false);
      setShowFileSearch(false);
      setShowWhisper(false);
      setShowSpeak(false);
      setShowWhisperOnboarding(false);
      setShowWhisperHint(false);
      setAiMode(false);
      setShowSnippetManager('search');
      return true;
    }
    if (commandId === 'system-create-snippet') {
      whisperSessionRef.current = false;
      setShowCursorPrompt(false);
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowOnboarding(false);
      setShowClipboardManager(false);
      setShowFileSearch(false);
      setShowWhisper(false);
      setShowSpeak(false);
      setShowWhisperOnboarding(false);
      setShowWhisperHint(false);
      setAiMode(false);
      setShowSnippetManager('create');
      return true;
    }
    if (commandId === 'system-search-files') {
      whisperSessionRef.current = false;
      setShowCursorPrompt(false);
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowOnboarding(false);
      setShowClipboardManager(false);
      setShowSnippetManager(null);
      setAiMode(false);
      setShowFileSearch(true);
      setShowWhisper(false);
      setShowSpeak(false);
      setShowWhisperOnboarding(false);
      setShowWhisperHint(false);
      return true;
    }
    if (commandId === 'system-add-to-memory') {
      if (memoryActionLoading) return true;
      setMemoryActionLoading(true);
      setMemoryFeedback(null);
      const selectedText = String(await window.electron.getSelectedTextStrict() || '').trim();
      if (!selectedText) {
        setSelectedTextSnapshot('');
        setMemoryActionLoading(false);
        showMemoryFeedback('error', 'No selected text found.');
        return true;
      }
      try {
        const result = await window.electron.memoryAdd({
          text: selectedText,
          source: 'launcher-selection',
        });
        if (!result.success) {
          console.error('[Mem0] Failed to add memory:', result.error || 'Unknown error');
          showMemoryFeedback('error', result.error || 'Failed to add to memory.');
          return true;
        }
        setSelectedTextSnapshot('');
        setSearchQuery('');
        setSelectedIndex(0);
        showMemoryFeedback('success', 'Added selected text to memory.');
      } finally {
        setMemoryActionLoading(false);
      }
      return true;
    }
    if (commandId === 'system-cursor-prompt') {
      await window.electron.executeCommand(commandId);
      return true;
    }
    if (commandId === 'system-supercommand-whisper') {
      whisperSessionRef.current = true;
      setShowCursorPrompt(false);
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowOnboarding(false);
      setShowClipboardManager(false);
      setShowSnippetManager(null);
      setShowFileSearch(false);
      setAiMode(false);
      setShowSpeak(false);
      setShowWhisperHint(false);
      const settings = (await window.electron.getSettings()) as AppSettings;
      if (!settings.hasSeenWhisperOnboarding) {
        setWhisperOnboardingPracticeText('');
        setShowWhisperOnboarding(true);
        setShowWhisper(true);
      } else {
        setShowWhisper(true);
      }
      return true;
    }
    if (commandId === 'system-supercommand-speak') {
      whisperSessionRef.current = false;
      setShowCursorPrompt(false);
      setExtensionView(null);
      setExtensionPreferenceSetup(null);
      setShowOnboarding(false);
      setShowClipboardManager(false);
      setShowSnippetManager(null);
      setShowFileSearch(false);
      setAiMode(false);
      setShowWhisper(false);
      setShowSpeak(true);
      setShowWhisperOnboarding(false);
      setShowWhisperHint(false);
      return true;
    }
    if (commandId === 'system-supercommand-speak-close') {
      setShowSpeak(false);
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
  }, [memoryActionLoading, showMemoryFeedback]);

  useEffect(() => {
    window.electron.onRunSystemCommand(async (commandId: string) => {
      try {
        await runLocalSystemCommand(commandId);
      } catch (error) {
        console.error('Failed to run system command from main process:', error);
      }
    });
  }, [runLocalSystemCommand]);

  useEffect(() => {
    if (!showWhisperHint || !showWhisper) return;
    const timer = window.setTimeout(() => setShowWhisperHint(false), 7000);
    return () => window.clearTimeout(timer);
  }, [showWhisperHint, showWhisper]);

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
      {menuBarExtensions.map((entry) => (
        <ExtensionView
          key={`menubar-${entry.key}`}
          code={entry.bundle.code}
          title={entry.bundle.title}
          mode="menu-bar"
          extensionName={(entry.bundle as any).extensionName || entry.bundle.extName}
          extensionDisplayName={(entry.bundle as any).extensionDisplayName}
          extensionIconDataUrl={(entry.bundle as any).extensionIconDataUrl}
          commandName={(entry.bundle as any).commandName || entry.bundle.cmdName}
          assetsPath={(entry.bundle as any).assetsPath}
          supportPath={(entry.bundle as any).supportPath}
          owner={(entry.bundle as any).owner}
          preferences={(entry.bundle as any).preferences}
          launchArguments={(entry.bundle as any).launchArguments}
          launchContext={(entry.bundle as any).launchContext}
          fallbackText={(entry.bundle as any).fallbackText}
          launchType={(entry.bundle as any).launchType}
          onClose={() => {}}
        />
      ))}
    </div>
  ) : null;

  const backgroundNoViewRunner = backgroundNoViewRuns.length > 0 ? (
    <div style={{ display: 'none', position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {backgroundNoViewRuns.map((run) => (
        <ExtensionView
          key={`bg-no-view-${run.runId}`}
          code={run.bundle.code}
          title={run.bundle.title}
          mode="no-view"
          extensionName={(run.bundle as any).extensionName || run.bundle.extName}
          extensionDisplayName={(run.bundle as any).extensionDisplayName}
          extensionIconDataUrl={(run.bundle as any).extensionIconDataUrl}
          commandName={(run.bundle as any).commandName || run.bundle.cmdName}
          assetsPath={(run.bundle as any).assetsPath}
          supportPath={(run.bundle as any).supportPath}
          owner={(run.bundle as any).owner}
          preferences={(run.bundle as any).preferences}
          launchArguments={(run.bundle as any).launchArguments}
          launchContext={(run.bundle as any).launchContext}
          fallbackText={(run.bundle as any).fallbackText}
          launchType="background"
          onClose={() => {
            setBackgroundNoViewRuns((prev) => prev.filter((item) => item.runId !== run.runId));
          }}
        />
      ))}
    </div>
  ) : null;

  const hiddenExtensionRunners = (
    <>
      {menuBarRunner}
      {backgroundNoViewRunner}
    </>
  );

  const detachedOverlayRunners = (
    <>
      {showWhisper && whisperPortalTarget ? (
        <SuperCmdWhisper
          portalTarget={whisperPortalTarget}
          onboardingCaptureMode={showWhisperOnboarding}
          onOnboardingTranscriptAppend={appendWhisperOnboardingPracticeText}
          coachmarkText={
            showWhisperHint
              ? `Whisper sits here. Hold ${whisperSpeakToggleLabel} to talk, release to type.`
              : undefined
          }
          onClose={() => {
            whisperSessionRef.current = false;
            setShowWhisper(false);
            setShowWhisperHint(false);
          }}
        />
      ) : null}
      {showWhisperOnboarding && whisperOnboardingPortalTarget
        ? createPortal(
            <WhisperOnboardingExtension
              speakToggleShortcutLabel={whisperSpeakToggleLabel}
              practiceText={whisperOnboardingPracticeText}
              onPracticeTextChange={setWhisperOnboardingPracticeText}
              onClose={() => {
                setShowWhisperOnboarding(false);
                setShowWhisperHint(false);
              }}
              onComplete={async () => {
                await window.electron.saveSettings({ hasSeenWhisperOnboarding: true });
                setShowWhisperOnboarding(false);
                setShowWhisper(true);
                setShowWhisperHint(true);
              }}
            />,
            whisperOnboardingPortalTarget
          )
        : null}
      {showSpeak && speakPortalTarget ? (
        <SuperCmdRead
          status={speakStatus}
          voice={speakOptions.voice}
          rate={speakOptions.rate}
          portalTarget={speakPortalTarget}
          onVoiceChange={handleSpeakVoiceChange}
          onRateChange={handleSpeakRateChange}
          onClose={() => {
            setShowSpeak(false);
            void window.electron.speakStop();
          }}
        />
      ) : null}
      {showCursorPrompt && cursorPromptPortalTarget
        ? createPortal(
            <div className="w-full h-full p-1">
              <div className="cursor-prompt-surface h-full flex flex-col gap-1.5 px-3.5 py-2.5">
                <div className="cursor-prompt-topbar">
                  <button
                    onClick={() => void closeCursorPrompt()}
                    className="cursor-prompt-close"
                    aria-label="Close prompt"
                    title="Close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <textarea
                    ref={cursorPromptInputRef}
                    value={cursorPromptText}
                    onChange={(e) => setCursorPromptText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void submitCursorPrompt();
                      }
                    }}
                    placeholder="Tell AI what to do with selected text..."
                    className="cursor-prompt-textarea w-full bg-transparent border-none outline-none text-white/95 placeholder-white/42 text-[13px] font-medium tracking-[0.003em]"
                    autoFocus
                  />
                  {cursorPromptStatus === 'ready' && cursorPromptResult.trim() ? (
                    <div className="sr-only">{cursorPromptResult}</div>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="cursor-prompt-feedback">
                    {cursorPromptStatus === 'processing' && (
                      <div className="cursor-prompt-inline-status">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Processing...</span>
                      </div>
                    )}
                    {cursorPromptStatus === 'error' && cursorPromptError && (
                      <div className="cursor-prompt-error">{cursorPromptError}</div>
                    )}
                    {cursorPromptStatus === 'ready' && cursorPromptResult.trim() && (
                      <div className="cursor-prompt-success">Ready to apply</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {cursorPromptStatus === 'ready' && cursorPromptResult.trim() && (
                      <button
                        onClick={() => void acceptCursorPrompt()}
                        className="cursor-prompt-submit"
                        title="Apply update"
                      >
                        Accept
                      </button>
                    )}
                    <button
                      onClick={() => void submitCursorPrompt()}
                      className="cursor-prompt-submit"
                      disabled={!cursorPromptText.trim() || cursorPromptStatus === 'processing'}
                      title="Submit prompt"
                    >
                      <CornerDownLeft className="w-3 h-3" />
                      <span>Enter</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            cursorPromptPortalTarget
          )
        : null}
    </>
  );

  const alwaysMountedRunners = (
    <>
      {hiddenExtensionRunners}
      {detachedOverlayRunners}
    </>
  );

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
        {alwaysMountedRunners}
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
                    const argType = arg.type || 'text';
                    return (
                      <div key={`arg:${arg.name}`} className="space-y-1">
                        <label className="text-xs text-white/70 font-medium">
                          {arg.title || arg.name}
                          {arg.required ? <span className="text-red-400"> *</span> : null}
                        </label>
                        {argType === 'dropdown' ? (
                          <select
                            value={typeof value === 'string' ? value : ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setExtensionPreferenceSetup((prev) => prev ? {
                                ...prev,
                                argumentValues: { ...prev.argumentValues, [arg.name]: v },
                              } : prev);
                            }}
                            className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-3 py-2 text-sm text-white/90 outline-none"
                          >
                            <option value="">Select an option</option>
                            {(arg.data || []).map((opt) => (
                              <option key={opt?.value || opt?.title} value={opt?.value || ''}>
                                {opt?.title || opt?.value || ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={argType === 'password' ? 'password' : 'text'}
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
                        )}
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
        {alwaysMountedRunners}
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
        {alwaysMountedRunners}
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

  // ─── Cursor Prompt mode ───────────────────────────────────────────
  if (showCursorPrompt && !cursorPromptPortalTarget) {
    return (
      <>
        {alwaysMountedRunners}
        <div className="w-full h-full p-1">
          <div className="cursor-prompt-surface h-full flex flex-col gap-1.5 px-3.5 py-2.5">
            <div className="cursor-prompt-topbar">
              <button
                onClick={() => void closeCursorPrompt()}
                className="cursor-prompt-close"
                aria-label="Close prompt"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 min-w-0">
              <textarea
                ref={cursorPromptInputRef}
                value={cursorPromptText}
                onChange={(e) => setCursorPromptText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submitCursorPrompt();
                  }
                }}
                placeholder="Tell AI what to do with selected text..."
                className="cursor-prompt-textarea w-full bg-transparent border-none outline-none text-white/95 placeholder-white/42 text-[13px] font-medium tracking-[0.003em]"
                autoFocus
              />
              {cursorPromptStatus === 'ready' && cursorPromptResult.trim() && (
                <div className="sr-only">{cursorPromptResult}</div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="cursor-prompt-feedback">
                {cursorPromptStatus === 'processing' && (
                  <div className="cursor-prompt-inline-status">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing...</span>
                  </div>
                )}
                {cursorPromptStatus === 'error' && cursorPromptError && (
                  <div className="cursor-prompt-error">{cursorPromptError}</div>
                )}
                {cursorPromptStatus === 'ready' && cursorPromptResult.trim() && (
                  <div className="cursor-prompt-success">Applied in editor</div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
              <button
                onClick={() => void submitCursorPrompt()}
                className="cursor-prompt-submit"
                disabled={!cursorPromptText.trim() || cursorPromptStatus === 'processing'}
                title="Submit prompt"
              >
                <CornerDownLeft className="w-3 h-3" />
                <span>Enter</span>
              </button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ─── Snippet Manager mode ─────────────────────────────────────────
  if (showSnippetManager) {
    return (
      <>
        {alwaysMountedRunners}
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
        {alwaysMountedRunners}
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
        {alwaysMountedRunners}
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
        {alwaysMountedRunners}
        <OnboardingExtension
          initialShortcut={launcherShortcut}
          requireWorkingShortcut={onboardingRequiresShortcutFix}
          onClose={() => {
            setShowOnboarding(false);
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          onComplete={async () => {
            await window.electron.saveSettings({ hasSeenOnboarding: true });
            setShowOnboarding(false);
            setOnboardingRequiresShortcutFix(false);
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
    {alwaysMountedRunners}
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
                { title: 'Selected Text', items: groupedCommands.contextual },
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
                              {renderCommandIcon(command)}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="text-white/95 text-[13px] font-medium truncate tracking-[0.004em]">
                                {getCommandDisplayTitle(command)}
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
            <div
              className={`flex items-center gap-2 text-xs flex-1 min-w-0 font-medium truncate ${
                memoryActionLoading
                  ? 'text-white/60'
                  : memoryFeedback
                  ? memoryFeedback.type === 'success'
                    ? 'text-emerald-300'
                    : 'text-red-300'
                  : 'text-white/50'
              }`}
            >
              {memoryActionLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                  <span>Adding to memory...</span>
                </>
              ) : memoryFeedback
                ? memoryFeedback.text
                : selectedCommand
                  ? (
                    <>
                      <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {renderCommandIcon(selectedCommand)}
                      </span>
                      <span className="truncate">{getCommandDisplayTitle(selectedCommand)}</span>
                    </>
                  )
                  : `${displayCommands.length} results`}
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
