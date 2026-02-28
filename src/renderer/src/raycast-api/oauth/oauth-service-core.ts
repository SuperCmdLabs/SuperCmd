/**
 * raycast-api/oauth/oauth-service-core.ts
 * Purpose: OAuthService core flow (authorize URL creation, callback wait, token exchange).
 */
import { buildOAuthRedirectUri, ensureOAuthCallbackBridge, oauthClientIdOverrideKey, waitForOAuthCallback } from './oauth-bridge';
import { buildDefaultRedirectUri } from './oauth-client';
import type { OAuthProviderInfo, OAuthServiceOptions } from './oauth-types';
import { getOAuthRuntimeDeps } from './runtime-config';
export class OAuthServiceCore {
  protected options: OAuthServiceOptions;
  onAuthorize?: OAuthServiceOptions['onAuthorize'];

  constructor(options: OAuthServiceOptions) {
    this.options = options || {};
    this.onAuthorize = options?.onAuthorize;
  }

  getProviderKey(): string {
    return this.options.client?.providerId || this.options.client?.providerName || 'oauth-provider';
  }

  getConfiguredClientId(): string | undefined {
    const key = oauthClientIdOverrideKey(this.getProviderKey());
    const override = localStorage.getItem(key);
    return (override && override.trim()) || this.options.clientId;
  }

