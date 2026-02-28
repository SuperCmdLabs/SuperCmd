/**
 * Action runtime entrypoint.
 *
 * Wires action registry, components, overlay extraction, and keyboard
 * utilities into one runtime consumed by the Raycast API integration layer.
 */

import { createActionComponentRuntime } from './action-runtime-components';
import { createActionOverlayRuntime } from './action-runtime-overlay';
import { createActionRegistryRuntime } from './action-runtime-registry';
import { isMetaK, matchesShortcut, renderShortcut } from './action-runtime-shortcuts';
import type React from 'react';

interface ActionRuntimeDeps {
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
  renderIcon: (icon: any, className?: string, assetsPath?: string) => React.ReactNode;
}

export function createActionRuntime(deps: ActionRuntimeDeps) {
  const registryRuntime = createActionRegistryRuntime({
    snapshotExtensionContext: deps.snapshotExtensionContext,
    withExtensionContext: deps.withExtensionContext,
    ExtensionInfoReactContext: deps.ExtensionInfoReactContext,
    getFormValues: deps.getFormValues,
    Clipboard: deps.Clipboard,
    trash: deps.trash,
    getGlobalNavigation: deps.getGlobalNavigation,
  });

  const componentRuntime = createActionComponentRuntime({
    ActionRegistryContext: registryRuntime.ActionRegistryContext,
    ActionSectionContext: registryRuntime.ActionSectionContext,
    useActionRegistration: registryRuntime.useActionRegistration,
  });

  const overlayRuntime = createActionOverlayRuntime({
    snapshotExtensionContext: deps.snapshotExtensionContext,
    inferActionTitle: registryRuntime.inferActionTitle,
    makeActionExecutor: registryRuntime.makeActionExecutor,
    renderIcon: deps.renderIcon,
    matchesShortcut,
    isMetaK,
    renderShortcut,
  });

  return {
    ...registryRuntime,
    ...componentRuntime,
    ...overlayRuntime,
    matchesShortcut,
    isMetaK,
    renderShortcut,
  };
}

export type { ExtractedAction } from './action-runtime-types';
