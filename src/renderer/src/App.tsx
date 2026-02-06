/**
 * Launcher App
 * 
 * Dynamically displays all applications and System Settings.
 * Shows category labels like Raycast.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Power, Settings, Puzzle } from 'lucide-react';
import type { CommandInfo, ExtensionBundle } from '../types/electron';
import ExtensionView from './ExtensionView';

/**
 * Filter and sort commands based on search query
 */
function filterCommands(commands: CommandInfo[], query: string): CommandInfo[] {
  if (!query.trim()) {
    return commands;
  }

  const lowerQuery = query.toLowerCase().trim();

  const scored = commands
    .map((cmd) => {
      const lowerTitle = cmd.title.toLowerCase();
      const keywords = cmd.keywords?.map((k) => k.toLowerCase()) || [];

      let score = 0;

      // Exact match
      if (lowerTitle === lowerQuery) {
        score = 200;
      }
      // Title starts with query
      else if (lowerTitle.startsWith(lowerQuery)) {
        score = 100;
      }
      // Title includes query
      else if (lowerTitle.includes(lowerQuery)) {
        score = 75;
      }
      // Keywords start with query
      else if (keywords.some((k) => k.startsWith(lowerQuery))) {
        score = 50;
      }
      // Keywords include query
      else if (keywords.some((k) => k.includes(lowerQuery))) {
        score = 25;
      }

      return { cmd, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ cmd }) => cmd);
}

/**
 * Get category display label
 */
function getCategoryLabel(category: string): string {
  switch (category) {
    case 'settings':
      return 'System Settings';
    case 'system':
      return 'System';
    case 'extension':
      return 'Extension';
    case 'app':
    default:
      return 'Application';
  }
}

const App: React.FC = () => {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [extensionView, setExtensionView] = useState<ExtensionBundle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const fetchCommands = useCallback(async () => {
    setIsLoading(true);
    const fetchedCommands = await window.electron.getCommands();
    setCommands(fetchedCommands);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchCommands();

    window.electron.onWindowShown(() => {
      setSearchQuery('');
      setSelectedIndex(0);
      setExtensionView(null);
      // Re-fetch commands every time the window is shown
      // so newly installed extensions appear immediately
      fetchCommands();
      inputRef.current?.focus();
    });
  }, [fetchCommands]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filteredCommands = filterCommands(commands, searchQuery);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, filteredCommands.length);
  }, [filteredCommands.length]);

  const scrollToSelected = useCallback(() => {
    const selectedElement = itemRefs.current[selectedIndex];
    const scrollContainer = listRef.current;

    if (selectedElement && scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elementRect = selectedElement.getBoundingClientRect();

      if (elementRect.top < containerRect.top) {
        selectedElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (elementRect.bottom > containerRect.bottom) {
        selectedElement.scrollIntoView({ block: 'end', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  useEffect(() => {
    scrollToSelected();
  }, [selectedIndex, scrollToSelected]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : prev
          );
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;

        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            handleCommandExecute(filteredCommands[selectedIndex]);
          }
          break;

        case 'Escape':
          e.preventDefault();
          setSearchQuery('');
          setSelectedIndex(0);
          window.electron.hideWindow();
          break;
      }
    },
    [filteredCommands, selectedIndex]
  );

  const handleCommandExecute = async (command: CommandInfo) => {
    try {
      if (command.category === 'extension' && command.path) {
        // Extension command — build and show extension view
        const [extName, cmdName] = command.path.split('/');
        const result = await window.electron.runExtension(extName, cmdName);
        if (result && result.code) {
          setExtensionView(result);
          return;
        }
        const errMsg = result?.error || 'Failed to build extension';
        console.error('Extension load failed:', errMsg);
        // Show the error in the extension view
        setExtensionView({
          code: '',
          title: command.title,
          mode: 'view',
          extName,
          cmdName,
          error: errMsg,
        } as any);
        return;
      }

      await window.electron.executeCommand(command.id);
      setSearchQuery('');
      setSelectedIndex(0);
    } catch (error) {
      console.error('Failed to execute command:', error);
    }
  };

  // ─── Extension view mode ──────────────────────────────────────────
  if (extensionView) {
    return (
      <div className="w-full h-full">
        <div className="glass-effect rounded-2xl shadow-2xl overflow-hidden h-full flex flex-col">
          <ExtensionView
            code={extensionView.code}
            title={extensionView.title}
            mode={extensionView.mode}
            error={(extensionView as any).error}
            onClose={() => {
              setExtensionView(null);
              setSearchQuery('');
              setSelectedIndex(0);
              setTimeout(() => inputRef.current?.focus(), 50);
            }}
          />
        </div>
      </div>
    );
  }

  // ─── Launcher mode ──────────────────────────────────────────────
  return (
    <div className="w-full h-full">
      <div className="glass-effect rounded-2xl shadow-2xl overflow-hidden h-full flex flex-col">
        {/* Search header — Raycast-style, no box */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
          <Search className="text-white/30 w-5 h-5 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search apps and settings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-base font-light tracking-wide"
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto custom-scrollbar p-1.5 list-area"
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Discovering apps...</p>
            </div>
          ) : filteredCommands.length === 0 ? (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">No matching results</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredCommands.map((command, index) => (
                <div
                  key={command.id}
                  ref={(el) => (itemRefs.current[index] = el)}
                  className={`command-item px-3 py-1.5 rounded-lg cursor-pointer ${
                    index === selectedIndex ? 'selected' : ''
                  }`}
                  onClick={() => handleCommandExecute(command)}
                  onMouseMove={() => setSelectedIndex(index)}
                >
                  <div className="flex items-center gap-2.5">
                    {/* Icon */}
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {command.iconDataUrl ? (
                        <img
                          src={command.iconDataUrl}
                          alt=""
                          className="w-5 h-5 object-contain"
                          draggable={false}
                        />
                      ) : command.category === 'system' ? (
                        <div className="w-5 h-5 rounded bg-red-500/20 flex items-center justify-center">
                          <Power className="w-3 h-3 text-red-400" />
                        </div>
                      ) : command.category === 'extension' ? (
                        <div className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">
                          <Puzzle className="w-3 h-3 text-purple-400" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded bg-gray-500/20 flex items-center justify-center">
                          <Settings className="w-3 h-3 text-gray-400" />
                        </div>
                      )}
                    </div>
                    
                    {/* Title */}
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm truncate">
                        {command.title}
                      </div>
                    </div>
                    
                    {/* Category label */}
                    <div className="text-white/30 text-xs flex-shrink-0">
                      {getCategoryLabel(command.category)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Footer with count */}
        {!isLoading && (
          <div className="px-3 py-1.5 border-t border-white/5 text-white/25 text-[11px]">
            {filteredCommands.length} results
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
