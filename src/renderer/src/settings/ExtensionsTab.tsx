import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  FolderPlus,
  Puzzle,
  Search,
  TerminalSquare,
  ClipboardList,
  Settings,
  Brain,
  Wand2,
  FileSearch,
  FilePlus2,
  FileInput,
  FileOutput,
  LogOut,
  Sparkles,
} from 'lucide-react';
import supercmdLogo from '../../../../supercmd.svg';
import HotkeyRecorder from './HotkeyRecorder';
import type {
  AppSettings,
  CommandInfo,
  ExtensionCommandSettingsSchema,
  ExtensionPreferenceSchema,
  InstalledExtensionSettingsSchema,
} from '../../types/electron';

type SelectedTarget = { extName: string; cmdName?: string };
type SettingsFocusTarget = { extensionName?: string; commandName?: string };

const EXT_PREFS_KEY_PREFIX = 'sc-ext-prefs:';
const CMD_PREFS_KEY_PREFIX = 'sc-ext-cmd-prefs:';

function getExtPrefsKey(extName: string): string {
  return `${EXT_PREFS_KEY_PREFIX}${extName}`;
}

function getCmdPrefsKey(extName: string, cmdName: string): string {
  return `${CMD_PREFS_KEY_PREFIX}${extName}/${cmdName}`;
}

function readJsonObject(key: string): Record<string, any> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonObject(key: string, value: Record<string, any>) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getDefaultValue(pref: ExtensionPreferenceSchema): any {
  if (pref.default !== undefined) return pref.default;
  if (pref.type === 'checkbox') return false;
  if (pref.type === 'dropdown') return pref.data?.[0]?.value ?? '';
  return '';
}

function isPreferenceMissing(pref: ExtensionPreferenceSchema, value: any): boolean {
  if (!pref.required) return false;
  if (pref.type === 'checkbox') return value === undefined || value === null;
  if (typeof value === 'string') return value.trim() === '';
  return value === undefined || value === null;
}

const normalizeMatchKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s_]+/g, '-');

const SUPERCMD_EXTENSION_NAME = '__supercmd';
const SCRIPT_COMMANDS_EXTENSION_NAME = '__script_commands';
const INSTALLED_APPLICATIONS_NAME = '__installed_applications';
const SYSTEM_SETTINGS_NAME = '__system_settings';

