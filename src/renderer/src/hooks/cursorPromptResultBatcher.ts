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
}

export interface CursorPromptResultBatcher {
  appendChunk: (chunk: string) => void;
  flush: () => void;
  reset: (nextResult?: string) => void;
  cancelPendingFlush: () => void;
  dispose: () => void;
}

function createDefaultRequestFrame(): ((callback: () => void) => number) | undefined {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return undefined;
  }
  return (callback) => window.requestAnimationFrame(() => callback());
}

function createDefaultCancelFrame(): ((handle: number) => void) | undefined {
  if (typeof window === 'undefined' || typeof window.cancelAnimationFrame !== 'function') {
    return undefined;
  }
  return (handle) => window.cancelAnimationFrame(handle);
}

export function createCursorPromptResultBatcher({
  resultRef,
  setVisibleResult,
  requestFrame = createDefaultRequestFrame(),
  cancelFrame = createDefaultCancelFrame(),
  setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimer = globalThis.clearTimeout.bind(globalThis),
  flushDelayMs = CURSOR_PROMPT_RESULT_FLUSH_INTERVAL_MS,
}: CursorPromptResultBatcherOptions): CursorPromptResultBatcher {
  let visibleResult = resultRef.current;
  let pendingFrame: number | null = null;
  let pendingTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const publishVisibleResult = () => {
    const nextResult = resultRef.current;
    if (nextResult === visibleResult) return;
    visibleResult = nextResult;
    setVisibleResult(nextResult);
  };

  const cancelPendingFlush = () => {
    if (pendingFrame !== null) {
      cancelFrame?.(pendingFrame);
      pendingFrame = null;
    }
    if (pendingTimer !== null) {
      clearTimer(pendingTimer);
      pendingTimer = null;
    }
  };

  const runScheduledFlush = () => {
    pendingFrame = null;
    pendingTimer = null;
    publishVisibleResult();
  };

  const scheduleFlush = () => {
    if (pendingFrame !== null || pendingTimer !== null) return;

    if (requestFrame) {
      pendingFrame = requestFrame(runScheduledFlush);
      return;
    }

    pendingTimer = setTimer(runScheduledFlush, flushDelayMs);
  };

  return {
    appendChunk(chunk: string) {
      if (!chunk) return;
      resultRef.current += chunk;
      scheduleFlush();
    },
    flush() {
      cancelPendingFlush();
      publishVisibleResult();
    },
    reset(nextResult = '') {
      cancelPendingFlush();
      resultRef.current = nextResult;
      visibleResult = nextResult;
      setVisibleResult(nextResult);
    },
    cancelPendingFlush,
    dispose: cancelPendingFlush,
  };
}
