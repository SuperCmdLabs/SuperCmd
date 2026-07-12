export const NATIVE_HELPER_LINE_BUFFER_MAX_CHARS = 256 * 1024;

export type NativeHelperLineBufferResult = {
  buffer: string;
  lines: string[];
  truncated: boolean;
};

export function appendNativeHelperTextBuffer(
  buffer: string,
  chunk: Buffer | string,
  maxChars = NATIVE_HELPER_LINE_BUFFER_MAX_CHARS
): { buffer: string; truncated: boolean } {
  const combined = buffer + chunk.toString();
  if (combined.length <= maxChars) {
    return { buffer: combined, truncated: false };
  }
  return { buffer: combined.slice(-maxChars), truncated: true };
}

export function appendNativeHelperLineBuffer(
  buffer: string,
  chunk: Buffer | string,
  maxChars = NATIVE_HELPER_LINE_BUFFER_MAX_CHARS
): NativeHelperLineBufferResult {
  const combined = buffer + chunk.toString();
  const rawLines = combined.split('\n');
  let nextBuffer = rawLines.pop() ?? '';
  let truncated = false;
  const lines: string[] = [];

  for (const line of rawLines) {
    lines.push(line);
  }

  if (nextBuffer.length > maxChars) {
    nextBuffer = nextBuffer.slice(-maxChars);
    truncated = true;
  }

  return { buffer: nextBuffer, lines, truncated };
}

export type NativeHelperReadinessWait = {
  promise: Promise<void>;
  markReady: () => void;
  reject: (error: Error) => void;
};

export function createNativeHelperReadinessWait(options: {
  timeoutMs: number;
  timeoutMessage: string;
  supersededMessage: string;
  diedMessage: string;
  isActive: () => boolean;
  isKilled: () => boolean;
  kill: () => void;
}): NativeHelperReadinessWait {
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let resolvePromise: (() => void) | null = null;
  let rejectPromise: ((error: Error) => void) | null = null;

  const cleanup = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    resolvePromise = null;
    rejectPromise = null;
  };

  const settle = (error?: Error) => {
    if (settled) return;
    settled = true;
    const resolve = resolvePromise;
    const reject = rejectPromise;
    cleanup();
    if (error) {
      reject?.(error);
    } else {
      resolve?.();
    }
  };

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
    timeout = setTimeout(() => {
      if (!options.isActive()) {
        settle(new Error(options.supersededMessage));
        return;
      }
      settle(new Error(options.timeoutMessage));
      options.kill();
    }, options.timeoutMs);
  });

  return {
    promise,
    markReady: () => {
      if (!options.isActive()) {
        settle(new Error(options.supersededMessage));
        return;
      }
      if (options.isKilled()) {
        settle(new Error(options.diedMessage));
        return;
      }
      settle();
    },
    reject: (error: Error) => {
      settle(error);
    },
  };
}
