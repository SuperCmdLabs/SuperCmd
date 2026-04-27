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
  LayoutGrid,
  Link2,
  ListFilter,
  Check,
  Plus,
  X,
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
import { useI18n } from '../i18n';

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

function parseExtensionCommandPath(pathValue: string): { extName: string; cmdName: string } | null {
  const rawPath = String(pathValue || '').trim();
  const separatorIndex = rawPath.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= rawPath.length - 1) return null;

  const extName = rawPath.slice(0, separatorIndex).trim();
  const cmdName = rawPath.slice(separatorIndex + 1).trim();
  if (!extName || !cmdName) return null;

  return { extName, cmdName };
}

const ExtensionsTab: React.FC<{
  focusTarget?: SettingsFocusTarget | null;
  onFocusTargetHandled?: () => void;
}> = ({
  focusTarget = null,
  onFocusTargetHandled,
}) => {
  const { t } = useI18n();
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [schemas, setSchemas] = useState<InstalledExtensionSettingsSchema[]>([]);
  const [installedExtensionNames, setInstalledExtensionNames] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [activeScope, setActiveScope] = useState<'all' | 'commands'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [statusFilterMenuOpen, setStatusFilterMenuOpen] = useState(false);
  const statusFilterMenuRef = useRef<HTMLDivElement>(null);
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
  const [compactToolbar, setCompactToolbar] = useState(false);
  const topActionsMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toolbarRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCmdF = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f';
      if (!isCmdF) return;
      const target = event.target as HTMLElement | null;
      if (target === searchInputRef.current) return;
      // Don't steal focus while a HotkeyRecorder is capturing input
      if (target?.closest('[data-hotkey-recorder]')) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  useEffect(() => {
    const check = () => setCompactToolbar(window.innerWidth < 1000);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

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
        const parsedPath = parseExtensionCommandPath(cmd.path);
        if (parsedPath) map.set(`${parsedPath.extName}/${parsedPath.cmdName}`, cmd);
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
      const parsedPath = parseExtensionCommandPath(cmd.path);
      const extName = parsedPath?.extName || '';
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
        const parsedPath = parseExtensionCommandPath(cmd.path);
        if (!parsedPath) continue;
        const { extName, cmdName } = parsedPath;

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
        title: t('settings.extensions.builtIn.superCmd.title'),
        description: t('settings.extensions.builtIn.superCmd.description'),
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
        title: t('settings.extensions.builtIn.scriptCommands.title'),
        description: t('settings.extensions.builtIn.scriptCommands.description'),
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
        title: t('settings.extensions.builtIn.applications.title'),
        description: t('settings.extensions.builtIn.applications.description'),
        owner: 'supercmd',
        iconDataUrl: finderIcon || fallbackIcon,
        preferences: [],
        commands: installedApplications.map((cmd) => ({
          name: cmd.id,
          title: cmd.title,
          description: cmd.subtitle || t('settings.extensions.types.application'),
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
        title: t('settings.extensions.builtIn.systemSettings.title'),
        description: t('settings.extensions.builtIn.systemSettings.description'),
        owner: 'supercmd',
        iconDataUrl: systemSettingsCommands.find((cmd) => Boolean(cmd.iconDataUrl))?.iconDataUrl,
        preferences: [],
        commands: systemSettingsCommands.map((cmd) => ({
          name: cmd.id,
          title: cmd.title,
          description: cmd.subtitle || t('settings.extensions.builtIn.systemSettings.pane'),
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
    const hasSearch = q.length > 0;
    const hasStatus = statusFilter !== 'all';
    if (!hasSearch && !hasStatus) return displaySchemas;

    const commandEnabled = (command: CommandInfo | undefined): boolean => {
      if (!command || !settings) return true;
      if (settings.disabledCommands.includes(command.id)) return false;
      if (command.disabledByDefault) return settings.enabledCommands.includes(command.id);
      return true;
    };
    const matchesStatus = (command: CommandInfo | undefined): boolean => {
      if (!hasStatus) return true;
      return statusFilter === 'enabled' ? commandEnabled(command) : !commandEnabled(command);
    };

    return displaySchemas
      .map((schema) => {
        const matchesExtensionText =
          !hasSearch ||
          schema.title.toLowerCase().includes(q) ||
          schema.extName.toLowerCase().includes(q) ||
          schema.description.toLowerCase().includes(q);
        const commandsMatched = schema.commands.filter((cmd) => {
          const commandInfo = resolveCommandInfo(schema.extName, cmd.name);
          const commandAlias = commandInfo ? String(settings?.commandAliases?.[commandInfo.id] || '').toLowerCase() : '';
          const textMatch =
            !hasSearch ||
            cmd.title.toLowerCase().includes(q) ||
            cmd.name.toLowerCase().includes(q) ||
            cmd.description.toLowerCase().includes(q) ||
            commandAlias.includes(q);
          return textMatch && matchesStatus(commandInfo);
        });
        if (commandsMatched.length === 0) return null;
        if (matchesExtensionText && commandsMatched.length === schema.commands.length) return schema;
        return { ...schema, commands: commandsMatched };
      })
      .filter(Boolean) as InstalledExtensionSettingsSchema[];
  }, [displaySchemas, search, statusFilter, settings]);

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
    setStatusFilter('all');
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
          ? t('settings.extensions.hotkey.duplicateWithCommand', { name: result.conflictCommandId })
          : t('settings.ai.hotkeyDuplicate')
        : t('settings.ai.hotkeyUnavailable');
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
    setHotkeyStatus({ type: 'success', text: hotkey ? t('settings.ai.hotkeyUpdated') : t('settings.ai.hotkeyRemoved') });
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
    if (extName === SUPERCMD_EXTENSION_NAME) return t('settings.extensions.types.builtIn');
    if (extName === INSTALLED_APPLICATIONS_NAME) return t('settings.extensions.types.apps');
    if (extName === SYSTEM_SETTINGS_NAME) return t('settings.extensions.types.settings');
    if (extName === SCRIPT_COMMANDS_EXTENSION_NAME) return t('settings.extensions.types.scripts');
    return t('settings.extensions.types.extension');
  };

  const getModeTypeLabel = (mode: string, command?: CommandInfo): string => {
    if (command?.id?.startsWith('quicklink-')) return t('settings.extensions.types.quickLink');
    if (command?.category === 'app') return t('settings.extensions.types.application');
    if (command?.category === 'settings') return t('settings.extensions.types.settings');
    if (mode === 'menu-bar') return t('settings.extensions.types.menuBarCommand');
    return t('settings.extensions.types.command');
  };

  const toggleExtensionExpanded = (extName: string) => {
    setExpandedExtensions((prev) => ({ ...prev, [extName]: !prev[extName] }));
  };

  const getCoreCommandIcon = (commandId?: string) => {
    if (!commandId) return <TerminalSquare className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('clipboard')) return <ClipboardList className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('open-settings')) return <Settings className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('open-ai-settings')) return <Brain className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('open-extensions-settings')) return <Wand2 className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('search-files')) return <FileSearch className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('window-management')) return <LayoutGrid className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('create-snippet')) return <FilePlus2 className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('import-snippets')) return <FileInput className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('export-snippets')) return <FileOutput className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('quicklink') || commandId.includes('quicklinks')) return <Link2 className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('quit')) return <LogOut className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    if (commandId.includes('onboarding')) return <Sparkles className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    return <TerminalSquare className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
  };

  const getSystemExtensionCommandIcon = (command?: CommandInfo) => {
    if (command?.category === 'settings') {
      return <Settings className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
    }
    return <TerminalSquare className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />;
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
          setExtensionActionStatus({
            type: 'success',
            text: t('settings.extensions.uninstall.success', { name: extensionTitle }),
          });
          setTimeout(() => setExtensionActionStatus({ type: 'idle', text: '' }), 2200);
          await loadData();
        } else {
          setExtensionActionStatus({
            type: 'error',
            text: t('settings.extensions.uninstall.failed', { name: extensionTitle }),
          });
          setTimeout(() => setExtensionActionStatus({ type: 'idle', text: '' }), 3200);
        }
      } catch (error) {
        console.error('Failed to uninstall extension:', error);
        setExtensionActionStatus({
          type: 'error',
          text: t('settings.extensions.uninstall.failed', { name: extensionTitle }),
        });
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
      setFolderStatus({ type: 'error', text: t('settings.extensions.folder.duplicate') });
      setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 2200);
      return;
    }
    setFolderBusy(true);
    try {
      await updateCustomExtensionFolders([...existing, pickedPath]);
      setFolderStatus({ type: 'success', text: t('settings.extensions.folder.added') });
      setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 1800);
    } catch (error) {
      console.error('Failed to add custom extension folder:', error);
      setFolderStatus({
        type: 'error',
        text: t('settings.extensions.folder.failed', { action: t('common.add').toLowerCase() }),
      });
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
        setFolderStatus({ type: 'success', text: t('settings.extensions.folder.removed') });
        setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 1800);
      } catch (error) {
        console.error('Failed to remove custom extension folder:', error);
        setFolderStatus({
          type: 'error',
          text: t('settings.extensions.folder.failed', { action: t('common.remove').toLowerCase() }),
        });
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
    if (!statusFilterMenuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (statusFilterMenuRef.current?.contains(event.target as Node)) return;
      setStatusFilterMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStatusFilterMenuOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [statusFilterMenuOpen]);

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
    return <div className="text-[var(--text-muted)] text-[13px]">{t('settings.extensions.loading')}</div>;
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
      <div className="flex flex-1 min-h-0 bg-[var(--settings-panel-bg)]">
        <div className="flex-[0_0_66%] min-w-[600px] h-full border-r border-[var(--ui-divider)] flex flex-col">
          <div className="px-3 py-2 border-b border-[var(--ui-divider)]">
            <div className="flex items-center gap-2" ref={toolbarRowRef}>
              <div className="relative w-[360px] max-w-full shrink-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-subtle)]" />
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('common.search')}
                  className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-lg pl-9 pr-4 py-1.5 text-[13px] text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--ui-segment-border)] transition-colors"
                />
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveScope('all')}
                  className={`px-2.5 py-1 rounded-md text-xs ${
                    activeScope === 'all' ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {t('settings.extensions.search.all')}
                </button>
                <button
                  onClick={() => setActiveScope('commands')}
                  className={`px-2.5 py-1 rounded-md text-xs ${
                    activeScope === 'commands' ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {t('settings.extensions.search.commands')}
                </button>
              </div>
              <div className="relative" ref={topActionsMenuRef}>
                <button
                  onClick={() => setShowTopActionsMenu((prev) => !prev)}
                  title={compactToolbar ? t('settings.extensions.installExtension') : undefined}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--accent-soft)] border border-[var(--accent)] text-[var(--accent)] hover:brightness-95 transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  {!compactToolbar && <span>{t('settings.extensions.installExtension')}</span>}
                  {!compactToolbar && <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {showTopActionsMenu ? (
                  <div
                    className="absolute right-0 mt-1 w-48 rounded-lg border border-[var(--ui-panel-border)] shadow-2xl overflow-hidden z-20"
                    style={{
                      background:
                        'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                      backdropFilter: 'blur(96px) saturate(190%)',
                      WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                      borderColor: 'rgba(var(--on-surface-rgb), 0.05)',
                    }}
                  >
                    <button
                      onClick={() => {
                        setShowTopActionsMenu(false);
                        window.electron.openExtensionStoreWindow();
                      }}
                      className="w-full px-2.5 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors"
                    >
                      {t('settings.extensions.installFromStore')}
                    </button>
                    <button
                      onClick={() => {
                        setShowTopActionsMenu(false);
                        void handleAddCustomExtensionFolder();
                      }}
                      disabled={folderBusy}
                      className="w-full px-2.5 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {t('settings.extensions.addFolder')}
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
                                ? t('settings.extensions.scripts.opened')
                                : t('settings.extensions.scripts.openedExisting'),
                            });
                            setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 2200);
                          } else {
                            setFolderStatus({ type: 'error', text: t('settings.extensions.scripts.failed') });
                            setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 2800);
                          }
                        } catch {
                          setFolderStatus({ type: 'error', text: t('settings.extensions.scripts.failed') });
                          setTimeout(() => setFolderStatus({ type: 'idle', text: '' }), 2800);
                        } finally {
                          setFolderBusy(false);
                        }
                      }}
                      disabled={folderBusy}
                      className="w-full px-2.5 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {t('settings.extensions.customScript')}
                    </button>
                  </div>
                ) : null}
              </div>
              {hotkeyStatus.type !== 'idle' ? (
                <p
                  className={`text-xs whitespace-nowrap ${
                    hotkeyStatus.type === 'error'
                      ? 'text-red-300/90'
                      : 'extensions-hotkey-status-success text-emerald-300/90'
                  }`}
                >
                  {hotkeyStatus.text}
                </p>
              ) : null}
            </div>
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

          <div className="grid grid-cols-[1fr_120px_100px_130px_82px] px-4 py-2 text-[11px] uppercase tracking-wider text-[var(--text-subtle)] border-b border-[var(--ui-divider)]">
            <div className="pr-2 border-r border-[var(--ui-divider)]">{t('settings.extensions.columns.name')}</div>
            <div className="px-2 border-r border-[var(--ui-divider)]">{t('settings.extensions.columns.type')}</div>
            <div className="px-2 border-r border-[var(--ui-divider)]">{t('settings.extensions.columns.alias')}</div>
            <div className="px-2 border-r border-[var(--ui-divider)]">{t('settings.extensions.columns.hotkey')}</div>
            <div className="pl-2 flex items-center justify-between gap-1.5" ref={statusFilterMenuRef}>
              <span>{t('settings.extensions.columns.enabled')}</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setStatusFilterMenuOpen((prev) => !prev)}
                  title={t('settings.extensions.search.statusAll')}
                  aria-label={t('settings.extensions.search.statusAll')}
                  className={`p-0.5 rounded hover:bg-[var(--ui-segment-hover-bg)] transition-colors ${
                    statusFilter === 'all'
                      ? 'text-[var(--text-subtle)]'
                      : 'text-[var(--accent)]'
                  }`}
                >
                  <ListFilter className="w-3.5 h-3.5" />
                </button>
                {statusFilterMenuOpen ? (
                  <div
                    className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-[var(--ui-panel-border)] shadow-2xl overflow-hidden z-20"
                    style={{
                      background:
                        'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                      backdropFilter: 'blur(96px) saturate(190%)',
                      WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                      borderColor: 'rgba(var(--on-surface-rgb), 0.05)',
                    }}
                  >
                    {(['all', 'enabled', 'disabled'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setStatusFilter(option);
                          setStatusFilterMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12px] text-left text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] normal-case tracking-normal"
                      >
                        <span>
                          {option === 'all'
                            ? t('settings.extensions.search.statusAll')
                            : option === 'enabled'
                              ? t('settings.extensions.search.enabled')
                              : t('settings.extensions.search.disabled')}
                        </span>
                        {statusFilter === option ? (
                          <Check className="w-3.5 h-3.5 text-[var(--accent)]" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-scroll custom-scrollbar" style={{ scrollbarGutter: 'stable' }}>
            {filteredSchemas.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--text-subtle)]">{t('settings.extensions.noResults')}</div>
            ) : (
              filteredSchemas.map((schema) => {
                const uninstallable = canUninstallExtension(schema.extName);
                return (
                <div key={schema.extName} className="border-b border-[var(--ui-divider)] last:border-b-0">
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
                        ? 'bg-[var(--ui-segment-active-bg)]'
                        : 'hover:bg-[var(--ui-segment-bg)]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {expandedExtensions[schema.extName] ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />
                      )}
                      {(schema.iconDataUrl || extensionIconFallbackByName.get(schema.extName)) ? (
                        <img src={schema.iconDataUrl || extensionIconFallbackByName.get(schema.extName)} alt="" className="w-4 h-4 rounded-sm object-contain" draggable={false} />
                      ) : schema.extName === SUPERCMD_EXTENSION_NAME ? (
                        <img src={supercmdLogo} alt="" className="w-4 h-4 object-contain" draggable={false} />
                      ) : schema.extName === SYSTEM_SETTINGS_NAME ? (
                        <Settings className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                      ) : schema.extName === INSTALLED_APPLICATIONS_NAME ? (
                        <TerminalSquare className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                      ) : schema.extName === SCRIPT_COMMANDS_EXTENSION_NAME ? (
                        <TerminalSquare className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                      ) : (
                        <Puzzle className="w-4 h-4 text-violet-300/80" />
                      )}
                      <span className="text-[13px] text-[var(--text-secondary)] truncate">{schema.title}</span>
                    </span>
                    <span className="text-[13px] text-[var(--text-subtle)]">{getSchemaTypeLabel(schema.extName)}</span>
                    <span className="text-[13px] text-[var(--text-subtle)]">--</span>
                    <span className="text-[13px] text-[var(--text-subtle)]">--</span>
                    <span className="flex items-center justify-start">
                      <input
                        type="checkbox"
                        checked={schema.commands.every((cmd) => isCommandEnabled(resolveCommandInfo(schema.extName, cmd.name)))}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setExtensionEnabled(schema, e.target.checked)}
                        className="settings-checkbox"
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
                            ? 'bg-[var(--ui-segment-active-bg)]'
                            : 'hover:bg-[var(--ui-segment-bg)]'
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
                              <TerminalSquare className="w-3.5 h-3.5 text-[var(--text-subtle)] flex-shrink-0" />
                            )}
                            <span className="text-xs text-[var(--text-secondary)] truncate">{cmd.title}</span>
                          </button>
                          <span className="text-xs text-[var(--text-subtle)]">{getModeTypeLabel(cmd.mode, commandInfo)}</span>
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
                                  placeholder={t('settings.extensions.alias.placeholder')}
                                  className="h-6 w-full min-w-0 rounded-md border border-[var(--ui-segment-border)] bg-[var(--ui-segment-bg)] px-2 font-mono text-[11px] text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--ui-segment-border)]"
                                />
                              ) : currentAlias ? (
                                <button
                                  type="button"
                                  onClick={() => startAliasEditing(commandInfo.id)}
                                  className="inline-flex h-6 max-w-full items-center rounded-md border border-[var(--ui-segment-border)] bg-[var(--ui-segment-bg)] px-2 font-mono text-[11px] text-[var(--text-secondary)] hover:border-[var(--ui-segment-border)] hover:text-[var(--text-primary)] transition-colors"
                                  title={t('settings.extensions.alias.edit')}
                                >
                                  <span className="truncate">{currentAlias}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startAliasEditing(commandInfo.id)}
                                  className="text-xs text-[var(--text-subtle)] hover:text-[var(--text-secondary)] transition-colors"
                                >
                                  {t('settings.extensions.alias.add')}
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--text-subtle)]">--</span>
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
                                  className="settings-checkbox"
                                />
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-[var(--text-subtle)]">{t('settings.extensions.hotkey.record')}</span>
                              <span className="text-xs text-[var(--text-subtle)]">-</span>
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
          <div className="px-4 py-2 border-b border-[var(--ui-divider)]">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">
              <Folder className="w-3.5 h-3.5 text-[var(--text-subtle)]" />
              <span>{t('settings.extensions.customFolders.title')}</span>
              <span className="text-[var(--text-subtle)]">({customExtensionFolders.length})</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
              {customExtensionFolders.length === 0 ? (
                <span className="text-[11px] text-[var(--text-subtle)]">
                  {t('settings.extensions.customFolders.empty')}
                </span>
              ) : (
                customExtensionFolders.map((folderPath) => (
                  <div
                    key={folderPath}
                    className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] px-2 py-1"
                    title={folderPath}
                  >
                    <span className="truncate text-[11px] text-[var(--text-secondary)]">{getFolderName(folderPath)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomExtensionFolder(folderPath)}
                      disabled={folderBusy}
                      className="text-[11px] text-red-300/90 hover:text-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('settings.extensions.customFolders.remove')}
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
            <div className="h-full flex items-center justify-center text-[13px] text-[var(--text-subtle)]">{t('settings.extensions.selectExtension')}</div>
          ) : (
            <div className="h-full min-h-0 flex flex-col">
              <div className="px-4 py-3 border-b border-[var(--ui-divider)]">
                <div className="flex items-center gap-2">
                  {selectedSchema.iconDataUrl ? (
                    <img src={selectedSchema.iconDataUrl} alt="" className="w-5 h-5 rounded object-contain" draggable={false} />
                  ) : selectedSchema.extName === SUPERCMD_EXTENSION_NAME ? (
                    <img src={supercmdLogo} alt="" className="w-5 h-5 object-contain" draggable={false} />
                  ) : selectedSchema.extName === SYSTEM_SETTINGS_NAME ? (
                    <Settings className="w-5 h-5 text-[var(--text-muted)]" />
                  ) : selectedSchema.extName === INSTALLED_APPLICATIONS_NAME ? (
                    <TerminalSquare className="w-5 h-5 text-[var(--text-muted)]" />
                  ) : selectedSchema.extName === SCRIPT_COMMANDS_EXTENSION_NAME ? (
                    <TerminalSquare className="w-5 h-5 text-[var(--text-muted)]" />
                  ) : (
                    <Puzzle className="w-5 h-5 text-violet-300/80" />
                  )}
                  <div className="text-[13px] font-semibold text-[var(--text-secondary)]">
                    {selectedCommandSchema ? selectedCommandSchema.title : selectedSchema.title}
                  </div>
                </div>
                <div className="mt-1 text-xs text-[var(--text-subtle)]">
                  {selectedCommandSchema ? selectedCommandSchema.description : selectedSchema.description}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-scroll custom-scrollbar p-4 space-y-5" style={{ scrollbarGutter: 'stable' }}>
                {selectedCommandSchema && selectedCommandInfo ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <input
                        type="checkbox"
                        checked={isCommandEnabled(selectedCommandInfo)}
                        onChange={(e) => setCommandEnabled(selectedCommandInfo, e.target.checked)}
                        className="settings-checkbox"
                      />
                      {t('settings.extensions.enabled')}
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
                    <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 inline-block" />
                      {t('settings.extensions.loggedIn', { name: selectedSchema.title })}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOAuthLogout(selectedSchema.extName)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--ui-segment-hover-bg)] hover:bg-[var(--ui-segment-active-bg)] text-[var(--text-secondary)] transition-colors"
                    >
                      <LogOut className="w-3 h-3" />
                      {t('settings.extensions.logout')}
                    </button>
                  </div>
                ) : null}

                {selectedCommandInfo?.id === 'system-emoji-picker' ? (
                  <EmojiPickerSettingsSection
                    enabled={settings?.emojiPickerEnabled ?? true}
                    triggerPrefix={settings?.emojiPickerTriggerPrefix ?? ':'}
                    onChange={async (patch) => {
                      await window.electron.saveSettings(patch);
                      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
                    }}
                  />
                ) : null}

                {selectedCommandInfo?.id === 'system-clipboard-manager' ? (
                  <ClipboardSettingsSection
                    retentionDays={settings?.clipboardHistoryRetentionDays ?? null}
                    onRetentionChange={async (next) => {
                      await window.electron.saveSettings({ clipboardHistoryRetentionDays: next });
                      setSettings((prev) => (prev ? { ...prev, clipboardHistoryRetentionDays: next } : prev));
                    }}
                    blacklist={settings?.clipboardAppBlacklist ?? []}
                    onBlacklistChange={async (next) => {
                      await window.electron.saveSettings({ clipboardAppBlacklist: next });
                      setSettings((prev) => (prev ? { ...prev, clipboardAppBlacklist: next } : prev));
                    }}
                  />
                ) : null}

                {selectedCommandInfo?.id?.startsWith(QUICK_LINK_COMMAND_PREFIX) ? (
                  <QuickLinkEditorSection
                    commandId={selectedCommandInfo.id}
                    onDeleted={() => setSelected({ extName: selectedSchema.extName })}
                  />
                ) : (
                  <>
                    <PreferenceSection
                      title={t('settings.extensions.extensionPreferences')}
                      extName={selectedSchema.extName}
                      preferences={selectedSchema.preferences}
                      values={getPreferenceValues(selectedSchema.extName)}
                      setPreferenceValue={setPreferenceValue}
                      pickPathForPreference={pickPathForPreference}
                    />

                    {selectedCommandSchema ? (
                      <PreferenceSection
                        title={t('settings.extensions.commandPreferences')}
                        extName={selectedSchema.extName}
                        cmdName={selectedCommandSchema.name}
                        preferences={selectedCommandSchema.preferences}
                        values={getPreferenceValues(selectedSchema.extName, selectedCommandSchema.name)}
                        setPreferenceValue={setPreferenceValue}
                        pickPathForPreference={pickPathForPreference}
                      />
                    ) : null}
                  </>
                )}
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
            className="glass-effect w-[296px] max-w-[82vw] rounded-xl border border-[var(--ui-panel-border)] p-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)]">
              {uninstallDialog.iconDataUrl ? (
                <img
                  src={uninstallDialog.iconDataUrl}
                  alt=""
                  className="h-5 w-5 rounded object-contain"
                  draggable={false}
                />
              ) : (
                <Puzzle className="h-4.5 w-4.5 text-[var(--text-muted)]" />
              )}
            </div>

            <div className="text-center text-[18px] font-semibold leading-tight text-[var(--text-primary)]">
              {t('settings.extensions.uninstall.title', { name: uninstallDialog.title })}
            </div>
            <p className="mt-1 text-center text-[11px] leading-snug text-[var(--text-subtle)]">
              {t('settings.extensions.uninstall.description')}
            </p>

            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                disabled={Boolean(busyUninstallExtName)}
                onClick={() => setUninstallDialog(null)}
                className="flex-1 rounded-md border border-[var(--ui-segment-border)] bg-[var(--ui-segment-bg)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('settings.extensions.uninstall.cancel')}
              </button>
              <button
                type="button"
                disabled={Boolean(busyUninstallExtName)}
                onClick={() => void handleUninstallExtension(uninstallDialog.extName, uninstallDialog.title)}
                className="flex-1 rounded-md border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-red-200/90 hover:bg-red-500/18 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busyUninstallExtName ? t('settings.extensions.uninstall.uninstalling') : t('settings.extensions.uninstall.confirm')}
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
            className="absolute min-w-[150px] rounded-xl border border-[var(--ui-segment-border)] shadow-2xl p-1"
            style={{
              left: Math.min(extensionContextMenu.x, window.innerWidth - 180),
              top: Math.min(extensionContextMenu.y, window.innerHeight - 120),
              background:
                'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
              backdropFilter: 'blur(96px) saturate(190%)',
              WebkitBackdropFilter: 'blur(96px) saturate(190%)',
              borderColor: 'rgba(var(--on-surface-rgb), 0.05)',
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
              className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-red-300/90 hover:text-red-200 hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busyUninstallExtName === extensionContextMenu.extName ? t('settings.extensions.uninstall.uninstalling') : t('settings.extensions.uninstall.confirm')}
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
  const { t } = useI18n();

  if (!preferences || preferences.length === 0) {
    return (
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">{title}</div>
        <div className="text-xs text-[var(--text-subtle)]">{t('settings.extensions.noPreferences')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">{title}</div>
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
                <div className="text-xs text-[var(--text-secondary)] font-medium">
                  {titleText}
                  {pref.required ? <span className="text-red-400"> *</span> : null}
                  {missing ? <span className="text-red-300/80 ml-2">({t('common.required')})</span> : null}
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] min-w-[140px] justify-end">
                  <span>{pref.label || t('settings.extensions.enabled')}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => setPreferenceValue(extName, pref, e.target.checked, cmdName)}
                    className="settings-checkbox"
                  />
                </label>
              </div>
            ) : (
              <>
                <label className="text-xs text-[var(--text-secondary)] font-medium">
                  {titleText}
                  {pref.required ? <span className="text-red-400"> *</span> : null}
                  {missing ? <span className="text-red-300/80 ml-2">({t('common.required')})</span> : null}
                </label>
                {type === 'dropdown' ? (
                  <select
                    value={textValue}
                    onChange={(e) => setPreferenceValue(extName, pref, e.target.value, cmdName)}
                    className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-panel-border)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-secondary)] outline-none"
                  >
                    <option value="">{t('settings.extensions.preferences.selectOption')}</option>
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
                      className="flex-1 bg-[var(--ui-segment-bg)] border border-[var(--ui-panel-border)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] outline-none"
                    />
                    {(type === 'file' || type === 'directory' || type === 'appPicker') && (
                      <button
                        type="button"
                        onClick={() => pickPathForPreference(extName, pref, cmdName)}
                        className="px-2 py-1.5 text-[11px] rounded-md border border-[var(--ui-segment-border)] text-[var(--text-muted)] hover:bg-[var(--ui-segment-bg)]"
                      >
                        {t('common.browse')}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {pref.description ? <p className="text-[11px] text-[var(--text-subtle)]">{pref.description}</p> : null}
          </div>
        );
      })}
    </div>
  );
};

