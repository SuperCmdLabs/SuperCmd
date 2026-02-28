import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatShortcutForDisplay } from './utils/hyper-key';

interface SuperCmdWhisperProps {
  onClose: () => void;
  portalTarget?: HTMLElement | null;
  onboardingCaptureMode?: boolean;
  onOnboardingTranscriptAppend?: (text: string) => void;
  coachmarkText?: string;
}

type WhisperState = 'idle' | 'listening' | 'processing' | 'error';

// 'whisper' = OpenAI Whisper API (needs API key)
// 'native'  = macOS SFSpeechRecognizer (no API key needed, like Chrome)
type WhisperBackend = 'whisper' | 'native';
type NativeFlushReason = 'timer' | 'silence' | 'final' | 'stop' | 'ended';
type NativeQueuedSuffix = { text: string; attempts: number; reason: NativeFlushReason };

const BAR_HEIGHT_PROFILE = [
  0.45, 0.62, 0.52, 0.58, 0.74, 0.7, 1.0, 0.7, 0.58, 0.52, 0.74, 0.62, 0.45,
];
const BAR_COUNT = BAR_HEIGHT_PROFILE.length;
const BASE_WAVE = BAR_HEIGHT_PROFILE.map((profile) => 0.08 + profile * 0.05);
const LIVE_REFINE_DEBOUNCE_MS = 1000;
const NATIVE_PROCESS_DEBOUNCE_MS = 1000;
const NATIVE_SILENCE_FLUSH_MS = 60_000;
const NATIVE_SILENCE_POLL_MS = 1000;
const NATIVE_MAX_TYPE_RETRIES = 2;
const NATIVE_FINAL_DRAIN_TIMEOUT_MS = 3000;
const PUSH_TO_TALK_MODE = true;

function formatShortcutLabel(shortcut: string): string {
  return formatShortcutForDisplay(shortcut).replace(/ \+ /g, ' ');
}

function normalizeTranscript(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[`"'"\u201C\u201D]+|[`"'"\u201C\u201D]+$/g, '')
    .trim();
}

function mergeTranscriptChunks(existing: string, incoming: string): string {
  const prev = normalizeTranscript(existing);
  const next = normalizeTranscript(incoming);
  if (!prev) return next;
  if (!next) return prev;
  if (prev === next) return prev;
  if (next.startsWith(prev) || next.includes(prev)) return next;
  if (prev.startsWith(next)) return prev;

  const prevWords = prev.split(/\s+/);
  const nextWords = next.split(/\s+/);
  const maxOverlap = Math.min(14, prevWords.length, nextWords.length);

  let overlap = 0;
  for (let size = maxOverlap; size >= 1; size -= 1) {
    const prevTail = prevWords.slice(prevWords.length - size).join(' ').toLowerCase();
    const nextHead = nextWords.slice(0, size).join(' ').toLowerCase();
    if (prevTail === nextHead) {
      overlap = size;
      break;
    }
  }

  if (overlap > 0) {
    return normalizeTranscript(`${prevWords.join(' ')} ${nextWords.slice(overlap).join(' ')}`);
  }

  return normalizeTranscript(`${prev} ${next}`);
}

function computeAppendOnlyDelta(previous: string, next: string): string {
  const prev = normalizeTranscript(previous);
  const curr = normalizeTranscript(next);
  if (!curr) return '';
  if (!prev) return curr;
  if (curr === prev) return '';
  if (curr.startsWith(prev)) {
    return curr.slice(prev.length);
  }
  const lowerPrev = prev.toLowerCase();
  const lowerCurr = curr.toLowerCase();
  const exactIdx = lowerCurr.lastIndexOf(lowerPrev);
  if (exactIdx >= 0) {
    return curr.slice(exactIdx + prev.length);
  }

  const prevWords = prev.split(/\s+/);
  const currWords = curr.split(/\s+/);
  const maxOverlap = Math.min(16, prevWords.length, currWords.length);
  for (let size = maxOverlap; size >= 1; size -= 1) {
    const prevTail = prevWords.slice(prevWords.length - size).join(' ').toLowerCase();
    for (let start = 0; start <= currWords.length - size; start += 1) {
      const currSegment = currWords.slice(start, start + size).join(' ').toLowerCase();
      if (prevTail === currSegment) {
        return normalizeTranscript(currWords.slice(start + size).join(' '));
      }
    }
  }

  // If model rewrote earlier words, do not replay full text.
  return '';
}

function extractStrictSuffix(previousRaw: string, nextRaw: string): string {
  const prev = normalizeTranscript(previousRaw);
  const next = normalizeTranscript(nextRaw);
  if (!next) return '';
  if (!prev) return next;
  if (next === prev) return '';

  if (next.startsWith(prev)) {
    return normalizeTranscript(next.slice(prev.length));
  }

  const prevWords = prev.split(/\s+/);
  const nextWords = next.split(/\s+/);
  const maxOverlap = Math.min(24, prevWords.length, nextWords.length);
  for (let size = maxOverlap; size >= 2; size -= 1) {
    const prevTail = prevWords.slice(prevWords.length - size).join(' ').toLowerCase();
    const nextHead = nextWords.slice(0, size).join(' ').toLowerCase();
    if (prevTail === nextHead) {
      return normalizeTranscript(nextWords.slice(size).join(' '));
    }
  }

  // Ambiguous rewrite: do not replay.
  return '';
}

function formatDeltaForAppend(previous: string, rawDelta: string): string {
  const prev = String(previous || '');
  const delta = String(rawDelta || '');
  if (!delta.trim()) return '';

  let next = delta;
  const prevTrimEnd = prev.replace(/\s+$/g, '');
  const deltaTrimStart = delta.replace(/^\s+/g, '');
  const lastPrevChar = prevTrimEnd.slice(-1);
  const firstDeltaChar = deltaTrimStart.charAt(0);

  const prevEndsWord = /[A-Za-z0-9)]/.test(lastPrevChar);
  const deltaStartsWord = /[A-Za-z0-9(]/.test(firstDeltaChar);
  const deltaStartsUpper = /[A-Z]/.test(firstDeltaChar);
  const prevHasSentenceEnd = /[.!?]$/.test(prevTrimEnd);
  const deltaHasLeadingSpace = /^\s/.test(delta);

  // If AI starts a new sentence but didn't add terminal punctuation before it,
  // synthesize ". " at the boundary.
  if (prevTrimEnd && prevEndsWord && deltaStartsUpper && !prevHasSentenceEnd) {
    next = `. ${deltaTrimStart}`;
    return next;
  }

  // Otherwise ensure at least one word boundary space when appending words.
  if (prevTrimEnd && prevEndsWord && deltaStartsWord && !deltaHasLeadingSpace) {
    next = ` ${deltaTrimStart}`;
    return next;
  }

  return next;
}

