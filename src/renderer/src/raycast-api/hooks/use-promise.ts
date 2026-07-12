/**
 * raycast-api/hooks/use-promise.ts
 * Purpose: usePromise hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { snapshotExtensionContext, withExtensionContext, type ExtensionContextSnapshot } from '../context-scope-runtime';

function useStableArgs(args: any[]): any[] {
  const ref = useRef(args);
  const prevKey = useRef('');

  let key: string;
  try {
    key = JSON.stringify(args);
  } catch {
    key = String(args);
  }

  if (prevKey.current !== key) {
    prevKey.current = key;
    ref.current = args;
  }

  return ref.current;
}

export function usePromise<T>(
  fn: (...args: any[]) => Promise<T>,
  args?: any[],
  options?: {
    initialData?: T;
    execute?: boolean;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    onWillExecute?: (args: any[]) => void;
    abortable?: React.MutableRefObject<AbortController | null | undefined>;
    failureToastOptions?: any;
  }
): {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
  revalidate: () => void;
  mutate: (asyncUpdate?: Promise<T>, options?: any) => Promise<T | undefined>;
} {
  const [data, setData] = useState<T | undefined>(options?.initialData);
  const [isLoading, setIsLoading] = useState(options?.execute !== false);
  const [error, setError] = useState<Error | undefined>(undefined);

  const mountedRef = useRef(true);
  const latestRunIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortableRefRef = useRef<React.MutableRefObject<AbortController | null | undefined> | undefined>(undefined);

  const stableArgs = useStableArgs(args || []);

  const fnRef = useRef(fn);
  const argsRef = useRef(stableArgs);
  const optionsRef = useRef(options);
  const runtimeCtxRef = useRef<ExtensionContextSnapshot>(snapshotExtensionContext());
  fnRef.current = fn;
  argsRef.current = stableArgs;
  optionsRef.current = options;
  runtimeCtxRef.current = snapshotExtensionContext();

  const clearAbortController = useCallback((controller: AbortController) => {
    const abortableRef = abortableRefRef.current;
    if (abortableRef?.current === controller) {
      abortableRef.current = null;
    }
    if (abortControllerRef.current === controller) {
      abortControllerRef.current = null;
      if (abortableRefRef.current === abortableRef) {
        abortableRefRef.current = undefined;
      }
    }
  }, []);

  const abortCurrentRun = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller) return;
    controller.abort();
    clearAbortController(controller);
  }, [clearAbortController]);

  const prepareAbortController = useCallback((abortable?: React.MutableRefObject<AbortController | null | undefined>) => {
    abortCurrentRun();
    if (!abortable) return null;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    abortableRefRef.current = abortable;
    abortable.current = controller;
    return controller;
  }, [abortCurrentRun]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortCurrentRun();
    };
  }, [abortCurrentRun]);

  const execute = useCallback(() => {
    const opts = optionsRef.current;
    if (opts?.execute === false || !mountedRef.current) return;

    const runController = prepareAbortController(opts?.abortable);
    const runId = ++latestRunIdRef.current;
    const runCtx = runtimeCtxRef.current;
    const isCurrentRun = () => latestRunIdRef.current === runId && (!runController || abortControllerRef.current === runController);

    setIsLoading(true);
    setError(undefined);
    withExtensionContext(runCtx, () => {
      opts?.onWillExecute?.(argsRef.current);
    });

    Promise.resolve()
      .then(() => withExtensionContext(runCtx, () => fnRef.current(...argsRef.current)))
      .then((result) => {
        if (!mountedRef.current || !isCurrentRun()) return;
        setData(result);
        setIsLoading(false);
        withExtensionContext(runCtx, () => {
          opts?.onData?.(result);
        });
      })
      .catch((err) => {
        if (!mountedRef.current || !isCurrentRun()) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setIsLoading(false);
        withExtensionContext(runCtx, () => {
          opts?.onError?.(e);
        });
      })
      .finally(() => {
        if (runController) {
          clearAbortController(runController);
        }
      });
  }, [options?.execute, prepareAbortController, clearAbortController]);

  useEffect(() => {
    execute();
  }, [execute, stableArgs]);

  const revalidate = useCallback(() => {
    execute();
  }, [execute]);

  const mutate = useCallback(async (asyncUpdate?: Promise<T>, mutateOptions?: any) => {
    if (mutateOptions?.optimisticUpdate) {
      setData(mutateOptions.optimisticUpdate(data));
    }

    if (asyncUpdate) {
      try {
        const result = await asyncUpdate;
        if (!mutateOptions?.shouldRevalidateAfter) {
          setData(result);
        }
        return result;
      } catch (e) {
        if (mutateOptions?.rollbackOnError) {
          revalidate();
        }
        throw e;
      }
    }

    revalidate();
    return data;
  }, [data, revalidate]);

  return { data, isLoading, error, revalidate, mutate };
}
