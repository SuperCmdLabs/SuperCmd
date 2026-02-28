/**
 * Action runtime React component layer.
 *
 * Exposes `Action` and `ActionPanel` component trees that register actions
 * through the action registry runtime.
 */

import React, { useContext } from 'react';

interface ComponentDeps {
  ActionRegistryContext: React.Context<any>;
  ActionSectionContext: React.Context<string | undefined>;
  useActionRegistration: (props: any, kind?: string) => null;
}

export function createActionComponentRuntime(deps: ComponentDeps) {
  const { ActionRegistryContext, ActionSectionContext, useActionRegistration } = deps;

  function ActionPanelComponent({ children }: { children?: React.ReactNode; title?: string }) {
    const registry = useContext(ActionRegistryContext);
    if (registry) return <>{children}</>;
    return null;
  }

  function ActionPanelSection({ children, title }: { children?: React.ReactNode; title?: string }) {
    const registry = useContext(ActionRegistryContext);
    if (!registry) return null;
    return <ActionSectionContext.Provider value={title}>{children}</ActionSectionContext.Provider>;
  }

  function ActionPanelItem(props: any) {
    useActionRegistration(props, 'action');
    return null;
  }

  function ActionPanelSubmenu({ children, title }: { children?: React.ReactNode; title?: string }) {
    const registry = useContext(ActionRegistryContext);
    if (!registry) return null;
    return <ActionSectionContext.Provider value={title}>{children}</ActionSectionContext.Provider>;
  }

  function ActionComponent(props: any) {
    useActionRegistration(props, 'action');
    return null;
  }

  function createActionKindComponent(kind: string) {
    return function ActionKindComponent(props: any) {
      useActionRegistration({ ...props, __actionKind: kind }, kind);
      return null;
    };
  }

  const ActionPickDateWithType = Object.assign(createActionKindComponent('pickDate'), {
    Type: { DateTime: 'datetime' as const, Date: 'date' as const },
  });

  const Action = Object.assign(ActionComponent, {
    CopyToClipboard: createActionKindComponent('copyToClipboard'),
    Open: createActionKindComponent('open'),
    OpenInBrowser: createActionKindComponent('openInBrowser'),
    Push: createActionKindComponent('push'),
    SubmitForm: createActionKindComponent('submitForm'),
    Paste: createActionKindComponent('paste'),
    ShowInFinder: ActionComponent,
    OpenWith: ActionComponent,
    Trash: createActionKindComponent('trash'),
    PickDate: ActionPickDateWithType,
    ToggleQuickLook: createActionKindComponent('toggleQuickLook'),
    CreateSnippet: createActionKindComponent('createSnippet'),
    CreateQuicklink: createActionKindComponent('createQuicklink'),
    ToggleSidebar: createActionKindComponent('toggleSidebar'),
    Style: {
      Regular: 'regular' as const,
      Destructive: 'destructive' as const,
    },
  });

  const ActionPanel = Object.assign(ActionPanelComponent, {
    Item: ActionPanelItem,
    Section: ActionPanelSection,
    Submenu: ActionPanelSubmenu,
  });

  return {
    Action,
    ActionPanel,
  };
}
