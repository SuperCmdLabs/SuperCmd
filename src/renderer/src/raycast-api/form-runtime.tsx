/**
 * Form runtime container.
 *
 * Builds the `Form` API surface, wires action handling, and attaches
 * all field subcomponents.
 */

import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { attachFormFields } from './form-runtime-fields';
import {
  FormContext,
  setCurrentFormErrors,
  setCurrentFormValues,
} from './form-runtime-context';
import type { ExtractedAction } from './action-runtime';

interface FormRuntimeDeps {
  ExtensionInfoReactContext: React.Context<any>;
  useNavigation: () => { pop: () => void };
  useCollectedActions: () => { collectedActions: ExtractedAction[]; registryAPI: any };
  ActionRegistryContext: React.Context<any>;
  ActionPanelOverlay: React.ComponentType<{
    actions: ExtractedAction[];
    onClose: () => void;
    onExecute: (action: ExtractedAction) => void;
  }>;
  matchesShortcut: (event: React.KeyboardEvent | KeyboardEvent, shortcut?: { modifiers?: string[]; key?: string }) => boolean;
  isMetaK: (event: React.KeyboardEvent | KeyboardEvent) => boolean;
  renderShortcut: (shortcut?: { modifiers?: string[]; key?: string }) => React.ReactNode;
  getExtensionContext: () => {
    extensionDisplayName?: string;
    extensionName: string;
    extensionIconDataUrl?: string;
  };
}

export function createFormRuntime(deps: FormRuntimeDeps) {
  const {
    ExtensionInfoReactContext,
    useNavigation,
    useCollectedActions,
    ActionRegistryContext,
    ActionPanelOverlay,
    matchesShortcut,
    isMetaK,
    renderShortcut,
    getExtensionContext,
  } = deps;

  function FormComponent({ children, actions, navigationTitle, isLoading, draftValues }: any) {
    const extInfo = useContext(ExtensionInfoReactContext);
    const [values, setValues] = useState<Record<string, any>>(draftValues || {});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showActions, setShowActions] = useState(false);
    const { pop } = useNavigation();

    const setValue = useCallback((id: string, value: any) => {
      setValues((previous) => {
        const next = { ...previous, [id]: value };
        setCurrentFormValues(next);
        return next;
      });
      setErrors((previous) => {
        const next = { ...previous };
        delete next[id];
        setCurrentFormErrors(next);
        return next;
      });
    }, []);

    const setError = useCallback((id: string, error: string) => {
      setErrors((previous) => {
        const next = { ...previous, [id]: error };
        setCurrentFormErrors(next);
        return next;
      });
    }, []);

    useEffect(() => {
      setCurrentFormValues(values);
      setCurrentFormErrors(errors);
    }, [values, errors]);

    const { collectedActions: formActions, registryAPI: formActionRegistry } = useCollectedActions();
    const primaryAction = formActions[0];

    const extensionContext = getExtensionContext();
    const footerTitle =
      navigationTitle ||
      extInfo.extensionDisplayName ||
      extensionContext.extensionDisplayName ||
      extensionContext.extensionName ||
      'Extension';
    const footerIcon = extInfo.extensionIconDataUrl || extensionContext.extensionIconDataUrl;

    useEffect(() => {
      const handler = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          pop();
          return;
        }
        if (isMetaK(event)) {
          event.preventDefault();
          setShowActions((value) => !value);
          return;
        }
        if (event.key === 'Enter' && event.metaKey && !event.repeat && primaryAction) {
          event.preventDefault();
          primaryAction.execute();
          return;
        }
        if (event.repeat) return;
        for (const action of formActions) {
          if (!action.shortcut || !matchesShortcut(event, action.shortcut)) continue;
          event.preventDefault();
          action.execute();
          return;
        }
      };

      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [formActions, isMetaK, matchesShortcut, pop, primaryAction]);

    const contextValue = useMemo(() => ({ values, setValue, errors, setError }), [errors, setError, setValue, values]);
    const handleActionExecute = useCallback((action: ExtractedAction) => {
      setShowActions(false);
      action.execute();
    }, []);

    return (
      <FormContext.Provider value={contextValue}>
        {actions && (
          <div style={{ display: 'none' }}>
            <ActionRegistryContext.Provider value={formActionRegistry}>{actions}</ActionRegistryContext.Provider>
          </div>
        )}

        <div
          className="flex flex-col h-full"
          onContextMenu={(event) => {
            if (formActions.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            setShowActions(true);
          }}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--ui-divider)]">
            <button onClick={pop} className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0 p-0.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 px-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
                <p className="text-sm">Loading…</p>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto space-y-3">{children}</div>
            )}
          </div>

          {formActions.length > 0 && (
            <div className="sc-glass-footer flex items-center px-4 py-2.5">
              <div className="sc-footer-primary flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-normal">
                {footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}
                <span className="truncate">{footerTitle}</span>
              </div>
              {primaryAction && (
                <button type="button" onClick={() => primaryAction.execute()} className="flex items-center gap-2 mr-3 text-[var(--text-primary)] hover:text-[var(--text-secondary)] transition-colors">
                  <span className="text-xs font-semibold">{primaryAction.title}</span>
                  {primaryAction.shortcut ? (
                    <span className="flex items-center gap-0.5">{renderShortcut(primaryAction.shortcut)}</span>
                  ) : (
                    <>
                      <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">⌘</kbd>
                      <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">↩</kbd>
                    </>
                  )}
                </button>
              )}
              <button onClick={() => setShowActions(true)} className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                <span className="text-xs font-normal">Actions</span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">⌘</kbd>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">K</kbd>
              </button>
            </div>
          )}
        </div>

        {showActions && formActions.length > 0 && (
          <ActionPanelOverlay actions={formActions} onClose={() => setShowActions(false)} onExecute={handleActionExecute} />
        )}
      </FormContext.Provider>
    );
  }

  attachFormFields(FormComponent);
  return { Form: FormComponent };
}
