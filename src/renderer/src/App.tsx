/**
 * Launcher App
 *
 * Dynamically displays all applications and System Settings.
 * Shows category labels like Raycast.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, ArrowRight } from 'lucide-react';
import type {
  CommandInfo,
  ExtensionBundle,
  AppSettings,
  QuickLinkDynamicField,
  IndexedFileSearchResult,
} from '../types/electron';
import ExtensionView from './ExtensionView';
import ClipboardManager from './ClipboardManager';
import SnippetManager from './SnippetManager';
import QuickLinkManager from './QuickLinkManager';
import CameraExtension from './CameraExtension';
import OnboardingExtension from './OnboardingExtension';
import FileSearchExtension from './FileSearchExtension';
import SuperCmdWhisper from './SuperCmdWhisper';
import SuperCmdRead from './SuperCmdRead';
import WindowManagerPanel, {
  executeWindowManagementPresetCommandById,
  isWindowManagementPresetCommandId,
} from './WindowManagerPanel';
import { tryCalculate, tryCalculateAsync } from './smart-calculator';
import { useDetachedPortalWindow } from './useDetachedPortalWindow';
import { useAppViewManager } from './hooks/useAppViewManager';
import { useAiChat } from './hooks/useAiChat';
import { useCursorPrompt } from './hooks/useCursorPrompt';
import { useMenuBarExtensions } from './hooks/useMenuBarExtensions';
import { useBackgroundRefresh } from './hooks/useBackgroundRefresh';
import { useSpeakManager } from './hooks/useSpeakManager';
import { useWhisperManager } from './hooks/useWhisperManager';
import { useInlineArgumentAnchor } from './hooks/useInlineArgumentAnchor';
import { LAST_EXT_KEY, MAX_RECENT_COMMANDS } from './utils/constants';
import { applyBaseColor } from './utils/base-color';
import { resetAccessToken } from './raycast-api';
import {
  type LauncherAction, type MemoryFeedback,
  filterCommands, formatShortcutLabel, getCategoryLabel,
  renderCommandIcon, getCommandDisplayTitle,
  getCommandAccessoryLabel,
  getCommandTypeBadgeLabel,
  renderShortcutLabel,
} from './utils/command-helpers';
import {
  readJsonObject, writeJsonObject,
  getCmdArgsKey,
  getScriptCmdArgsKey,
  hydrateExtensionBundlePreferences,
  shouldOpenCommandSetup,
  getMissingRequiredScriptArguments, toScriptArgumentMapFromArray,
} from './utils/extension-preferences';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';
import { refreshThemeFromStorage, setForcedTheme } from './utils/theme';
import { applyUiStyle } from './utils/ui-style';
import ScriptCommandSetupView from './views/ScriptCommandSetupView';
import ScriptCommandOutputView from './views/ScriptCommandOutputView';
import ExtensionPreferenceSetupView from './views/ExtensionPreferenceSetupView';
import AiChatView from './views/AiChatView';
import CursorPromptView from './views/CursorPromptView';
import InlineArgumentField, { InlineArgumentLeadingIcon, InlineArgumentOverflowBadge } from './components/InlineArgumentField';

const STALE_OVERLAY_RESET_MS = 60_000;
const MAX_RECENT_SECTION_ITEMS = 5;
const QUICK_LINK_COMMAND_PREFIX = 'quicklink-';

function getQuickLinkIdFromCommandId(commandId: string): string | null {
  const normalized = String(commandId || '').trim();
  if (!normalized.startsWith(QUICK_LINK_COMMAND_PREFIX)) return null;
  const id = normalized.slice(QUICK_LINK_COMMAND_PREFIX.length).trim();
  return id || null;
}

const FILE_RESULT_COMMAND_PREFIX = 'system-file-result:';
const MAX_LAUNCHER_FILE_RESULTS = 30;
const MAX_LAUNCHER_FILE_CANDIDATE_RESULTS = 3000;
const MAX_LAUNCHER_FILE_RESULT_ICONS = MAX_LAUNCHER_FILE_RESULTS;
const MIN_LAUNCHER_FILE_QUERY_LENGTH = 2;
const MAX_INLINE_EXTENSION_ARGUMENTS = 3;
const MAX_INLINE_QUICK_LINK_ARGUMENTS = 3;

function asTildePath(filePath: string, homeDir: string): string {
  if (!homeDir) return filePath;
  if (filePath === homeDir) return '~';
  if (filePath.startsWith(homeDir)) {
    return `~${filePath.slice(homeDir.length) || '/'}`;
  }
  return filePath;
}

function buildFileResultCommandId(filePath: string): string {
  return `${FILE_RESULT_COMMAND_PREFIX}${encodeURIComponent(filePath)}`;
}

function normalizeLauncherFileSearchText(value: string): string {
  return String(value || '').normalize('NFKD').toLowerCase();
}

function getLauncherFileSearchTerms(rawQuery: string): string[] {
  return normalizeLauncherFileSearchText(rawQuery)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function normalizeLauncherPathForMatch(value: string): string {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/\\/g, '/');
}

function isPathLikeLauncherFileQuery(rawQuery: string): boolean {
  const trimmed = String(rawQuery || '').trim();
  return trimmed.includes('/') || trimmed.startsWith('~');
}

function matchesLauncherPathQuery(filePath: string, rawQuery: string, homeDir: string): boolean {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) return true;
  const normalizedPath = normalizeLauncherPathForMatch(filePath);
  const normalizedRawQuery = normalizeLauncherPathForMatch(trimmed);
  if (!normalizedRawQuery) return true;

  if (normalizedPath.includes(normalizedRawQuery)) return true;

  if (trimmed.startsWith('~') && homeDir) {
    const expanded = `${homeDir}${trimmed.slice(1)}`;
    const normalizedExpanded = normalizeLauncherPathForMatch(expanded);
    if (normalizedExpanded && normalizedPath.includes(normalizedExpanded)) return true;
  }

  const tildePath = normalizeLauncherPathForMatch(asTildePath(filePath, homeDir));
  return Boolean(tildePath && tildePath.includes(normalizedRawQuery));
}

function splitLauncherFileNameTokens(fileName: string): string[] {
  return normalizeLauncherFileSearchText(fileName)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesLauncherFileNameTerms(fileName: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const normalizedName = normalizeLauncherFileSearchText(fileName);
  const tokens = splitLauncherFileNameTokens(fileName);
  return terms.every((term) => {
    if (/[^a-z0-9]/i.test(term)) {
      return normalizedName.includes(term);
    }
    return tokens.some((token) => token.startsWith(term));
  });
}

function getFileResultPathFromCommand(command: CommandInfo | null | undefined): string | null {
  if (!command) return null;
  if (command.id.startsWith(FILE_RESULT_COMMAND_PREFIX)) {
    if (command.path) return String(command.path);
    const encoded = command.id.slice(FILE_RESULT_COMMAND_PREFIX.length);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }
  return null;
}

function getExtensionIdentityFromCommand(
  command: CommandInfo | null | undefined
): { extName: string; cmdName: string } | null {
  if (!command || command.category !== 'extension' || !command.path) return null;
  const rawPath = String(command.path || '').trim();
  const separatorIndex = rawPath.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= rawPath.length - 1) return null;
  const extName = rawPath.slice(0, separatorIndex).trim();
  const cmdName = rawPath.slice(separatorIndex + 1).trim();
  if (!extName || !cmdName) return null;
  return { extName, cmdName };
}

function isEditableElement(element: Element | null): boolean {
  const target = element as HTMLElement | null;
  if (!target) return false;
  const tagName = String(target.tagName || '').toUpperCase();
  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
}

function normalizeQuickLinkDynamicFields(fields: QuickLinkDynamicField[]): QuickLinkDynamicField[] {
  const map = new Map<string, QuickLinkDynamicField>();
  for (const field of fields || []) {
    const rawKey = String(field?.key || field?.name || '').trim();
    if (!rawKey) continue;
    const normalizedKey = rawKey.toLowerCase();
    if (map.has(normalizedKey)) continue;
    map.set(normalizedKey, {
      key: rawKey,
      name: String(field?.name || rawKey),
      defaultValue: field?.defaultValue,
    });
  }
  return Array.from(map.values());
}

const App: React.FC = () => {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [commandAliases, setCommandAliases] = useState<Record<string, string>>({});
  const [pinnedCommands, setPinnedCommands] = useState<string[]>([]);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [recentCommandLaunchCounts, setRecentCommandLaunchCounts] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [inlineExtensionArgumentValues, setInlineExtensionArgumentValues] = useState<
    Record<string, Record<string, string>>
  >({});
  const [inlineQuickLinkDynamicFieldsById, setInlineQuickLinkDynamicFieldsById] = useState<
    Record<string, QuickLinkDynamicField[]>
  >({});
  const [inlineQuickLinkDynamicValuesById, setInlineQuickLinkDynamicValuesById] = useState<
    Record<string, Record<string, string>>
  >({});
  const [launcherFileResults, setLauncherFileResults] = useState<IndexedFileSearchResult[]>([]);
  const [launcherFileIcons, setLauncherFileIcons] = useState<Record<string, string>>({});
  const [fileSearchInitialDetailPath, setFileSearchInitialDetailPath] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const homeDir = String((window.electron as any).homeDir || '');
  const {
    extensionView, extensionPreferenceSetup, scriptCommandSetup, scriptCommandOutput,
    showClipboardManager, showSnippetManager, showQuickLinkManager, showFileSearch, showCursorPrompt,
    showWhisper, showSpeak, showCamera, showWindowManager, showWhisperOnboarding, showWhisperHint, showOnboarding, aiMode,
    openOnboarding, openWhisper, openClipboardManager,
    openSnippetManager, openQuickLinkManager, openFileSearch, openCursorPrompt, openSpeak, openCamera, openWindowManager,
    setExtensionView, setExtensionPreferenceSetup, setScriptCommandSetup, setScriptCommandOutput,
    setShowClipboardManager, setShowSnippetManager, setShowQuickLinkManager, setShowFileSearch, setShowCursorPrompt,
    setShowWhisper, setShowSpeak, setShowCamera, setShowWindowManager, setShowWhisperOnboarding, setShowWhisperHint,
    setShowOnboarding, setAiMode,
  } = useAppViewManager();
  const {
    whisperOnboardingPracticeText, setWhisperOnboardingPracticeText,
    whisperSpeakToggleLabel, setWhisperSpeakToggleLabel,
    whisperSessionRef,
    appendWhisperOnboardingPracticeText,
    whisperPortalTarget,
  } = useWhisperManager({
    showWhisper, setShowWhisper,
    showWhisperOnboarding, setShowWhisperOnboarding,
    showWhisperHint, setShowWhisperHint,
  });
  const {
    speakStatus, speakOptions,
    setConfiguredEdgeTtsVoice, setConfiguredTtsModel,
    readVoiceOptions,
    handleSpeakVoiceChange, handleSpeakRateChange,
    speakPortalTarget,
  } = useSpeakManager({ showSpeak, setShowSpeak });
  const [onboardingRequiresShortcutFix, setOnboardingRequiresShortcutFix] = useState(false);
  const [onboardingHotkeyPresses, setOnboardingHotkeyPresses] = useState(0);
  const [launcherShortcut, setLauncherShortcut] = useState('Alt+Space');
  const [showActions, setShowActions] = useState(false);
  const [actionsCommand, setActionsCommand] = useState<CommandInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    command: CommandInfo;
  } | null>(null);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [selectedContextActionIndex, setSelectedContextActionIndex] = useState(0);
  const [quickLinkDynamicPrompt, setQuickLinkDynamicPrompt] = useState<{
    command: CommandInfo;
    quickLinkId: string;
    fields: QuickLinkDynamicField[];
    values: Record<string, string>;
  } | null>(null);
  const {
    menuBarExtensions,
    backgroundNoViewRuns, setBackgroundNoViewRuns,
    isMenuBarExtensionMounted,
    hideMenuBarExtension,
    upsertMenuBarExtension,
  } = useMenuBarExtensions();
  const [selectedTextSnapshot, setSelectedTextSnapshot] = useState('');
  const [memoryFeedback, setMemoryFeedback] = useState<MemoryFeedback>(null);
  const [memoryActionLoading, setMemoryActionLoading] = useState(false);
  const memoryFeedbackTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inlineArgumentLaneRef = useRef<HTMLDivElement>(null);
  const inlineArgumentClusterRef = useRef<HTMLDivElement>(null);
  const inlineArgumentInputRefs = useRef<Array<HTMLInputElement | HTMLSelectElement | null>>([]);
  const inlineQuickLinkInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const fileSearchRequestSeqRef = useRef(0);
  const commandsRef = useRef<CommandInfo[]>([]);
  const showActionsRef = useRef(false);
  const selectedCommandRef = useRef<CommandInfo | null>(null);
  commandsRef.current = commands;

  const restoreLauncherFocus = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const queueNoViewBundleRun = useCallback((
    bundle: ExtensionBundle,
    launchType: 'userInitiated' | 'background' = 'userInitiated'
  ) => {
    const runId = `${bundle.extensionName || bundle.extName}/${bundle.commandName || bundle.cmdName}/${Date.now()}`;
    setBackgroundNoViewRuns((prev) => [...prev, { runId, bundle, launchType }]);
  }, [setBackgroundNoViewRuns]);

  const onExitAiMode = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const {
    aiResponse, aiStreaming, aiAvailable, aiQuery, setAiQuery,
    aiResponseRef, aiInputRef, setAiAvailable,
    startAiChat, submitAiQuery, exitAiMode,
  } = useAiChat({
    setAiMode,
    onExitAiMode,
  });

  const {
    cursorPromptText, setCursorPromptText,
    cursorPromptStatus,
    cursorPromptResult,
    cursorPromptError,
    cursorPromptInputRef,
    submitCursorPrompt, applyCursorPromptResultToEditor,
    closeCursorPrompt, resetCursorPromptState,
  } = useCursorPrompt({
    showCursorPrompt,
    setShowCursorPrompt,
    setAiAvailable,
  });

  const acceptCursorPrompt = applyCursorPromptResultToEditor;

  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const actionsOverlayRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const quickLinkDynamicInputRef = useRef<HTMLInputElement>(null);
  const windowPresetCommandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastWindowHiddenAtRef = useRef<number>(0);
  const calcRequestSeqRef = useRef(0);
  const isLauncherModeActiveRef = useRef(false);
  const pinnedCommandsRef = useRef<string[]>([]);
  const extensionViewRef = useRef<ExtensionBundle | null>(null);
  extensionViewRef.current = extensionView;
  pinnedCommandsRef.current = pinnedCommands;


  const cursorPromptPortalTarget = useDetachedPortalWindow(showCursorPrompt, {
    name: 'supercmd-prompt-window',
    title: 'SuperCmd Prompt',
    width: 500,
    height: 132,
    anchor: 'caret',
    onClosed: () => {
      setShowCursorPrompt(false);
    },
  });

  const windowManagerPortalTarget = useDetachedPortalWindow(showWindowManager, {
    name: 'supercmd-window-manager-window',
    title: 'SuperCmd Window Manager',
    width: 380,
    height: 276,
    anchor: 'bottom-right',
    onClosed: () => {
      setShowWindowManager(false);
    },
  });

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

  const loadLauncherPreferences = useCallback(async () => {
    try {
      const settings = (await window.electron.getSettings()) as AppSettings;
      const shortcutStatus = await window.electron.getGlobalShortcutStatus();
      setPinnedCommands(settings.pinnedCommands || []);
      setRecentCommands(settings.recentCommands || []);
      setRecentCommandLaunchCounts(
        Object.entries(settings.recentCommandLaunchCounts || {}).reduce((acc, [commandId, launchCount]) => {
          const normalizedCommandId = String(commandId || '').trim();
          const normalizedLaunchCount = Math.floor(Number(launchCount));
          if (!normalizedCommandId || !Number.isFinite(normalizedLaunchCount) || normalizedLaunchCount <= 0) {
            return acc;
          }
          acc[normalizedCommandId] = normalizedLaunchCount;
          return acc;
        }, {} as Record<string, number>)
      );
      setCommandAliases(
        Object.entries(settings.commandAliases || {}).reduce((acc, [commandId, alias]) => {
          const normalizedCommandId = String(commandId || '').trim();
          const normalizedAlias = String(alias || '').trim();
          if (!normalizedCommandId || !normalizedAlias) return acc;
          acc[normalizedCommandId] = normalizedAlias;
          return acc;
        }, {} as Record<string, string>)
      );
      setLauncherShortcut(settings.globalShortcut || 'Alt+Space');
      const speakToggleHotkey = settings.commandHotkeys?.['system-supercmd-whisper-speak-toggle'] || 'Fn';
      setWhisperSpeakToggleLabel(formatShortcutLabel(speakToggleHotkey));
      setConfiguredEdgeTtsVoice(String(settings.ai?.edgeTtsVoice || 'en-US-EricNeural'));
      setConfiguredTtsModel(String(settings.ai?.textToSpeechModel || 'edge-tts'));
      applyAppFontSize(settings.fontSize);
      applyUiStyle(settings.uiStyle || 'default');
      applyBaseColor(settings.baseColor || '#101113');
      const shouldShowOnboarding = !settings.hasSeenOnboarding;
      setShowOnboarding(shouldShowOnboarding);
      setOnboardingRequiresShortcutFix(shouldShowOnboarding && !shortcutStatus.ok);
    } catch (e) {
      console.error('Failed to load launcher preferences:', e);
      setPinnedCommands([]);
      setRecentCommands([]);
      setRecentCommandLaunchCounts({});
      setCommandAliases({});
      setLauncherShortcut('Alt+Space');
      setConfiguredEdgeTtsVoice('en-US-EricNeural');
      setConfiguredTtsModel('edge-tts');
      applyAppFontSize(getDefaultAppFontSize());
      applyUiStyle('default');
      applyBaseColor('#101113');
      setShowOnboarding(false);
      setOnboardingRequiresShortcutFix(false);
    }
  }, []);

  const fetchCommands = useCallback(async (options?: { showLoading?: boolean }) => {
    const shouldShowLoading = options?.showLoading ?? commandsRef.current.length === 0;
    if (shouldShowLoading) {
      setIsLoading(true);
    }
    try {
      const fetchedCommands = await window.electron.getCommands();
      setCommands(fetchedCommands);
    } catch (error) {
      console.error('Failed to fetch commands:', error);
    } finally {
      if (shouldShowLoading) {
        setIsLoading(false);
      }
    }
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

  // Mount-only initial load — must NOT re-run when callbacks are recreated
  // or the loading flash triggers on every aiStreaming state change.
  useEffect(() => {
    fetchCommands();
    loadLauncherPreferences();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cleanupWindowHidden = window.electron.onWindowHidden(() => {
      lastWindowHiddenAtRef.current = Date.now();
    });
    return cleanupWindowHidden;
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onCommandsUpdated?.(() => {
      fetchCommands({ showLoading: false });
    });
    return cleanup;
  }, [fetchCommands]);

  useEffect(() => {
    const cleanupWindowShown = window.electron.onWindowShown((payload) => {
      const routedSystemCommandId = String(payload?.systemCommandId || '');
      const isOnboardingMode =
        payload?.mode === 'onboarding' ||
        routedSystemCommandId === 'system-open-onboarding' ||
        routedSystemCommandId === 'system-whisper-onboarding';

      setForcedTheme(isOnboardingMode ? 'dark' : null, false);
      if (!isOnboardingMode) {
        refreshThemeFromStorage(false);
      }
      console.log('[WINDOW-SHOWN] fired', payload);
      const isWhisperMode = payload?.mode === 'whisper';
      const isSpeakMode = payload?.mode === 'speak';
      const isPromptMode = payload?.mode === 'prompt';
      if (isWhisperMode) {
        whisperSessionRef.current = true;
        setSelectedTextSnapshot('');
        setMemoryFeedback(null);
        setMemoryActionLoading(false);
        openWhisper();
        return;
      }
      if (isSpeakMode) {
        whisperSessionRef.current = false;
        setSelectedTextSnapshot('');
        setMemoryFeedback(null);
        setMemoryActionLoading(false);
        openSpeak();
        return;
      }
      if (isPromptMode) {
        whisperSessionRef.current = false;
        setSelectedTextSnapshot('');
        setMemoryFeedback(null);
        setMemoryActionLoading(false);
        openCursorPrompt();
        resetCursorPromptState();
        return;
      }
      if (routedSystemCommandId) {
        whisperSessionRef.current = false;
        setShowCursorPrompt(false);
        setShowWhisperHint(false);
        setShowCamera(false);
        setShowWindowManager(false);
        setShowQuickLinkManager(null);
        setMemoryFeedback(null);
        setMemoryActionLoading(false);
        setScriptCommandSetup(null);
        setScriptCommandOutput(null);
        setExtensionView(null);
        localStorage.removeItem(LAST_EXT_KEY);
        setSearchQuery('');
        setSelectedIndex(0);
        exitAiMode();
        if (routedSystemCommandId === 'system-clipboard-manager') {
          setShowSnippetManager(null);
          setShowFileSearch(false);
          openClipboardManager();
          return;
        }
        if (routedSystemCommandId === 'system-search-snippets') {
          setShowClipboardManager(false);
          setShowFileSearch(false);
          openSnippetManager('search');
          return;
        }
        if (routedSystemCommandId === 'system-create-snippet') {
          setShowClipboardManager(false);
          setShowFileSearch(false);
          openSnippetManager('create');
          return;
        }
        if (routedSystemCommandId === 'system-search-quicklinks') {
          setShowClipboardManager(false);
          setShowFileSearch(false);
          openQuickLinkManager('search');
          return;
        }
        if (routedSystemCommandId === 'system-create-quicklink') {
          setShowClipboardManager(false);
          setShowFileSearch(false);
          openQuickLinkManager('create');
          return;
        }
        if (routedSystemCommandId === 'system-search-files') {
          setShowClipboardManager(false);
          setShowSnippetManager(null);
          setShowQuickLinkManager(null);
          openFileSearch();
          return;
        }
        if (routedSystemCommandId === 'system-camera') {
          setShowClipboardManager(false);
          setShowSnippetManager(null);
          setShowQuickLinkManager(null);
          setShowFileSearch(false);
          openCamera();
          return;
        }
        if (routedSystemCommandId === 'system-open-onboarding') {
          openOnboarding();
          return;
        }
        if (routedSystemCommandId === 'system-whisper-onboarding') {
          openOnboarding();
          return;
        }
      }

      whisperSessionRef.current = false;
      setShowCursorPrompt(false);
      setShowWhisperHint(false);
      setShowCamera(false);
      setShowWindowManager(false);
      setMemoryFeedback(null);
      setMemoryActionLoading(false);
      setScriptCommandSetup(null);
      setScriptCommandOutput(null);
      setSelectedTextSnapshot(String(payload?.selectedTextSnapshot || '').trim());
      const shouldResetOverlays =
        lastWindowHiddenAtRef.current > 0 &&
        Date.now() - lastWindowHiddenAtRef.current > STALE_OVERLAY_RESET_MS;

      if (shouldResetOverlays) {
        setExtensionView(null);
        localStorage.removeItem(LAST_EXT_KEY);
        setShowActions(false);
        setContextMenu(null);
        setShowClipboardManager(false);
        setShowSnippetManager(null);
        setShowQuickLinkManager(null);
        setShowFileSearch(false);
        setShowCursorPrompt(false);
        setShowWhisper(false);
        setShowSpeak(false);
        setShowCamera(false);
        setShowWindowManager(false);
        setShowWhisperOnboarding(false);
      }

      // If an extension is open, keep it alive — don't reset
      if (extensionViewRef.current && !shouldResetOverlays) return;
      setSearchQuery('');
      setSelectedIndex(0);
      exitAiMode();
      setShowClipboardManager(false);
      setShowSnippetManager(null);
      setShowQuickLinkManager(null);
      setShowFileSearch(false);
      // Re-fetch commands every time the window is shown
      // so newly installed extensions appear immediately
      fetchCommands({ showLoading: false });
      loadLauncherPreferences();
      window.electron.aiIsAvailable().then(setAiAvailable);
      inputRef.current?.focus();
    });
    return cleanupWindowShown;
  }, [fetchCommands, loadLauncherPreferences, refreshSelectedTextSnapshot, openWhisper, openSpeak, openCursorPrompt, resetCursorPromptState, exitAiMode, setShowCursorPrompt, setShowWhisperHint, setMemoryFeedback, setMemoryActionLoading, setScriptCommandSetup, setScriptCommandOutput, setExtensionView, setSearchQuery, setSelectedIndex, setShowSnippetManager, setShowQuickLinkManager, setShowFileSearch, openClipboardManager, setShowClipboardManager, openSnippetManager, openQuickLinkManager, openFileSearch, openCamera, openOnboarding, setShowCamera, setShowWindowManager]);

  useEffect(() => {
    const cleanupSelectionSnapshotUpdated = window.electron.onSelectionSnapshotUpdated((payload) => {
      setSelectedTextSnapshot(String(payload?.selectedTextSnapshot || '').trim());
    });
    return cleanupSelectionSnapshotUpdated;
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((settings: AppSettings) => {
      applyAppFontSize(settings.fontSize);
      applyUiStyle(settings.uiStyle || 'default');
      applyBaseColor(settings.baseColor || '#101113');
      setLauncherShortcut(settings.globalShortcut || 'Alt+Space');
    });
    return cleanup;
  }, []);

  // Onboarding is intentionally always shown in dark mode for consistent
  // contrast and readability, independent of the user's regular theme.
  useEffect(() => {
    setForcedTheme(showOnboarding ? 'dark' : null, false);
    if (!showOnboarding) {
      refreshThemeFromStorage(false);
      return;
    }
  }, [showOnboarding]);

  // Listen for OAuth logout events from the settings window.
  // When the user clicks "Logout" in settings, clear the in-memory token
  // and reset the extension view so the auth prompt shows on next launch.
  useEffect(() => {
    const cleanup = window.electron.onOAuthLogout?.((provider: string) => {
      try {
        localStorage.removeItem(`sc-oauth-token:${provider}`);
      } catch {}
      // Clear the in-memory OAuth token and tear down the extension view
      // so the auth prompt shows on next launch.
      resetAccessToken();
      setExtensionView(null);
      localStorage.removeItem(LAST_EXT_KEY);
    });
    return cleanup;
  }, [setExtensionView]);

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
          queueNoViewBundleRun(hydrated, 'background');
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
      } else if (hydrated.mode === 'no-view') {
        queueNoViewBundleRun(hydrated, 'userInitiated');
      } else {
        setShowFileSearch(false);
        setExtensionView(hydrated);
      }
    };

    window.addEventListener('sc-launch-extension-bundle', onLaunchBundle as EventListener);
    return () => window.removeEventListener('sc-launch-extension-bundle', onLaunchBundle as EventListener);
  }, [queueNoViewBundleRun, upsertMenuBarExtension]);

  useEffect(() => {
    const onRunScript = (event: Event) => {
      const custom = event as CustomEvent<{
        commandId?: string;
        arguments?: string[];
      }>;
      const commandId = String(custom.detail?.commandId || '').trim();
      if (!commandId) return;
      void (async () => {
        let command = commands.find((cmd) => cmd.id === commandId && cmd.category === 'script');
        if (!command) {
          const all = await window.electron.getAllCommands();
          command = all.find((cmd) => cmd.id === commandId && cmd.category === 'script');
        }
        if (!command) return;
        const values = toScriptArgumentMapFromArray(command, custom.detail?.arguments || []);
        writeJsonObject(getScriptCmdArgsKey(command.id), values);
        const result = await window.electron.runScriptCommand({
          commandId: command.id,
          arguments: values,
          background: false,
        });
        if (!result) return;
        if (result.needsArguments) {
          setShowFileSearch(false);
          setScriptCommandSetup({
            command,
            values: { ...values },
          });
          return;
        }
        if (result.mode === 'fullOutput') {
          setShowFileSearch(false);
          setScriptCommandOutput({
            command,
            output: String(result.output || result.stdout || result.stderr || '').trim(),
            exitCode: Number(result.exitCode || 0),
          });
          return;
        }
        if (result.mode === 'inline') {
          await fetchCommands();
        }
      })();
    };
    window.addEventListener('sc-run-script-command', onRunScript as EventListener);
    return () => window.removeEventListener('sc-run-script-command', onRunScript as EventListener);
  }, [commands, fetchCommands]);

  useBackgroundRefresh({ commands, fetchCommands });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    void refreshSelectedTextSnapshot();
  }, [refreshSelectedTextSnapshot]);

  const saveLauncherPreferences = useCallback(
    async (next: { pinnedCommands?: string[]; recentCommands?: string[]; recentCommandLaunchCounts?: Record<string, number> }) => {
      const patch: Partial<AppSettings> = {};
      if (next.pinnedCommands) patch.pinnedCommands = next.pinnedCommands;
      if (next.recentCommands) patch.recentCommands = next.recentCommands;
      if (next.recentCommandLaunchCounts) patch.recentCommandLaunchCounts = next.recentCommandLaunchCounts;
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
      const updatedLaunchCounts = {
        ...recentCommandLaunchCounts,
        [commandId]: (recentCommandLaunchCounts[commandId] || 0) + 1,
      };
      setRecentCommands(updated);
      setRecentCommandLaunchCounts(updatedLaunchCounts);
      await saveLauncherPreferences({
        recentCommands: updated,
        recentCommandLaunchCounts: updatedLaunchCounts,
      });
    },
    [recentCommands, recentCommandLaunchCounts, saveLauncherPreferences]
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
      const { [command.id]: _removed, ...nextLaunchCounts } = recentCommandLaunchCounts;
      setRecentCommands(nextRecent);
      setRecentCommandLaunchCounts(nextLaunchCounts);
      await saveLauncherPreferences({
        recentCommands: nextRecent,
        recentCommandLaunchCounts: nextLaunchCounts,
      });
      await fetchCommands();
    },
    [
      pinnedCommands,
      recentCommands,
      recentCommandLaunchCounts,
      updatePinnedCommands,
      saveLauncherPreferences,
      fetchCommands,
    ]
  );

  const uninstallExtensionCommand = useCallback(
    async (command: CommandInfo) => {
      if (command.category !== 'extension' || !command.path) return;
      const rawPath = String(command.path || '').trim();
      const separatorIndex = rawPath.indexOf('/');
      const extName = separatorIndex > 0 ? rawPath.slice(0, separatorIndex).trim() : '';
      if (!extName) return;
      await window.electron.uninstallExtension(extName);
      await updatePinnedCommands(pinnedCommands.filter((id) => id !== command.id));
      const nextRecent = recentCommands.filter((id) => id !== command.id);
      const { [command.id]: _removed, ...nextLaunchCounts } = recentCommandLaunchCounts;
      setRecentCommands(nextRecent);
      setRecentCommandLaunchCounts(nextLaunchCounts);
      await saveLauncherPreferences({
        recentCommands: nextRecent,
        recentCommandLaunchCounts: nextLaunchCounts,
      });
      await fetchCommands();
    },
    [
      pinnedCommands,
      recentCommands,
      recentCommandLaunchCounts,
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

  useEffect(() => {
    if (!contextMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      // If the click is inside the context menu panel, don't dismiss —
      // the action item's onClick needs to fire first (mousedown precedes click).
      if (contextMenuRef.current?.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [contextMenu]);

  useEffect(() => {
    if (!showActions) return;
    setSelectedActionIndex(0);
    setTimeout(() => actionsOverlayRef.current?.focus(), 0);
  }, [showActions]);

  useEffect(() => {
    showActionsRef.current = showActions;
    if (!showActions) {
      setActionsCommand(null);
    }
  }, [showActions]);

  useEffect(() => {
    if (!contextMenu) return;
    setSelectedContextActionIndex(0);
    setTimeout(() => contextMenuRef.current?.focus(), 0);
  }, [contextMenu]);

  useEffect(() => {
    if (!showActions && !contextMenu && !quickLinkDynamicPrompt && !aiMode && !extensionView && !showClipboardManager && !showSnippetManager && !showQuickLinkManager && !showFileSearch && !showCursorPrompt && !showWhisper && !showSpeak && !showCamera && !showWindowManager && !showOnboarding) {
      restoreLauncherFocus();
    }
  }, [showActions, contextMenu, quickLinkDynamicPrompt, aiMode, extensionView, showClipboardManager, showSnippetManager, showQuickLinkManager, showFileSearch, showCursorPrompt, showWhisper, showSpeak, showCamera, showWindowManager, showOnboarding, showWhisperOnboarding, restoreLauncherFocus]);

  const isLauncherModeActive =
    !showActions &&
    !contextMenu &&
    !quickLinkDynamicPrompt &&
    !aiMode &&
    !extensionView &&
    !showClipboardManager &&
    !showSnippetManager &&
    !showQuickLinkManager &&
    !showFileSearch &&
    !showCursorPrompt &&
    !showWhisper &&
    !showSpeak &&
    !showCamera &&
    !showWindowManager &&
    !showOnboarding &&
    !showWhisperOnboarding;
  const shouldKeepLauncherSearchResults =
    isLauncherModeActive || showActions || Boolean(contextMenu);

  useEffect(() => {
    isLauncherModeActiveRef.current = isLauncherModeActive;
  }, [isLauncherModeActive]);

  useEffect(() => {
    fileSearchRequestSeqRef.current += 1;
    const requestSeq = fileSearchRequestSeqRef.current;
    const trimmed = searchQuery.trim();
    const pathLikeQuery = isPathLikeLauncherFileQuery(trimmed);
    const terms = pathLikeQuery ? [] : getLauncherFileSearchTerms(trimmed);
    const minimumQueryLength = pathLikeQuery ? 1 : MIN_LAUNCHER_FILE_QUERY_LENGTH;

    if (!shouldKeepLauncherSearchResults || trimmed.length < minimumQueryLength) {
      setLauncherFileResults([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          let candidates = await window.electron.searchIndexedFiles(trimmed, { limit: MAX_LAUNCHER_FILE_CANDIDATE_RESULTS });
          if (fileSearchRequestSeqRef.current !== requestSeq) return;

          if (candidates.length === 0) {
            const status = await window.electron.getFileSearchIndexStatus().catch(() => null);
            if (fileSearchRequestSeqRef.current !== requestSeq) return;

            if (status && !status.ready && !status.indexing) {
              await window.electron.refreshFileSearchIndex('launcher-query').catch(() => null);
            }

            if (status && (!status.ready || status.indexing)) {
              await new Promise((resolve) => window.setTimeout(resolve, 220));
              if (fileSearchRequestSeqRef.current !== requestSeq) return;
              candidates = await window.electron.searchIndexedFiles(trimmed, { limit: MAX_LAUNCHER_FILE_CANDIDATE_RESULTS });
            }
          }

          const seenPaths = new Set<string>();
          const results: IndexedFileSearchResult[] = [];
          for (const candidate of candidates) {
            const candidatePath = String(candidate?.path || '').trim();
            if (!candidatePath || seenPaths.has(candidatePath)) continue;
            if (pathLikeQuery) {
              if (!matchesLauncherPathQuery(candidatePath, trimmed, homeDir)) continue;
            } else if (!matchesLauncherFileNameTerms(String(candidate?.name || ''), terms)) {
              continue;
            }
            seenPaths.add(candidatePath);
            results.push(candidate);
            if (results.length >= MAX_LAUNCHER_FILE_RESULTS) break;
          }

          if (fileSearchRequestSeqRef.current !== requestSeq) return;
          setLauncherFileResults(results);

          const iconTargets = results.slice(0, MAX_LAUNCHER_FILE_RESULT_ICONS);
          const iconEntries = await Promise.all(
            iconTargets.map(async (result) => {
              try {
                const dataUrl = await window.electron.getFileIconDataUrl(result.path, 20);
                return [result.path, dataUrl || ''] as const;
              } catch {
                return [result.path, ''] as const;
              }
            })
          );
          if (fileSearchRequestSeqRef.current !== requestSeq) return;
          setLauncherFileIcons((prev) => {
            const next = { ...prev };
            for (const [targetPath, icon] of iconEntries) {
              if (icon) next[targetPath] = icon;
            }
            return next;
          });
        } catch (error) {
          console.error('Failed to search indexed files for launcher:', error);
          if (fileSearchRequestSeqRef.current === requestSeq) {
            setLauncherFileResults([]);
          }
        }
      })();
    }, 110);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchQuery, shouldKeepLauncherSearchResults, homeDir]);

  useEffect(() => {
    if (!isLauncherModeActive) return;
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!e.metaKey || String(e.key || '').toLowerCase() !== 'k' || e.repeat) return;

      const target = e.target as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;
      const searchInput = inputRef.current;
      if (searchInput && (target === searchInput || active === searchInput)) return;

      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      e.preventDefault();
      e.stopPropagation();
      if (showActionsRef.current) {
        setShowActions(false);
        return;
      }

      const command = selectedCommandRef.current;
      if (!command) return;
      setContextMenu(null);
      setActionsCommand(command);
      setSelectedActionIndex(0);
      setShowActions(true);
    };

    window.addEventListener('keydown', onWindowKeyDown, true);
    return () => window.removeEventListener('keydown', onWindowKeyDown, true);
  }, [isLauncherModeActive]);

  useEffect(() => {
    return () => {
      if (memoryFeedbackTimerRef.current !== null) {
        window.clearTimeout(memoryFeedbackTimerRef.current);
        memoryFeedbackTimerRef.current = null;
      }
    };
  }, []);

  const syncCalcResult = useMemo(() => {
    return searchQuery ? tryCalculate(searchQuery) : null;
  }, [searchQuery]);
  const [asyncCalcResult, setAsyncCalcResult] =
    useState<Awaited<ReturnType<typeof tryCalculateAsync>>>(null);
  useEffect(() => {
    calcRequestSeqRef.current += 1;
    const requestSeq = calcRequestSeqRef.current;

    if (!searchQuery || syncCalcResult) {
      setAsyncCalcResult(null);
      return;
    }

    const timer = window.setTimeout(() => {
      void tryCalculateAsync(searchQuery)
        .then((result) => {
          if (calcRequestSeqRef.current !== requestSeq) return;
          setAsyncCalcResult(result);
        })
        .catch(() => {
          if (calcRequestSeqRef.current !== requestSeq) return;
          setAsyncCalcResult(null);
        });
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchQuery, syncCalcResult]);
  const calcResult = syncCalcResult ?? asyncCalcResult;
  const calcOffset = calcResult ? 1 : 0;
  const contextualCommands = commands;
  const filteredCommands = useMemo(
    () => filterCommands(contextualCommands, searchQuery),
    [contextualCommands, searchQuery]
  );

  // When calculator is showing but no commands match, show unfiltered list below
  const sourceCommands =
    calcResult && filteredCommands.length === 0 ? contextualCommands : filteredCommands;
  const hiddenListOnlyCommandIds = useMemo(
    () => new Set(['system-add-to-memory', 'system-cursor-prompt']),
    []
  );
  const visibleSourceCommands = useMemo(
    () => sourceCommands.filter((cmd) => !hiddenListOnlyCommandIds.has(cmd.id)),
    [sourceCommands, hiddenListOnlyCommandIds]
  );
  const hasSearchQuery = searchQuery.trim().length > 0;

  const fileResultCommands = useMemo<CommandInfo[]>(
    () =>
      launcherFileResults.map((result) => {
        const displayParent = result.displayPath || asTildePath(result.parentPath, homeDir);
        return {
          id: buildFileResultCommandId(result.path),
          title: result.name,
          subtitle: displayParent,
          keywords: [result.name, result.parentPath, result.displayPath],
          iconDataUrl: launcherFileIcons[result.path] || undefined,
          category: 'system',
          path: result.path,
        };
      }),
    [launcherFileResults, launcherFileIcons, homeDir]
  );

  const groupedCommands = useMemo(() => {
    if (hasSearchQuery) {
      return {
        contextual: [] as CommandInfo[],
        pinned: [] as CommandInfo[],
        recent: [] as CommandInfo[],
        other: visibleSourceCommands,
        files: fileResultCommands,
      };
    }

    const sourceMap = new Map(visibleSourceCommands.map((cmd) => [cmd.id, cmd]));
    const hasSelection = selectedTextSnapshot.trim().length > 0;
    const contextual = hasSelection
      ? (sourceMap.get('system-add-to-memory') ? [sourceMap.get('system-add-to-memory') as CommandInfo] : [])
      : [];
    const contextualIds = new Set(contextual.map((c) => c.id));

    const pinned = pinnedCommands
      .map((id) => sourceMap.get(id))
      .filter((cmd): cmd is CommandInfo => Boolean(cmd) && !contextualIds.has((cmd as CommandInfo).id));
    const pinnedSet = new Set(pinned.map((c) => c.id));

    const recentRecencyRank = new Map(recentCommands.map((id, index) => [id, index]));
    const recent = recentCommands
      .map((id) => sourceMap.get(id))
      .filter(
        (c): c is CommandInfo =>
          Boolean(c) &&
          !pinnedSet.has((c as CommandInfo).id) &&
          !contextualIds.has((c as CommandInfo).id)
      )
      .sort((a, b) => {
        const countA = recentCommandLaunchCounts[a.id] || 0;
        const countB = recentCommandLaunchCounts[b.id] || 0;
        if (countB !== countA) return countB - countA;
        return (recentRecencyRank.get(a.id) ?? Number.MAX_SAFE_INTEGER)
          - (recentRecencyRank.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      })
      .slice(0, MAX_RECENT_SECTION_ITEMS);
    const recentSet = new Set(recent.map((c) => c.id));

    const other = visibleSourceCommands.filter(
      (c) => !pinnedSet.has(c.id) && !recentSet.has(c.id) && !contextualIds.has(c.id)
    );

    return { contextual, pinned, recent, files: fileResultCommands, other };
  }, [hasSearchQuery, visibleSourceCommands, pinnedCommands, recentCommands, recentCommandLaunchCounts, selectedTextSnapshot, fileResultCommands]);

  const displayCommands = useMemo(
    () => [
      ...groupedCommands.contextual,
      ...groupedCommands.pinned,
      ...groupedCommands.recent,
      ...groupedCommands.other,
      ...groupedCommands.files,
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
  useEffect(() => {
    selectedCommandRef.current = selectedCommand;
  }, [selectedCommand]);
  const selectedExtensionArgumentDefinitions = useMemo(
    () =>
      selectedCommand?.category === 'extension'
        ? (selectedCommand.commandArgumentDefinitions || []).filter((definition) => definition?.name)
        : [],
    [selectedCommand]
  );
  const selectedInlineExtensionArgumentDefinitions = useMemo(
    () => selectedExtensionArgumentDefinitions.slice(0, MAX_INLINE_EXTENSION_ARGUMENTS),
    [selectedExtensionArgumentDefinitions]
  );
  const selectedInlineExtensionArgumentValues = useMemo(
    () => (selectedCommand ? inlineExtensionArgumentValues[selectedCommand.id] || {} : {}),
    [inlineExtensionArgumentValues, selectedCommand]
  );
  const hasSelectedExtensionOverflowArguments =
    selectedExtensionArgumentDefinitions.length > selectedInlineExtensionArgumentDefinitions.length;
  const selectedQuickLinkId = useMemo(
    () => (selectedCommand ? getQuickLinkIdFromCommandId(selectedCommand.id) : null),
    [selectedCommand]
  );
  const selectedQuickLinkDynamicFields = useMemo(
    () => (selectedQuickLinkId ? inlineQuickLinkDynamicFieldsById[selectedQuickLinkId] || [] : []),
    [inlineQuickLinkDynamicFieldsById, selectedQuickLinkId]
  );
  const selectedInlineQuickLinkDynamicFields = useMemo(
    () => selectedQuickLinkDynamicFields.slice(0, MAX_INLINE_QUICK_LINK_ARGUMENTS),
    [selectedQuickLinkDynamicFields]
  );
  const selectedInlineQuickLinkDynamicValues = useMemo(
    () => (selectedQuickLinkId ? inlineQuickLinkDynamicValuesById[selectedQuickLinkId] || {} : {}),
    [inlineQuickLinkDynamicValuesById, selectedQuickLinkId]
  );
  const hasSelectedQuickLinkOverflowDynamicFields =
    selectedQuickLinkDynamicFields.length > selectedInlineQuickLinkDynamicFields.length;
  const isShowingInlineArgumentInputs =
    selectedInlineExtensionArgumentDefinitions.length > 0 || selectedInlineQuickLinkDynamicFields.length > 0;
  const shouldHideAskAi = Boolean(selectedQuickLinkId) || isShowingInlineArgumentInputs;
  const selectedInlineArgumentLeadingIcon = useMemo(() => {
    if (!isShowingInlineArgumentInputs || !selectedCommand) return null;
    return renderCommandIcon(selectedCommand);
  }, [isShowingInlineArgumentInputs, selectedCommand]);
  const inlineArgumentStartPx = useInlineArgumentAnchor({
    enabled: isShowingInlineArgumentInputs,
    query: searchQuery,
    searchInputRef: inputRef,
    laneRef: inlineArgumentLaneRef,
    inlineRef: inlineArgumentClusterRef,
    minStartRatio: 0.3,
  });
  const selectedFileResultPath = useMemo(
    () => getFileResultPathFromCommand(selectedCommand),
    [selectedCommand]
  );

  useEffect(() => {
    if (!showFileSearch && fileSearchInitialDetailPath) {
      setFileSearchInitialDetailPath(null);
    }
  }, [showFileSearch, fileSearchInitialDetailPath]);

  const getDynamicFieldsForQuickLink = useCallback(
    async (
      quickLinkId: string,
      options?: { forceRefresh?: boolean }
    ): Promise<QuickLinkDynamicField[]> => {
      const normalizedId = String(quickLinkId || '').trim();
      if (!normalizedId) return [];
      const cached = inlineQuickLinkDynamicFieldsById[normalizedId];
      if (cached && !options?.forceRefresh) return cached;
      try {
        const fetched = await window.electron.quickLinkGetDynamicFields(normalizedId);
        const normalizedFields = normalizeQuickLinkDynamicFields(Array.isArray(fetched) ? fetched : []);
        setInlineQuickLinkDynamicFieldsById((prev) => ({
          ...prev,
          [normalizedId]: normalizedFields,
        }));
        return normalizedFields;
      } catch (error) {
        console.error('Failed to load quick link dynamic fields for launcher inline input:', error);
        return [];
      }
    },
    [inlineQuickLinkDynamicFieldsById]
  );
  useEffect(() => {
    inlineArgumentInputRefs.current = inlineArgumentInputRefs.current.slice(
      0,
      selectedInlineExtensionArgumentDefinitions.length
    );
  }, [selectedInlineExtensionArgumentDefinitions.length]);

  useEffect(() => {
    inlineQuickLinkInputRefs.current = inlineQuickLinkInputRefs.current.slice(
      0,
      selectedInlineQuickLinkDynamicFields.length
    );
  }, [selectedInlineQuickLinkDynamicFields.length]);

  useEffect(() => {
    if (!isLauncherModeActive) return;
    const extensionIdentity = getExtensionIdentityFromCommand(selectedCommand);
    if (!selectedCommand || !extensionIdentity || selectedExtensionArgumentDefinitions.length === 0) return;

    setInlineExtensionArgumentValues((prev) => {
      if (prev[selectedCommand.id]) return prev;
      const storedValues = readJsonObject(getCmdArgsKey(extensionIdentity.extName, extensionIdentity.cmdName));
      const initialValues = selectedExtensionArgumentDefinitions.reduce((acc, definition) => {
        acc[definition.name] = String(storedValues[definition.name] ?? '');
        return acc;
      }, {} as Record<string, string>);
      return {
        ...prev,
        [selectedCommand.id]: initialValues,
      };
    });
  }, [isLauncherModeActive, selectedCommand, selectedExtensionArgumentDefinitions]);

  useEffect(() => {
    if (!isLauncherModeActive || !selectedQuickLinkId) return;
    void getDynamicFieldsForQuickLink(selectedQuickLinkId, { forceRefresh: true });
  }, [getDynamicFieldsForQuickLink, isLauncherModeActive, selectedQuickLinkId]);

  useEffect(() => {
    if (!selectedQuickLinkId || selectedQuickLinkDynamicFields.length === 0) return;
    setInlineQuickLinkDynamicValuesById((prev) => {
      const existing = prev[selectedQuickLinkId] || {};
      let changed = !prev[selectedQuickLinkId];
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
        [selectedQuickLinkId]: nextValues,
      };
    });
  }, [selectedQuickLinkDynamicFields, selectedQuickLinkId]);

  useEffect(() => {
    if (!isLauncherModeActive) return;
    const timer = window.setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isLauncherModeActive, selectedCommand?.id, selectedInlineExtensionArgumentDefinitions.length, selectedInlineQuickLinkDynamicFields.length]);

  const updateInlineExtensionArgumentValue = useCallback(
    (command: CommandInfo, argumentName: string, value: string) => {
      const extensionIdentity = getExtensionIdentityFromCommand(command);
      setInlineExtensionArgumentValues((prev) => {
        const nextCommandValues = {
          ...(prev[command.id] || {}),
          [argumentName]: value,
        };
        if (extensionIdentity) {
          writeJsonObject(getCmdArgsKey(extensionIdentity.extName, extensionIdentity.cmdName), nextCommandValues);
        }
        return {
          ...prev,
          [command.id]: nextCommandValues,
        };
      });
    },
    []
  );

  const updateInlineQuickLinkDynamicValue = useCallback(
    (quickLinkId: string, key: string, value: string) => {
      const normalizedId = String(quickLinkId || '').trim();
      const normalizedKey = String(key || '').trim();
      if (!normalizedId || !normalizedKey) return;
      setInlineQuickLinkDynamicValuesById((prev) => ({
        ...prev,
        [normalizedId]: {
          ...(prev[normalizedId] || {}),
          [normalizedKey]: value,
        },
      }));
    },
    []
  );
  const getInlineExtensionArgumentsForCommand = useCallback(
    (command: CommandInfo): Record<string, string> => {
      const definitions = (command.commandArgumentDefinitions || []).filter((definition) => definition?.name);
      if (definitions.length === 0) return {};

      const current = { ...(inlineExtensionArgumentValues[command.id] || {}) };
      if (selectedCommand?.id === command.id) {
        for (let index = 0; index < definitions.length; index += 1) {
          const definition = definitions[index];
          if (index >= MAX_INLINE_EXTENSION_ARGUMENTS) break;
          const input = inlineArgumentInputRefs.current[index];
          if (!input) continue;
          current[definition.name] = String((input as HTMLInputElement | HTMLSelectElement).value ?? '');
        }
      }

      const next = definitions.reduce((acc, definition) => {
        acc[definition.name] = String(current[definition.name] ?? '');
        return acc;
      }, {} as Record<string, string>);

      setInlineExtensionArgumentValues((prev) => {
        const existing = prev[command.id] || {};
        let changed = false;
        for (const definition of definitions) {
          const key = definition.name;
          if (String(existing[key] ?? '') !== String(next[key] ?? '')) {
            changed = true;
            break;
          }
        }
        if (!changed) return prev;
        return {
          ...prev,
          [command.id]: next,
        };
      });

      return next;
    },
    [inlineExtensionArgumentValues, selectedCommand]
  );

  const openFileResultByPath = useCallback(async (targetPath: string) => {
    if (!targetPath) return;
    try {
      await window.electron.execCommand('open', [targetPath]);
      await window.electron.hideWindow();
    } catch (error) {
      console.error('Failed to open file result:', error);
    }
  }, []);

  const revealFileResultByPath = useCallback(async (targetPath: string) => {
    if (!targetPath) return;
    try {
      await window.electron.execCommand('open', ['-R', targetPath]);
    } catch (error) {
      console.error('Failed to reveal file result:', error);
    }
  }, []);

  const copyFileResultPath = useCallback(async (targetPath: string) => {
    if (!targetPath) return;
    try {
      await window.electron.clipboardWrite({ text: targetPath });
    } catch (error) {
      console.error('Failed to copy file path:', error);
    }
  }, []);

  const showFileResultDetailsByPath = useCallback(
    (targetPath: string) => {
      if (!targetPath) return;
      setFileSearchInitialDetailPath(targetPath);
      openFileSearch();
    },
    [openFileSearch]
  );

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

  const moveSelection = useCallback(
    (direction: 'up' | 'down', options: { wrap?: boolean } = {}) => {
      const { wrap = false } = options;
      setSelectedIndex((prev) => {
        const max = Math.max(0, displayCommands.length + calcOffset - 1);
        if (direction === 'down') {
          if (prev < max) return prev + 1;
          return wrap ? 0 : max;
        }
        if (prev > 0) return prev - 1;
        return wrap ? max : 0;
      });
    },
    [displayCommands.length, calcOffset]
  );

  const handleLauncherSearchBlur = useCallback(() => {
    if (!isLauncherModeActiveRef.current) return;
    requestAnimationFrame(() => {
      if (!isLauncherModeActiveRef.current) return;
      const activeElement = document.activeElement;
      if (activeElement === inputRef.current) return;
      if (isEditableElement(activeElement)) return;
      inputRef.current?.focus();
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (quickLinkDynamicPrompt) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const isSearchInputTarget = target === inputRef.current;

      if (e.metaKey && (e.key === 'k' || e.key === 'K') && !e.repeat) {
        e.preventDefault();
        if (showActions) {
          setShowActions(false);
          return;
        }
        if (!selectedCommand) return;
        setContextMenu(null);
        setActionsCommand(selectedCommand);
        setSelectedActionIndex(0);
        setShowActions(true);
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'j' || e.key === 'J') {
          e.preventDefault();
          moveSelection('down');
          return;
        }
        if (e.key === 'k' || e.key === 'K') {
          e.preventDefault();
          moveSelection('up');
          return;
        }
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
      if (selectedFileResultPath && e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        showFileResultDetailsByPath(selectedFileResultPath);
        return;
      }
      if (selectedFileResultPath && e.metaKey && e.key === 'Enter') {
        e.preventDefault();
        void revealFileResultByPath(selectedFileResultPath);
        return;
      }
      if (selectedFileResultPath && e.metaKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copyFileResultPath(selectedFileResultPath);
        return;
      }
      if (!selectedFileResultPath && e.metaKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        togglePinSelectedCommand();
        return;
      }
      if (!selectedFileResultPath && e.metaKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        disableSelectedCommand();
        return;
      }
      if (!selectedFileResultPath && e.metaKey && (e.key === 'Backspace' || e.key === 'Delete')) {
        if (selectedCommand?.category === 'extension') {
          e.preventDefault();
          uninstallSelectedExtension();
          return;
        }
      }
      if (!selectedFileResultPath && e.metaKey && e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelectedPinnedCommand('up');
        return;
      }
      if (!selectedFileResultPath && e.metaKey && e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelectedPinnedCommand('down');
        return;
      }

      switch (e.key) {
        case 'Tab':
          if (isSearchInputTarget && isShowingInlineArgumentInputs) {
            e.preventDefault();
            if (selectedInlineExtensionArgumentDefinitions.length > 0) {
              const targetIndex = e.shiftKey
                ? selectedInlineExtensionArgumentDefinitions.length - 1
                : 0;
              inlineArgumentInputRefs.current[targetIndex]?.focus();
              return;
            }
            if (selectedInlineQuickLinkDynamicFields.length > 0) {
              const targetIndex = e.shiftKey
                ? selectedInlineQuickLinkDynamicFields.length - 1
                : 0;
              inlineQuickLinkInputRefs.current[targetIndex]?.focus();
              return;
            }
          }
          if (isSearchInputTarget && searchQuery.trim() && aiAvailable && !shouldHideAskAi) {
            e.preventDefault();
            startAiChat(searchQuery);
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          moveSelection('down');
          break;

        case 'ArrowUp':
          e.preventDefault();
          moveSelection('up');
          break;

        case 'Enter':
          e.preventDefault();
          if (calcResult && selectedIndex === 0) {
            navigator.clipboard.writeText(calcResult.result);
            window.electron.hideWindow();
          } else if (displayCommands[selectedIndex - calcOffset]) {
            const selected = displayCommands[selectedIndex - calcOffset];
            if (selectedFileResultPath && e.metaKey) {
              void revealFileResultByPath(selectedFileResultPath);
            } else if (selected) {
              handleCommandExecute(selected);
            }
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
          if (searchQuery.length > 0) {
            setSearchQuery('');
            setSelectedIndex(0);
            return;
          }
          window.electron.hideWindow();
          break;
      }
    },
    [
      moveSelection,
      displayCommands,
      selectedIndex,
      searchQuery,
      aiAvailable,
      isShowingInlineArgumentInputs,
      selectedInlineExtensionArgumentDefinitions.length,
      selectedInlineQuickLinkDynamicFields.length,
      shouldHideAskAi,
      startAiChat,
      calcResult,
      calcOffset,
      togglePinSelectedCommand,
      disableSelectedCommand,
      uninstallSelectedExtension,
      moveSelectedPinnedCommand,
      selectedFileResultPath,
      showFileResultDetailsByPath,
      revealFileResultByPath,
      copyFileResultPath,
      selectedCommand,
      contextMenu,
      showActions,
      quickLinkDynamicPrompt,
    ]
  );

  const runLocalSystemCommand = useCallback(async (
    commandId: string,
    options?: { fromMainEvent?: boolean }
  ): Promise<boolean> => {
    if (commandId === 'system-supercmd-whisper' || commandId === 'system-supercmd-speak') {
      try {
        const settings = await window.electron.getSettings();
        if (settings.ai?.enabled === false) {
          return true;
        }
      } catch {}
    }
    if (commandId === 'system-open-onboarding') {
      await window.electron.setLauncherMode('onboarding');
      whisperSessionRef.current = false;
      openOnboarding();
      return true;
    }
    if (commandId === 'system-whisper-onboarding') {
      await window.electron.setLauncherMode('onboarding');
      whisperSessionRef.current = false;
      openOnboarding();
      return true;
    }
    if (commandId === 'system-clipboard-manager') {
      whisperSessionRef.current = false;
      openClipboardManager();
      return true;
    }
    if (commandId === 'system-search-snippets') {
      whisperSessionRef.current = false;
      openSnippetManager('search');
      return true;
    }
    if (commandId === 'system-create-snippet') {
      whisperSessionRef.current = false;
      openSnippetManager('create');
      return true;
    }
    if (commandId === 'system-search-quicklinks') {
      whisperSessionRef.current = false;
      openQuickLinkManager('search');
      return true;
    }
    if (commandId === 'system-create-quicklink') {
      whisperSessionRef.current = false;
      openQuickLinkManager('create');
      return true;
    }
    if (commandId === 'system-search-files') {
      whisperSessionRef.current = false;
      openFileSearch();
      return true;
    }
    if (commandId === 'system-camera') {
      whisperSessionRef.current = false;
      openCamera();
      return true;
    }
    if (isWindowManagementPresetCommandId(commandId)) {
      whisperSessionRef.current = false;
      // For launcher-initiated execution, route through main first so it can
      // capture the real frontmost target window before running the preset.
      if (!options?.fromMainEvent) {
        await window.electron.executeCommand(commandId);
        return true;
      }
      const queued = windowPresetCommandQueueRef.current.then(async () => {
        const result = await executeWindowManagementPresetCommandById(commandId);
        if (result.success && document.hasFocus()) {
          try {
            await window.electron.hideWindow();
          } catch {}
        }
      });
      windowPresetCommandQueueRef.current = queued.then(() => undefined, () => undefined);
      await queued;
      return true;
    }
    if (commandId === 'system-window-management') {
      whisperSessionRef.current = false;
      if (showWindowManager) {
        setShowWindowManager(false);
        return true;
      }
      openWindowManager();
      setSearchQuery('');
      setSelectedIndex(0);
      // Only hide when launcher is the actively focused window (launcher-invoked flow).
      // For global-hotkey/background invocation, forcing hide can cause focus churn
      // that immediately blurs and closes the detached window manager panel.
      if (document.hasFocus()) {
        try {
          await window.electron.hideWindow();
        } catch {}
      }
      return true;
    }
    if (commandId === 'system-add-to-memory') {
      if (memoryActionLoading) return true;
      setMemoryActionLoading(true);
      setMemoryFeedback(null);
      const selectedText = String(
        await window.electron.getSelectedTextStrict() || selectedTextSnapshot || ''
      ).trim();
      if (!selectedText) {
        setSelectedTextSnapshot('');
        setMemoryActionLoading(false);
        return true;
      }
      try {
        const result = await window.electron.memoryAdd({
          text: selectedText,
          source: 'launcher-selection',
        });
        if (!result.success) {
          console.error('[Supermemory] Failed to add memory:', result.error || 'Unknown error');
          return true;
        }
        setSelectedTextSnapshot('');
        setSearchQuery('');
        setSelectedIndex(0);
      } finally {
        setMemoryActionLoading(false);
      }
      return true;
    }
    if (commandId === 'system-cursor-prompt') {
      await window.electron.executeCommand(commandId);
      return true;
    }
    if (commandId === 'system-supercmd-whisper') {
      whisperSessionRef.current = true;
      if (showOnboarding) {
        setShowWhisper(true);
        setShowWhisperOnboarding(true);
        setShowWhisperHint(true);
        return true;
      }
      openWhisper();
      return true;
    }
    if (commandId === 'system-supercmd-speak') {
      whisperSessionRef.current = false;
      if (showOnboarding) {
        setShowSpeak(true);
        return true;
      }
      openSpeak();
      return true;
    }
    if (commandId === 'system-supercmd-speak-close') {
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
    if (commandId === 'system-check-for-updates') {
      await window.electron.appUpdaterCheckAndInstall();
      return true;
    }
    return false;
  }, [memoryActionLoading, selectedTextSnapshot, showMemoryFeedback, showOnboarding, showWindowManager, openOnboarding, openWhisper, setShowWhisper, setShowWhisperOnboarding, setShowWhisperHint, openClipboardManager, openSnippetManager, openQuickLinkManager, openFileSearch, openCamera, openSpeak, openWindowManager, setShowSpeak, setShowWindowManager]);

  useEffect(() => {
    const cleanup = window.electron.onRunSystemCommand(async (commandId: string) => {
      try {
        await runLocalSystemCommand(commandId, { fromMainEvent: true });
      } catch (error) {
        console.error('Failed to run system command from main process:', error);
      }
    });
    return cleanup;
  }, [runLocalSystemCommand]);

  useEffect(() => {
    const cleanup = window.electron.onOnboardingHotkeyPressed(() => {
      setOnboardingHotkeyPresses((prev) => prev + 1);
    });
    return cleanup;
  }, []);

  const runScriptCommand = useCallback(
    async (
      command: CommandInfo,
      values?: Record<string, any>,
      options?: { background?: boolean; skipRecent?: boolean }
    ) => {
      const payload = {
        commandId: command.id,
        arguments: values || {},
        background: Boolean(options?.background),
      };
      const result = await window.electron.runScriptCommand(payload);

      if (!result) return false;

      if (result.needsArguments) {
        if (!options?.background) {
          setShowFileSearch(false);
          setScriptCommandSetup({
            command,
            values: {
              ...readJsonObject(getScriptCmdArgsKey(command.id)),
              ...(values || {}),
            },
          });
        }
        return false;
      }

      if (result.mode === 'fullOutput') {
        setShowFileSearch(false);
        setScriptCommandOutput({
          command,
          output: String(result.output || result.stdout || result.stderr || '').trim(),
          exitCode: Number(result.exitCode || 0),
        });
      } else if (result.mode === 'inline') {
        await fetchCommands();
      } else if (!options?.background) {
        await window.electron.hideWindow();
        setSearchQuery('');
        setSelectedIndex(0);
      }

      if (!options?.background && !options?.skipRecent) {
        await updateRecentCommands(command.id);
      }

      return Boolean(result.success);
    },
    [fetchCommands, updateRecentCommands]
  );

  const executeQuickLinkCommand = useCallback(
    async (
      command: CommandInfo,
      options?: {
        skipPrompt?: boolean;
        dynamicValues?: Record<string, string>;
      }
    ): Promise<boolean> => {
      const quickLinkId = getQuickLinkIdFromCommandId(command.id);
      if (!quickLinkId) return false;

      const fields = await getDynamicFieldsForQuickLink(quickLinkId, { forceRefresh: true });
      const inlineValues = { ...(inlineQuickLinkDynamicValuesById[quickLinkId] || {}) };
      if (selectedQuickLinkId === quickLinkId && selectedInlineQuickLinkDynamicFields.length > 0) {
        selectedInlineQuickLinkDynamicFields.forEach((field, index) => {
          const liveValue = inlineQuickLinkInputRefs.current[index]?.value;
          if (liveValue !== undefined) {
            inlineValues[field.key] = liveValue;
          }
        });
      }
      const resolvedValuesFromInline = fields.reduce((acc, field) => {
        const key = String(field.key || '').trim();
        if (!key) return acc;
        acc[key] = String(options?.dynamicValues?.[key] ?? inlineValues[key] ?? field.defaultValue ?? '');
        return acc;
      }, {} as Record<string, string>);

      if (!options?.skipPrompt) {
        if (fields.length > 0) {
          if (fields.length <= MAX_INLINE_QUICK_LINK_ARGUMENTS) {
            const openedInline = await window.electron.quickLinkOpen(quickLinkId, resolvedValuesFromInline);
            if (!openedInline) return false;
            setQuickLinkDynamicPrompt(null);
            await updateRecentCommands(command.id);
            setSearchQuery('');
            setSelectedIndex(0);
            await window.electron.hideWindow();
            return true;
          }
          setShowActions(false);
          setContextMenu(null);
          inputRef.current?.blur();
          setQuickLinkDynamicPrompt({
            command,
            quickLinkId,
            fields,
            values: resolvedValuesFromInline,
          });
          return true;
        }
      }

      const dynamicValues =
        options?.dynamicValues !== undefined
          ? options.dynamicValues
          : fields.length > 0
            ? resolvedValuesFromInline
            : undefined;
      const opened = await window.electron.quickLinkOpen(quickLinkId, dynamicValues);
      if (!opened) return false;

      setQuickLinkDynamicPrompt(null);
      await updateRecentCommands(command.id);
      setSearchQuery('');
      setSelectedIndex(0);
      await window.electron.hideWindow();
      return true;
    },
    [
      getDynamicFieldsForQuickLink,
      inlineQuickLinkDynamicValuesById,
      selectedQuickLinkId,
      selectedInlineQuickLinkDynamicFields,
      updateRecentCommands,
    ]
  );

  const cancelQuickLinkDynamicPrompt = useCallback(() => {
    setQuickLinkDynamicPrompt(null);
    restoreLauncherFocus();
  }, [restoreLauncherFocus]);

  const submitQuickLinkDynamicPrompt = useCallback(async () => {
    if (!quickLinkDynamicPrompt) return;
    try {
      await executeQuickLinkCommand(quickLinkDynamicPrompt.command, {
        skipPrompt: true,
        dynamicValues: quickLinkDynamicPrompt.values,
      });
    } catch (error) {
      console.error('Failed to run quick link with dynamic values:', error);
    }
  }, [executeQuickLinkCommand, quickLinkDynamicPrompt]);

  useEffect(() => {
    if (!quickLinkDynamicPrompt) return;
    const timer = window.setTimeout(() => {
      quickLinkDynamicInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [quickLinkDynamicPrompt?.quickLinkId]);

  useEffect(() => {
    if (!quickLinkDynamicPrompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const plainEnter =
        (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey;

      if (event.key === 'Escape') {
        event.preventDefault();
        cancelQuickLinkDynamicPrompt();
        return;
      }

      if (plainEnter || (event.key === 'Enter' && event.metaKey)) {
        event.preventDefault();
        void submitQuickLinkDynamicPrompt();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cancelQuickLinkDynamicPrompt, quickLinkDynamicPrompt, submitQuickLinkDynamicPrompt]);

  const handleCommandExecute = async (command: CommandInfo) => {
    try {
      const filePath = getFileResultPathFromCommand(command);
      if (filePath) {
        await openFileResultByPath(filePath);
        setSearchQuery('');
        setSelectedIndex(0);
        return;
      }

      if (await runLocalSystemCommand(command.id)) {
        await updateRecentCommands(command.id);
        return;
      }

      if (getQuickLinkIdFromCommandId(command.id)) {
        await executeQuickLinkCommand(command);
        return;
      }

      if (command.category === 'extension' && command.path) {
        // Extension command — build and show extension view
        const extensionIdentity = getExtensionIdentityFromCommand(command);
        if (!extensionIdentity) return;
        const { extName, cmdName } = extensionIdentity;
        const result = await window.electron.runExtension(extName, cmdName);
        if (result && result.code) {
          const hydrated = hydrateExtensionBundlePreferences(result);
          const inlineArguments = getInlineExtensionArgumentsForCommand(command);
          const hydratedWithInlineArguments: ExtensionBundle = {
            ...hydrated,
            launchArguments: {
              ...((hydrated as any).launchArguments || {}),
              ...inlineArguments,
            } as any,
          };

          if (Object.keys(inlineArguments).length > 0) {
            writeJsonObject(
              getCmdArgsKey(extName, cmdName),
              { ...((hydratedWithInlineArguments as any).launchArguments || {}) }
            );
          }

          if (shouldOpenCommandSetup(hydratedWithInlineArguments)) {
            setShowFileSearch(false);
            setExtensionPreferenceSetup({
              bundle: hydratedWithInlineArguments,
              values: { ...(hydratedWithInlineArguments.preferences || {}) },
              argumentValues: { ...((hydratedWithInlineArguments as any).launchArguments || {}) },
            });
            return;
          }

          // Menu-bar commands run in the hidden tray runners, not in the overlay.
          // Toggle behavior matches Raycast: running the same menu-bar command again hides it.
          if (hydratedWithInlineArguments.mode === 'menu-bar') {
            if (isMenuBarExtensionMounted(hydratedWithInlineArguments)) {
              hideMenuBarExtension(hydratedWithInlineArguments);
            } else {
              upsertMenuBarExtension(hydratedWithInlineArguments);
            }
            window.electron.hideWindow();
            setSearchQuery('');
            setSelectedIndex(0);
            await updateRecentCommands(command.id);
            return;
          }
          if (hydratedWithInlineArguments.mode === 'no-view') {
            queueNoViewBundleRun(hydratedWithInlineArguments, 'userInitiated');
            localStorage.removeItem(LAST_EXT_KEY);
            await updateRecentCommands(command.id);
            return;
          }
          setShowFileSearch(false);
          setExtensionView(hydratedWithInlineArguments);
          if (hydratedWithInlineArguments.mode === 'view') {
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

      if (command.category === 'script') {
        if (command.needsConfirmation) {
          const ok = window.confirm(`Run "${command.title}"?`);
          if (!ok) return;
        }
        const storedArgs = readJsonObject(getScriptCmdArgsKey(command.id));
        const missing = getMissingRequiredScriptArguments(command, storedArgs);
        if (missing.length > 0) {
          setShowFileSearch(false);
          setScriptCommandSetup({
            command,
            values: { ...storedArgs },
          });
          return;
        }
        await runScriptCommand(command, storedArgs);
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
  const handleCommandRowClick = useCallback(
    async (command: CommandInfo, absoluteIndex: number) => {
      const isAlreadySelected = absoluteIndex === selectedIndex;

      const hasInlineExtensionArguments =
        command.category === 'extension' &&
        (command.commandArgumentDefinitions || []).some((definition) => Boolean(definition?.name));
      if (!isAlreadySelected && hasInlineExtensionArguments) {
        setSelectedIndex(absoluteIndex);
        return;
      }

      const quickLinkId = getQuickLinkIdFromCommandId(command.id);
      if (!isAlreadySelected && quickLinkId) {
        const cachedFields = inlineQuickLinkDynamicFieldsById[quickLinkId];
        const quickLinkFields =
          cachedFields !== undefined ? cachedFields : await getDynamicFieldsForQuickLink(quickLinkId);
        const hasInlineQuickLinkArguments =
          quickLinkFields.length > 0 && quickLinkFields.length <= MAX_INLINE_QUICK_LINK_ARGUMENTS;
        if (hasInlineQuickLinkArguments) {
          setSelectedIndex(absoluteIndex);
          return;
        }
      }

      void handleCommandExecute(command);
    },
    [
      getDynamicFieldsForQuickLink,
      handleCommandExecute,
      inlineQuickLinkDynamicFieldsById,
      selectedIndex,
    ]
  );

  const getActionsForCommand = useCallback(
    (command: CommandInfo | null): LauncherAction[] => {
      if (!command) return [];
      const filePath = getFileResultPathFromCommand(command);
      if (filePath) {
        return [
          {
            id: 'open-file',
            title: 'Open File',
            shortcut: 'Enter',
            execute: () => openFileResultByPath(filePath),
          },
          {
            id: 'show-file-details',
            title: 'Show Details',
            shortcut: 'Cmd+D',
            execute: () => showFileResultDetailsByPath(filePath),
          },
          {
            id: 'reveal-file',
            title: 'Reveal in Finder',
            shortcut: 'Cmd+Enter',
            execute: () => revealFileResultByPath(filePath),
          },
          {
            id: 'copy-file-path',
            title: 'Copy Path',
            shortcut: 'Cmd+Shift+C',
            execute: () => copyFileResultPath(filePath),
          },
        ];
      }

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
      openFileResultByPath,
      showFileResultDetailsByPath,
      revealFileResultByPath,
      copyFileResultPath,
    ]
  );

  const selectedActions = useMemo(
    () => getActionsForCommand(selectedCommand),
    [getActionsForCommand, selectedCommand]
  );
  const actionsOverlayActions = useMemo(
    () => getActionsForCommand(actionsCommand),
    [actionsCommand, getActionsForCommand]
  );

  const contextCommand = useMemo(
    () => (contextMenu ? contextMenu.command : null),
    [contextMenu]
  );

  const contextActions = useMemo(
    () => getActionsForCommand(contextCommand),
    [getActionsForCommand, contextCommand]
  );

  const handleActionsOverlayKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (actionsOverlayActions.length === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedActionIndex((prev) =>
            Math.min(prev + 1, actionsOverlayActions.length - 1)
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedActionIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          await Promise.resolve(actionsOverlayActions[selectedActionIndex]?.execute());
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
    [actionsOverlayActions, selectedActionIndex, restoreLauncherFocus]
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
          launchType={run.launchType}
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
            setShowWhisperOnboarding(false);
            setShowWhisperHint(false);
          }}
        />
      ) : null}
      {showSpeak && speakPortalTarget ? (
        <SuperCmdRead
          status={speakStatus}
          voice={speakOptions.voice}
          voiceOptions={readVoiceOptions}
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
      {showWindowManager && windowManagerPortalTarget ? (
        <WindowManagerPanel
          show={showWindowManager}
          portalTarget={windowManagerPortalTarget}
          onClose={() => {
            setShowWindowManager(false);
          }}
        />
      ) : null}
      {showCursorPrompt && cursorPromptPortalTarget
        ? createPortal(
            <CursorPromptView
              variant="portal"
              cursorPromptText={cursorPromptText}
              setCursorPromptText={setCursorPromptText}
              cursorPromptStatus={cursorPromptStatus}
              cursorPromptResult={cursorPromptResult}
              cursorPromptError={cursorPromptError}
              cursorPromptInputRef={cursorPromptInputRef}
              aiAvailable={aiAvailable}
              submitCursorPrompt={submitCursorPrompt}
              closeCursorPrompt={closeCursorPrompt}
              acceptCursorPrompt={acceptCursorPrompt}
            />,
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

  // ─── Script Command Setup ───────────────────────────────────────
  if (scriptCommandSetup) {
    return (
      <ScriptCommandSetupView
        setup={scriptCommandSetup}
        alwaysMountedRunners={alwaysMountedRunners}
        onBack={() => {
          setScriptCommandSetup(null);
          setSearchQuery('');
          setSelectedIndex(0);
        }}
        onContinue={(command, values) => {
          setScriptCommandSetup(null);
          void runScriptCommand(command, values);
        }}
        setScriptCommandSetup={setScriptCommandSetup}
      />
    );
  }

  // ─── Script Output ──────────────────────────────────────────────
  if (scriptCommandOutput) {
    return (
      <ScriptCommandOutputView
        output={scriptCommandOutput}
        alwaysMountedRunners={alwaysMountedRunners}
        onBack={() => {
          setScriptCommandOutput(null);
          setSearchQuery('');
          setSelectedIndex(0);
        }}
      />
    );
  }

  // ─── Extension Preferences Setup ────────────────────────────────
  if (extensionPreferenceSetup) {
    return (
      <ExtensionPreferenceSetupView
        setup={extensionPreferenceSetup}
        alwaysMountedRunners={alwaysMountedRunners}
        onBack={() => {
          setExtensionPreferenceSetup(null);
          setScriptCommandSetup(null);
          setScriptCommandOutput(null);
          setSearchQuery('');
          setSelectedIndex(0);
        }}
        onLaunchExtension={(updatedBundle) => {
          setExtensionPreferenceSetup(null);
          setScriptCommandSetup(null);
          setScriptCommandOutput(null);
          if (updatedBundle.mode === 'no-view') {
            queueNoViewBundleRun(updatedBundle, 'userInitiated');
            localStorage.removeItem(LAST_EXT_KEY);
            return;
          }
          setExtensionView(updatedBundle);
          const extName = updatedBundle.extName || (updatedBundle as any).extensionName || '';
          const cmdName = updatedBundle.cmdName || (updatedBundle as any).commandName || '';
          if (updatedBundle.mode === 'view') {
            localStorage.setItem(LAST_EXT_KEY, JSON.stringify({ extName, cmdName }));
          } else {
            localStorage.removeItem(LAST_EXT_KEY);
          }
        }}
        onLaunchMenuBar={(updatedBundle) => {
          setExtensionPreferenceSetup(null);
          setScriptCommandSetup(null);
          setScriptCommandOutput(null);
          if (isMenuBarExtensionMounted(updatedBundle)) {
            hideMenuBarExtension(updatedBundle);
          } else {
            upsertMenuBarExtension(updatedBundle);
          }
          window.electron.hideWindow();
          setSearchQuery('');
          setSelectedIndex(0);
          localStorage.removeItem(LAST_EXT_KEY);
        }}
        setExtensionPreferenceSetup={setExtensionPreferenceSetup}
      />
    );
  }

  // ─── Extension view mode ──────────────────────────────────────────
  if (extensionView) {
    return (
      <>
        {alwaysMountedRunners}
        <div className="w-full h-full">
          <div className="glass-effect extension-runtime-shell overflow-hidden h-full flex flex-col">
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

  // ─── Camera mode ──────────────────────────────────────────────────
  if (showCamera) {
    return (
      <>
        {alwaysMountedRunners}
        <div className="w-full h-full">
          <div className="overflow-hidden h-full flex flex-col">
            <CameraExtension
              onClose={() => {
                setShowCamera(false);
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
      <CursorPromptView
        variant="inline"
        cursorPromptText={cursorPromptText}
        setCursorPromptText={setCursorPromptText}
        cursorPromptStatus={cursorPromptStatus}
        cursorPromptResult={cursorPromptResult}
        cursorPromptError={cursorPromptError}
        cursorPromptInputRef={cursorPromptInputRef}
        aiAvailable={aiAvailable}
        submitCursorPrompt={submitCursorPrompt}
        closeCursorPrompt={closeCursorPrompt}
        acceptCursorPrompt={acceptCursorPrompt}
        alwaysMountedRunners={alwaysMountedRunners}
      />
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

  // ─── Quick Link Manager mode ──────────────────────────────────────
  if (showQuickLinkManager) {
    return (
      <>
        {alwaysMountedRunners}
        <div className="w-full h-full">
          <div className="glass-effect overflow-hidden h-full flex flex-col">
            <QuickLinkManager
              initialView={showQuickLinkManager}
              onClose={() => {
                setShowQuickLinkManager(null);
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
              initialDetailPath={fileSearchInitialDetailPath}
              onClose={() => {
                setShowFileSearch(false);
                setFileSearchInitialDetailPath(null);
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
      <AiChatView
        alwaysMountedRunners={alwaysMountedRunners}
        aiQuery={aiQuery}
        setAiQuery={setAiQuery}
        aiResponse={aiResponse}
        aiStreaming={aiStreaming}
        aiInputRef={aiInputRef as React.RefObject<HTMLInputElement>}
        aiResponseRef={aiResponseRef as React.RefObject<HTMLDivElement>}
        submitAiQuery={submitAiQuery}
        exitAiMode={exitAiMode}
      />
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
          dictationPracticeText={whisperOnboardingPracticeText}
          onDictationPracticeTextChange={setWhisperOnboardingPracticeText}
          onboardingHotkeyPresses={onboardingHotkeyPresses}
          onClose={async () => {
            await window.electron.setLauncherMode('onboarding');
            setShowOnboarding(true);
          }}
          onComplete={async () => {
            await window.electron.setLauncherMode('default');
            await window.electron.saveSettings({ hasSeenOnboarding: true, hasSeenWhisperOnboarding: true });
            setShowOnboarding(false);
            setShowWhisperOnboarding(false);
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
  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass =
    document.documentElement.classList.contains('sc-native-liquid-glass') ||
    document.body.classList.contains('sc-native-liquid-glass');
  return (
    <>
    {alwaysMountedRunners}
    <div className="w-full h-full">
      <div className="glass-effect launcher-main-surface overflow-hidden h-full flex flex-col relative">
        {/* Search header - transparent background */}
        <div className="flex h-[60px] items-center gap-2 px-4 border-b border-[var(--ui-divider)]">
          <div ref={inlineArgumentLaneRef} className="relative min-w-0 flex-1">
            <div className="flex h-full items-center">
              <input
                ref={inputRef}
                type="text"
                placeholder="Search apps and settings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={handleLauncherSearchBlur}
                onKeyDown={handleKeyDown}
                className="launcher-search-input min-w-0 w-full bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] placeholder:font-medium text-[0.9375rem] font-medium tracking-[0.005em]"
                autoFocus
              />
            </div>
            {selectedInlineExtensionArgumentDefinitions.length > 0 ? (
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-x-hidden overflow-y-visible">
                <div
                  ref={inlineArgumentClusterRef}
                  className="pointer-events-auto inline-flex min-w-0 items-center gap-1"
                  style={{ marginLeft: inlineArgumentStartPx != null ? `${inlineArgumentStartPx}px` : '30%' }}
                >
                  {selectedInlineArgumentLeadingIcon ? (
                    <InlineArgumentLeadingIcon>{selectedInlineArgumentLeadingIcon}</InlineArgumentLeadingIcon>
                  ) : null}
                  {selectedInlineExtensionArgumentDefinitions.map((definition, index) => {
                    const value = selectedInlineExtensionArgumentValues[definition.name] || '';
                    const placeholder = definition.placeholder || definition.title || definition.name;
                    return (
                      <InlineArgumentField
                        key={`inline-arg-${definition.name}`}
                        inputRef={(el) => {
                          inlineArgumentInputRefs.current[index] = el;
                        }}
                        value={value}
                        placeholder={placeholder}
                        type={definition.type === 'dropdown' ? 'select' : definition.type === 'password' ? 'password' : 'text'}
                        options={(definition.data || []).map((option) => ({
                          value: String(option?.value || ''),
                          label: String(option?.title || option?.value || ''),
                        }))}
                        onChange={(nextValue) => {
                          if (!selectedCommand) return;
                          updateInlineExtensionArgumentValue(selectedCommand, definition.name, nextValue);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Tab') {
                            event.preventDefault();
                            const total = selectedInlineExtensionArgumentDefinitions.length;
                            const nextIndex = event.shiftKey ? index - 1 : index + 1;
                            if (nextIndex >= 0 && nextIndex < total) {
                              inlineArgumentInputRefs.current[nextIndex]?.focus();
                            } else {
                              inputRef.current?.focus();
                            }
                            return;
                          }
                          handleKeyDown(event);
                        }}
                      />
                    );
                  })}
                  {hasSelectedExtensionOverflowArguments ? (
                    <InlineArgumentOverflowBadge
                      count={selectedExtensionArgumentDefinitions.length - selectedInlineExtensionArgumentDefinitions.length}
                    />
                  ) : null}
                </div>
              </div>
            ) : selectedInlineQuickLinkDynamicFields.length > 0 ? (
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-x-hidden overflow-y-visible">
                <div
                  ref={inlineArgumentClusterRef}
                  className="pointer-events-auto inline-flex min-w-0 items-center gap-1"
                  style={{ marginLeft: inlineArgumentStartPx != null ? `${inlineArgumentStartPx}px` : '30%' }}
                >
                  {selectedInlineArgumentLeadingIcon ? (
                    <InlineArgumentLeadingIcon>{selectedInlineArgumentLeadingIcon}</InlineArgumentLeadingIcon>
                  ) : null}
                  {selectedInlineQuickLinkDynamicFields.map((field, index) => (
                    <InlineArgumentField
                      key={`inline-quicklink-${selectedQuickLinkId || 'none'}-${field.key}`}
                      inputRef={(el) => {
                        inlineQuickLinkInputRefs.current[index] = el;
                      }}
                      value={selectedInlineQuickLinkDynamicValues[field.key] || ''}
                      placeholder={field.defaultValue || field.name}
                      onChange={(nextValue) => {
                        if (!selectedQuickLinkId) return;
                        updateInlineQuickLinkDynamicValue(selectedQuickLinkId, field.key, nextValue);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Tab') {
                          event.preventDefault();
                          const total = selectedInlineQuickLinkDynamicFields.length;
                          const nextIndex = event.shiftKey ? index - 1 : index + 1;
                          if (nextIndex >= 0 && nextIndex < total) {
                            inlineQuickLinkInputRefs.current[nextIndex]?.focus();
                          } else {
                            inputRef.current?.focus();
                          }
                          return;
                        }
                        handleKeyDown(event);
                      }}
                    />
                  ))}
                  {hasSelectedQuickLinkOverflowDynamicFields ? (
                    <InlineArgumentOverflowBadge
                      count={selectedQuickLinkDynamicFields.length - selectedInlineQuickLinkDynamicFields.length}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {searchQuery && aiAvailable && !shouldHideAskAi && (
              <button
                onClick={() => startAiChat(searchQuery)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--soft-pill-bg)] hover:bg-[var(--soft-pill-hover-bg)] transition-colors flex-shrink-0 group"
              >
                <Sparkles className="w-3 h-3 text-white/30 group-hover:text-purple-400 transition-colors" />
                <span className="text-[0.6875rem] text-white/30 group-hover:text-white/50 transition-colors">Ask AI</span>
                <kbd className="text-[0.625rem] text-white/20 bg-[var(--soft-pill-bg)] px-1 py-0.5 rounded font-mono leading-none">Tab</kbd>
              </button>
            )}
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto custom-scrollbar p-1.5 list-area"
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
              <p className="text-sm">Discovering apps...</p>
            </div>
          ) : displayCommands.length === 0 && !calcResult ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
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
                      ? 'bg-[var(--launcher-card-selected-bg)] border-transparent'
                      : 'bg-[var(--launcher-card-bg)] border-[var(--launcher-card-border)] hover:bg-[var(--launcher-card-hover-bg)]'
                  }`}
                  onClick={() => {
                    navigator.clipboard.writeText(calcResult.result);
                    window.electron.hideWindow();
                  }}
                >
                  <div className="flex items-center justify-center gap-6">
                    <div className="text-center">
                      <div className="text-white/80 text-xl font-medium">{calcResult.input}</div>
                      <div className="text-white/35 text-xs mt-1">{calcResult.inputLabel}</div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-white/25 flex-shrink-0" />
                    <div className="text-center">
                      <div className="text-white text-xl font-medium">{calcResult.result}</div>
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
                { title: 'Files', items: groupedCommands.files },
              ]
                .filter((section) => section.items.length > 0)
                .map((section) => section)
                .reduce(
                  (acc, section) => {
                    const startIndex = acc.index;
                    acc.nodes.push(
                      <div
                        key={`section-${section.title}`}
                        className="px-3 pt-2 pb-1 text-[0.6875rem] uppercase tracking-wider text-[var(--text-subtle)] font-medium"
                      >
                        {section.title}
                      </div>
                    );
                    section.items.forEach((command, i) => {
                      const flatIndex = startIndex + i;
                      const accessoryLabel = getCommandAccessoryLabel(command);
                      const typeBadgeLabel = getCommandTypeBadgeLabel(command);
                      const fallbackCategory = getCategoryLabel(command.category);
                      const commandAlias = String(commandAliases[command.id] || '').trim();
                      const aliasMatchesSearch =
                        Boolean(commandAlias) &&
                        Boolean(searchQuery.trim()) &&
                        commandAlias.toLowerCase().includes(searchQuery.trim().toLowerCase());
                      acc.nodes.push(
                        <div
                          key={command.id}
                          ref={(el) => (itemRefs.current[flatIndex + calcOffset] = el)}
                          className={`command-item px-3 py-2 rounded-lg cursor-pointer ${
                            flatIndex + calcOffset === selectedIndex ? 'selected' : ''
                          }`}
                          onClick={() => {
                            void handleCommandRowClick(command, flatIndex + calcOffset);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setSelectedIndex(flatIndex + calcOffset);
                            setShowActions(false);
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              command,
                            });
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                              {renderCommandIcon(command)}
                            </div>

                            <div className="min-w-0 flex-1 flex items-center gap-2">
                              <div className="text-[var(--text-primary)] text-[0.8125rem] font-medium truncate tracking-[0.004em]">
                                {getCommandDisplayTitle(command)}
                              </div>
                              {accessoryLabel ? (
                                <div className="text-[var(--text-muted)] text-[0.75rem] font-medium truncate">
                                  {accessoryLabel}
                                </div>
                              ) : (
                                <div className="text-[var(--text-muted)] text-[0.6875rem] font-medium truncate">
                                  {fallbackCategory}
                                </div>
                              )}
                              {aliasMatchesSearch ? (
                                <div className="inline-flex items-center h-5 rounded-md border border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] px-1.5 text-[0.625rem] font-mono text-[var(--text-subtle)] leading-none flex-shrink-0">
                                  {commandAlias}
                                </div>
                              ) : null}
                            </div>
                            {typeBadgeLabel ? (
                              <div className="text-[var(--text-muted)] text-[0.6875rem] font-medium leading-none flex-shrink-0 truncate">
                                {typeBadgeLabel}
                              </div>
                            ) : null}
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
            className="sc-glass-footer sc-launcher-footer absolute bottom-0 left-0 right-0 z-10 flex items-center px-4 py-2.5"
          >
            <div
              className="sc-footer-primary flex items-center gap-2 text-xs flex-1 min-w-0 font-normal truncate text-[var(--text-subtle)]"
            >
              {selectedCommand
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
                  className="text-[var(--text-primary)] text-xs font-semibold hover:text-[var(--text-primary)] transition-colors"
                >
                  {selectedActions[0].title}
                </button>
                {selectedActions[0].shortcut && (
                  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">
                    {renderShortcutLabel(selectedActions[0].shortcut)}
                  </kbd>
                )}
              </div>
            )}
            <button
              onClick={() => {
                if (!selectedCommand) return;
                setContextMenu(null);
                setActionsCommand(selectedCommand);
                setSelectedActionIndex(0);
                setShowActions(true);
              }}
              className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <span className="text-xs font-normal">Actions</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">⌘</kbd>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">K</kbd>
            </button>
          </div>
        )}
      </div>
    </div>
    {quickLinkDynamicPrompt && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-5"
        style={{ background: 'var(--bg-scrim)' }}
        onMouseDown={cancelQuickLinkDynamicPrompt}
      >
        <div
          className="w-[520px] max-w-[92vw] rounded-xl overflow-hidden"
          onMouseDown={(event) => event.stopPropagation()}
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
                  border: '1px solid var(--ui-panel-border)',
                }
              : {
                  background: 'var(--bg-overlay-strong)',
                  backdropFilter: 'blur(28px)',
                  WebkitBackdropFilter: 'blur(28px)',
                  border: '1px solid var(--snippet-divider)',
                }
          }
        >
          <div className="px-4 py-3 border-b border-[var(--snippet-divider)] text-[var(--text-primary)] text-sm font-medium">
            Fill Quick Link Arguments
          </div>
          <div className="px-4 pt-3 text-xs text-[var(--text-muted)]">
            {getCommandDisplayTitle(quickLinkDynamicPrompt.command)}
          </div>
          <div className="p-4 pt-3 space-y-3">
            {quickLinkDynamicPrompt.fields.map((field, idx) => (
              <div key={field.key}>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">{field.name}</label>
                <input
                  ref={idx === 0 ? quickLinkDynamicInputRef : undefined}
                  type="text"
                  value={quickLinkDynamicPrompt.values[field.key] || ''}
                  onChange={(event) =>
                    setQuickLinkDynamicPrompt((prev) =>
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
                  className="w-full bg-[var(--ui-segment-bg)] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-[13px] text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)]"
                />
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-[var(--snippet-divider)] flex items-center justify-end gap-2">
            <button
              onClick={cancelQuickLinkDynamicPrompt}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--snippet-divider)] bg-[var(--ui-segment-bg)] text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors"
            >
              <span>Cancel</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">Esc</kbd>
            </button>
            <button
              onClick={() => void submitQuickLinkDynamicPrompt()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--snippet-divider-strong)] bg-[var(--ui-segment-active-bg)] text-xs text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors"
            >
              <span>Open Link</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">↩</kbd>
            </button>
          </div>
        </div>
      </div>
    )}
    {showActions && actionsOverlayActions.length > 0 && (
      <div
        className="fixed inset-0 z-50"
        onClick={() => setShowActions(false)}
        style={{ background: 'var(--bg-scrim)' }}
      >
        <div
          ref={actionsOverlayRef}
          className="absolute bottom-12 right-3 w-96 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0"
          tabIndex={0}
          onKeyDown={handleActionsOverlayKeyDown}
          style={{
            ...(isNativeLiquidGlass
              ? {
                  background: 'rgba(var(--surface-base-rgb), 0.72)',
                  backdropFilter: 'blur(44px) saturate(155%)',
                  WebkitBackdropFilter: 'blur(44px) saturate(155%)',
                  border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
                  boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26)',
                }
              : isGlassyTheme
              ? {
                  background:
                    'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                  backdropFilter: 'blur(96px) saturate(190%)',
                  WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                  border: '1px solid rgba(var(--on-surface-rgb), 0.05)',
                }
              : {
                  background: 'var(--card-bg)',
                  backdropFilter: 'blur(40px)',
                  WebkitBackdropFilter: 'blur(40px)',
                  border: '1px solid var(--border-primary)',
                }),
            outline: 'none',
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLDivElement).style.outline = 'none';
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex-1 overflow-y-auto py-1">
            {actionsOverlayActions.map((action, idx) => (
              <div
                key={action.id}
                className={`mx-1 px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-2.5 cursor-pointer transition-colors ${
                  idx === selectedActionIndex
                    ? action.style === 'destructive'
                      ? 'bg-[var(--action-menu-selected-bg)] text-[var(--status-danger-faded)]'
                      : 'bg-[var(--action-menu-selected-bg)] text-[var(--text-primary)]'
                    : action.style === 'destructive'
                      ? 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--status-danger-faded)]'
                      : 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--text-secondary)]'
                }`}
                style={
                  idx === selectedActionIndex
                    ? {
                        background: 'var(--action-menu-selected-bg)',
                        borderColor: 'var(--action-menu-selected-border)',
                        boxShadow: 'var(--action-menu-selected-shadow)',
                      }
                    : undefined
                }
                onClick={async () => {
                  await Promise.resolve(action.execute());
                  setShowActions(false);
                  restoreLauncherFocus();
                }}
                onMouseMove={() => setSelectedActionIndex(idx)}
              >
                <span className="flex-1 text-sm truncate">{action.title}</span>
                {action.shortcut && (
                  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] font-medium text-[var(--text-muted)]">
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
          className="absolute w-80 max-h-[60vh] rounded-xl overflow-hidden flex flex-col shadow-2xl outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0"
          tabIndex={0}
          onKeyDown={handleContextMenuKeyDown}
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 340),
            top: Math.min(contextMenu.y, window.innerHeight - 320),
            ...(isNativeLiquidGlass
              ? {
                  background: 'rgba(var(--surface-base-rgb), 0.72)',
                  backdropFilter: 'blur(44px) saturate(155%)',
                  WebkitBackdropFilter: 'blur(44px) saturate(155%)',
                  border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
                  boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26)',
                }
              : isGlassyTheme
              ? {
                  background:
                    'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                  backdropFilter: 'blur(96px) saturate(190%)',
                  WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                  border: '1px solid rgba(var(--on-surface-rgb), 0.05)',
                }
              : {
                  background: 'var(--card-bg)',
                  backdropFilter: 'blur(40px)',
                  WebkitBackdropFilter: 'blur(40px)',
                  border: '1px solid var(--border-primary)',
                }),
            outline: 'none',
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLDivElement).style.outline = 'none';
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex-1 overflow-y-auto py-1">
            {contextActions.map((action, idx) => (
              <div
                key={`ctx-${action.id}`}
                className={`mx-1 px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-2.5 cursor-pointer transition-colors ${
                  idx === selectedContextActionIndex
                    ? action.style === 'destructive'
                      ? 'bg-[var(--action-menu-selected-bg)] text-[var(--status-danger-faded)]'
                      : 'bg-[var(--action-menu-selected-bg)] text-[var(--text-primary)]'
                    : action.style === 'destructive'
                      ? 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--status-danger-faded)]'
                      : 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--text-secondary)]'
                }`}
                style={
                  idx === selectedContextActionIndex
                    ? {
                        background: 'var(--action-menu-selected-bg)',
                        borderColor: 'var(--action-menu-selected-border)',
                        boxShadow: 'var(--action-menu-selected-shadow)',
                      }
                    : undefined
                }
                onClick={async () => {
                  await Promise.resolve(action.execute());
                  setContextMenu(null);
                  restoreLauncherFocus();
                }}
                onMouseMove={() => setSelectedContextActionIndex(idx)}
              >
                <span className="flex-1 text-sm truncate">{action.title}</span>
                {action.shortcut && (
                  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] font-medium text-[var(--text-muted)]">
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
