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

function normalizeTranscript(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[`"'"\u201C\u201D]+|[`"'"\u201C\u201D]+$/g, '')
    .trim();
}

const SuperCommandWhisper: React.FC<SuperCommandWhisperProps> = ({ onClose }) => {
  const [state, setState] = useState<WhisperState>('idle');
  const [statusText, setStatusText] = useState('Starting microphone...');
  const [errorText, setErrorText] = useState('');
  const [waveBars, setWaveBars] = useState<number[]>(BASE_WAVE);
  const [speechLanguage, setSpeechLanguage] = useState('en-US');

  // Which backend to use — determined on settings load
  const backendRef = useRef<WhisperBackend>('native');

  const combinedTranscriptRef = useRef('');
  const liveTypedTextRef = useRef('');
  const liveTypeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const finalizingRef = useRef(false);
  const autoStartDoneRef = useRef(false);
  const editorFocusRestoreTimerRef = useRef<number | null>(null);
  const editorFocusRestoredRef = useRef(false);
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

  // Native backend refs
  const nativeChunkDisposerRef = useRef<(() => void) | null>(null);
  // Accumulated text from finalized recognition sessions (native backend).
  // When SFSpeechRecognizer finalizes an utterance and restarts, this holds
  // what was actually typed so far so the next session's partials can be
  // prepended with it for correct append-only delta computation.
  const committedTextRef = useRef('');
  // Character count of what we've successfully typed into the editor.
  // Used for delta computation instead of string comparison (avoids
  // casing/punctuation mismatches from SFSpeechRecognizer).
  const typedCountRef = useRef(0);

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

  // ─── Live typing helper (used by native backend) ───────────────────
  // Append-only via character count: type only the NEW tail characters
  // when the full transcript grows past what we've already typed.
  // Uses character count instead of string comparison to avoid issues
  // with casing/punctuation changes from SFSpeechRecognizer.

  const handleTranscriptUpdate = useCallback((fullTranscript: string) => {
    if (!fullTranscript) return;

    restoreEditorFocusOnce();
    combinedTranscriptRef.current = fullTranscript;

    liveTypeQueueRef.current = liveTypeQueueRef.current.then(async () => {
      const alreadyTyped = typedCountRef.current;
      if (fullTranscript.length <= alreadyTyped) return;

      const delta = fullTranscript.slice(alreadyTyped);
      if (delta.length > 0) {
        const typed = await window.electron.typeTextLive(delta);
        if (typed) {
          typedCountRef.current = fullTranscript.length;
          liveTypedTextRef.current = fullTranscript;
        }
      }
    });
  }, [restoreEditorFocusOnce]);

  // ─── Whisper API backend ───────────────────────────────────────────

  const sendTranscription = useCallback(async (isFinal: boolean) => {
    const chunks = audioChunksRef.current;
    if (chunks.length === 0) return;

    const audioBlob = new Blob(chunks, { type: 'audio/webm' });
    if (audioBlob.size < 1000 && !isFinal) return;

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

      // For Whisper, each transcription is the full buffer — replace everything
      restoreEditorFocusOnce();
      combinedTranscriptRef.current = normalized;
      const previous = liveTypedTextRef.current;
      if (previous === normalized) return;

      liveTypeQueueRef.current = liveTypeQueueRef.current.then(async () => {
        if (!previous) {
          const typed = await window.electron.typeTextLive(normalized);
          if (typed) { liveTypedTextRef.current = normalized; }
        } else {
          const replaced = await window.electron.replaceLiveText(previous, normalized);
          if (replaced) { liveTypedTextRef.current = normalized; }
        }
      });
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
      }
    }
  }, [speechLanguage, restoreEditorFocusOnce, stopVisualizer]);

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

  const finalizeAndClose = useCallback(async () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    if (editorFocusRestoreTimerRef.current !== null) {
      window.clearTimeout(editorFocusRestoreTimerRef.current);
      editorFocusRestoreTimerRef.current = null;
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
      onClose();
      return;
    }

    const liveTyped = normalizeTranscript(liveTypedTextRef.current);
    if (!liveTyped) {
      await autoPasteAndClose(baseTranscript);
      return;
    }
    if (liveTyped !== baseTranscript) {
      await window.electron.replaceLiveText(liveTyped, baseTranscript);
    }
    onClose();
  }, [autoPasteAndClose, onClose, stopVisualizer, sendTranscription]);

  // ─── Start Listening ───────────────────────────────────────────────

  const startListening = useCallback(async () => {
    if (state === 'listening' || state === 'processing') return;

    // Reset shared state
    combinedTranscriptRef.current = '';
    liveTypedTextRef.current = '';
    liveTypeQueueRef.current = Promise.resolve();
    finalizingRef.current = false;
    editorFocusRestoredRef.current = false;
    audioChunksRef.current = [];
    transcribeInFlightRef.current = false;
    committedTextRef.current = '';
    typedCountRef.current = 0;
    if (editorFocusRestoreTimerRef.current !== null) {
      window.clearTimeout(editorFocusRestoreTimerRef.current);
      editorFocusRestoreTimerRef.current = null;
    }
    if (nativeChunkDisposerRef.current) {
      nativeChunkDisposerRef.current();
      nativeChunkDisposerRef.current = null;
    }
    setErrorText('');
    setStatusText('Starting microphone...');
    setState('idle');

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
        // Use Whisper API if OpenAI key is configured, otherwise native macOS speech
        backendRef.current = settings.ai.openaiApiKey ? 'whisper' : 'native';
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (autoStartDoneRef.current) return;
    autoStartDoneRef.current = true;
    const timer = window.setTimeout(() => {
      void startListening();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [startListening]);

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

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      disposeWhisperStop();
    };
  }, [finalizeAndClose]);

  useEffect(() => {
    return () => {
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
      <span className="sr-only">{`${speechLanguage} ${statusText} ${errorText}`.trim()}</span>
    </div>,
    document.body
  );
};

export default SuperCommandWhisper;
