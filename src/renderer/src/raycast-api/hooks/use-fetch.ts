/**
 * raycast-api/hooks/use-fetch.ts
 * Purpose: useFetch hook.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useFetch<T = any, U = undefined>(
  url: string | ((options: { page: number; cursor?: string; lastItem?: any }) => string),
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    mapResult?: (result: any) => { data: T; hasMore?: boolean; cursor?: string } | T;
    parseResponse?: (response: Response) => Promise<any>;
    initialData?: T;
    execute?: boolean;
    keepPreviousData?: boolean;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    onWillExecute?: () => void;
    failureToastOptions?: any;
  }
): {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
  revalidate: () => void;
  mutate: (asyncUpdate?: Promise<T>, options?: any) => Promise<T | undefined>;
  pagination: { page: number; pageSize: number; hasMore: boolean; onLoadMore: () => void };
} {
  const normalizeRequestBody = (body: any): BodyInit | undefined => {
    if (body == null) return undefined;
    if (typeof body === 'string') return body;
    if (body instanceof FormData) return body;
    if (body instanceof URLSearchParams) return body;
    if (body instanceof Blob) return body;
    return JSON.stringify(body);
  };

  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [allData, setAllData] = useState<T | undefined>(options?.initialData);
  const [isLoading, setIsLoading] = useState(options?.execute !== false);
  const [error, setError] = useState<Error | undefined>(undefined);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const urlRef = useRef(url);
  const optionsRef = useRef(options);
  urlRef.current = url;
  optionsRef.current = options;

  const fetchData = useCallback(async (pageNum: number, currentCursor?: string) => {
    const opts = optionsRef.current;
    if (opts?.execute === false || !mountedRef.current) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const resolvedUrl = typeof urlRef.current === 'function'
        ? urlRef.current({ page: pageNum, cursor: currentCursor, lastItem: undefined })
        : urlRef.current;

      const ipcRes = await window.electron.httpRequest({
        url: resolvedUrl,
        method: opts?.method,
        headers: opts?.headers,
        body: normalizeRequestBody(opts?.body) as string | undefined,
      });

      const res = {
        ok: ipcRes.status >= 200 && ipcRes.status < 300,
        status: ipcRes.status,
        statusText: ipcRes.statusText,
        headers: new Headers(ipcRes.headers || {}),
        url: ipcRes.url,
        text: async () => ipcRes.bodyText,
        json: async () => JSON.parse(ipcRes.bodyText),
      } as any;

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const parsed = opts?.parseResponse ? await opts.parseResponse(res) : await res.json();
      if (!mountedRef.current) return;

      const mapped = opts?.mapResult ? opts.mapResult(parsed) : parsed;
      if (mapped && typeof mapped === 'object' && 'data' in mapped) {
        const paginatedResult = mapped as { data: T; hasMore?: boolean; cursor?: string };
        setHasMore(paginatedResult.hasMore ?? false);
        setCursor(paginatedResult.cursor);

        setAllData((prev) => {
          if (pageNum === 0) return paginatedResult.data;
          if (Array.isArray(paginatedResult.data) && Array.isArray(prev)) {
            return [...prev, ...paginatedResult.data] as unknown as T;
          }
          return paginatedResult.data;
        });
        opts?.onData?.(paginatedResult.data);
      } else {
        setAllData(mapped as T);
        setHasMore(false);
        opts?.onData?.(mapped as T);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      opts?.onError?.(e);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  const urlString = typeof url === 'string' ? url : 'function';
  const optionsKey = useMemo(() => {
    try {
      return JSON.stringify({
        execute: options?.execute ?? true,
        method: options?.method || 'GET',
        headers: options?.headers || null,
        body: options?.body || null,
      });
    } catch {
      return String(options?.execute ?? true);
    }
  }, [options?.execute, options?.method, options?.headers, options?.body]);

  useEffect(() => {
    if (options?.execute === false) {
      setIsLoading(false);
      setError(undefined);
      setAllData(options?.initialData);
      return;
    }
    setPage(0);
    setCursor(undefined);
    setAllData(options?.initialData);
    fetchData(0, undefined);
  }, [fetchData, urlString, optionsKey]);

  const revalidate = useCallback(() => {
    setPage(0);
    setCursor(undefined);
    setAllData(undefined);
    fetchData(0, undefined);
  }, [fetchData]);

  const mutate = useCallback(async (asyncUpdate?: Promise<T>, mutateOptions?: { optimisticUpdate?: (data: T | undefined) => T; rollbackOnError?: boolean | ((data: T | undefined) => T); shouldRevalidateAfter?: boolean }) => {
    const prevData = allData;
    if (mutateOptions?.optimisticUpdate) {
      setAllData(mutateOptions.optimisticUpdate(allData));
    }

    if (asyncUpdate) {
      try {
        const result = await asyncUpdate;
        if (mutateOptions?.shouldRevalidateAfter !== false) {
          setAllData(result);
        }
        return result;
      } catch (e) {
        if (mutateOptions?.rollbackOnError !== false) {
          if (typeof mutateOptions?.rollbackOnError === 'function') {
            setAllData(mutateOptions.rollbackOnError(prevData));
          } else {
            setAllData(prevData);
          }
        }
        throw e;
      }
    }

    revalidate();
    return undefined;
  }, [allData, revalidate]);

  const onLoadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchData(nextPage, cursor);
    }
  }, [hasMore, isLoading, page, cursor, fetchData]);

  const pagination = useMemo(() => ({
    page,
    pageSize: 20,
    hasMore,
    onLoadMore,
  }), [page, hasMore, onLoadMore]);

  return { data: allData, isLoading, error, revalidate, mutate, pagination };
}
