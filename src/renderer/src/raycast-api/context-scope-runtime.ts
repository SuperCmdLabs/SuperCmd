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

const contextStack: ExtensionContextSnapshot[] = [];

export function configureContextScopeRuntime(nextDeps: ContextDeps) {
  deps = nextDeps;
}

export function snapshotExtensionContext(): ExtensionContextSnapshot {
  const ctx = getCurrentScopedExtensionContext();
  return {
    ...ctx,
    preferences: { ...(ctx.preferences || {}) },
  };
}

export function getCurrentScopedExtensionContext(): ExtensionContextSnapshot {
  const top = contextStack[contextStack.length - 1];
  if (top?.extensionName) return top;
  return deps.getExtensionContext();
}

export function withExtensionContext<T>(ctx: ExtensionContextSnapshot | undefined, fn: () => T): T {
  if (!ctx || !ctx.extensionName) return fn();
  const previous = getCurrentScopedExtensionContext();
  const next = {
    ...ctx,
    preferences: { ...(ctx.preferences || {}) },
  };
  contextStack.push(next);
  deps.setExtensionContext(next);

  const restore = () => {
    const top = contextStack[contextStack.length - 1];
    if (top === next) contextStack.pop();
    const fallback = contextStack[contextStack.length - 1] || previous;
    deps.setExtensionContext(fallback);
  };

  try {
    const value = fn();
    if (value && typeof (value as any).then === 'function') {
      return (value as Promise<any>).finally(restore) as T;
    }
    restore();
    return value;
  } catch (error) {
    restore();
    throw error;
  }
}
