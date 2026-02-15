/**
 * useWhisperManager.ts
 *
 * State and portal management for the Whisper speech-to-text overlay.
 * - whisperSessionRef: true while a whisper session is active (used to suppress
 *   launcher reset logic that would otherwise fire on window-shown)
 * - whisperOnboardingPracticeText / appendWhisperOnboardingPracticeText: accumulates
 *   transcribed text for the onboarding practice screen
 * - whisperSpeakToggleLabel: label shown on the whisper/speak mode toggle button
 * - whisperPortalTarget / whisperOnboardingPortalTarget: detached portal windows
 *   for the whisper and whisper-onboarding overlays (via useDetachedPortalWindow)
 *
 * Listens for whisper-stop-and-close, whisper-start-listening, whisper-stop-listening,
 * whisper-toggle-listening IPC events and syncs overlay visibility accordingly.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useDetachedPortalWindow } from '../useDetachedPortalWindow';

// ─── Types ───────────────────────────────────────────────────────────

export interface UseWhisperManagerOptions {
  showWhisper: boolean;
  setShowWhisper: (value: boolean) => void;
  showWhisperOnboarding: boolean;
  setShowWhisperOnboarding: (value: boolean) => void;
  showWhisperHint: boolean;
  setShowWhisperHint: (value: boolean) => void;
}

export interface UseWhisperManagerReturn {
  whisperOnboardingPracticeText: string;
  setWhisperOnboardingPracticeText: (value: string) => void;
  whisperSpeakToggleLabel: string;
  setWhisperSpeakToggleLabel: (value: string) => void;
  whisperSessionRef: React.MutableRefObject<boolean>;
  appendWhisperOnboardingPracticeText: (chunk: string) => void;
  whisperPortalTarget: HTMLElement | null;
  whisperOnboardingPortalTarget: HTMLElement | null;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useWhisperManager({
  showWhisper,
  setShowWhisper,
  showWhisperOnboarding,
  setShowWhisperOnboarding,
  showWhisperHint,
  setShowWhisperHint,
}: UseWhisperManagerOptions): UseWhisperManagerReturn {
  const [whisperOnboardingPracticeText, setWhisperOnboardingPracticeText] = useState('');
  const [whisperSpeakToggleLabel, setWhisperSpeakToggleLabel] = useState('\u2318 .');

  const whisperSessionRef = useRef(false);

  // ── Portals ────────────────────────────────────────────────────────

  const whisperPortalTarget = useDetachedPortalWindow(showWhisper, {
    name: 'supercmd-whisper-window',
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
    name: 'supercmd-whisper-onboarding-window',
    title: 'SuperCmd Whisper Onboarding',
    width: 920,
    height: 640,
    anchor: 'center',
    onClosed: () => {
      setShowWhisperOnboarding(false);
    },
  });

  // ── Effects ────────────────────────────────────────────────────────

  // Sync detached overlay state
  useEffect(() => {
    window.electron.setDetachedOverlayState('whisper', showWhisper);
  }, [showWhisper]);

  // Auto-hide whisper hint after 7 seconds
  useEffect(() => {
    if (!showWhisperHint || !showWhisper) return;
    const timer = window.setTimeout(() => setShowWhisperHint(false), 7000);
    return () => window.clearTimeout(timer);
  }, [showWhisperHint, showWhisper]);

  // ── Callbacks ──────────────────────────────────────────────────────

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

  return {
    whisperOnboardingPracticeText,
    setWhisperOnboardingPracticeText,
    whisperSpeakToggleLabel,
    setWhisperSpeakToggleLabel,
    whisperSessionRef,
    appendWhisperOnboardingPracticeText,
    whisperPortalTarget,
    whisperOnboardingPortalTarget,
  };
}
