/**
 * useCursorPrompt.ts
 *
 * State and streaming logic for the inline AI cursor prompt (Command+K style).
 * - Captures selected text from the active app via getSelectedTextStrict()
 * - Builds a composite prompt: "rewrite selection" or "insert at cursor"
 * - Streams AI response via ai-stream-chunk / ai-stream-done / ai-stream-error,
 *   filtered to only this hook's requestId
 * - applyCursorPromptResultToEditor(): replaces the previous selection or types
 *   the generated text at the cursor using replaceLiveText / typeTextLive
 * - Exposed by App.tsx to CursorPromptView (both inline and portal variants)
 *
 * Checks AI availability each time the prompt opens and surfaces a clear error
 * message (NO_AI_MODEL_ERROR) if no model is configured.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { NO_AI_MODEL_ERROR } from '../utils/constants';

// ─── Interfaces ──────────────────────────────────────────────────────

export interface UseCursorPromptOptions {
  showCursorPrompt: boolean;
  setShowCursorPrompt: (value: boolean) => void;
  setAiAvailable: (value: boolean) => void;
}

export interface UseCursorPromptReturn {
  cursorPromptText: string;
  setCursorPromptText: (value: string) => void;
  cursorPromptStatus: 'idle' | 'processing' | 'ready' | 'error';
  setCursorPromptStatus: (value: 'idle' | 'processing' | 'ready' | 'error') => void;
  cursorPromptResult: string;
  setCursorPromptResult: (value: string) => void;
  cursorPromptError: string;
  setCursorPromptError: (value: string) => void;
  cursorPromptSourceText: string;
  setCursorPromptSourceText: (value: string) => void;
  cursorPromptInputRef: React.RefObject<HTMLTextAreaElement>;
  cursorPromptRequestIdRef: React.MutableRefObject<string | null>;
  submitCursorPrompt: () => Promise<void>;
  applyCursorPromptResultToEditor: () => Promise<void>;
  closeCursorPrompt: () => Promise<void>;
  resetCursorPromptState: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useCursorPrompt({
  showCursorPrompt,
  setShowCursorPrompt,
  setAiAvailable,
}: UseCursorPromptOptions): UseCursorPromptReturn {
  const [cursorPromptText, setCursorPromptText] = useState('');
  const [cursorPromptStatus, setCursorPromptStatus] = useState<'idle' | 'processing' | 'ready' | 'error'>('idle');
  const [cursorPromptResult, setCursorPromptResult] = useState('');
  const [cursorPromptError, setCursorPromptError] = useState('');
  const [cursorPromptSourceText, setCursorPromptSourceText] = useState('');

  const cursorPromptRequestIdRef = useRef<string | null>(null);
  const cursorPromptResultRef = useRef('');
  const cursorPromptSourceTextRef = useRef('');
  const cursorPromptInputRef = useRef<HTMLTextAreaElement>(null);

  // ── Apply result to the editor ──────────────────────────────────

  const applyCursorPromptResultToEditor = useCallback(async () => {
    const previousText = cursorPromptSourceTextRef.current;
    const nextText = String(cursorPromptResultRef.current || '').trim();
    if (!nextText) {
      setCursorPromptStatus('error');
      setCursorPromptError('Model returned an empty response.');
      return;
    }
    const applied = previousText
      ? await window.electron.replaceLiveText(previousText, nextText)
      : await window.electron.typeTextLive(nextText);
    if (applied) {
      setCursorPromptStatus('ready');
      setCursorPromptError('');
      return;
    }
    setCursorPromptStatus('error');
    setCursorPromptError('Could not apply update. Re-select text or place cursor and try again.');
  }, []);

  // ── AI streaming listeners (only for cursor-prompt requests) ────

  useEffect(() => {
    const handleChunk = (data: { requestId: string; chunk: string }) => {
      if (data.requestId === cursorPromptRequestIdRef.current) {
        cursorPromptResultRef.current += data.chunk;
        setCursorPromptResult((prev) => prev + data.chunk);
      }
    };
    const handleDone = (data: { requestId: string }) => {
      if (data.requestId === cursorPromptRequestIdRef.current) {
        cursorPromptRequestIdRef.current = null;
        void applyCursorPromptResultToEditor();
      }
    };
    const handleError = (data: { requestId: string; error: string }) => {
      if (data.requestId === cursorPromptRequestIdRef.current) {
        cursorPromptRequestIdRef.current = null;
        setCursorPromptStatus('error');
        setCursorPromptError(data.error || 'Failed to process this prompt.');
      }
    };

    window.electron.onAIStreamChunk(handleChunk);
    window.electron.onAIStreamDone(handleDone);
    window.electron.onAIStreamError(handleError);
  }, [applyCursorPromptResultToEditor]);

  // ── Focus cursor prompt input when shown ────────────────────────

  useEffect(() => {
    if (!showCursorPrompt) return;
    setTimeout(() => cursorPromptInputRef.current?.focus(), 0);
  }, [showCursorPrompt]);

  // ── Check AI availability when cursor prompt shown ──────────────

  useEffect(() => {
    if (!showCursorPrompt) return;
    let cancelled = false;
    window.electron.aiIsAvailable()
      .then((available) => {
        if (cancelled) return;
        setAiAvailable(available);
        if (!available) {
          setCursorPromptStatus('error');
          setCursorPromptError(NO_AI_MODEL_ERROR);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAiAvailable(false);
        setCursorPromptStatus('error');
        setCursorPromptError(NO_AI_MODEL_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, [showCursorPrompt, setAiAvailable]);

  // ── Callbacks ───────────────────────────────────────────────────

  const submitCursorPrompt = useCallback(async () => {
    const instruction = cursorPromptText.trim();
    if (!instruction || cursorPromptStatus === 'processing') return;
    const aiReady = await window.electron.aiIsAvailable().catch(() => false);
    setAiAvailable(aiReady);
    if (!aiReady) {
      setCursorPromptStatus('error');
      setCursorPromptError(NO_AI_MODEL_ERROR);
      return;
    }

    if (cursorPromptRequestIdRef.current) {
      try {
        await window.electron.aiCancel(cursorPromptRequestIdRef.current);
      } catch {}
      cursorPromptRequestIdRef.current = null;
    }

    setCursorPromptStatus('processing');
    setCursorPromptResult('');
    setCursorPromptError('');
    setCursorPromptSourceText('');
    cursorPromptResultRef.current = '';
    cursorPromptSourceTextRef.current = '';

    const selectedText = String(await window.electron.getSelectedTextStrict()).trim();
    const hasSelection = selectedText.length > 0;
    if (hasSelection) {
      setCursorPromptSourceText(selectedText);
      cursorPromptSourceTextRef.current = selectedText;
    }

    const requestId = `cursor-prompt-${Date.now()}`;
    cursorPromptRequestIdRef.current = requestId;
    const compositePrompt = hasSelection
      ? [
          'Rewrite the selected text based on the instruction.',
          'Return only the rewritten text. Do not include explanations.',
          '',
          `Instruction: ${instruction}`,
          '',
          'Selected text:',
          selectedText,
        ].join('\n')
      : [
          'Generate text to insert at the current cursor position, based on the instruction.',
          'Return only the generated text. Do not include explanations.',
          '',
          `Instruction: ${instruction}`,
        ].join('\n');
    await window.electron.aiAsk(requestId, compositePrompt);
  }, [cursorPromptStatus, cursorPromptText, setAiAvailable]);

  const closeCursorPrompt = useCallback(async () => {
    if (cursorPromptRequestIdRef.current) {
      try {
        await window.electron.aiCancel(cursorPromptRequestIdRef.current);
      } catch {}
      cursorPromptRequestIdRef.current = null;
    }
    setShowCursorPrompt(false);
    window.electron.hideWindow();
  }, [setShowCursorPrompt]);

  const resetCursorPromptState = useCallback(() => {
    setCursorPromptText('');
    setCursorPromptStatus('idle');
    setCursorPromptResult('');
    setCursorPromptError('');
    setCursorPromptSourceText('');
    cursorPromptRequestIdRef.current = null;
  }, []);

  return {
    cursorPromptText,
    setCursorPromptText,
    cursorPromptStatus,
    setCursorPromptStatus,
    cursorPromptResult,
    setCursorPromptResult,
    cursorPromptError,
    setCursorPromptError,
    cursorPromptSourceText,
    setCursorPromptSourceText,
    cursorPromptInputRef,
    cursorPromptRequestIdRef,
    submitCursorPrompt,
    applyCursorPromptResultToEditor,
    closeCursorPrompt,
    resetCursorPromptState,
  };
}
