import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { CommandInfo, QuickLinkDynamicField } from '../../types/electron';
import { useInlineArgumentAnchor } from './useInlineArgumentAnchor';
import {
  clearCommandArguments,
  getCmdArgsKey,
  readJsonObject,
  writeJsonObject,
} from '../utils/extension-preferences';
import {
  MAX_INLINE_EXTENSION_ARGUMENTS,
  MAX_INLINE_QUICK_LINK_ARGUMENTS,
  getExtensionIdentityFromCommand,
  getQuickLinkIdFromCommandId,
  normalizeQuickLinkDynamicFields,
} from '../utils/launcher-misc';
import { renderCommandIcon } from '../utils/command-helpers';

export type UseLauncherInlineArgumentsParams = {
  selectedCommand: CommandInfo | null;
  selectedCommandId: string | undefined;
  searchQuery: string;
  isLauncherModeActive: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
};

export type UseLauncherInlineArgumentsResult = {
  inlineArgumentLaneRef: React.RefObject<HTMLDivElement>;
  inlineArgumentClusterRef: React.RefObject<HTMLDivElement>;
  inlineArgumentInputRefs: React.MutableRefObject<Array<HTMLInputElement | HTMLSelectElement | null>>;
  inlineQuickLinkInputRefs: React.MutableRefObject<Array<HTMLInputElement | null>>;

  selectedExtensionArgumentDefinitions: NonNullable<CommandInfo['commandArgumentDefinitions']>;
  selectedInlineExtensionArgumentDefinitions: NonNullable<CommandInfo['commandArgumentDefinitions']>;
  selectedInlineExtensionArgumentValues: Record<string, string>;
  hasSelectedExtensionOverflowArguments: boolean;

  selectedQuickLinkId: string | null;
  selectedQuickLinkDynamicFields: QuickLinkDynamicField[];
  selectedInlineQuickLinkDynamicFields: QuickLinkDynamicField[];
  selectedInlineQuickLinkDynamicValues: Record<string, string>;
  hasSelectedQuickLinkOverflowDynamicFields: boolean;

  isShowingInlineArgumentInputs: boolean;
  shouldHideAskAi: boolean;
  selectedInlineArgumentLeadingIcon: React.ReactNode;
  inlineArgumentStartPx: number | null;

  inlineQuickLinkDynamicFieldsById: Record<string, QuickLinkDynamicField[]>;
  inlineQuickLinkDynamicValuesById: Record<string, Record<string, string>>;

  requestPendingInlineArgumentFocus: () => void;
  getDynamicFieldsForQuickLink: (
    quickLinkId: string,
    options?: { forceRefresh?: boolean }
  ) => Promise<QuickLinkDynamicField[]>;

  updateInlineExtensionArgumentValue: (
    command: CommandInfo,
    argumentName: string,
    value: string
  ) => void;
  clearInlineExtensionArgumentsForCommand: (command: CommandInfo) => void;
  getInlineExtensionArgumentsForCommand: (command: CommandInfo) => Record<string, string>;

  updateInlineQuickLinkDynamicValue: (
    quickLinkId: string,
    key: string,
    value: string
  ) => void;
  clearInlineQuickLinkDynamicValuesForId: (quickLinkId: string) => void;
};

