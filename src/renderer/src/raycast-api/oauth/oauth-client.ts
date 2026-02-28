/**
 * raycast-api/oauth/oauth-client.ts
 * Purpose: PKCE client and token compatibility helpers used by OAuthService.
 */

import { buildAuthorizationRequest, buildOAuthRedirectUri, oauthTokenKey } from './oauth-bridge';
import { getOAuthRuntimeDeps } from './runtime-config';

export class PKCEClientCompat {
  redirectMethod: string;
  providerName: string;
  providerIcon?: any;
  providerId: string;
  description?: string;
  extensionName: string;

  constructor(options: any) {
    this.redirectMethod = options?.redirectMethod || 'web';
    this.providerName = options?.providerName || 'OAuth Provider';
    this.providerIcon = options?.providerIcon;
    this.providerId = options?.providerId || this.providerName.toLowerCase().replace(/\s+/g, '-');
    this.description = options?.description;
    this.extensionName = getOAuthRuntimeDeps().getExtensionContext().extensionName || 'supercmd-extension';
  }

  async authorizationRequest(options: any) {
    return await buildAuthorizationRequest({
      endpoint: options?.endpoint || '',
      clientId: options?.clientId,
      scope: options?.scope,
      redirectMethod: this.redirectMethod,
      extensionName: this.extensionName,
      extraParameters: options?.extraParameters,
    });
  }

  async authorize(requestOrOptions: any) {
    const maybeToURL = requestOrOptions?.toURL;
    const url = typeof maybeToURL === 'function' ? maybeToURL() : requestOrOptions?.url;
    if (url) {
      await getOAuthRuntimeDeps().open(url);
    }
    return { authorizationCode: '' };
  }

  async setTokens(tokens: any) {
    if (!tokens) return;

    try {
      localStorage.setItem(oauthTokenKey(this.providerId), JSON.stringify(tokens));
    } catch {
      // best-effort
    }

    try {
      const accessToken = tokens.accessToken || tokens.access_token || '';
      if (accessToken) {
        await (window as any).electron?.oauthSetToken?.(this.providerId, {
          accessToken,
          tokenType: tokens.tokenType || tokens.token_type || 'Bearer',
          scope: tokens.scope || '',
          expiresIn: tokens.expiresIn || tokens.expires_in,
          obtainedAt: tokens.obtainedAt || new Date().toISOString(),
        });
      }
    } catch {
      // best-effort
    }
  }

  async getTokens() {
    try {
      const raw = localStorage.getItem(oauthTokenKey(this.providerId));
      if (raw) {
        const parsed = JSON.parse(raw);
        const accessToken = parsed?.accessToken || parsed?.access_token || '';
        if (accessToken) {
          (window as any).electron?.oauthSetToken?.(this.providerId, {
            accessToken,
            tokenType: parsed?.tokenType || parsed?.token_type || 'Bearer',
            scope: parsed?.scope || '',
            expiresIn: parsed?.expiresIn || parsed?.expires_in,
            obtainedAt: parsed?.obtainedAt || new Date().toISOString(),
          })?.catch?.(() => {});
        }
        return parsed;
      }
    } catch {
      // best-effort
    }

    try {
      const stored = await (window as any).electron?.oauthGetToken?.(this.providerId);
      if (stored?.accessToken) {
        try {
          localStorage.setItem(oauthTokenKey(this.providerId), JSON.stringify(stored));
        } catch {
          // best-effort
        }
        return stored;
      }
    } catch {
      // best-effort
    }

    return undefined;
  }

  async removeTokens() {
    try {
      localStorage.removeItem(oauthTokenKey(this.providerId));
    } catch {
      // best-effort
    }

    try {
      await (window as any).electron?.oauthRemoveToken?.(this.providerId);
    } catch {
      // best-effort
    }
  }
}

class TokenSetCompat {
  accessToken = '';
  refreshToken = '';
  idToken = '';
  scope = '';
  expiresIn?: number;
  obtainedAt?: Date;

  constructor(init?: any) {
    if (init && typeof init === 'object') {
      Object.assign(this, init);
    }
    if (!this.obtainedAt) this.obtainedAt = new Date();
  }

  isExpired() {
    if (!this.expiresIn) return false;
    const obtained = this.obtainedAt instanceof Date ? this.obtainedAt.getTime() : Date.now();
    return Date.now() >= obtained + this.expiresIn * 1000;
  }
}

export const OAuth = {
  RedirectMethod: {
    Web: 'web',
    App: 'app',
    AppURI: 'appURI',
  },
  PKCEClient: PKCEClientCompat,
  TokenSet: TokenSetCompat,
  TokenResponse: class {
    accessToken = '';
    refreshToken = '';
    idToken = '';
    tokenType = 'Bearer';
    scope = '';
    expiresIn?: number;
  },
};

export function buildDefaultRedirectUri(redirectMethod?: string, extensionName?: string): string {
  return buildOAuthRedirectUri(redirectMethod || 'web', extensionName);
}
