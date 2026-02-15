/**
 * raycast-api/oauth/runtime-config.ts
 * Purpose: Shared runtime dependencies for OAuth modules.
 */

export type OAuthRuntimeExtensionContext = {
  extensionName?: string;
  extensionIconDataUrl?: string;
  commandMode?: "view" | "no-view" | "menu-bar";
};

export type OAuthRuntimeDeps = {
  getExtensionContext: () => OAuthRuntimeExtensionContext;
  open: (target: string, application?: string | { name: string; path: string }) => Promise<void>;
  resolveIconSrc: (src: string) => string;
};

const defaultDeps: OAuthRuntimeDeps = {
  getExtensionContext: () => ({ extensionName: '', extensionIconDataUrl: '' }),
  open: async () => {},
  resolveIconSrc: (src: string) => src,
};

let runtimeDeps: OAuthRuntimeDeps = defaultDeps;

export function configureOAuthRuntime(deps: Partial<OAuthRuntimeDeps>) {
  runtimeDeps = {
    ...runtimeDeps,
    ...deps,
  };
}

export function getOAuthRuntimeDeps(): OAuthRuntimeDeps {
  return runtimeDeps;
}
