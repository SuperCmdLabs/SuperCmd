import { createStreamFlushScheduler } from '../utils/streamFlushScheduler';

export const CURSOR_PROMPT_RESULT_FLUSH_INTERVAL_MS = 32;

export interface CursorPromptResultRef {
  current: string;
}

export interface CursorPromptResultBatcherOptions {
  resultRef: CursorPromptResultRef;
  setVisibleResult: (value: string) => void;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimer?: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
  flushDelayMs?: number;
  isDocumentHidden?: () => boolean;
}

export interface CursorPromptResultBatcher {
  appendChunk: (chunk: string) => void;
  flush: () => void;
  reset: (nextResult?: string) => void;
  cancelPendingFlush: () => void;
  dispose: () => void;
}

export function createCursorPromptResultBatcher({
  resultRef,
  setVisibleResult,
  requestFrame,
  cancelFrame,
  setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimer = globalThis.clearTimeout.bind(globalThis),
  flushDelayMs = CURSOR_PROMPT_RESULT_FLUSH_INTERVAL_MS,
  isDocumentHidden,
}: CursorPromptResultBatcherOptions): CursorPromptResultBatcher {
  let visibleResult = resultRef.current;

  const publishVisibleResult = () => {
    const nextResult = resultRef.current;
    if (nextResult === visibleResult) return;
    visibleResult = nextResult;
    setVisibleResult(nextResult);
  };

  const scheduler = createStreamFlushScheduler(publishVisibleResult, {
    requestFrame,
    cancelFrame: cancelFrame as ((handle: unknown) => void) | undefined,
    setTimer,
    clearTimer,
    flushDelayMs,
    isDocumentHidden,
  });

  const scheduleFlush = () => {
    scheduler.schedule();
  };

  return {
    appendChunk(chunk: string) {
      if (!chunk) return;
      resultRef.current += chunk;
      scheduleFlush();
    },
    flush() {
      scheduler.cancel();
      publishVisibleResult();
    },
    reset(nextResult = '') {
      scheduler.cancel();
      resultRef.current = nextResult;
      visibleResult = nextResult;
      setVisibleResult(nextResult);
    },
    cancelPendingFlush: scheduler.cancel,
    dispose: scheduler.cancel,
  };
}
