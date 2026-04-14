/**
 * raycast-api/oauth/oauth-service.ts
 * Purpose: OAuthService public class with built-in provider factory methods.
 *
 * OAuth relay URL: providers that require a server-side relay (Linear, Spotify,
 * Jira) default to the SUPERCMD_OAUTH_RELAY_URL environment variable.
 * Set this to your own relay server to avoid any third-party dependency.
 * If unset, the relay flow is skipped and PKCE is used directly where possible.
 */

import { PKCEClientCompat } from './oauth-client';
import { ensureOAuthCallbackBridge, waitForOAuthCallback } from './oauth-bridge';
import { OAuthServiceCore } from './oauth-service-core';
import type { OAuthServiceOptions } from './oauth-types';
import { getOAuthRuntimeDeps } from './runtime-config';

type OAuthFactoryOptions = {
  clientId?: string;
  scope: string;
  personalAccessToken?: string;
  authorize?: () => Promise<string>;
  onAuthorize?: OAuthServiceOptions['onAuthorize'];
};

/**
 * Returns the configured OAuth relay base URL.
 * Reads SUPERCMD_OAUTH_RELAY_URL env var — unset means no relay.
 * Operators running their own SuperCmd instance should set this to
 * their own relay server URL.
 */
function getRelayBaseUrl(): string | null {
  const envUrl = (typeof process !== 'undefined' && process.env?.SUPERCMD_OAUTH_RELAY_URL) || '';
  return envUrl.trim() || null;
}

function createServerAuthorize(providerPath: string, providerName: string): () => Promise<string> {
  return async () => {
    const relayBase = getRelayBaseUrl();
    if (!relayBase) {
      throw new Error(
        `${providerName} OAuth requires a relay server. ` +
        `Set SUPERCMD_OAUTH_RELAY_URL to your relay URL, or provide a custom authorize() function.`
      );
    }
    const url = `${relayBase.replace(/\/$/, '')}${providerPath}`;
    ensureOAuthCallbackBridge();
    await getOAuthRuntimeDeps().open(url);
    const callback = await waitForOAuthCallback('');
    if (callback.error) {
      throw new Error(callback.errorDescription || callback.error);
    }
    const token = callback.accessToken || callback.code;
    if (!token) {
      throw new Error(`${providerName} authorization did not return a valid token.`);
    }
    return token;
  };
}

export class OAuthService extends OAuthServiceCore {
  static linear(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({
      providerId: 'linear',
      providerName: 'Linear',
      providerIcon: 'linear-app-icon.png',
      description: 'Connect your Linear account',
    });

    const relayBase = getRelayBaseUrl();
    return new OAuthService({
      client,
      clientId: options.clientId || '_supercmd_linear',
      scope: options.scope,
      authorizeUrl: relayBase ? `${relayBase.replace(/\/$/, '')}/auth/linear/authorize` : 'https://linear.app/oauth/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize || createServerAuthorize('/auth/linear/authorize', 'Linear'),
      onAuthorize: options.onAuthorize,
    });
  }

  static spotify(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({
      providerId: 'spotify',
      providerName: 'Spotify',
      providerIcon: 'spotify-icon.png',
      description: 'Connect your Spotify account',
    });

    const relayBase = getRelayBaseUrl();
    return new OAuthService({
      client,
      clientId: options.clientId || '_supercmd_spotify',
      scope: options.scope,
      authorizeUrl: relayBase ? `${relayBase.replace(/\/$/, '')}/auth/spotify/authorize` : 'https://accounts.spotify.com/authorize',
      tokenUrl: 'https://accounts.spotify.com/api/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize || createServerAuthorize('/auth/spotify/authorize', 'Spotify'),
      onAuthorize: options.onAuthorize,
    });
  }

  static github(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'github', providerName: 'GitHub', providerIcon: 'github-icon.png', description: 'Connect your GitHub account' });
    return new OAuthService({
      client,
      clientId: options.clientId || 'supercmd-github',
      scope: options.scope,
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static google(options: OAuthFactoryOptions & { clientId: string }): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'google', providerName: 'Google', providerIcon: 'google-icon.png', description: 'Connect your Google account' });
    return new OAuthService({
      client,
      clientId: options.clientId,
      scope: options.scope,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static asana(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'asana', providerName: 'Asana', providerIcon: 'asana-icon.png', description: 'Connect your Asana account' });
    return new OAuthService({
      client,
      clientId: options.clientId || 'supercmd-asana',
      scope: options.scope,
      authorizeUrl: 'https://app.asana.com/-/oauth_authorize',
      tokenUrl: 'https://app.asana.com/-/oauth_token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static slack(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'slack', providerName: 'Slack', providerIcon: 'slack-icon.png', description: 'Connect your Slack account' });
    return new OAuthService({
      client,
      clientId: options.clientId || 'supercmd-slack',
      scope: options.scope,
      authorizeUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static jira(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'jira', providerName: 'Jira', providerIcon: 'jira-icon.png', description: 'Connect your Jira account' });
    const relayBase = getRelayBaseUrl();
    return new OAuthService({
      client,
      clientId: options.clientId || '_supercmd_jira',
      scope: options.scope,
      authorizeUrl: relayBase ? `${relayBase.replace(/\/$/, '')}/auth/jira/authorize` : 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize || createServerAuthorize('/auth/jira/authorize', 'Jira'),
      onAuthorize: options.onAuthorize,
    });
  }

  static zoom(options: OAuthFactoryOptions & { clientId: string }): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'zoom', providerName: 'Zoom', providerIcon: 'zoom-icon.png', description: 'Connect your Zoom account' });
    return new OAuthService({
      client,
      clientId: options.clientId,
      scope: options.scope,
      authorizeUrl: 'https://zoom.us/oauth/authorize',
      tokenUrl: 'https://zoom.us/oauth/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }
}
