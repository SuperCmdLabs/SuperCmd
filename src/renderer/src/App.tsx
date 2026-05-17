/**
 * Launcher App
 *
 * Dynamically displays all applications and System Settings.
 * Shows category labels like Raycast.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import supercmdLogo from '../../../supercmd.png';
import type {
  CommandInfo,
  ExtensionBundle,
  AppSettings,
  IndexedFileSearchResult,
  BrowserSearchNicknameSetting,
  BrowserSearchResultGroupSetting,
  WebSearchBangCustomProviderSetting,
  WebSearchBangEntry,
  WebSearchBangOverrideSetting,
  WebSearchBangUsageSetting,
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
import { useDetachedPortalWindow } from './useDetachedPortalWindow';
import { useAppViewManager } from './hooks/useAppViewManager';
import { useAiChat } from './hooks/useAiChat';
import { useCursorPrompt } from './hooks/useCursorPrompt';
import { useMenuBarExtensions } from './hooks/useMenuBarExtensions';
import { useBackgroundRefresh } from './hooks/useBackgroundRefresh';
import { useSpeakManager } from './hooks/useSpeakManager';
import { useWhisperManager } from './hooks/useWhisperManager';
import { useBrowserSearch, type BrowserSearchResult } from './hooks/useBrowserSearch';
import { useLauncherCommandModel } from './hooks/useLauncherCommandModel';
import { useLauncherInlineArguments } from './hooks/useLauncherInlineArguments';
import { useLauncherActionModel } from './hooks/useLauncherActionModel';
import { useLauncherLocalSystemCommands } from './hooks/useLauncherLocalSystemCommands';
import { useLauncherCommandExecution } from './hooks/useLauncherCommandExecution';
import { AI_CHAT_STORAGE_KEY, LAST_EXT_KEY, MAX_RECENT_COMMANDS } from './utils/constants';
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
import WebSearchView, {
  type WebSearchBangPromptState,
  type WebSearchCustomBangPromptState,
  type WebSearchViewSection,
} from './views/WebSearchView';
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
} from './utils/launcher-file-results';
import {
  BROWSER_SEARCH_BOOKMARKS_COMMAND_ID,
  BROWSER_SEARCH_HISTORY_COMMAND_ID,
  BROWSER_SEARCH_OPEN_TABS_COMMAND_ID,
  BROWSER_SEARCH_SHOW_ALL_RESULTS_ID,
  type BrowserResultsViewScope,
  canEditBrowserResultNickname,
  DEFAULT_BROWSER_SEARCH_RESULT_GROUPS,
  formatBrowserHistoryDateSection,
  getBrowserResultNicknameKey,
  getSuggestedBookmarkNickname,
  isBrowserSearchCommand,
  normalizeBookmarkNickname,
  normalizeBookmarkNicknameUrl,
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
  isEditableElement,
} from './utils/launcher-misc';
import {
  type BangParseState,
  type SearchBangDefinition,
  type WebSearchResult,
  WEB_SEARCH_ACTIVE_BANG_SUGGESTION_LIMIT,
  WEB_SEARCH_BANG_USE_COUNTS_KEY,
  WEB_SEARCH_COMMAND_ID,
  WEB_SEARCH_INITIAL_VISIBLE_RESULTS,
  WEB_SEARCH_RECENT_BANG_LIMIT,
  WEB_SEARCH_ROOT_BANG_PREFIX,
  WEB_SEARCH_SUGGEST_DEBOUNCE_MS,
  WEB_SEARCH_VISIBLE_RESULTS_INCREMENT,
  SEARCH_BANGS,
  buildBangSearchUrl,
  createUpdatedBangUsage,
  formatWebSearchBangAliases,
  formatWebSearchBangAliasSummary,
  getBangUsageScore,
  getFaviconUrlForHost,
  getSearchBangByKeyFromList,
  getSortedSearchBangs,
  getWebSearchBangSection,
  getWebSearchBangSectionTitleKey,
  normalizeBangDefinition,
  normalizeWebSearchBangAliasList,
  parseSearchBangFromList,
  parseSearchBangState,
} from './utils/web-search-bangs';

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
  const [autoQuitAppPaths, setAutoQuitAppPaths] = useState<Set<string>>(new Set());
  const browserSearch = useBrowserSearch(searchQuery);
  const [browserSearchSkipAutoComplete, setBrowserSearchSkipAutoComplete] = useState(false);
  const [browserSearchResultGroups, setBrowserSearchResultGroups] = useState<BrowserSearchResultGroupSetting[]>(
    DEFAULT_BROWSER_SEARCH_RESULT_GROUPS
  );
  const [browserResultsViewQuery, setBrowserResultsViewQuery] = useState<string | null>(null);
  const [browserResultsViewScope, setBrowserResultsViewScope] = useState<BrowserResultsViewScope>('all');
  const [browserResultsViewSelectedIndex, setBrowserResultsViewSelectedIndex] = useState(0);
  const [browserHistorySelectedProfileIds, setBrowserHistorySelectedProfileIds] = useState<string[] | null>(null);
  const [browserHistoryProfileMenuOpen, setBrowserHistoryProfileMenuOpen] = useState(false);
  const [webSearchQuery, setWebSearchQuery] = useState<string | null>(null);
  const [webSearchSelectedIndex, setWebSearchSelectedIndex] = useState(0);
  const [rootWebSearchSuggestions, setRootWebSearchSuggestions] = useState<string[]>([]);
  const [webSearchSuggestions, setWebSearchSuggestions] = useState<string[]>([]);
  const [webSearchDefaultBangKey, setWebSearchDefaultBangKey] = useState('g');
  const [webSearchSuggestionLimit, setWebSearchSuggestionLimit] = useState(3);
  const [webSearchBangUsage, setWebSearchBangUsage] = useState<Record<string, WebSearchBangUsageSetting>>({});
  const [webSearchBangCatalog, setWebSearchBangCatalog] = useState<SearchBangDefinition[]>([]);
  const [webSearchBangOverrides, setWebSearchBangOverrides] = useState<WebSearchBangOverrideSetting[]>([]);
  const [webSearchDisabledBangKeys, setWebSearchDisabledBangKeys] = useState<string[]>([]);
  const [webSearchBangCustomProviders, setWebSearchBangCustomProviders] = useState<WebSearchBangCustomProviderSetting[]>([]);
  const [webSearchShowHiddenBangs, setWebSearchShowHiddenBangs] = useState(false);
  const [launcherFileResults, setLauncherFileResults] = useState<IndexedFileSearchResult[]>([]);
  const [disableFileSearchResults, setDisableFileSearchResults] = useState(false);
  const [launcherViewMode, setLauncherViewMode] = useState<'expanded' | 'compact'>('expanded');
  const [isCompactCollapsed, setIsCompactCollapsed] = useState(true);
  const [launcherFileIcons, setLauncherFileIcons] = useState<Record<string, string>>({});
  const [fileIsDirectoryMap, setFileIsDirectoryMap] = useState<Record<string, boolean>>({});
  const [launcherFooterStatus, setLauncherFooterStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const launcherFooterStatusTimerRef = useRef<number | null>(null);
  const [fileSearchInitialDetailPath, setFileSearchInitialDetailPath] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [navigationStyle, setNavigationStyle] = useState<'vim' | 'macos'>('vim');
  const [isLoading, setIsLoading] = useState(false);
  const homeDir = String((window.electron as any).homeDir || '');
  const {
    extensionView, extensionPreferenceSetup, scriptCommandSetup, scriptCommandOutput,
    showClipboardManager, showSnippetManager, showNotesSearch, showCanvasSearch, showQuickLinkManager, showFileSearch, showCursorPrompt,
    showWhisper, showSpeak, showCamera, showSchedule, showWindowManager, showAppUninstall, showWhisperOnboarding, showWhisperHint, showOnboarding, aiMode,
    openOnboarding, openWhisper, openClipboardManager,
    openSnippetManager, openNotesSearch, openCanvasSearch, openQuickLinkManager, openFileSearch, openCursorPrompt, openSpeak, openCamera, openSchedule, openWindowManager, openAppUninstall,
    setExtensionView, setExtensionPreferenceSetup, setScriptCommandSetup, setScriptCommandOutput,
    setShowClipboardManager, setShowSnippetManager, setShowNotesSearch, setShowCanvasSearch, setShowQuickLinkManager, setShowFileSearch, setShowCursorPrompt,
    setShowWhisper, setShowSpeak, setShowCamera, setShowSchedule, setShowWindowManager, setShowAppUninstall, setShowWhisperOnboarding, setShowWhisperHint,
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
  const [bookmarkNicknamePrompt, setBookmarkNicknamePrompt] = useState<{
    result: BrowserSearchResult;
    value: string;
  } | null>(null);
  const [webSearchBangPrompt, setWebSearchBangPrompt] = useState<WebSearchBangPromptState | null>(null);
  const [webSearchCustomBangPrompt, setWebSearchCustomBangPrompt] = useState<WebSearchCustomBangPromptState | null>(null);
  const [webSearchVisibleResultCount, setWebSearchVisibleResultCount] = useState(WEB_SEARCH_INITIAL_VISIBLE_RESULTS);
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
  const browserResultsViewInputRef = useRef<HTMLInputElement>(null);
  const webSearchInputRef = useRef<HTMLInputElement>(null);
  const fileSearchRequestSeqRef = useRef(0);
  const commandsRef = useRef<CommandInfo[]>([]);
  const lastCommandsFetchAtRef = useRef(0);
  const lastRecordedRootBangUseRef = useRef<string | null>(null);
  const lastRecordedWebBangUseRef = useRef<string | null>(null);
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
  const bookmarkNicknameInputRef = useRef<HTMLInputElement>(null);
  const webSearchBangInputRef = useRef<HTMLInputElement>(null);
  const windowPresetCommandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastWindowHiddenAtRef = useRef<number>(0);
  const directLaunchExpansionGuardUntilRef = useRef<number>(0);
  // Holds a search query to restore after the window-shown reset, set by the
  // hotkey no-view path when it needs to open the launcher with a pre-typed query.
  const pendingWindowShownQueryRef = useRef<string | null>(null);
  const isLauncherModeActiveRef = useRef(false);
  const pinnedCommandsRef = useRef<string[]>([]);
  const pinnedFilesRef = useRef<string[]>([]);
  const extensionViewRef = useRef<ExtensionBundle | null>(null);
  extensionViewRef.current = extensionView;
  pinnedCommandsRef.current = pinnedCommands;
  pinnedFilesRef.current = pinnedFiles;
  const effectiveSearchBangs = useMemo(() => {
    const byKey = new Map<string, SearchBangDefinition>();
    const disabled = new Set(webSearchDisabledBangKeys);
    for (const entry of webSearchBangCatalog) {
      const normalized = normalizeBangDefinition(entry);
      byKey.set(normalized.key, { ...normalized, disabled: disabled.has(normalized.key) });
    }
    for (const entry of SEARCH_BANGS) {
      const normalized = normalizeBangDefinition(entry);
      byKey.set(normalized.key, { ...normalized, disabled: disabled.has(normalized.key) });
    }
    for (const entry of webSearchBangCustomProviders) {
      const normalized = normalizeBangDefinition({
        key: entry.key,
        aliases: entry.aliases,
        name: entry.name,
        host: entry.host,
        template: entry.template,
        category: 'Custom',
        source: 'custom',
      });
      byKey.set(normalized.key, { ...normalized, disabled: disabled.has(normalized.key) });
    }
    const overrides = new Map(webSearchBangOverrides.map((override) => [override.key, override]));
    for (const [key, override] of overrides) {
      const current = byKey.get(key);
      if (!current) continue;
      byKey.set(key, {
        ...current,
        aliases: override.aliases.filter((alias) => alias !== key),
      });
    }
    return Array.from(byKey.values());
  }, [webSearchBangCatalog, webSearchBangOverrides, webSearchBangCustomProviders, webSearchDisabledBangKeys]);
  const enabledSearchBangs = useMemo(
    () => effectiveSearchBangs.filter((bang) => !bang.disabled),
    [effectiveSearchBangs]
  );
  // Configurable timeout (ms) before the launcher resets to root search after
  // it has been hidden. Synced from settings.popToRootSearchTimeoutSeconds.
  // 0 = reset immediately on every reopen.
  const popToRootTimeoutMsRef = useRef<number>(DEFAULT_POP_TO_ROOT_TIMEOUT_SECONDS * 1000);
  // Tracks whether any persistable view (extension or internal view like
  // Clipboard/Snippets/etc.) is currently active, so the window-shown handler
  // can keep that view alive when reopened within the configured timeout.
  const hasPersistableViewRef = useRef<boolean>(false);
  hasPersistableViewRef.current = Boolean(
    extensionView ||
    showClipboardManager ||
    showSnippetManager ||
    showQuickLinkManager ||
    showFileSearch ||
    showNotesSearch ||
    showCanvasSearch ||
    browserResultsViewQuery !== null ||
    webSearchQuery !== null ||
    showCamera ||
    showSchedule ||
    showAppUninstall
  );

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
      setWebSearchDefaultBangKey(String(settings.browserSearch?.webSearchDefaultBangKey || 'g'));
      setWebSearchSuggestionLimit(Math.max(0, Math.min(8, Math.floor(Number(settings.browserSearch?.webSearchSuggestionLimit ?? 3)))));
      setWebSearchBangOverrides(Array.isArray(settings.browserSearch?.webSearchBangOverrides) ? settings.browserSearch.webSearchBangOverrides : []);
      setWebSearchBangUsage(settings.browserSearch?.webSearchBangUsage && typeof settings.browserSearch.webSearchBangUsage === 'object' ? settings.browserSearch.webSearchBangUsage : {});
      setWebSearchDisabledBangKeys(Array.isArray(settings.browserSearch?.webSearchDisabledBangKeys) ? settings.browserSearch.webSearchDisabledBangKeys : []);
      setWebSearchBangCustomProviders(Array.isArray(settings.browserSearch?.webSearchBangCustomProviders) ? settings.browserSearch.webSearchBangCustomProviders : []);
      setWebSearchShowHiddenBangs(Boolean(settings.browserSearch?.webSearchShowHiddenBangs));
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
  }, []);

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
        setBrowserResultsViewQuery(null);
        localStorage.removeItem(LAST_EXT_KEY);
        exitAiMode();
        if (!isOnboardingMode) {
          expandLauncherForDirectLaunch();
        }
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
        if (routedSystemCommandId === 'system-search-notes') {
          setShowClipboardManager(false);
          setShowSnippetManager(null);
          setShowFileSearch(false);
          openNotesSearch();
          return;
        }
        if (routedSystemCommandId === 'system-create-note') {
          window.electron.openNotesWindow('create');
          return;
        }
        if (routedSystemCommandId === 'system-search-canvases') {
          openCanvasSearch();
          return;
        }
        if (routedSystemCommandId === 'system-create-canvas') {
          window.electron.openCanvasWindow('create');
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
        if (routedSystemCommandId === BROWSER_SEARCH_OPEN_TABS_COMMAND_ID) {
          setShowClipboardManager(false);
          setShowSnippetManager(null);
          setShowQuickLinkManager(null);
          setShowFileSearch(false);
          browserSearch.refreshOpenTabs();
          setBrowserResultsViewScope('open-tabs');
          setBrowserResultsViewQuery('');
          return;
        }
        if (routedSystemCommandId === BROWSER_SEARCH_BOOKMARKS_COMMAND_ID) {
          setShowClipboardManager(false);
          setShowSnippetManager(null);
          setShowQuickLinkManager(null);
          setShowFileSearch(false);
          browserSearch.refreshBrowserEntries();
          setBrowserResultsViewScope('bookmarks');
          setBrowserResultsViewQuery('');
          return;
        }
        if (routedSystemCommandId === BROWSER_SEARCH_HISTORY_COMMAND_ID) {
          setShowClipboardManager(false);
          setShowSnippetManager(null);
          setShowQuickLinkManager(null);
          setShowFileSearch(false);
          browserSearch.refreshBrowserEntries();
          setBrowserHistoryProfileMenuOpen(false);
          setBrowserResultsViewScope('history');
          setBrowserResultsViewQuery('');
          return;
        }
        if (routedSystemCommandId === 'system-my-schedule') {
          setShowClipboardManager(false);
          setShowSnippetManager(null);
          setShowQuickLinkManager(null);
          setShowFileSearch(false);
          openSchedule();
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

      if (Date.now() <= directLaunchExpansionGuardUntilRef.current) {
        whisperSessionRef.current = false;
        setShowCursorPrompt(false);
        setShowWhisperHint(false);
        setMemoryFeedback(null);
        setMemoryActionLoading(false);
        setSelectedTextSnapshot(String(payload?.selectedTextSnapshot || '').trim());
        exitAiMode();
        expandLauncherForDirectLaunch();
        return;
      }

      whisperSessionRef.current = false;
      setShowCursorPrompt(false);
      setShowWhisperHint(false);
      setShowWindowManager(false);
      setMemoryFeedback(null);
      setMemoryActionLoading(false);
      setScriptCommandSetup(null);
      setScriptCommandOutput(null);
      setSelectedTextSnapshot(String(payload?.selectedTextSnapshot || '').trim());
      const popToRootTimeoutMs = popToRootTimeoutMsRef.current;
      const shouldResetOverlays =
        popToRootTimeoutMs === 0 ||
        (lastWindowHiddenAtRef.current > 0 &&
          Date.now() - lastWindowHiddenAtRef.current > popToRootTimeoutMs);

      if (shouldResetOverlays) {
        setExtensionView(null);
        localStorage.removeItem(LAST_EXT_KEY);
        setShowActions(false);
        setContextMenu(null);
        setShowClipboardManager(false);
        setShowSnippetManager(null);
        setShowNotesSearch(false);
        setShowCanvasSearch(false);
        setShowQuickLinkManager(null);
        setShowFileSearch(false);
        setShowCursorPrompt(false);
        setShowWhisper(false);
        setShowSpeak(false);
        setShowCamera(false);
        setShowSchedule(false);
        setShowWhisperOnboarding(false);
      }

      // If a persistable view (extension or internal view like Clipboard,
      // Snippets, File Search, etc.) is open, keep it alive — don't reset.
      if (hasPersistableViewRef.current && !shouldResetOverlays) {
        setIsCompactCollapsed(false);
        void window.electron.resizeLauncherWindow(true);
        return;
      }
      const pendingQuery = pendingWindowShownQueryRef.current;
      pendingWindowShownQueryRef.current = null;
      if (pendingQuery) {
        setSearchQuery(pendingQuery);
        setSelectedIndex(0);
        requestPendingInlineArgumentFocus();
      }
      // When a pending query is pre-filled (e.g. hotkey-triggered no-view
      // command with missing args), expand out of compact so results are
      // immediately visible.
      if (pendingQuery) {
        exitAiMode();
        expandLauncherForDirectLaunch();
      } else {
        setIsCompactCollapsed(true);
        exitAiMode();
      }
      // Focus synchronously before any IO — a keystroke arriving back-to-back
      // with the show event must land on a focused input.
      inputRef.current?.focus();

      // Defer housekeeping past first paint so it doesn't compete with the
      // user's first keystroke or list rendering.
      const runDeferred = () => {
        const COMMANDS_REFRESH_TTL_MS = 5 * 60_000;
        if (
          commandsRef.current.length === 0 ||
          Date.now() - lastCommandsFetchAtRef.current > COMMANDS_REFRESH_TTL_MS
        ) {
          fetchCommands({ showLoading: false });
        }
        loadLauncherPreferences();
        window.electron.aiIsAvailable().then(setAiAvailable);
      };
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(runDeferred, { timeout: 200 });
      } else {
        setTimeout(runDeferred, 0);
      }
    });
    return cleanupWindowShown;
  }, [expandLauncherForDirectLaunch, fetchCommands, loadLauncherPreferences, refreshSelectedTextSnapshot, openWhisper, openSpeak, openCursorPrompt, resetCursorPromptState, exitAiMode, setShowCursorPrompt, setShowWhisperHint, setMemoryFeedback, setMemoryActionLoading, setScriptCommandSetup, setScriptCommandOutput, setExtensionView, setSearchQuery, setSelectedIndex, setShowSnippetManager, setShowNotesSearch, setShowCanvasSearch, setShowQuickLinkManager, setShowFileSearch, openClipboardManager, setShowClipboardManager, openSnippetManager, openQuickLinkManager, openFileSearch, openSchedule, openCamera, openOnboarding, setShowCamera, setShowSchedule, setShowWindowManager, setShowWhisper, setShowSpeak, setShowWhisperOnboarding, browserSearch]);

  useEffect(() => {
    const cleanupSelectionSnapshotUpdated = window.electron.onSelectionSnapshotUpdated((payload) => {
      setSelectedTextSnapshot(String(payload?.selectedTextSnapshot || '').trim());
    });
    return cleanupSelectionSnapshotUpdated;
  }, []);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(WEB_SEARCH_BANG_USE_COUNTS_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      setWebSearchBangUsage((current) => {
        if (Object.keys(current).length > 0) return current;
        return Object.entries(parsed).reduce((acc, [key, value]) => {
          const normalizedKey = String(key || '').trim().toLowerCase();
          const count = Math.floor(Number(value));
          if (normalizedKey && Number.isFinite(count) && count > 0) {
            acc[normalizedKey] = { useCount: count, lastUsedAt: Date.now(), frecencyScore: count };
          }
          return acc;
        }, {} as Record<string, WebSearchBangUsageSetting>);
      });
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.electron.webSearchListBangs?.()
      .then((entries: WebSearchBangEntry[]) => {
        if (cancelled || !Array.isArray(entries)) return;
        const next = entries
          .map((entry): SearchBangDefinition | null => {
            const key = String(entry?.key || '').trim().toLowerCase().replace(/^!+/, '');
            if (!key) return null;
            return {
              key,
              aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
              name: String(entry.name || key),
              host: String(entry.host || 'duckduckgo.com'),
              category: entry.category,
              subcategory: entry.subcategory,
              template: String(entry.urlTemplate || 'https://duckduckgo.com/?q=!{bang}%20{query}'),
              source: entry.source || 'duckduckgo',
              rankHint: entry.rankHint,
            };
          })
          .filter((entry): entry is SearchBangDefinition => Boolean(entry));
        setWebSearchBangCatalog(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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
      setWebSearchDefaultBangKey(String(settings.browserSearch?.webSearchDefaultBangKey || 'g'));
      setWebSearchSuggestionLimit(Math.max(0, Math.min(8, Math.floor(Number(settings.browserSearch?.webSearchSuggestionLimit ?? 3)))));
      setWebSearchBangOverrides(Array.isArray(settings.browserSearch?.webSearchBangOverrides) ? settings.browserSearch.webSearchBangOverrides : []);
      setWebSearchBangUsage(settings.browserSearch?.webSearchBangUsage && typeof settings.browserSearch.webSearchBangUsage === 'object' ? settings.browserSearch.webSearchBangUsage : {});
      setWebSearchDisabledBangKeys(Array.isArray(settings.browserSearch?.webSearchDisabledBangKeys) ? settings.browserSearch.webSearchDisabledBangKeys : []);
      setWebSearchBangCustomProviders(Array.isArray(settings.browserSearch?.webSearchBangCustomProviders) ? settings.browserSearch.webSearchBangCustomProviders : []);
      setWebSearchShowHiddenBangs(Boolean(settings.browserSearch?.webSearchShowHiddenBangs));
      setDisableFileSearchResults(Boolean(settings.disableFileSearchResults));
      setNavigationStyle(settings.navigationStyle === 'macos' ? 'macos' : 'vim');
      const popToRootSeconds = Number(settings.popToRootSearchTimeoutSeconds);
      popToRootTimeoutMsRef.current = (Number.isFinite(popToRootSeconds) ? Math.max(0, popToRootSeconds) : DEFAULT_POP_TO_ROOT_TIMEOUT_SECONDS) * 1000;
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
    if (!showActions && !contextMenu && !quickLinkDynamicPrompt && !bookmarkNicknamePrompt && !aiMode && !extensionView && !showClipboardManager && !showSnippetManager && !showNotesSearch && !showQuickLinkManager && !showFileSearch && !showCursorPrompt && !showWhisper && !showSpeak && !showCamera && !showSchedule && !showWindowManager && !showAppUninstall && !showOnboarding && browserResultsViewQuery === null && webSearchQuery === null) {
      restoreLauncherFocus();
    }
  }, [showActions, contextMenu, quickLinkDynamicPrompt, bookmarkNicknamePrompt, aiMode, extensionView, showClipboardManager, showSnippetManager, showNotesSearch, showQuickLinkManager, showFileSearch, showCursorPrompt, showWhisper, showSpeak, showCamera, showSchedule, showWindowManager, showAppUninstall, showOnboarding, showWhisperOnboarding, browserResultsViewQuery, webSearchQuery, restoreLauncherFocus]);

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
    !showOnboarding &&
    !showWhisperOnboarding;
  const shouldKeepLauncherSearchResults =
    isLauncherModeActive || showActions || Boolean(contextMenu);

  useEffect(() => {
    isLauncherModeActiveRef.current = isLauncherModeActive;
  }, [isLauncherModeActive]);

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

  // Chrome-style inline autocomplete: the input visually shows the full
  // completion ("x.com") with the auto-extended portion (".com") selected,
  // while `searchQuery` continues to hold what the user actually typed (so
  // result filtering uses the typed prefix, not the extended URL).
  const browserSearchAutoComplete = useMemo(() => {
    if (!browserSearch.enabled) return null;
    if (aiMode) return null;
    if (browserSearchSkipAutoComplete) return null;
    if (!searchQuery) return null;
    const parsedBang = parseSearchBangState(searchQuery, enabledSearchBangs);
    if (parsedBang.mode !== 'none') return null;
    const completion = browserSearch.getCompletion(searchQuery, browserSearchResultGroups);
    if (!completion) return null;
    if (completion.completion === searchQuery) return null;
    if (!completion.completion.toLowerCase().startsWith(searchQuery.toLowerCase())) return null;
    return completion;
  }, [browserSearch, browserSearchResultGroups, searchQuery, browserSearchSkipAutoComplete, aiMode, enabledSearchBangs]);

  const launcherInputValue = browserSearchAutoComplete?.completion ?? searchQuery;

  const rootBangState = useMemo<BangParseState>(() => {
    if (aiMode) return { mode: 'none' };
    return parseSearchBangState(searchQuery, enabledSearchBangs);
  }, [aiMode, searchQuery, enabledSearchBangs]);

  useEffect(() => {
    if (aiMode) return;
    const query = (rootBangState.mode === 'active' ? rootBangState.query : searchQuery).trim();
    if (!query || (rootBangState.mode !== 'active' && webSearchSuggestionLimit <= 0)) {
      setRootWebSearchSuggestions([]);
      return;
    }
    const provider = rootBangState.mode === 'active' ? rootBangState.bang : undefined;
    const limit = rootBangState.mode === 'active' ? WEB_SEARCH_ACTIVE_BANG_SUGGESTION_LIMIT : webSearchSuggestionLimit;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.electron.browserSearchSuggestMany(query, limit, provider ? { key: provider.key, host: provider.host, name: provider.name } : undefined)
        .then((suggestions) => {
          if (cancelled) return;
          setRootWebSearchSuggestions(Array.isArray(suggestions) ? suggestions.slice(0, limit) : []);
        })
        .catch(() => {
          if (!cancelled) setRootWebSearchSuggestions([]);
        });
    }, WEB_SEARCH_SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [aiMode, searchQuery, webSearchSuggestionLimit, rootBangState]);

  const {
    calcResult,
    calcOffset,
    displayCommands,
    launcherCommandSections,
    selectedCommand,
    selectedFileResultPath,
  } = useLauncherCommandModel({
    commands,
    searchQuery,
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
    browserSearchAutoComplete,
    browserSearchSkipAutoComplete,
    aiMode,
    rootBangState,
    enabledSearchBangs,
    effectiveSearchBangs,
    webSearchDefaultBangKey,
    webSearchBangUsage,
    rootWebSearchSuggestions,
    webSearchSuggestionLimit,
    selectedIndex,
    launcherInputValue,
    t,
  });

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

    requestPendingInlineArgumentFocus,
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

  const browserHistoryProfileOptions = useMemo(() => {
    return browserSearch.getHistoryProfiles();
  }, [browserSearch]);

  const effectiveBrowserHistoryProfileIds = useMemo(() => {
    if (browserHistorySelectedProfileIds !== null) return browserHistorySelectedProfileIds;
    return browserHistoryProfileOptions.length > 0
      ? browserHistoryProfileOptions.map((profile) => profile.id)
      : null;
  }, [browserHistoryProfileOptions, browserHistorySelectedProfileIds]);

  const browserResultsViewResults = useMemo(() => {
    if (browserResultsViewQuery === null) return [];
    if (browserResultsViewScope === 'open-tabs') {
      return browserSearch.getOpenTabResults(browserResultsViewQuery);
    }
    if (browserResultsViewScope === 'bookmarks') {
      return browserSearch.getBookmarkResults(browserResultsViewQuery);
    }
    if (browserResultsViewScope === 'history') {
      return browserSearch.getHistoryResults(
        browserResultsViewQuery,
        effectiveBrowserHistoryProfileIds,
        browserHistoryProfileOptions.length > 1
      );
    }
    return browserSearch.getAllResults(browserResultsViewQuery, browserSearchResultGroups);
  }, [browserHistoryProfileOptions.length, browserSearch, browserSearchResultGroups, browserResultsViewQuery, browserResultsViewScope, effectiveBrowserHistoryProfileIds]);

  const browserResultsViewSections = useMemo(() => {
    if (browserResultsViewScope === 'open-tabs') {
      const sections: Array<{
        key: string;
        kind: 'open-tab';
        title: string;
        items: BrowserSearchResult[];
      }> = [];
      const sectionByWindow = new Map<string, number>();
      for (const result of browserResultsViewResults) {
        const windowKey = [
          result.browserName || 'Browser',
          result.profileName || '',
          result.windowId || 'window',
        ].join(':');
        let sectionIndex = sectionByWindow.get(windowKey);
        if (sectionIndex === undefined) {
          sectionIndex = sections.length;
          sectionByWindow.set(windowKey, sectionIndex);
          const profileLabel = result.profileName ? ` - ${result.profileName}` : '';
          sections.push({
            key: `open-tab-window-${windowKey}`,
            kind: 'open-tab',
            title: `${result.browserName || t('launcher.badges.openTab')}${profileLabel} - Window ${sectionIndex + 1}`,
            items: [],
          });
        }
        sections[sectionIndex].items.push(result);
      }
      return sections;
    }
    if (browserResultsViewScope === 'bookmarks') {
      const sections: Array<{
        key: string;
        kind: 'bookmark';
        title: string;
        items: BrowserSearchResult[];
      }> = [];
      const sectionByFolder = new Map<string, number>();
      for (const result of browserResultsViewResults) {
        const folder = result.bookmarkFolder || t('launcher.badges.bookmark');
        let sectionIndex = sectionByFolder.get(folder);
        if (sectionIndex === undefined) {
          sectionIndex = sections.length;
          sectionByFolder.set(folder, sectionIndex);
          sections.push({
            key: `bookmark-folder-${folder}`,
            kind: 'bookmark',
            title: folder,
            items: [],
          });
        }
        sections[sectionIndex].items.push(result);
      }
      return sections;
    }
    if (browserResultsViewScope === 'history') {
      const sections: Array<{
        key: string;
        kind: 'history';
        title: string;
        items: BrowserSearchResult[];
      }> = [];
      const sectionByDate = new Map<string, number>();
      for (const result of browserResultsViewResults) {
        const sectionTitle = formatBrowserHistoryDateSection(result.lastUsedAt) || t('launcher.badges.history');
        let sectionIndex = sectionByDate.get(sectionTitle);
        if (sectionIndex === undefined) {
          sectionIndex = sections.length;
          sectionByDate.set(sectionTitle, sectionIndex);
          sections.push({
            key: `history-date-${sectionTitle}`,
            kind: 'history',
            title: sectionTitle,
            items: [],
          });
        }
        sections[sectionIndex].items.push(result);
      }
      return sections;
    }
    return [{
      key: 'browser-section-ranked',
      kind: 'history' as const,
      title: t('launcher.browserSearch.showAll'),
      items: browserResultsViewResults,
    }];
  }, [browserResultsViewResults, browserResultsViewScope, t]);

  useEffect(() => {
    setBrowserResultsViewSelectedIndex(0);
  }, [browserResultsViewQuery, browserResultsViewResults.length]);

  useEffect(() => {
    if (browserResultsViewQuery === null) return;
    window.setTimeout(() => browserResultsViewInputRef.current?.focus(), 0);
  }, [browserResultsViewQuery]);

  const openBrowserResult = useCallback(async (result: BrowserSearchResult, options?: { focusExistingTab?: boolean }) => {
    const ok = await browserSearch.executeBrowserSearch(result.actionInput, options);
    if (ok) {
      setBrowserResultsViewQuery(null);
      try { window.electron.hideWindow(); } catch {}
    }
  }, [browserSearch]);

  const activateBrowserResult = useCallback(async (result: BrowserSearchResult, alternate = false) => {
    const focusExistingTab = result.focusAvailable && (
      browserResultsViewScope === 'open-tabs' ? !alternate : alternate
    );
    await openBrowserResult(result, focusExistingTab ? { focusExistingTab: true } : undefined);
  }, [browserResultsViewScope, openBrowserResult]);

  const openBookmarkNicknamePrompt = useCallback((result: BrowserSearchResult | null) => {
    if (!canEditBrowserResultNickname(result)) return;
    setBookmarkNicknamePrompt({
      result,
      value: result.nickname || '',
    });
  }, []);

  const closeBookmarkNicknamePrompt = useCallback(() => {
    setBookmarkNicknamePrompt(null);
    window.setTimeout(() => browserResultsViewInputRef.current?.focus(), 0);
  }, []);

  const saveBookmarkNickname = useCallback(async (result: BrowserSearchResult, rawValue: string) => {
    if (!canEditBrowserResultNickname(result)) return;
    const nickname = normalizeBookmarkNickname(rawValue);
    const targetKey = getBrowserResultNicknameKey(result);
    try {
      const currentSettings = await window.electron.getSettings();
      const browserSearchSettings = currentSettings.browserSearch;
      const currentNicknames = Array.isArray(browserSearchSettings?.nicknames)
        ? browserSearchSettings.nicknames
        : [];
      const nextNicknames: BrowserSearchNicknameSetting[] = currentNicknames.filter((item) => {
        const itemKey = [
          item.source || '',
          item.sourceProfileId || '',
          normalizeBookmarkNicknameUrl(item.url),
        ].join(':');
        return itemKey !== targetKey;
      });
      if (nickname) {
        nextNicknames.push({
          source: result.source || '',
          sourceProfileId: result.sourceProfileId,
          url: result.url,
          nickname,
        });
      }
      await window.electron.saveSettings({
        browserSearch: {
          ...browserSearchSettings,
          nicknames: nextNicknames.sort((a, b) => a.nickname.localeCompare(b.nickname)),
        },
      });
      browserSearch.refreshBrowserEntries();
    } catch (error) {
      console.error('Failed to save bookmark nickname:', error);
    }
  }, [browserSearch]);

  const submitBookmarkNicknamePrompt = useCallback(async () => {
    if (!bookmarkNicknamePrompt) return;
    await saveBookmarkNickname(bookmarkNicknamePrompt.result, bookmarkNicknamePrompt.value);
    closeBookmarkNicknamePrompt();
  }, [bookmarkNicknamePrompt, closeBookmarkNicknamePrompt, saveBookmarkNickname]);

  useEffect(() => {
    if (!bookmarkNicknamePrompt) return;
    const timer = window.setTimeout(() => {
      void saveBookmarkNickname(bookmarkNicknamePrompt.result, bookmarkNicknamePrompt.value);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [bookmarkNicknamePrompt?.result.id, bookmarkNicknamePrompt?.value, saveBookmarkNickname]);

  useEffect(() => {
    if (!bookmarkNicknamePrompt) return;
    const timer = window.setTimeout(() => {
      bookmarkNicknameInputRef.current?.focus();
      bookmarkNicknameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookmarkNicknamePrompt?.result.id]);

  useEffect(() => {
    if (!bookmarkNicknamePrompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const suggestion = getSuggestedBookmarkNickname(bookmarkNicknamePrompt.result);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeBookmarkNicknamePrompt();
        return;
      }
      if (event.key === 'Tab' && suggestion) {
        event.preventDefault();
        setBookmarkNicknamePrompt((prev) => prev ? { ...prev, value: suggestion } : prev);
        void saveBookmarkNickname(bookmarkNicknamePrompt.result, suggestion);
        return;
      }
      if (
        (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        void submitBookmarkNicknamePrompt();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [bookmarkNicknamePrompt, closeBookmarkNicknamePrompt, submitBookmarkNicknamePrompt]);

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

  const copyDeeplinkForSelectedCommand = useCallback(async () => {
    if (!selectedCommand || !selectedCommand.deeplink) return;
    await copyCommandDeeplink(selectedCommand);
  }, [selectedCommand, copyCommandDeeplink]);

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

  // After every render where the autocomplete state changed, sync the
  // input's selection so the auto-extended portion stays highlighted.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (!browserSearchAutoComplete) return;
    if (el.value !== browserSearchAutoComplete.completion) return;
    const start = searchQuery.length;
    const end = browserSearchAutoComplete.completion.length;
    if (start >= end) return;
    try {
      el.setSelectionRange(start, end);
    } catch {}
  }, [browserSearchAutoComplete, searchQuery]);

  // Once the user has dismissed an autocomplete with Backspace, keep it
  // dismissed for the rest of the typing session — only re-enable when
  // they clear the input completely and start fresh. Mirrors how Chrome's
  // omnibox behaves after a manual rejection.
  useEffect(() => {
    if (searchQuery.length === 0 && browserSearchSkipAutoComplete) {
      setBrowserSearchSkipAutoComplete(false);
    }
  }, [searchQuery, browserSearchSkipAutoComplete]);

  const recordWebSearchBangUse = useCallback((bangKey: string) => {
    const normalizedKey = String(bangKey || '').trim().toLowerCase();
    if (!normalizedKey) return;
    setWebSearchBangUsage((current) => {
      const next = { ...current, [normalizedKey]: createUpdatedBangUsage(current[normalizedKey]) };
      try {
        localStorage.setItem(WEB_SEARCH_BANG_USE_COUNTS_KEY, JSON.stringify(Object.fromEntries(
          Object.entries(next).map(([key, value]) => [key, value.useCount])
        )));
      } catch {}
      window.electron.getSettings()
        .then((settings) => window.electron.saveSettings({
          browserSearch: {
            ...settings.browserSearch,
            webSearchBangUsage: next,
          },
        }))
        .catch(() => {});
      return next;
    });
  }, []);

  const submitBrowserSearch = useCallback(
    async (input: string, options?: { focusExistingTab?: boolean }) => {
      const trimmed = input.trim();
      if (!trimmed) return false;
      const bangState = parseSearchBangState(trimmed, enabledSearchBangs);
      if (bangState.mode === 'active' && bangState.query) {
        const ok = await window.electron.openUrl(buildBangSearchUrl(bangState.bang, bangState.query));
        if (ok) {
          setBrowserSearchSkipAutoComplete(false);
          try { window.electron.hideWindow(); } catch {}
        }
        return Boolean(ok);
      }
      const resolved = browserSearch.resolve(trimmed);
      if (resolved?.type === 'search') {
        const defaultBang = getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
        const ok = await window.electron.openUrl(buildBangSearchUrl(defaultBang, trimmed));
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
    [browserSearch, recordWebSearchBangUse, webSearchDefaultBangKey, effectiveSearchBangs, enabledSearchBangs]
  );

  useEffect(() => {
    if (rootBangState.mode !== 'active') {
      lastRecordedRootBangUseRef.current = null;
      return;
    }
    const key = rootBangState.bang.key;
    if (lastRecordedRootBangUseRef.current === key) return;
    lastRecordedRootBangUseRef.current = key;
    recordWebSearchBangUse(key);
  }, [recordWebSearchBangUse, rootBangState]);

  const closeWebSearch = useCallback(() => {
    setWebSearchQuery(null);
    setWebSearchSelectedIndex(0);
    setWebSearchSuggestions([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const openWebSearchMode = useCallback((initialQuery = '') => {
    expandLauncherForDirectLaunch();
    setWebSearchQuery(initialQuery);
    setWebSearchSelectedIndex(0);
    window.setTimeout(() => webSearchInputRef.current?.focus(), 0);
  }, [expandLauncherForDirectLaunch]);

  const webSearchBangState = useMemo<BangParseState>(() => {
    if (webSearchQuery === null) return { mode: 'none' };
    return parseSearchBangState(webSearchQuery, enabledSearchBangs);
  }, [enabledSearchBangs, webSearchQuery]);

  useEffect(() => {
    if (webSearchBangState.mode !== 'active') {
      lastRecordedWebBangUseRef.current = null;
      return;
    }
    const key = webSearchBangState.bang.key;
    if (lastRecordedWebBangUseRef.current === key) return;
    lastRecordedWebBangUseRef.current = key;
    recordWebSearchBangUse(key);
  }, [recordWebSearchBangUse, webSearchBangState]);

  useEffect(() => {
    if (webSearchQuery === null) return;
    const raw = String(webSearchQuery || '').trim();
    const searchSubject = webSearchBangState.mode === 'active' ? webSearchBangState.query.trim() : raw;
    const shouldFetch = Boolean(searchSubject) && (webSearchBangState.mode === 'active' || webSearchBangState.mode === 'none');
    if (!shouldFetch || (webSearchBangState.mode !== 'active' && webSearchSuggestionLimit <= 0)) {
      setWebSearchSuggestions([]);
      return;
    }
    const provider = webSearchBangState.mode === 'active'
      ? webSearchBangState.bang
      : getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
    const limit = webSearchBangState.mode === 'active'
      ? WEB_SEARCH_ACTIVE_BANG_SUGGESTION_LIMIT
      : webSearchSuggestionLimit;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.electron.browserSearchSuggestMany(searchSubject, limit, { key: provider.key, host: provider.host, name: provider.name })
        .then((suggestions) => {
          if (cancelled) return;
          setWebSearchSuggestions(Array.isArray(suggestions) ? suggestions.slice(0, limit) : []);
        })
        .catch(() => {
          if (!cancelled) setWebSearchSuggestions([]);
        });
    }, WEB_SEARCH_SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [effectiveSearchBangs, webSearchBangState, webSearchDefaultBangKey, webSearchQuery, webSearchSuggestionLimit]);

  const webSearchResults = useMemo<WebSearchResult[]>(() => {
    if (webSearchQuery === null) return [];
    const raw = String(webSearchQuery || '').trim();
    const results: WebSearchResult[] = [];
    if (raw && (webSearchBangState.mode === 'none' || webSearchBangState.mode === 'active')) {
      const activeBang = webSearchBangState.mode === 'active' ? webSearchBangState.bang : null;
      const defaultBang = getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
      const provider = activeBang || defaultBang;
      const searchSubject = (webSearchBangState.mode === 'active' ? webSearchBangState.query : raw).trim();
      if (!searchSubject) return [];
      results.push({
        id: 'web-search-mode:direct',
        kind: 'search',
        section: 'search',
        title: activeBang
          ? t('launcher.browserSearch.searchProviderFor', { provider: provider.name, query: searchSubject })
          : t('launcher.browserSearch.searchFor', { query: searchSubject }),
        subtitle: activeBang
          ? t('launcher.browserSearch.bangSubtitle', { bang: activeBang.key })
          : t('launcher.browserSearch.defaultSearch'),
        query: activeBang ? `${searchSubject} !${activeBang.key}` : searchSubject,
        bangKey: activeBang?.key,
        bang: activeBang || undefined,
        faviconUrl: getFaviconUrlForHost(provider.host),
      });
      for (const suggestion of webSearchSuggestions) {
        const normalized = String(suggestion || '').trim();
        if (!normalized || normalized.toLowerCase() === searchSubject.toLowerCase()) continue;
        results.push({
          id: `web-search-mode:suggestion:${normalized}`,
          kind: 'suggestion',
          section: 'search',
          title: normalized,
          subtitle: activeBang
            ? t('launcher.browserSearch.bangSubtitle', { bang: activeBang.key })
            : t('launcher.browserSearch.defaultSearch'),
          query: activeBang ? `${normalized} !${activeBang.key}` : normalized,
          bangKey: activeBang?.key,
          bang: activeBang || undefined,
          faviconUrl: getFaviconUrlForHost(provider.host),
        });
      }
      return results;
    }

    const parsed = parseSearchBangFromList(raw, enabledSearchBangs);
    const bangFilter = parsed.activeBangPrefix !== null
      ? parsed.activeBangPrefix
      : raw.replace(/^!+/, '');
    const sectionFilter = parsed.bang && !parsed.query ? '' : bangFilter;
    const candidateSource = webSearchShowHiddenBangs
      ? effectiveSearchBangs.filter((bang) => bang.disabled)
      : enabledSearchBangs;
    const sorted = parsed.bang && !parsed.query
      ? [parsed.bang, ...getSortedSearchBangs(candidateSource, null, webSearchBangUsage).filter((bang) => bang.key !== parsed.bang?.key)]
      : getSortedSearchBangs(candidateSource, bangFilter, webSearchBangUsage);
    const recentKeys = new Set<string>();
    const recentBangs = !sectionFilter && !webSearchShowHiddenBangs
      ? [...sorted]
          .filter((bang) => getBangUsageScore(webSearchBangUsage[bang.key]) > 0)
          .sort((a, b) => getBangUsageScore(webSearchBangUsage[b.key]) - getBangUsageScore(webSearchBangUsage[a.key]))
          .slice(0, WEB_SEARCH_RECENT_BANG_LIMIT)
      : [];
    for (const bang of recentBangs) recentKeys.add(bang.key);
    const matchingBangs = webSearchShowHiddenBangs
      ? sorted
      : sectionFilter
        ? sorted
        : [...recentBangs, ...sorted.filter((bang) => !recentKeys.has(bang.key))];
    for (const bang of matchingBangs) {
      const defaultAliases = [bang.key, ...(bang.aliases || [])];
      const aliasSummary = formatWebSearchBangAliasSummary(defaultAliases);
      const baseSubtitle = [bang.category, bang.subcategory, bang.host].filter(Boolean).join(' - ') || bang.host;
      results.push({
        id: `web-search-result:bang:${bang.key}`,
        kind: 'bang',
        section: webSearchShowHiddenBangs
          ? 'hidden'
          : recentKeys.has(bang.key) && !sectionFilter
            ? 'recent'
            : getWebSearchBangSection(bang, sectionFilter, webSearchBangUsage),
        title: `!${bang.key} ${bang.name}`,
        subtitle: aliasSummary ? `${baseSubtitle} - ${aliasSummary}` : baseSubtitle,
        query: `!${bang.key} `,
        bangKey: bang.key,
        defaultAliases,
        customAliases: webSearchBangOverrides.find((override) => override.key === bang.key)?.aliases,
        isCustom: webSearchBangOverrides.some((override) => override.key === bang.key),
        isDisabled: Boolean(bang.disabled),
        bang,
        faviconUrl: getFaviconUrlForHost(bang.host),
      });
    }
    return results;
  }, [effectiveSearchBangs, enabledSearchBangs, t, webSearchBangOverrides, webSearchBangState, webSearchBangUsage, webSearchDefaultBangKey, webSearchQuery, webSearchShowHiddenBangs, webSearchSuggestions]);

  const visibleWebSearchResults = useMemo(
    () => webSearchResults.slice(0, Math.min(webSearchVisibleResultCount, webSearchResults.length)),
    [webSearchResults, webSearchVisibleResultCount]
  );

  const visibleWebSearchSections = useMemo(() => {
    const sections: WebSearchViewSection[] = [];
    const indexByKey = new Map<WebSearchResult['section'], number>();
    visibleWebSearchResults.forEach((result, flatIndex) => {
      const sectionIndex = indexByKey.get(result.section);
      if (sectionIndex === undefined) {
        indexByKey.set(result.section, sections.length);
        sections.push({
          key: result.section,
          titleKey: getWebSearchBangSectionTitleKey(result.section),
          items: [result],
          startIndex: flatIndex,
        });
        return;
      }
      sections[sectionIndex].items.push(result);
    });
    return sections;
  }, [visibleWebSearchResults]);

  const selectedWebSearchResult = webSearchResults[webSearchSelectedIndex] || null;

  useEffect(() => {
    setWebSearchSelectedIndex(0);
    setWebSearchVisibleResultCount(WEB_SEARCH_INITIAL_VISIBLE_RESULTS);
  }, [webSearchQuery]);

  useEffect(() => {
    if (webSearchQuery === null) return;
    setWebSearchSelectedIndex((index) => Math.min(index, Math.max(0, webSearchResults.length - 1)));
  }, [webSearchQuery, webSearchResults.length]);

  useEffect(() => {
    if (webSearchQuery === null) return;
    if (webSearchSelectedIndex < webSearchVisibleResultCount - 12) return;
    setWebSearchVisibleResultCount((count) =>
      Math.min(webSearchResults.length, count + WEB_SEARCH_VISIBLE_RESULTS_INCREMENT)
    );
  }, [webSearchQuery, webSearchResults.length, webSearchSelectedIndex, webSearchVisibleResultCount]);

  useEffect(() => {
    if (webSearchQuery === null) return;
    window.setTimeout(() => webSearchInputRef.current?.focus(), 0);
  }, [webSearchQuery]);

  useEffect(() => {
    if (!webSearchBangPrompt) return;
    const timer = window.setTimeout(() => {
      webSearchBangInputRef.current?.focus();
      webSearchBangInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [webSearchBangPrompt?.result.id]);

  const activateWebSearchResult = useCallback(async (result: WebSearchResult | null) => {
    if (!result) return;
    if (result.kind === 'bang') {
      setWebSearchQuery(null);
      setWebSearchSelectedIndex(0);
      setSearchQuery(result.query);
      setSelectedIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    await submitBrowserSearch(result.query);
  }, [submitBrowserSearch]);

  const openWebSearchBangPrompt = useCallback((result: WebSearchResult | null) => {
    if (!result || result.kind !== 'bang' || !result.bangKey) return;
    setWebSearchBangPrompt({
      result,
      value: formatWebSearchBangAliases(result.customAliases || result.defaultAliases || [result.bangKey]),
    });
  }, []);

  const closeWebSearchBangPrompt = useCallback(() => {
    setWebSearchBangPrompt(null);
    window.setTimeout(() => webSearchInputRef.current?.focus(), 0);
  }, []);

  const saveWebSearchBangAliases = useCallback(async () => {
    if (!webSearchBangPrompt?.result.bangKey) return;
    const key = webSearchBangPrompt.result.bangKey;
    const aliases = normalizeWebSearchBangAliasList(webSearchBangPrompt.value);
    const defaultAliases = normalizeWebSearchBangAliasList(
      formatWebSearchBangAliases(webSearchBangPrompt.result.defaultAliases || [key])
    );
    const changed = aliases.join(',') !== defaultAliases.join(',');
    try {
      const currentSettings = await window.electron.getSettings();
      const browserSearchSettings = currentSettings.browserSearch;
      const currentOverrides = Array.isArray(browserSearchSettings?.webSearchBangOverrides)
        ? browserSearchSettings.webSearchBangOverrides
        : [];
      const nextOverrides = currentOverrides.filter((override) => override.key !== key);
      if (changed && aliases.length > 0) {
        nextOverrides.push({ key, aliases });
      }
      const sortedOverrides = nextOverrides.sort((a, b) => a.key.localeCompare(b.key));
      await window.electron.saveSettings({
        browserSearch: {
          ...browserSearchSettings,
          webSearchBangOverrides: sortedOverrides,
        },
      });
      setWebSearchBangOverrides(sortedOverrides);
    } catch (error) {
      console.error('Failed to save web search bang aliases:', error);
    } finally {
      closeWebSearchBangPrompt();
    }
  }, [closeWebSearchBangPrompt, webSearchBangPrompt]);

  const toggleWebSearchBangDisabled = useCallback(async (result: WebSearchResult | null) => {
    if (!result?.bangKey) return;
    const key = result.bangKey;
    try {
      const currentSettings = await window.electron.getSettings();
      const browserSearchSettings = currentSettings.browserSearch;
      const currentDisabled = Array.isArray(browserSearchSettings?.webSearchDisabledBangKeys)
        ? browserSearchSettings.webSearchDisabledBangKeys
        : [];
      const disabledSet = new Set(currentDisabled);
      if (disabledSet.has(key)) {
        disabledSet.delete(key);
      } else {
        disabledSet.add(key);
      }
      const nextDisabled = Array.from(disabledSet).sort();
      await window.electron.saveSettings({
        browserSearch: {
          ...browserSearchSettings,
          webSearchDisabledBangKeys: nextDisabled,
        },
      });
      setWebSearchDisabledBangKeys(nextDisabled);
    } catch (error) {
      console.error('Failed to update disabled bang:', error);
    }
  }, []);

  const toggleWebSearchShowHidden = useCallback(async () => {
    const next = !webSearchShowHiddenBangs;
    setWebSearchShowHiddenBangs(next);
    setWebSearchSelectedIndex(0);
    try {
      const currentSettings = await window.electron.getSettings();
      await window.electron.saveSettings({
        browserSearch: {
          ...currentSettings.browserSearch,
          webSearchShowHiddenBangs: next,
        },
      });
    } catch (error) {
      console.error('Failed to save hidden bang visibility:', error);
    }
  }, [webSearchShowHiddenBangs]);

  const openWebSearchCustomBangPrompt = useCallback(() => {
    setWebSearchCustomBangPrompt({
      key: '',
      aliases: '',
      name: '',
      host: '',
      template: 'https://example.com/search?q={query}',
    });
  }, []);

  const closeWebSearchCustomBangPrompt = useCallback(() => {
    setWebSearchCustomBangPrompt(null);
    window.setTimeout(() => webSearchInputRef.current?.focus(), 0);
  }, []);

  const saveWebSearchCustomBang = useCallback(async () => {
    if (!webSearchCustomBangPrompt) return;
    const key = normalizeWebSearchBangAliasList(webSearchCustomBangPrompt.key)[0] || '';
    const aliases = normalizeWebSearchBangAliasList(webSearchCustomBangPrompt.aliases).filter((alias) => alias !== key);
    const name = webSearchCustomBangPrompt.name.trim();
    const host = webSearchCustomBangPrompt.host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    const template = webSearchCustomBangPrompt.template.trim().replace(/\{\{\{s\}\}\}/g, '{query}');
    if (!key || !name || !host || !template.includes('{query}')) return;
    try {
      const currentSettings = await window.electron.getSettings();
      const browserSearchSettings = currentSettings.browserSearch;
      const currentProviders = Array.isArray(browserSearchSettings?.webSearchBangCustomProviders)
        ? browserSearchSettings.webSearchBangCustomProviders
        : [];
      const nextProviders = [
        ...currentProviders.filter((provider) => provider.key !== key),
        { key, aliases, name, host, template },
      ].sort((a, b) => a.key.localeCompare(b.key));
      await window.electron.saveSettings({
        browserSearch: {
          ...browserSearchSettings,
          webSearchBangCustomProviders: nextProviders,
        },
      });
      setWebSearchBangCustomProviders(nextProviders);
      closeWebSearchCustomBangPrompt();
    } catch (error) {
      console.error('Failed to save custom bang:', error);
    }
  }, [closeWebSearchCustomBangPrompt, webSearchCustomBangPrompt]);

  useEffect(() => {
    if (!webSearchBangPrompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWebSearchBangPrompt();
        return;
      }
      if (
        (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        void saveWebSearchBangAliases();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeWebSearchBangPrompt, saveWebSearchBangAliases, webSearchBangPrompt]);

  useEffect(() => {
    if (!webSearchCustomBangPrompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWebSearchCustomBangPrompt();
        return;
      }
      if (
        (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') &&
        event.metaKey &&
        !event.altKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        void saveWebSearchCustomBang();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeWebSearchCustomBangPrompt, saveWebSearchCustomBang, webSearchCustomBangPrompt]);

  useEffect(() => {
    if (webSearchQuery === null || webSearchBangPrompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault();
        event.stopPropagation();
        if (selectedWebSearchResult?.kind === 'bang') {
          openWebSearchBangPrompt(selectedWebSearchResult);
        } else {
          openWebSearchCustomBangPrompt();
        }
        return;
      }
      if (
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === 'd' || event.key === 'D') &&
        selectedWebSearchResult?.kind === 'bang'
      ) {
        event.preventDefault();
        event.stopPropagation();
        void toggleWebSearchBangDisabled(selectedWebSearchResult);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [openWebSearchBangPrompt, openWebSearchCustomBangPrompt, selectedWebSearchResult, toggleWebSearchBangDisabled, webSearchBangPrompt, webSearchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showAppUninstall) {
        return;
      }
      if (quickLinkDynamicPrompt) {
        return;
      }
      if (bookmarkNicknamePrompt) {
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
      if (selectedFileResultPath && e.metaKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        void pinToggleForFile(selectedFileResultPath);
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
      if (
        !selectedFileResultPath &&
        e.metaKey &&
        e.shiftKey &&
        (e.key === 'L' || e.key === 'l') &&
        selectedCommand?.deeplink
      ) {
        e.preventDefault();
        void copyDeeplinkForSelectedCommand();
        return;
      }
      if (!selectedFileResultPath && e.metaKey && (e.key === 'Backspace' || e.key === 'Delete')) {
        if (selectedCommand?.category === 'extension') {
          e.preventDefault();
          uninstallSelectedExtension();
          return;
        }
      }
      // Ctrl+X: Uninstall Application (for app commands and .app file results)
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 'x' || e.key === 'X')) {
        const appPath = selectedFileResultPath?.endsWith('.app')
          ? selectedFileResultPath
          : (selectedCommand?.category === 'app' && selectedCommand?.path?.endsWith('.app'))
            ? selectedCommand.path
            : null;
        if (appPath) {
          e.preventDefault();
          openAppUninstall(appPath);
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

      // Cmd+1 through Cmd+9: quick-launch the Nth command (Alfred-style)
      if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        const target = displayCommands[idx];
        if (target) {
          e.preventDefault();
          handleCommandExecute(target);
          return;
        }
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
          if (isSearchInputTarget && aiAvailable && !shouldHideAskAi) {
            e.preventDefault();
            if (launcherViewMode === 'compact') {
              setIsCompactCollapsed(false);
              window.electron.resizeLauncherWindow(true);
            }
            startAiChat(searchQuery);
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          if (launcherViewMode === 'compact' && isCompactCollapsed) {
            setIsCompactCollapsed(false);
            window.electron.resizeLauncherWindow(true);
            break;
          }
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
            } else if (
              e.metaKey &&
              !e.shiftKey &&
              !e.ctrlKey &&
              !e.altKey &&
              selected &&
              isBrowserSearchCommand(selected) &&
              selected.browserFocusAvailable
            ) {
              void submitBrowserSearch(String(selected.browserActionInput || launcherInputValue).trim(), { focusExistingTab: true });
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
            if (launcherViewMode === 'compact') {
              setIsCompactCollapsed(true);
              window.electron.resizeLauncherWindow(false);
            }
            return;
          }
          if (launcherViewMode === 'compact' && !isCompactCollapsed) {
            setIsCompactCollapsed(true);
            window.electron.resizeLauncherWindow(false);
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
      copyDeeplinkForSelectedCommand,
      selectedFileResultPath,
      showFileResultDetailsByPath,
      revealFileResultByPath,
      copyFileResultPath,
      pinToggleForFile,
      openAppUninstall,
      selectedCommand,
      contextMenu,
      showActions,
      quickLinkDynamicPrompt,
      bookmarkNicknamePrompt,
      showAppUninstall,
      launcherViewMode,
      isCompactCollapsed,
    ]
  );

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
    try {
      executingCommandRef.current = true;
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
          await submitBrowserSearch(subject);
        }
        return;
      }

      const filePath = getFileResultPathFromCommand(command);
      if (filePath) {
        await openFileResultByPath(filePath);
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
        await executeExtensionCommand(command);
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
          try { window.electron.hideWindow(); } catch {}
          return;
        }
        const ok = window.confirm(`Run "${command.title}"?`);
        if (!ok) return;
      }

      await window.electron.executeCommand(command.id);
      await updateRecentCommands(command.id);
      try { window.electron.hideWindow(); } catch {}
    } catch (error) {
      console.error('Failed to execute command:', error);
    } finally {
      executingCommandRef.current = false;
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
  const handleLauncherInputChange = useCallback((value: string) => {
    if (browserSearchAutoComplete && value === searchQuery && value.length > 0) {
      setBrowserSearchSkipAutoComplete(true);
      return;
    }

    setSearchQuery(value);

    if (launcherViewMode === 'compact') {
      if (isCompactCollapsed && value.length > 0) {
        setIsCompactCollapsed(false);
        window.electron.resizeLauncherWindow(true);
      } else if (!isCompactCollapsed && value.length === 0) {
        setIsCompactCollapsed(true);
        window.electron.resizeLauncherWindow(false);
      }
    }
  }, [browserSearchAutoComplete, isCompactCollapsed, launcherViewMode, searchQuery]);
  const copyCalculatorResult = useCallback(() => {
    if (!calcResult) return;
    navigator.clipboard.writeText(calcResult.result);
    window.electron.hideWindow();
  }, [calcResult]);
  const showCompactLauncher = useCallback(() => {
    setIsCompactCollapsed(false);
    window.electron.resizeLauncherWindow(true);
  }, []);
  const handleInlineExtensionArgumentChange = useCallback((argumentName: string, value: string) => {
    if (!selectedCommand) return;
    updateInlineExtensionArgumentValue(selectedCommand, argumentName, value);
  }, [selectedCommand, updateInlineExtensionArgumentValue]);
  const handleInlineQuickLinkDynamicValueChange = useCallback((fieldKey: string, value: string) => {
    if (!selectedQuickLinkId) return;
    updateInlineQuickLinkDynamicValue(selectedQuickLinkId, fieldKey, value);
  }, [selectedQuickLinkId, updateInlineQuickLinkDynamicValue]);

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
            setShowClipboardManager(false);
            setSearchQuery('');
            setSelectedIndex(0);
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
    const isWebSearchBangManager = !String(webSearchQuery || '').trim() ||
      webSearchBangState.mode === 'selecting' ||
      webSearchShowHiddenBangs;
    const activeWebSearchBang = webSearchBangState.mode === 'active' ? webSearchBangState.bang : null;

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
        submitSearch={submitBrowserSearch}
        loadMoreResults={() =>
          setWebSearchVisibleResultCount((count) =>
            Math.min(webSearchResults.length, count + WEB_SEARCH_VISIBLE_RESULTS_INCREMENT)
          )
        }
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
    const selectedBrowserResult = browserResultsViewResults[browserResultsViewSelectedIndex] || null;
    const showHistoryProfilePicker = browserResultsViewScope === 'history' && browserHistoryProfileOptions.length > 1;
    const selectedHistoryProfileCount = effectiveBrowserHistoryProfileIds?.length ?? browserHistoryProfileOptions.length;
    const historyProfileFilterLabel = `${selectedHistoryProfileCount}/${browserHistoryProfileOptions.length}`;
    const browserResultsPlaceholder = browserResultsViewScope === 'open-tabs'
      ? t('launcher.browserSearch.openTabsPlaceholder')
      : browserResultsViewScope === 'bookmarks'
        ? t('launcher.browserSearch.bookmarksPlaceholder')
        : browserResultsViewScope === 'history'
          ? t('launcher.browserSearch.historyPlaceholder')
      : t('launcher.browserSearch.showAllPlaceholder');
    const bookmarkNicknameSuggestion = bookmarkNicknamePrompt
      ? getSuggestedBookmarkNickname(bookmarkNicknamePrompt.result)
      : '';
    const closeBrowserResults = () => {
      setBrowserResultsViewQuery(null);
      setBrowserHistoryProfileMenuOpen(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    };

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
        showHistoryProfilePicker={showHistoryProfilePicker}
        historyProfileOptions={browserHistoryProfileOptions}
        effectiveHistoryProfileIds={effectiveBrowserHistoryProfileIds}
        historyProfileFilterLabel={historyProfileFilterLabel}
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
