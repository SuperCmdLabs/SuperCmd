import { useEffect, useRef } from 'react';
import type React from 'react';
import type { CommandInfo, ExtensionBundle } from '../../types/electron';
import type { MemoryFeedback } from '../utils/command-helpers';
import type {
  ScriptCommandOutput,
  ScriptCommandSetup,
} from './useAppViewManager';
import type { LauncherContextMenuState } from '../components/LauncherContextMenuOverlay';
import {
  BROWSER_SEARCH_BOOKMARKS_COMMAND_ID,
  BROWSER_SEARCH_HISTORY_COMMAND_ID,
  BROWSER_SEARCH_OPEN_TABS_COMMAND_ID,
  type BrowserResultsViewScope,
} from '../utils/browser-search-commands';
import { LAST_EXT_KEY } from '../utils/constants';
import { refreshThemeFromStorage, setForcedTheme } from '../utils/theme';

export type UseLauncherWindowShownHandlerOptions = {
  hasPersistableView: boolean;

  directLaunchExpansionGuardUntilRef: React.MutableRefObject<number>;
  pendingWindowShownQueryRef: React.MutableRefObject<string | null>;
  popToRootTimeoutMsRef: React.MutableRefObject<number>;
  lastWindowHiddenAtRef: React.MutableRefObject<number>;
  commandsRef: React.MutableRefObject<CommandInfo[]>;
  lastCommandsFetchAtRef: React.MutableRefObject<number>;
  inputRef: React.RefObject<HTMLInputElement>;
  whisperSessionRef: React.MutableRefObject<boolean>;

  expandLauncherForDirectLaunch: () => void;
  requestPendingInlineArgumentFocus: () => void;
  exitAiMode: () => void;
  resetCursorPromptState: () => void;

  fetchCommands: (options?: { showLoading?: boolean }) => void | Promise<void>;
  loadLauncherPreferences: () => void | Promise<void>;

  openWhisper: () => void;
  openSpeak: () => void;
  openCursorPrompt: () => void;
  openClipboardManager: (openedViaShortcut?: boolean) => void;
  openSnippetManager: (mode: 'search' | 'create') => void;
  openNotesSearch: () => void;
  openCanvasSearch: () => void;
  openQuickLinkManager: (mode: 'search' | 'create') => void;
  openFileSearch: () => void;
  openSchedule: () => void;
  openCamera: () => void;
  openOnboarding: () => void;

  setAiAvailable: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedTextSnapshot: React.Dispatch<React.SetStateAction<string>>;
  setMemoryFeedback: React.Dispatch<React.SetStateAction<MemoryFeedback>>;
  setMemoryActionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCursorPrompt: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWhisperHint: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCamera: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWindowManager: React.Dispatch<React.SetStateAction<boolean>>;
  setShowQuickLinkManager: React.Dispatch<React.SetStateAction<'search' | 'create' | null>>;
  setScriptCommandSetup: React.Dispatch<React.SetStateAction<ScriptCommandSetup | null>>;
  setScriptCommandOutput: React.Dispatch<React.SetStateAction<ScriptCommandOutput | null>>;
  setExtensionView: React.Dispatch<React.SetStateAction<ExtensionBundle | null>>;
  setBrowserResultsViewQuery: React.Dispatch<React.SetStateAction<string | null>>;
  setShowSnippetManager: React.Dispatch<React.SetStateAction<'search' | 'create' | null>>;
  setShowFileSearch: React.Dispatch<React.SetStateAction<boolean>>;
  setShowClipboardManager: React.Dispatch<React.SetStateAction<boolean>>;
  setBrowserResultsViewScope: React.Dispatch<React.SetStateAction<BrowserResultsViewScope>>;
  setBrowserHistoryProfileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowActions: React.Dispatch<React.SetStateAction<boolean>>;
  setContextMenu: React.Dispatch<React.SetStateAction<LauncherContextMenuState | null>>;
  setShowNotesSearch: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCanvasSearch: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWhisper: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSpeak: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSchedule: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWhisperOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  setIsCompactCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  refreshBrowserOpenTabs: () => void | Promise<void>;
  refreshBrowserEntries: () => void | Promise<void>;
  refreshBrowserEntriesIfStale: () => void | Promise<void>;
};

export function useLauncherWindowShownHandler(
  options: UseLauncherWindowShownHandlerOptions
): void {
  const {
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
    refreshBrowserOpenTabs,
    refreshBrowserEntries,
    refreshBrowserEntriesIfStale,
  } = options;

  const hasPersistableViewRef = useRef(false);
  hasPersistableViewRef.current = hasPersistableView;

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
          openClipboardManager(true);
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
          refreshBrowserOpenTabs();
          setBrowserResultsViewScope('open-tabs');
          setBrowserResultsViewQuery('');
          return;
        }
        if (routedSystemCommandId === BROWSER_SEARCH_BOOKMARKS_COMMAND_ID) {
          setShowClipboardManager(false);
          setShowSnippetManager(null);
          setShowQuickLinkManager(null);
          setShowFileSearch(false);
          setBrowserResultsViewScope('bookmarks');
          setBrowserResultsViewQuery('');
          refreshBrowserEntriesIfStale();
          return;
        }
        if (routedSystemCommandId === BROWSER_SEARCH_HISTORY_COMMAND_ID) {
          setShowClipboardManager(false);
          setShowSnippetManager(null);
          setShowQuickLinkManager(null);
          setShowFileSearch(false);
          setBrowserHistoryProfileMenuOpen(false);
          setBrowserResultsViewScope('history');
          setBrowserResultsViewQuery('');
          refreshBrowserEntriesIfStale();
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
      // Snippets, File Search, etc.) is open, keep it alive - don't reset.
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
      // Focus synchronously before any IO - a keystroke arriving back-to-back
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
  }, [
    commandsRef,
    directLaunchExpansionGuardUntilRef,
    exitAiMode,
    expandLauncherForDirectLaunch,
    fetchCommands,
    inputRef,
    lastCommandsFetchAtRef,
    lastWindowHiddenAtRef,
    loadLauncherPreferences,
    openCamera,
    openCanvasSearch,
    openClipboardManager,
    openCursorPrompt,
    openFileSearch,
    openNotesSearch,
    openOnboarding,
    openQuickLinkManager,
    openSchedule,
    openSnippetManager,
    openSpeak,
    openWhisper,
    pendingWindowShownQueryRef,
    popToRootTimeoutMsRef,
    refreshBrowserEntries,
    refreshBrowserEntriesIfStale,
    refreshBrowserOpenTabs,
    requestPendingInlineArgumentFocus,
    resetCursorPromptState,
    setAiAvailable,
    setBrowserHistoryProfileMenuOpen,
    setBrowserResultsViewQuery,
    setBrowserResultsViewScope,
    setContextMenu,
    setExtensionView,
    setIsCompactCollapsed,
    setMemoryActionLoading,
    setMemoryFeedback,
    setScriptCommandOutput,
    setScriptCommandSetup,
    setSearchQuery,
    setSelectedIndex,
    setSelectedTextSnapshot,
    setShowActions,
    setShowCamera,
    setShowCanvasSearch,
    setShowClipboardManager,
    setShowCursorPrompt,
    setShowFileSearch,
    setShowNotesSearch,
    setShowQuickLinkManager,
    setShowSchedule,
    setShowSnippetManager,
    setShowSpeak,
    setShowWhisper,
    setShowWhisperHint,
    setShowWhisperOnboarding,
    setShowWindowManager,
    whisperSessionRef,
  ]);
}
