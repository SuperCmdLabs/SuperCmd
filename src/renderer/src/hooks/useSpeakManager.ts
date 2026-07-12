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
 * Listens for speak status updates from the main process, and syncs
 * the configured voice from initial settings plus live settings updates.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { EdgeTtsVoice, ElevenLabsVoice } from '../../types/electron';
import { buildReadVoiceOptions, type ReadVoiceOption } from '../utils/command-helpers';
import { useDetachedPortalWindow } from '../useDetachedPortalWindow';
import {
  clearElevenLabsVoiceCache,
  getCachedElevenLabsVoices,
  setCachedElevenLabsVoices,
} from '../utils/voice-cache';
import {
  applySpeakSettings,
  buildElevenLabsSpeakModel,
  DEFAULT_EDGE_TTS_VOICE,
  DEFAULT_ELEVENLABS_VOICE_ID,
  DEFAULT_TTS_MODEL,
  parseElevenLabsSpeakModel,
  type SpeakOptions,
  type SpeakSettingsSnapshot,
} from '../utils/speak-settings-sync';

const ELEVENLABS_VOICES: Array<{ id: string; label: string }> = [
  { id: DEFAULT_ELEVENLABS_VOICE_ID, label: 'Rachel' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam' },
];

// ─── Types ───────────────────────────────────────────────────────────

export interface SpeakStatus {
  state: 'idle' | 'loading' | 'speaking' | 'paused' | 'done' | 'error';
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
  speakOptions: SpeakOptions;
  edgeTtsVoices: EdgeTtsVoice[];
  configuredEdgeTtsVoice: string;
  configuredTtsModel: string;
  setConfiguredEdgeTtsVoice: (value: string) => void;
  setConfiguredTtsModel: (value: string) => void;
  readVoiceOptions: ReadVoiceOption[];
  handleSpeakVoiceChange: (voice: string) => Promise<void>;
  handleSpeakRateChange: (rate: string) => Promise<void>;
  handleSpeakTogglePause: () => Promise<void>;
  handleSpeakPreviousParagraph: () => Promise<void>;
  handleSpeakNextParagraph: () => Promise<void>;
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
  const [speakOptions, setSpeakOptions] = useState<SpeakOptions>({
    voice: DEFAULT_EDGE_TTS_VOICE,
    rate: '+0%',
  });
  const [edgeTtsVoices, setEdgeTtsVoices] = useState<EdgeTtsVoice[]>([]);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [configuredEdgeTtsVoice, setConfiguredEdgeTtsVoice] = useState(DEFAULT_EDGE_TTS_VOICE);
  const [configuredTtsModel, setConfiguredTtsModel] = useState(DEFAULT_TTS_MODEL);

  const speakOptionsVoiceRef = useRef(speakOptions.voice);
  const speakSessionShownRef = useRef(false);
  const pauseToggleInFlightRef = useRef(false);

  const applySpeakOptions = useCallback((next: SpeakOptions) => {
    speakOptionsVoiceRef.current = next.voice;
    setSpeakOptions(next);
  }, []);

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
      if (!disposed && options) applySpeakOptions(options);
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
  }, [applySpeakOptions]);

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

  // ElevenLabs custom voice list fetch (with shared cache)
  useEffect(() => {
    let disposed = false;
    // Only fetch when using ElevenLabs
    if (!String(configuredTtsModel || '').startsWith('elevenlabs-')) {
      setElevenLabsVoices([]);
      return;
    }
    
    // Check shared cache first
    const cached = getCachedElevenLabsVoices();
    if (cached) {
      setElevenLabsVoices(cached);
      return;
    }
    
    window.electron.elevenLabsListVoices()
      .then((result) => {
        if (disposed) return;
        if (result.error) {
          clearElevenLabsVoiceCache();
          setElevenLabsVoices([]);
          return;
        }
        const nextVoices = Array.isArray(result.voices) ? result.voices : [];
        setElevenLabsVoices(nextVoices);
        // Update shared cache only with non-empty successful results.
        setCachedElevenLabsVoices(nextVoices);
      })
      .catch(() => {
        if (!disposed) {
          clearElevenLabsVoiceCache();
          setElevenLabsVoices([]);
        }
      });
    return () => {
      disposed = true;
    };
  }, [configuredTtsModel]);

  // Sync configured voice from initial settings and live settings updates
  useEffect(() => {
    let disposed = false;
    const syncFromSettings = (settings: SpeakSettingsSnapshot | null | undefined) => {
      void applySpeakSettings(settings, {
        getCurrentVoice: () => speakOptionsVoiceRef.current,
        setConfiguredTtsModel,
        setConfiguredEdgeTtsVoice,
        updateSpeakOptions: (patch) => window.electron.speakUpdateOptions(patch),
        setSpeakOptions: applySpeakOptions,
        isDisposed: () => disposed,
      }).catch(() => {});
    };

    window.electron.getSettings().then(syncFromSettings).catch(() => {});
    const cleanupSettings = window.electron.onSettingsUpdated?.((settings) => {
      syncFromSettings(settings);
    });

    return () => {
      disposed = true;
      cleanupSettings?.();
    };
  }, [applySpeakOptions]);

  // Auto-sync configured voice when speak view opens
  useEffect(() => {
    if (!showSpeak) {
      speakSessionShownRef.current = false;
      return;
    }
    if (speakSessionShownRef.current) return;
    speakSessionShownRef.current = true;
    const usingElevenLabs = String(configuredTtsModel || '').startsWith('elevenlabs-');
    const targetVoice = usingElevenLabs
      ? parseElevenLabsSpeakModel(configuredTtsModel).voiceId
      : String(configuredEdgeTtsVoice || '').trim();
    if (!targetVoice || targetVoice === speakOptions.voice) return;
    window.electron.speakUpdateOptions({
      voice: targetVoice,
      restartCurrent: true,
    }).then((next) => {
      applySpeakOptions(next);
    }).catch(() => {});
  }, [showSpeak, configuredTtsModel, configuredEdgeTtsVoice, speakOptions.voice, applySpeakOptions]);

  // ── Memos ──────────────────────────────────────────────────────────

  const readVoiceOptions = useMemo(
    () => {
      if (String(configuredTtsModel || '').startsWith('elevenlabs-')) {
        // Start with built-in voices
        const builtInOptions = ELEVENLABS_VOICES.map((voice) => ({
          value: voice.id,
          label: voice.label, // Short label for widget
        }));

        // Add custom voices from ElevenLabs account - use short name only
        const customVoices = elevenLabsVoices
          .filter((v) => !ELEVENLABS_VOICES.some((bv) => bv.id === v.id))
          .map((voice) => {
            // Extract just the name (remove description after " - ")
            const shortName = voice.name.split(' - ')[0].trim();
            return {
              value: voice.id,
              label: shortName,
            };
          });

        return [...builtInOptions, ...customVoices];
      }
      return buildReadVoiceOptions(edgeTtsVoices, speakOptions.voice, configuredEdgeTtsVoice);
    },
    [configuredTtsModel, edgeTtsVoices, elevenLabsVoices, speakOptions.voice, configuredEdgeTtsVoice]
  );

  // ── Callbacks ──────────────────────────────────────────────────────

  const handleSpeakVoiceChange = useCallback(async (voice: string) => {
    if (String(configuredTtsModel || '').startsWith('elevenlabs-')) {
      try {
        const settings = await window.electron.getSettings();
        const parsed = parseElevenLabsSpeakModel(settings.ai?.textToSpeechModel || configuredTtsModel);
        const nextModel = buildElevenLabsSpeakModel(parsed.model, voice);
        const updated = await window.electron.saveSettings({
          ai: { ...settings.ai, textToSpeechModel: nextModel },
        } as any);
        const updatedModel = String(updated.ai?.textToSpeechModel || nextModel);
        setConfiguredTtsModel(updatedModel);
        const next = await window.electron.speakUpdateOptions({
          voice,
          restartCurrent: true,
        });
        applySpeakOptions(next);
      } catch {}
      return;
    }

    // Edge TTS: save to settings and update runtime
    try {
      const settings = await window.electron.getSettings();
      const updated = await window.electron.saveSettings({
        ai: { ...settings.ai, edgeTtsVoice: voice },
      } as any);
      setConfiguredEdgeTtsVoice(String(updated.ai?.edgeTtsVoice || voice));
      const next = await window.electron.speakUpdateOptions({
        voice,
        restartCurrent: true,
      });
      applySpeakOptions(next);
    } catch {}
  }, [configuredTtsModel, applySpeakOptions]);

  const handleSpeakRateChange = useCallback(async (rate: string) => {
    const next = await window.electron.speakUpdateOptions({
      rate,
      restartCurrent: true,
    });
    applySpeakOptions(next);
  }, [applySpeakOptions]);

  const handleSpeakTogglePause = useCallback(async () => {
    if (pauseToggleInFlightRef.current) return;
    pauseToggleInFlightRef.current = true;
    try {
      setSpeakStatus((prev) => {
        if (prev.state === 'speaking') {
          return { ...prev, state: 'paused', message: 'Paused' };
        }
        if (prev.state === 'paused') {
          return { ...prev, state: 'speaking', message: '' };
        }
        return prev;
      });
      const next = await window.electron.speakTogglePause();
      if (next?.status) {
        setSpeakStatus(next.status);
      }
    } catch {}
    finally {
      pauseToggleInFlightRef.current = false;
    }
  }, []);

  const handleSpeakPreviousParagraph = useCallback(async () => {
    try {
      await window.electron.speakPreviousParagraph();
    } catch {}
  }, []);

  const handleSpeakNextParagraph = useCallback(async () => {
    try {
      await window.electron.speakNextParagraph();
    } catch {}
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
    handleSpeakTogglePause,
    handleSpeakPreviousParagraph,
    handleSpeakNextParagraph,
    speakPortalTarget,
  };
}
