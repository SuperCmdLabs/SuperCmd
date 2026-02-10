import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppSettings } from '../types/electron';

interface SuperCommandWhisperProps {
  onClose: () => void;
}

type WhisperState = 'idle' | 'listening' | 'processing' | 'error';

// 'whisper' = OpenAI Whisper API (needs API key)
// 'native'  = macOS SFSpeechRecognizer (no API key needed, like Chrome)
type WhisperBackend = 'whisper' | 'native';

const BAR_HEIGHT_PROFILE = [
  0.45, 0.62, 0.52, 0.58, 0.74, 0.7, 1.0, 0.7, 0.58, 0.52, 0.74, 0.62, 0.45,
];
const BAR_COUNT = BAR_HEIGHT_PROFILE.length;
const BASE_WAVE = BAR_HEIGHT_PROFILE.map((profile) => 0.08 + profile * 0.05);
const LIVE_REFINE_DEBOUNCE_MS = 1000;

function formatShortcutLabel(shortcut: string): string {
  return String(shortcut || '')
    .replace(/Command/g, '\u2318')
    .replace(/Control/g, '\u2303')
    .replace(/Alt/g, '\u2325')
    .replace(/Shift/g, '\u21E7')
    .replace(/Period/g, '.')
    .replace(/\+/g, ' ');
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

const SuperCommandWhisper: React.FC<SuperCommandWhisperProps> = ({ onClose }) => {
  const [state, setState] = useState<WhisperState>('idle');
  const [statusText, setStatusText] = useState('Press start to begin speaking.');
  const [errorText, setErrorText] = useState('');
  const [waveBars, setWaveBars] = useState<number[]>(BASE_WAVE);
  const [speechLanguage, setSpeechLanguage] = useState('en-US');
  const [speakToggleShortcutLabel, setSpeakToggleShortcutLabel] = useState('\u2318 .');

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

  // Audio visualizer refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  // MediaRecorder refs (Whisper API backend)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const periodicTimerRef = useRef<number | null>(null);
  const transcribeInFlightRef = useRef(false);
  const startRequestSeqRef = useRef(0);

  // Native backend refs
  const nativeChunkDisposerRef = useRef<(() => void) | null>(null);
  // Accumulated text from finalized recognition sessions (native backend).
  // When SFSpeechRecognizer finalizes an utterance and restarts, this holds
  // what was captured so far so the next session's partials can be prepended.
  const committedTextRef = useRef('');

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
  }, []);

  const autoPasteAndClose = useCallback(async (text: string) => {
    const normalized = normalizeTranscript(text);
    if (!normalized) {
      onClose();
      return;
    }

    const pasted = await window.electron.pasteText(normalized);
    if (!pasted) {
      await window.electron.clipboardWrite({ text: normalized });
    }
    onClose();
  }, [onClose]);

  // ─── Live typing helper (debounced + refined) ──────────────────────

  const applyLiveTranscriptText = useCallback((nextText: string) => {
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

      restoreEditorFocusOnce();
      const typed = await window.electron.typeTextLive(appendText);
      if (typed) {
        liveTypedTextRef.current = normalizedNext;
      }
    });
  }, [restoreEditorFocusOnce]);

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

  const handleTranscriptUpdate = useCallback((fullTranscript: string) => {
    if (!fullTranscript) return;

    combinedTranscriptRef.current = fullTranscript;
    scheduleDebouncedLiveRefine();
  }, [scheduleDebouncedLiveRefine]);

  // ─── Whisper API backend ───────────────────────────────────────────

  const sendTranscription = useCallback(async (isFinal: boolean) => {
    if (audioChunksRef.current.length === 0) return;
    const chunks = audioChunksRef.current.splice(0, audioChunksRef.current.length);

    const audioBlob = new Blob(chunks, { type: 'audio/webm' });
    if (audioBlob.size < 1000 && !isFinal) {
      // Too small to send yet; prepend back in front of any newly queued chunks.
      audioChunksRef.current = [...chunks, ...audioChunksRef.current];
      return;
    }

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const language = (speechLanguage || 'en-US').split('-')[0];

      console.log(`[Whisper] Sending ${arrayBuffer.byteLength} bytes for transcription (final=${isFinal})`);
      window.electron.whisperDebugLog('transcribe', `Sending ${arrayBuffer.byteLength} bytes`, { isFinal });

      const text = await window.electron.whisperTranscribe(arrayBuffer, { language });

      if (!text || (finalizingRef.current && !isFinal)) return;

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
      if (!isFinal) {
        // Preserve unsent audio by putting failed batch back at the front.
        audioChunksRef.current = [...chunks, ...audioChunksRef.current];
      }
      const message = err?.message || 'Transcription failed';
      console.error('[Whisper] Transcription error:', message);
      window.electron.whisperDebugLog('error', 'transcription error', { error: message });

      if (message.includes('API key') || message.includes('401') || message.includes('403')) {
        setState('error');
        setStatusText('Whisper API error.');
        setErrorText(message);
        stopRecording();
        stopVisualizer();
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
    setState('processing');
    setStatusText('Finishing whisper...');

    const backend = backendRef.current;

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
      if (nativeChunkDisposerRef.current) {
        nativeChunkDisposerRef.current();
        nativeChunkDisposerRef.current = null;
      }
      void window.electron.whisperStopNative().catch(() => {});
      stopVisualizer();
    }

    await liveTypeQueueRef.current;

    const baseTranscript = normalizeTranscript(combinedTranscriptRef.current);
    if (!baseTranscript) {
      if (closeAfter) {
        onClose();
      } else {
        combinedTranscriptRef.current = '';
        liveTypedTextRef.current = '';
        setStatusText('Press start to begin speaking.');
        setErrorText('');
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
        const pasted = await window.electron.pasteText(finalTranscript);
        if (!pasted) {
          await window.electron.clipboardWrite({ text: finalTranscript });
        }
        combinedTranscriptRef.current = '';
        liveTypedTextRef.current = '';
        setStatusText('Press start to begin speaking.');
        setErrorText('');
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
    setState('idle');
    finalizingRef.current = false;
  }, [autoPasteAndClose, onClose, stopVisualizer, sendTranscription, refineAndApplyLiveTranscript, applyLiveTranscriptText]);

  // ─── Start Listening ───────────────────────────────────────────────

  const startListening = useCallback(async () => {
    if (state === 'listening' || state === 'processing') return;
    const requestSeq = ++startRequestSeqRef.current;

    // Reset shared state
    combinedTranscriptRef.current = '';
    liveTypedTextRef.current = '';
    liveTypeQueueRef.current = Promise.resolve();
    finalizingRef.current = false;
    editorFocusRestoredRef.current = false;
    lastDebouncedRefineInputRef.current = '';
    liveRefineSeqRef.current = 0;
    audioChunksRef.current = [];
    transcribeInFlightRef.current = false;
    committedTextRef.current = '';
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
    setState('listening');

    const backend = backendRef.current;

    try {
      // Get microphone stream for the audio visualizer
      const stream = await navigator.mediaDevices.getUserMedia({
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
        // ── Whisper API path ─────────────────────────────────────
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.onstart = () => {
          if (requestSeq !== startRequestSeqRef.current || finalizingRef.current) return;
          setState('listening');
          setStatusText('Listening... press shortcut again or Esc to finish.');
          console.log('[Whisper] MediaRecorder started');
          window.electron.whisperDebugLog('start', 'MediaRecorder started');
          startPeriodicTranscription();
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
        // ── Native macOS SFSpeechRecognizer path ─────────────────

        // Listen for chunks from the native process
        const dispose = window.electron.onWhisperNativeChunk((data) => {
          if (requestSeq !== startRequestSeqRef.current) return;
          if (finalizingRef.current) return;

          if (data.ready) {
            setState('listening');
            setStatusText('Listening... press shortcut again or Esc to finish.');
            console.log('[Whisper][native] Ready');
            window.electron.whisperDebugLog('start', 'native speech recognizer ready');
            return;
          }

          if (data.error) {
            console.error('[Whisper][native] Error:', data.error);
            window.electron.whisperDebugLog('error', 'native speech error', { error: data.error });
            setState('error');
            setStatusText('Speech recognition error.');
            setErrorText(data.error);
            stopVisualizer();
            return;
          }

          if (data.ended) {
            // Process exited (e.g. silence timeout) — finalize what we have
            if (!finalizingRef.current && combinedTranscriptRef.current) {
              void finalizeAndClose();
            }
            return;
          }

          if (data.transcript !== undefined) {
            const normalized = normalizeTranscript(data.transcript);
            console.log(`[Whisper][native] transcript: "${normalized}" (final=${data.isFinal})`);
            window.electron.whisperDebugLog('result', 'native transcript', {
              transcript: normalized,
              isFinal: data.isFinal,
            });
            if (normalized) {
              // Compute full text: committed sessions + current session
              const committed = committedTextRef.current;
              const fullText = committed ? committed + ' ' + normalized : normalized;
              handleTranscriptUpdate(fullText);

              if (data.isFinal) {
                // Set committed text SYNCHRONOUSLY so the next session's
                // first partial (which may arrive before the queue drains)
                // computes fullText correctly.
                committedTextRef.current = fullText;
              }
            }
          }
        });
        nativeChunkDisposerRef.current = dispose;

        // Start the native recognizer process
        try {
          await window.electron.whisperStartNative(speechLanguage);
          if (requestSeq !== startRequestSeqRef.current || finalizingRef.current) {
            void window.electron.whisperStopNative().catch(() => {});
            return;
          }
        } catch (err: any) {
          setState('error');
          setStatusText('Speech recognition failed to start.');
          setErrorText(err?.message || 'Failed to start native speech recognizer.');
          stopVisualizer();
          return;
        }

        restoreEditorFocusOnce(150);
      }
    } catch {
      setState('error');
      setStatusText('Microphone access denied.');
      setErrorText('Allow microphone permission to use SuperCommand Whisper.');
      stopVisualizer();
    }
  }, [state, speechLanguage, startVisualizer, stopVisualizer, restoreEditorFocusOnce, startPeriodicTranscription, handleTranscriptUpdate, finalizeAndClose]);

  // ─── Effects ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    window.electron
      .getSettings()
      .then((settings: AppSettings) => {
        if (cancelled) return;
        setSpeechLanguage(settings.ai.speechLanguage || 'en-US');
        const speakToggleHotkey = settings.commandHotkeys?.['system-supercommand-whisper-speak-toggle'] || 'Command+.';
        setSpeakToggleShortcutLabel(formatShortcutLabel(speakToggleHotkey));
        // Backend is controlled by Whisper model selection.
        const sttModel = String(settings.ai.speechToTextModel || 'native');
        const wantsOpenAI = sttModel.startsWith('openai-');
        backendRef.current = wantsOpenAI && !!settings.ai.openaiApiKey ? 'whisper' : 'native';
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void finalizeAndClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    const disposeWhisperStop = window.electron.onWhisperStopAndClose(() => {
      void finalizeAndClose();
    });
    const disposeWhisperStart = window.electron.onWhisperStartListening(() => {
      void startListening();
    });
    const disposeWhisperToggle = window.electron.onWhisperToggleListening(() => {
      if (state === 'listening' || state === 'processing') {
        void finalizeAndClose(false);
      } else {
        void startListening();
      }
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      disposeWhisperStop();
      disposeWhisperStart();
      disposeWhisperToggle();
    };
  }, [finalizeAndClose, startListening, state]);

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
      if (periodicTimerRef.current !== null) {
        window.clearInterval(periodicTimerRef.current);
        periodicTimerRef.current = null;
      }
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
    };
  }, [stopVisualizer]);

  // ─── Render ────────────────────────────────────────────────────────

  const listening = state === 'listening';
  const processing = state === 'processing';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="whisper-widget-host">
      <div className="whisper-widget-shell">
        <button
          type="button"
          className={`whisper-side-button whisper-stop-button ${listening || processing ? 'is-active' : 'is-idle'}`}
          onClick={() => {
            if (listening || processing) {
              void finalizeAndClose(false);
            } else {
              void startListening();
            }
          }}
          aria-label={listening || processing ? `Stop listening (${speakToggleShortcutLabel})` : `Start listening (${speakToggleShortcutLabel})`}
          title={listening || processing ? `Stop (${speakToggleShortcutLabel})` : `Start (${speakToggleShortcutLabel})`}
        >
          <span className="whisper-shortcut-hint">{speakToggleShortcutLabel}</span>
          {listening || processing ? (
            <span className="whisper-stop-square" />
          ) : (
            <span className="whisper-record-dot" />
          )}
        </button>

        <div
          className={`whisper-wave whisper-wave-standalone ${listening ? 'is-listening' : ''} ${processing ? 'is-processing' : ''}`}
          aria-hidden="true"
        >
          {waveBars.map((value, index) => {
            const profile = BAR_HEIGHT_PROFILE[index];
            const minHeight = 5 + Math.round(profile * 7);
            const amplitude = 8 + Math.round(profile * 18);
            return (
              <span
                key={`bar-${index}`}
                className="whisper-wave-bar"
                style={{ height: `${minHeight + Math.round(value * amplitude)}px` }}
              />
            );
          })}
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
    document.body
  );
};

export default SuperCommandWhisper;
