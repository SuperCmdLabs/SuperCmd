import { useCallback } from 'react';
import type React from 'react';
import type { CommandInfo, ExtensionBundle, QuickLinkDynamicField } from '../../types/electron';
import { LAST_EXT_KEY } from '../utils/constants';
import {
  getCmdArgsKey,
  getScriptCmdArgsKey,
  hydrateExtensionBundlePreferences,
  readJsonObject,
  shouldOpenCommandSetup,
  writeJsonObject,
} from '../utils/extension-preferences';
import {
  MAX_INLINE_QUICK_LINK_ARGUMENTS,
  getExtensionIdentityFromCommand,
  getQuickLinkIdFromCommandId,
} from '../utils/launcher-misc';
import type {
  ExtensionPreferenceSetup,
  ScriptCommandOutput,
  ScriptCommandSetup,
} from './useAppViewManager';
import type { LauncherContextMenuState } from '../components/LauncherContextMenuOverlay';
import type { QuickLinkDynamicPromptState } from '../components/QuickLinkDynamicPromptOverlay';

export type RunScriptCommandOptions = {
  background?: boolean;
  skipRecent?: boolean;
};

export type ExecuteQuickLinkCommandOptions = {
  skipPrompt?: boolean;
  dynamicValues?: Record<string, string>;
};

type UseLauncherCommandExecutionOptions = {
  fetchCommands: () => void | Promise<void>;
  updateRecentCommands: (commandId: string) => void | Promise<void>;

  setShowFileSearch: React.Dispatch<React.SetStateAction<boolean>>;
  setShowActions: React.Dispatch<React.SetStateAction<boolean>>;
  setContextMenu: React.Dispatch<React.SetStateAction<LauncherContextMenuState | null>>;

  setScriptCommandSetup: React.Dispatch<React.SetStateAction<ScriptCommandSetup | null>>;
  setScriptCommandOutput: React.Dispatch<React.SetStateAction<ScriptCommandOutput | null>>;
  setExtensionPreferenceSetup: React.Dispatch<React.SetStateAction<ExtensionPreferenceSetup | null>>;
  setExtensionView: React.Dispatch<React.SetStateAction<ExtensionBundle | null>>;

  inputRef: React.RefObject<HTMLInputElement>;

  getDynamicFieldsForQuickLink: (
    quickLinkId: string,
    options?: { forceRefresh?: boolean }
  ) => Promise<QuickLinkDynamicField[]>;

  inlineQuickLinkDynamicValuesById: Record<string, Record<string, string>>;
  selectedQuickLinkId: string | null;
  selectedInlineQuickLinkDynamicFields: QuickLinkDynamicField[];
  inlineQuickLinkInputRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;

  clearInlineQuickLinkDynamicValuesForId: (quickLinkId: string) => void;
  setQuickLinkDynamicPrompt: React.Dispatch<React.SetStateAction<QuickLinkDynamicPromptState | null>>;

  getInlineExtensionArgumentsForCommand: (command: CommandInfo) => Record<string, any>;
  clearInlineExtensionArgumentsForCommand: (command: CommandInfo) => void;

  queueNoViewBundleRun: (
    bundle: ExtensionBundle,
    launchType?: 'userInitiated' | 'background',
    reportStatus?: boolean
  ) => void;

  isMenuBarExtensionMounted: (bundle: Partial<ExtensionBundle>) => boolean;
  hideMenuBarExtension: (bundle: Partial<ExtensionBundle>) => void;
  upsertMenuBarExtension: (bundle: ExtensionBundle, options?: { remount?: boolean }) => void;
};

