import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, X } from 'lucide-react';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';
import { applyBaseColor } from './utils/base-color';
import { applyUiStyle } from './utils/ui-style';

const NO_AI_MODEL_ERROR = 'No AI model available. Configure one in Settings -> AI.';

const PRESETS = [
  'Fix grammar',
  'Make professional',
  'Make concise',
  'Simplify',
  'Expand',
  'Make casual',
  'Translate to English',
];

const PromptApp: React.FC = () => {
  const [promptText, setPromptText] = useState('');
  const [status, setStatus] = useState<'idle' | 'processing' | 'error'>('idle');
  const [errorText, setErrorText] = useState('');
  const [aiAvailable, setAiAvailable] = useState(true);
  const requestIdRef = useRef<string | null>(null);
  const sourceTextRef = useRef('');
  const resultTextRef = useRef('');
  const selectedTextSnapshotRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const closePrompt = useCallback(async () => {
    if (requestIdRef.current) {
      try { await window.electron.aiCancel(requestIdRef.current); } catch {}
      requestIdRef.current = null;
    }
    sourceTextRef.current = '';
    resultTextRef.current = '';
    setPromptText('');
    setStatus('idle');
    setErrorText('');
    await window.electron.closePromptWindow();
  }, []);

  const applyResult = useCallback(async () => {
    const nextText = String(resultTextRef.current || '');
    if (!nextText.trim()) {
      setStatus('error');
      setErrorText('Model returned an empty response.');
      return;
    }
    const selected = String(sourceTextRef.current || '');
    await window.electron.promptApplyGeneratedText({
      previousText: selected.trim().length > 0 ? selected : undefined,
      nextText,
    });
  }, []);

  const submitPrompt = useCallback(async () => {
    const instruction = promptText.trim();
    if (!instruction || status === 'processing') return;
    const aiReady = await window.electron.aiIsAvailable().catch(() => false);
    setAiAvailable(aiReady);
    if (!aiReady) {
      setStatus('error');
      setErrorText(NO_AI_MODEL_ERROR);
      return;
    }

    if (requestIdRef.current) {
      try { await window.electron.aiCancel(requestIdRef.current); } catch {}
      requestIdRef.current = null;
    }

    setStatus('processing');
    setErrorText('');
    sourceTextRef.current = '';
    resultTextRef.current = '';

    const liveSelectedText = String(await window.electron.getSelectedText() || '');
    const selectedText =
      liveSelectedText.trim().length > 0
        ? liveSelectedText
        : String(selectedTextSnapshotRef.current || '');
    if (selectedText.trim().length > 0) sourceTextRef.current = selectedText;

    const requestId = `prompt-window-${Date.now()}`;
    requestIdRef.current = requestId;
    const compositePrompt = selectedText
      ? [
          'Rewrite the selected text based on the instruction.',
          'Return only the exact rewritten text that should be inserted.',
          'Output rules: no commentary, no preface, no markdown, no quotes, no labels.',
          '',
          `Instruction: ${instruction}`,
          '',
          'Selected text:',
          selectedText,
        ].join('\n')
      : [
          'Generate text to insert at the current cursor position based on the instruction.',
          'Return only the exact text to insert.',
          'Output rules: no commentary, no preface, no markdown, no quotes, no labels.',
          '',
          `Instruction: ${instruction}`,
        ].join('\n');
    await window.electron.aiAsk(requestId, compositePrompt);
  }, [promptText, status]);

  useEffect(() => {
    let disposed = false;
    window.electron.getSettings()
      .then((settings) => {
        if (!disposed) {
          applyAppFontSize(settings.fontSize);
          applyUiStyle(settings.uiStyle || 'default');
          applyBaseColor(settings.baseColor || '#101113');
        }
      })
      .catch(() => {
        if (!disposed) {
          applyAppFontSize(getDefaultAppFontSize());
          applyUiStyle('default');
        }
      });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((settings) => {
      applyAppFontSize(settings.fontSize);
      applyUiStyle(settings.uiStyle || 'default');
      applyBaseColor(settings.baseColor || '#101113');
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const cleanupWindowShown = window.electron.onWindowShown((payload) => {
      if (payload?.mode !== 'prompt') return;
      selectedTextSnapshotRef.current = String(payload?.selectedTextSnapshot || '');
      sourceTextRef.current = '';
      resultTextRef.current = '';
      setPromptText('');
      setStatus('idle');
      setErrorText('');
      textareaRef.current?.focus();
    });
    return cleanupWindowShown;
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.electron.aiIsAvailable()
      .then((available) => {
        if (cancelled) return;
        setAiAvailable(available);
        if (!available) {
          setStatus('error');
          setErrorText(NO_AI_MODEL_ERROR);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAiAvailable(false);
        setStatus('error');
        setErrorText(NO_AI_MODEL_ERROR);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleChunk = (data: { requestId: string; chunk: string }) => {
      if (data.requestId !== requestIdRef.current) return;
      resultTextRef.current += data.chunk;
    };
    const handleDone = (data: { requestId: string }) => {
      if (data.requestId !== requestIdRef.current) return;
      requestIdRef.current = null;
      void applyResult();
    };
    const handleError = (data: { requestId: string; error: string }) => {
      if (data.requestId !== requestIdRef.current) return;
      requestIdRef.current = null;
      setStatus('error');
      setErrorText(data.error || 'Failed to process this prompt.');
    };
    const removeChunk = window.electron.onAIStreamChunk(handleChunk);
    const removeDone = window.electron.onAIStreamDone(handleDone);
    const removeError = window.electron.onAIStreamError(handleError);
    return () => {
      removeChunk?.();
      removeDone?.();
      removeError?.();
    };
  }, [applyResult]);

  return (
    <div className="w-full h-full">
      <div className="cursor-prompt-surface h-full flex flex-col gap-1 px-3.5 pt-2.5 pb-2 relative">
        <button
          onClick={() => void closePrompt()}
          className="cursor-prompt-close"
          aria-label="Close prompt"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1 min-w-0">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submitPrompt();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                void closePrompt();
              }
            }}
            placeholder="Tell AI what to do with selected text..."
            ref={textareaRef}
            className="cursor-prompt-textarea w-full bg-transparent border-none outline-none text-white/95 text-[13px] font-medium tracking-[0.003em]"
            autoFocus
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 overflow-hidden">
            {status === 'processing' ? (
              <div className="cursor-prompt-inline-status">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Processing...</span>
              </div>
            ) : status === 'error' && errorText ? (
              <div className="cursor-prompt-error">{errorText}</div>
            ) : (
              <div className="cursor-prompt-presets">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      setPromptText(preset);
                      textareaRef.current?.focus();
                    }}
                    className="cursor-prompt-preset-pill"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => void submitPrompt()}
            className="cursor-prompt-submit"
            disabled={!promptText.trim() || status === 'processing' || !aiAvailable}
            title="Submit prompt"
          >
            <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptApp;