const ExtensionsTab: React.FC<{
  focusTarget?: SettingsFocusTarget | null;
  onFocusTargetHandled?: () => void;
}> = ({
  focusTarget = null,
  onFocusTargetHandled,
}) => {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [schemas, setSchemas] = useState<InstalledExtensionSettingsSchema[]>([]);
  const [installedExtensionNames, setInstalledExtensionNames] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [activeScope, setActiveScope] = useState<'all' | 'commands'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<SelectedTarget | null>(null);
  const [expandedExtensions, setExpandedExtensions] = useState<Record<string, boolean>>({});
  const [hotkeyStatus, setHotkeyStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    text: string;
  }>({ type: 'idle', text: '' });
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});
  const [editingAliasCommandId, setEditingAliasCommandId] = useState<string | null>(null);
  const [folderStatus, setFolderStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    text: string;
  }>({ type: 'idle', text: '' });
  const [extensionActionStatus, setExtensionActionStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    text: string;
  }>({ type: 'idle', text: '' });
  const [extensionContextMenu, setExtensionContextMenu] = useState<{
    x: number;
    y: number;
    extName: string;
    title: string;
    iconDataUrl?: string;
  } | null>(null);
  const [uninstallDialog, setUninstallDialog] = useState<{
    extName: string;
    title: string;
    iconDataUrl?: string;
  } | null>(null);
  const [busyUninstallExtName, setBusyUninstallExtName] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [showTopActionsMenu, setShowTopActionsMenu] = useState(false);
  const [oauthTokens, setOauthTokens] = useState<Record<string, { accessToken: string; provider: string } | null>>({});
  const topActionsMenuRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [cmds, sett, extSchemas, installedNames] = await Promise.all([
        window.electron.getAllCommands(),
        window.electron.getSettings(),
        window.electron.getInstalledExtensionsSettingsSchema(),
        window.electron.getInstalledExtensionNames(),
      ]);
      setCommands(cmds);
      setSettings(sett);
      setSchemas(extSchemas);
      setInstalledExtensionNames(
        new Set(
          (installedNames || [])
            .map((value: string) => String(value || '').trim())
            .filter(Boolean)
        )
      );
      if (extSchemas.length > 0) {
        setSelected((prev) => prev || { extName: extSchemas[0].extName });
      }
      const expanded: Record<string, boolean> = {};
      for (const schema of extSchemas) expanded[schema.extName] = true;
      setExpandedExtensions(expanded);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const dispose = window.electron.onExtensionsChanged(() => {
      void loadData();
    });
    return () => {
      dispose?.();
    };
  }, [loadData]);

  const commandBySchemaKey = useMemo(() => {
    const map = new Map<string, CommandInfo>();
    for (const cmd of commands) {
      if (cmd.category === 'extension' && cmd.path) {
        const [extName, cmdName] = cmd.path.split('/');
        if (extName && cmdName) map.set(`${extName}/${cmdName}`, cmd);
        continue;
      }
      if (cmd.category === 'script') {
        map.set(`${SCRIPT_COMMANDS_EXTENSION_NAME}/${cmd.id}`, cmd);
        continue;
      }
      if (cmd.category === 'system') {
        map.set(`${SUPERCMD_EXTENSION_NAME}/${cmd.id}`, cmd);
        continue;
      }
      if (cmd.category === 'app') {
        map.set(`${INSTALLED_APPLICATIONS_NAME}/${cmd.id}`, cmd);
        continue;
      }
      if (cmd.category === 'settings') {
        map.set(`${SYSTEM_SETTINGS_NAME}/${cmd.id}`, cmd);
      }
    }
    return map;
  }, [commands]);

  const extensionIconFallbackByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const cmd of commands) {
      if (cmd.category !== 'extension' || !cmd.path || !cmd.iconDataUrl) continue;
      const [extName] = cmd.path.split('/');
      if (!extName || map.has(extName)) continue;
      map.set(extName, cmd.iconDataUrl);
    }
    return map;
  }, [commands]);

  const displaySchemas = useMemo(() => {
    const byExt = new Map<string, InstalledExtensionSettingsSchema>();

    for (const schema of schemas) {
      byExt.set(schema.extName, { ...schema, commands: [...schema.commands] });
    }

    for (const cmd of commands) {
      if (cmd.category === 'extension' && cmd.path) {
        const [extName, cmdName] = cmd.path.split('/');
        if (!extName || !cmdName) continue;

        let schema = byExt.get(extName);
        if (!schema) {
          const title = extName
            .split('-')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
          schema = {
            extName,
            title,
            description: '',
            owner: '',
            iconDataUrl: cmd.iconDataUrl,
            preferences: [],
            commands: [],
          };
          byExt.set(extName, schema);
        }

        if (!schema.commands.some((c) => c.name === cmdName)) {
          schema.commands.push({
            name: cmdName,
            title: cmd.title || cmdName,
            description: '',
            mode: cmd.mode || 'view',
            interval: cmd.interval,
            disabledByDefault: Boolean(cmd.disabledByDefault),
            preferences: [],
          });
        }
      }
    }

    const systemCommands = commands.filter((cmd) => cmd.category === 'system');
    if (systemCommands.length > 0) {
      byExt.set(SUPERCMD_EXTENSION_NAME, {
        extName: SUPERCMD_EXTENSION_NAME,
        title: 'SuperCmd',
        description: 'Built-in SuperCmd commands',
        owner: 'supercmd',
        iconDataUrl: undefined,
        preferences: [],
        commands: systemCommands.map((cmd) => ({
          name: cmd.id,
          title: cmd.title,
          description: '',
          mode: cmd.mode || 'no-view',
          interval: cmd.interval,
          disabledByDefault: Boolean(cmd.disabledByDefault),
          preferences: [],
        })),
      });
    }

    const scriptCommands = commands.filter((cmd) => cmd.category === 'script');
    if (scriptCommands.length > 0) {
      byExt.set(SCRIPT_COMMANDS_EXTENSION_NAME, {
        extName: SCRIPT_COMMANDS_EXTENSION_NAME,
        title: 'Script Commands',
        description: 'Custom and Raycast-compatible script commands',
        owner: 'supercmd',
        iconDataUrl: undefined,
        preferences: [],
        commands: scriptCommands.map((cmd) => ({
          name: cmd.id,
          title: cmd.title,
          description: cmd.subtitle || '',
          mode: cmd.mode || 'no-view',
          interval: cmd.interval,
          disabledByDefault: Boolean(cmd.disabledByDefault),
          preferences: [],
        })),
      });
    }

    const installedApplications = commands
      .filter((cmd) => cmd.category === 'app')
      .sort((a, b) => a.title.localeCompare(b.title));
    if (installedApplications.length > 0) {
      const finderIcon = installedApplications.find((cmd) => cmd.title.toLowerCase() === 'finder')?.iconDataUrl;
      const fallbackIcon = installedApplications.find((cmd) => Boolean(cmd.iconDataUrl))?.iconDataUrl;
      byExt.set(INSTALLED_APPLICATIONS_NAME, {
        extName: INSTALLED_APPLICATIONS_NAME,
        title: 'Applications',
        description: 'Installed macOS applications with launch and hotkey support.',
        owner: 'supercmd',
        iconDataUrl: finderIcon || fallbackIcon,
        preferences: [],
        commands: installedApplications.map((cmd) => ({
          name: cmd.id,
          title: cmd.title,
          description: cmd.subtitle || 'Application',
          mode: 'no-view',
          interval: cmd.interval,
          disabledByDefault: Boolean(cmd.disabledByDefault),
          preferences: [],
        })),
      });
    }

    const systemSettingsCommands = commands
      .filter((cmd) => cmd.category === 'settings')
      .sort((a, b) => a.title.localeCompare(b.title));
    if (systemSettingsCommands.length > 0) {
      byExt.set(SYSTEM_SETTINGS_NAME, {
        extName: SYSTEM_SETTINGS_NAME,
        title: 'System Settings',
        description: 'macOS settings panes with launch and hotkey support.',
        owner: 'supercmd',
        iconDataUrl: systemSettingsCommands.find((cmd) => Boolean(cmd.iconDataUrl))?.iconDataUrl,
        preferences: [],
        commands: systemSettingsCommands.map((cmd) => ({
          name: cmd.id,
          title: cmd.title,
          description: cmd.subtitle || 'System Settings pane',
          mode: 'no-view',
          interval: cmd.interval,
          disabledByDefault: Boolean(cmd.disabledByDefault),
          preferences: [],
        })),
      });
    }

    return Array.from(byExt.values()).sort((a, b) => {
      if (a.extName === SUPERCMD_EXTENSION_NAME) return -1;
      if (b.extName === SUPERCMD_EXTENSION_NAME) return 1;
      if (a.extName === INSTALLED_APPLICATIONS_NAME) return -1;
      if (b.extName === INSTALLED_APPLICATIONS_NAME) return 1;
      if (a.extName === SYSTEM_SETTINGS_NAME) return -1;
      if (b.extName === SYSTEM_SETTINGS_NAME) return 1;
      if (a.extName === SCRIPT_COMMANDS_EXTENSION_NAME) return -1;
      if (b.extName === SCRIPT_COMMANDS_EXTENSION_NAME) return 1;
      return a.title.localeCompare(b.title);
    });
  }, [schemas, commands]);

  const resolveCommandInfo = (extName: string, cmdName: string): CommandInfo | undefined =>
    commandBySchemaKey.get(`${extName}/${cmdName}`);

  const selectedSchema = useMemo(
    () => displaySchemas.find((schema) => schema.extName === selected?.extName) || null,
    [displaySchemas, selected]
  );

  const selectedCommandSchema = useMemo(() => {
    if (!selectedSchema || !selected?.cmdName) return null;
    return selectedSchema.commands.find((cmd) => cmd.name === selected.cmdName) || null;
  }, [selectedSchema, selected]);

  // Check for OAuth tokens for the selected extension
  useEffect(() => {
    if (!selectedSchema) return;
    const extName = selectedSchema.extName;
    if (oauthTokens[extName] !== undefined) return; // already checked
    (async () => {
      try {
        const token = await window.electron.oauthGetToken(extName);
        setOauthTokens((prev) => ({ ...prev, [extName]: token ? { accessToken: token.accessToken, provider: extName } : null }));
      } catch {
        setOauthTokens((prev) => ({ ...prev, [extName]: null }));
      }
    })();
  }, [selectedSchema, oauthTokens]);

  const handleOAuthLogout = useCallback(async (extName: string) => {
    try {
      // Remove from main process store AND notify the launcher window to
      // clear the in-memory token + reset the extension view.
      await window.electron.oauthLogout(extName);
      // Also clear localStorage in THIS window (settings window)
      try {
        localStorage.removeItem(`sc-oauth-token:${extName}`);
      } catch {}
      setOauthTokens((prev) => ({ ...prev, [extName]: null }));
    } catch {}
  }, []);

  const filteredSchemas = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return displaySchemas;
    return displaySchemas
      .map((schema) => {
        const matchesExtension =
          schema.title.toLowerCase().includes(q) ||
          schema.extName.toLowerCase().includes(q) ||
          schema.description.toLowerCase().includes(q);
        const commandsMatched = schema.commands.filter(
          (cmd) => {
            const commandInfo = resolveCommandInfo(schema.extName, cmd.name);
            const commandAlias = commandInfo ? String(settings?.commandAliases?.[commandInfo.id] || '').toLowerCase() : '';
            return (
              cmd.title.toLowerCase().includes(q) ||
              cmd.name.toLowerCase().includes(q) ||
              cmd.description.toLowerCase().includes(q) ||
              commandAlias.includes(q)
            );
          }
        );
        if (matchesExtension) return schema;
        if (commandsMatched.length > 0) return { ...schema, commands: commandsMatched };
        return null;
      })
      .filter(Boolean) as InstalledExtensionSettingsSchema[];
  }, [displaySchemas, search, settings]);

  useEffect(() => {
    if (displaySchemas.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((prev) => {
      if (!prev) return { extName: displaySchemas[0].extName };
      const exists = displaySchemas.some((schema) => schema.extName === prev.extName);
      if (!exists) return { extName: displaySchemas[0].extName };
      return prev;
    });
    setExpandedExtensions((prev) => {
      const next = { ...prev };
      for (const schema of displaySchemas) {
        if (next[schema.extName] === undefined) {
          next[schema.extName] =
            schema.extName === INSTALLED_APPLICATIONS_NAME || schema.extName === SYSTEM_SETTINGS_NAME
              ? false
              : true;
        }
      }
      return next;
    });
  }, [displaySchemas]);

  useEffect(() => {
    if (!focusTarget || displaySchemas.length === 0) return;

    const requestedExtension = String(focusTarget.extensionName || '').trim();
    const requestedCommand = String(focusTarget.commandName || '').trim();
    if (!requestedExtension) {
      onFocusTargetHandled?.();
      return;
    }

    const normalizedRequestedExtension = normalizeMatchKey(requestedExtension);
    const matchedSchema =
      displaySchemas.find((schema) => schema.extName === requestedExtension) ||
      displaySchemas.find((schema) => normalizeMatchKey(schema.extName) === normalizedRequestedExtension);

    if (!matchedSchema) {
      onFocusTargetHandled?.();
      return;
    }

    setSearch('');
    setActiveScope('all');
    setExpandedExtensions((prev) => ({ ...prev, [matchedSchema.extName]: true }));

    if (requestedCommand) {
      const normalizedRequestedCommand = normalizeMatchKey(requestedCommand);
      const matchedCommand = matchedSchema.commands.find((cmd) =>
        cmd.name === requestedCommand
        || normalizeMatchKey(cmd.name) === normalizedRequestedCommand
        || normalizeMatchKey(cmd.title || '') === normalizedRequestedCommand
      );
      if (matchedCommand) {
        setSelected({ extName: matchedSchema.extName, cmdName: matchedCommand.name });
        onFocusTargetHandled?.();
        return;
      }
    }

    setSelected({ extName: matchedSchema.extName });
    onFocusTargetHandled?.();
  }, [displaySchemas, focusTarget, onFocusTargetHandled]);

  const isCommandEnabled = (command: CommandInfo | undefined): boolean => {
    if (!command || !settings) return true;
    if (settings.disabledCommands.includes(command.id)) return false;
    if (command.disabledByDefault) {
      return settings.enabledCommands.includes(command.id);
    }
    return true;
  };

  const setCommandEnabled = async (command: CommandInfo | undefined, enabled: boolean) => {
    if (!command || !settings) return;
    await window.electron.toggleCommandEnabled(command.id, enabled);
    setSettings((prev) => {
      if (!prev) return prev;
      let disabled = [...prev.disabledCommands];
      let explicitlyEnabled = [...(prev.enabledCommands || [])];
      if (enabled) {
        disabled = disabled.filter((id) => id !== command.id);
        if (!explicitlyEnabled.includes(command.id)) explicitlyEnabled.push(command.id);
      } else {
        if (!disabled.includes(command.id)) disabled.push(command.id);
        explicitlyEnabled = explicitlyEnabled.filter((id) => id !== command.id);
      }
      return { ...prev, disabledCommands: disabled, enabledCommands: explicitlyEnabled };
    });
  };

  const setCommandHotkey = async (command: CommandInfo | undefined, hotkey: string) => {
    if (!command || !settings) return;
    const result = await window.electron.updateCommandHotkey(command.id, hotkey);
    if (!result.success) {
      const message = result.error === 'duplicate'
        ? result.conflictCommandId
          ? `Hotkey already used by "${result.conflictCommandId}".`
          : 'Hotkey already used by another SuperCmd command.'
        : 'Hotkey unavailable. It may be used by macOS or another app.';
      setHotkeyStatus({ type: 'error', text: message });
      setTimeout(() => setHotkeyStatus({ type: 'idle', text: '' }), 3200);
      return;
    }
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev.commandHotkeys };
      if (hotkey) next[command.id] = hotkey;
      else delete next[command.id];
      return { ...prev, commandHotkeys: next };
    });
    setHotkeyStatus({ type: 'success', text: hotkey ? 'Hotkey updated.' : 'Hotkey removed.' });
    setTimeout(() => setHotkeyStatus({ type: 'idle', text: '' }), 1800);
  };

  const getCommandAlias = useCallback(
    (commandId: string): string => String(settings?.commandAliases?.[commandId] || '').trim(),
    [settings]
  );

  const startAliasEditing = useCallback(
    (commandId: string) => {
      const existingAlias = getCommandAlias(commandId);
      setAliasDrafts((prev) => ({ ...prev, [commandId]: existingAlias }));
      setEditingAliasCommandId(commandId);
    },
    [getCommandAlias]
  );

  const cancelAliasEditing = useCallback((commandId: string) => {
    setEditingAliasCommandId((prev) => (prev === commandId ? null : prev));
    setAliasDrafts((prev) => {
      const next = { ...prev };
      delete next[commandId];
      return next;
    });
  }, []);

  const saveCommandAlias = useCallback(
    async (commandId: string, draftValue: string) => {
      if (!settings) return;
      const trimmed = String(draftValue || '').trim();
      const existing = getCommandAlias(commandId);

      if (trimmed === existing) {
        cancelAliasEditing(commandId);
        return;
      }

      const nextAliases = { ...(settings.commandAliases || {}) };
      if (trimmed) {
        nextAliases[commandId] = trimmed;
      } else {
        delete nextAliases[commandId];
      }

      await window.electron.saveSettings({ commandAliases: nextAliases });
      setSettings((prev) => (prev ? { ...prev, commandAliases: nextAliases } : prev));
      cancelAliasEditing(commandId);
    },
    [cancelAliasEditing, getCommandAlias, settings]
  );

  const getPreferenceValues = (extName: string, cmdName?: string): Record<string, any> => {
    if (!cmdName) return readJsonObject(getExtPrefsKey(extName));
    return readJsonObject(getCmdPrefsKey(extName, cmdName));
  };

  const setPreferenceValue = (extName: string, pref: ExtensionPreferenceSchema, value: any, cmdName?: string) => {
    const storageKey = cmdName ? getCmdPrefsKey(extName, cmdName) : getExtPrefsKey(extName);
    const current = readJsonObject(storageKey);
    current[pref.name] = value;
    writeJsonObject(storageKey, current);
    window.dispatchEvent(new CustomEvent('sc-extension-storage-changed', { detail: { extensionName: extName } }));
    // force rerender to reflect required/filled indicators
    setSelected((prev) => (prev ? { ...prev } : prev));
  };

  const pickPathForPreference = async (
    extName: string,
    pref: ExtensionPreferenceSchema,
    cmdName?: string
  ) => {
    const isDirectory = pref.type === 'directory' || pref.type === 'appPicker';
    const paths = await window.electron.pickFiles({
      allowMultipleSelection: false,
      canChooseDirectories: isDirectory,
      canChooseFiles: !isDirectory,
    });
    if (paths[0]) {
      setPreferenceValue(extName, pref, paths[0], cmdName);
    }
  };

  const selectedCommandInfo = selectedCommandSchema
    ? resolveCommandInfo(selectedSchema?.extName || '', selectedCommandSchema.name)
    : undefined;

  const getSchemaTypeLabel = (extName: string): string => {
    if (extName === SUPERCMD_EXTENSION_NAME) return 'Built-in';
    if (extName === INSTALLED_APPLICATIONS_NAME) return 'Apps';
    if (extName === SYSTEM_SETTINGS_NAME) return 'Settings';
    if (extName === SCRIPT_COMMANDS_EXTENSION_NAME) return 'Scripts';
    return 'Extension';
  };

  const getModeTypeLabel = (mode: string, command?: CommandInfo): string => {
    if (command?.category === 'app') return 'Application';
    if (command?.category === 'settings') return 'Settings';
    if (mode === 'menu-bar') return 'Menu Bar C...';
    if (mode === 'no-view') return 'Command';
    return 'Command';
  };

  const toggleExtensionExpanded = (extName: string) => {
    setExpandedExtensions((prev) => ({ ...prev, [extName]: !prev[extName] }));
  };

  const getCoreCommandIcon = (commandId?: string) => {
    if (!commandId) return <TerminalSquare className="w-3.5 h-3.5 text-white/45 flex-shrink-0" />;
    if (commandId.includes('clipboard')) return <ClipboardList className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    if (commandId.includes('open-settings')) return <Settings className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    if (commandId.includes('open-ai-settings')) return <Brain className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    if (commandId.includes('open-extensions-settings')) return <Wand2 className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    if (commandId.includes('search-files')) return <FileSearch className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    if (commandId.includes('create-snippet')) return <FilePlus2 className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    if (commandId.includes('import-snippets')) return <FileInput className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    if (commandId.includes('export-snippets')) return <FileOutput className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    if (commandId.includes('quit')) return <LogOut className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    if (commandId.includes('onboarding')) return <Sparkles className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    return <TerminalSquare className="w-3.5 h-3.5 text-white/45 flex-shrink-0" />;
  };

  const getSystemExtensionCommandIcon = (command?: CommandInfo) => {
    if (command?.category === 'settings') {
      return <Settings className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />;
    }
    return <TerminalSquare className="w-3.5 h-3.5 text-white/45 flex-shrink-0" />;
  };

  const setExtensionEnabled = async (schema: InstalledExtensionSettingsSchema, enabled: boolean) => {
    for (const cmd of schema.commands) {
      const commandInfo = resolveCommandInfo(schema.extName, cmd.name);
      if (!commandInfo) continue;
      await setCommandEnabled(commandInfo, enabled);
    }
  };

  const canUninstallExtension = useCallback(
    (extName: string): boolean => installedExtensionNames.has(extName),
    [installedExtensionNames]
  );

  const handleUninstallExtension = useCallback(
    async (extName: string, extensionTitle: string) => {
      if (!canUninstallExtension(extName)) {
        setExtensionContextMenu(null);
        setUninstallDialog(null);
        return;
      }

      setExtensionContextMenu(null);
      setUninstallDialog(null);
      setBusyUninstallExtName(extName);
      try {
        const success = await window.electron.uninstallExtension(extName);
        if (success) {
          setExtensionActionStatus({ type: 'success', text: `Uninstalled "${extensionTitle}".` });
          setTimeout(() => setExtensionActionStatus({ type: 'idle', text: '' }), 2200);
          await loadData();
        } else {
          setExtensionActionStatus({ type: 'error', text: `Failed to uninstall "${extensionTitle}".` });
          setTimeout(() => setExtensionActionStatus({ type: 'idle', text: '' }), 3200);
        }
      } catch (error) {
        console.error('Failed to uninstall extension:', error);
        setExtensionActionStatus({ type: 'error', text: `Failed to uninstall "${extensionTitle}".` });
        setTimeout(() => setExtensionActionStatus({ type: 'idle', text: '' }), 3200);
      } finally {
        setBusyUninstallExtName(null);
      }
    },
    [canUninstallExtension, loadData]
  );

  const updateCustomExtensionFolders = useCallback(
    async (nextFolders: string[]) => {
      const unique = Array.from(
        new Set(nextFolders.map((value) => String(value || '').trim()).filter(Boolean))
      );
      await window.electron.saveSettings({ customExtensionFolders: unique });
      setSettings((prev) => (prev ? { ...prev, customExtensionFolders: unique } : prev));
      await loadData();
    },
    [loadData]
  );

  const handleAddCustomExtensionFolder = useCallback(async () => {
    const picked = await window.electron.pickFiles({
      allowMultipleSelection: false,
      canChooseDirectories: true,
      canChooseFiles: false,
    });
    const pickedPath = String(picked?.[0] || '').trim();
    if (!pickedPath) return;
    const existing = Array.isArray(settings?.customExtensionFolders)
      ? settings?.customExtensionFolders
      : [];
    if (existing.includes(pickedPath)) {
      setFolderStatus({ type: 'error', text: 'Folder already added.' });
      setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 2200);
      return;
    }
    setFolderBusy(true);
    try {
      await updateCustomExtensionFolders([...existing, pickedPath]);
      setFolderStatus({ type: 'success', text: 'Extension folder added.' });
      setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 1800);
    } catch (error) {
      console.error('Failed to add custom extension folder:', error);
      setFolderStatus({ type: 'error', text: 'Failed to add extension folder.' });
      setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 2800);
    } finally {
      setFolderBusy(false);
    }
  }, [settings, updateCustomExtensionFolders]);

  const handleRemoveCustomExtensionFolder = useCallback(
    async (folderPath: string) => {
      const existing = Array.isArray(settings?.customExtensionFolders)
        ? settings.customExtensionFolders
        : [];
      const next = existing.filter((value) => value !== folderPath);
      setFolderBusy(true);
      try {
        await updateCustomExtensionFolders(next);
        setFolderStatus({ type: 'success', text: 'Extension folder removed.' });
        setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 1800);
      } catch (error) {
        console.error('Failed to remove custom extension folder:', error);
        setFolderStatus({ type: 'error', text: 'Failed to remove extension folder.' });
        setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 2800);
      } finally {
        setFolderBusy(false);
      }
    },
    [settings, updateCustomExtensionFolders]
  );

  useEffect(() => {
    if (!showTopActionsMenu) return;
    setExtensionContextMenu(null);
    setUninstallDialog(null);
    const onMouseDown = (event: MouseEvent) => {
      if (topActionsMenuRef.current?.contains(event.target as Node)) return;
      setShowTopActionsMenu(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [showTopActionsMenu]);

  useEffect(() => {
    if (!extensionContextMenu && !uninstallDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busyUninstallExtName) {
          setExtensionContextMenu(null);
          setUninstallDialog(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [extensionContextMenu, uninstallDialog, busyUninstallExtName]);

  if (isLoading) {
    return <div className="text-white/50 text-sm">Loading extension settings…</div>;
  }

  const customExtensionFolders = Array.isArray(settings?.customExtensionFolders)
    ? settings.customExtensionFolders
    : [];
  const getFolderName = (folderPath: string): string => {
    const normalized = String(folderPath || '').replace(/[\\/]+$/, '');
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || folderPath;
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex flex-1 min-h-0 bg-[rgba(20,20,20,0.30)]">
        <div className="flex-[0_0_66%] min-w-[600px] h-full border-r border-white/[0.08] flex flex-col">
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <div className="relative w-[360px] max-w-full shrink-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-9 pr-4 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/20 transition-colors"
                />
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveScope('all')}
                  className={`px-2.5 py-1 rounded-md text-xs ${
                    activeScope === 'all' ? 'bg-white/[0.14] text-white' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setActiveScope('commands')}
                  className={`px-2.5 py-1 rounded-md text-xs ${
                    activeScope === 'commands' ? 'bg-white/[0.14] text-white' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  Commands
                </button>
              </div>
              <div className="relative" ref={topActionsMenuRef}>
                <button
                  onClick={() => setShowTopActionsMenu((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Install Extension</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {showTopActionsMenu ? (
                  <div
                    className="absolute right-0 mt-1 w-48 rounded-lg border border-white/[0.10] shadow-2xl overflow-hidden z-20"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03)), rgba(30,31,36,0.66)',
                      backdropFilter: 'blur(48px) saturate(170%)',
                      WebkitBackdropFilter: 'blur(48px) saturate(170%)',
                    }}
                  >
                    <button
                      onClick={() => {
                        setShowTopActionsMenu(false);
                        window.electron.openExtensionStoreWindow();
                      }}
                      className="w-full px-2.5 py-2 text-left text-xs text-white/85 hover:bg-white/[0.08] transition-colors"
                    >
                      Install from Store
                    </button>
                    <button
                      onClick={() => {
                        setShowTopActionsMenu(false);
                        void handleAddCustomExtensionFolder();
                      }}
                      disabled={folderBusy}
                      className="w-full px-2.5 py-2 text-left text-xs text-white/85 hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Add Folder
                    </button>
                    <button
                      onClick={async () => {
                        setShowTopActionsMenu(false);
                        setFolderBusy(true);
                        try {
                          const result = await window.electron.openCustomScriptsFolder();
                          if (result?.success) {
                            setFolderStatus({
                              type: 'success',
                              text: result.createdSample
                                ? 'Opened custom scripts folder with sample script.'
                                : 'Opened custom scripts folder.',
                            });
                            setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 2200);
                          } else {
                            setFolderStatus({ type: 'error', text: 'Failed to open custom scripts folder.' });
                            setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 2800);
                          }
                        } catch {
                          setFolderStatus({ type: 'error', text: 'Failed to open custom scripts folder.' });
                          setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 2800);
                        } finally {
                          setFolderBusy(false);
                        }
                      }}
                      disabled={folderBusy}
                      className="w-full px-2.5 py-2 text-left text-xs text-white/85 hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Custom Script
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {hotkeyStatus.type !== 'idle' ? (
              <p
                className={`mt-2 text-xs ${
                  hotkeyStatus.type === 'error' ? 'text-red-300/90' : 'text-emerald-300/90'
                }`}
              >
                {hotkeyStatus.text}
              </p>
            ) : null}
            {extensionActionStatus.type !== 'idle' ? (
              <p
                className={`mt-1 text-xs ${
                  extensionActionStatus.type === 'error' ? 'text-red-300/90' : 'text-emerald-300/90'
                }`}
              >
                {extensionActionStatus.text}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-[1fr_120px_100px_130px_82px] px-4 py-2 text-[11px] uppercase tracking-wider text-white/35 border-b border-white/[0.06]">
            <div className="pr-2 border-r border-white/[0.06]">Name</div>
            <div className="px-2 border-r border-white/[0.06]">Type</div>
            <div className="px-2 border-r border-white/[0.06]">Alias</div>
            <div className="px-2 border-r border-white/[0.06]">Hotkey</div>
            <div className="pl-2">Enabled</div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-scroll custom-scrollbar" style={{ scrollbarGutter: 'stable' }}>
            {filteredSchemas.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-white/30">No matching extensions</div>
            ) : (
              filteredSchemas.map((schema) => {
                const uninstallable = canUninstallExtension(schema.extName);
                return (
                <div key={schema.extName} className="border-b border-white/[0.04] last:border-b-0">
                  <button
                    onClick={() => {
                      setSelected({ extName: schema.extName });
                      toggleExtensionExpanded(schema.extName);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!uninstallable) {
                        setExtensionContextMenu(null);
                        return;
                      }
                      setSelected({ extName: schema.extName });
                      setExtensionContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        extName: schema.extName,
                        title: schema.title,
                        iconDataUrl: schema.iconDataUrl || extensionIconFallbackByName.get(schema.extName),
                      });
                    }}
                    className={`w-full grid grid-cols-[1fr_120px_100px_130px_82px] items-center gap-2 px-4 py-1.5 text-left transition-colors ${
                      selected?.extName === schema.extName && !selected?.cmdName
                        ? 'bg-white/[0.10]'
                        : 'hover:bg-white/[0.05]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {expandedExtensions[schema.extName] ? (
                        <ChevronDown className="w-3.5 h-3.5 text-white/45 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-white/45 flex-shrink-0" />
                      )}
                      {(schema.iconDataUrl || extensionIconFallbackByName.get(schema.extName)) ? (
                        <img src={schema.iconDataUrl || extensionIconFallbackByName.get(schema.extName)} alt="" className="w-4 h-4 rounded-sm object-contain" draggable={false} />
                      ) : schema.extName === SUPERCMD_EXTENSION_NAME ? (
                        <img src={supercmdLogo} alt="" className="w-4 h-4 object-contain" draggable={false} />
                      ) : schema.extName === SYSTEM_SETTINGS_NAME ? (
                        <Settings className="w-4 h-4 text-white/65 flex-shrink-0" />
                      ) : schema.extName === INSTALLED_APPLICATIONS_NAME ? (
                        <TerminalSquare className="w-4 h-4 text-white/60 flex-shrink-0" />
                      ) : schema.extName === SCRIPT_COMMANDS_EXTENSION_NAME ? (
                        <TerminalSquare className="w-4 h-4 text-white/60 flex-shrink-0" />
                      ) : (
                        <Puzzle className="w-4 h-4 text-violet-300/80" />
                      )}
                      <span className="text-sm text-white/90 truncate">{schema.title}</span>
                    </span>
                    <span className="text-sm text-white/55">{getSchemaTypeLabel(schema.extName)}</span>
                    <span className="text-sm text-white/45">--</span>
                    <span className="text-sm text-white/45">--</span>
                    <span className="flex items-center justify-start">
                      <input
                        type="checkbox"
                        checked={schema.commands.every((cmd) => isCommandEnabled(resolveCommandInfo(schema.extName, cmd.name)))}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setExtensionEnabled(schema, e.target.checked)}
                        className="w-4 h-4"
                      />
                    </span>
                  </button>

                  {expandedExtensions[schema.extName] && schema.commands.map((cmd) => {
                    const commandInfo = resolveCommandInfo(schema.extName, cmd.name);
                    const enabled = isCommandEnabled(commandInfo);
                    const currentAlias = commandInfo ? getCommandAlias(commandInfo.id) : '';
                    const isAliasEditing = commandInfo ? editingAliasCommandId === commandInfo.id : false;
                    const aliasDraftValue = commandInfo ? (aliasDrafts[commandInfo.id] ?? currentAlias) : '';
                    return (
                      <div
                        key={`${schema.extName}/${cmd.name}`}
                        className={`ml-7 mr-2 mb-0.5 rounded-md px-2 py-1 ${
                          selected?.extName === schema.extName && selected?.cmdName === cmd.name
                            ? 'bg-white/[0.10]'
                            : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="grid grid-cols-[1fr_120px_100px_130px_82px] items-center gap-2">
                          <button
                            onClick={() => setSelected({ extName: schema.extName, cmdName: cmd.name })}
                            className="flex items-center gap-2 text-left min-w-0"
                          >
                            {commandInfo?.iconDataUrl ? (
                              <img src={commandInfo.iconDataUrl} alt="" className="w-3.5 h-3.5 rounded-sm object-contain flex-shrink-0" draggable={false} />
                            ) : schema.extName === SUPERCMD_EXTENSION_NAME ? (
                              getCoreCommandIcon(commandInfo?.id)
                            ) : schema.extName === INSTALLED_APPLICATIONS_NAME || schema.extName === SYSTEM_SETTINGS_NAME ? (
                              getSystemExtensionCommandIcon(commandInfo)
                            ) : (
                              <TerminalSquare className="w-3.5 h-3.5 text-white/45 flex-shrink-0" />
                            )}
                            <span className="text-xs text-white/85 truncate">{cmd.title}</span>
                          </button>
                          <span className="text-xs text-white/55">{getModeTypeLabel(cmd.mode, commandInfo)}</span>
                          {commandInfo ? (
                            <div className="min-w-0">
                              {isAliasEditing ? (
                                <input
                                  autoFocus
                                  value={aliasDraftValue}
                                  onChange={(e) => setAliasDrafts((prev) => ({ ...prev, [commandInfo.id]: e.target.value }))}
                                  onBlur={(e) => {
                                    if (e.currentTarget.dataset.cancelled === '1') {
                                      e.currentTarget.dataset.cancelled = '0';
                                      cancelAliasEditing(commandInfo.id);
                                      return;
                                    }
                                    void saveCommandAlias(commandInfo.id, e.target.value);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      (e.currentTarget as HTMLInputElement).blur();
                                      return;
                                    }
                                    if (e.key === 'Escape') {
                                      e.preventDefault();
                                      e.currentTarget.dataset.cancelled = '1';
                                      (e.currentTarget as HTMLInputElement).blur();
                                    }
                                  }}
                                  placeholder="Add Alias"
                                  className="h-6 w-full min-w-0 rounded-md border border-white/[0.18] bg-white/[0.02] px-2 font-mono text-[11px] text-white/80 placeholder-white/38 outline-none focus:border-white/[0.36]"
                                />
                              ) : currentAlias ? (
                                <button
                                  type="button"
                                  onClick={() => startAliasEditing(commandInfo.id)}
                                  className="inline-flex h-6 max-w-full items-center rounded-md border border-white/[0.18] bg-white/[0.02] px-2 font-mono text-[11px] text-white/72 hover:border-white/[0.28] hover:text-white/78 transition-colors"
                                  title="Edit alias"
                                >
                                  <span className="truncate">{currentAlias}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startAliasEditing(commandInfo.id)}
                                  className="text-xs text-white/45 hover:text-white/75 transition-colors"
                                >
                                  Add Alias
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-white/25">--</span>
                          )}
                          {commandInfo ? (
                            <>
                              <div className="flex items-center">
                                <HotkeyRecorder
                                  value={(settings?.commandHotkeys || {})[commandInfo.id] || ''}
                                  onChange={(hotkey) => setCommandHotkey(commandInfo, hotkey)}
                                  compact
                                />
                              </div>
                              <span className="flex items-center justify-start">
                                <input
                                  type="checkbox"
                                  checked={enabled}
                                  onChange={(e) => setCommandEnabled(commandInfo, e.target.checked)}
                                  className="w-4 h-4"
                                />
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-white/25">Record Hotkey</span>
                              <span className="text-xs text-white/25">-</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )})
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 h-full min-h-0 overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/45">
              <Folder className="w-3.5 h-3.5 text-white/55" />
              <span>Custom Folders</span>
              <span className="text-white/35">({customExtensionFolders.length})</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
              {customExtensionFolders.length === 0 ? (
                <span className="text-[11px] text-white/38">
                  Add Folder from Install Extension
                </span>
              ) : (
                customExtensionFolders.map((folderPath) => (
                  <div
                    key={folderPath}
                    className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1"
                    title={folderPath}
                  >
                    <span className="truncate text-[11px] text-white/75">{getFolderName(folderPath)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomExtensionFolder(folderPath)}
                      disabled={folderBusy}
                      className="text-[11px] text-red-300/90 hover:text-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            {folderStatus.type !== 'idle' ? (
              <p
                className={`mt-1 text-right text-[11px] ${
                  folderStatus.type === 'error' ? 'text-red-300/90' : 'text-emerald-300/90'
                }`}
              >
                {folderStatus.text}
              </p>
            ) : null}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
          {!selectedSchema ? (
            <div className="h-full flex items-center justify-center text-sm text-white/35">Select an extension</div>
          ) : (
            <div className="h-full min-h-0 flex flex-col">
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  {selectedSchema.iconDataUrl ? (
                    <img src={selectedSchema.iconDataUrl} alt="" className="w-5 h-5 rounded object-contain" draggable={false} />
                  ) : selectedSchema.extName === SUPERCMD_EXTENSION_NAME ? (
                    <img src={supercmdLogo} alt="" className="w-5 h-5 object-contain" draggable={false} />
                  ) : selectedSchema.extName === SYSTEM_SETTINGS_NAME ? (
                    <Settings className="w-5 h-5 text-white/65" />
                  ) : selectedSchema.extName === INSTALLED_APPLICATIONS_NAME ? (
                    <TerminalSquare className="w-5 h-5 text-white/60" />
                  ) : selectedSchema.extName === SCRIPT_COMMANDS_EXTENSION_NAME ? (
                    <TerminalSquare className="w-5 h-5 text-white/60" />
                  ) : (
                    <Puzzle className="w-5 h-5 text-violet-300/80" />
                  )}
                  <div className="text-sm font-semibold text-white/90">
                    {selectedCommandSchema ? selectedCommandSchema.title : selectedSchema.title}
                  </div>
                </div>
                <div className="mt-1 text-xs text-white/45">
                  {selectedCommandSchema ? selectedCommandSchema.description : selectedSchema.description}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-scroll custom-scrollbar p-4 space-y-5" style={{ scrollbarGutter: 'stable' }}>
                {selectedCommandSchema && selectedCommandInfo ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="inline-flex items-center gap-2 text-xs text-white/70">
                      <input
                        type="checkbox"
                        checked={isCommandEnabled(selectedCommandInfo)}
                        onChange={(e) => setCommandEnabled(selectedCommandInfo, e.target.checked)}
                      />
                      Enabled
                    </label>
                    <div className="justify-self-end">
                      <HotkeyRecorder
                        value={(settings?.commandHotkeys || {})[selectedCommandInfo.id] || ''}
                        onChange={(hotkey) => setCommandHotkey(selectedCommandInfo, hotkey)}
                        compact
                      />
                    </div>
                  </div>
                ) : null}

                {oauthTokens[selectedSchema.extName]?.accessToken ? (
                  <div className="space-y-2">
                    <div className="text-xs text-white/50 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 inline-block" />
                      Logged into {selectedSchema.title}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOAuthLogout(selectedSchema.extName)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/[0.08] hover:bg-white/[0.14] text-white/80 transition-colors"
                    >
                      <LogOut className="w-3 h-3" />
                      Logout
                    </button>
                  </div>
                ) : null}

                <PreferenceSection
                  title="Extension Preferences"
                  extName={selectedSchema.extName}
                  preferences={selectedSchema.preferences}
                  values={getPreferenceValues(selectedSchema.extName)}
                  setPreferenceValue={setPreferenceValue}
                  pickPathForPreference={pickPathForPreference}
                />

                {selectedCommandSchema ? (
                  <PreferenceSection
                    title="Command Preferences"
                    extName={selectedSchema.extName}
                    cmdName={selectedCommandSchema.name}
                    preferences={selectedCommandSchema.preferences}
                    values={getPreferenceValues(selectedSchema.extName, selectedCommandSchema.name)}
                    setPreferenceValue={setPreferenceValue}
                    pickPathForPreference={pickPathForPreference}
                  />
                ) : null}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
      {uninstallDialog ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/12"
          onClick={() => {
            if (!busyUninstallExtName) setUninstallDialog(null);
          }}
        >
          <div
            className="glass-effect w-[296px] max-w-[82vw] rounded-xl border border-white/[0.10] p-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-white/[0.04] border border-white/[0.08]">
              {uninstallDialog.iconDataUrl ? (
                <img
                  src={uninstallDialog.iconDataUrl}
                  alt=""
                  className="h-5 w-5 rounded object-contain"
                  draggable={false}
                />
              ) : (
                <Puzzle className="h-4.5 w-4.5 text-white/65" />
              )}
            </div>

            <div className="text-center text-[18px] font-semibold leading-tight text-white/92">
              Uninstall "{uninstallDialog.title}"?
            </div>
            <p className="mt-1 text-center text-[11px] leading-snug text-white/45">
              This extension and its commands will be removed from SuperCmd.
            </p>

            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                disabled={Boolean(busyUninstallExtName)}
                onClick={() => setUninstallDialog(null)}
                className="flex-1 rounded-md border border-white/[0.12] bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-medium text-white/80 hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(busyUninstallExtName)}
                onClick={() => void handleUninstallExtension(uninstallDialog.extName, uninstallDialog.title)}
                className="flex-1 rounded-md border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-red-200/90 hover:bg-red-500/18 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busyUninstallExtName ? 'Uninstalling…' : 'Uninstall'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {extensionContextMenu ? (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setExtensionContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setExtensionContextMenu(null);
          }}
        >
          <div
            className="absolute min-w-[150px] rounded-xl border border-white/[0.12] shadow-2xl p-1"
            style={{
              left: Math.min(extensionContextMenu.x, window.innerWidth - 180),
              top: Math.min(extensionContextMenu.y, window.innerHeight - 120),
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03)), rgba(30,31,36,0.66)',
              backdropFilter: 'blur(48px) saturate(170%)',
              WebkitBackdropFilter: 'blur(48px) saturate(170%)',
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              disabled={busyUninstallExtName === extensionContextMenu.extName}
              onClick={() => {
                setUninstallDialog({
                  extName: extensionContextMenu.extName,
                  title: extensionContextMenu.title,
                  iconDataUrl: extensionContextMenu.iconDataUrl,
                });
                setExtensionContextMenu(null);
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-300/90 hover:text-red-200 hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busyUninstallExtName === extensionContextMenu.extName ? 'Uninstalling…' : 'Uninstall'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const PreferenceSection: React.FC<{
  title: string;
  extName: string;
  cmdName?: string;
  preferences: ExtensionPreferenceSchema[];
  values: Record<string, any>;
  setPreferenceValue: (extName: string, pref: ExtensionPreferenceSchema, value: any, cmdName?: string) => void;
  pickPathForPreference: (extName: string, pref: ExtensionPreferenceSchema, cmdName?: string) => Promise<void>;
}> = ({ title, extName, cmdName, preferences, values, setPreferenceValue, pickPathForPreference }) => {
  if (!preferences || preferences.length === 0) {
    return (
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-white/35">{title}</div>
        <div className="text-xs text-white/40">No preferences</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-white/35">{title}</div>
      {preferences.map((pref) => {
        const value = values[pref.name] ?? getDefaultValue(pref);
        const missing = isPreferenceMissing(pref, value);
        const type = pref.type || 'textfield';
        const titleText = pref.title || pref.label || pref.name;
        const textValue = typeof value === 'string' ? value : String(value ?? '');

        return (
          <div key={`${cmdName || 'extension'}:${pref.name}`} className="space-y-1">
            {type === 'checkbox' ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-white/75 font-medium">
                  {titleText}
                  {pref.required ? <span className="text-red-400"> *</span> : null}
                  {missing ? <span className="text-red-300/80 ml-2">(Required)</span> : null}
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-white/75 min-w-[140px] justify-end">
                  <span>{pref.label || 'Enabled'}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => setPreferenceValue(extName, pref, e.target.checked, cmdName)}
                    className="w-4 h-4"
                  />
                </label>
              </div>
            ) : (
              <>
                <label className="text-xs text-white/75 font-medium">
                  {titleText}
                  {pref.required ? <span className="text-red-400"> *</span> : null}
                  {missing ? <span className="text-red-300/80 ml-2">(Required)</span> : null}
                </label>
                {type === 'dropdown' ? (
                  <select
                    value={textValue}
                    onChange={(e) => setPreferenceValue(extName, pref, e.target.value, cmdName)}
                    className="w-full bg-white/[0.05] border border-white/[0.10] rounded-md px-2.5 py-1.5 text-xs text-white/90 outline-none"
                  >
                    <option value="">Select an option</option>
                    {(pref.data || []).map((opt) => (
                      <option key={opt?.value || opt?.title} value={opt?.value || ''}>
                        {opt?.title || opt?.value || ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type={type === 'password' ? 'password' : 'text'}
                      value={textValue}
                      placeholder={pref.placeholder || ''}
                      onChange={(e) => setPreferenceValue(extName, pref, e.target.value, cmdName)}
                      className="flex-1 bg-white/[0.05] border border-white/[0.10] rounded-md px-2.5 py-1.5 text-xs text-white/90 placeholder-white/30 outline-none"
                    />
                    {(type === 'file' || type === 'directory' || type === 'appPicker') && (
                      <button
                        type="button"
                        onClick={() => pickPathForPreference(extName, pref, cmdName)}
                        className="px-2 py-1.5 text-[11px] rounded-md border border-white/[0.12] text-white/70 hover:bg-white/[0.06]"
                      >
                        Browse
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {pref.description ? <p className="text-[11px] text-white/40">{pref.description}</p> : null}
          </div>
        );
      })}
    </div>
  );
};

export default ExtensionsTab;
