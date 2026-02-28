/**
 * raycast-api/hooks/use-ai.ts
 * Purpose: useAI hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type AICreativity = 'none' | 'low' | 'medium' | 'high' | 'maximum' | number;

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
  const promptRef = useRef(prompt);
  const optionsRef = useRef(options);
  promptRef.current = prompt;
  optionsRef.current = options;

  const shouldExecute = options?.execute !== false;
  const stream = options?.stream !== false;

  const run = useCallback(() => {
    if (!promptRef.current) return;
    const opts = optionsRef.current;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(undefined);
    setData('');

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
          setData((prev) => prev + chunk);
        }
      });
    }

    sp.then((fullText: string) => {
      if (!controller.signal.aborted) {
        if (!stream) setData(fullText);
        setIsLoading(false);
        opts?.onData?.(fullText);
      }
    }).catch((err: any) => {
      if (!controller.signal.aborted) {
        const e = err instanceof Error ? err : new Error(err?.message || 'AI request failed');
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
    };
  }, [shouldExecute, run]);

  return { data, isLoading, error, revalidate: run };
}
