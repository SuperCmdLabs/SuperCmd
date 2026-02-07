/**
 * Extensions Tab
 *
 * Lists all core extensions (Applications, System Settings) in expandable
 * groups with a table view. Each item has a checkbox (enable/disable) and
 * a hotkey recorder column. Includes search.
 *
 * Also shows a "Community Extensions" placeholder.
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
} from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
import type { CommandInfo, AppSettings } from '../../types/electron';

const ExtensionsTab: React.FC = () => {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set()
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

  const filterItems = (items: CommandInfo[]) => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.keywords?.some((k) => k.toLowerCase().includes(q))
    );
  };

  const filteredApps = filterItems(appCommands);
  const filteredSettings = filterItems(settingsCommands);

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
    return (
      <div className="p-8 text-white/50 text-sm">
        Loading extensions...
      </div>
    );
  }

  return (
    <div className="p-8">
      <h2 className="text-xl font-semibold text-white mb-6">Extensions</h2>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          placeholder="Search extensions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20 transition-colors"
        />
      </div>

      {/* Core Extensions */}
      <div className="mb-8">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/35 mb-3 flex items-center gap-2">
          <Package className="w-3.5 h-3.5" />
          Core Extensions
        </h3>

        <div className="space-y-2">
          {/* Applications Group */}
          <ExtensionGroup
            title="Applications"
            subtitle={`${appCommands.length} apps`}
            icon="🖥"
            isExpanded={expandedGroups.has('apps')}
            onToggle={() => toggleGroup('apps')}
            items={filteredApps}
            isDisabled={isDisabled}
            getHotkey={getHotkey}
            onToggleEnabled={handleToggleEnabled}
            onHotkeyChange={handleHotkeyChange}
          />

          {/* System Settings Group */}
          <ExtensionGroup
            title="System Settings"
            subtitle={`${settingsCommands.length} actions`}
            icon="⚙️"
            isExpanded={expandedGroups.has('settings')}
            onToggle={() => toggleGroup('settings')}
            items={filteredSettings}
            isDisabled={isDisabled}
            getHotkey={getHotkey}
            onToggleEnabled={handleToggleEnabled}
            onHotkeyChange={handleHotkeyChange}
          />
        </div>
      </div>

      {/* Community Extensions */}
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/35 mb-3 flex items-center gap-2">
          <Puzzle className="w-3.5 h-3.5" />
          Community Extensions
        </h3>
        <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-10 text-center">
          <Puzzle className="w-8 h-8 text-white/15 mx-auto mb-3" />
          <p className="text-sm text-white/40">Coming soon</p>
          <p className="text-xs text-white/25 mt-1">
            Community extensions will be available in a future update.
          </p>
        </div>
      </div>
    </div>
  );
};

// ─── Extension Group Component ──────────────────────────────────────

interface ExtensionGroupProps {
  title: string;
  subtitle: string;
  icon: string;
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
      {/* Group header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-base">{icon}</span>
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

      {/* Expanded table */}
      {isExpanded && (
        <div className="border-t border-white/[0.06]">
          {/* Table header */}
          <div className="flex items-center px-4 py-2 text-[11px] uppercase tracking-wider text-white/25 border-b border-white/[0.04] bg-white/[0.01]">
            <div className="w-8 text-center">On</div>
            <div className="w-8"></div>
            <div className="flex-1">Name</div>
            <div className="w-36 text-right">Hotkey</div>
          </div>

          {/* Table body */}
          <div className="max-h-[360px] overflow-y-auto custom-scrollbar">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-white/25">
                No matching extensions
              </div>
            ) : (
              items.map((cmd) => (
                <div
                  key={cmd.id}
                  className="flex items-center px-4 py-1.5 hover:bg-white/[0.02] border-b border-white/[0.02] last:border-b-0 transition-colors"
                >
                  {/* Checkbox */}
                  <div className="w-8 flex justify-center">
                    <input
                      type="checkbox"
                      checked={!isDisabled(cmd.id)}
                      onChange={() => onToggleEnabled(cmd.id)}
                      className="w-3.5 h-3.5 rounded border-white/20 bg-transparent accent-blue-500 cursor-pointer"
                    />
                  </div>

                  {/* Icon */}
                  <div className="w-8 flex justify-center">
                    <div className="w-5 h-5 flex items-center justify-center overflow-hidden">
                      {cmd.iconDataUrl ? (
                        <img
                          src={cmd.iconDataUrl}
                          alt=""
                          className="w-5 h-5 object-contain"
                          draggable={false}
                        />
                      ) : cmd.category === 'system' ? (
                        <Power className="w-3 h-3 text-red-400" />
                      ) : (
                        <Settings className="w-3 h-3 text-gray-400" />
                      )}
                    </div>
                  </div>

                  {/* Name */}
                  <div
                    className={`flex-1 text-sm truncate ${
                      isDisabled(cmd.id)
                        ? 'text-white/30 line-through'
                        : 'text-white/80'
                    }`}
                  >
                    {cmd.title}
                  </div>

                  {/* Hotkey */}
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



