/**
 * raycast-api/hooks/use-stream-json.ts
 * Purpose: useStreamJSON hook.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useStreamJSON<T = any>(
  url: string | Request,
  options?: RequestInit & {
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
  }
) {
  const pageSize = options?.pageSize ?? 20;
  const [allItems, setAllItems] = useState<T[]>(options?.initialData || []);
  const [isLoading, setIsLoading] = useState(options?.execute !== false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fetchAndParse = useCallback(async () => {
    const opts = optionsRef.current;
    if (opts?.execute === false) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const resolvedUrl = typeof url === 'string' ? url : url.url;
      const res = await fetch(resolvedUrl, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();

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

      setAllItems(items as T[]);
      items.forEach((item) => opts?.onData?.(item as T));
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      opts?.onError?.(e);
    } finally {
      setIsLoading(false);
    }
  }, [url]);

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
