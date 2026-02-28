/**
 * raycast-api/oauth/oauth-service.ts
 * Purpose: OAuthService public class with built-in provider factory methods.
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

function createServerAuthorize(url: string, providerName: string): () => Promise<string> {
  return async () => {
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

    return new OAuthService({
      client,
      clientId: options.clientId || '_supercmd_linear',
      scope: options.scope,
      authorizeUrl: 'https://api.supercmd.sh/auth/linear/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize || createServerAuthorize('https://api.supercmd.sh/auth/linear/authorize', 'Linear'),
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

    return new OAuthService({
      client,
      clientId: options.clientId || '_supercmd_spotify',
      scope: options.scope,
      authorizeUrl: 'https://api.supercmd.sh/auth/spotify/authorize',
      tokenUrl: 'https://accounts.spotify.com/api/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize || createServerAuthorize('https://api.supercmd.sh/auth/spotify/authorize', 'Spotify'),
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
    return new OAuthService({
      client,
      clientId: options.clientId || '_supercmd_jira',
      scope: options.scope,
      authorizeUrl: 'https://api.supercmd.sh/auth/jira/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize || createServerAuthorize('https://api.supercmd.sh/auth/jira/authorize', 'Jira'),
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