const QUICK_LINK_COMMAND_PREFIX = 'quicklink-';
const QUICK_LINK_BROWSER_PROTOCOLS = new Set(['http', 'https', 'file']);

function isBrowserProtocolUrlTemplate(urlTemplate: string): boolean {
  const normalized = String(urlTemplate || '').trim();
  if (!normalized) return false;
  const candidate = normalized.replace(/\{[^}]+\}/g, 'placeholder');
  try {
    const parsed = new URL(candidate);
    const protocol = String(parsed.protocol || '').replace(':', '').trim().toLowerCase();
    return QUICK_LINK_BROWSER_PROTOCOLS.has(protocol);
  } catch {
    return false;
  }
}

const QuickLinkEditorSection: React.FC<{
  commandId: string;
  onDeleted?: () => void;
}> = ({ commandId, onDeleted }) => {
  const { t } = useI18n();
  const quickLinkId = commandId.startsWith(QUICK_LINK_COMMAND_PREFIX)
    ? commandId.slice(QUICK_LINK_COMMAND_PREFIX.length)
    : '';

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('');
  const [applicationPath, setApplicationPath] = useState('');
  const [applicationName, setApplicationName] = useState('');
  const [applicationBundleId, setApplicationBundleId] = useState('');
  const [appIconDataUrl, setAppIconDataUrl] = useState<string | undefined>(undefined);
  const [apps, setApps] = useState<InstalledAppEntry[]>([]);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const initialRef = useRef({ name: '', urlTemplate: '', applicationPath: '' });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setStatusMessage('');
    setSavingState('idle');
    setConfirmingDelete(false);
    (async () => {
      try {
        const [all, applications] = await Promise.all([
          window.electron.quickLinkGetAll(),
          window.electron.getApplications(),
        ]);
        if (cancelled) return;
        const link = (all || []).find((entry) => entry.id === quickLinkId);
        if (!link) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const isBrowserUrl = isBrowserProtocolUrlTemplate(link.urlTemplate || '');
        const effectiveAppPath = isBrowserUrl ? '' : link.applicationPath || '';
        setName(link.name || '');
        setUrlTemplate(link.urlTemplate || '');
        setApplicationPath(effectiveAppPath);
        setApplicationName(isBrowserUrl ? '' : link.applicationName || '');
        setApplicationBundleId(isBrowserUrl ? '' : link.applicationBundleId || '');
        setAppIconDataUrl(isBrowserUrl ? undefined : link.appIconDataUrl);
        initialRef.current = {
          name: link.name || '',
          urlTemplate: link.urlTemplate || '',
          applicationPath: effectiveAppPath,
        };
        setApps(
          (applications || [])
            .filter((entry) => Boolean(entry?.path))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
        setLoading(false);
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quickLinkId]);

  const dirty =
    name !== initialRef.current.name ||
    urlTemplate !== initialRef.current.urlTemplate ||
    applicationPath !== initialRef.current.applicationPath;

  const onSave = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = urlTemplate.trim();
    if (!trimmedName) {
      setSavingState('error');
      setStatusMessage(t('quickLinks.nameRequired'));
      return;
    }
    if (!trimmedUrl) {
      setSavingState('error');
      setStatusMessage(t('quickLinks.urlRequired'));
      return;
    }
    setSavingState('saving');
    setStatusMessage('');
    try {
      const updated = await window.electron.quickLinkUpdate(quickLinkId, {
        name: trimmedName,
        urlTemplate: trimmedUrl,
        applicationName: applicationName || undefined,
        applicationPath: applicationPath || undefined,
        applicationBundleId: applicationBundleId || undefined,
        appIconDataUrl,
      });
      if (!updated) {
        setSavingState('error');
        setStatusMessage(t('quickLinks.saveFailed'));
        return;
      }
      initialRef.current = {
        name: trimmedName,
        urlTemplate: trimmedUrl,
        applicationPath: applicationPath || '',
      };
      setSavingState('saved');
      setStatusMessage(t('quickLinks.saved'));
      window.setTimeout(() => {
        setSavingState((curr) => (curr === 'saved' ? 'idle' : curr));
        setStatusMessage((curr) => (curr === t('quickLinks.saved') ? '' : curr));
      }, 1800);
    } catch (error: any) {
      setSavingState('error');
      setStatusMessage(error?.message || t('quickLinks.saveFailed'));
    }
  };

  const onDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await window.electron.quickLinkDelete(quickLinkId);
      onDeleted?.();
    } catch (error: any) {
      setSavingState('error');
      setStatusMessage(error?.message || t('quickLinks.deleteFailed'));
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const onApplicationChange = (path: string) => {
    if (!path) {
      setApplicationPath('');
      setApplicationName('');
      setApplicationBundleId('');
      setAppIconDataUrl(undefined);
      return;
    }
    const app = apps.find((entry) => entry.path === path);
    setApplicationPath(path);
    setApplicationName(app?.name || '');
    setApplicationBundleId(app?.bundleId || '');
    setAppIconDataUrl(app?.iconDataUrl);
  };

  if (!quickLinkId) return null;

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">{t('quickLinks.edit')}</div>
        <div className="text-xs text-[var(--text-subtle)]">{t('common.loading')}</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">{t('quickLinks.edit')}</div>
        <div className="text-xs text-[var(--text-subtle)]">{t('quickLinks.notFound')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">{t('quickLinks.edit')}</div>

      <div className="space-y-1">
        <label className="text-xs text-[var(--text-secondary)] font-medium">{t('quickLinks.name')}</label>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-panel-border)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] outline-none"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-[var(--text-secondary)] font-medium">{t('quickLinks.url')}</label>
        <input
          type="text"
          value={urlTemplate}
          onChange={(event) => {
            const next = event.target.value;
            setUrlTemplate(next);
            if (isBrowserProtocolUrlTemplate(next) && applicationPath) {
              setApplicationPath('');
              setApplicationName('');
              setApplicationBundleId('');
              setAppIconDataUrl(undefined);
            }
          }}
          placeholder="https://example.com/search?q={clipboard}"
          className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-panel-border)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] outline-none"
        />
        <p className="text-[11px] text-[var(--text-subtle)]">{t('quickLinks.urlHint')}</p>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-[var(--text-secondary)] font-medium">{t('quickLinks.openWith')}</label>
        <select
          value={applicationPath}
          onChange={(event) => onApplicationChange(event.target.value)}
          className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-panel-border)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-secondary)] outline-none"
        >
          <option value="">{t('quickLinks.defaultBrowser')}</option>
          {apps.map((app) => (
            <option key={app.path} value={app.path}>
              {app.name}
            </option>
          ))}
        </select>
      </div>

      {statusMessage ? (
        <p
          className={`text-[11px] ${
            savingState === 'error' ? 'text-red-300/90' : 'text-emerald-300/90'
          }`}
        >
          {statusMessage}
        </p>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || savingState === 'saving'}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)] border border-[var(--ui-segment-border)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {savingState === 'saving' ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-400/25 bg-red-500/10 text-red-200/90 hover:bg-red-500/18 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ml-auto"
        >
          {deleting
            ? t('settings.extensions.uninstall.uninstalling')
            : confirmingDelete
              ? t('quickLinks.confirmDelete')
              : t('quickLinks.delete')}
        </button>
      </div>
    </div>
  );
};