export function useLauncherInlineArguments({
  selectedCommand,
  selectedCommandId,
  searchQuery,
  isLauncherModeActive,
  inputRef,
}: UseLauncherInlineArgumentsParams): UseLauncherInlineArgumentsResult {
  const [inlineExtensionArgumentValues, setInlineExtensionArgumentValues] = useState<
    Record<string, Record<string, string>>
  >({});
  const [inlineQuickLinkDynamicFieldsById, setInlineQuickLinkDynamicFieldsById] = useState<
    Record<string, QuickLinkDynamicField[]>
  >({});
  const [inlineQuickLinkDynamicValuesById, setInlineQuickLinkDynamicValuesById] = useState<
    Record<string, Record<string, string>>
  >({});

  const inlineArgumentLaneRef = useRef<HTMLDivElement>(null);
  const inlineArgumentClusterRef = useRef<HTMLDivElement>(null);
  const inlineArgumentInputRefs = useRef<Array<HTMLInputElement | HTMLSelectElement | null>>([]);
  const inlineQuickLinkInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocusInlineArgRef = useRef(false);

  const selectedExtensionArgumentDefinitions = useMemo(
    () =>
      selectedCommand?.category === 'extension'
        ? (selectedCommand.commandArgumentDefinitions || []).filter((definition) => definition?.name)
        : [],
    [selectedCommand]
  );
  const selectedInlineExtensionArgumentDefinitions = useMemo(
    () => selectedExtensionArgumentDefinitions.slice(0, MAX_INLINE_EXTENSION_ARGUMENTS),
    [selectedExtensionArgumentDefinitions]
  );
  const selectedInlineExtensionArgumentValues = useMemo(
    () => (selectedCommand ? inlineExtensionArgumentValues[selectedCommand.id] || {} : {}),
    [inlineExtensionArgumentValues, selectedCommand]
  );
  const hasSelectedExtensionOverflowArguments =
    selectedExtensionArgumentDefinitions.length > selectedInlineExtensionArgumentDefinitions.length;
  const selectedQuickLinkId = useMemo(
    () => (selectedCommand ? getQuickLinkIdFromCommandId(selectedCommand.id) : null),
    [selectedCommand]
  );
  const selectedQuickLinkDynamicFields = useMemo(
    () => (selectedQuickLinkId ? inlineQuickLinkDynamicFieldsById[selectedQuickLinkId] || [] : []),
    [inlineQuickLinkDynamicFieldsById, selectedQuickLinkId]
  );
  const selectedInlineQuickLinkDynamicFields = useMemo(
    () => selectedQuickLinkDynamicFields.slice(0, MAX_INLINE_QUICK_LINK_ARGUMENTS),
    [selectedQuickLinkDynamicFields]
  );
  const selectedInlineQuickLinkDynamicValues = useMemo(
    () => (selectedQuickLinkId ? inlineQuickLinkDynamicValuesById[selectedQuickLinkId] || {} : {}),
    [inlineQuickLinkDynamicValuesById, selectedQuickLinkId]
  );
  const hasSelectedQuickLinkOverflowDynamicFields =
    selectedQuickLinkDynamicFields.length > selectedInlineQuickLinkDynamicFields.length;
  const isShowingInlineArgumentInputs =
    selectedInlineExtensionArgumentDefinitions.length > 0 || selectedInlineQuickLinkDynamicFields.length > 0;
  const shouldHideAskAi = Boolean(selectedQuickLinkId) || isShowingInlineArgumentInputs;
  const selectedInlineArgumentLeadingIcon = useMemo(() => {
    if (!isShowingInlineArgumentInputs || !selectedCommand) return null;
    return renderCommandIcon(selectedCommand);
  }, [isShowingInlineArgumentInputs, selectedCommand]);
  const inlineArgumentStartPx = useInlineArgumentAnchor({
    enabled: isShowingInlineArgumentInputs,
    query: searchQuery,
    searchInputRef: inputRef,
    laneRef: inlineArgumentLaneRef,
    inlineRef: inlineArgumentClusterRef,
    minStartRatio: 0.3,
  });

  const requestPendingInlineArgumentFocus = useCallback(() => {
    pendingFocusInlineArgRef.current = true;
  }, []);

  const getDynamicFieldsForQuickLink = useCallback(
    async (
      quickLinkId: string,
      options?: { forceRefresh?: boolean }
    ): Promise<QuickLinkDynamicField[]> => {
      const normalizedId = String(quickLinkId || '').trim();
      if (!normalizedId) return [];
      const cached = inlineQuickLinkDynamicFieldsById[normalizedId];
      if (cached && !options?.forceRefresh) return cached;
      try {
        const fetched = await window.electron.quickLinkGetDynamicFields(normalizedId);
        const normalizedFields = normalizeQuickLinkDynamicFields(Array.isArray(fetched) ? fetched : []);
        setInlineQuickLinkDynamicFieldsById((prev) => ({
          ...prev,
          [normalizedId]: normalizedFields,
        }));
        return normalizedFields;
      } catch (error) {
        console.error('Failed to load quick link dynamic fields for launcher inline input:', error);
        return [];
      }
    },
    [inlineQuickLinkDynamicFieldsById]
  );

  useEffect(() => {
    inlineArgumentInputRefs.current = inlineArgumentInputRefs.current.slice(
      0,
      selectedInlineExtensionArgumentDefinitions.length
    );
  }, [selectedInlineExtensionArgumentDefinitions.length]);

  useEffect(() => {
    inlineQuickLinkInputRefs.current = inlineQuickLinkInputRefs.current.slice(
      0,
      selectedInlineQuickLinkDynamicFields.length
    );
  }, [selectedInlineQuickLinkDynamicFields.length]);

  useEffect(() => {
    if (!pendingFocusInlineArgRef.current) return;
    if (!isShowingInlineArgumentInputs) return;
    pendingFocusInlineArgRef.current = false;
    requestAnimationFrame(() => {
      inlineArgumentInputRefs.current[0]?.focus();
    });
  }, [isShowingInlineArgumentInputs]);

  useEffect(() => {
    if (!isLauncherModeActive) return;
    const extensionIdentity = getExtensionIdentityFromCommand(selectedCommand);
    if (!selectedCommand || !extensionIdentity || selectedExtensionArgumentDefinitions.length === 0) return;

    setInlineExtensionArgumentValues((prev) => {
      if (prev[selectedCommand.id]) return prev;
      const shouldRestoreStoredArgs = selectedCommand.mode === 'no-view';
      const storedValues = shouldRestoreStoredArgs
        ? readJsonObject(getCmdArgsKey(extensionIdentity.extName, extensionIdentity.cmdName))
        : {};
      if (!shouldRestoreStoredArgs) {
        clearCommandArguments(extensionIdentity.extName, extensionIdentity.cmdName);
      }
      const initialValues = selectedExtensionArgumentDefinitions.reduce((acc, definition) => {
        acc[definition.name] = String(storedValues[definition.name] ?? '');
        return acc;
      }, {} as Record<string, string>);
      return {
        ...prev,
        [selectedCommand.id]: initialValues,
      };
    });
  }, [isLauncherModeActive, selectedCommand, selectedExtensionArgumentDefinitions]);

  useEffect(() => {
    if (!isLauncherModeActive || !selectedQuickLinkId) return;
    void getDynamicFieldsForQuickLink(selectedQuickLinkId, { forceRefresh: true });
  }, [getDynamicFieldsForQuickLink, isLauncherModeActive, selectedQuickLinkId]);

  useEffect(() => {
    if (!selectedQuickLinkId || selectedQuickLinkDynamicFields.length === 0) return;
    setInlineQuickLinkDynamicValuesById((prev) => {
      const existing = prev[selectedQuickLinkId] || {};
      let changed = !prev[selectedQuickLinkId];
      const nextValues = { ...existing };
      for (const field of selectedQuickLinkDynamicFields) {
        const key = String(field.key || '').trim();
        if (!key || nextValues[key] !== undefined) continue;
        nextValues[key] = String(field.defaultValue || '');
        changed = true;
      }
      if (!changed) return prev;
      return {
        ...prev,
        [selectedQuickLinkId]: nextValues,
      };
    });
  }, [selectedQuickLinkDynamicFields, selectedQuickLinkId]);

  useEffect(() => {
    if (!isLauncherModeActive) return;
    const timer = window.setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    isLauncherModeActive,
    selectedCommandId,
    selectedInlineExtensionArgumentDefinitions.length,
    selectedInlineQuickLinkDynamicFields.length,
  ]);

  const updateInlineExtensionArgumentValue = useCallback(
    (command: CommandInfo, argumentName: string, value: string) => {
      const extensionIdentity = getExtensionIdentityFromCommand(command);
      setInlineExtensionArgumentValues((prev) => {
        const nextCommandValues = {
          ...(prev[command.id] || {}),
          [argumentName]: value,
        };
        if (extensionIdentity && command.mode === 'no-view') {
          writeJsonObject(getCmdArgsKey(extensionIdentity.extName, extensionIdentity.cmdName), nextCommandValues);
        }
        return {
          ...prev,
          [command.id]: nextCommandValues,
        };
      });
    },
    []
  );

  const clearInlineExtensionArgumentsForCommand = useCallback((command: CommandInfo) => {
    const extensionIdentity = getExtensionIdentityFromCommand(command);
    setInlineExtensionArgumentValues((prev) => {
      if (!prev[command.id]) return prev;
      const next = { ...prev };
      delete next[command.id];
      return next;
    });
    if (extensionIdentity && command.mode !== 'no-view') {
      clearCommandArguments(extensionIdentity.extName, extensionIdentity.cmdName);
    }
  }, []);

  const updateInlineQuickLinkDynamicValue = useCallback(
    (quickLinkId: string, key: string, value: string) => {
      const normalizedId = String(quickLinkId || '').trim();
      const normalizedKey = String(key || '').trim();
      if (!normalizedId || !normalizedKey) return;
      setInlineQuickLinkDynamicValuesById((prev) => ({
        ...prev,
        [normalizedId]: {
          ...(prev[normalizedId] || {}),
          [normalizedKey]: value,
        },
      }));
    },
    []
  );

  const clearInlineQuickLinkDynamicValuesForId = useCallback((quickLinkId: string) => {
    const normalizedId = String(quickLinkId || '').trim();
    if (!normalizedId) return;
    setInlineQuickLinkDynamicValuesById((prev) => {
      if (!prev[normalizedId]) return prev;
      const next = { ...prev };
      delete next[normalizedId];
      return next;
    });
  }, []);

  const getInlineExtensionArgumentsForCommand = useCallback(
    (command: CommandInfo): Record<string, string> => {
      const definitions = (command.commandArgumentDefinitions || []).filter((definition) => definition?.name);
      if (definitions.length === 0) return {};

      const current = { ...(inlineExtensionArgumentValues[command.id] || {}) };
      if (selectedCommand?.id === command.id) {
        for (let index = 0; index < definitions.length; index += 1) {
          const definition = definitions[index];
          if (index >= MAX_INLINE_EXTENSION_ARGUMENTS) break;
          const input = inlineArgumentInputRefs.current[index];
          if (!input) continue;
          current[definition.name] = String((input as HTMLInputElement | HTMLSelectElement).value ?? '');
        }
      }

      const next = definitions.reduce((acc, definition) => {
        acc[definition.name] = String(current[definition.name] ?? '');
        return acc;
      }, {} as Record<string, string>);

      setInlineExtensionArgumentValues((prev) => {
        const existing = prev[command.id] || {};
        let changed = false;
        for (const definition of definitions) {
          const key = definition.name;
          if (String(existing[key] ?? '') !== String(next[key] ?? '')) {
            changed = true;
            break;
          }
        }
        if (!changed) return prev;
        return {
          ...prev,
          [command.id]: next,
        };
      });

      return next;
    },
    [inlineExtensionArgumentValues, selectedCommand]
  );

  return {
    inlineArgumentLaneRef,
    inlineArgumentClusterRef,
    inlineArgumentInputRefs,
    inlineQuickLinkInputRefs,

    selectedExtensionArgumentDefinitions,
    selectedInlineExtensionArgumentDefinitions,
    selectedInlineExtensionArgumentValues,
    hasSelectedExtensionOverflowArguments,

    selectedQuickLinkId,
    selectedQuickLinkDynamicFields,
    selectedInlineQuickLinkDynamicFields,
    selectedInlineQuickLinkDynamicValues,
    hasSelectedQuickLinkOverflowDynamicFields,

    isShowingInlineArgumentInputs,
    shouldHideAskAi,
    selectedInlineArgumentLeadingIcon,
    inlineArgumentStartPx,

    inlineQuickLinkDynamicFieldsById,
    inlineQuickLinkDynamicValuesById,

    requestPendingInlineArgumentFocus,
    getDynamicFieldsForQuickLink,

    updateInlineExtensionArgumentValue,
    clearInlineExtensionArgumentsForCommand,
    getInlineExtensionArgumentsForCommand,

    updateInlineQuickLinkDynamicValue,
    clearInlineQuickLinkDynamicValuesForId,
  };
}
