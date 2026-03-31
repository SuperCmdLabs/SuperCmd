/**
 * useAppViewManager.ts
 *
 * Central view-state machine for the launcher. Owns every boolean/object flag
 * that determines which screen is shown (extension, preference setup, script
 * command setup/output, clipboard, snippets, quick links, file search, cursor prompt,
 * whisper, speak, camera, schedule, onboarding, AI mode).
 *
 * Key exports:
 * - resetAllViews(): sets all view flags back to their default (hidden) state
 * - open*() transition functions: each calls resetAllViews() first, then
 *   activates the target view — guarantees only one view is ever visible
 * - Individual setters exposed for rare partial updates
 *
 * App.tsx wires the returned values to child components; nothing else should
 * manage top-level view visibility directly.
 */

import { useState, useCallback } from 'react';
import type { ExtensionBundle, CommandInfo } from '../../types/electron';

export interface ExtensionPreferenceSetup {
  bundle: ExtensionBundle;
  values: Record<string, any>;
  argumentValues: Record<string, any>;
}

export interface ScriptCommandSetup {
  command: CommandInfo;
  values: Record<string, any>;
}

export interface ScriptCommandOutput {
  command: CommandInfo;
  output: string;
  exitCode: number;
}

export interface AppViewManager {
  // View state
  extensionView: ExtensionBundle | null;
  extensionPreferenceSetup: ExtensionPreferenceSetup | null;
  scriptCommandSetup: ScriptCommandSetup | null;
  scriptCommandOutput: ScriptCommandOutput | null;
  showClipboardManager: boolean;
  showSnippetManager: 'search' | 'create' | null;
  showNotesSearch: boolean;
  showCanvasSearch: boolean;
  showQuickLinkManager: 'search' | 'create' | null;
  showFileSearch: boolean;
  showCursorPrompt: boolean;
  showWhisper: boolean;
  showSpeak: boolean;
  showCamera: boolean;
  showSchedule: boolean;
  showWindowManager: boolean;
  showWhisperOnboarding: boolean;
  showWhisperHint: boolean;
  showOnboarding: boolean;
  aiMode: boolean;

  // Reset all views to defaults
  resetAllViews: () => void;

  // Transition functions (each resets other views first)
  openExtensionView: (bundle: ExtensionBundle) => void;
  openExtensionPreferenceSetup: (setup: ExtensionPreferenceSetup) => void;
  openScriptCommandSetup: (setup: ScriptCommandSetup) => void;
  openScriptCommandOutput: (output: ScriptCommandOutput) => void;
  openClipboardManager: () => void;
  openSnippetManager: (mode: 'search' | 'create') => void;
  openNotesSearch: () => void;
  openCanvasSearch: () => void;
  openQuickLinkManager: (mode: 'search' | 'create') => void;
  openFileSearch: () => void;
  openCursorPrompt: () => void;
  openWhisper: () => void;
  openSpeak: () => void;
  openCamera: () => void;
  openSchedule: () => void;
  openWindowManager: () => void;
  openWhisperOnboarding: () => void;
  openOnboarding: () => void;
  openAiMode: () => void;
  closeCurrentView: () => void;

  // Individual setters for partial updates (used when only one flag changes)
  setExtensionView: React.Dispatch<React.SetStateAction<ExtensionBundle | null>>;
  setExtensionPreferenceSetup: React.Dispatch<React.SetStateAction<ExtensionPreferenceSetup | null>>;
  setScriptCommandSetup: React.Dispatch<React.SetStateAction<ScriptCommandSetup | null>>;
  setScriptCommandOutput: React.Dispatch<React.SetStateAction<ScriptCommandOutput | null>>;
  setShowClipboardManager: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSnippetManager: React.Dispatch<React.SetStateAction<'search' | 'create' | null>>;
  setShowNotesSearch: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCanvasSearch: React.Dispatch<React.SetStateAction<boolean>>;
  setShowQuickLinkManager: React.Dispatch<React.SetStateAction<'search' | 'create' | null>>;
  setShowFileSearch: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCursorPrompt: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWhisper: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSpeak: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCamera: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSchedule: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWindowManager: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWhisperOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWhisperHint: React.Dispatch<React.SetStateAction<boolean>>;
  setShowOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
  setAiMode: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useAppViewManager(): AppViewManager {
  const [extensionView, setExtensionView] = useState<ExtensionBundle | null>(null);
  const [extensionPreferenceSetup, setExtensionPreferenceSetup] = useState<ExtensionPreferenceSetup | null>(null);
  const [scriptCommandSetup, setScriptCommandSetup] = useState<ScriptCommandSetup | null>(null);
  const [scriptCommandOutput, setScriptCommandOutput] = useState<ScriptCommandOutput | null>(null);
  const [showClipboardManager, setShowClipboardManager] = useState(false);
  const [showSnippetManager, setShowSnippetManager] = useState<'search' | 'create' | null>(null);
  const [showNotesSearch, setShowNotesSearch] = useState(false);
  const [showCanvasSearch, setShowCanvasSearch] = useState(false);
  const [showQuickLinkManager, setShowQuickLinkManager] = useState<'search' | 'create' | null>(null);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [showCursorPrompt, setShowCursorPrompt] = useState(false);
  const [showWhisper, setShowWhisper] = useState(false);
  const [showSpeak, setShowSpeak] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showWindowManager, setShowWindowManager] = useState(false);
  const [showWhisperOnboarding, setShowWhisperOnboarding] = useState(false);
  const [showWhisperHint, setShowWhisperHint] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [aiMode, setAiMode] = useState(false);

