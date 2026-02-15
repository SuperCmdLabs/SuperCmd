/**
 * useSpeakManager.ts
 *
 * State and logic for the SuperCmd Read (TTS / speak) overlay.
 * - speakStatus: current playback state (idle → loading → speaking → done/error)
 * - speakOptions: active voice + playback rate selection
 * - edgeTtsVoices / configuredEdgeTtsVoice: Edge TTS voice list and user preference
 * - configuredTtsModel: which TTS backend is active (edge-tts, system, etc.)
 * - readVoiceOptions: memoized list of selectable voices for the UI dropdown
 * - handleSpeakVoiceChange / handleSpeakRateChange: persist user selections to settings
 * - Opens a detached portal window for the speak overlay via useDetachedPortalWindow
 *
 * Polls speak status from the main process while the overlay is visible, and syncs
 * the configured voice from settings each time the overlay opens.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { EdgeTtsVoice } from '../../types/electron';
import { buildReadVoiceOptions, type ReadVoiceOption } from '../utils/command-helpers';
import { useDetachedPortalWindow } from '../useDetachedPortalWindow';

// ─── Types ───────────────────────────────────────────────────────────

export interface SpeakStatus {
  state: 'idle' | 'loading' | 'speaking' | 'done' | 'error';
  text: string;
  index: number;
  total: number;
  message?: string;
  wordIndex?: number;
}

export interface UseSpeakManagerOptions {
  showSpeak: boolean;
  setShowSpeak: (value: boolean) => void;
}

export interface UseSpeakManagerReturn {
  speakStatus: SpeakStatus;
  speakOptions: { voice: string; rate: string };
  edgeTtsVoices: EdgeTtsVoice[];
  configuredEdgeTtsVoice: string;
  configuredTtsModel: string;
  setConfiguredEdgeTtsVoice: (value: string) => void;
  setConfiguredTtsModel: (value: string) => void;
  readVoiceOptions: ReadVoiceOption[];
  handleSpeakVoiceChange: (voice: string) => Promise<void>;
  handleSpeakRateChange: (rate: string) => Promise<void>;
  speakPortalTarget: HTMLElement | null;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useSpeakManager({
  showSpeak,
  setShowSpeak,
}: UseSpeakManagerOptions): UseSpeakManagerReturn {
  const [speakStatus, setSpeakStatus] = useState<SpeakStatus>({
    state: 'idle',
    text: '',
    index: 0,
    total: 0,
  });
  const [speakOptions, setSpeakOptions] = useState<{ voice: string; rate: string }>({
    voice: 'en-US-JennyNeural',
    rate: '+0%',
  });
  const [edgeTtsVoices, setEdgeTtsVoices] = useState<EdgeTtsVoice[]>([]);
  const [configuredEdgeTtsVoice, setConfiguredEdgeTtsVoice] = useState('en-US-JennyNeural');
  const [configuredTtsModel, setConfiguredTtsModel] = useState('edge-tts');

  const speakSessionShownRef = useRef(false);

  // ── Portal ─────────────────────────────────────────────────────────

  const speakPortalTarget = useDetachedPortalWindow(showSpeak, {
    name: 'supercmd-speak-window',
    title: 'SuperCmd Read',
    width: 520,
    height: 112,
    anchor: 'top-right',
    onClosed: () => {
      setShowSpeak(false);
      void window.electron.speakStop();
    },
  });

  // ── Effects ────────────────────────────────────────────────────────

  // Sync detached overlay state
  useEffect(() => {
    window.electron.setDetachedOverlayState('speak', showSpeak);
  }, [showSpeak]);

  // Initial speak options & status load + onSpeakStatus listener
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

  // Edge TTS voice list fetch
  useEffect(() => {
    let disposed = false;
    window.electron.edgeTtsListVoices()
      .then((voices) => {
        if (disposed || !Array.isArray(voices)) return;
        setEdgeTtsVoices(voices.filter((voice) => String(voice?.id || '').trim()));
      })
      .catch(() => {
        if (!disposed) setEdgeTtsVoices([]);
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Auto-sync configured voice when speak view opens
  useEffect(() => {
    if (!showSpeak) {
      speakSessionShownRef.current = false;
      return;
    }
    if (speakSessionShownRef.current) return;
    speakSessionShownRef.current = true;
    if (configuredTtsModel !== 'edge-tts') return;
    const targetVoice = String(configuredEdgeTtsVoice || '').trim();
    if (!targetVoice || targetVoice === speakOptions.voice) return;
    window.electron.speakUpdateOptions({
      voice: targetVoice,
      restartCurrent: true,
    }).then((next) => {
      setSpeakOptions(next);
    }).catch(() => {});
  }, [showSpeak, configuredTtsModel, configuredEdgeTtsVoice, speakOptions.voice]);

  // ── Memos ──────────────────────────────────────────────────────────

  const readVoiceOptions = useMemo(
    () => buildReadVoiceOptions(edgeTtsVoices, speakOptions.voice, configuredEdgeTtsVoice),
    [edgeTtsVoices, speakOptions.voice, configuredEdgeTtsVoice]
  );

  // ── Callbacks ──────────────────────────────────────────────────────

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

  return {
    speakStatus,
    speakOptions,
    edgeTtsVoices,
    configuredEdgeTtsVoice,
    configuredTtsModel,
    setConfiguredEdgeTtsVoice,
    setConfiguredTtsModel,
    readVoiceOptions,
    handleSpeakVoiceChange,
    handleSpeakRateChange,
    speakPortalTarget,
  };
}