export function useLauncherCommandExecution(
  options: UseLauncherCommandExecutionOptions
): {
  runScriptCommand: (
    command: CommandInfo,
    values?: Record<string, any>,
    options?: RunScriptCommandOptions
  ) => Promise<boolean>;

  executeQuickLinkCommand: (
    command: CommandInfo,
    options?: ExecuteQuickLinkCommandOptions
  ) => Promise<boolean>;

  executeExtensionCommand: (command: CommandInfo) => Promise<boolean>;
} {
  const {
    fetchCommands,
    updateRecentCommands,
    setShowFileSearch,
    setShowActions,
    setContextMenu,
    setScriptCommandSetup,
    setScriptCommandOutput,
    setExtensionPreferenceSetup,
    setExtensionView,
    inputRef,
    getDynamicFieldsForQuickLink,
    inlineQuickLinkDynamicValuesById,
    selectedQuickLinkId,
    selectedInlineQuickLinkDynamicFields,
    inlineQuickLinkInputRefs,
    clearInlineQuickLinkDynamicValuesForId,
    setQuickLinkDynamicPrompt,
    getInlineExtensionArgumentsForCommand,
    clearInlineExtensionArgumentsForCommand,
    queueNoViewBundleRun,
    isMenuBarExtensionMounted,
    hideMenuBarExtension,
    upsertMenuBarExtension,
  } = options;

  const runScriptCommand = useCallback(
    async (
      command: CommandInfo,
      values?: Record<string, any>,
      options?: RunScriptCommandOptions
    ) => {
      const payload = {
        commandId: command.id,
        arguments: values || {},
        background: Boolean(options?.background),
      };
      const result = await window.electron.runScriptCommand(payload);

      if (!result) return false;

      if (result.needsArguments) {
        if (!options?.background) {
          setShowFileSearch(false);
          setScriptCommandSetup({
            command,
            values: {
              ...readJsonObject(getScriptCmdArgsKey(command.id)),
              ...(values || {}),
            },
          });
        }
        return false;
      }

      if (result.mode === 'fullOutput') {
        setShowFileSearch(false);
        setScriptCommandOutput({
          command,
          output: String(result.output || result.stdout || result.stderr || '').trim(),
          exitCode: Number(result.exitCode || 0),
        });
      } else if (result.mode === 'inline') {
        await fetchCommands();
      } else if (!options?.background) {
        await window.electron.hideWindow();
      }

      if (!options?.background && !options?.skipRecent) {
        await updateRecentCommands(command.id);
      }

      return Boolean(result.success);
    },
    [fetchCommands, setScriptCommandOutput, setScriptCommandSetup, setShowFileSearch, updateRecentCommands]
  );

  const executeQuickLinkCommand = useCallback(
    async (
      command: CommandInfo,
      options?: ExecuteQuickLinkCommandOptions
    ): Promise<boolean> => {
      const quickLinkId = getQuickLinkIdFromCommandId(command.id);
      if (!quickLinkId) return false;

      const fields = await getDynamicFieldsForQuickLink(quickLinkId, { forceRefresh: true });
      const inlineValues = { ...(inlineQuickLinkDynamicValuesById[quickLinkId] || {}) };
      if (selectedQuickLinkId === quickLinkId && selectedInlineQuickLinkDynamicFields.length > 0) {
        selectedInlineQuickLinkDynamicFields.forEach((field, index) => {
          const liveValue = inlineQuickLinkInputRefs.current[index]?.value;
          if (liveValue !== undefined) {
            inlineValues[field.key] = liveValue;
          }
        });
      }
      const resolvedValuesFromInline = fields.reduce((acc, field) => {
        const key = String(field.key || '').trim();
        if (!key) return acc;
        acc[key] = String(options?.dynamicValues?.[key] ?? inlineValues[key] ?? field.defaultValue ?? '');
        return acc;
      }, {} as Record<string, string>);

      if (!options?.skipPrompt) {
        if (fields.length > 0) {
          if (fields.length <= MAX_INLINE_QUICK_LINK_ARGUMENTS) {
            const openedInline = await window.electron.quickLinkOpen(quickLinkId, resolvedValuesFromInline);
            if (!openedInline) return false;
            clearInlineQuickLinkDynamicValuesForId(quickLinkId);
            setQuickLinkDynamicPrompt(null);
            await updateRecentCommands(command.id);
            await window.electron.hideWindow();
            return true;
          }
          setShowActions(false);
          setContextMenu(null);
          inputRef.current?.blur();
          setQuickLinkDynamicPrompt({
            command,
            quickLinkId,
            fields,
            values: resolvedValuesFromInline,
          });
          return true;
        }
      }

      const dynamicValues =
        options?.dynamicValues !== undefined
          ? options.dynamicValues
          : fields.length > 0
            ? resolvedValuesFromInline
            : undefined;
      const opened = await window.electron.quickLinkOpen(quickLinkId, dynamicValues);
      if (!opened) return false;

      clearInlineQuickLinkDynamicValuesForId(quickLinkId);
      setQuickLinkDynamicPrompt(null);
      await updateRecentCommands(command.id);
      await window.electron.hideWindow();
      return true;
    },
    [
      clearInlineQuickLinkDynamicValuesForId,
      getDynamicFieldsForQuickLink,
      inlineQuickLinkDynamicValuesById,
      selectedQuickLinkId,
      selectedInlineQuickLinkDynamicFields,
      updateRecentCommands,
      setShowActions,
      setContextMenu,
      inputRef,
      setQuickLinkDynamicPrompt,
      inlineQuickLinkInputRefs,
    ]
  );

  const executeExtensionCommand = useCallback(
    async (command: CommandInfo): Promise<boolean> => {
      // Extension command — build and show extension view
      const extensionIdentity = getExtensionIdentityFromCommand(command);
      if (!extensionIdentity) return false;
      const { extName, cmdName } = extensionIdentity;
      const result = await window.electron.runExtension(extName, cmdName);
      if (result && result.code) {
        const hydrated = hydrateExtensionBundlePreferences(result);
        const inlineArguments = getInlineExtensionArgumentsForCommand(command);
        const hydratedWithInlineArguments: ExtensionBundle = {
          ...hydrated,
          launchArguments: {
            ...((hydrated as any).launchArguments || {}),
            ...inlineArguments,
          } as any,
        };

        if (Object.keys(inlineArguments).length > 0 && command.mode === 'no-view') {
          writeJsonObject(
            getCmdArgsKey(extName, cmdName),
            { ...((hydratedWithInlineArguments as any).launchArguments || {}) }
          );
        }

        if (shouldOpenCommandSetup(hydratedWithInlineArguments)) {
          setShowFileSearch(false);
          setExtensionPreferenceSetup({
            bundle: hydratedWithInlineArguments,
            values: { ...(hydratedWithInlineArguments.preferences || {}) },
            argumentValues: { ...((hydratedWithInlineArguments as any).launchArguments || {}) },
          });
          return true;
        }

        // Menu-bar commands run in the hidden tray runners, not in the overlay.
        // Toggle behavior matches Raycast: running the same menu-bar command again hides it.
        if (hydratedWithInlineArguments.mode === 'menu-bar') {
          clearInlineExtensionArgumentsForCommand(command);
          if (isMenuBarExtensionMounted(hydratedWithInlineArguments)) {
            hideMenuBarExtension(hydratedWithInlineArguments);
          } else {
            upsertMenuBarExtension(hydratedWithInlineArguments);
          }
          try { window.electron.hideWindow(); } catch {}
          await updateRecentCommands(command.id);
          return true;
        }
        if (hydratedWithInlineArguments.mode === 'no-view') {
          queueNoViewBundleRun(hydratedWithInlineArguments, 'userInitiated');
          localStorage.removeItem(LAST_EXT_KEY);
          clearInlineExtensionArgumentsForCommand(command);
          await updateRecentCommands(command.id);
          return true;
        }
        setShowFileSearch(false);
        setExtensionView(hydratedWithInlineArguments);
        clearInlineExtensionArgumentsForCommand(command);
        if (hydratedWithInlineArguments.mode === 'view') {
          localStorage.setItem(LAST_EXT_KEY, JSON.stringify({ extName, cmdName }));
        } else {
          localStorage.removeItem(LAST_EXT_KEY);
        }
        await updateRecentCommands(command.id);
        return true;
      }
      const errMsg = result?.error || 'Failed to build extension';
      console.error('Extension load failed:', errMsg);
      // Show the error in the extension view
      setShowFileSearch(false);
      setExtensionView({
        code: '',
        title: command.title,
        mode: 'view',
        extName,
        cmdName,
        error: errMsg,
      } as any);
      return false;
    },
    [
      clearInlineExtensionArgumentsForCommand,
      getInlineExtensionArgumentsForCommand,
      hideMenuBarExtension,
      isMenuBarExtensionMounted,
      queueNoViewBundleRun,
      setExtensionPreferenceSetup,
      setExtensionView,
      setShowFileSearch,
      updateRecentCommands,
      upsertMenuBarExtension,
    ]
  );

  return {
    runScriptCommand,
    executeQuickLinkCommand,
    executeExtensionCommand,
  };
}
