import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Loader2, X } from 'lucide-react';

const PromptApp: React.FC = () => {
  const [promptText, setPromptText] = useState('');
  const [status, setStatus] = useState<'idle' | 'processing' | 'ready' | 'error'>('idle');
  const [errorText, setErrorText] = useState('');
  const requestIdRef = useRef<string | null>(null);
  const sourceTextRef = useRef('');
  const resultTextRef = useRef('');

  const closePrompt = useCallback(async () => {
    if (requestIdRef.current) {
      try {
        await window.electron.aiCancel(requestIdRef.current);
      } catch {}
      requestIdRef.current = null;
    }
    await window.electron.closePromptWindow();
  }, []);

  const applyResult = useCallback(async () => {
    const nextText = String(resultTextRef.current || '').trim();
    if (!nextText) {
      setStatus('error');
      setErrorText('Model returned an empty response.');
      return;
    }
    const selected = String(sourceTextRef.current || '').trim();
    const ok = selected
      ? await window.electron.replaceLiveText(selected, nextText)
      : await window.electron.typeTextLive(nextText);
    if (!ok) {
      setStatus('error');
      setErrorText('Could not apply update in the editor.');
      return;
    }
    setStatus('ready');
  }, []);

  const submitPrompt = useCallback(async () => {
    const instruction = promptText.trim();
    if (!instruction || status === 'processing') return;

    if (requestIdRef.current) {
      try {
        await window.electron.aiCancel(requestIdRef.current);
      } catch {}
      requestIdRef.current = null;
    }

    setStatus('processing');
    setErrorText('');
    sourceTextRef.current = '';
    resultTextRef.current = '';

    const selectedText = String(await window.electron.getSelectedText()).trim();
    if (selectedText) sourceTextRef.current = selectedText;

    const requestId = `prompt-window-${Date.now()}`;
    requestIdRef.current = requestId;
    const compositePrompt = selectedText
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
  }, [promptText, status]);

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
    window.electron.onAIStreamChunk(handleChunk);
    window.electron.onAIStreamDone(handleDone);
    window.electron.onAIStreamError(handleError);
  }, [applyResult]);

  return (
    <div className="w-full h-full p-1">
      <div className="cursor-prompt-surface h-full flex flex-col gap-1.5 px-3.5 py-2.5">
        <div className="cursor-prompt-topbar">
          <button
            onClick={() => void closePrompt()}
            className="cursor-prompt-close"
            aria-label="Close prompt"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submitPrompt();
              }
            }}
            placeholder="Tell AI what to do with selected text..."
            className="cursor-prompt-textarea w-full bg-transparent border-none outline-none text-white/95 placeholder-white/42 text-[13px] font-medium tracking-[0.003em]"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="cursor-prompt-feedback">
            {status === 'processing' && (
              <div className="cursor-prompt-inline-status">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Processing...</span>
              </div>
            )}
            {status === 'error' && errorText && (
              <div className="cursor-prompt-error">{errorText}</div>
            )}
            {status === 'ready' && (
              <div className="cursor-prompt-success">Applied in editor</div>
            )}
          </div>
          <button
            onClick={() => void submitPrompt()}
            className="cursor-prompt-submit"
            disabled={!promptText.trim() || status === 'processing'}
            title="Submit prompt"
          >
            <CornerDownLeft className="w-3 h-3" />
            <span>Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptApp;

