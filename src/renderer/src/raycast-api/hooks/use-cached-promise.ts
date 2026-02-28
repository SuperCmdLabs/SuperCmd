/**
 * raycast-api/hooks/use-cached-promise.ts
 * Purpose: useCachedPromise hook.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { snapshotExtensionContext, withExtensionContext, type ExtensionContextSnapshot } from '../context-scope-runtime';

function resolveInitialDataValue<T>(value: T | (() => T) | undefined): T | undefined {
  if (typeof value === 'function') {
    try {
      return (value as () => T)();
    } catch {
      return undefined;
    }
  }
  return value;
}

export function useCachedPromise<T>(
  fn: (...args: any[]) => Promise<T> | ((...args: any[]) => (...innerArgs: any[]) => Promise<any>),
  args?: any[],
  options?: {
    initialData?: T | (() => T);
    execute?: boolean;
    keepPreviousData?: boolean;
    abortable?: React.MutableRefObject<AbortController | null | undefined>;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    onWillExecute?: (args: any[]) => void;
    failureToastOptions?: any;
  }
): {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
  revalidate: () => void;
  mutate: (asyncUpdate?: Promise<T>, options?: any) => Promise<T | undefined>;
  pagination?: { page: number; pageSize: number; hasMore: boolean; onLoadMore: () => void };
} {
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [accumulatedData, setAccumulatedData] = useState<any | undefined>(() => resolveInitialDataValue(options?.initialData));
  const [isLoading, setIsLoading] = useState(options?.execute !== false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isPaginated, setIsPaginated] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fnRef = useRef(fn);
  const argsRef = useRef(args || []);
  const optionsRef = useRef(options);
  const runtimeCtxRef = useRef<ExtensionContextSnapshot>(snapshotExtensionContext());
  fnRef.current = fn;
  argsRef.current = args || [];
  optionsRef.current = options;
  runtimeCtxRef.current = snapshotExtensionContext();

  const fetchPage = useCallback(async (pageNum: number, currentCursor?: string) => {
    const opts = optionsRef.current;
    if (opts?.execute === false || !mountedRef.current) return;

    setIsLoading(true);
    setError(undefined);

    if (opts?.abortable) {
      const controller = new AbortController();
      opts.abortable.current = controller;
    }

    withExtensionContext(runtimeCtxRef.current, () => {
      opts?.onWillExecute?.(argsRef.current);
    });

    try {
      const outerResult = withExtensionContext(runtimeCtxRef.current, () => fnRef.current(...argsRef.current));

      if (typeof outerResult === 'function') {
        setIsPaginated(true);
        const paginationOptions = { page: pageNum, cursor: currentCursor, lastItem: undefined };
        const innerResult = await withExtensionContext(runtimeCtxRef.current, () => outerResult(paginationOptions));
        if (!mountedRef.current) return;

        if (innerResult && typeof innerResult === 'object' && 'data' in innerResult) {
          const { data: pageData, hasMore: more, cursor: nextCursor } = innerResult;
          setHasMore(more ?? false);
          setCursor(nextCursor);

          if (pageNum === 0) {
            setAccumulatedData(Array.isArray(pageData) ? pageData : []);
          } else {
            setAccumulatedData((prev) => {
              const prevArr = Array.isArray(prev) ? prev : [];
              const newArr = Array.isArray(pageData) ? pageData : [];
              return [...prevArr, ...newArr];
            });
          }

          withExtensionContext(runtimeCtxRef.current, () => {
            opts?.onData?.((innerResult as any).data);
          });
        } else {
          setAccumulatedData(innerResult as any);
          setHasMore(false);
        }
      } else {
        const result = await outerResult;
        if (!mountedRef.current) return;

        if (result && typeof result === 'object' && 'data' in result && 'hasMore' in result) {
          setIsPaginated(true);
          const { data: pageData, hasMore: more, cursor: nextCursor } = result as any;
          setHasMore(more ?? false);
          setCursor(nextCursor);

          if (pageNum === 0) {
            setAccumulatedData(Array.isArray(pageData) ? pageData : []);
          } else {
            setAccumulatedData((prev) => {
              const prevArr = Array.isArray(prev) ? prev : [];
              const newArr = Array.isArray(pageData) ? pageData : [];
              return [...prevArr, ...newArr];
            });
          }

          withExtensionContext(runtimeCtxRef.current, () => {
            opts?.onData?.(pageData as T);
          });
        } else {
          setAccumulatedData(result as any);
          setHasMore(false);
          withExtensionContext(runtimeCtxRef.current, () => {
            opts?.onData?.(result as T);
          });
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      withExtensionContext(runtimeCtxRef.current, () => {
        opts?.onError?.(e);
      });
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  const argsKey = JSON.stringify(args || []);
  useEffect(() => {
    setPage(0);
    setCursor(undefined);
    if (!optionsRef.current?.keepPreviousData) {
      setAccumulatedData(resolveInitialDataValue(optionsRef.current?.initialData));
    }
    fetchPage(0, undefined);
  }, [argsKey, fetchPage]);

  const revalidate = useCallback(() => {
    setPage(0);
    setCursor(undefined);
    if (!optionsRef.current?.keepPreviousData) {
      setAccumulatedData(resolveInitialDataValue(optionsRef.current?.initialData));
    }
    fetchPage(0, undefined);
  }, [fetchPage]);

  const mutate = useCallback(async (asyncUpdate?: Promise<T>, mutateOptions?: any) => {
    const previousData = accumulatedData as T | undefined;

    if (mutateOptions?.optimisticUpdate) {
      try {
        setAccumulatedData(mutateOptions.optimisticUpdate(previousData));
      } catch {
        setAccumulatedData(previousData as any);
      }
    }

    if (asyncUpdate) {
      try {
        const result = await asyncUpdate;
        if (!mutateOptions?.shouldRevalidateAfter) {
          setAccumulatedData(result as any);
        }
        if (mutateOptions?.shouldRevalidateAfter) {
          revalidate();
        }
        return result;
      } catch (error) {
        if (mutateOptions?.rollbackOnError) {
          try {
            setAccumulatedData(mutateOptions.rollbackOnError(previousData));
          } catch {
            setAccumulatedData(previousData as any);
          }
        }
        throw error;
      }
    }

    revalidate();
    return previousData;
  }, [accumulatedData, revalidate]);

  const onLoadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchPage(nextPage, cursor);
    }
  }, [hasMore, isLoading, page, cursor, fetchPage]);

  const pagination = useMemo(() => ({
    page,
    pageSize: 10,
    hasMore,
    onLoadMore,
  }), [page, hasMore, onLoadMore]);

  return {
    data: accumulatedData as T | undefined,
    isLoading,
    error,
    revalidate,
    mutate,
    pagination: isPaginated ? pagination : undefined,
  };
}
