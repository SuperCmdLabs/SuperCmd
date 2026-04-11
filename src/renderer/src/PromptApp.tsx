import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Clipboard, Loader2, Scissors, X } from 'lucide-react';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';
import { applyBaseColor } from './utils/base-color';
import { applyUiStyle } from './utils/ui-style';
import type { ClipboardItem, Snippet } from '../types/electron';

const NO_AI_MODEL_ERROR = 'No AI model available. Configure one in Settings -> AI.';

const PROMPT_DEFAULT_HEIGHT = 90;
const PROMPT_PICKER_HEIGHT = 290;

type PickerMode = 'none' | 'snippet' | 'clipboard';

const PromptApp: React.FC = () => {
  const [promptText, setPromptText] = useState('');
  const [status, setStatus] = useState<'idle' | 'processing' | 'ready' | 'error'>('idle');
  const [errorText, setErrorText] = useState('');
  const [aiAvailable, setAiAvailable] = useState(true);
  const requestIdRef = useRef<string | null>(null);
  const sourceTextRef = useRef('');
  const resultTextRef = useRef('');
  const selectedTextSnapshotRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Picker state
  const [pickerMode, setPickerMode] = useState<PickerMode>('none');
  const [pickerSearch, setPickerSearch] = useState('');
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>([]);
  const [pickerSelectedIndex, setPickerSelectedIndex] = useState(0);
  const pickerSearchRef = useRef<HTMLInputElement>(null);
  const pickerListRef = useRef<HTMLDivElement>(null);
  const pickerModeRef = useRef<PickerMode>('none');

  const resetPromptState = useCallback(async (cancelActiveRequest = false) => {
    if (cancelActiveRequest && requestIdRef.current) {
      try {
        await window.electron.aiCancel(requestIdRef.current);
      } catch {}
    }
    requestIdRef.current = null;
    sourceTextRef.current = '';
    resultTextRef.current = '';
    setPromptText('');
    setStatus('idle');
    setErrorText('');
  }, []);

  const closePrompt = useCallback(async () => {
    await resetPromptState(true);
    await window.electron.closePromptWindow();
  }, [resetPromptState]);

  const applyResult = useCallback(async () => {
    const nextText = String(resultTextRef.current || '');
    if (!nextText.trim()) {
      setStatus('error');
      setErrorText('Model returned an empty response.');
      return;
    }
    const selected = String(sourceTextRef.current || '');
    const ok = await window.electron.promptApplyGeneratedText({
      previousText: selected.trim().length > 0 ? selected : undefined,
      nextText,
    });
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
    const aiReady = await window.electron.aiIsAvailable().catch(() => false);
    setAiAvailable(aiReady);
    if (!aiReady) {
      setStatus('error');
      setErrorText(NO_AI_MODEL_ERROR);
      return;
    }

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

  // ─── Picker helpers ─────────────────────────────────────────────────────────

  const closePicker = useCallback(async () => {
    pickerModeRef.current = 'none';
    setPickerMode('none');
    setPickerSearch('');
    setPickerSelectedIndex(0);
    await window.electron.resizePromptWindow?.(PROMPT_DEFAULT_HEIGHT);
    setTimeout(() => textareaRef.current?.focus(), 30);
  }, []);

  const openPicker = useCallback(async (mode: 'snippet' | 'clipboard') => {
    pickerModeRef.current = mode;
    setPickerMode(mode);
    setPickerSearch('');
    setPickerSelectedIndex(0);
    await window.electron.resizePromptWindow?.(PROMPT_PICKER_HEIGHT);
    setTimeout(() => pickerSearchRef.current?.focus(), 30);

    if (mode === 'snippet') {
      try {
        const items = await window.electron.snippetGetAll();
        setSnippets(items);
      } catch {}
    } else {
      try {
        const items = await window.electron.clipboardGetHistory();
        setClipboardItems(items.filter((i) => i.type === 'text' || i.type === 'url'));
      } catch {}
    }
  }, []);

  const insertTextIntoPrompt = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setPromptText((prev) => prev + (prev ? ' ' : '') + text);
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const newValue = before + text + after;
    setPromptText(newValue);
    // restore cursor after inserted text
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = start + text.length;
      textarea.setSelectionRange(pos, pos);
    });
  }, []);

  const handlePickerSelect = useCallback(async (item: Snippet | ClipboardItem) => {
    let text = '';
    if ('name' in item) {
      // Snippet — render it
      try {
        text = (await window.electron.snippetRender(item.id)) || item.content || '';
      } catch {
        text = item.content || '';
      }
    } else {
      // Clipboard item
      text = item.content || '';
    }
    await closePicker();
    if (text) insertTextIntoPrompt(text);
  }, [closePicker, insertTextIntoPrompt]);

  // Compute the filtered list shown in the picker
  const filteredItems = useMemo((): Array<Snippet | ClipboardItem> => {
    const q = pickerSearch.trim().toLowerCase();
    if (pickerMode === 'snippet') {
      if (!q) return snippets;
      return snippets.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.keyword || '').toLowerCase().includes(q) ||
          s.content.toLowerCase().includes(q),
      );
    }
    if (pickerMode === 'clipboard') {
      if (!q) return clipboardItems;
      return clipboardItems.filter((c) =>
        (c.preview || c.content || '').toLowerCase().includes(q),
      );
    }
    return [];
  }, [pickerMode, pickerSearch, snippets, clipboardItems]);

  // Refresh search results when query changes
  useEffect(() => {
    if (pickerMode === 'none') return;
    const q = pickerSearch.trim();
    if (!q) return;
    const timer = setTimeout(async () => {
      if (pickerModeRef.current === 'snippet') {
        try {
          const items = await window.electron.snippetSearch(q);
          setSnippets(items);
        } catch {}
      } else if (pickerModeRef.current === 'clipboard') {
        try {
          const items = await window.electron.clipboardSearch(q);
          setClipboardItems(items.filter((i) => i.type === 'text' || i.type === 'url'));
        } catch {}
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [pickerSearch, pickerMode]);

  // Keep selectedIndex in bounds as items change
  useEffect(() => {
    setPickerSelectedIndex((prev) => Math.min(prev, Math.max(0, filteredItems.length - 1)));
  }, [filteredItems.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (pickerMode === 'none') return;
    const list = pickerListRef.current;
    if (!list) return;
    const el = list.children[pickerSelectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [pickerSelectedIndex, pickerMode]);

  // ─── Effects ─────────────────────────────────────────────────────────────────

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
    return () => {
      disposed = true;
    };
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
    });
    return cleanupWindowShown;
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      void (async () => {
        await resetPromptState(true);
        const available = await window.electron.aiIsAvailable().catch(() => false);
        setAiAvailable(available);
        if (!available) {
          setStatus('error');
          setErrorText(NO_AI_MODEL_ERROR);
        }
        setTimeout(() => textareaRef.current?.focus(), 20);
      })();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [resetPromptState]);

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
    return () => {
      cancelled = true;
    };
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

  // ─── Picker keyboard handler ──────────────────────────────────────────────────

  const handlePickerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void closePicker();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPickerSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPickerSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = filteredItems[pickerSelectedIndex];
        if (item) void handlePickerSelect(item);
      }
    },
    [closePicker, filteredItems, pickerSelectedIndex, handlePickerSelect],
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  const isPickerOpen = pickerMode !== 'none';

  return (
    <div className="w-full h-full">
      <div className="cursor-prompt-surface h-full flex flex-col gap-1.5 px-3.5 py-2.5 relative">
        <button
          onClick={() => void closePrompt()}
          className="cursor-prompt-close"
          aria-label="Close prompt"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* ── Picker panel ─────────────────────────────────────────── */}
        {isPickerOpen && (
          <div className="cursor-prompt-picker-panel" onKeyDown={handlePickerKeyDown}>
            <div className="cursor-prompt-picker-header">
              <span className="cursor-prompt-picker-title">
                {pickerMode === 'snippet' ? 'Snippets' : 'Clipboard'}
              </span>
              <button
                className="cursor-prompt-picker-close-btn"
                onClick={() => void closePicker()}
                aria-label="Close picker"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <input
              ref={pickerSearchRef}
              className="cursor-prompt-picker-search"
              placeholder={
                pickerMode === 'snippet' ? 'Search snippets…' : 'Search clipboard…'
              }
              value={pickerSearch}
              onChange={(e) => {
                setPickerSearch(e.target.value);
                setPickerSelectedIndex(0);
              }}
            />
            <div ref={pickerListRef} className="cursor-prompt-picker-list">
              {filteredItems.length === 0 ? (
                <div className="cursor-prompt-picker-empty">No results</div>
              ) : (
                filteredItems.map((item, idx) => {
                  const isSnippet = 'name' in item;
                  const label = isSnippet
                    ? (item as Snippet).name
                    : ((item as ClipboardItem).preview || (item as ClipboardItem).content || '').slice(0, 80);
                  const sub = isSnippet
                    ? ((item as Snippet).content || '').slice(0, 60)
                    : '';
                  return (
                    <div
                      key={item.id}
                      className="cursor-prompt-picker-item"
                      aria-selected={idx === pickerSelectedIndex}
                      onClick={() => void handlePickerSelect(item)}
                      onMouseEnter={() => setPickerSelectedIndex(idx)}
                    >
                      <span className="cursor-prompt-picker-item-label">{label}</span>
                      {sub && (
                        <span className="cursor-prompt-picker-item-sub">{sub}</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ── Main prompt area ─────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submitPrompt();
              }
              if (e.key === 'Escape' && !isPickerOpen) {
                e.preventDefault();
                void closePrompt();
              }
            }}
            placeholder="Tell AI what to do with selected text..."
            ref={textareaRef}
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
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                isPickerOpen && pickerMode === 'snippet'
                  ? void closePicker()
                  : void openPicker('snippet')
              }
              className={`cursor-prompt-picker-btn${isPickerOpen && pickerMode === 'snippet' ? ' cursor-prompt-picker-btn--active' : ''}`}
              title="Insert snippet"
              aria-label="Insert snippet"
            >
              <Scissors className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() =>
                isPickerOpen && pickerMode === 'clipboard'
                  ? void closePicker()
                  : void openPicker('clipboard')
              }
              className={`cursor-prompt-picker-btn${isPickerOpen && pickerMode === 'clipboard' ? ' cursor-prompt-picker-btn--active' : ''}`}
              title="Insert from clipboard history"
              aria-label="Insert from clipboard history"
            >
              <Clipboard className="w-3.5 h-3.5" />
            </button>
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
    </div>
  );
};

export default PromptApp;
