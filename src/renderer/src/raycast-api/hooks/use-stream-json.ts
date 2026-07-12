/**
 * raycast-api/hooks/use-stream-json.ts
 * Purpose: useStreamJSON hook.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type UseStreamJSONOptions<T> = RequestInit & {
  filter?: (item: T) => boolean;
  transform?: (item: any) => T;
  dataPath?: string | RegExp;
  pageSize?: number;
  initialData?: T[];
  keepPreviousData?: boolean;
  execute?: boolean;
  onError?: (error: Error) => void;
  onData?: (data: T) => void;
  onWillExecute?: (args: [string, RequestInit]) => void;
  failureToastOptions?: any;
};

function abortWithSignalReason(controller: AbortController, signal: AbortSignal) {
  if (controller.signal.aborted) return;
  try {
    controller.abort(signal.reason);
  } catch {
    controller.abort();
  }
}

function composeAbortSignal(lifecycleSignal: AbortSignal, callerSignal?: AbortSignal | null) {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  const observedSignals = new Set<AbortSignal>();

  const observe = (signal?: AbortSignal | null) => {
    if (!signal || observedSignals.has(signal)) return;
    observedSignals.add(signal);

    if (signal.aborted) {
      abortWithSignalReason(controller, signal);
      return;
    }

    const abort = () => abortWithSignalReason(controller, signal);
    signal.addEventListener('abort', abort, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', abort));
  };

  observe(lifecycleSignal);
  observe(callerSignal);

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

export function useStreamJSON<T = any>(
  url: string | Request,
  options?: UseStreamJSONOptions<T>
) {
  const pageSize = options?.pageSize ?? 20;
  const [allItems, setAllItems] = useState<T[]>(options?.initialData || []);
  const [isLoading, setIsLoading] = useState(options?.execute !== false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const mountedRef = useRef(true);
  const runIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const abortCurrentRun = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller) return;
    controller.abort();
    abortControllerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      abortCurrentRun();
    };
  }, [abortCurrentRun]);

  const fetchAndParse = useCallback(async () => {
    const opts = optionsRef.current;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    abortCurrentRun();

    if (opts?.execute === false || !mountedRef.current) return;

    const lifecycleController = new AbortController();
    const composedAbort = composeAbortSignal(lifecycleController.signal, opts?.signal);
    const isCurrentRun = () => (
      mountedRef.current
      && runIdRef.current === runId
      && abortControllerRef.current === lifecycleController
    );
    abortControllerRef.current = lifecycleController;

    setIsLoading(true);
    setError(undefined);

    try {
      const resolvedUrl = typeof url === 'string' ? url : url.url;
      const fetchOptions: RequestInit = {
        ...(opts || {}),
        signal: composedAbort.signal,
      };
      const res = await fetch(resolvedUrl, fetchOptions);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      if (!isCurrentRun()) return;

      let items: any[];
      if (opts?.dataPath) {
        if (typeof opts.dataPath === 'string') {
          items = opts.dataPath.split('.').reduce((obj: any, key: string) => obj?.[key], json);
        } else {
          const match = Object.keys(json).find((k) => (opts.dataPath as RegExp).test(k));
          items = match ? json[match] : json;
        }
      } else {
        items = Array.isArray(json) ? json : [json];
      }

      if (!Array.isArray(items)) items = [items];
      if (opts?.transform) items = items.map(opts.transform);
      if (opts?.filter) items = items.filter(opts.filter);
      if (!isCurrentRun()) return;

      setAllItems(items as T[]);
      for (const item of items) {
        if (!isCurrentRun()) break;
        opts?.onData?.(item as T);
      }
    } catch (err) {
      if (!isCurrentRun() || lifecycleController.signal.aborted) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      opts?.onError?.(e);
    } finally {
      composedAbort.cleanup();
      const shouldFinishCurrentRun = isCurrentRun();
      if (abortControllerRef.current === lifecycleController) {
        abortControllerRef.current = null;
      }
      if (shouldFinishCurrentRun) {
        setIsLoading(false);
      }
    }
  }, [url, abortCurrentRun]);

  useEffect(() => {
    fetchAndParse();
  }, [fetchAndParse]);

  const revalidate = useCallback(() => {
    setAllItems([]);
    setDisplayCount(pageSize);
    fetchAndParse();
  }, [fetchAndParse, pageSize]);

  const mutate = useCallback(async (asyncUpdate?: Promise<any>, mutateOptions?: any) => {
    if (mutateOptions?.optimisticUpdate) {
      setAllItems(mutateOptions.optimisticUpdate(allItems));
    }

    if (asyncUpdate) {
      try {
        await asyncUpdate;
      } catch (e) {
        if (mutateOptions?.rollbackOnError) revalidate();
        throw e;
      }
    }
  }, [allItems, revalidate]);

  const hasMore = displayCount < allItems.length;
  const pagination = useMemo(() => ({
    pageSize,
    hasMore,
    onLoadMore: () => {
      if (hasMore) setDisplayCount((prev) => prev + pageSize);
    },
  }), [pageSize, hasMore]);

  return {
    data: allItems.slice(0, displayCount),
    isLoading,
    error,
    revalidate,
    mutate,
    pagination,
  };
}
