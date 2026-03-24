/**
 * Extension API Client
 *
 * Talks to the supercmd-backend for extension discovery, search,
 * and download. Replaces direct git/GitHub interactions as the
 * primary path; git sparse-checkout is kept as a fallback only.
 */

import * as https from 'https';
import * as http from 'http';
import { loadSettings } from './settings-store';

import type { CatalogEntry } from './extension-registry';

// const DEFAULT_API_URL = 'http://localhost:3001'; //'https://api.supercmd.com';
const DEFAULT_API_URL = 'https://api.supercmd.sh';
const REQUEST_TIMEOUT = 30_000;

function getApiBaseUrl(): string {
  try {
    const settings = loadSettings();
    return (settings as any).extensionApiUrl || DEFAULT_API_URL;
  } catch {
    return DEFAULT_API_URL;
  }
}

/** Minimal JSON fetch using Node built-in http(s). */
function jsonRequest<T>(
  method: string,
  urlPath: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const baseUrl = getApiBaseUrl();
    const fullUrl = new URL(urlPath, baseUrl);

    const isHttps = fullUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const payload = body ? JSON.stringify(body) : undefined;

    const options: https.RequestOptions = {
      method,
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      headers: {
        'User-Agent': 'SuperCmd',
        Accept: 'application/json',
        ...(payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : {}),
      },
      timeout: REQUEST_TIMEOUT,
    };

    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const statusCode = res.statusCode ?? 0;
        const rawBody = Buffer.concat(chunks).toString('utf-8');

        if (statusCode < 200 || statusCode >= 300) {
          reject(
            new Error(
              `API request failed: ${method} ${urlPath} → ${statusCode} ${res.statusMessage}\n${rawBody}`,
            ),
          );
          return;
        }

        try {
          resolve(JSON.parse(rawBody) as T);
        } catch (parseError) {
          reject(new Error(`Failed to parse API response as JSON: ${rawBody}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`API request timed out: ${method} ${urlPath}`));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Public API ──────────────────────────────────────────────────────

/** Fetch the full extension catalog from the backend. */
export async function fetchCatalogFromAPI(): Promise<CatalogEntry[]> {
  const data = await jsonRequest<any[]>('GET', '/extensions/catalog');

  // Normalize backend shape → CatalogEntry
  return data.map((entry) => ({
    name: entry.name ?? '',
    title: entry.title ?? '',
    description: entry.description ?? '',
    author: entry.author ?? '',
    contributors: entry.contributors ?? [],
    icon: entry.icon ?? '',
    iconUrl: entry.iconUrl ?? entry.icon_url ?? '',
    screenshotUrls: entry.screenshotUrls ?? entry.screenshot_urls ?? [],
    categories: entry.categories ?? [],
    platforms: entry.platforms ?? [],
    commands: (entry.commands ?? []).map((cmd: any) => ({
      name: cmd.name ?? '',
      title: cmd.title ?? '',
      description: cmd.description ?? '',
    })),
    installCount: entry.installCount ?? entry.install_count ?? 0,
  }));
}

/** Search extensions via the backend API. */
export async function searchExtensions(
  query: string,
  options?: { category?: string; limit?: number; offset?: number },
): Promise<{ results: CatalogEntry[]; total: number }> {
  const params = new URLSearchParams({ q: query });
  if (options?.category) params.set('category', options.category);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));

  const data = await jsonRequest<{
    results: any[];
    total: number;
  }>('GET', `/extensions/search?${params.toString()}`);

  return {
    total: data.total,
    results: data.results.map((entry) => ({
      name: entry.name ?? '',
      title: entry.title ?? '',
      description: entry.description ?? '',
      author: entry.author ?? '',
      contributors: entry.contributors ?? [],
      icon: entry.icon ?? '',
      iconUrl: entry.iconUrl ?? entry.icon_url ?? '',
      screenshotUrls: entry.screenshotUrls ?? entry.screenshot_urls ?? [],
      categories: entry.categories ?? [],
      platforms: entry.platforms ?? [],
      commands: (entry.commands ?? []).map((cmd: any) => ({
        name: cmd.name ?? '',
        title: cmd.title ?? '',
        description: cmd.description ?? '',
      })),
      installCount: entry.installCount ?? entry.install_count ?? 0,
    })),
  };
}

/** Get popular extensions from the backend. */
export async function getPopularExtensions(
  limit = 20,
): Promise<CatalogEntry[]> {
  const data = await jsonRequest<any[]>(
    'GET',
    `/extensions/popular?limit=${limit}`,
  );

  return data.map((entry) => ({
    name: entry.name ?? '',
    title: entry.title ?? '',
    description: entry.description ?? '',
    author: entry.author ?? '',
    contributors: entry.contributors ?? [],
    icon: entry.icon ?? '',
    iconUrl: entry.iconUrl ?? entry.icon_url ?? '',
    screenshotUrls: entry.screenshotUrls ?? entry.screenshot_urls ?? [],
    categories: entry.categories ?? [],
    platforms: entry.platforms ?? [],
    commands: (entry.commands ?? []).map((cmd: any) => ({
      name: cmd.name ?? '',
      title: cmd.title ?? '',
      description: cmd.description ?? '',
    })),
    installCount: entry.installCount ?? entry.install_count ?? 0,
  }));
}

/** Get single extension details from the backend. */
export async function getExtensionDetails(
  name: string,
): Promise<CatalogEntry | null> {
  try {
    const entry = await jsonRequest<any>(
      'GET',
      `/extensions/${encodeURIComponent(name)}`,
    );
    return {
      name: entry.name ?? '',
      title: entry.title ?? '',
      description: entry.description ?? '',
      author: entry.author ?? '',
      contributors: entry.contributors ?? [],
      icon: entry.icon ?? '',
      iconUrl: entry.iconUrl ?? entry.icon_url ?? '',
      screenshotUrls: entry.screenshotUrls ?? entry.screenshot_urls ?? [],
      categories: entry.categories ?? [],
      platforms: entry.platforms ?? [],
      commands: (entry.commands ?? []).map((cmd: any) => ({
        name: cmd.name ?? '',
        title: cmd.title ?? '',
        description: cmd.description ?? '',
      })),
      installCount: entry.installCount ?? entry.install_count ?? 0,
    };
  } catch {
    return null;
  }
}

/** Get a download URL for the extension bundle from the backend. */
export async function getExtensionBundleUrl(
  name: string,
): Promise<{ url: string; type: 'bundle' | 'source' }> {
  return jsonRequest<{ url: string; type: 'bundle' | 'source' }>(
    'GET',
    `/extensions/${encodeURIComponent(name)}/bundle`,
  );
}

/** Get extension screenshot URLs from the backend. */
export async function getExtensionScreenshotsFromAPI(
  name: string,
): Promise<string[]> {
  try {
    return await jsonRequest<string[]>(
      'GET',
      `/extensions/${encodeURIComponent(name)}/screenshots`,
    );
  } catch {
    return [];
  }
}

/** Report an install event to the backend (fire-and-forget). */
export async function reportInstall(
  name: string,
  machineId?: string,
): Promise<void> {
  try {
    await jsonRequest<{ ok: boolean }>(
      'POST',
      `/extensions/${encodeURIComponent(name)}/install`,
      machineId ? { machineId } : {},
    );
  } catch (err) {
    console.warn('Failed to report install:', err);
  }
}

/** Report an uninstall event to the backend (fire-and-forget). */
export async function reportUninstall(
  name: string,
  machineId?: string,
): Promise<void> {
  try {
    await jsonRequest<{ ok: boolean }>(
      'POST',
      `/extensions/${encodeURIComponent(name)}/uninstall`,
      machineId ? { machineId } : {},
    );
  } catch (err) {
    console.warn('Failed to report uninstall:', err);
  }
}
