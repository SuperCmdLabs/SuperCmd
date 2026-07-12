import * as path from 'path';
import { pathToFileURL } from 'url';

const CANVAS_LIB_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const CANVAS_LIB_MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
};

export interface CanvasLibAssetResolution {
  filePath: string;
  headers: Record<string, string>;
}

export type CanvasLibAssetResolveResult =
  | { ok: true; asset: CanvasLibAssetResolution }
  | { ok: false; response: Response };

export type FetchFileResponse = (fileUrl: string) => Promise<Response>;

export function getCanvasLibAssetContentType(filePath: string): string {
  return CANVAS_LIB_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function resolveCanvasLibAssetRequest(
  requestUrl: string,
  canvasLibDir: string
): CanvasLibAssetResolveResult {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { ok: false, response: new Response('Bad Request', { status: 400 }) };
  }

  let relPath: string;
  try {
    relPath = decodeURIComponent(url.pathname || '').replace(/^\/+/, '');
  } catch {
    return { ok: false, response: new Response('Bad Request', { status: 400 }) };
  }

  if (!relPath) {
    return { ok: false, response: new Response('Bad Request', { status: 400 }) };
  }

  const basePath = path.resolve(canvasLibDir);
  const filePath = path.resolve(basePath, relPath);
  const relativeToBase = path.relative(basePath, filePath);
  if (relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) {
    return { ok: false, response: new Response('Not Found', { status: 404 }) };
  }

  return {
    ok: true,
    asset: {
      filePath,
      headers: {
        'Content-Type': getCanvasLibAssetContentType(filePath),
        'Cache-Control': CANVAS_LIB_CACHE_CONTROL,
      },
    },
  };
}

export async function serveCanvasLibAssetFromFile(
  requestUrl: string,
  canvasLibDir: string,
  fetchFile: FetchFileResponse
): Promise<Response> {
  const resolved = resolveCanvasLibAssetRequest(requestUrl, canvasLibDir);
  if (!resolved.ok) return resolved.response;

  try {
    const upstream = await fetchFile(pathToFileURL(resolved.asset.filePath).toString());
    if (!upstream.ok) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: resolved.asset.headers,
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}
