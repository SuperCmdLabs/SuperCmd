/**
 * Extensions Tab
 *
 * Horizontal tabs for command management and store browsing.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Search, Settings, Power, Puzzle, Cpu, Download } from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
import type { CommandInfo, AppSettings } from '../../types/electron';

type SectionTab = 'system' | 'supercommand' | 'community';

const ExtensionsTab: React.FC = () => {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SectionTab>('system');
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
  const filteredSystemAll = [...filteredApps, ...filteredSettings].sort((a, b) =>
    a.title.localeCompare(b.title)
  );
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

      <div className="flex flex-wrap gap-2 mb-6">
        <TabButton
          active={activeTab === 'system'}
          icon={<Settings className="w-3.5 h-3.5" />}
          label="System"
          onClick={() => setActiveTab('system')}
        />
        <TabButton
          active={activeTab === 'supercommand'}
          icon={<Cpu className="w-3.5 h-3.5" />}
          label="SuperCommand"
          onClick={() => setActiveTab('supercommand')}
        />
        <TabButton
          active={activeTab === 'community'}
          icon={<Puzzle className="w-3.5 h-3.5" />}
          label="Community"
          onClick={() => setActiveTab('community')}
        />
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          placeholder={
            activeTab === 'community'
              ? 'Search installed extension commands...'
              : 'Search commands...'
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20 transition-colors"
        />
      </div>

      {activeTab === 'system' && (
        <CommandTable
          items={filteredSystemAll}
          isDisabled={isDisabled}
          getHotkey={getHotkey}
          onToggleEnabled={handleToggleEnabled}
          onHotkeyChange={handleHotkeyChange}
          emptyText="No matching system commands"
        />
      )}

      {activeTab === 'supercommand' && (
        <div className="space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-white/30 mb-2">
              Core Commands
            </div>
            <CommandTable
              items={filteredSystem}
              isDisabled={isDisabled}
              getHotkey={getHotkey}
              onToggleEnabled={handleToggleEnabled}
              onHotkeyChange={handleHotkeyChange}
              emptyText="No matching SuperCommand commands"
            />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-white/30 mb-2">
              Installed Extension Commands
            </div>
            <CommandTable
              items={filteredExtensions}
              isDisabled={isDisabled}
              getHotkey={getHotkey}
              onToggleEnabled={handleToggleEnabled}
              onHotkeyChange={handleHotkeyChange}
              emptyText="No matching extension commands"
            />
          </div>
        </div>
      )}

      {activeTab === 'community' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-white/30">
              Installed Extension Commands
            </div>
            <button
              onClick={() => window.electron.openExtensionStoreWindow()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Install from Store
            </button>
          </div>
          <CommandTable
            items={filteredExtensions}
            isDisabled={isDisabled}
            getHotkey={getHotkey}
            onToggleEnabled={handleToggleEnabled}
            onHotkeyChange={handleHotkeyChange}
            emptyText="No installed extension commands"
          />
        </div>
      )}
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ active, icon, label, onClick }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
      active
        ? 'bg-white/[0.12] text-white border border-white/[0.16]'
        : 'bg-white/[0.04] text-white/70 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white/90'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

interface CommandTableProps {
  items: CommandInfo[];
  isDisabled: (id: string) => boolean;
  getHotkey: (id: string) => string;
  onToggleEnabled: (id: string) => void;
  onHotkeyChange: (id: string, hotkey: string) => void;
  emptyText: string;
}

const CommandTable: React.FC<CommandTableProps> = ({
  items,
  isDisabled,
  getHotkey,
  onToggleEnabled,
  onHotkeyChange,
  emptyText,
}) => {
  return (
    <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
      <div className="flex items-center px-4 py-2 text-[11px] uppercase tracking-wider text-white/25 border-b border-white/[0.04] bg-white/[0.01]">
        <div className="w-8 text-center">On</div>
        <div className="w-8"></div>
        <div className="flex-1">Name</div>
        <div className="w-36 text-right">Hotkey</div>
      </div>

      <div className="max-h-[460px] overflow-y-auto custom-scrollbar">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-white/25">
            {emptyText}
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
                  isDisabled(cmd.id) ? 'text-white/30 line-through' : 'text-white/80'
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
  );
};

export default ExtensionsTab;
