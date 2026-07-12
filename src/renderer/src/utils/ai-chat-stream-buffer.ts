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
  let flushHandle: unknown = null;

  const clearScheduledFlush = () => {
    if (flushHandle === null) return;
    cancelFlush(flushHandle);
    flushHandle = null;
  };

  const flushNow = () => {
    clearScheduledFlush();
    if (visibleContent === content) return false;
    visibleContent = content;
    onFlush(content);
    return true;
  };

  const scheduleNextFlush = () => {
    if (flushHandle !== null) return;
    flushHandle = scheduleFlush(() => {
      flushHandle = null;
      flushNow();
    }, flushIntervalMs);
  };

  return {
    append(chunk) {
      if (!chunk) return;
      content += chunk;
      scheduleNextFlush();
    },
    cancel() {
      clearScheduledFlush();
    },
    flushNow,
    getContent() {
      return content;
    },
    hasPendingFlush() {
      return flushHandle !== null;
    },
    reset(nextContent = '') {
      clearScheduledFlush();
      content = nextContent;
      visibleContent = nextContent;
    },
  };
}
