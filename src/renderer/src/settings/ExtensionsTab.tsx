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
  const [search, setSearch] = useState('');
  const [activeScope, setActiveScope] = useState<'all' | 'commands'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<SelectedTarget | null>(null);
  const [expandedExtensions, setExpandedExtensions] = useState<Record<string, boolean>>({});
  const [hotkeyStatus, setHotkeyStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    text: string;
  }>({ type: 'idle', text: '' });
  const [folderStatus, setFolderStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    text: string;
  }>({ type: 'idle', text: '' });
  const [folderBusy, setFolderBusy] = useState(false);
  const [showTopActionsMenu, setShowTopActionsMenu] = useState(false);
  const topActionsMenuRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [cmds, sett, extSchemas] = await Promise.all([
        window.electron.getAllCommands(),
        window.electron.getSettings(),
        window.electron.getInstalledExtensionsSettingsSchema(),
      ]);
      setCommands(cmds);
      setSettings(sett);
      setSchemas(extSchemas);
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

  const commandBySchemaKey = useMemo(() => {
    const map = new Map<string, CommandInfo>();
    for (const cmd of commands) {
      if (cmd.category === 'extension' && cmd.path) {
        const [extName, cmdName] = cmd.path.split('/');
        if (extName && cmdName) map.set(`${extName}/${cmdName}`, cmd);
        continue;
      }
      if (cmd.category === 'script') {
        map.set(`__script_commands/${cmd.id}`, cmd);
        continue;
      }
      if (cmd.category === 'system') {
        map.set(`__supercommand/${cmd.id}`, cmd);
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
      byExt.set('__supercommand', {
        extName: '__supercommand',
        title: 'SuperCmd',
        description: 'Built-in SuperCmd commands',
        owner: 'supercommand',
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
      byExt.set('__script_commands', {
        extName: '__script_commands',
        title: 'Script Commands',
        description: 'Custom and Raycast-compatible script commands',
        owner: 'supercommand',
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

    return Array.from(byExt.values()).sort((a, b) => {
      if (a.extName === '__supercommand') return -1;
      if (b.extName === '__supercommand') return 1;
      if (a.extName === '__script_commands') return -1;
      if (b.extName === '__script_commands') return 1;
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
          (cmd) =>
            cmd.title.toLowerCase().includes(q) ||
            cmd.name.toLowerCase().includes(q) ||
            cmd.description.toLowerCase().includes(q)
        );
        if (matchesExtension) return schema;
        if (commandsMatched.length > 0) return { ...schema, commands: commandsMatched };
        return null;
      })
      .filter(Boolean) as InstalledExtensionSettingsSchema[];
  }, [displaySchemas, search]);

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
        if (next[schema.extName] === undefined) next[schema.extName] = true;
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
        ? 'Hotkey already used by another SuperCmd command.'
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

  const getModeTypeLabel = (mode: string): string => {
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

  const setExtensionEnabled = async (schema: InstalledExtensionSettingsSchema, enabled: boolean) => {
    for (const cmd of schema.commands) {
      const commandInfo = resolveCommandInfo(schema.extName, cmd.name);
      if (!commandInfo) continue;
      await setCommandEnabled(commandInfo, enabled);
    }
  };

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
    const onMouseDown = (event: MouseEvent) => {
      if (topActionsMenuRef.current?.contains(event.target as Node)) return;
      setShowTopActionsMenu(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [showTopActionsMenu]);

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
      <div className="flex flex-1 min-h-0 bg-white/[0.01]">
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
                  <div className="absolute right-0 mt-1 w-44 rounded-lg border border-white/[0.10] bg-[#1a1c23]/95 backdrop-blur-md shadow-2xl overflow-hidden z-20">
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
              filteredSchemas.map((schema) => (
                <div key={schema.extName} className="border-b border-white/[0.04] last:border-b-0">
                  <button
                    onClick={() => {
                      setSelected({ extName: schema.extName });
                      toggleExtensionExpanded(schema.extName);
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
                      ) : schema.extName === '__supercommand' ? (
                        <img src={supercmdLogo} alt="" className="w-4 h-4 object-contain" draggable={false} />
                      ) : (
                        <Puzzle className="w-4 h-4 text-violet-300/80" />
                      )}
                      <span className="text-sm text-white/90 truncate">{schema.title}</span>
                    </span>
                    <span className="text-sm text-white/55">Extension</span>
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
                            ) : schema.extName === '__supercommand' ? (
                              getCoreCommandIcon(commandInfo?.id)
                            ) : (
                              <TerminalSquare className="w-3.5 h-3.5 text-white/45 flex-shrink-0" />
                            )}
                            <span className="text-xs text-white/85 truncate">{cmd.title}</span>
                          </button>
                          <span className="text-xs text-white/55">{getModeTypeLabel(cmd.mode)}</span>
                          <span className="text-xs text-white/45">Add Alias</span>
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
              ))
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
