/**
 * Launcher App
 *
 * Dynamically displays all applications and System Settings.
 * Shows category labels like Raycast.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react';
import supercmdLogo from '../../../supercmd.png';
import type {
  CommandInfo,
  ExtensionBundle,
  AppSettings,
  IndexedFileSearchResult,
  BrowserSearchSource,
  BrowserSearchResultGroupSetting,
} from '../types/electron';
import ExtensionView from './ExtensionView';
import ClipboardManager from './ClipboardManager';
import SnippetManager from './SnippetManager';
import NotesSearchInline from './NotesSearchInline';
import CanvasSearchInline from './CanvasSearchInline';
import QuickLinkManager from './QuickLinkManager';
import CameraExtension from './CameraExtension';
import ScheduleExtension from './ScheduleExtension';
import OnboardingExtension from './OnboardingExtension';
import FileSearchExtension from './FileSearchExtension';
import MenuItemSearch from './MenuItemSearchExtension';
import { useDetachedPortalWindow } from './useDetachedPortalWindow';
import { useAppViewManager } from './hooks/useAppViewManager';
import { useAiChat } from './hooks/useAiChat';
import { useCursorPrompt } from './hooks/useCursorPrompt';
import { useMenuBarExtensions } from './hooks/useMenuBarExtensions';
import { useBackgroundRefresh } from './hooks/useBackgroundRefresh';
import { useSpeakManager } from './hooks/useSpeakManager';
import { useWhisperManager } from './hooks/useWhisperManager';
import { useBrowserSearch } from './hooks/useBrowserSearch';
import { useBrowserResultsController } from './hooks/useBrowserResultsController';
import { useWebSearchController } from './hooks/useWebSearchController';
import { useLauncherCommandModel } from './hooks/useLauncherCommandModel';
import { useLauncherInlineArguments } from './hooks/useLauncherInlineArguments';
import { useLauncherActionModel } from './hooks/useLauncherActionModel';
import { useLauncherLocalSystemCommands } from './hooks/useLauncherLocalSystemCommands';
import { useLauncherCommandExecution } from './hooks/useLauncherCommandExecution';
import { useLauncherWindowShownHandler } from './hooks/useLauncherWindowShownHandler';
import { useLauncherKeyboardControls } from './hooks/useLauncherKeyboardControls';
import { AI_CHAT_STORAGE_KEY, LAST_EXT_KEY, LAST_LAUNCHER_QUERY_KEY, MAX_LAUNCHER_QUERY_HISTORY, MAX_RECENT_COMMANDS } from './utils/constants';
import { applyBaseColor } from './utils/base-color';
import { resetAccessToken } from './raycast-api';
import {
  type MemoryFeedback,
  formatShortcutLabel,
  getCommandDisplayTitle,
} from './utils/command-helpers';
import {
  collectLegacyExtensionPreferencesSnapshot,
  readJsonObject, writeJsonObject,
  getScriptCmdArgsKey,
  hydrateExtensionBundlePreferences,
  shouldOpenCommandSetup,
  getMissingRequiredPreferences,
  getMissingRequiredScriptArguments, toScriptArgumentMapFromArray,
  migrateExtensionPreferencesFromLocalStorage,
  hydrateExtensionPreferencesFromSettings,
} from './utils/extension-preferences';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';
import { refreshThemeFromStorage, setForcedTheme } from './utils/theme';
import { applyUiStyle } from './utils/ui-style';
import ScriptCommandSetupView from './views/ScriptCommandSetupView';
import ScriptCommandOutputView from './views/ScriptCommandOutputView';
import ExtensionPreferenceSetupView from './views/ExtensionPreferenceSetupView';
import AiChatView from './views/AiChatView';
import CursorPromptView from './views/CursorPromptView';
import AppUninstallView from './views/AppUninstallView';
import BrowserResultsView from './views/BrowserResultsView';
import WebSearchView from './views/WebSearchView';
import LauncherMainView from './views/LauncherMainView';
import HiddenExtensionRunners from './components/HiddenExtensionRunners';
import DetachedOverlayRunners from './components/DetachedOverlayRunners';
import LauncherViewShell from './components/LauncherViewShell';
import type { LauncherContextMenuState } from './components/LauncherContextMenuOverlay';
import type { QuickLinkDynamicPromptState } from './components/QuickLinkDynamicPromptOverlay';
import { useI18n } from './i18n';
import {
  getFileBasename,
  getFileResultPathFromCommand,
  getLauncherFileSearchTerms,
  isPathLikeLauncherFileQuery,
  matchesLauncherFileNameTerms,
  matchesLauncherPathQuery,
  MAX_LAUNCHER_FILE_CANDIDATE_RESULTS,
  MAX_LAUNCHER_FILE_RESULTS,
  MAX_LAUNCHER_FILE_RESULT_ICONS,
  MIN_LAUNCHER_FILE_QUERY_LENGTH,
  normalizeLauncherFileSearchText,
} from './utils/launcher-file-results';
import {
  BROWSER_SEARCH_SHOW_ALL_RESULTS_ID,
  DEFAULT_BROWSER_SEARCH_RESULT_GROUPS,
  isBrowserSearchCommand,
  normalizeBrowserSearchResultGroups,
} from './utils/browser-search-commands';
import {
  DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT,
  DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT,
  clampLauncherBackgroundPercent,
  toFileUrl,
} from './utils/launcher-background';
import {
  DIRECT_LAUNCH_EXPANSION_GUARD_MS,
  MAX_INLINE_QUICK_LINK_ARGUMENTS,
  getQuickLinkIdFromCommandId,
} from './utils/launcher-misc';
import {
  WEB_SEARCH_ROOT_BANG_PREFIX,
  buildBangSearchUrl,
  getSearchBangByKeyFromList,
  parseSearchBangState,
} from './utils/web-search-bangs';
import {
  recordRootSearchLaunchInState,
  type RootSearchRankingState,
} from './utils/root-search-ranking';

const BROWSER_APP_PATHS: Partial<Record<BrowserSearchSource, string[]>> = {
  chrome: [
    '/Applications/Google Chrome.app',
    '/System/Applications/Google Chrome.app',
  ],
  brave: ['/Applications/Brave Browser.app'],
  edge: ['/Applications/Microsoft Edge.app'],
  vivaldi: ['/Applications/Vivaldi.app'],
  helium: ['/Applications/Helium.app'],
  arc: ['/Applications/Arc.app'],
};

const DEFAULT_POP_TO_ROOT_TIMEOUT_SECONDS = 90;

// Intern cache: commandId → stable iconDataUrl string reference.
// Prevents duplicate base64 strings accumulating across repeated fetchCommands() IPC calls.
const _commandIconCache = new Map<string, string>();

const App: React.FC = () => {
  const { t } = useI18n();
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [commandAliases, setCommandAliases] = useState<Record<string, string>>({});
  const [commandHotkeys, setCommandHotkeys] = useState<Record<string, string>>({});
  const [pinnedCommands, setPinnedCommands] = useState<string[]>([]);
  const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [recentCommandLaunchCounts, setRecentCommandLaunchCounts] = useState<Record<string, number>>({});
  const [launcherBackgroundImagePath, setLauncherBackgroundImagePath] = useState('');
  const [launcherBackgroundImageEverywhere, setLauncherBackgroundImageEverywhere] = useState(false);
  const [launcherBackgroundImageBlurPercent, setLauncherBackgroundImageBlurPercent] = useState(
    DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT
  );
  const [launcherBackgroundImageOpacityPercent, setLauncherBackgroundImageOpacityPercent] = useState(
    DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT
  );
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [autoQuitAppPaths, setAutoQuitAppPaths] = useState<Set<string>>(new Set());
  const browserSearch = useBrowserSearch(searchQuery);
  const [, setBrowserSearchSkipAutoComplete] = useState(false);
  const [browserSearchResultGroups, setBrowserSearchResultGroups] = useState<BrowserSearchResultGroupSetting[]>(
    DEFAULT_BROWSER_SEARCH_RESULT_GROUPS
  );
  const [webSearchSuggestionsEnabled, setWebSearchSuggestionsEnabled] = useState(true);
  const [rootSearchAutocompleteEnabled, setRootSearchAutocompleteEnabled] = useState(true);
  const [rootSearchRanking, setRootSearchRanking] = useState<RootSearchRankingState>({});
  const rootSearchRankingRef = useRef<RootSearchRankingState>({});
  const [launcherFileResults, setLauncherFileResults] = useState<IndexedFileSearchResult[]>([]);
  const [disableFileSearchResults, setDisableFileSearchResults] = useState(false);
  const [launcherViewMode, setLauncherViewMode] = useState<'expanded' | 'compact'>('expanded');
  const [isCompactCollapsed, setIsCompactCollapsed] = useState(true);
  const [launcherFileIcons, setLauncherFileIcons] = useState<Record<string, string>>({});
  const [fileIsDirectoryMap, setFileIsDirectoryMap] = useState<Record<string, boolean>>({});
  const [defaultBrowserIconDataUrl, setDefaultBrowserIconDataUrl] = useState('');
  const [browserAppIconDataUrls, setBrowserAppIconDataUrls] = useState<Record<string, string>>({});
  const [launcherFooterStatus, setLauncherFooterStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const launcherFooterStatusTimerRef = useRef<number | null>(null);
  const [fileSearchInitialDetailPath, setFileSearchInitialDetailPath] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [navigationStyle, setNavigationStyle] = useState<'vim' | 'macos'>('vim');
  const [isLoading, setIsLoading] = useState(false);
  const homeDir = String((window.electron as any).homeDir || '');
  useEffect(() => {
    rootSearchRankingRef.current = rootSearchRanking;
  }, [rootSearchRanking]);
  const {
    extensionView, extensionPreferenceSetup, scriptCommandSetup, scriptCommandOutput,
    showClipboardManager, clipboardManagerOpenedViaShortcut, showSnippetManager, showNotesSearch, showCanvasSearch, showQuickLinkManager, showFileSearch, showCursorPrompt,
    showWhisper, showSpeak, showCamera, showSchedule, showWindowManager, showMenuItemSearch, showAppUninstall, showWhisperOnboarding, showWhisperHint, showOnboarding, aiMode,
    openOnboarding, openWhisper, openClipboardManager,
    openSnippetManager, openNotesSearch, openCanvasSearch, openQuickLinkManager, openFileSearch, openCursorPrompt, openSpeak, openCamera, openSchedule, openWindowManager, openMenuItemSearch, openAppUninstall,
    setExtensionView, setExtensionPreferenceSetup, setScriptCommandSetup, setScriptCommandOutput,
    setShowClipboardManager, setClipboardManagerOpenedViaShortcut, setShowSnippetManager, setShowNotesSearch, setShowCanvasSearch, setShowQuickLinkManager, setShowFileSearch, setShowCursorPrompt,
    setShowWhisper, setShowSpeak, setShowCamera, setShowSchedule, setShowWindowManager, setShowMenuItemSearch, setShowAppUninstall, setShowWhisperOnboarding, setShowWhisperHint,
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
  const [whisperStartToken, setWhisperStartToken] = useState(0);
  const {
    speakStatus, speakOptions,
    setConfiguredEdgeTtsVoice, setConfiguredTtsModel,
    readVoiceOptions,
    handleSpeakVoiceChange, handleSpeakRateChange, handleSpeakTogglePause, handleSpeakPreviousParagraph, handleSpeakNextParagraph,
    speakPortalTarget,
  } = useSpeakManager({ showSpeak, setShowSpeak });
  const [onboardingRequiresShortcutFix, setOnboardingRequiresShortcutFix] = useState(false);
  const [onboardingHotkeyPresses, setOnboardingHotkeyPresses] = useState(0);
  const [launcherShortcut, setLauncherShortcut] = useState('Alt+Space');
  const [whisperAutoClose, setWhisperAutoClose] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const [actionsCommand, setActionsCommand] = useState<CommandInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<LauncherContextMenuState | null>(null);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [selectedContextActionIndex, setSelectedContextActionIndex] = useState(0);
  const [quickLinkEditId, setQuickLinkEditId] = useState<string | null>(null);
  const [quickLinkDynamicPrompt, setQuickLinkDynamicPrompt] =
    useState<QuickLinkDynamicPromptState | null>(null);
  const {
    menuBarExtensions,
    backgroundNoViewRuns, setBackgroundNoViewRuns,
    isMenuBarExtensionMounted,
    hideMenuBarExtension,
    hideMenuBarExtensionsForExtension,
    upsertMenuBarExtension,
  } = useMenuBarExtensions();
  const [selectedTextSnapshot, setSelectedTextSnapshot] = useState('');
  const [memoryFeedback, setMemoryFeedback] = useState<MemoryFeedback>(null);
  const [memoryActionLoading, setMemoryActionLoading] = useState(false);
  const memoryFeedbackTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    browserResultsViewQuery,
    setBrowserResultsViewQuery,
    browserResultsViewScope,
    setBrowserResultsViewScope,
    browserResultsViewSelectedIndex,
    setBrowserResultsViewSelectedIndex,

    browserResultsViewInputRef,
    bookmarkNicknameInputRef,

    browserResultsViewResults,
    browserResultsViewSections,
    selectedBrowserResult,

    browserHistoryProfileOptions,
    effectiveBrowserHistoryProfileIds,
    showHistoryProfilePicker,
    historyProfileFilterLabel,
    browserAlternateProfileLabel,
    browserAlternateProfileBrowserId,
    browserHistoryProfileMenuOpen,
    setBrowserHistoryProfileMenuOpen,
    setBrowserHistorySelectedProfileIds,

    browserResultsPlaceholder,

    bookmarkNicknamePrompt,
    setBookmarkNicknamePrompt,
    bookmarkNicknameSuggestion,
    openBookmarkNicknamePrompt,
    closeBookmarkNicknamePrompt,

    activateBrowserResult,
    loadMoreBrowserResults,
    closeBrowserResults,

    isBrowserResultsViewOpen,
  } = useBrowserResultsController({
    browserSearch,
    resultGroups: browserSearchResultGroups,
    launcherInputRef: inputRef,
    t,
  });
  const submitBrowserSearchRef = useRef<
    (query: string, options?: Parameters<typeof browserSearch.executeBrowserSearch>[1]) => void | Promise<boolean>
  >(() => Promise.resolve(false));
  const isLauncherModeActiveRef = useRef(false);
  const fileSearchRequestSeqRef = useRef(0);
  const commandsRef = useRef<CommandInfo[]>([]);
  const lastCommandsFetchAtRef = useRef(0);
  const executingCommandRef = useRef(false);
  const showActionsRef = useRef(false);
  const showAppUninstallRef = useRef<string | null>(null);
  const selectedCommandRef = useRef<CommandInfo | null>(null);
  commandsRef.current = commands;

  const restoreLauncherFocus = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const queueNoViewBundleRun = useCallback((
    bundle: ExtensionBundle,
    launchType: 'userInitiated' | 'background' = 'userInitiated',
    reportStatus = false
  ) => {
    const runId = `${bundle.extensionName || bundle.extName}/${bundle.commandName || bundle.cmdName}/${Date.now()}`;
    setBackgroundNoViewRuns((prev) => [...prev, { runId, bundle, launchType, reportStatus }]);
  }, [setBackgroundNoViewRuns]);

  const onExitAiMode = useCallback(() => {
    if (launcherViewMode === 'compact') {
      setSearchQuery('');
      setIsCompactCollapsed(true);
      window.electron.resizeLauncherWindow(false);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [launcherViewMode]);

  const {
    messages: aiMessages, aiStreaming, aiAvailable, aiQuery, setAiQuery,
    aiResponseRef, aiInputRef, setAiAvailable,
    conversations: aiConversations, activeConversationId: aiActiveConversationId,
    startAiChat, sendMessage: aiSendMessage, stopStreaming: aiStopStreaming,
    newChat: aiNewChat, selectConversation: aiSelectConversation,
    deleteConversation: aiDeleteConversation, exitAiMode,
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
  const directLaunchExpansionGuardUntilRef = useRef<number>(0);
  // Holds a search query to restore after the window-shown reset, set by the
  // hotkey no-view path when it needs to open the launcher with a pre-typed query.
  const pendingWindowShownQueryRef = useRef<string | null>(null);
  const pinnedCommandsRef = useRef<string[]>([]);
  const pinnedFilesRef = useRef<string[]>([]);
  const extensionViewRef = useRef<ExtensionBundle | null>(null);
  extensionViewRef.current = extensionView;
  pinnedCommandsRef.current = pinnedCommands;
  pinnedFilesRef.current = pinnedFiles;

  const expandLauncherForDirectLaunch = useCallback(() => {
    directLaunchExpansionGuardUntilRef.current = Date.now() + DIRECT_LAUNCH_EXPANSION_GUARD_MS;
    setIsCompactCollapsed(false);
    void window.electron.resizeLauncherWindow(true);

    // Extension/script direct launches are dispatched with executeJavaScript(),
    // which can beat the async window-shown IPC reset. Retry briefly so the
    // direct launch remains expanded regardless of delivery order.
    [0, 80, 180].forEach((delayMs) => {
      window.setTimeout(() => {
        if (Date.now() > directLaunchExpansionGuardUntilRef.current) return;
        setIsCompactCollapsed(false);
        void window.electron.resizeLauncherWindow(true);
      }, delayMs);
    });
  }, []);

  const {
    webSearchQuery,
    setWebSearchQuery,
    webSearchSelectedIndex,
    setWebSearchSelectedIndex,

    webSearchInputRef,
    webSearchBangInputRef,

    webSearchDefaultBangKey,
    webSearchBangUsage,
    webSearchShowHiddenBangs,

    effectiveSearchBangs,
    enabledSearchBangs,
    rootBangState,
    rootWebSearchSuggestions,

    webSearchResults,
    visibleWebSearchSections,
    selectedWebSearchResult,
    isWebSearchBangManager,
    activeWebSearchBang,

    webSearchBangPrompt,
    setWebSearchBangPrompt,
    webSearchCustomBangPrompt,
    setWebSearchCustomBangPrompt,

    openWebSearchMode,
    closeWebSearch,
    activateWebSearchResult,
    loadMoreWebSearchResults,

    openWebSearchBangPrompt,
    saveWebSearchBangAliases,
    toggleWebSearchBangDisabled,
    toggleWebSearchShowHidden,

    openWebSearchCustomBangPrompt,
    closeWebSearchCustomBangPrompt,
    saveWebSearchCustomBang,

    hydrateWebSearchSettings,
  } = useWebSearchController({
    launcherInputRef: inputRef,
    expandLauncherForDirectLaunch,
    submitBrowserSearchRef,
    setLauncherSearchQuery: setSearchQuery,
    setLauncherSelectedIndex: setSelectedIndex,
    rootSearchQuery: deferredSearchQuery,
    aiMode,
    t,
    browserSearchEnabled: browserSearch.enabled,
  });

  // Configurable timeout (ms) before the launcher resets to root search after
  // it has been hidden. Synced from settings.popToRootSearchTimeoutSeconds.
  // 0 = reset immediately on every reopen.
  const popToRootTimeoutMsRef = useRef<number>(DEFAULT_POP_TO_ROOT_TIMEOUT_SECONDS * 1000);
  const hasPersistableView = Boolean(
    extensionView ||
    showClipboardManager ||
    showSnippetManager ||
    showQuickLinkManager ||
    showFileSearch ||
    showNotesSearch ||
    showCanvasSearch ||
    isBrowserResultsViewOpen ||
    webSearchQuery !== null ||
    showCamera ||
    showSchedule ||
    showAppUninstall
  );


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


  const showLauncherFooterStatus = useCallback((type: 'success' | 'error', text: string, durationMs = 3000) => {
    if (launcherFooterStatusTimerRef.current !== null) {
      window.clearTimeout(launcherFooterStatusTimerRef.current);
      launcherFooterStatusTimerRef.current = null;
    }
    setLauncherFooterStatus({ type, text });
    launcherFooterStatusTimerRef.current = window.setTimeout(() => {
      setLauncherFooterStatus(null);
      launcherFooterStatusTimerRef.current = null;
    }, durationMs);
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

  const loadLauncherPreferences = useCallback(async () => {
    try {
      const settings = (await window.electron.getSettings()) as AppSettings;
      const shortcutStatus = await window.electron.getGlobalShortcutStatus();
      setPinnedCommands(settings.pinnedCommands || []);
      setPinnedFiles(
        Array.isArray(settings.pinnedFiles)
          ? settings.pinnedFiles.map((p) => String(p || '').trim()).filter(Boolean)
          : []
      );
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
      setCommandHotkeys(
        Object.entries(settings.commandHotkeys || {}).reduce((acc, [commandId, hotkey]) => {
          const normalizedCommandId = String(commandId || '').trim();
          const normalizedHotkey = String(hotkey || '').trim();
          if (!normalizedCommandId || !normalizedHotkey) return acc;
          acc[normalizedCommandId] = normalizedHotkey;
          return acc;
        }, {} as Record<string, string>)
      );
      setLauncherShortcut(settings.globalShortcut || 'Alt+Space');
      setBrowserSearchResultGroups(normalizeBrowserSearchResultGroups(settings.browserSearch?.resultGroups));
      setWebSearchSuggestionsEnabled(settings.browserSearch?.webSearchSuggestionsEnabled !== false);
      setRootSearchAutocompleteEnabled(settings.rootSearchAutocompleteEnabled !== false);
      setRootSearchRanking(settings.rootSearchRanking || {});
      hydrateWebSearchSettings(settings);
      const speakToggleHotkey = settings.commandHotkeys?.['system-supercmd-whisper-speak-toggle'] ?? '';
      setWhisperSpeakToggleLabel(formatShortcutLabel(speakToggleHotkey));
      setConfiguredEdgeTtsVoice(String(settings.ai?.edgeTtsVoice || 'en-US-EricNeural'));
      setConfiguredTtsModel(String(settings.ai?.textToSpeechModel || 'edge-tts'));
      setWhisperAutoClose(settings.ai?.whisperAutoClose !== false);
      setLauncherBackgroundImagePath(String(settings.launcherBackgroundImagePath || ''));
      setLauncherBackgroundImageEverywhere(Boolean(settings.launcherBackgroundImageEverywhere));
      setLauncherBackgroundImageBlurPercent(
        clampLauncherBackgroundPercent(
          settings.launcherBackgroundImageBlurPercent,
          DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT
        )
      );
      setLauncherBackgroundImageOpacityPercent(
        clampLauncherBackgroundPercent(
          settings.launcherBackgroundImageOpacityPercent,
          DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT
        )
      );
      setDisableFileSearchResults(Boolean(settings.disableFileSearchResults));
      setLauncherViewMode(settings.launcherViewMode || 'expanded');
      applyAppFontSize(settings.fontSize);
      applyUiStyle(settings.uiStyle || 'default');
      applyBaseColor(settings.baseColor || '#101113');
      setNavigationStyle(settings.navigationStyle === 'macos' ? 'macos' : 'vim');
      // Load auto-quit app paths
      const aqApps = settings.autoQuitApps || [];
      setAutoQuitAppPaths(new Set(aqApps.map((a: any) => a.appPath)));
      const popToRootSeconds = Number(settings.popToRootSearchTimeoutSeconds);
      popToRootTimeoutMsRef.current = (Number.isFinite(popToRootSeconds) ? Math.max(0, popToRootSeconds) : DEFAULT_POP_TO_ROOT_TIMEOUT_SECONDS) * 1000;
      const shouldShowOnboarding = !settings.hasSeenOnboarding;
      setShowOnboarding(shouldShowOnboarding);
      setOnboardingRequiresShortcutFix(shouldShowOnboarding && !shortcutStatus.ok);
      // Mirror localStorage extension prefs into synced settings (one-shot
      // per machine), then hydrate localStorage from any prefs synced from
      // another Mac. Order matters: migrate first so this Mac's existing
      // values are pushed up before we overwrite from the merged settings.
      // Re-fetch settings post-migration — the snapshot above is stale once
      // migration writes back, and hydrating against it would revert local
      // values that just won the merge.
      void migrateExtensionPreferencesFromLocalStorage()
        .then(async () => {
          const fresh = (await window.electron.getSettings()) as AppSettings;
          hydrateExtensionPreferencesFromSettings(fresh);
        })
        .catch((err) => console.warn('Extension preferences sync init failed:', err));
    } catch (e) {
      console.error('Failed to load launcher preferences:', e);
      setPinnedCommands([]);
      setPinnedFiles([]);
      setRecentCommands([]);
      setRecentCommandLaunchCounts({});
      setCommandAliases({});
      setCommandHotkeys({});
      setLauncherShortcut('Alt+Space');
      setWebSearchSuggestionsEnabled(true);
      setRootSearchRanking({});
      setConfiguredEdgeTtsVoice('en-US-EricNeural');
      setConfiguredTtsModel('edge-tts');
      setLauncherBackgroundImagePath('');
      setLauncherBackgroundImageEverywhere(false);
      setLauncherBackgroundImageBlurPercent(DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT);
      setLauncherBackgroundImageOpacityPercent(DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT);
      applyAppFontSize(getDefaultAppFontSize());
      applyUiStyle('default');
      applyBaseColor('#101113');
      setShowOnboarding(false);
      setOnboardingRequiresShortcutFix(false);
    }
  }, [hydrateWebSearchSettings]);

  const fetchCommands = useCallback(async (options?: { showLoading?: boolean }) => {
    const shouldShowLoading = options?.showLoading ?? commandsRef.current.length === 0;
    if (shouldShowLoading) {
      setIsLoading(true);
    }
    try {
      const fetchedCommands = await window.electron.getCommands();
      for (const cmd of fetchedCommands) {
        if (cmd.iconDataUrl) {
          const cached = _commandIconCache.get(cmd.id);
          if (cached !== undefined) {
            cmd.iconDataUrl = cached;
          } else {
            _commandIconCache.set(cmd.id, cmd.iconDataUrl);
          }
        }
      }
      setCommands(fetchedCommands);
      lastCommandsFetchAtRef.current = Date.now();
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
    fetchCommands({ showLoading: false });
    loadLauncherPreferences();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cleanupWindowHidden = window.electron.onWindowHidden(() => {
      lastWindowHiddenAtRef.current = Date.now();
      setSearchQuery('');
      setSelectedIndex(0);
    });
    return cleanupWindowHidden;
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onCommandsUpdated?.(() => {
      fetchCommands({ showLoading: false });
    });
    return cleanup;
  }, [fetchCommands]);

  const requestPendingInlineArgumentFocusRef = useRef<() => void>(() => {});
  const requestPendingInlineArgumentFocus = useCallback(() => {
    requestPendingInlineArgumentFocusRef.current();
  }, []);

  useLauncherWindowShownHandler({
    hasPersistableView,
    directLaunchExpansionGuardUntilRef,
    pendingWindowShownQueryRef,
    popToRootTimeoutMsRef,
    lastWindowHiddenAtRef,
    commandsRef,
    lastCommandsFetchAtRef,
    inputRef,
    whisperSessionRef,
    expandLauncherForDirectLaunch,
    requestPendingInlineArgumentFocus,
    exitAiMode,
    resetCursorPromptState,
    fetchCommands,
    loadLauncherPreferences,
    openWhisper,
    openSpeak,
    openCursorPrompt,
    openClipboardManager,
    openSnippetManager,
    openNotesSearch,
    openCanvasSearch,
    openQuickLinkManager,
    openFileSearch,
    openSchedule,
    openCamera,
    openOnboarding,
    setAiAvailable,
    setSelectedTextSnapshot,
    setMemoryFeedback,
    setMemoryActionLoading,
    setShowCursorPrompt,
    setShowWhisperHint,
    setShowCamera,
    setShowWindowManager,
    setShowQuickLinkManager,
    setScriptCommandSetup,
    setScriptCommandOutput,
    setExtensionView,
    setBrowserResultsViewQuery,
    setShowSnippetManager,
    setShowFileSearch,
    setShowClipboardManager,
    setBrowserResultsViewScope,
    setBrowserHistoryProfileMenuOpen,
    setShowActions,
    setContextMenu,
    setShowNotesSearch,
    setShowCanvasSearch,
    setShowWhisper,
    setShowSpeak,
    setShowSchedule,
    setShowWhisperOnboarding,
    setSearchQuery,
    setSelectedIndex,
    setIsCompactCollapsed,
    refreshBrowserOpenTabs: browserSearch.refreshOpenTabs,
    refreshBrowserEntries: browserSearch.refreshBrowserEntries,
    refreshBrowserEntriesIfStale: browserSearch.refreshBrowserEntriesIfStale,
  });

  useEffect(() => {
    const cleanupSelectionSnapshotUpdated = window.electron.onSelectionSnapshotUpdated((payload) => {
      setSelectedTextSnapshot(String(payload?.selectedTextSnapshot || '').trim());
    });
    return cleanupSelectionSnapshotUpdated;
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((settings: AppSettings) => {
      // Settings broadcasts fire for in-app saves AND for external sync
      // changes (cloud watcher → reload → broadcast). Re-hydrate localStorage
      // so any prefs delivered from another Mac take effect immediately.
      hydrateExtensionPreferencesFromSettings(settings);
      applyAppFontSize(settings.fontSize);
      applyUiStyle(settings.uiStyle || 'default');
      applyBaseColor(settings.baseColor || '#101113');
      setLauncherBackgroundImagePath(String(settings.launcherBackgroundImagePath || ''));
      setLauncherBackgroundImageEverywhere(Boolean(settings.launcherBackgroundImageEverywhere));
      setLauncherBackgroundImageBlurPercent(
        clampLauncherBackgroundPercent(
          settings.launcherBackgroundImageBlurPercent,
          DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT
        )
      );
      setLauncherBackgroundImageOpacityPercent(
        clampLauncherBackgroundPercent(
          settings.launcherBackgroundImageOpacityPercent,
          DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT
        )
      );
      setLauncherShortcut(settings.globalShortcut || 'Alt+Space');
      setBrowserSearchResultGroups(normalizeBrowserSearchResultGroups(settings.browserSearch?.resultGroups));
      setWebSearchSuggestionsEnabled(settings.browserSearch?.webSearchSuggestionsEnabled !== false);
      setRootSearchAutocompleteEnabled(settings.rootSearchAutocompleteEnabled !== false);
      setRootSearchRanking(settings.rootSearchRanking || {});
      hydrateWebSearchSettings(settings);
      setDisableFileSearchResults(Boolean(settings.disableFileSearchResults));
      setNavigationStyle(settings.navigationStyle === 'macos' ? 'macos' : 'vim');
      const popToRootSeconds = Number(settings.popToRootSearchTimeoutSeconds);
      popToRootTimeoutMsRef.current = (Number.isFinite(popToRootSeconds) ? Math.max(0, popToRootSeconds) : DEFAULT_POP_TO_ROOT_TIMEOUT_SECONDS) * 1000;
    });
    return cleanup;
  }, [hydrateWebSearchSettings]);

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
        // Background launches from menu-bar runners (e.g. pomodoro auto
        // transitions) must not hijack the launcher into a view command —
        // the user didn't ask for it. Silent drop.
        return;
      }

      // Hotkey-triggered no-view commands: run silently without showing the launcher.
      // If the command has argument definitions, ALWAYS open the launcher with the
      // command name pre-typed so the user can review/fill args before running.
      // Only run silently when the command has no arguments (and prefs are all filled).
      if (sourceMode === 'hotkey' && hydrated.mode === 'no-view') {
        const hasRequiredArgDefs = (hydrated.commandArgumentDefinitions || []).some(d => !!d.required);
        const hasMissingPrefs = getMissingRequiredPreferences(hydrated).length > 0;
        if (hasRequiredArgDefs || hasMissingPrefs) {
          const cmdTitle = hydrated.title || hydrated.commandName || hydrated.cmdName || '';
          pendingWindowShownQueryRef.current = cmdTitle;
          void window.electron.showWindow();
          setShowFileSearch(false);
          setExtensionPreferenceSetup(null);
        } else {
          // No-view hotkey commands never call showWindow(), so SuperCmd never
          // takes focus — the user's active app keeps focus throughout.
          // activateLastFrontmostApp() is intentionally NOT called here: it
          // uses stale lastFrontmostApp data and can activate the wrong app.
          queueNoViewBundleRun(hydrated, 'userInitiated', true);
        }
        return;
      }

      // Bundles dispatched from a menu-bar runner (e.g. clicking a tray menu
      // item that calls launchCommand) reach here while the launcher window
      // is hidden. expandLauncherForDirectLaunch only resizes — it does not
      // show the window — so we must explicitly call showWindow() for these
      // user-initiated launches, otherwise the click silently no-ops.
      const needsWindowShow = sourceMode === 'menu-bar' && hydrated.mode !== 'no-view';

      if (shouldOpenCommandSetup(hydrated)) {
        if (needsWindowShow) void window.electron.showWindow();
        expandLauncherForDirectLaunch();
        setShowFileSearch(false);
        setExtensionPreferenceSetup({
          bundle: hydrated,
          values: { ...(hydrated.preferences || {}) },
          argumentValues: { ...((hydrated as any).launchArguments || {}) },
        });
      } else if (hydrated.mode === 'no-view') {
        queueNoViewBundleRun(hydrated, 'userInitiated');
      } else {
        if (needsWindowShow) void window.electron.showWindow();
        expandLauncherForDirectLaunch();
        setShowFileSearch(false);
        setExtensionView(hydrated);
      }
    };

    window.addEventListener('sc-launch-extension-bundle', onLaunchBundle as EventListener);
    return () => window.removeEventListener('sc-launch-extension-bundle', onLaunchBundle as EventListener);
  }, [expandLauncherForDirectLaunch, queueNoViewBundleRun, upsertMenuBarExtension]);

  // Tear down per-extension renderer state whenever ANY uninstall path completes
  // (launcher action, settings tab, store tab). Without this the in-memory bundle
  // outlives the on-disk delete: its setInterval keeps firing, and the menu-bar
  // tray + scheduled re-runs in useBackgroundRefresh keep re-mounting it, even
  // though run-extension now fails with "Extension directory not found".
  useEffect(() => {
    const cleanup = window.electron.onExtensionUninstalled?.((extensionName: string) => {
      hideMenuBarExtensionsForExtension(extensionName);
      setBackgroundNoViewRuns((prev) =>
        prev.filter((run) => {
          const runExt = (run.bundle.extName || run.bundle.extensionName || '').trim();
          return runExt !== extensionName;
        })
      );
    });
    return cleanup;
  }, [hideMenuBarExtensionsForExtension, setBackgroundNoViewRuns]);

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
          expandLauncherForDirectLaunch();
          setShowFileSearch(false);
          setScriptCommandSetup({
            command,
            values: { ...values },
          });
          return;
        }
        if (result.mode === 'fullOutput') {
          expandLauncherForDirectLaunch();
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
        } else {
                    // Silent/default mode: hide the launcher window so focus returns to the user's active app.
                    // Mirrors the behaviour of useLauncherCommandExecution (background:false path).
                    void window.electron.hideWindow();
        }
      })();
    };
    window.addEventListener('sc-run-script-command', onRunScript as EventListener);
    return () => window.removeEventListener('sc-run-script-command', onRunScript as EventListener);
  }, [commands, expandLauncherForDirectLaunch, fetchCommands]);

  useBackgroundRefresh({
    commands,
    fetchCommands,
    isMenuBarCommandActive: useCallback(
      (extName: string, cmdName: string) =>
        isMenuBarExtensionMounted({ extName, cmdName }),
      [isMenuBarExtensionMounted],
    ),
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    void refreshSelectedTextSnapshot();
  }, [refreshSelectedTextSnapshot]);

  const saveLauncherPreferences = useCallback(
    async (next: { pinnedCommands?: string[]; pinnedFiles?: string[]; recentCommands?: string[]; recentCommandLaunchCounts?: Record<string, number> }) => {
      const patch: Partial<AppSettings> = {};
      if (next.pinnedCommands) patch.pinnedCommands = next.pinnedCommands;
      if (next.pinnedFiles) patch.pinnedFiles = next.pinnedFiles;
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

  const updatePinnedFiles = useCallback(
    async (nextPinned: string[]) => {
      setPinnedFiles(nextPinned);
      await saveLauncherPreferences({ pinnedFiles: nextPinned });
    },
    [saveLauncherPreferences]
  );

  const pinToggleForFile = useCallback(
    async (filePath: string) => {
      const normalized = String(filePath || '').trim();
      if (!normalized) return;
      const currentPinned = pinnedFilesRef.current;
      const exists = currentPinned.includes(normalized);
      const name = getFileBasename(normalized) || normalized;
      let isDirectory = Boolean(fileIsDirectoryMap[normalized]);
      if (fileIsDirectoryMap[normalized] === undefined) {
        try {
          const stat = window.electron.statSync(normalized);
          if (stat && stat.exists) isDirectory = Boolean(stat.isDirectory);
        } catch {
          // ignore
        }
      }
      const kindLabel = isDirectory ? 'folder' : 'file';
      if (exists) {
        await updatePinnedFiles(currentPinned.filter((p) => p !== normalized));
        showLauncherFooterStatus('success', `Unpinned ${kindLabel} "${name}"`);
      } else {
        await updatePinnedFiles([normalized, ...currentPinned]);
        showLauncherFooterStatus('success', `Pinned ${kindLabel} "${name}"`);
      }
    },
    [updatePinnedFiles, fileIsDirectoryMap, showLauncherFooterStatus]
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
      // Live menu-bar / background runner teardown happens via the
      // `extension-uninstalled` IPC broadcast (see effect below) so it covers
      // settings + store uninstall paths uniformly. We only need to update
      // launcher-local pinned/recent state here.
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
    showAppUninstallRef.current = showAppUninstall;
    if (!showActions) {
      setActionsCommand(null);
    }
  }, [showActions, showAppUninstall]);

  useEffect(() => {
    if (!contextMenu) return;
    setSelectedContextActionIndex(0);
    setTimeout(() => contextMenuRef.current?.focus(), 0);
  }, [contextMenu]);

  useEffect(() => {
    if (!showActions && !contextMenu && !quickLinkDynamicPrompt && !bookmarkNicknamePrompt && !aiMode && !extensionView && !showClipboardManager && !showSnippetManager && !showNotesSearch && !showQuickLinkManager && !showFileSearch && !showMenuItemSearch && !showCursorPrompt && !showWhisper && !showSpeak && !showCamera && !showSchedule && !showWindowManager && !showAppUninstall && !showOnboarding && browserResultsViewQuery === null && webSearchQuery === null) {
      restoreLauncherFocus();
    }
  }, [showActions, contextMenu, quickLinkDynamicPrompt, bookmarkNicknamePrompt, aiMode, extensionView, showClipboardManager, showSnippetManager, showNotesSearch, showQuickLinkManager, showFileSearch, showMenuItemSearch, showCursorPrompt, showWhisper, showSpeak, showCamera, showSchedule, showWindowManager, showAppUninstall, showOnboarding, showWhisperOnboarding, browserResultsViewQuery, webSearchQuery, restoreLauncherFocus]);

  const isLauncherModeActive =
    !showActions &&
    !contextMenu &&
    !quickLinkDynamicPrompt &&
    !bookmarkNicknamePrompt &&
    !aiMode &&
    !extensionView &&
    !showClipboardManager &&
    !showSnippetManager &&
    !showNotesSearch &&
    !showCanvasSearch &&
    browserResultsViewQuery === null &&
    webSearchQuery === null &&
    !showQuickLinkManager &&
    !showFileSearch &&
    !showCursorPrompt &&
    !showWhisper &&
    !showSpeak &&
    !showCamera &&
    !showSchedule &&
    !showWindowManager &&
    !showMenuItemSearch &&
    !showOnboarding &&
    !showWhisperOnboarding;
  isLauncherModeActiveRef.current = isLauncherModeActive;
  const shouldKeepLauncherSearchResults =
    isLauncherModeActive || showActions || Boolean(contextMenu);

  useEffect(() => {
    if (launcherViewMode !== 'compact' || isLauncherModeActive) return;
    setIsCompactCollapsed(false);
    void window.electron.resizeLauncherWindow(true);
  }, [isLauncherModeActive, launcherViewMode]);

  useEffect(() => {
    fileSearchRequestSeqRef.current += 1;
    const requestSeq = fileSearchRequestSeqRef.current;
    const trimmed = searchQuery.trim();
    const pathLikeQuery = isPathLikeLauncherFileQuery(trimmed);
    const terms = pathLikeQuery ? [] : getLauncherFileSearchTerms(trimmed);
    const minimumQueryLength = pathLikeQuery ? 1 : MIN_LAUNCHER_FILE_QUERY_LENGTH;

    if (disableFileSearchResults || !shouldKeepLauncherSearchResults || trimmed.length < minimumQueryLength) {
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
            } else {
              const candidateName = String(candidate?.name || '');
              if (!matchesLauncherFileNameTerms(candidateName, terms)) {
                const normalizedCandidateText = normalizeLauncherFileSearchText([
                  candidateName,
                  candidatePath,
                  String(candidate?.parentPath || ''),
                  String(candidate?.displayPath || ''),
                ].join(' '));
                if (!terms.every((term) => normalizedCandidateText.includes(term))) continue;
              }
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
  }, [searchQuery, shouldKeepLauncherSearchResults, homeDir, disableFileSearchResults]);

  useEffect(() => {
    if (!isLauncherModeActive) return;
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (showAppUninstallRef.current) return;
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
      if (launcherFooterStatusTimerRef.current !== null) {
        window.clearTimeout(launcherFooterStatusTimerRef.current);
        launcherFooterStatusTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (pinnedFiles.length === 0) return;
    let cancelled = false;
    (async () => {
      const missing = pinnedFiles.filter((p) => !launcherFileIcons[p]);
      if (missing.length === 0) return;
      const entries = await Promise.all(
        missing.map(async (filePath) => {
          try {
            const dataUrl = await window.electron.getFileIconDataUrl(filePath, 20);
            return [filePath, dataUrl || ''] as const;
          } catch {
            return [filePath, ''] as const;
          }
        })
      );
      if (cancelled) return;
      setLauncherFileIcons((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [filePath, icon] of entries) {
          if (icon && !next[filePath]) {
            next[filePath] = icon;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [pinnedFiles, launcherFileIcons]);

  useEffect(() => {
    const pending: Array<[string, boolean]> = [];
    for (const result of launcherFileResults) {
      const path = String(result?.path || '').trim();
      if (!path) continue;
      if (fileIsDirectoryMap[path] === undefined) {
        pending.push([path, Boolean(result?.isDirectory)]);
      }
    }
    for (const pinnedPath of pinnedFiles) {
      if (!pinnedPath || fileIsDirectoryMap[pinnedPath] !== undefined) continue;
      try {
        const stat = window.electron.statSync(pinnedPath);
        if (stat && stat.exists) {
          pending.push([pinnedPath, Boolean(stat.isDirectory)]);
        }
      } catch {
        // ignore
      }
    }
    if (pending.length === 0) return;
    setFileIsDirectoryMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [path, isDirectory] of pending) {
        if (next[path] !== isDirectory) {
          next[path] = isDirectory;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [launcherFileResults, pinnedFiles, fileIsDirectoryMap]);

  useEffect(() => {
    let disposed = false;
    void window.electron.getDefaultApplication('https://example.com')
      .then((defaultApp) => {
        if (disposed || !defaultApp?.path) return null;
        return window.electron.getAppIconDataUrl(defaultApp.path, 20)
          .then((appIcon) => appIcon || window.electron.getFileIconDataUrl(defaultApp.path, 20));
      })
      .then((iconDataUrl) => {
        if (disposed || !iconDataUrl) return;
        setDefaultBrowserIconDataUrl(iconDataUrl);
      })
      .catch(() => {
        if (!disposed) setDefaultBrowserIconDataUrl('');
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const browserIds = Array.from(
      new Set(
        (browserSearch.profiles || [])
          .map((profile) => profile.browserId)
          .filter((browserId): browserId is BrowserSearchSource => Boolean(browserId))
      )
    ).filter((browserId) => !browserAppIconDataUrls[String(browserId)]);
    if (browserIds.length === 0) return;

    let disposed = false;
    const timer = window.setTimeout(() => {
      void Promise.all(
        browserIds.map(async (browserId) => {
          const paths = BROWSER_APP_PATHS[browserId] || [];
          for (const appPath of paths) {
            const appIcon = await window.electron.getAppIconDataUrl(appPath, 20).catch(() => null);
            const icon = appIcon || await window.electron.getFileIconDataUrl(appPath, 20).catch(() => null);
            if (icon) return [String(browserId), icon] as const;
          }
          return null;
        })
      ).then((entries) => {
        if (disposed) return;
        const nextEntries = entries.filter((entry): entry is readonly [string, string] => Boolean(entry));
        if (nextEntries.length === 0) return;
        setBrowserAppIconDataUrls((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [browserId, icon] of nextEntries) {
            if (next[browserId] !== icon) {
              next[browserId] = icon;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      });
    }, 450);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [browserSearch.profiles, browserAppIconDataUrls]);

  const {
    calcResult,
    calcOffset,
    displayCommands,
    launcherCommandSections,
    selectedCommand,
    selectedFileResultPath,
    rootSearchAutoComplete,
  } = useLauncherCommandModel({
    commands,
    searchQuery: deferredSearchQuery,
    commandAliases,
    homeDir,
    launcherFileResults,
    launcherFileIcons,
    pinnedFiles,
    pinnedCommands,
    recentCommands,
    recentCommandLaunchCounts,
    selectedTextSnapshot,
    browserSearch,
    browserSearchResultGroups,
    aiMode,
    rootSearchRanking,
    webSearchSuggestionsEnabled,
    rootSearchAutocompleteEnabled,
    rootBangState,
    enabledSearchBangs,
    effectiveSearchBangs,
    webSearchDefaultBangKey,
    webSearchBangUsage,
    rootWebSearchSuggestions,
    selectedIndex,
    defaultBrowserIconDataUrl,
    browserAppIconDataUrls,
    t,
  });

  const browserSearchAutoComplete = deferredSearchQuery === searchQuery ? rootSearchAutoComplete : null;
  const launcherInputValue = searchQuery;

  const {
    inlineArgumentLaneRef,
    inlineArgumentClusterRef,
    inlineArgumentInputRefs,
    inlineQuickLinkInputRefs,

    selectedExtensionArgumentDefinitions,
    selectedInlineExtensionArgumentDefinitions,
    selectedInlineExtensionArgumentValues,
    hasSelectedExtensionOverflowArguments,

    selectedQuickLinkId,
    selectedQuickLinkDynamicFields,
    selectedInlineQuickLinkDynamicFields,
    selectedInlineQuickLinkDynamicValues,
    hasSelectedQuickLinkOverflowDynamicFields,

    isShowingInlineArgumentInputs,
    shouldHideAskAi,
    selectedInlineArgumentLeadingIcon,
    inlineArgumentStartPx,

    inlineQuickLinkDynamicFieldsById,
    inlineQuickLinkDynamicValuesById,

    requestPendingInlineArgumentFocus: requestPendingInlineArgumentFocusImpl,
    getDynamicFieldsForQuickLink,
    updateInlineExtensionArgumentValue,
    clearInlineExtensionArgumentsForCommand,
    getInlineExtensionArgumentsForCommand,
    updateInlineQuickLinkDynamicValue,
    clearInlineQuickLinkDynamicValuesForId,
  } = useLauncherInlineArguments({
    selectedCommand,
    selectedCommandId: selectedCommand?.id,
    searchQuery,
    isLauncherModeActive,
    inputRef,
  });
  requestPendingInlineArgumentFocusRef.current = requestPendingInlineArgumentFocusImpl;

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

  useEffect(() => {
    selectedCommandRef.current = selectedCommand;
  }, [selectedCommand]);

  useEffect(() => {
    if (!showFileSearch && fileSearchInitialDetailPath) {
      setFileSearchInitialDetailPath(null);
    }
  }, [showFileSearch, fileSearchInitialDetailPath]);

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

  const copyCommandDeeplink = useCallback(async (command: CommandInfo) => {
    const deeplink = String(command?.deeplink || '').trim();
    if (!deeplink) return;
    try {
      await window.electron.clipboardWrite({ text: deeplink });
    } catch (error) {
      console.error('Failed to copy deeplink:', error);
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

  const submitBrowserSearch = useCallback(
    async (input: string, options?: Parameters<typeof browserSearch.executeBrowserSearch>[1]) => {
      const trimmed = input.trim();
      if (!trimmed) return false;
      const bangState = parseSearchBangState(trimmed, enabledSearchBangs);
      if (bangState.mode === 'active' && bangState.query) {
        const ok = await window.electron.browserTabsOpenUrlProfile?.(
          buildBangSearchUrl(bangState.bang, bangState.query),
          { event: options?.event, sourceProfileId: options?.openInSourceProfile ? options.sourceProfileId : null }
        ).then((result) => result.ok).catch(() => window.electron.openUrl(buildBangSearchUrl(bangState.bang, bangState.query)));
        if (ok) {
          setBrowserSearchSkipAutoComplete(false);
          try { window.electron.hideWindow(); } catch {}
        }
        return Boolean(ok);
      }
      const resolved = browserSearch.resolve(trimmed);
      if (resolved?.type === 'search') {
        const defaultBang = getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
        const ok = await window.electron.browserTabsOpenUrlProfile?.(
          buildBangSearchUrl(defaultBang, trimmed),
          { event: options?.event, sourceProfileId: options?.openInSourceProfile ? options.sourceProfileId : null }
        ).then((result) => result.ok).catch(() => window.electron.openUrl(buildBangSearchUrl(defaultBang, trimmed)));
        if (ok) {
          setBrowserSearchSkipAutoComplete(false);
          try { window.electron.hideWindow(); } catch {}
        }
        return Boolean(ok);
      }
      const ok = await browserSearch.executeBrowserSearch(trimmed, options);
      if (ok) {
        setBrowserSearchSkipAutoComplete(false);
        try { window.electron.hideWindow(); } catch {}
      }
      return ok;
    },
    [browserSearch, webSearchDefaultBangKey, effectiveSearchBangs, enabledSearchBangs]
  );

  submitBrowserSearchRef.current = submitBrowserSearch;

  const recordRootSearchLaunch = useCallback(async (command: CommandInfo, query: string) => {
    const stableKey = String(command.rootSearchStableKey || '').trim();
    const normalizedQuery = String(query || '').trim();
    if (!stableKey || !normalizedQuery) return;
    if (command.id === BROWSER_SEARCH_SHOW_ALL_RESULTS_ID) return;
    const nextRanking = recordRootSearchLaunchInState(rootSearchRankingRef.current, stableKey, normalizedQuery);
    rootSearchRankingRef.current = nextRanking;
    setRootSearchRanking(nextRanking);
    try {
      const latest = (await window.electron.recordRootSearchLaunch(
        stableKey,
        normalizedQuery
      )) as RootSearchRankingState;
      rootSearchRankingRef.current = latest;
      setRootSearchRanking(latest);
    } catch (error) {
      console.warn('Failed to record root search launch:', error);
    }
  }, []);

  const { runLocalSystemCommand } = useLauncherLocalSystemCommands({
    expandLauncherForDirectLaunch,
    memoryActionLoading,
    selectedTextSnapshot,
    setSelectedTextSnapshot,
    setMemoryActionLoading,
    setMemoryFeedback,
    showOnboarding,
    showWindowManager,
    whisperSessionRef,
    windowPresetCommandQueueRef,
    openOnboarding,
    openWhisper,
    openClipboardManager,
    openSnippetManager,
    openNotesSearch,
    openCanvasSearch,
    openQuickLinkManager,
    openFileSearch,
    openWebSearchMode,
    openCamera,
    openSpeak,
    openWindowManager,
    openMenuItemSearch,
    openSchedule,
    setShowWhisper,
    setShowWhisperOnboarding,
    setShowWhisperHint,
    setShowSpeak,
    setShowWindowManager,
    setSearchQuery,
    setSelectedIndex,
    setBrowserResultsViewQuery,
    setBrowserResultsViewScope,
    setBrowserHistoryProfileMenuOpen,
    setWebSearchQuery,
    refreshBrowserOpenTabs: browserSearch.refreshOpenTabs,
    refreshBrowserEntries: browserSearch.refreshBrowserEntries,
    refreshBrowserEntriesIfStale: browserSearch.refreshBrowserEntriesIfStale,
  });

  useEffect(() => {
    const cleanup = window.electron.onWhisperStartListening(() => {
      whisperSessionRef.current = true;
      setShowWhisper(true);
      setWhisperStartToken((value) => value + 1);
    });
    return cleanup;
  }, [setShowWhisper, whisperSessionRef]);

  useEffect(() => {
    const cleanup = window.electron.onOnboardingHotkeyPressed(() => {
      setOnboardingHotkeyPresses((prev) => prev + 1);
    });
    return cleanup;
  }, []);

  // Signal main process that the renderer is mounted and IPC listeners are
  // registered.  Main waits for this before dispatching the initial
  // window-shown / run-system-command messages so they are never lost.
  useEffect(() => {
    const legacySnapshot = collectLegacyExtensionPreferencesSnapshot();
    if (
      Object.keys(legacySnapshot.extensions).length === 0 &&
      Object.keys(legacySnapshot.commands).length === 0
    ) {
      return;
    }
    void window.electron.mergeExtensionPreferencesSnapshot(legacySnapshot);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_CHAT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      void window.electron.mergeAiChatSnapshot({
        version: 1,
        conversations: parsed.map((conversation: any) => ({
          ...conversation,
          source: conversation?.source === 'raycast' ? 'raycast' : 'local',
        })),
      });
    } catch {}
  }, []);

  useEffect(() => {
    window.electron.rendererReady();
  }, []);

  const {
    runScriptCommand,
    executeQuickLinkCommand,
    executeExtensionCommand,
  } = useLauncherCommandExecution({
    fetchCommands,
    updateRecentCommands,
    setShowFileSearch,
    setShowActions,
    setContextMenu,
    setScriptCommandSetup,
    setScriptCommandOutput,
    setExtensionPreferenceSetup,
    setExtensionView,
    inputRef,
    getDynamicFieldsForQuickLink,
    inlineQuickLinkDynamicValuesById,
    selectedQuickLinkId,
    selectedInlineQuickLinkDynamicFields,
    inlineQuickLinkInputRefs,
    clearInlineQuickLinkDynamicValuesForId,
    setQuickLinkDynamicPrompt,
    getInlineExtensionArgumentsForCommand,
    clearInlineExtensionArgumentsForCommand,
    queueNoViewBundleRun,
    isMenuBarExtensionMounted,
    hideMenuBarExtension,
    upsertMenuBarExtension,
  });

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

  // Global nav-key rebinding — works in the main launcher AND inside
  // extensions. Ctrl+<key> is translated into a synthetic arrow key event
  // dispatched at the original target so whichever component handles arrow
  // keys (list, grid, submenu, text input) picks it up naturally.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const keyLower = event.key.toLowerCase();
      const navMap: Record<string, 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight'> =
        navigationStyle === 'vim'
          ? { j: 'ArrowDown', k: 'ArrowUp', h: 'ArrowLeft', l: 'ArrowRight' }
          : { n: 'ArrowDown', p: 'ArrowUp', b: 'ArrowLeft', f: 'ArrowRight' };
      const mapped = navMap[keyLower];
      if (!mapped) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target =
        (event.target as HTMLElement | null) ||
        (document.activeElement as HTMLElement | null);
      target?.dispatchEvent(
        new KeyboardEvent('keydown', { key: mapped, bubbles: true, cancelable: true })
      );
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [navigationStyle]);

  const handleCommandExecute = async (command: CommandInfo) => {
    // Drop a second Enter while the first command is still resolving — a
    // fast double-press could otherwise re-fire the same command or a
    // different one if selection moved during the IPC roundtrip.
    if (executingCommandRef.current) return;
    const launchQuery = searchQuery;
    try {
      executingCommandRef.current = true;
      // Maintain a launcher-command history (newest first, deduped, capped)
      // so the user can cycle back through recent commands with the Up arrow
      // on the empty launcher. We deliberately store command titles, not the
      // raw search text — pressing Up should bring back "Slack", not "sl".
      const recallTitle = String(getCommandDisplayTitle(command, t) || command.title || '').trim();
      if (recallTitle) {
        try {
          const raw = localStorage.getItem(LAST_LAUNCHER_QUERY_KEY);
          const parsed = raw ? JSON.parse(raw) : [];
          const previous = Array.isArray(parsed)
            ? parsed.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.length > 0 && entry !== recallTitle)
            : [];
          const next = [recallTitle, ...previous].slice(0, MAX_LAUNCHER_QUERY_HISTORY);
          localStorage.setItem(LAST_LAUNCHER_QUERY_KEY, JSON.stringify(next));
        } catch {
          // localStorage may hold a stale string value from earlier versions;
          // overwrite it with a fresh single-entry array.
          try {
            localStorage.setItem(LAST_LAUNCHER_QUERY_KEY, JSON.stringify([recallTitle]));
          } catch {}
        }
      }
      // Browser-search synthetic action: open the resolved URL/search query
      // in the default browser. Bypasses recent-commands tracking — the
      // browser-search history module records the entry itself.
      if (command.id.startsWith(WEB_SEARCH_ROOT_BANG_PREFIX)) {
        const bangKey = String(command.browserActionInput || command.id.slice(WEB_SEARCH_ROOT_BANG_PREFIX.length)).trim();
        if (bangKey) {
          setSearchQuery((current) => {
            const state = parseSearchBangState(current, enabledSearchBangs);
            if (state.mode === 'selecting') {
              const parts = current.trim().split(/\s+/).filter(Boolean);
              parts[state.tokenIndex] = `!${bangKey}`;
              return `${parts.join(' ')} `;
            }
            return `!${bangKey} `;
          });
          setSelectedIndex(0);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }
        return;
      }
      if (isBrowserSearchCommand(command)) {
        if (command.id === BROWSER_SEARCH_SHOW_ALL_RESULTS_ID) {
          setBrowserResultsViewScope('all');
          setBrowserResultsViewQuery(String(command.browserActionInput || launcherInputValue).trim());
          setShowActions(false);
          return;
        }
        const subject = String(command.browserActionInput || launcherInputValue).trim();
        if (subject) {
          try { window.electron.hideWindow(); } catch {}
          const ok = await submitBrowserSearch(subject, {
            focusExistingTab: false,
            kind: command.browserResultKind,
            url: command.browserUrl,
            sourceProfileId: command.browserSourceProfileId,
            openInSourceProfile: command.browserNicknameMatch === true,
            windowId: command.browserWindowId,
            tabId: command.browserTabId,
          });
          if (ok) await recordRootSearchLaunch(command, launchQuery);
        }
        return;
      }

      const filePath = getFileResultPathFromCommand(command);
      if (filePath) {
        await openFileResultByPath(filePath);
        await recordRootSearchLaunch(command, launchQuery);
        return;
      }

      if (await runLocalSystemCommand(command.id)) {
        await updateRecentCommands(command.id);
        await recordRootSearchLaunch(command, launchQuery);
        return;
      }

      if (getQuickLinkIdFromCommandId(command.id)) {
        await executeQuickLinkCommand(command);
        await recordRootSearchLaunch(command, launchQuery);
        return;
      }

      if (command.category === 'extension' && command.path) {
        await executeExtensionCommand(command);
        await recordRootSearchLaunch(command, launchQuery);
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
        await recordRootSearchLaunch(command, launchQuery);
        return;
      }

      if (command.needsConfirmation) {
        // Commands where the main process owns the confirmation dialog (native Electron dialog with icon).
        if (
          command.id === 'system-close-all-apps' ||
          command.id === 'system-restart' ||
          command.id === 'system-logout'
        ) {
          const confirmed = await window.electron.executeCommand(command.id);
          if (!confirmed) return;
          await updateRecentCommands(command.id);
          await recordRootSearchLaunch(command, launchQuery);
          try { window.electron.hideWindow(); } catch {}
          return;
        }
        const ok = window.confirm(`Run "${command.title}"?`);
        if (!ok) return;
      }

      await window.electron.executeCommand(command.id);
      await updateRecentCommands(command.id);
      await recordRootSearchLaunch(command, launchQuery);
      try { window.electron.hideWindow(); } catch {}
    } catch (error) {
      console.error('Failed to execute command:', error);
    } finally {
      executingCommandRef.current = false;
    }
  };
  const handleCommandRowClick = useCallback(
    async (command: CommandInfo, absoluteIndex: number, event?: React.MouseEvent<HTMLDivElement>) => {
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

      if (
        event?.metaKey &&
        !event.altKey &&
        isBrowserSearchCommand(command) &&
        command.browserResultKind === 'open-tab' &&
        command.id !== BROWSER_SEARCH_SHOW_ALL_RESULTS_ID &&
        !command.id.startsWith(WEB_SEARCH_ROOT_BANG_PREFIX)
      ) {
        const subject = String(command.browserActionInput || launcherInputValue).trim();
        if (subject) {
          try { window.electron.hideWindow(); } catch {}
          void submitBrowserSearch(subject, {
            focusExistingTab: true,
            kind: command.browserResultKind,
            url: command.browserUrl,
            sourceProfileId: command.browserSourceProfileId,
            openInSourceProfile: command.browserNicknameMatch === true,
            windowId: command.browserWindowId,
            tabId: command.browserTabId,
          });
        }
        return;
      }

      if (
        event?.altKey &&
        isBrowserSearchCommand(command) &&
        command.id !== BROWSER_SEARCH_SHOW_ALL_RESULTS_ID &&
        !command.id.startsWith(WEB_SEARCH_ROOT_BANG_PREFIX)
      ) {
        const subject = String(command.browserActionInput || launcherInputValue).trim();
        if (subject) {
          try { window.electron.hideWindow(); } catch {}
          void submitBrowserSearch(subject, {
            focusExistingTab: false,
            event: { altKey: true, numberKey: null },
            kind: command.browserResultKind,
            url: command.browserUrl,
            sourceProfileId: command.browserSourceProfileId,
            openInSourceProfile: command.browserNicknameMatch === true,
            windowId: command.browserWindowId,
            tabId: command.browserTabId,
          });
        }
        return;
      }

      void handleCommandExecute(command);
    },
    [
      launcherInputValue,
      getDynamicFieldsForQuickLink,
      handleCommandExecute,
      inlineQuickLinkDynamicFieldsById,
      selectedIndex,
      submitBrowserSearch,
    ]
  );

  const toggleAutoQuitForApp = useCallback(async (appPath: string, appName: string) => {
    const isEnabled = autoQuitAppPaths.has(appPath);
    if (isEnabled) {
      await window.electron.autoQuitRemoveApp(appPath);
      setAutoQuitAppPaths((prev) => {
        const next = new Set(prev);
        next.delete(appPath);
        return next;
      });
      showLauncherFooterStatus('success', `Auto Quit disabled for ${appName}`);
      return;
    }

    const timeout = await window.electron.autoQuitGetDefaultTimeout();
    await window.electron.autoQuitAddApp({ appPath, appName, timeoutSeconds: timeout });
    setAutoQuitAppPaths((prev) => new Set(prev).add(appPath));
    showLauncherFooterStatus('success', `Auto Quit enabled for ${appName}`);
  }, [autoQuitAppPaths, showLauncherFooterStatus]);

  const {
    selectedActions,
    actionsOverlayActions,
    contextActions,
    handleActionsOverlayKeyDown,
    handleContextMenuKeyDown,
    openLauncherCommandContextMenu,
    openSelectedCommandActions,
  } = useLauncherActionModel({
    selectedCommand,
    actionsCommand,
    contextMenu,
    selectedActionIndex,
    selectedContextActionIndex,
    setSearchQuery,
    setSelectedIndex,
    setShowActions,
    setActionsCommand,
    setContextMenu,
    setSelectedActionIndex,
    setSelectedContextActionIndex,
    pinnedCommands,
    pinnedFiles,
    fileIsDirectoryMap,
    autoQuitAppPaths,
    launcherInputValue,
    handleCommandExecute,
    submitBrowserSearch,
    openFileResultByPath,
    showFileResultDetailsByPath,
    revealFileResultByPath,
    copyFileResultPath,
    pinToggleForFile,
    copyCommandDeeplink,
    pinToggleForCommand,
    disableCommand,
    uninstallExtensionCommand,
    movePinnedCommand,
    fetchCommands,
    openQuickLinkManager,
    setQuickLinkEditId,
    openAppUninstall,
    toggleAutoQuitForApp,
    restoreLauncherFocus,
    t,
  });

  const hiddenExtensionRunners = (
    <HiddenExtensionRunners
      menuBarExtensions={menuBarExtensions}
      backgroundNoViewRuns={backgroundNoViewRuns}
      setBackgroundNoViewRuns={setBackgroundNoViewRuns}
    />
  );

  const whisperCoachmarkText =
    showWhisperHint && whisperSpeakToggleLabel
      ? t('whisper.coachmark.holdToTalk', { shortcut: whisperSpeakToggleLabel })
      : undefined;

  const detachedOverlayRunners = (
    <DetachedOverlayRunners
      showWhisper={showWhisper}
      whisperPortalTarget={whisperPortalTarget}
      whisperStartToken={whisperStartToken}
      showWhisperOnboarding={showWhisperOnboarding}
      appendWhisperOnboardingPracticeText={appendWhisperOnboardingPracticeText}
      whisperCoachmarkText={whisperCoachmarkText}
      whisperAutoClose={whisperAutoClose}
      onWhisperClose={() => {
        whisperSessionRef.current = false;
        setShowWhisper(false);
        setShowWhisperOnboarding(false);
        setShowWhisperHint(false);
      }}
      showSpeak={showSpeak}
      speakPortalTarget={speakPortalTarget}
      speakStatus={speakStatus}
      speakOptions={speakOptions}
      readVoiceOptions={readVoiceOptions}
      handleSpeakVoiceChange={handleSpeakVoiceChange}
      handleSpeakRateChange={handleSpeakRateChange}
      handleSpeakTogglePause={handleSpeakTogglePause}
      handleSpeakPreviousParagraph={handleSpeakPreviousParagraph}
      handleSpeakNextParagraph={handleSpeakNextParagraph}
      onSpeakClose={() => {
        setShowSpeak(false);
        void window.electron.speakStop();
      }}
      showWindowManager={showWindowManager}
      windowManagerPortalTarget={windowManagerPortalTarget}
      onWindowManagerClose={() => {
        setShowWindowManager(false);
      }}
      showCursorPrompt={showCursorPrompt}
      cursorPromptPortalTarget={cursorPromptPortalTarget}
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
    />
  );

  const alwaysMountedRunners = (
    <>
      {hiddenExtensionRunners}
      {detachedOverlayRunners}
    </>
  );
  const launcherBackgroundImageUrl = toFileUrl(launcherBackgroundImagePath);
  const shouldUseBackgroundEverywhere = Boolean(launcherBackgroundImageUrl) && launcherBackgroundImageEverywhere;
  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass =
    document.documentElement.classList.contains('sc-native-liquid-glass') ||
    document.body.classList.contains('sc-native-liquid-glass');
  const quickLinkDynamicPromptTitle = quickLinkDynamicPrompt
    ? getCommandDisplayTitle(quickLinkDynamicPrompt.command, t)
    : '';
  const {
    handleKeyDown,
    handleLauncherSearchBlur,
    handleLauncherInputChange,
    copyCalculatorResult,
    showCompactLauncher,
    handleInlineExtensionArgumentChange,
    handleInlineQuickLinkDynamicValueChange,
  } = useLauncherKeyboardControls({
    inputRef,
    isLauncherModeActiveRef,
    inlineArgumentInputRefs,
    inlineQuickLinkInputRefs,
    displayCommands,
    selectedCommand,
    selectedIndex,
    selectedFileResultPath,
    calcOffset,
    calcResult,
    searchQuery,
    browserSearchAutoComplete,
    launcherInputValue,
    aiAvailable,
    shouldHideAskAi,
    isShowingInlineArgumentInputs,
    selectedInlineExtensionArgumentDefinitions,
    selectedInlineQuickLinkDynamicFields,
    selectedQuickLinkId,
    showActions,
    contextMenu,
    quickLinkDynamicPrompt,
    bookmarkNicknamePrompt,
    showAppUninstall,
    launcherViewMode,
    isCompactCollapsed,
    setSearchQuery,
    setSelectedIndex,
    setIsCompactCollapsed,
    setShowActions,
    setContextMenu,
    setActionsCommand,
    setSelectedActionIndex,
    startAiChat,
    restoreLauncherFocus,
    handleCommandExecute,
    submitBrowserSearch,
    pinToggleForCommand,
    disableCommand,
    uninstallExtensionCommand,
    movePinnedCommand,
    showFileResultDetailsByPath,
    revealFileResultByPath,
    copyFileResultPath,
    pinToggleForFile,
    copyCommandDeeplink,
    openAppUninstall,
    updateInlineExtensionArgumentValue,
    updateInlineQuickLinkDynamicValue,
  });

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
          localStorage.removeItem(LAST_EXT_KEY);
        }}
        setExtensionPreferenceSetup={setExtensionPreferenceSetup}
      />
    );
  }

  // ─── Extension view mode ──────────────────────────────────────────
  if (extensionView) {
    return (
      <LauncherViewShell
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
        className="extension-runtime-shell"
      >
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
          preferenceDefinitions={(extensionView as any).preferenceDefinitions}
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
      </LauncherViewShell>
    );
  }

  // ─── Clipboard Manager mode ───────────────────────────────────────
  if (showClipboardManager) {
    return (
      <LauncherViewShell
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
      >
        <ClipboardManager
          onClose={() => {
            const openedViaShortcut = clipboardManagerOpenedViaShortcut;
            setShowClipboardManager(false);
            setClipboardManagerOpenedViaShortcut(false);
            setSearchQuery('');
            setSelectedIndex(0);
            if (openedViaShortcut) {
              // Opened directly via global shortcut; there is no launcher
              // list to fall back to, so one Escape dismisses the window (#407).
              window.electron.hideWindow();
              return;
            }
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      </LauncherViewShell>
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

  // ─── Schedule mode ───────────────────────────────────────────────
  if (showSchedule) {
    return (
      <LauncherViewShell
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
      >
        <ScheduleExtension
          onClose={() => {
            setShowSchedule(false);
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      </LauncherViewShell>
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

  // ─── Web Search mode ─────────────────────────────────────────────
  if (webSearchQuery !== null) {
    return (
      <WebSearchView
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
        query={webSearchQuery}
        setQuery={setWebSearchQuery}
        inputRef={webSearchInputRef}
        onClose={closeWebSearch}
        results={webSearchResults}
        visibleSections={visibleWebSearchSections}
        selectedIndex={webSearchSelectedIndex}
        setSelectedIndex={setWebSearchSelectedIndex}
        selectedResult={selectedWebSearchResult}
        activateResult={activateWebSearchResult}
        submitSearch={(query) => { void submitBrowserSearch(query); }}
        loadMoreResults={loadMoreWebSearchResults}
        effectiveSearchBangs={effectiveSearchBangs}
        activeBang={activeWebSearchBang}
        isBangManager={isWebSearchBangManager}
        showHiddenBangs={webSearchShowHiddenBangs}
        toggleShowHidden={toggleWebSearchShowHidden}
        bangPrompt={webSearchBangPrompt}
        bangInputRef={webSearchBangInputRef}
        setBangPrompt={setWebSearchBangPrompt}
        openBangPrompt={openWebSearchBangPrompt}
        saveBangAliases={saveWebSearchBangAliases}
        customBangPrompt={webSearchCustomBangPrompt}
        setCustomBangPrompt={setWebSearchCustomBangPrompt}
        openCustomBangPrompt={openWebSearchCustomBangPrompt}
        closeCustomBangPrompt={closeWebSearchCustomBangPrompt}
        saveCustomBang={saveWebSearchCustomBang}
        toggleBangDisabled={toggleWebSearchBangDisabled}
        isNativeLiquidGlass={isNativeLiquidGlass}
        isGlassyTheme={isGlassyTheme}
        t={t}
      />
    );
  }

  // ─── Browser Results mode ────────────────────────────────────────
  if (browserResultsViewQuery !== null) {
    return (
      <BrowserResultsView
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
        query={browserResultsViewQuery}
        setQuery={setBrowserResultsViewQuery}
        inputRef={browserResultsViewInputRef}
        placeholder={browserResultsPlaceholder}
        onClose={closeBrowserResults}
        scope={browserResultsViewScope}
        results={browserResultsViewResults}
        sections={browserResultsViewSections}
        selectedIndex={browserResultsViewSelectedIndex}
        setSelectedIndex={setBrowserResultsViewSelectedIndex}
        selectedResult={selectedBrowserResult}
        activateResult={activateBrowserResult}
        loadMoreResults={loadMoreBrowserResults}
        showHistoryProfilePicker={showHistoryProfilePicker}
        historyProfileOptions={browserHistoryProfileOptions}
        effectiveHistoryProfileIds={effectiveBrowserHistoryProfileIds}
        historyProfileFilterLabel={historyProfileFilterLabel}
        browserAlternateProfileLabel={browserAlternateProfileLabel}
        browserAlternateProfileBrowserId={browserAlternateProfileBrowserId}
        browserProfiles={browserSearch.profiles}
        browserAppIconDataUrls={browserAppIconDataUrls}
        historyProfileMenuOpen={browserHistoryProfileMenuOpen}
        setHistoryProfileMenuOpen={setBrowserHistoryProfileMenuOpen}
        setHistorySelectedProfileIds={setBrowserHistorySelectedProfileIds}
        bookmarkNicknamePrompt={bookmarkNicknamePrompt}
        bookmarkNicknameSuggestion={bookmarkNicknameSuggestion}
        bookmarkNicknameInputRef={bookmarkNicknameInputRef}
        setBookmarkNicknamePrompt={setBookmarkNicknamePrompt}
        openBookmarkNicknamePrompt={openBookmarkNicknamePrompt}
        closeBookmarkNicknamePrompt={closeBookmarkNicknamePrompt}
        isNativeLiquidGlass={isNativeLiquidGlass}
        isGlassyTheme={isGlassyTheme}
        t={t}
      />
    );
  }

  // ─── Notes Search mode ───────────────────────────────────────────
  if (showNotesSearch) {
    return (
      <LauncherViewShell
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
      >
        <NotesSearchInline
          onClose={() => {
            setShowNotesSearch(false);
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      </LauncherViewShell>
    );
  }

  // ─── Canvas Search mode ──────────────────────────────────────────
  if (showCanvasSearch) {
    return (
      <LauncherViewShell
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
      >
        <CanvasSearchInline
          onClose={() => {
            setShowCanvasSearch(false);
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      </LauncherViewShell>
    );
  }

  // ─── Snippet Manager mode ─────────────────────────────────────────
  if (showSnippetManager) {
    return (
      <LauncherViewShell
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
      >
        <SnippetManager
          initialView={showSnippetManager}
          onClose={() => {
            setShowSnippetManager(null);
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      </LauncherViewShell>
    );
  }

  // ─── Quick Link Manager mode ──────────────────────────────────────
  if (showQuickLinkManager) {
    return (
      <LauncherViewShell
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
      >
        <QuickLinkManager
          initialView={showQuickLinkManager}
          commandAliases={commandAliases}
          initialEditId={quickLinkEditId ?? undefined}
          onClose={() => {
            setShowQuickLinkManager(null);
            setQuickLinkEditId(null);
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      </LauncherViewShell>
    );
  }

  // ─── File Search mode ─────────────────────────────────────────────
  // ─── App Uninstall view (rendered as overlay in default return, not early-return) ─────

  if (showFileSearch) {
    return (
      <LauncherViewShell
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
      >
        <FileSearchExtension
          initialDetailPath={fileSearchInitialDetailPath}
          pinnedFiles={pinnedFiles}
          onTogglePinFile={pinToggleForFile}
          onClose={() => {
            setShowFileSearch(false);
            setFileSearchInitialDetailPath(null);
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      </LauncherViewShell>
    );
  }

  // ─── Menu Item Search mode ─────────────────────────────────────────
  if (showMenuItemSearch) {
    return (
      <LauncherViewShell
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={launcherBackgroundImageUrl}
        showBackground={shouldUseBackgroundEverywhere}
        backgroundBlurPercent={launcherBackgroundImageBlurPercent}
        backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}
      >
        <MenuItemSearch
          onClose={() => {
            setShowMenuItemSearch(false);
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      </LauncherViewShell>
    );
  }

  // ─── AI Chat mode ──────────────────────────────────────────────
  if (aiMode) {
    return (
      <AiChatView
        alwaysMountedRunners={alwaysMountedRunners}
        aiQuery={aiQuery}
        setAiQuery={setAiQuery}
        messages={aiMessages}
        aiStreaming={aiStreaming}
        aiInputRef={aiInputRef as React.RefObject<HTMLInputElement>}
        aiResponseRef={aiResponseRef as React.RefObject<HTMLDivElement>}
        conversations={aiConversations}
        activeConversationId={aiActiveConversationId}
        sendMessage={aiSendMessage}
        stopStreaming={aiStopStreaming}
        newChat={aiNewChat}
        selectConversation={aiSelectConversation}
        deleteConversation={aiDeleteConversation}
        exitAiMode={exitAiMode}
      />
    );
  }

  // ─── App Uninstall mode ────────────────────────────────────────
  if (showAppUninstall) {
    return (
      <>
        {alwaysMountedRunners}
        <div className="w-full h-full">
          <div className="glass-effect overflow-hidden h-full flex flex-col relative">
            <AppUninstallView
              appPath={showAppUninstall}
              onClose={() => {
                setShowAppUninstall(null);
                setShowActions(false);
                setContextMenu(null);
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
            await window.electron.setLauncherMode('default');
            await window.electron.saveSettings({ hasSeenOnboarding: true, hasSeenWhisperOnboarding: true });
            setShowOnboarding(false);
            setShowWhisperOnboarding(false);
            setOnboardingRequiresShortcutFix(false);
            await window.electron.hideWindow();
          }}
          onComplete={async () => {
            await window.electron.setLauncherMode('default');
            await window.electron.saveSettings({ hasSeenOnboarding: true, hasSeenWhisperOnboarding: true });
            setShowOnboarding(false);
            setShowWhisperOnboarding(false);
            setOnboardingRequiresShortcutFix(false);
            await window.electron.hideWindow();
          }}
        />
      </>
    );
  }

  // ─── Launcher mode ──────────────────────────────────────────────
  return (
    <LauncherMainView
      alwaysMountedRunners={alwaysMountedRunners}
      backgroundImageUrl={launcherBackgroundImageUrl}
      backgroundBlurPercent={launcherBackgroundImageBlurPercent}
      backgroundOpacityPercent={launcherBackgroundImageOpacityPercent}

      inlineArgumentLaneRef={inlineArgumentLaneRef}
      inlineArgumentClusterRef={inlineArgumentClusterRef}
      inlineArgumentInputRefs={inlineArgumentInputRefs}
      inlineQuickLinkInputRefs={inlineQuickLinkInputRefs}

      inputRef={inputRef}
      searchPlaceholder={aiMode ? t('launcher.aiMode.placeholder') : t('launcher.searchPlaceholder')}
      launcherInputValue={launcherInputValue}
      autocompleteSuffix={browserSearchAutoComplete?.suffix || ''}
      onInputChange={handleLauncherInputChange}
      onSearchBlur={handleLauncherSearchBlur}
      onSearchKeyDown={handleKeyDown}

      inlineArgumentStartPx={inlineArgumentStartPx}
      selectedInlineArgumentLeadingIcon={selectedInlineArgumentLeadingIcon}

      selectedInlineExtensionArgumentDefinitions={selectedInlineExtensionArgumentDefinitions}
      selectedInlineExtensionArgumentValues={selectedInlineExtensionArgumentValues}
      hasSelectedExtensionOverflowArguments={hasSelectedExtensionOverflowArguments}
      selectedExtensionOverflowCount={selectedExtensionArgumentDefinitions.length - selectedInlineExtensionArgumentDefinitions.length}
      onInlineExtensionArgumentChange={handleInlineExtensionArgumentChange}

      selectedQuickLinkId={selectedQuickLinkId}
      selectedInlineQuickLinkDynamicFields={selectedInlineQuickLinkDynamicFields}
      selectedInlineQuickLinkDynamicValues={selectedInlineQuickLinkDynamicValues}
      hasSelectedQuickLinkOverflowDynamicFields={hasSelectedQuickLinkOverflowDynamicFields}
      selectedQuickLinkOverflowCount={selectedQuickLinkDynamicFields.length - selectedInlineQuickLinkDynamicFields.length}
      onInlineQuickLinkDynamicValueChange={handleInlineQuickLinkDynamicValueChange}

      searchQuery={searchQuery}
      aiAvailable={aiAvailable}
      shouldHideAskAi={shouldHideAskAi}
      onAskAi={() => startAiChat(searchQuery)}
      onClearSearch={() => setSearchQuery('')}

      launcherViewMode={launcherViewMode}
      isCompactCollapsed={isCompactCollapsed}
      logoSrc={supercmdLogo}
      onShowCompactLauncher={showCompactLauncher}

      listRef={listRef}
      itemRefs={itemRefs}
      isLoading={isLoading}
      displayCommands={displayCommands}
      sections={launcherCommandSections}
      calcResult={calcResult}
      calcOffset={calcOffset}
      selectedIndex={selectedIndex}
      commandAliases={commandAliases}
      commandHotkeys={commandHotkeys}
      onCalculatorCopy={copyCalculatorResult}
      onCommandClick={handleCommandRowClick}
      onCommandContextMenu={openLauncherCommandContextMenu}

      launcherFooterStatus={launcherFooterStatus}
      selectedCommand={selectedCommand}
      selectedAction={selectedActions[0]}
      browserProfiles={browserSearch.profiles}
      onOpenActions={openSelectedCommandActions}

      quickLinkDynamicPrompt={quickLinkDynamicPrompt}
      quickLinkDynamicInputRef={quickLinkDynamicInputRef}
      quickLinkDynamicPromptTitle={quickLinkDynamicPromptTitle}
      setQuickLinkDynamicPrompt={setQuickLinkDynamicPrompt}
      cancelQuickLinkDynamicPrompt={cancelQuickLinkDynamicPrompt}
      submitQuickLinkDynamicPrompt={submitQuickLinkDynamicPrompt}

      showActions={showActions}
      actionsOverlayActions={actionsOverlayActions}
      selectedActionIndex={selectedActionIndex}
      setSelectedActionIndex={setSelectedActionIndex}
      actionsOverlayRef={actionsOverlayRef}
      handleActionsOverlayKeyDown={handleActionsOverlayKeyDown}
      closeActionsOverlay={() => setShowActions(false)}
      onActionOverlayClick={async (action) => {
        await Promise.resolve(action.execute());
        setShowActions(false);
        restoreLauncherFocus();
      }}

      contextMenu={contextMenu}
      contextActions={contextActions}
      selectedContextActionIndex={selectedContextActionIndex}
      setSelectedContextActionIndex={setSelectedContextActionIndex}
      contextMenuRef={contextMenuRef}
      handleContextMenuKeyDown={handleContextMenuKeyDown}
      closeContextMenu={() => setContextMenu(null)}
      onContextMenuActionClick={async (action) => {
        await Promise.resolve(action.execute());
        setContextMenu(null);
        restoreLauncherFocus();
      }}

      isNativeLiquidGlass={isNativeLiquidGlass}
      isGlassyTheme={isGlassyTheme}
      t={t}
    />
  );
};

export default App;
