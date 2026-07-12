import { createStreamFlushScheduler } from './streamFlushScheduler';

export const AI_CHAT_STREAM_FLUSH_MS = 40;

export interface AiChatStreamBufferOptions {
  flushIntervalMs?: number;
  onFlush: (content: string) => void;
  scheduleFlush?: (callback: () => void, delayMs: number) => unknown;
  cancelFlush?: (handle: unknown) => void;
}

export interface AiChatStreamBuffer {
  append: (chunk: string) => void;
  cancel: () => void;
  flushNow: () => boolean;
  getContent: () => string;
  hasPendingFlush: () => boolean;
  reset: (content?: string) => void;
}

export function createAiChatStreamBuffer({
  flushIntervalMs = AI_CHAT_STREAM_FLUSH_MS,
  onFlush,
  scheduleFlush = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelFlush = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: AiChatStreamBufferOptions): AiChatStreamBuffer {
  let content = '';
  let visibleContent = '';

  const publishVisibleContent = () => {
    if (visibleContent === content) return false;
    visibleContent = content;
    onFlush(content);
    return true;
  };

  const scheduler = createStreamFlushScheduler(publishVisibleContent, {
    flushDelayMs: flushIntervalMs,
    requestFrame: undefined,
    cancelFrame: undefined,
    setTimer: (callback, delayMs) => scheduleFlush(callback, delayMs) as ReturnType<typeof globalThis.setTimeout>,
    clearTimer: (handle) => cancelFlush(handle),
    useAnimationFrame: false,
  });

  const flushNow = () => {
    scheduler.cancel();
    return publishVisibleContent();
  };

  const scheduleNextFlush = () => {
    scheduler.schedule();
  };

  return {
    append(chunk) {
      if (!chunk) return;
      content += chunk;
      scheduleNextFlush();
    },
    cancel() {
      scheduler.cancel();
    },
    flushNow,
    getContent() {
      return content;
    },
    hasPendingFlush() {
      return scheduler.isPending();
    },
    reset(nextContent = '') {
      scheduler.cancel();
      content = nextContent;
      visibleContent = nextContent;
    },
  };
}
