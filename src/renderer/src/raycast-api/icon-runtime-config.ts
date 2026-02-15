/**
 * raycast-api/icon-runtime-config.ts
 * Purpose: Shared runtime config for icon and image resolution.
 */

export type IconRuntimeContext = {
  assetsPath?: string;
};

let getExtensionContextRef: () => IconRuntimeContext = () => ({ assetsPath: '' });

export function configureIconRuntime(deps: { getExtensionContext: () => IconRuntimeContext }) {
  getExtensionContextRef = deps.getExtensionContext;
}

export function getIconRuntimeContext(): IconRuntimeContext {
  return getExtensionContextRef();
}
