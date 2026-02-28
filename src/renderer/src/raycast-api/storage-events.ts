/**
 * raycast-api/storage-events.ts
 * Purpose: Shared extension storage change event bridge.
 */

type ExtensionCtx = { extensionName?: string };

let getExtensionContextRef: () => ExtensionCtx = () => ({ extensionName: '' });

export function configureStorageEvents(deps: { getExtensionContext: () => ExtensionCtx }) {
  getExtensionContextRef = deps.getExtensionContext;
}

export function emitExtensionStorageChanged(): void {
  try {
    const extensionName = (getExtensionContextRef().extensionName || '').trim();
    if (!extensionName) return;

    window.dispatchEvent(
      new CustomEvent('sc-extension-storage-changed', {
        detail: { extensionName },
      })
    );
  } catch {
    // best-effort
  }
}