const SuperCmdWhisper: React.FC<SuperCmdWhisperProps> = ({
  onClose,
  portalTarget,
  onboardingCaptureMode = false,
  onOnboardingTranscriptAppend,
  coachmarkText,
}) => {
  const [state, setState] = useState<WhisperState>('idle');
  const [statusText, setStatusText] = useState('Press start to begin speaking.');
  const [errorText, setErrorText] = useState('');
  const [waveBars, setWaveBars] = useState<number[]>(BASE_WAVE);
  const [speechLanguage, setSpeechLanguage] = useState('en-US');
  const [speakToggleShortcutLabel, setSpeakToggleShortcutLabel] = useState('\u2318 .');
  const speakToggleShortcutRef = useRef('Fn');

  // Which backend to use — determined on settings load
  const backendRef = useRef<WhisperBackend>('native');

  const combinedTranscriptRef = useRef('');
  const liveTypedTextRef = useRef('');
  const liveTypeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const finalizingRef = useRef(false);
  const editorFocusRestoreTimerRef = useRef<number | null>(null);
  const editorFocusRestoredRef = useRef(false);
  const liveRefineTimerRef = useRef<number | null>(null);
  const liveRefineSeqRef = useRef(0);
  const lastDebouncedRefineInputRef = useRef('');
  const barNoiseRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));
  const cueAudioCtxRef = useRef<AudioContext | null>(null);

  // Audio visualizer refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  // MediaRecorder refs (Whisper API backend)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recorderMimeTypeRef = useRef('audio/webm');
  const lastTranscribedChunkCountRef = useRef(0);
  const periodicTimerRef = useRef<number | null>(null);
  const transcribeInFlightRef = useRef(false);
  const startRequestSeqRef = useRef(0);
  const whisperStateRef = useRef<WhisperState>('idle');
  const startInFlightRef = useRef(false);

  // Native backend refs
  const nativeChunkDisposerRef = useRef<(() => void) | null>(null);
  const nativeProcessTimerRef = useRef<number | null>(null);
  const nativeSilenceTimerRef = useRef<number | null>(null);
  const nativeLastTranscriptAtRef = useRef(0);
  const nativeProcessEndedRef = useRef(false);
  const nativeRawAnchorRef = useRef('');
  const nativeLastQueuedSuffixRef = useRef('');
  const nativeCurrentPartialRef = useRef('');
  const nativeFlushQueueRef = useRef<NativeQueuedSuffix[]>([]);
  const nativeFlushInFlightRef = useRef(false);
  const pushToTalkArmedRef = useRef(false);

  // ─── Audio Visualizer ──────────────────────────────────────────────

  const stopVisualizer = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch {}
      sourceNodeRef.current = null;
    }

    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch {}
      analyserRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    barNoiseRef.current = Array.from({ length: BAR_COUNT }, () => 0);
    setWaveBars(BASE_WAVE);
  }, []);

  const startVisualizer = useCallback((stream: MediaStream) => {
    const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor() as AudioContext;
    if (audioContext.state === 'suspended') {
      void audioContext.resume().catch(() => {});
    }
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.84;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    mediaStreamRef.current = stream;
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    sourceNodeRef.current = source;

    const frame = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!analyserRef.current) return;

      analyserRef.current.getByteTimeDomainData(frame);
      let sumSquares = 0;
      for (let i = 0; i < frame.length; i += 1) {
        const normalized = (frame[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / frame.length);
      const energy = Math.min(1, rms * 8.5);

      setWaveBars((previous) =>
        previous.map((prev, index) => {
          const profile = BAR_HEIGHT_PROFILE[index];
          const previousNoise = barNoiseRef.current[index] || 0;
          const nextNoise = Math.max(-1, Math.min(1, previousNoise * 0.76 + ((Math.random() * 2) - 1) * 0.38));
          barNoiseRef.current[index] = nextNoise;

          const jitter = nextNoise * 0.18;
          const shapedEnergy = energy * (0.32 + profile * 0.7);
          const target = Math.max(0.04, Math.min(1, 0.08 + profile * 0.1 + shapedEnergy + jitter));
          return prev * 0.62 + target * 0.38;
        })
      );

      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
  }, []);

  const restoreEditorFocusOnce = useCallback((delayMs = 0) => {
    // Onboarding whisper practice is intentionally in-app; never steal focus
    // to another app while the user is typing in the onboarding editor.
    if (onboardingCaptureMode) return;
    if (editorFocusRestoredRef.current) return;
    editorFocusRestoredRef.current = true;
    const run = () => {
      void window.electron.restoreLastFrontmostApp().catch(() => false);
    };
    if (delayMs > 0) {
      if (editorFocusRestoreTimerRef.current !== null) {
        window.clearTimeout(editorFocusRestoreTimerRef.current);
      }
      editorFocusRestoreTimerRef.current = window.setTimeout(() => {
        editorFocusRestoreTimerRef.current = null;
        run();
      }, delayMs);
      return;
    }
    run();
  }, [onboardingCaptureMode]);

  const playRecordingCue = useCallback((kind: 'start' | 'end') => {
    try {
      const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = cueAudioCtxRef.current || new AudioContextCtor();
      cueAudioCtxRef.current = ctx as AudioContext;
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime + 0.005;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = kind === 'start' ? 780 : 560;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.018, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    } catch {}
  }, []);

  const resolveSessionConfig = useCallback(async (): Promise<{ backend: WhisperBackend; language: string }> => {
    try {
      const settings = await window.electron.getSettings();
      const language = settings.ai.speechLanguage || 'en-US';
      setSpeechLanguage(language);
      const speakToggleHotkey = settings.commandHotkeys?.['system-supercmd-whisper-speak-toggle'] || 'Fn';
      speakToggleShortcutRef.current = speakToggleHotkey;
      setSpeakToggleShortcutLabel(formatShortcutLabel(speakToggleHotkey));

      const sttModel = String(settings.ai.speechToTextModel || 'native');
      const wantsOpenAI = sttModel.startsWith('openai-');
      const wantsElevenLabs = sttModel.startsWith('elevenlabs-');
      const canUseCloud =
        (wantsOpenAI && !!settings.ai.openaiApiKey) ||
        (wantsElevenLabs && !!settings.ai.elevenlabsApiKey);
      const backend: WhisperBackend = canUseCloud ? 'whisper' : 'native';
      backendRef.current = backend;
      return { backend, language };
    } catch {
      return { backend: backendRef.current, language: speechLanguage || 'en-US' };
    }
  }, [speechLanguage]);

  const typeIntoWhisperTarget = useCallback(async (text: string): Promise<{ consumed: boolean; typed: boolean }> => {
    const nextText = String(text || '');
    if (!nextText) {
      return { consumed: false, typed: false };
    }
    const result = await window.electron.whisperTypeTextLive(nextText);
    if (result?.typed) {
      setErrorText('');
      return { consumed: true, typed: true };
    }
    return { consumed: false, typed: false };
  }, []);

  const autoPasteAndClose = useCallback(async (text: string) => {
    const normalized = normalizeTranscript(text);
    if (!normalized) {
      onClose();
      return;
    }

    if (onboardingCaptureMode) {
      onOnboardingTranscriptAppend?.(normalized);
      onClose();
      return;
    }

    const applied = await typeIntoWhisperTarget(normalized);
    if (!applied.consumed) {
      setErrorText('Could not type into the active app.');
    }
    onClose();
  }, [onClose, onboardingCaptureMode, onOnboardingTranscriptAppend, typeIntoWhisperTarget]);

  // ─── Live typing helper (debounced + refined) ──────────────────────

  const applyLiveTranscriptText = useCallback((nextText: string) => {
    if (PUSH_TO_TALK_MODE) return;
    const normalizedNext = normalizeTranscript(nextText);
    if (!normalizedNext) return;

    liveTypeQueueRef.current = liveTypeQueueRef.current.then(async () => {
      const previous = normalizeTranscript(liveTypedTextRef.current);
      const delta = computeAppendOnlyDelta(previous, normalizedNext);
      if (!delta) {
        return;
      }
      const appendText = formatDeltaForAppend(previous, delta);
      if (!appendText) {
        return;
      }

      let typed = false;
      if (onboardingCaptureMode) {
        onOnboardingTranscriptAppend?.(appendText);
        typed = true;
      } else {
        const applied = await typeIntoWhisperTarget(appendText);
        typed = applied.consumed;
      }
      if (typed) {
        liveTypedTextRef.current = normalizedNext;
      }
    });
  }, [onboardingCaptureMode, onOnboardingTranscriptAppend, typeIntoWhisperTarget]);

  const refineAndApplyLiveTranscript = useCallback(async (rawTranscript: string, force = false): Promise<string> => {
    const base = normalizeTranscript(rawTranscript);
    if (!base) return '';

    const requestSeq = ++liveRefineSeqRef.current;
    let refinedText = base;
    try {
      const refined = await window.electron.whisperRefineTranscript(base);
      const cleaned = normalizeTranscript(refined?.correctedText || '');
      if (cleaned) {
        refinedText = cleaned;
      }
    } catch (err) {
      console.warn('[Whisper] Live transcript post-processing failed:', err);
    }

    if (!force) {
      if (requestSeq !== liveRefineSeqRef.current) return refinedText;
      if (base !== normalizeTranscript(combinedTranscriptRef.current)) return refinedText;
    }

    applyLiveTranscriptText(refinedText);
    return refinedText;
  }, [applyLiveTranscriptText]);

  const scheduleDebouncedLiveRefine = useCallback(() => {
    if (PUSH_TO_TALK_MODE) return;
    if (finalizingRef.current) return;
    if (liveRefineTimerRef.current !== null) {
      window.clearTimeout(liveRefineTimerRef.current);
    }
    liveRefineTimerRef.current = window.setTimeout(() => {
      liveRefineTimerRef.current = null;
      const current = normalizeTranscript(combinedTranscriptRef.current);
      if (!current) return;
      if (current === lastDebouncedRefineInputRef.current) return;
      lastDebouncedRefineInputRef.current = current;
      void refineAndApplyLiveTranscript(current, false);
    }, LIVE_REFINE_DEBOUNCE_MS);
  }, [refineAndApplyLiveTranscript]);

  const processNativeFlushQueue = useCallback(async () => {
    if (PUSH_TO_TALK_MODE) {
      nativeFlushQueueRef.current = [];
      nativeFlushInFlightRef.current = false;
      return;
    }
    if (nativeFlushInFlightRef.current) return;
    nativeFlushInFlightRef.current = true;
    try {
      while (nativeFlushQueueRef.current.length > 0) {
        const current = nativeFlushQueueRef.current[0];
        const suffix = normalizeTranscript(current?.text || '');
        if (!suffix) {
          nativeFlushQueueRef.current.shift();
          continue;
        }

        const previouslyTyped = normalizeTranscript(liveTypedTextRef.current);
        const appendText = formatDeltaForAppend(previouslyTyped, suffix);
        if (!appendText) {
          nativeFlushQueueRef.current.shift();
          window.electron.whisperDebugLog('result', 'native suffix dropped', {
            reason: current.reason,
            raw_len: normalizeTranscript(nativeRawAnchorRef.current).length,
            delta_len: suffix.length,
            queue_len: nativeFlushQueueRef.current.length,
            typed_ok: false,
          });
          continue;
        }

        let typedOk = false;
        if (onboardingCaptureMode) {
          onOnboardingTranscriptAppend?.(appendText);
          typedOk = true;
        } else {
          for (let attempt = 0; attempt < 2 && !typedOk; attempt += 1) {
            if (attempt > 0) {
              await new Promise((resolve) => setTimeout(resolve, 70));
            }
            const applied = await typeIntoWhisperTarget(appendText);
            typedOk = applied.consumed;
          }
        }

        if (typedOk) {
          nativeFlushQueueRef.current.shift();
          const nextTyped = normalizeTranscript(`${previouslyTyped}${appendText}`);
          liveTypedTextRef.current = nextTyped;
          combinedTranscriptRef.current = nextTyped;
          setErrorText('');
          window.electron.whisperDebugLog('result', 'native suffix typed', {
            reason: current.reason,
            raw_len: normalizeTranscript(nativeRawAnchorRef.current).length,
            delta_len: suffix.length,
            queue_len: nativeFlushQueueRef.current.length,
            typed_ok: true,
          });
          continue;
        }

        current.attempts += 1;
        window.electron.whisperDebugLog('error', 'native suffix typing failed', {
          reason: current.reason,
          raw_len: normalizeTranscript(nativeRawAnchorRef.current).length,
          delta_len: suffix.length,
          queue_len: nativeFlushQueueRef.current.length,
          typed_ok: false,
          attempts: current.attempts,
        });
        setErrorText('Live typing failed for one chunk. Retrying...');
        if (current.attempts >= NATIVE_MAX_TYPE_RETRIES) {
          nativeFlushQueueRef.current.shift();
          window.electron.whisperDebugLog('error', 'native suffix dropped after retries', {
            reason: current.reason,
            raw_len: normalizeTranscript(nativeRawAnchorRef.current).length,
            delta_len: suffix.length,
            queue_len: nativeFlushQueueRef.current.length,
            typed_ok: false,
          });
          continue;
        }

        // Requeue the failed chunk to the back and pause this cycle.
        nativeFlushQueueRef.current.push(nativeFlushQueueRef.current.shift()!);
        window.setTimeout(() => { void processNativeFlushQueue(); }, 220);
        break;
      }
    } finally {
      nativeFlushInFlightRef.current = false;
    }
  }, [onboardingCaptureMode, onOnboardingTranscriptAppend, typeIntoWhisperTarget]);

  const enqueueNativeSuffix = useCallback((reason: NativeFlushReason, rawSnapshot: string) => {
    const nextRaw = normalizeTranscript(rawSnapshot);
    if (!nextRaw) return;

    if (PUSH_TO_TALK_MODE) {
      combinedTranscriptRef.current = nextRaw;
      nativeRawAnchorRef.current = nextRaw;
      return;
    }

    const prevRaw = normalizeTranscript(nativeRawAnchorRef.current);
    if (nextRaw === prevRaw) return;

    const suffix = extractStrictSuffix(prevRaw, nextRaw);
    nativeRawAnchorRef.current = nextRaw;

    const normalizedSuffix = normalizeTranscript(suffix);
    window.electron.whisperDebugLog('result', 'native suffix extracted', {
      reason,
      raw_len: nextRaw.length,
      delta_len: normalizedSuffix.length,
      queue_len: nativeFlushQueueRef.current.length,
      typed_ok: false,
    });
    if (!normalizedSuffix) return;

    if (normalizedSuffix === normalizeTranscript(nativeLastQueuedSuffixRef.current)) {
      window.electron.whisperDebugLog('result', 'native suffix deduped', {
        reason,
        raw_len: nextRaw.length,
        delta_len: normalizedSuffix.length,
        queue_len: nativeFlushQueueRef.current.length,
        typed_ok: false,
      });
      return;
    }

    nativeLastQueuedSuffixRef.current = normalizedSuffix;
    nativeFlushQueueRef.current.push({ text: normalizedSuffix, attempts: 0, reason });
    window.electron.whisperDebugLog('result', 'native suffix queued', {
      reason,
      raw_len: nextRaw.length,
      delta_len: normalizedSuffix.length,
      queue_len: nativeFlushQueueRef.current.length,
      typed_ok: false,
    });
    void processNativeFlushQueue();
  }, [processNativeFlushQueue]);

  const stopNativeSilenceWatchdog = useCallback(() => {
    if (nativeSilenceTimerRef.current !== null) {
      window.clearInterval(nativeSilenceTimerRef.current);
      nativeSilenceTimerRef.current = null;
    }
  }, []);

  const stopNativeProcessTimer = useCallback(() => {
    if (nativeProcessTimerRef.current !== null) {
      window.clearTimeout(nativeProcessTimerRef.current);
      nativeProcessTimerRef.current = null;
    }
  }, []);

  const flushNativeCurrentPartial = useCallback((reason: NativeFlushReason) => {
    const pending = normalizeTranscript(nativeCurrentPartialRef.current);
    if (!pending) return;
    enqueueNativeSuffix(reason, pending);
    nativeCurrentPartialRef.current = '';
    nativeLastTranscriptAtRef.current = Date.now();
    console.log(`[Whisper][native] finalized (${reason}): "${pending}"`);
    window.electron.whisperDebugLog('result', 'native transcript', {
      transcript: pending,
      isFinal: true,
      synthesized: true,
      reason,
      raw_len: pending.length,
      delta_len: 0,
      queue_len: nativeFlushQueueRef.current.length,
      typed_ok: false,
    });
  }, [enqueueNativeSuffix]);

  const scheduleNativeProcessTimer = useCallback(() => {
    if (PUSH_TO_TALK_MODE) return;
    if (nativeProcessTimerRef.current !== null) return;
    nativeProcessTimerRef.current = window.setTimeout(() => {
      nativeProcessTimerRef.current = null;
      if (finalizingRef.current) return;
      if (whisperStateRef.current !== 'listening') return;
      flushNativeCurrentPartial('timer');
    }, NATIVE_PROCESS_DEBOUNCE_MS);
  }, [flushNativeCurrentPartial]);

  const startNativeSilenceWatchdog = useCallback(() => {
    if (PUSH_TO_TALK_MODE) return;
    stopNativeSilenceWatchdog();
    nativeSilenceTimerRef.current = window.setInterval(() => {
      if (finalizingRef.current) return;
      if (whisperStateRef.current !== 'listening') return;
      const partial = normalizeTranscript(nativeCurrentPartialRef.current);
      if (!partial) return;
      const lastAt = nativeLastTranscriptAtRef.current;
      if (!lastAt) return;
      if (Date.now() - lastAt < NATIVE_SILENCE_FLUSH_MS) return;
      flushNativeCurrentPartial('silence');
    }, NATIVE_SILENCE_POLL_MS);
  }, [flushNativeCurrentPartial, stopNativeSilenceWatchdog]);

  // ─── Whisper API backend ───────────────────────────────────────────

  const sendTranscription = useCallback(async (isFinal: boolean) => {
    if (backendRef.current !== 'whisper') return;
    const chunkCount = audioChunksRef.current.length;
    if (chunkCount === 0) return;
    if (!isFinal && chunkCount <= lastTranscribedChunkCountRef.current) return;

    // Use a full session snapshot so each upload includes container headers.
    const audioBlob = new Blob(audioChunksRef.current, { type: recorderMimeTypeRef.current || 'audio/webm' });
    if (audioBlob.size < 1000 && !isFinal) {
      return;
    }

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const language = (speechLanguage || 'en-US').split('-')[0];

      console.log(`[Whisper] Sending ${arrayBuffer.byteLength} bytes for transcription (final=${isFinal})`);
      window.electron.whisperDebugLog('transcribe', `Sending ${arrayBuffer.byteLength} bytes`, { isFinal });

      const text = await window.electron.whisperTranscribe(arrayBuffer, {
        language,
        mimeType: recorderMimeTypeRef.current || 'audio/webm',
      });

      if (!text || (finalizingRef.current && !isFinal)) return;
      lastTranscribedChunkCountRef.current = chunkCount;

      const normalized = normalizeTranscript(text);
      if (!normalized) return;

      console.log(`[Whisper] Transcription: "${normalized}"`);
      window.electron.whisperDebugLog('result', 'transcription result', { text: normalized, isFinal });

      const merged = mergeTranscriptChunks(combinedTranscriptRef.current, normalized);
      const changed = merged !== combinedTranscriptRef.current;
      combinedTranscriptRef.current = merged;
      if (changed) {
        scheduleDebouncedLiveRefine();
      }
    } catch (err: any) {
      const message = err?.message || 'Transcription failed';
      console.error('[Whisper] Transcription error:', message);
      window.electron.whisperDebugLog('error', 'transcription error', { error: message });

      if (message.includes('API key') || message.includes('401') || message.includes('403')) {
        setState('error');
        setStatusText('Whisper API error.');
        setErrorText(message);
        stopRecording();
        stopVisualizer();
      } else if (message.includes('Whisper model is set to Native')) {
        backendRef.current = 'native';
        setState('idle');
        setStatusText('Whisper model is Native. Press start to use native dictation.');
        setErrorText('');
      }
    }
  }, [speechLanguage, stopVisualizer, scheduleDebouncedLiveRefine]);

  const stopRecording = useCallback(() => {
    if (periodicTimerRef.current !== null) {
      window.clearInterval(periodicTimerRef.current);
      periodicTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
  }, []);

  const forceStopCapture = useCallback(() => {
    if (periodicTimerRef.current !== null) {
      window.clearInterval(periodicTimerRef.current);
      periodicTimerRef.current = null;
    }
    stopNativeSilenceWatchdog();
    stopNativeProcessTimer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    if (nativeChunkDisposerRef.current) {
      nativeChunkDisposerRef.current();
      nativeChunkDisposerRef.current = null;
    }
    void window.electron.whisperStopNative().catch(() => {});
    stopVisualizer();
  }, [stopNativeSilenceWatchdog, stopNativeProcessTimer, stopVisualizer]);

  const startPeriodicTranscription = useCallback(() => {
    if (periodicTimerRef.current !== null) {
      window.clearInterval(periodicTimerRef.current);
    }

    periodicTimerRef.current = window.setInterval(async () => {
      if (transcribeInFlightRef.current || finalizingRef.current) return;
      if (audioChunksRef.current.length === 0) return;

      transcribeInFlightRef.current = true;
      try {
        await sendTranscription(false);
      } finally {
        transcribeInFlightRef.current = false;
      }
    }, 3500);
  }, [sendTranscription]);

  // ─── Finalize ──────────────────────────────────────────────────────

  const finalizeAndClose = useCallback(async (closeAfter = true) => {
    if (finalizingRef.current) return;
    if (whisperStateRef.current === 'listening') {
      playRecordingCue('end');
    }
    finalizingRef.current = true;
    // Invalidate any in-flight startListening async work.
    startRequestSeqRef.current += 1;
    if (editorFocusRestoreTimerRef.current !== null) {
      window.clearTimeout(editorFocusRestoreTimerRef.current);
      editorFocusRestoreTimerRef.current = null;
    }
    if (liveRefineTimerRef.current !== null) {
      window.clearTimeout(liveRefineTimerRef.current);
      liveRefineTimerRef.current = null;
    }
    whisperStateRef.current = 'processing';
    setState('processing');
    setStatusText('Finishing whisper...');
    try {
      const backend = backendRef.current;
      const isNativeBackend = backend === 'native';

      if (backend === 'whisper') {
        // Stop periodic timer
        if (periodicTimerRef.current !== null) {
          window.clearInterval(periodicTimerRef.current);
          periodicTimerRef.current = null;
        }

        // Flush remaining audio from MediaRecorder
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          try { mediaRecorderRef.current.requestData(); } catch {}
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
          try { mediaRecorderRef.current.stop(); } catch {}
        }
        mediaRecorderRef.current = null;

        stopVisualizer();

        // Wait for any in-flight transcription
        while (transcribeInFlightRef.current) {
          await new Promise((r) => setTimeout(r, 50));
        }

        // Final transcription of complete audio
        if (audioChunksRef.current.length > 0) {
          transcribeInFlightRef.current = true;
          try {
            await sendTranscription(true);
          } catch (err) {
            console.error('[Whisper] Final transcription failed:', err);
          } finally {
            transcribeInFlightRef.current = false;
          }
        }
      } else {
        // native backend — stop the native process
        stopNativeSilenceWatchdog();
        stopNativeProcessTimer();
        flushNativeCurrentPartial('stop');
        // Drain any chunks that were already in the queue before key release.
        const drainStartedAt = Date.now();
        while (nativeFlushInFlightRef.current || nativeFlushQueueRef.current.length > 0) {
          if (Date.now() - drainStartedAt > NATIVE_FINAL_DRAIN_TIMEOUT_MS) {
            window.electron.whisperDebugLog('error', 'native final drain timeout', {
              reason: 'stop',
              raw_len: normalizeTranscript(nativeRawAnchorRef.current).length,
              delta_len: 0,
              queue_len: nativeFlushQueueRef.current.length,
              typed_ok: false,
            });
            break;
          }
          await new Promise((r) => setTimeout(r, 40));
        }
        // Send SIGTERM BEFORE disconnecting the chunk listener.
        // The speech-recognizer process waits up to 2s after endAudio() so it can
        // emit its final isFinal:true result. We keep the listener alive to receive it.
        void window.electron.whisperStopNative().catch(() => {});
        // Wait for post-SIGTERM final result(s) to arrive and settle.
        const postStopDrainStart = Date.now();
        while (Date.now() - postStopDrainStart < 2800) {
          const hasQueuedFlush =
            nativeFlushQueueRef.current.length > 0 || nativeFlushInFlightRef.current;
          const waitingForRecognizerEnd = !nativeProcessEndedRef.current;
          const lastAt = nativeLastTranscriptAtRef.current;
          const transcriptStillSettling = lastAt > 0 && Date.now() - lastAt < 140;
          if (hasQueuedFlush || waitingForRecognizerEnd || transcriptStillSettling) {
            await new Promise((r) => setTimeout(r, 40));
            continue;
          }
          break;
        }
        if (nativeChunkDisposerRef.current) {
          nativeChunkDisposerRef.current();
          nativeChunkDisposerRef.current = null;
        }
        stopVisualizer();
      }

      await liveTypeQueueRef.current;

      if (isNativeBackend) {
        const combined = normalizeTranscript(combinedTranscriptRef.current);
        const liveTyped = normalizeTranscript(liveTypedTextRef.current);
        if (closeAfter) {
          if (!liveTyped && combined) {
            await autoPasteAndClose(combined);
          } else {
            onClose();
          }
        } else {
          if (!liveTyped && combined) {
            if (onboardingCaptureMode) {
              onOnboardingTranscriptAppend?.(combined);
            } else {
              const applied = await typeIntoWhisperTarget(combined);
              if (!applied.consumed) {
                setErrorText('Could not type into the active app.');
              }
            }
          }
          combinedTranscriptRef.current = '';
          liveTypedTextRef.current = '';
          setStatusText('Press start to begin speaking.');
          setErrorText('');
          whisperStateRef.current = 'idle';
          setState('idle');
          finalizingRef.current = false;
        }
        return;
      }

      const baseTranscript = normalizeTranscript(combinedTranscriptRef.current);
      if (!baseTranscript) {
        if (closeAfter) {
          onClose();
        } else {
          combinedTranscriptRef.current = '';
          liveTypedTextRef.current = '';
          setStatusText('Press start to begin speaking.');
          setErrorText('');
          whisperStateRef.current = 'idle';
          setState('idle');
          finalizingRef.current = false;
        }
        return;
      }

      const finalTranscript = await refineAndApplyLiveTranscript(baseTranscript, true) || baseTranscript;
      await liveTypeQueueRef.current;

      const liveTyped = normalizeTranscript(liveTypedTextRef.current);
      if (!liveTyped) {
        if (closeAfter) {
          await autoPasteAndClose(finalTranscript);
        } else {
          if (onboardingCaptureMode) {
            onOnboardingTranscriptAppend?.(finalTranscript);
          } else {
            const applied = await typeIntoWhisperTarget(finalTranscript);
            if (!applied.consumed) {
              setErrorText('Could not type into the active app.');
            }
          }
          combinedTranscriptRef.current = '';
          liveTypedTextRef.current = '';
          setStatusText('Press start to begin speaking.');
          setErrorText('');
          whisperStateRef.current = 'idle';
          setState('idle');
          finalizingRef.current = false;
        }
        return;
      }
      applyLiveTranscriptText(finalTranscript);
      await liveTypeQueueRef.current;
      if (closeAfter) {
        onClose();
        return;
      }
      combinedTranscriptRef.current = '';
      liveTypedTextRef.current = '';
      setStatusText('Press start to begin speaking.');
      setErrorText('');
      whisperStateRef.current = 'idle';
      setState('idle');
      finalizingRef.current = false;
    } finally {
      forceStopCapture();
    }
  }, [autoPasteAndClose, onClose, stopVisualizer, sendTranscription, refineAndApplyLiveTranscript, applyLiveTranscriptText, stopNativeSilenceWatchdog, stopNativeProcessTimer, flushNativeCurrentPartial, forceStopCapture, playRecordingCue, onboardingCaptureMode, onOnboardingTranscriptAppend, typeIntoWhisperTarget]);

  // ─── Start Listening ───────────────────────────────────────────────

  const startListening = useCallback(async () => {
    if (startInFlightRef.current) return;
    const currentState = whisperStateRef.current;
    if (currentState === 'listening' || currentState === 'processing') return;
    startInFlightRef.current = true;
    let preflightStream: MediaStream | null = null;
    try {
      const micAccess = await window.electron.whisperEnsureMicrophoneAccess();
      if (!micAccess?.granted) {
        try {
          preflightStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch {
          setState('error');
          setStatusText('Microphone permission required.');
          const status = String(micAccess?.status || '');
          if (status === 'denied' || status === 'restricted') {
            setErrorText('Enable SuperCmd in System Settings -> Privacy & Security -> Microphone, then retry.');
          } else {
            setErrorText(micAccess?.error || 'Allow microphone permission to use SuperCmd Whisper.');
          }
          stopVisualizer();
          return;
        }
      }
    } catch (error: any) {
      try {
        preflightStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        setState('error');
        setStatusText('Microphone permission check failed.');
        setErrorText(error?.message || 'Allow microphone permission to use SuperCmd Whisper.');
        stopVisualizer();
        return;
      }
    }

    const requestSeq = ++startRequestSeqRef.current;
    const sessionConfig = await resolveSessionConfig();

    // Reset shared state
    combinedTranscriptRef.current = '';
    liveTypedTextRef.current = '';
    liveTypeQueueRef.current = Promise.resolve();
    finalizingRef.current = false;
    editorFocusRestoredRef.current = false;
    lastDebouncedRefineInputRef.current = '';
    liveRefineSeqRef.current = 0;
    audioChunksRef.current = [];
    recorderMimeTypeRef.current = 'audio/webm';
    lastTranscribedChunkCountRef.current = 0;
    transcribeInFlightRef.current = false;
    nativeLastTranscriptAtRef.current = 0;
    nativeRawAnchorRef.current = '';
    nativeLastQueuedSuffixRef.current = '';
    nativeCurrentPartialRef.current = '';
    nativeFlushQueueRef.current = [];
    nativeFlushInFlightRef.current = false;
    nativeProcessEndedRef.current = false;
    stopNativeSilenceWatchdog();
    stopNativeProcessTimer();
    if (editorFocusRestoreTimerRef.current !== null) {
      window.clearTimeout(editorFocusRestoreTimerRef.current);
      editorFocusRestoreTimerRef.current = null;
    }
    if (liveRefineTimerRef.current !== null) {
      window.clearTimeout(liveRefineTimerRef.current);
      liveRefineTimerRef.current = null;
    }
    if (nativeChunkDisposerRef.current) {
      nativeChunkDisposerRef.current();
      nativeChunkDisposerRef.current = null;
    }
    setErrorText('');
    setStatusText('Starting microphone...');
    // Optimistically flip to active state so the button toggles immediately.
    whisperStateRef.current = 'listening';
    setState('listening');

    const backend = sessionConfig.backend;

    try {
      // Get microphone stream for the audio visualizer
      const stream = preflightStream || await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (requestSeq !== startRequestSeqRef.current || finalizingRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      startVisualizer(stream);

      if (backend === 'whisper') {
        stopNativeSilenceWatchdog();
        // ── Whisper API path ─────────────────────────────────────
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];
        recorderMimeTypeRef.current = recorder.mimeType || mimeType;
        lastTranscribedChunkCountRef.current = 0;

        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.onstart = () => {
          if (requestSeq !== startRequestSeqRef.current || finalizingRef.current) return;
          setState('listening');
          playRecordingCue('start');
          setStatusText(
            PUSH_TO_TALK_MODE
              ? 'Listening... release shortcut to process.'
              : 'Listening... press shortcut again or Esc to finish.'
          );
          console.log('[Whisper] MediaRecorder started');
          window.electron.whisperDebugLog('start', 'MediaRecorder started');
          if (!PUSH_TO_TALK_MODE) {
            startPeriodicTranscription();
          }
        };

        recorder.onstop = () => {
          console.log('[Whisper] MediaRecorder stopped');
          window.electron.whisperDebugLog('stop', 'MediaRecorder stopped');
        };

        recorder.onerror = () => {
          console.error('[Whisper] MediaRecorder error');
          window.electron.whisperDebugLog('error', 'MediaRecorder error');
          if (!finalizingRef.current) {
            setState('error');
            setStatusText('Recording failed.');
            setErrorText('MediaRecorder encountered an error.');
            stopVisualizer();
          }
        };

        recorder.start(500);
        restoreEditorFocusOnce(150);

      } else {
        stopRecording();
        // ── Native macOS SFSpeechRecognizer path ─────────────────

        // Listen for chunks from the native process
        const dispose = window.electron.onWhisperNativeChunk((data) => {
          if (requestSeq !== startRequestSeqRef.current) return;
          const isFinalizingNow = finalizingRef.current;

          if (data.ready) {
            if (isFinalizingNow) return;
            setState('listening');
            playRecordingCue('start');
            setStatusText(
              PUSH_TO_TALK_MODE
                ? 'Listening... release shortcut to process.'
                : 'Listening... press shortcut again or Esc to finish.'
            );
            console.log('[Whisper][native] Ready');
            window.electron.whisperDebugLog('start', 'native speech recognizer ready');
            nativeLastTranscriptAtRef.current = Date.now();
            startNativeSilenceWatchdog();
            return;
          }

          if (data.error) {
            console.error('[Whisper][native] Error:', data.error);
            window.electron.whisperDebugLog('error', 'native speech error', { error: data.error });
            if (isFinalizingNow) {
              nativeProcessEndedRef.current = true;
              return;
            }
            setState('error');
            setStatusText('Speech recognition error.');
            setErrorText(data.error);
            stopNativeSilenceWatchdog();
            stopNativeProcessTimer();
            stopVisualizer();
            return;
          }

          if (data.ended) {
            nativeProcessEndedRef.current = true;
            stopNativeProcessTimer();
            flushNativeCurrentPartial('ended');
            // Process exited (e.g. silence timeout) — finalize what we have
            if (!finalizingRef.current && (combinedTranscriptRef.current || nativeFlushQueueRef.current.length > 0)) {
              void finalizeAndClose();
            }
            return;
          }

          if (data.transcript !== undefined) {
            const normalized = normalizeTranscript(data.transcript);
            nativeLastTranscriptAtRef.current = Date.now();
            nativeCurrentPartialRef.current = normalized;
            if (!isFinalizingNow) {
              scheduleNativeProcessTimer();
            }
            console.log(`[Whisper][native] transcript: "${normalized}" (final=${data.isFinal})`);
            window.electron.whisperDebugLog('result', 'native transcript', {
              transcript: normalized,
              isFinal: data.isFinal,
              reason: 'raw',
              raw_len: normalized.length,
              delta_len: 0,
              queue_len: nativeFlushQueueRef.current.length,
              typed_ok: false,
            });
            if (normalized) {
              if (PUSH_TO_TALK_MODE) {
                // In push-to-talk we want a single evolving snapshot for the
                // current utterance, not merged segments from partial rewrites.
                combinedTranscriptRef.current = normalized;
              }
              if (data.isFinal && !PUSH_TO_TALK_MODE) {
                stopNativeProcessTimer();
                flushNativeCurrentPartial('final');
                nativeCurrentPartialRef.current = '';
              }
            }
          }
        });
        nativeChunkDisposerRef.current = dispose;

        // Start the native recognizer process
        try {
          await window.electron.whisperStartNative(sessionConfig.language, {
            singleUtterance: PUSH_TO_TALK_MODE,
          });
          if (requestSeq !== startRequestSeqRef.current || finalizingRef.current) {
            dispose();
            if (nativeChunkDisposerRef.current === dispose) {
              nativeChunkDisposerRef.current = null;
            }
            void window.electron.whisperStopNative().catch(() => {});
            return;
          }
        } catch (err: any) {
          dispose();
          if (nativeChunkDisposerRef.current === dispose) {
            nativeChunkDisposerRef.current = null;
          }
          setState('error');
          whisperStateRef.current = 'error';
          setStatusText('Speech recognition failed to start.');
          setErrorText(err?.message || 'Failed to start native speech recognizer.');
          stopVisualizer();
          return;
        }

        restoreEditorFocusOnce(150);
      }
    } catch {
      setState('error');
      whisperStateRef.current = 'error';
      setStatusText('Microphone access denied.');
      setErrorText('Allow microphone permission to use SuperCmd Whisper.');
      stopVisualizer();
    } finally {
      startInFlightRef.current = false;
    }
  }, [startVisualizer, stopVisualizer, restoreEditorFocusOnce, startPeriodicTranscription, finalizeAndClose, resolveSessionConfig, startNativeSilenceWatchdog, stopNativeSilenceWatchdog, stopNativeProcessTimer, scheduleNativeProcessTimer, flushNativeCurrentPartial, stopRecording, playRecordingCue]);

  // ─── Effects ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    void resolveSessionConfig().then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [resolveSessionConfig]);

  useEffect(() => {
    whisperStateRef.current = state;
  }, [state]);

  useEffect(() => {
    const keyWindow = portalTarget?.ownerDocument?.defaultView || window;
    if (!keyWindow) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        pushToTalkArmedRef.current = false;
        void finalizeAndClose();
      }
    };
    keyWindow.addEventListener('keydown', onKeyDown);
    const disposeWhisperStop = window.electron.onWhisperStopAndClose(() => {
      pushToTalkArmedRef.current = false;
      void finalizeAndClose();
    });
    const disposeWhisperStopListening = window.electron.onWhisperStopListening(() => {
      if (!PUSH_TO_TALK_MODE) return;
      pushToTalkArmedRef.current = false;
      if (whisperStateRef.current === 'listening') {
        void finalizeAndClose(false);
      }
    });
    const disposeWhisperStart = window.electron.onWhisperStartListening(() => {
      pushToTalkArmedRef.current = PUSH_TO_TALK_MODE;
      const currentState = whisperStateRef.current;
      if (startInFlightRef.current || currentState === 'listening' || currentState === 'processing') {
        // Hold-to-talk: repeated keydown callbacks while key is held should not stop capture.
        return;
      }
      void startListening();
    });
    const disposeWhisperToggle = window.electron.onWhisperToggleListening(() => {
      const currentState = whisperStateRef.current;
      if (currentState === 'listening' || currentState === 'processing') {
        pushToTalkArmedRef.current = false;
        void finalizeAndClose(false);
      } else {
        pushToTalkArmedRef.current = false;
        void startListening();
      }
    });

    return () => {
      keyWindow.removeEventListener('keydown', onKeyDown);
      disposeWhisperStop();
      disposeWhisperStopListening();
      disposeWhisperStart();
      disposeWhisperToggle();
    };
  }, [finalizeAndClose, portalTarget, startListening]);

  useEffect(() => {
    return () => {
      if (liveRefineTimerRef.current !== null) {
        window.clearTimeout(liveRefineTimerRef.current);
        liveRefineTimerRef.current = null;
      }
      if (editorFocusRestoreTimerRef.current !== null) {
        window.clearTimeout(editorFocusRestoreTimerRef.current);
        editorFocusRestoreTimerRef.current = null;
      }
      forceStopCapture();
    };
  }, [forceStopCapture]);

  // ─── Render ────────────────────────────────────────────────────────

  const listening = state === 'listening';
  const processing = state === 'processing';
  const dotMode = !listening && !processing;
  const bannerText = coachmarkText;

  if (typeof document === 'undefined') return null;
  const target = portalTarget || document.body;
  if (!target) return null;

  return createPortal(
    <div className="whisper-widget-host">
      <div
        className="whisper-widget-shell"
        onMouseEnter={() => window.electron.setWhisperIgnoreMouseEvents(false)}
        onMouseLeave={() => window.electron.setWhisperIgnoreMouseEvents(true)}
      >
        {bannerText ? (
          <div className="whisper-coachmark-inline">{bannerText}</div>
        ) : null}
        <div
          className={`whisper-wave whisper-wave-standalone ${listening ? 'is-listening' : ''} ${processing ? 'is-processing' : ''}`}
          aria-hidden="true"
        >
          <span className="whisper-shortcut-hint">{speakToggleShortcutLabel}</span>
          {processing ? (
            <span className="whisper-processing-loader" />
          ) : (
            waveBars.map((value, index) => {
              const profile = BAR_HEIGHT_PROFILE[index];
              const minHeight = dotMode ? 3 : 4 + Math.round(profile * 4);
              const amplitude = dotMode ? 0 : 4 + Math.round(profile * 10);
              return (
                <span
                  key={`bar-${index}`}
                  className="whisper-wave-bar"
                  style={{ height: `${minHeight + Math.round(value * amplitude)}px` }}
                />
              );
            })
          )}
        </div>

        <button
          type="button"
          className="whisper-side-button whisper-close-button"
          onClick={onClose}
          aria-label="Close whisper"
        >
          <span className="whisper-close-glyph">×</span>
        </button>
      </div>
      <span className="sr-only">{`${speechLanguage} ${statusText} ${errorText}`.trim()}</span>
    </div>,
    target
  );
};

export default SuperCmdWhisper;
