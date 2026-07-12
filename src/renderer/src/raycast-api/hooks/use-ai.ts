/**
 * raycast-api/hooks/use-ai.ts
 * Purpose: useAI hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createStreamFlushScheduler } from '../../utils/streamFlushScheduler';

type AICreativity = 'none' | 'low' | 'medium' | 'high' | 'maximum' | number;

export const RAYCAST_AI_STREAM_FLUSH_INTERVAL_MS = 32;

interface RaycastAIStreamDataRef {
  current: string;
}

export interface RaycastAIStreamBatcherOptions {
  dataRef: RaycastAIStreamDataRef;
  setVisibleData: (data: string) => void;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimer?: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
  flushDelayMs?: number;
  isDocumentHidden?: () => boolean;
}

export interface RaycastAIStreamBatcher {
  appendChunk: (chunk: string) => void;
  cancelPendingFlush: () => void;
  flush: () => void;
  reset: (data?: string) => void;
}

export function createRaycastAIStreamBatcher({
  dataRef,
  setVisibleData,
  requestFrame,
  cancelFrame,
  setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimer = globalThis.clearTimeout.bind(globalThis),
  flushDelayMs = RAYCAST_AI_STREAM_FLUSH_INTERVAL_MS,
  isDocumentHidden,
}: RaycastAIStreamBatcherOptions): RaycastAIStreamBatcher {
  let visibleData = dataRef.current;

  const publishVisibleData = () => {
    const nextData = dataRef.current;
    if (nextData === visibleData) return;
    visibleData = nextData;
    setVisibleData(nextData);
  };

  const scheduler = createStreamFlushScheduler(publishVisibleData, {
    requestFrame,
    cancelFrame: cancelFrame as ((handle: unknown) => void) | undefined,
    setTimer,
    clearTimer,
    flushDelayMs,
    isDocumentHidden,
  });

  const flush = () => {
    scheduler.cancel();
    publishVisibleData();
  };

  const scheduleFlush = () => {
    scheduler.schedule();
  };

  return {
    appendChunk(chunk: string) {
      if (!chunk) return;
      dataRef.current += chunk;
      scheduleFlush();
    },
    cancelPendingFlush: scheduler.cancel,
    flush,
    reset(data = '') {
      scheduler.cancel();
      dataRef.current = data;
      visibleData = data;
      setVisibleData(data);
    },
  };
}

export function useAI(
  prompt: string,
  options?: {
    model?: string;
    creativity?: AICreativity;
    execute?: boolean;
    stream?: boolean;
    onError?: (error: Error) => void;
    onData?: (data: string) => void;
    onWillExecute?: (args: [string]) => void;
    failureToastOptions?: any;
  }
) {
  const [data, setData] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const dataRef = useRef('');
  const streamBatcherRef = useRef<RaycastAIStreamBatcher | null>(null);
  const promptRef = useRef(prompt);
  const optionsRef = useRef(options);
  promptRef.current = prompt;
  optionsRef.current = options;

  if (!streamBatcherRef.current) {
    streamBatcherRef.current = createRaycastAIStreamBatcher({
      dataRef,
      setVisibleData: setData,
    });
  }

  const shouldExecute = options?.execute !== false;
  const stream = options?.stream !== false;

  const run = useCallback(() => {
    if (!promptRef.current) return;
    const opts = optionsRef.current;
    const streamBatcher = streamBatcherRef.current;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(undefined);
    streamBatcher?.reset('');

    opts?.onWillExecute?.([promptRef.current]);

    const ai = (window as any).__supercmdRaycastAI;
    if (!ai?.ask) {
      const missingErr = new Error('AI is not available');
      setError(missingErr);
      setIsLoading(false);
      opts?.onError?.(missingErr);
      return;
    }

    const sp = ai.ask(promptRef.current, {
      model: opts?.model,
      creativity: opts?.creativity,
      signal: controller.signal,
    });

    if (stream) {
      sp.on('data', (chunk: string) => {
        if (!controller.signal.aborted) {
          streamBatcher?.appendChunk(chunk);
        }
      });
    }

    sp.then((fullText: string) => {
      if (!controller.signal.aborted) {
        dataRef.current = fullText;
        streamBatcher?.flush();
        setIsLoading(false);
        opts?.onData?.(fullText);
      }
    }).catch((err: any) => {
      if (!controller.signal.aborted) {
        const e = err instanceof Error ? err : new Error(err?.message || 'AI request failed');
        streamBatcher?.flush();
        setError(e);
        setIsLoading(false);
        opts?.onError?.(e);
      }
    });
  }, [stream]);

  useEffect(() => {
    if (shouldExecute) {
      run();
    }
    return () => {
      abortRef.current?.abort();
      streamBatcherRef.current?.cancelPendingFlush();
    };
  }, [shouldExecute, run]);

  return { data, isLoading, error, revalidate: run };
}
