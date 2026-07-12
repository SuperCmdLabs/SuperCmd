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
  const runIdRef = useRef(0);
  const lastInitialRequestKeyRef = useRef<string | undefined>(undefined);
  const lastInitialOptionsKeyRef = useRef<string | undefined>(undefined);
  const pendingHookStateRenderRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
    };
  }, []);

  const urlRef = useRef(url);
  const optionsRef = useRef(options);
  urlRef.current = url;
  optionsRef.current = options;

  const setHookState = useCallback(<V,>(
    setter: (nextValue: V | ((previous: V) => V)) => void,
    nextValue: V | ((previous: V) => V),
  ) => {
    setter((previous: V) => {
      const next = typeof nextValue === 'function'
        ? (nextValue as (value: V) => V)(previous)
        : nextValue;
      if (Object.is(previous, next)) return previous;
      pendingHookStateRenderRef.current = true;
      return next;
    });
  }, []);

  const resolveUrl = useCallback((
    requestUrl: typeof url,
    pageNum: number,
    currentCursor?: string,
  ) => typeof requestUrl === 'function'
    ? requestUrl({ page: pageNum, cursor: currentCursor, lastItem: undefined })
    : requestUrl, []);

  const fetchData = useCallback(async (pageNum: number, currentCursor?: string, resolvedUrlOverride?: string) => {
    const opts = optionsRef.current;
    if (opts?.execute === false || !mountedRef.current) return;

    const runId = ++runIdRef.current;
    const isCurrentRun = () => mountedRef.current && runIdRef.current === runId;

    setHookState(setIsLoading, true);
    setHookState(setError, undefined);

    try {
      const resolvedUrl = resolvedUrlOverride ?? resolveUrl(urlRef.current, pageNum, currentCursor);

      const ipcRes = await window.electron.httpRequest({
        url: resolvedUrl,
        method: opts?.method,
        headers: opts?.headers,
        body: normalizeRequestBody(opts?.body) as string | undefined,
      });
      if (!isCurrentRun()) return;

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
      if (!isCurrentRun()) return;

      const mapped = opts?.mapResult ? opts.mapResult(parsed) : parsed;
      if (!isCurrentRun()) return;
      if (mapped && typeof mapped === 'object' && 'data' in mapped) {
        const paginatedResult = mapped as { data: T; hasMore?: boolean; cursor?: string };
        setHookState(setHasMore, paginatedResult.hasMore ?? false);
        setHookState(setCursor, paginatedResult.cursor);

        setHookState(setAllData, (prev) => {
          if (pageNum === 0) return paginatedResult.data;
          if (Array.isArray(paginatedResult.data) && Array.isArray(prev)) {
            return [...prev, ...paginatedResult.data] as unknown as T;
          }
          return paginatedResult.data;
        });
        opts?.onData?.(paginatedResult.data);
      } else {
        setHookState(setAllData, mapped as T);
        setHookState(setHasMore, false);
        opts?.onData?.(mapped as T);
      }
    } catch (err) {
      if (!isCurrentRun()) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setHookState(setError, e);
      opts?.onError?.(e);
    } finally {
      if (isCurrentRun()) setHookState(setIsLoading, false);
    }
  }, [resolveUrl, setHookState]);

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
    const isHookStateRender = pendingHookStateRenderRef.current;
    pendingHookStateRenderRef.current = false;
    const previousOptionsKey = lastInitialOptionsKeyRef.current;
    lastInitialOptionsKeyRef.current = optionsKey;
    if (
      isHookStateRender &&
      typeof url === 'function' &&
      lastInitialRequestKeyRef.current !== undefined &&
      previousOptionsKey === optionsKey
    ) {
      return;
    }

    if (options?.execute === false) {
      runIdRef.current += 1;
      lastInitialRequestKeyRef.current = undefined;
      setHookState(setIsLoading, false);
      setHookState(setError, undefined);
      setHookState(setAllData, options?.initialData);
      return;
    }

    let initialResolvedUrl: string | undefined;
    let initialUrlKey: string;
    try {
      initialResolvedUrl = resolveUrl(url, 0, undefined);
      initialUrlKey = initialResolvedUrl;
    } catch (err) {
      initialUrlKey = `error:${err instanceof Error ? err.message : String(err)}`;
    }

    const initialRequestKey = `${optionsKey}\n${initialUrlKey}`;
    if (lastInitialRequestKeyRef.current === initialRequestKey) return;
    lastInitialRequestKeyRef.current = initialRequestKey;

    setHookState(setPage, 0);
    setHookState(setCursor, undefined);
    setHookState(setAllData, options?.initialData);
    fetchData(0, undefined, initialResolvedUrl);
  }, [fetchData, url, optionsKey, setHookState]);

  const revalidate = useCallback(() => {
    setHookState(setPage, 0);
    setHookState(setCursor, undefined);
    setHookState(setAllData, undefined);
    fetchData(0, undefined);
  }, [fetchData, setHookState]);

  const mutate = useCallback(async (asyncUpdate?: Promise<T>, mutateOptions?: { optimisticUpdate?: (data: T | undefined) => T; rollbackOnError?: boolean | ((data: T | undefined) => T); shouldRevalidateAfter?: boolean }) => {
    const prevData = allData;
    if (mutateOptions?.optimisticUpdate) {
      setHookState(setAllData, mutateOptions.optimisticUpdate(allData));
    }

    if (asyncUpdate) {
      try {
        const result = await asyncUpdate;
        if (mutateOptions?.shouldRevalidateAfter !== false) {
          setHookState(setAllData, result);
        }
        return result;
      } catch (e) {
        if (mutateOptions?.rollbackOnError !== false) {
          if (typeof mutateOptions?.rollbackOnError === 'function') {
            setHookState(setAllData, mutateOptions.rollbackOnError(prevData));
          } else {
            setHookState(setAllData, prevData);
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
      setHookState(setPage, nextPage);
      fetchData(nextPage, cursor);
    }
  }, [hasMore, isLoading, page, cursor, fetchData, setHookState]);

  const pagination = useMemo(() => ({
    page,
    pageSize: 20,
    hasMore,
    onLoadMore,
  }), [page, hasMore, onLoadMore]);

  return { data: allData, isLoading, error, revalidate, mutate, pagination };
}
