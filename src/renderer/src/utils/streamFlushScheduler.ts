export const DEFAULT_STREAM_FLUSH_INTERVAL_MS = 32;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export interface StreamFlushSchedulerOptions {
  requestFrame?: (callback: () => void) => unknown;
  cancelFrame?: (handle: unknown) => void;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  flushDelayMs?: number;
  isDocumentHidden?: () => boolean;
  useAnimationFrame?: boolean;
}

export interface StreamFlushScheduler {
  cancel: () => void;
  isPending: () => boolean;
  schedule: () => void;
}

function createDefaultRequestFrame(): ((callback: () => void) => unknown) | undefined {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return undefined;
  }
  return (callback) => window.requestAnimationFrame(() => callback());
}

function createDefaultCancelFrame(): ((handle: unknown) => void) | undefined {
  if (typeof window === 'undefined' || typeof window.cancelAnimationFrame !== 'function') {
    return undefined;
  }
  return (handle) => window.cancelAnimationFrame(handle as number);
}

function createDefaultDocumentHiddenGetter(): () => boolean {
  return () => {
    if (typeof document !== 'undefined') {
      return document.hidden === true;
    }
    if (typeof window !== 'undefined' && window.document) {
      return window.document.hidden === true;
    }
    return false;
  };
}

export function createStreamFlushScheduler(
  onFlush: () => void,
  {
    requestFrame = createDefaultRequestFrame(),
    cancelFrame = createDefaultCancelFrame(),
    setTimer = globalThis.setTimeout.bind(globalThis),
    clearTimer = globalThis.clearTimeout.bind(globalThis),
    flushDelayMs = DEFAULT_STREAM_FLUSH_INTERVAL_MS,
    isDocumentHidden = createDefaultDocumentHiddenGetter(),
    useAnimationFrame = true,
  }: StreamFlushSchedulerOptions = {}
): StreamFlushScheduler {
  let pendingFrame: unknown = null;
  let pendingTimer: TimerHandle | null = null;

  const cancel = () => {
    if (pendingFrame !== null) {
      cancelFrame?.(pendingFrame);
      pendingFrame = null;
    }
    if (pendingTimer !== null) {
      clearTimer(pendingTimer);
      pendingTimer = null;
    }
  };

  const run = () => {
    pendingFrame = null;
    pendingTimer = null;
    onFlush();
  };

  return {
    cancel,
    isPending() {
      return pendingFrame !== null || pendingTimer !== null;
    },
    schedule() {
      if (pendingFrame !== null || pendingTimer !== null) return;

      if (useAnimationFrame && requestFrame && !isDocumentHidden()) {
        pendingFrame = requestFrame(run);
        return;
      }

      pendingTimer = setTimer(run, flushDelayMs);
    },
  };
}
