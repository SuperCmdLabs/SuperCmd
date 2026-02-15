/**
 * Action runtime registry and execution layer.
 *
 * Owns action registration contexts, action execution semantics, and
 * collection of currently mounted actions from extension JSX trees.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ActionRegistration,
  ActionRegistryAPI,
} from './action-runtime-types';

interface RegistryDeps {
  snapshotExtensionContext: () => any;
  withExtensionContext: <T>(ctx: any, callback: () => T) => T;
  ExtensionInfoReactContext: React.Context<{
    extId: string;
    assetsPath: string;
    commandMode: 'view' | 'no-view' | 'menu-bar';
    extensionDisplayName?: string;
    extensionIconDataUrl?: string;
  }>;
  getFormValues: () => Record<string, any>;
  Clipboard: {
    copy: (content: any) => Promise<void> | void;
    paste?: (content: any) => Promise<void> | void;
  };
  trash: (path: string | string[]) => Promise<void> | void;
  getGlobalNavigation: () => { push: (element: React.ReactElement) => void };
}

export function createActionRegistryRuntime(deps: RegistryDeps) {
  const {
    snapshotExtensionContext,
    withExtensionContext,
    ExtensionInfoReactContext,
    getFormValues,
    Clipboard,
    trash,
    getGlobalNavigation,
  } = deps;

  let actionOrderCounter = 0;

  const ActionRegistryContext = createContext<ActionRegistryAPI | null>(null);
  const ActionSectionContext = createContext<string | undefined>(undefined);

  function makeActionExecutor(props: any, runtimeCtx?: any): () => void {
    return () => {
      withExtensionContext(runtimeCtx, () => {
        if (props.onAction) {
          return props.onAction();
        }
        if (props.onSubmit) {
          return props.onSubmit(getFormValues());
        }
        if (props.content !== undefined) {
          let op: Promise<void> | void;
          if (props.__actionKind === 'paste') {
            op = Clipboard.paste?.(props.content);
          } else {
            op = Clipboard.copy(props.content);
          }
          props.onCopy?.();
          props.onPaste?.();
          return op;
        }
        if (props.url) {
          (window as any).electron?.openUrl?.(props.url);
          props.onOpen?.();
          return;
        }
        if (props.target && React.isValidElement(props.target)) {
          getGlobalNavigation().push(props.target);
          props.onPush?.();
          return;
        }
        if (props.paths) {
          const op = trash(props.paths);
          props.onTrash?.();
          return op;
        }
      });
    };
  }

  function inferActionTitle(props: any, kind?: string): string {
    if (props?.title) return props.title;

    switch (kind || props?.__actionKind) {
      case 'copyToClipboard':
        return 'Copy to Clipboard';
      case 'paste':
        return 'Paste';
      case 'openInBrowser':
        return 'Open in Browser';
      case 'push':
        return 'Open';
      case 'submitForm':
        return 'Submit';
      case 'trash':
        return 'Move to Trash';
      case 'pickDate':
        return 'Pick Date';
      case 'open':
        return 'Open';
      case 'toggleQuickLook':
        return 'Toggle Quick Look';
      case 'createSnippet':
        return 'Create Snippet';
      case 'createQuicklink':
        return 'Create Quicklink';
      case 'toggleSidebar':
        return 'Toggle Sidebar';
      default:
        return 'Action';
    }
  }

  function useActionRegistration(props: any, kind?: string) {
    const registry = useContext(ActionRegistryContext);
    const sectionTitle = useContext(ActionSectionContext);
    const extensionInfo = useContext(ExtensionInfoReactContext);
    const idRef = useRef(`__action_${++actionOrderCounter}`);
    const orderRef = useRef(++actionOrderCounter);
    const runtimeCtxRef = useRef(snapshotExtensionContext());

    const propsRef = useRef(props);
    propsRef.current = props;
    const nextRuntimeCtx = snapshotExtensionContext();
    const extId = String(extensionInfo?.extId || '').trim();
    const [extName = '', commandName = ''] = extId.split('/');
    if (extName) nextRuntimeCtx.extensionName = extName;
    if (commandName) nextRuntimeCtx.commandName = commandName;
    if (extensionInfo?.assetsPath) nextRuntimeCtx.assetsPath = extensionInfo.assetsPath;
    if (extensionInfo?.commandMode) nextRuntimeCtx.commandMode = extensionInfo.commandMode;
    if (extensionInfo?.extensionDisplayName) nextRuntimeCtx.extensionDisplayName = extensionInfo.extensionDisplayName;
    if (extensionInfo?.extensionIconDataUrl) nextRuntimeCtx.extensionIconDataUrl = extensionInfo.extensionIconDataUrl;
    runtimeCtxRef.current = nextRuntimeCtx;

    useEffect(() => {
      if (!registry) return;

      const executor = () => makeActionExecutor(propsRef.current, runtimeCtxRef.current)();
      registry.register(idRef.current, {
        title: inferActionTitle(props, kind),
        icon: props.icon,
        shortcut: props.shortcut,
        style: props.style,
        sectionTitle,
        execute: executor,
        order: orderRef.current,
      });

      return () => registry.unregister(idRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registry, props.title, props.icon, props.shortcut, props.style, sectionTitle]);

    return null;
  }

  function useCollectedActions() {
    const registryRef = useRef(new Map<string, ActionRegistration>());
    const [version, setVersion] = useState(0);
    const pendingRef = useRef(false);
    const lastSnapshotRef = useRef('');

    const scheduleUpdate = useCallback(() => {
      if (pendingRef.current) return;

      pendingRef.current = true;
      queueMicrotask(() => {
        pendingRef.current = false;
        const entries = Array.from(registryRef.current.values());
        const snapshot = entries.map((entry) => `${entry.id}:${entry.title}:${entry.sectionTitle || ''}`).join('|');
        if (snapshot !== lastSnapshotRef.current) {
          lastSnapshotRef.current = snapshot;
          setVersion((value) => value + 1);
        }
      });
    }, []);

    const registryAPI = useMemo<ActionRegistryAPI>(
      () => ({
        register(id, data) {
          const existing = registryRef.current.get(id);
          if (existing) {
            existing.title = data.title;
            existing.icon = data.icon;
            existing.shortcut = data.shortcut;
            existing.style = data.style;
            existing.sectionTitle = data.sectionTitle;
            existing.execute = data.execute;
            existing.order = data.order;
          } else {
            registryRef.current.set(id, { id, ...data });
          }
          scheduleUpdate();
        },
        unregister(id) {
          if (!registryRef.current.has(id)) return;
          registryRef.current.delete(id);
          scheduleUpdate();
        },
      }),
      [scheduleUpdate],
    );

    const collectedActions = useMemo(() => {
      return Array.from(registryRef.current.values()).sort((a, b) => a.order - b.order);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version]);

    return { collectedActions, registryAPI };
  }

  return {
    ActionRegistryContext,
    ActionSectionContext,
    makeActionExecutor,
    inferActionTitle,
    useActionRegistration,
    useCollectedActions,
  };
}
