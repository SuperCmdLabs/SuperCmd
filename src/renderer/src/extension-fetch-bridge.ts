interface ExtensionFetchElectronBridge {
  httpRequest?: (options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    requestId?: string;
  }) => Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyText: string;
    url: string;
  }>;
  cancelHttpRequest?: (requestId: string) => void;
  httpDownloadBinary?: (url: string, requestId?: string) => Promise<Uint8Array>;
}

let extensionFetchRequestSeq = 0;

function createAbortError(): Error {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    return err;
  }
}

function createRequestId(g: any): string {
  const randomId =
    typeof g.crypto?.randomUUID === 'function'
      ? g.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `extensionFetch:${Date.now()}:${++extensionFetchRequestSeq}:${randomId}`;
}

function getRequestSignal(input: any, init?: any): AbortSignal | undefined {
  if (init?.signal) return init.signal;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.signal;
  return input?.signal;
}

export function installExtensionFetchBridge(
  g: any,
  getElectronBridge: () => ExtensionFetchElectronBridge | undefined = () => (globalThis as any).window?.electron
): void {
  if (!g.__SUPERCMD_NATIVE_FETCH && typeof g.fetch === 'function') {
    g.__SUPERCMD_NATIVE_FETCH = g.fetch.bind(g);
  }
  if (g.__SUPERCMD_FETCH_PATCHED) return;

  const nativeFetch = g.__SUPERCMD_NATIVE_FETCH;
  const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
  const toHeadersObject = (headersLike: any): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!headersLike) return out;
    try {
      const normalized = new Headers(headersLike as HeadersInit);
      normalized.forEach((v, k) => {
        out[k] = v;
      });
    } catch {
      if (typeof headersLike === 'object') {
        for (const [k, v] of Object.entries(headersLike)) {
          out[k] = String(v);
        }
      }
    }
    return out;
  };
  const normalizeBody = async (body: any): Promise<string | undefined> => {
    if (body == null) return undefined;
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof Blob) return await body.text();
    if (typeof body === 'object') return JSON.stringify(body);
    return String(body);
  };

  g.fetch = async (input: any, init?: any) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input?.url || String(input ?? '');

    const electronBridge = getElectronBridge();

    // Only proxy HTTP(S) requests.
    if (!isHttpUrl(url) || !electronBridge?.httpRequest) {
      return typeof nativeFetch === 'function' ? nativeFetch(input, init) : fetch(input, init);
    }

    // FormData/streams are not representable via current IPC payload. Fall back.
    const requestBody = init?.body;
    if (
      requestBody instanceof FormData ||
      requestBody instanceof ReadableStream ||
      (typeof requestBody === 'object' && requestBody?.getReader)
    ) {
      return typeof nativeFetch === 'function' ? nativeFetch(input, init) : fetch(input, init);
    }

    const method = (init?.method || input?.method || 'GET').toUpperCase();
    const headers = {
      ...toHeadersObject(input?.headers),
      ...toHeadersObject(init?.headers),
    };
    const body = await normalizeBody(requestBody);
    const signal = getRequestSignal(input, init);
    const requestId = createRequestId(g);
    let cancelSent = false;
    let abortListener: (() => void) | undefined;
    const sendCancel = () => {
      if (cancelSent) return;
      cancelSent = true;
      electronBridge.cancelHttpRequest?.(requestId);
    };
    const removeAbortListener = () => {
      if (!signal || !abortListener) return;
      signal.removeEventListener('abort', abortListener);
      abortListener = undefined;
    };

    if (signal?.aborted) throw createAbortError();
    if (signal) {
      abortListener = sendCancel;
      signal.addEventListener('abort', abortListener, { once: true });
    }

    const binaryDownloader = electronBridge.httpDownloadBinary;
    const canDownloadBinary = method === 'GET' && typeof binaryDownloader === 'function';
    let ipcRes: Awaited<ReturnType<NonNullable<ExtensionFetchElectronBridge['httpRequest']>>>;
    try {
      ipcRes = await electronBridge.httpRequest({ url, method, headers, body, requestId });
    } catch (err) {
      removeAbortListener();
      throw err;
    }

    try {
      if (signal?.aborted) throw createAbortError();

      if (!ipcRes || ipcRes.status === 0) {
        if (typeof nativeFetch === 'function') {
          try {
            return await nativeFetch(input, init);
          } catch (nativeErr: any) {
            const proxyMsg = ipcRes?.statusText || `Failed to fetch ${url}`;
            const nativeMsg = nativeErr?.message || String(nativeErr);
            throw new TypeError(`${proxyMsg}; native fetch fallback failed: ${nativeMsg}`);
          }
        }
        throw new TypeError(ipcRes?.statusText || `Failed to fetch ${url}`);
      }

      const contentType = String(
        ipcRes.headers?.['content-type'] ||
        ipcRes.headers?.['Content-Type'] ||
        ''
      ).toLowerCase();
      const requestAccept = String(headers?.Accept || headers?.accept || '').toLowerCase();
      const looksLikeBinaryUrl = /\.(gif|png|apng|jpe?g|webp|bmp|ico|icns|tiff?|mp3|wav|ogg|aac|m4a|mp4|mov|webm|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|bz2|7z|rar)(?:[?#]|$)/i.test(url);
      const isBinaryContentType =
        /^image\/(?!svg\+xml)/i.test(contentType) ||
        /^(audio|video|font)\//i.test(contentType) ||
        /^application\/(?:octet-stream|pdf|zip|gzip|x-gzip|x-bzip|x-7z-compressed|x-rar-compressed)/i.test(contentType);
      const prefersBinaryResponse = requestAccept.includes('image/') || requestAccept.includes('application/octet-stream');

      let rawBytes: Uint8Array | null = null;
      if (canDownloadBinary && (isBinaryContentType || prefersBinaryResponse || looksLikeBinaryUrl)) {
        if (signal?.aborted) throw createAbortError();
        rawBytes = await binaryDownloader(url, requestId).catch(() => null as Uint8Array | null);
        if (signal?.aborted) throw createAbortError();
      }

      // Build Response with binary body when available, text otherwise.
      const responseBody = rawBytes && rawBytes.length > 0 ? rawBytes as BodyInit : (ipcRes.bodyText ?? '');
      const response = new Response(responseBody, {
        status: ipcRes.status,
        statusText: ipcRes.statusText || '',
        headers: ipcRes.headers || {},
      });

      try {
        Object.defineProperty(response, 'url', { value: ipcRes.url || url });
      } catch {}

      return response;
    } finally {
      removeAbortListener();
    }
  };

  g.__SUPERCMD_FETCH_PATCHED = true;
}
