/**
 * raycast-api/oauth/oauth-bridge.ts
 * Purpose: OAuth callback bridge, callback parsing/waiting, and redirect/key helpers.
 */

import { getOAuthRuntimeDeps } from './runtime-config';

const OAUTH_TOKEN_KEY_PREFIX = 'sc-oauth-token:';
const OAUTH_CLIENT_ID_OVERRIDE_PREFIX = 'sc-oauth-client-id:';
const OAUTH_CALLBACK_TIMEOUT_MS = 3 * 60 * 1000;

const oauthCallbackWaiters = new Set<(url: string) => void>();
const oauthCallbackQueue: string[] = [];
let oauthCallbackBridgeInitialized = false;

export function oauthTokenKey(providerId: string): string {
  return `${OAUTH_TOKEN_KEY_PREFIX}${providerId || 'default'}`;
}

export function oauthClientIdOverrideKey(providerId: string): string {
  return `${OAUTH_CLIENT_ID_OVERRIDE_PREFIX}${providerId || 'default'}`;
}

export function ensureOAuthCallbackBridge() {
  if (oauthCallbackBridgeInitialized) return;
  oauthCallbackBridgeInitialized = true;

  try {
    (window as any).electron?.onOAuthCallback?.((url: string) => {
      if (!url) return;
      oauthCallbackQueue.push(url);
      for (const waiter of Array.from(oauthCallbackWaiters)) {
        waiter(url);
      }
    });
  } catch {
    // best-effort
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function buildOAuthRedirectUri(redirectMethod: string, extensionName?: string): string {
  const pkg = extensionName || getOAuthRuntimeDeps().getExtensionContext().extensionName || 'supercmd-extension';
  switch (redirectMethod) {
    case 'web':
    case 'app':
    case 'appURI':
    default:
      return `supercmd://oauth/callback?packageName=${encodeURIComponent(pkg)}`;
  }
}

export async function buildAuthorizationRequest(params: {
  endpoint: string;
  clientId?: string;
  scope?: string;
  redirectMethod: string;
  extensionName?: string;
  extraParameters?: Record<string, unknown>;
}) {
  const state = Math.random().toString(36).slice(2);
  const codeVerifier = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const verifierBytes = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', verifierBytes);
  const codeChallenge = toBase64Url(new Uint8Array(digest));

  const url = new URL(params.endpoint || '');
  if (params.clientId) url.searchParams.set('client_id', params.clientId);
  if (params.scope) url.searchParams.set('scope', params.scope);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', buildOAuthRedirectUri(params.redirectMethod, params.extensionName));
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);

  if (params.extraParameters && typeof params.extraParameters === 'object') {
    for (const [k, v] of Object.entries(params.extraParameters)) {
      if (typeof v === 'string') {
        url.searchParams.set(k, v);
      }
    }
  }

  return {
    codeChallenge,
    codeVerifier,
    state,
    redirectUri: buildOAuthRedirectUri(params.redirectMethod, params.extensionName),
    toURL: () => url.toString(),
  };
}

export function parseOAuthCallbackUrl(rawUrl: string): {
  code?: string;
  accessToken?: string;
  tokenType?: string;
  provider?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
} | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'supercmd:') return null;

    const isOAuthCallback =
      (parsed.hostname === 'oauth' && parsed.pathname === '/callback') ||
      parsed.pathname === '/oauth/callback' ||
      (parsed.hostname === 'auth' && parsed.pathname === '/callback') ||
      parsed.pathname === '/auth/callback';

    if (!isOAuthCallback) return null;

    return {
      code: parsed.searchParams.get('code') || undefined,
      accessToken: parsed.searchParams.get('access_token') || undefined,
      tokenType: parsed.searchParams.get('token_type') || undefined,
      provider: parsed.searchParams.get('provider') || undefined,
      state: parsed.searchParams.get('state') || undefined,
      error: parsed.searchParams.get('error') || undefined,
      errorDescription: parsed.searchParams.get('error_description') || undefined,
    };
  } catch {
    return null;
  }
}

export async function waitForOAuthCallback(
  state: string,
  timeoutMs = OAUTH_CALLBACK_TIMEOUT_MS
): Promise<{ code?: string; accessToken?: string; tokenType?: string; provider?: string; error?: string; errorDescription?: string }> {
  ensureOAuthCallbackBridge();

  const stateMatches = (parsed: ReturnType<typeof parseOAuthCallbackUrl>) => {
    if (!parsed) return false;
    if (!state) return true;
    return parsed.state === state;
  };

  for (let i = 0; i < oauthCallbackQueue.length; i++) {
    const parsed = parseOAuthCallbackUrl(oauthCallbackQueue[i]);
    if (stateMatches(parsed)) {
      oauthCallbackQueue.splice(i, 1);
      return parsed!;
    }
  }

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      oauthCallbackWaiters.delete(handler);
      reject(new Error('OAuth authorization timed out'));
    }, timeoutMs);

    const handler = (rawUrl: string) => {
      const parsed = parseOAuthCallbackUrl(rawUrl);
      if (!stateMatches(parsed)) return;
      clearTimeout(timer);
      oauthCallbackWaiters.delete(handler);
      resolve(parsed!);
    };

    oauthCallbackWaiters.add(handler);
  });
}
