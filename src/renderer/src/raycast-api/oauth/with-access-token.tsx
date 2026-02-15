/**
 * raycast-api/oauth/with-access-token.tsx
 * Purpose: withAccessToken HOC and access token state helpers.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import { oauthTokenKey, parseOAuthCallbackUrl } from './oauth-bridge';
import { OAuthService } from './oauth-service';
import { getOAuthRuntimeDeps } from './runtime-config';

let accessTokenValue: string | null = null;
let accessTokenType: 'oauth' | 'personal' | null = null;

export function withAccessToken(options: any) {
  const shouldInvokeOnAuthorize = !(options instanceof OAuthService);
  const mode = getOAuthRuntimeDeps().getExtensionContext().commandMode;

  if (mode === 'no-view') {
    return (fn: any) => {
      return async (props: any) => {
        const token = options?.personalAccessToken ?? (await options?.authorize?.());
        if (token) {
          accessTokenValue = token;
          accessTokenType = options?.personalAccessToken ? 'personal' : 'oauth';
          const idToken = (await options?.client?.getTokens?.())?.idToken;
          if (shouldInvokeOnAuthorize) {
            await Promise.resolve(options?.onAuthorize?.({ token, type: accessTokenType, idToken }));
          }
        }
        return await fn(props);
      };
    };
  }

  return (Component: any) => {
    const WrappedComponent: React.FC<any> = (props) => {
      const [ready, setReady] = useState(false);
      const [error, setError] = useState<string | null>(null);
      const [oauthNeedsAuth, setOauthNeedsAuth] = useState(false);
      const [oauthBusy, setOauthBusy] = useState(false);
      const [oauthLink, setOauthLink] = useState<string>('');
      const [oauthInfo, setOauthInfo] = useState<{ name: string; description: string; icon?: string } | null>(null);
      const [oauthHint, setOauthHint] = useState<string>('');
      const [oauthClientIdInput, setOauthClientIdInput] = useState('');

      const refreshOAuthState = useCallback(async () => {
        if (!(options instanceof OAuthService)) return false;
        const stored = await options.getStoredToken();
        if (!stored?.token) return false;

        accessTokenValue = stored.token;
        accessTokenType = 'oauth';
        await Promise.resolve(options.onAuthorize?.({ token: stored.token, type: 'oauth', idToken: stored.idToken }));
        setOauthNeedsAuth(false);
        setReady(true);
        setOauthBusy(false);
        setOauthHint('');
        return true;
      }, [options]);

      useEffect(() => {
        let cancelled = false;

        (async () => {
          try {
            if (options instanceof OAuthService) {
              const info = options.getProviderInfo();
              if (!cancelled) setOauthInfo(info);
              if (!cancelled) setOauthClientIdInput(options.getConfiguredClientId() || '');

              const authUrl = await options.getAuthorizationUrl();
              if (!cancelled) setOauthLink(authUrl || '');

              const ok = await refreshOAuthState();
              if (!ok && !cancelled) {
                setOauthNeedsAuth(true);
              }
              return;
            }

            const token = options?.personalAccessToken ?? (await options?.authorize?.());
            if (!token) throw new Error('No access token returned');

            accessTokenValue = token;
            accessTokenType = options?.personalAccessToken ? 'personal' : 'oauth';

            const idToken = (await options?.client?.getTokens?.())?.idToken;
            if (shouldInvokeOnAuthorize) {
              await Promise.resolve(options?.onAuthorize?.({ token, type: accessTokenType, idToken }));
            }

            if (!cancelled) setReady(true);
          } catch (e: any) {
            if (!cancelled) setError(e?.message || 'Failed to authorize');
          }
        })();

        return () => {
          cancelled = true;
        };
      }, [options, refreshOAuthState, shouldInvokeOnAuthorize]);

      useEffect(() => {
        if (!(options instanceof OAuthService)) return;

        const off = (window as any).electron?.onOAuthCallback?.((rawUrl: string) => {
          (async () => {
            const parsed = parseOAuthCallbackUrl(rawUrl);
            if (!parsed) return;

            if (parsed.error) {
              setOauthBusy(false);
              setOauthHint(parsed.errorDescription || parsed.error);
              return;
            }

            const providerKey = options.getProviderKey();
            if (parsed.provider && parsed.provider !== providerKey) return;

            const callbackToken = parsed.accessToken || parsed.code;
            if (callbackToken) {
              const tokenPayload = {
                accessToken: callbackToken,
                tokenType: parsed.tokenType || 'Bearer',
                scope: '',
                obtainedAt: new Date().toISOString(),
              };

              try {
                localStorage.setItem(oauthTokenKey(providerKey), JSON.stringify(tokenPayload));
              } catch {
                // best-effort
              }
              try {
                await (window as any).electron?.oauthSetToken?.(providerKey, tokenPayload);
              } catch {
                // best-effort
              }
            }

            const refreshed = await refreshOAuthState();
            if (!refreshed) {
              setOauthBusy(false);
              setOauthNeedsAuth(true);
              setOauthHint('Authorization callback received. Please try again.');
            }
          })().catch(() => {
            setOauthBusy(false);
          });
        });

        return () => {
          if (typeof off === 'function') off();
        };
      }, [options, refreshOAuthState]);

      useEffect(() => {
        if (!(options instanceof OAuthService) || !oauthBusy || !oauthNeedsAuth) return;

        let cancelled = false;
        let attempts = 0;
        const maxAttempts = 40;

        const tick = async () => {
          if (cancelled) return;
          attempts += 1;

          const refreshed = await refreshOAuthState();
          if (cancelled || refreshed) return;

          if (attempts >= maxAttempts) {
            setOauthBusy(false);
            setOauthHint('Authorization completed, but finalizing took too long. Try opening once more.');
            return;
          }

          setTimeout(() => {
            void tick();
          }, 500);
        };

        void tick();
        return () => {
          cancelled = true;
        };
      }, [options, oauthBusy, oauthNeedsAuth, refreshOAuthState]);

      const handleOAuthSignIn = useCallback(async () => {
        if (!(options instanceof OAuthService)) return;

        setOauthBusy(true);
        setOauthHint('');
        try {
          options.setClientIdOverride(oauthClientIdInput);
          const opened = await options.beginAuthorization();
          if (!opened) {
            setOauthHint('Unable to open authorization URL.');
            return;
          }

          const refreshed = await refreshOAuthState();
          if (!refreshed) {
            setOauthHint('Authorization finished but no token was stored.');
          }
        } catch (e: any) {
          setOauthHint(e?.message || 'Failed to start OAuth authorization.');
        } finally {
          setOauthBusy(false);
        }
      }, [oauthClientIdInput, options, refreshOAuthState]);

      const handleOAuthCopyLink = useCallback(async () => {
        if (!oauthLink) return;

        try {
          await navigator.clipboard.writeText(oauthLink);
          setOauthHint('Authorization link copied.');
        } catch {
          setOauthHint('Failed to copy authorization link.');
        }
      }, [oauthLink]);

      if (error) {
        return <div style={{ padding: 16, color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>{error}</div>;
      }

      if (oauthNeedsAuth) {
        const deps = getOAuthRuntimeDeps();
        const iconSrc = oauthInfo?.icon ? deps.resolveIconSrc(oauthInfo.icon) : deps.getExtensionContext().extensionIconDataUrl;

        return (
          <div className="h-full flex flex-col">
            <div className="flex-1 flex items-center justify-center px-6">
              <div className="w-full max-w-[520px] text-center">
                <div className="mx-auto mb-5 w-14 h-14 rounded-2xl border border-white/[0.12] bg-white/[0.04] flex items-center justify-center overflow-hidden">
                  {iconSrc ? <img src={iconSrc} alt="" className="w-9 h-9 object-contain" /> : <Sparkle className="w-5 h-5 text-white/70" />}
                </div>
                <div className="text-white/95 text-[34px] leading-tight font-semibold mb-1">{oauthInfo?.name || 'Sign In Required'}</div>
                <div className="text-white/60 text-[15px] mb-6">{oauthInfo?.description || 'Connect your account to continue.'}</div>
                <button
                  type="button"
                  onClick={handleOAuthSignIn}
                  disabled={oauthBusy}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${oauthBusy ? 'bg-white/[0.08] text-white/45 cursor-not-allowed' : 'bg-white/[0.14] hover:bg-white/[0.20] text-white'}`}
                >
                  {oauthBusy ? 'Opening...' : `Sign in with ${oauthInfo?.name || 'Provider'}`}
                </button>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-white/[0.06] text-center text-sm text-white/55">
              Need to open in another browser?{' '}
              <button type="button" onClick={handleOAuthCopyLink} className="text-cyan-300 hover:text-cyan-200 transition-colors">
                Copy authorization link
              </button>
              {oauthHint ? <div className="mt-1 text-xs text-white/40">{oauthHint}</div> : null}
            </div>
          </div>
        );
      }

      if (!ready) {
        return <div style={{ padding: 16, color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>Authorizing...</div>;
      }

      return <Component {...props} />;
    };

    WrappedComponent.displayName = `withAccessToken(${Component?.displayName || Component?.name || 'Component'})`;
    return WrappedComponent;
  };
}

export function getAccessToken(): { token: string; type: 'oauth' | 'personal' } {
  if (!accessTokenValue || !accessTokenType) {
    throw new Error('getAccessToken must be used when authenticated');
  }
  return { token: accessTokenValue, type: accessTokenType };
}

export function resetAccessToken(): void {
  accessTokenValue = null;
  accessTokenType = null;
}