  const resetAllViews = useCallback(() => {
    setExtensionView(null);
    setExtensionPreferenceSetup(null);
    setScriptCommandSetup(null);
    setScriptCommandOutput(null);
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
    setShowWindowManager(false);
    setShowWhisperOnboarding(false);
    setShowWhisperHint(false);
    setShowOnboarding(false);
    setAiMode(false);
  }, []);

  const openExtensionView = useCallback((bundle: ExtensionBundle) => {
    resetAllViews();
    setExtensionView(bundle);
  }, [resetAllViews]);

  const openExtensionPreferenceSetup = useCallback((setup: ExtensionPreferenceSetup) => {
    resetAllViews();
    setExtensionPreferenceSetup(setup);
  }, [resetAllViews]);

  const openScriptCommandSetup = useCallback((setup: ScriptCommandSetup) => {
    resetAllViews();
    setScriptCommandSetup(setup);
  }, [resetAllViews]);

  const openScriptCommandOutput = useCallback((output: ScriptCommandOutput) => {
    resetAllViews();
    setScriptCommandOutput(output);
  }, [resetAllViews]);

  const openClipboardManager = useCallback(() => {
    resetAllViews();
    setShowClipboardManager(true);
  }, [resetAllViews]);

  const openSnippetManager = useCallback((mode: 'search' | 'create') => {
    resetAllViews();
    setShowSnippetManager(mode);
  }, [resetAllViews]);

  const openNotesSearch = useCallback(() => {
    resetAllViews();
    setShowNotesSearch(true);
  }, [resetAllViews]);

  const openCanvasSearch = useCallback(() => {
    resetAllViews();
    setShowCanvasSearch(true);
  }, [resetAllViews]);

  const openQuickLinkManager = useCallback((mode: 'search' | 'create') => {
    resetAllViews();
    setShowQuickLinkManager(mode);
  }, [resetAllViews]);

  const openFileSearch = useCallback(() => {
    resetAllViews();
    setShowFileSearch(true);
  }, [resetAllViews]);

  const openCursorPrompt = useCallback(() => {
    resetAllViews();
    setShowCursorPrompt(true);
  }, [resetAllViews]);

  const openWhisper = useCallback(() => {
    resetAllViews();
    setShowWhisper(true);
    setShowWhisperHint(true);
  }, [resetAllViews]);

  const openSpeak = useCallback(() => {
    resetAllViews();
    setShowSpeak(true);
  }, [resetAllViews]);

  const openCamera = useCallback(() => {
    resetAllViews();
    setShowCamera(true);
  }, [resetAllViews]);

  const openSchedule = useCallback(() => {
    resetAllViews();
    setShowSchedule(true);
  }, [resetAllViews]);

  const openWindowManager = useCallback(() => {
    resetAllViews();
    setShowWindowManager(true);
  }, [resetAllViews]);

  const openWhisperOnboarding = useCallback(() => {
    // Whisper onboarding co-exists with whisper
    setShowWhisperOnboarding(true);
  }, []);

  const openOnboarding = useCallback(() => {
    resetAllViews();
    setShowOnboarding(true);
  }, [resetAllViews]);

  const openAiMode = useCallback(() => {
    resetAllViews();
    setAiMode(true);
  }, [resetAllViews]);

  const closeCurrentView = useCallback(() => {
    resetAllViews();
  }, [resetAllViews]);

  return {
    extensionView,
    extensionPreferenceSetup,
    scriptCommandSetup,
    scriptCommandOutput,
    showClipboardManager,
    showSnippetManager,
    showNotesSearch,
    showCanvasSearch,
    showQuickLinkManager,
    showFileSearch,
    showCursorPrompt,
    showWhisper,
    showSpeak,
    showCamera,
    showSchedule,
    showWindowManager,
    showWhisperOnboarding,
    showWhisperHint,
    showOnboarding,
    aiMode,

    resetAllViews,

    openExtensionView,
    openExtensionPreferenceSetup,
    openScriptCommandSetup,
    openScriptCommandOutput,
    openClipboardManager,
    openSnippetManager,
    openNotesSearch,
    openCanvasSearch,
    openQuickLinkManager,
    openFileSearch,
    openCursorPrompt,
    openWhisper,
    openSpeak,
    openCamera,
    openSchedule,
    openWindowManager,
    openWhisperOnboarding,
    openOnboarding,
    openAiMode,
    closeCurrentView,

    setExtensionView,
    setExtensionPreferenceSetup,
    setScriptCommandSetup,
    setScriptCommandOutput,
    setShowClipboardManager,
    setShowSnippetManager,
    setShowNotesSearch,
    setShowCanvasSearch,
    setShowQuickLinkManager,
    setShowFileSearch,
    setShowCursorPrompt,
    setShowWhisper,
    setShowSpeak,
    setShowCamera,
    setShowSchedule,
    setShowWindowManager,
    setShowWhisperOnboarding,
    setShowWhisperHint,
    setShowOnboarding,
    setAiMode,
  };
}
