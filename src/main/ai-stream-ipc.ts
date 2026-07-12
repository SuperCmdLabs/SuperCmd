export const AI_STREAM_IPC_FLUSH_MS = 16;

export interface AIStreamIpcSender {
  send: (channel: 'ai-stream-chunk', payload: { requestId: string; chunk: string }) => void;
}

export interface AIStreamIpcCoalescerOptions {
  requestId: string;
  sender: AIStreamIpcSender;
  flushIntervalMs?: number;
  scheduleFlush?: (callback: () => void, delayMs: number) => unknown;
  cancelFlush?: (handle: unknown) => void;
}

export interface AIStreamIpcCoalescer {
  appendChunk: (chunk: string) => void;
  cancelPendingFlush: () => void;
  flush: () => boolean;
  hasPendingChunk: () => boolean;
  hasPendingFlush: () => boolean;
}

export function createAIStreamIpcCoalescer({
  requestId,
  sender,
  flushIntervalMs = AI_STREAM_IPC_FLUSH_MS,
  scheduleFlush = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelFlush = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: AIStreamIpcCoalescerOptions): AIStreamIpcCoalescer {
  let pendingChunk = '';
  let flushHandle: unknown = null;

  const cancelPendingFlush = () => {
    if (flushHandle === null) return;
    cancelFlush(flushHandle);
    flushHandle = null;
  };

  const flush = () => {
    cancelPendingFlush();
    if (!pendingChunk) return false;
    const chunk = pendingChunk;
    pendingChunk = '';
    sender.send('ai-stream-chunk', { requestId, chunk });
    return true;
  };

  const scheduleNextFlush = () => {
    if (flushHandle !== null) return;
    flushHandle = scheduleFlush(() => {
      flushHandle = null;
      flush();
    }, flushIntervalMs);
  };

  return {
    appendChunk(chunk) {
      if (!chunk) return;
      pendingChunk += chunk;
      scheduleNextFlush();
    },
    cancelPendingFlush,
    flush,
    hasPendingChunk() {
      return pendingChunk.length > 0;
    },
    hasPendingFlush() {
      return flushHandle !== null;
    },
  };
}

export async function forwardAIStreamChunksToIpc(
  chunks: AsyncIterable<string>,
  coalescer: AIStreamIpcCoalescer,
  signal: AbortSignal
): Promise<void> {
  for await (const chunk of chunks) {
    if (signal.aborted) break;
    coalescer.appendChunk(chunk);
  }
}