  setClientIdOverride(value: string): void {
    const key = oauthClientIdOverrideKey(this.getProviderKey());
    const trimmed = (value || '').trim();
    if (!trimmed) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, trimmed);
  }

  protected getManagedAuthorizeUrl(): string | null {
    const providerId = String(this.options.client?.providerId || '').trim().toLowerCase();
    const providerName = String(this.options.client?.providerName || '').trim().toLowerCase();
    const configuredAuthorizeUrl = String(this.options.authorizeUrl || '').trim().toLowerCase();

    if (
      providerId === 'spotify' ||
      providerName === 'spotify' ||
      configuredAuthorizeUrl.includes('accounts.spotify.com/authorize')
    ) {
      return 'https://api.supercmd.sh/auth/spotify/authorize';
    }

    if (
      providerId === 'linear' ||
      providerName === 'linear' ||
      configuredAuthorizeUrl.includes('api.linear.app/oauth/authorize')
    ) {
      return 'https://api.supercmd.sh/auth/linear/authorize';
    }

    return null;
  }

  protected async exchangeAuthorizationCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<any> {
    if (!this.options.tokenUrl) {
      throw new Error('OAuth token URL is not configured for this extension.');
    }

    const clientId = this.getConfiguredClientId();
    if (!clientId) {
      throw new Error('Missing OAuth client ID. Configure a valid client ID and try again.');
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', params.code);
    body.set('client_id', clientId);
    body.set('redirect_uri', params.redirectUri);
    body.set('code_verifier', params.codeVerifier);

    const response = await fetch(this.options.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // best-effort
    }

    if (!response.ok) {
      const providerError =
        parsed?.error_description ||
        parsed?.error?.message ||
        parsed?.error ||
        text ||
        `OAuth token exchange failed (${response.status})`;
      throw new Error(providerError);
    }

    return parsed || {};
  }

  getProviderInfo(): OAuthProviderInfo {
    return {
      name: this.options.client?.providerName || 'OAuth Provider',
      description: this.options.client?.description || `Connect your ${this.options.client?.providerName || 'account'}`,
      icon: this.options.client?.providerIcon,
    };
  }

  async getAuthorizationUrl(): Promise<string | null> {
    const managedAuthorizeUrl = this.getManagedAuthorizeUrl();
    if (managedAuthorizeUrl) return managedAuthorizeUrl;

    if (!this.options.authorizeUrl || !this.options.scope) return null;

    const clientId = this.getConfiguredClientId();
    if (!clientId) return null;

    try {
      if (this.options.client?.authorizationRequest) {
        const request = await this.options.client.authorizationRequest({
          endpoint: this.options.authorizeUrl,
          clientId,
          scope: this.options.scope,
        });
        if (request?.toURL) return request.toURL();
      }

      const url = new URL(this.options.authorizeUrl);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('scope', this.options.scope);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set(
        'redirect_uri',
        buildOAuthRedirectUri((this.options.client as any)?.redirectMethod || 'web', (this.options.client as any)?.extensionName)
      );
      return url.toString();
    } catch {
      return null;
    }
  }

  async beginAuthorization(): Promise<boolean> {
    try {
      await (window as any).electron?.oauthSetFlowActive?.(true);
    } catch {
      // best-effort
    }

    try {
      if (typeof this.options.authorize === 'function') {
        ensureOAuthCallbackBridge();
        const token = await this.options.authorize();
        if (!token) return false;

        const tokenSet = {
          accessToken: token,
          scope: this.options.scope || '',
          tokenType: 'Bearer',
          obtainedAt: new Date().toISOString(),
        };
        await this.options.client?.setTokens?.(tokenSet);
        await Promise.resolve(this.onAuthorize?.({ token, type: 'oauth' }));
        return true;
      }

      const managedAuthorizeUrl = this.getManagedAuthorizeUrl();
      if (managedAuthorizeUrl) {
        ensureOAuthCallbackBridge();
        await getOAuthRuntimeDeps().open(managedAuthorizeUrl);
        const callback = await waitForOAuthCallback('');
        if (callback.error) throw new Error(callback.errorDescription || callback.error);

        const token = callback.accessToken || callback.code;
        if (!token) throw new Error('Authorization did not return a valid token.');

        const tokenSet = {
          accessToken: token,
          scope: this.options.scope || '',
          tokenType: callback.tokenType || 'Bearer',
          obtainedAt: new Date().toISOString(),
        };
        await this.options.client?.setTokens?.(tokenSet);
        await Promise.resolve(this.onAuthorize?.({ token, type: 'oauth' }));
        return true;
      }

      const clientId = this.getConfiguredClientId();
      if (!clientId || !this.options.authorizeUrl || !this.options.scope) return false;

      const request = await this.options.client?.authorizationRequest?.({
        endpoint: this.options.authorizeUrl,
        clientId,
        scope: this.options.scope,
      });

      const authUrl = request?.toURL ? request.toURL() : await this.getAuthorizationUrl();
      if (!authUrl) return false;

      await getOAuthRuntimeDeps().open(authUrl);
      const callback = await waitForOAuthCallback(request?.state || '');

      if (callback.error) throw new Error(callback.errorDescription || callback.error);

      const directToken = callback.accessToken;
      if (directToken) {
        const tokenSet = {
          accessToken: directToken,
          scope: this.options.scope || '',
          tokenType: callback.tokenType || 'Bearer',
          obtainedAt: new Date().toISOString(),
        };
        await this.options.client?.setTokens?.(tokenSet);
        await Promise.resolve(this.onAuthorize?.({ token: directToken, type: 'oauth' }));
        return true;
      }

      if (!callback.code) throw new Error('Authorization did not return a valid code.');

      const tokenResponse = await this.exchangeAuthorizationCode({
        code: callback.code,
        codeVerifier: request?.codeVerifier || '',
        redirectUri: request?.redirectUri || buildDefaultRedirectUri((this.options.client as any)?.redirectMethod || 'web'),
      });

      const accessToken = tokenResponse?.access_token || tokenResponse?.accessToken;
      if (!accessToken) throw new Error('OAuth token response did not include an access token.');

      const tokenSet = {
        accessToken,
        refreshToken: tokenResponse?.refresh_token || tokenResponse?.refreshToken,
        idToken: tokenResponse?.id_token || tokenResponse?.idToken,
        scope: tokenResponse?.scope || this.options.scope || '',
        tokenType: tokenResponse?.token_type || tokenResponse?.tokenType || 'Bearer',
        expiresIn: tokenResponse?.expires_in || tokenResponse?.expiresIn,
        obtainedAt: new Date().toISOString(),
      };

      await this.options.client?.setTokens?.(tokenSet);
      await Promise.resolve(
        this.onAuthorize?.({ token: tokenSet.accessToken, type: 'oauth', idToken: tokenSet.idToken })
      );
      return true;
    } finally {
      try {
        await (window as any).electron?.oauthSetFlowActive?.(false);
      } catch {
        // best-effort
      }
    }
  }

  async getStoredToken(): Promise<{ token: string; idToken?: string } | null> {
    const stored = await this.options.client?.getTokens?.();
    const accessToken = stored?.accessToken || stored?.access_token;
    if (!accessToken) return null;

    const idToken = stored?.idToken || stored?.id_token;
    return { token: accessToken, idToken };
  }

  async authorize(): Promise<string> {
    if (this.options.personalAccessToken) {
      const token = this.options.personalAccessToken;
      await Promise.resolve(this.onAuthorize?.({ token, type: 'personal' }));
      return token;
    }

    if (typeof this.options.authorize === 'function') {
      const token = await this.options.authorize();
      await this.options.client?.setTokens?.({ accessToken: token, tokenType: 'Bearer', scope: this.options.scope || '' });
      await Promise.resolve(this.onAuthorize?.({ token, type: 'oauth' }));
      return token;
    }

    const stored = await this.getStoredToken();
    if (stored?.token) {
      await Promise.resolve(this.onAuthorize?.({ token: stored.token, type: 'oauth', idToken: stored.idToken }));
      return stored.token;
    }

    const ok = await this.beginAuthorization();
    if (!ok) throw new Error('OAuth authorization is required');

    const postAuth = await this.getStoredToken();
    if (!postAuth?.token) throw new Error('OAuth authorization failed');
    return postAuth.token;
  }
}
