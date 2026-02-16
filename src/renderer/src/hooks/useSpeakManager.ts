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

const ELEVENLABS_VOICES: Array<{ id: string; label: string }> = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam' },
];

const DEFAULT_ELEVENLABS_VOICE_ID = ELEVENLABS_VOICES[0].id;

function parseElevenLabsSpeakModel(raw: string): { model: string; voiceId: string } {
  const value = String(raw || '').trim();
  const explicitVoice = /@([A-Za-z0-9]{8,})$/.exec(value)?.[1];
  const modelOnly = explicitVoice ? value.replace(/@[A-Za-z0-9]{8,}$/, '') : value;
  const model = modelOnly.startsWith('elevenlabs-') ? modelOnly : 'elevenlabs-multilingual-v2';
  const voiceId = explicitVoice || DEFAULT_ELEVENLABS_VOICE_ID;
  return { model, voiceId };
}

function buildElevenLabsSpeakModel(model: string, voiceId: string): string {
  const normalizedModel = String(model || '').trim() || 'elevenlabs-multilingual-v2';
  const normalizedVoice = String(voiceId || '').trim() || DEFAULT_ELEVENLABS_VOICE_ID;
  return `${normalizedModel}@${normalizedVoice}`;
}

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
    voice: 'en-US-EricNeural',
    rate: '+0%',
  });
  const [edgeTtsVoices, setEdgeTtsVoices] = useState<EdgeTtsVoice[]>([]);
  const [configuredEdgeTtsVoice, setConfiguredEdgeTtsVoice] = useState('en-US-EricNeural');
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
    const usingElevenLabs = String(configuredTtsModel || '').startsWith('elevenlabs-');
    const targetVoice = usingElevenLabs
      ? parseElevenLabsSpeakModel(configuredTtsModel).voiceId
      : String(configuredEdgeTtsVoice || '').trim();
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
    () => {
      if (String(configuredTtsModel || '').startsWith('elevenlabs-')) {
        return ELEVENLABS_VOICES.map((voice) => ({
          value: voice.id,
          label: `${voice.label} (ElevenLabs)`,
        }));
      }
      return buildReadVoiceOptions(edgeTtsVoices, speakOptions.voice, configuredEdgeTtsVoice);
    },
    [configuredTtsModel, edgeTtsVoices, speakOptions.voice, configuredEdgeTtsVoice]
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
        setSpeakOptions(next);
      } catch {}
      return;
    }

    const next = await window.electron.speakUpdateOptions({
      voice,
      restartCurrent: true,
    });
    setSpeakOptions(next);
  }, [configuredTtsModel]);

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
