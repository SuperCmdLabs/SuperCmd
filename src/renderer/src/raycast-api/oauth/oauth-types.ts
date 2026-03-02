/**
 * raycast-api/oauth/oauth-types.ts
 * Purpose: Shared OAuth types.
 */

export type OAuthProviderInfo = {
  name: string;
  description: string;
  icon?: string;
};

export type OAuthAuthorizedToken = {
  token: string;
  type: 'oauth' | 'personal';
  idToken?: string;
};

export type OAuthServiceOptions = {
  client?: {
    providerId?: string;
    providerName?: string;
    providerIcon?: any;
    description?: string;
    redirectMethod?: string;
    extensionName?: string;
    authorizationRequest?: (options: any) => Promise<any>;
    setTokens?: (tokens: any) => Promise<void>;
    getTokens?: () => Promise<any>;
    removeTokens?: () => Promise<void>;
  };
  clientId?: string;
  scope?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  refreshTokenUrl?: string;
  bodyEncoding?: string;
  onAuthorize?: (params: OAuthAuthorizedToken) => void | Promise<void>;
  authorize?: () => Promise<string>;
  personalAccessToken?: string;
};
