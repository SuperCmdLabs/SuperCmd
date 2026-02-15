/**
 * raycast-api/context-scope-runtime.ts
 * Purpose: Scoped extension-context snapshot/restore helpers.
 */

export type ExtensionContextSnapshot = {
  extensionName: string;
  extensionDisplayName?: string;
  extensionIconDataUrl?: string;
  commandName: string;
  assetsPath: string;
  supportPath: string;
  owner: string;
  preferences: Record<string, any>;
  commandMode: 'view' | 'no-view' | 'menu-bar';
};

type ContextDeps = {
  getExtensionContext: () => ExtensionContextSnapshot;
  setExtensionContext: (ctx: ExtensionContextSnapshot) => void;
};

let deps: ContextDeps = {
  getExtensionContext: () => ({
    extensionName: '',
    extensionDisplayName: '',
    extensionIconDataUrl: '',
    commandName: '',
    assetsPath: '',
    supportPath: '/tmp/supercmd',
    owner: '',
    preferences: {},
    commandMode: 'view',
  }),
  setExtensionContext: () => {},
};

export function configureContextScopeRuntime(nextDeps: ContextDeps) {
  deps = nextDeps;
}

export function snapshotExtensionContext(): ExtensionContextSnapshot {
  const ctx = deps.getExtensionContext();
  return {
    ...ctx,
    preferences: { ...(ctx.preferences || {}) },
  };
}

export function withExtensionContext<T>(ctx: ExtensionContextSnapshot | undefined, fn: () => T): T {
  if (!ctx || !ctx.extensionName) return fn();
  const previous = snapshotExtensionContext();
  deps.setExtensionContext(ctx);
  try {
    return fn();
  } finally {
    deps.setExtensionContext(previous);
  }
}
