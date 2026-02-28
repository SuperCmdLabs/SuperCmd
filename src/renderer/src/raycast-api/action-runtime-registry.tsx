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

function parseExtensionIdentity(extId: string): { extensionName: string; commandName: string } | null {
  const raw = String(extId || '').trim();
  const separatorIndex = raw.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) return null;

  const extensionName = raw.slice(0, separatorIndex).trim();
  const commandName = raw.slice(separatorIndex + 1).trim();
  if (!extensionName || !commandName) return null;

  return { extensionName, commandName };
}

function toLocalDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalDateTimeInputValue(date: Date): string {
  const datePart = toLocalDateInputValue(date);
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${datePart}T${hours}:${minutes}`;
}

function parseInputDateValue(value: string, type: 'date' | 'datetime'): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (type === 'date') {
    const [yearRaw, monthRaw, dayRaw] = raw.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePickerDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function runPickDateAction(props: any): void {
  const pickerType = props?.type === 'datetime' ? 'datetime' : 'date';
  const inputType = pickerType === 'datetime' ? 'datetime-local' : 'date';

  if (typeof document === 'undefined') {
    props?.onChange?.(null);
    return;
  }

  const input = document.createElement('input');
  input.type = inputType;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  input.style.left = '-9999px';
  input.style.top = '-9999px';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  const initialValue = normalizePickerDate(props?.value);
  if (initialValue) {
    input.value = pickerType === 'datetime'
      ? toLocalDateTimeInputValue(initialValue)
      : toLocalDateInputValue(initialValue);
  }

  const minValue = normalizePickerDate(props?.min);
  if (minValue) {
    input.min = pickerType === 'datetime'
      ? toLocalDateTimeInputValue(minValue)
      : toLocalDateInputValue(minValue);
  }

  const maxValue = normalizePickerDate(props?.max);
  if (maxValue) {
    input.max = pickerType === 'datetime'
      ? toLocalDateTimeInputValue(maxValue)
      : toLocalDateInputValue(maxValue);
  }

  let finished = false;

  const cleanup = () => {
    if (input.parentElement) {
      input.parentElement.removeChild(input);
    }
  };

  const complete = (nextValue: Date | null, shouldEmit: boolean) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (shouldEmit) {
      props?.onChange?.(nextValue);
    }
  };

  input.addEventListener('change', () => {
    complete(parseInputDateValue(input.value, pickerType), true);
  }, { once: true });

  input.addEventListener('blur', () => {
    // On cancel, browsers often blur without firing change.
    window.setTimeout(() => complete(null, false), 0);
  }, { once: true });

  document.body.appendChild(input);
  input.focus({ preventScroll: true });

  const picker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker;
  if (typeof picker === 'function') {
    try {
      picker.call(input);
      return;
    } catch {
      // Fallback to click when showPicker throws due activation constraints.
    }
  }

  input.click();
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
        if (props.__actionKind === 'createSnippet') {
          void (window as any).electron?.executeCommand?.('system-create-snippet');
          return;
        }
        if (props.__actionKind === 'createQuicklink') {
          void (window as any).electron?.executeCommand?.('system-create-quicklink');
          return;
        }
        if (props.__actionKind === 'pickDate') {
          runPickDateAction(props);
          return;
        }
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
    const parsedIdentity = parseExtensionIdentity(extId);
    if (parsedIdentity?.extensionName) nextRuntimeCtx.extensionName = parsedIdentity.extensionName;
    if (parsedIdentity?.commandName) nextRuntimeCtx.commandName = parsedIdentity.commandName;
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
