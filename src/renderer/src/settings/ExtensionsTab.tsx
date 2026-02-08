/**
 * Extensions Tab
 *
 * Lists all command categories (apps, system settings, SuperCommand core,
 * installed extensions) in expandable groups. Each item supports
 * enable/disable and hotkey customization.
 *
 * The extension store is embedded at the bottom of this tab.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  ChevronRight,
  ChevronDown,
  Settings,
  Power,
  Puzzle,
  Package,
  Cpu,
  AppWindow,
} from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
import StoreTab from './StoreTab';
import type { CommandInfo, AppSettings } from '../../types/electron';

const ExtensionsTab: React.FC = () => {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['apps', 'system', 'extensions'])
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      window.electron.getAllCommands(),
      window.electron.getSettings(),
    ]).then(([cmds, sett]) => {
      setCommands(cmds);
      setSettings(sett);
      setIsLoading(false);
    });
  }, []);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const appCommands = useMemo(
    () => commands.filter((c) => c.category === 'app'),
    [commands]
  );
  const settingsCommands = useMemo(
    () => commands.filter((c) => c.category === 'settings'),
    [commands]
  );
  const systemCommands = useMemo(
    () => commands.filter((c) => c.category === 'system'),
    [commands]
  );
  const extensionCommands = useMemo(
    () => commands.filter((c) => c.category === 'extension'),
    [commands]
  );

  const filterItems = (items: CommandInfo[]) => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.keywords?.some((k) => k.toLowerCase().includes(q)) ||
        c.path?.toLowerCase().includes(q)
    );
  };

  const filteredApps = filterItems(appCommands);
  const filteredSettings = filterItems(settingsCommands);
  const filteredSystem = filterItems(systemCommands);
  const filteredExtensions = filterItems(extensionCommands);

  const isDisabled = (id: string) =>
    settings?.disabledCommands.includes(id) ?? false;
  const getHotkey = (id: string) => settings?.commandHotkeys[id] || '';

  const handleToggleEnabled = async (commandId: string) => {
    const currentlyDisabled = isDisabled(commandId);
    await window.electron.toggleCommandEnabled(commandId, currentlyDisabled);
    setSettings((prev) => {
      if (!prev) return prev;
      let disabled = [...prev.disabledCommands];
      if (currentlyDisabled) {
        disabled = disabled.filter((id) => id !== commandId);
      } else {
        disabled.push(commandId);
      }
      return { ...prev, disabledCommands: disabled };
    });
  };

  const handleHotkeyChange = async (commandId: string, hotkey: string) => {
    await window.electron.updateCommandHotkey(commandId, hotkey);
    setSettings((prev) => {
      if (!prev) return prev;
      const hotkeys = { ...prev.commandHotkeys };
      if (hotkey) {
        hotkeys[commandId] = hotkey;
      } else {
        delete hotkeys[commandId];
      }
      return { ...prev, commandHotkeys: hotkeys };
    });
  };

  if (isLoading) {
    return <div className="p-8 text-white/50 text-sm">Loading extensions...</div>;
  }

  return (
    <div className="p-8">
      <h2 className="text-xl font-semibold text-white mb-6">Extensions</h2>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          placeholder="Search commands and extensions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20 transition-colors"
        />
      </div>

      <div className="mb-8">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/35 mb-3 flex items-center gap-2">
          <Package className="w-3.5 h-3.5" />
          Commands
        </h3>

        <div className="space-y-2">
          <ExtensionGroup
            title="Applications"
            subtitle={`${appCommands.length} commands`}
            icon={<AppWindow className="w-4 h-4 text-white/70" />}
            isExpanded={expandedGroups.has('apps')}
            onToggle={() => toggleGroup('apps')}
            items={filteredApps}
            isDisabled={isDisabled}
            getHotkey={getHotkey}
            onToggleEnabled={handleToggleEnabled}
            onHotkeyChange={handleHotkeyChange}
          />

          <ExtensionGroup
            title="System Settings"
            subtitle={`${settingsCommands.length} commands`}
            icon={<Settings className="w-4 h-4 text-white/70" />}
            isExpanded={expandedGroups.has('settings')}
            onToggle={() => toggleGroup('settings')}
            items={filteredSettings}
            isDisabled={isDisabled}
            getHotkey={getHotkey}
            onToggleEnabled={handleToggleEnabled}
            onHotkeyChange={handleHotkeyChange}
          />

          <ExtensionGroup
            title="SuperCommand"
            subtitle={`${systemCommands.length} commands`}
            icon={<Cpu className="w-4 h-4 text-white/70" />}
            isExpanded={expandedGroups.has('system')}
            onToggle={() => toggleGroup('system')}
            items={filteredSystem}
            isDisabled={isDisabled}
            getHotkey={getHotkey}
            onToggleEnabled={handleToggleEnabled}
            onHotkeyChange={handleHotkeyChange}
          />

          <ExtensionGroup
            title="Installed Extensions"
            subtitle={`${extensionCommands.length} commands`}
            icon={<Puzzle className="w-4 h-4 text-white/70" />}
            isExpanded={expandedGroups.has('extensions')}
            onToggle={() => toggleGroup('extensions')}
            items={filteredExtensions}
            isDisabled={isDisabled}
            getHotkey={getHotkey}
            onToggleEnabled={handleToggleEnabled}
            onHotkeyChange={handleHotkeyChange}
          />
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/35 mb-3 flex items-center gap-2">
          <Puzzle className="w-3.5 h-3.5" />
          Store
        </h3>
        <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-5">
          <StoreTab embedded />
        </div>
      </div>
    </div>
  );
};

interface ExtensionGroupProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  items: CommandInfo[];
  isDisabled: (id: string) => boolean;
  getHotkey: (id: string) => string;
  onToggleEnabled: (id: string) => void;
  onHotkeyChange: (id: string, hotkey: string) => void;
}

const ExtensionGroup: React.FC<ExtensionGroupProps> = ({
  title,
  subtitle,
  icon,
  isExpanded,
  onToggle,
  items,
  isDisabled,
  getHotkey,
  onToggleEnabled,
  onHotkeyChange,
}) => {
  return (
    <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="w-4 h-4 flex items-center justify-center">{icon}</div>
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-white/90">{title}</div>
          <div className="text-xs text-white/40">{subtitle}</div>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-white/30" />
        ) : (
          <ChevronRight className="w-4 h-4 text-white/30" />
        )}
      </button>

      {isExpanded && (
        <div className="border-t border-white/[0.06]">
          <div className="flex items-center px-4 py-2 text-[11px] uppercase tracking-wider text-white/25 border-b border-white/[0.04] bg-white/[0.01]">
            <div className="w-8 text-center">On</div>
            <div className="w-8"></div>
            <div className="flex-1">Name</div>
            <div className="w-36 text-right">Hotkey</div>
          </div>

          <div className="max-h-[360px] overflow-y-auto custom-scrollbar">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-white/25">
                No matching commands
              </div>
            ) : (
              items.map((cmd) => (
                <div
                  key={cmd.id}
                  className="flex items-center px-4 py-1.5 hover:bg-white/[0.02] border-b border-white/[0.02] last:border-b-0 transition-colors"
                >
                  <div className="w-8 flex justify-center">
                    <input
                      type="checkbox"
                      checked={!isDisabled(cmd.id)}
                      onChange={() => onToggleEnabled(cmd.id)}
                      className="w-3.5 h-3.5 rounded border-white/20 bg-transparent accent-blue-500 cursor-pointer"
                    />
                  </div>

                  <div className="w-8 flex justify-center">
                    <div className="w-5 h-5 flex items-center justify-center overflow-hidden rounded">
                      {cmd.iconDataUrl ? (
                        <img
                          src={cmd.iconDataUrl}
                          alt=""
                          className="w-5 h-5 object-contain"
                          draggable={false}
                        />
                      ) : cmd.category === 'extension' ? (
                        <Puzzle className="w-3.5 h-3.5 text-violet-300/80" />
                      ) : cmd.category === 'system' ? (
                        <Power className="w-3.5 h-3.5 text-red-300/80" />
                      ) : (
                        <Settings className="w-3.5 h-3.5 text-gray-300/70" />
                      )}
                    </div>
                  </div>

                  <div
                    className={`flex-1 text-sm truncate ${
                      isDisabled(cmd.id)
                        ? 'text-white/30 line-through'
                        : 'text-white/80'
                    }`}
                  >
                    {cmd.title}
                  </div>

                  <div className="w-36 flex justify-end">
                    <HotkeyRecorder
                      value={getHotkey(cmd.id)}
                      onChange={(hotkey) => onHotkeyChange(cmd.id, hotkey)}
                      compact
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ExtensionsTab;
