/**
 * raycast-api/hooks/use-promise.ts
 * Purpose: usePromise hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { snapshotExtensionContext, withExtensionContext, type ExtensionContextSnapshot } from '../context-scope-runtime';

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
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fnRef = useRef(fn);
  const argsRef = useRef(args || []);
  const runtimeCtxRef = useRef<ExtensionContextSnapshot>(snapshotExtensionContext());
  fnRef.current = fn;
  argsRef.current = args || [];
  runtimeCtxRef.current = snapshotExtensionContext();

  const execute = useCallback(() => {
    if (options?.execute === false || !mountedRef.current) return;

    setIsLoading(true);
    setError(undefined);
    withExtensionContext(runtimeCtxRef.current, () => {
      options?.onWillExecute?.(argsRef.current);
    });

    Promise.resolve()
      .then(() => withExtensionContext(runtimeCtxRef.current, () => fnRef.current(...argsRef.current)))
      .then((result) => {
        if (!mountedRef.current) return;
        setData(result);
        setIsLoading(false);
        withExtensionContext(runtimeCtxRef.current, () => {
          options?.onData?.(result);
        });
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setIsLoading(false);
        withExtensionContext(runtimeCtxRef.current, () => {
          options?.onError?.(e);
        });
      });
  }, [options?.execute]);

  useEffect(() => {
    execute();
  }, [execute, ...(args || [])]);

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