type InstalledAppEntry = {
  name: string;
  path: string;
  bundleId?: string;
  iconDataUrl?: string;
};

const CLIPBOARD_RETENTION_OPTIONS: { value: number | null; labelKey: string }[] = [
  { value: 1, labelKey: 'settings.advanced.clipboardRetention.option.1day' },
  { value: 7, labelKey: 'settings.advanced.clipboardRetention.option.7days' },
  { value: 30, labelKey: 'settings.advanced.clipboardRetention.option.1month' },
  { value: 90, labelKey: 'settings.advanced.clipboardRetention.option.3months' },
  { value: 180, labelKey: 'settings.advanced.clipboardRetention.option.6months' },
  { value: 365, labelKey: 'settings.advanced.clipboardRetention.option.1year' },
  { value: null, labelKey: 'settings.advanced.clipboardRetention.option.never' },
];

const ClipboardSettingsSection: React.FC<{
  retentionDays: number | null;
  onRetentionChange: (next: number | null) => Promise<void>;
  blacklist: string[];
  onBlacklistChange: (next: string[]) => Promise<void>;
}> = ({ retentionDays, onRetentionChange, blacklist, onBlacklistChange }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">
          {t('settings.advanced.clipboardRetention.title')}
        </div>
        <p className="text-[11px] text-[var(--text-subtle)] leading-snug">
          {t('settings.advanced.clipboardRetention.description')}
        </p>
        <div className="w-full max-w-[320px]">
          <select
            value={retentionDays == null ? 'never' : String(retentionDays)}
            onChange={(event) => {
              const raw = event.target.value;
              const next = raw === 'never' ? null : Number(raw);
              void onRetentionChange(next);
            }}
            className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
          >
            {CLIPBOARD_RETENTION_OPTIONS.map((opt) => (
              <option
                key={opt.value == null ? 'never' : String(opt.value)}
                value={opt.value == null ? 'never' : String(opt.value)}
              >
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ClipboardBlacklistSection blacklist={blacklist} onChange={onBlacklistChange} />
    </div>
  );
};

const ClipboardBlacklistSection: React.FC<{
  blacklist: string[];
  onChange: (next: string[]) => Promise<void>;
}> = ({ blacklist, onChange }) => {
  const { t } = useI18n();
  const [apps, setApps] = useState<InstalledAppEntry[]>([]);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const installed = await window.electron.getApplications();
        if (cancelled) return;
        setApps(
          (installed || [])
            .filter((entry) => Boolean(entry?.bundleId))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      } catch {
        if (!cancelled) setApps([]);
      } finally {
        if (!cancelled) setAppsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return;
      setPickerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    const focusTimer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [pickerOpen]);

  const appByBundleId = useMemo(() => {
    const map = new Map<string, InstalledAppEntry>();
    for (const entry of apps) {
      const key = String(entry.bundleId || '').toLowerCase();
      if (key) map.set(key, entry);
    }
    return map;
  }, [apps]);

  const blacklistedEntries = useMemo(() => {
    return blacklist.map((bundleId) => {
      const match = appByBundleId.get(String(bundleId || '').toLowerCase());
      return {
        bundleId,
        name: match?.name || bundleId,
        iconDataUrl: match?.iconDataUrl,
      };
    });
  }, [blacklist, appByBundleId]);

  const selectableApps = useMemo(() => {
    const already = new Set(blacklist.map((b) => String(b || '').toLowerCase()));
    const q = pickerSearch.trim().toLowerCase();
    return apps.filter((entry) => {
      const key = String(entry.bundleId || '').toLowerCase();
      if (!key || already.has(key)) return false;
      if (!q) return true;
      return (
        entry.name.toLowerCase().includes(q) ||
        key.includes(q)
      );
    });
  }, [apps, blacklist, pickerSearch]);

  const handleAdd = async (bundleId: string) => {
    const normalized = String(bundleId || '').trim();
    if (!normalized) return;
    if (blacklist.some((b) => String(b || '').toLowerCase() === normalized.toLowerCase())) return;
    const next = [...blacklist, normalized];
    setPickerOpen(false);
    setPickerSearch('');
    await onChange(next);
  };

  const handleRemove = async (bundleId: string) => {
    const next = blacklist.filter((b) => b !== bundleId);
    await onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">
          {t('settings.extensions.clipboardBlacklist.title')}
        </div>
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--ui-segment-border)] bg-[var(--ui-segment-bg)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors"
          >
            <Plus className="w-3 h-3" />
            {t('settings.extensions.clipboardBlacklist.add')}
          </button>
          {pickerOpen ? (
            <div
              className="absolute right-0 top-full mt-1 w-72 max-h-[320px] rounded-lg border border-[var(--ui-panel-border)] shadow-2xl overflow-hidden z-20 flex flex-col"
              style={{
                background:
                  'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                backdropFilter: 'blur(96px) saturate(190%)',
                WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                borderColor: 'rgba(var(--on-surface-rgb), 0.05)',
              }}
            >
              <div className="p-1.5 border-b border-[var(--ui-divider)]">
                <input
                  ref={searchInputRef}
                  value={pickerSearch}
                  onChange={(event) => setPickerSearch(event.target.value)}
                  placeholder={t('settings.extensions.clipboardBlacklist.searchPlaceholder')}
                  className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2 py-1 text-[12px] text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] outline-none"
                />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {!appsLoaded ? (
                  <div className="px-2.5 py-2 text-[11px] text-[var(--text-subtle)]">
                    {t('settings.extensions.clipboardBlacklist.loading')}
                  </div>
                ) : selectableApps.length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-[var(--text-subtle)]">
                    {t('settings.extensions.clipboardBlacklist.noApps')}
                  </div>
                ) : (
                  selectableApps.map((entry) => (
                    <button
                      key={entry.bundleId}
                      type="button"
                      onClick={() => {
                        if (entry.bundleId) void handleAdd(entry.bundleId);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--ui-segment-hover-bg)] transition-colors"
                    >
                      {entry.iconDataUrl ? (
                        <img
                          src={entry.iconDataUrl}
                          alt=""
                          className="w-4 h-4 rounded-sm object-contain flex-shrink-0"
                          draggable={false}
                        />
                      ) : (
                        <TerminalSquare className="w-4 h-4 text-[var(--text-subtle)] flex-shrink-0" />
                      )}
                      <span className="text-[12px] text-[var(--text-secondary)] truncate">{entry.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-subtle)] leading-snug">
        {t('settings.extensions.clipboardBlacklist.description')}
      </p>
      {blacklistedEntries.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--ui-divider)] px-3 py-3 text-[11px] text-[var(--text-subtle)]">
          {t('settings.extensions.clipboardBlacklist.empty')}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {blacklistedEntries.map((entry) => (
            <div
              key={entry.bundleId}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] pl-1.5 pr-1 py-1"
              title={entry.bundleId}
            >
              {entry.iconDataUrl ? (
                <img
                  src={entry.iconDataUrl}
                  alt=""
                  className="w-3.5 h-3.5 rounded-sm object-contain"
                  draggable={false}
                />
              ) : (
                <TerminalSquare className="w-3.5 h-3.5 text-[var(--text-subtle)]" />
              )}
              <span className="text-[11px] text-[var(--text-secondary)] max-w-[180px] truncate">{entry.name}</span>
              <button
                type="button"
                onClick={() => void handleRemove(entry.bundleId)}
                className="p-0.5 rounded-sm text-[var(--text-subtle)] hover:text-red-300/90 hover:bg-[var(--ui-segment-hover-bg)]"
                aria-label={t('settings.extensions.clipboardBlacklist.remove')}
                title={t('settings.extensions.clipboardBlacklist.remove')}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const EmojiPickerSettingsSection: React.FC<{
  enabled: boolean;
  triggerPrefix: string;
  onChange: (patch: { emojiPickerEnabled?: boolean; emojiPickerTriggerPrefix?: string }) => Promise<void>;
}> = ({ enabled, triggerPrefix, onChange }) => {
  const { t } = useI18n();
  const [prefixDraft, setPrefixDraft] = React.useState(triggerPrefix);

  React.useEffect(() => { setPrefixDraft(triggerPrefix); }, [triggerPrefix]);

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">
        {t('settings.extensions.emojiPicker.enabled')}
      </div>

      {/* Enable toggle */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-[11px] text-[var(--text-subtle)] leading-snug max-w-[260px]">
          {t('settings.extensions.emojiPicker.enabledDesc')}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('settings.extensions.emojiPicker.enabled')}
          onClick={() => void onChange({ emojiPickerEnabled: !enabled })}
          className={`relative flex-shrink-0 w-10 h-6 rounded-full border transition-colors ${
            enabled
              ? 'bg-[var(--accent)] border-[var(--accent-hover)]'
              : 'bg-[var(--ui-segment-bg)] border-[var(--ui-segment-border)]'
          }`}
        >
          <span
            className={`absolute left-0.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border shadow-sm bg-[var(--bg-overlay-strong)] border-[var(--ui-segment-border)] transition-transform ${
              enabled ? 'translate-x-[18px]' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Trigger prefix — only shown when enabled */}
      {enabled && (
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-secondary)] font-medium">
            {t('settings.extensions.emojiPicker.triggerPrefix')}
          </label>
          <p className="text-[11px] text-[var(--text-subtle)] leading-snug">
            {t('settings.extensions.emojiPicker.triggerPrefixDesc')}
          </p>
          <input
            type="text"
            maxLength={4}
            value={prefixDraft}
            placeholder={t('settings.extensions.emojiPicker.triggerPrefixPlaceholder')}
            onChange={(e) => setPrefixDraft(e.target.value)}
            onBlur={() => {
              const trimmed = prefixDraft.trim();
              if (trimmed && trimmed !== triggerPrefix) {
                void onChange({ emojiPickerTriggerPrefix: trimmed });
              } else if (!trimmed) {
                setPrefixDraft(triggerPrefix);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="w-24 bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-blue-500/50"
          />
        </div>
      )}
    </div>
  );
};

export default ExtensionsTab;
