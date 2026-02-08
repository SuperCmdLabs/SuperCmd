/**
 * Settings App
 *
 * Raycast-style settings window with sidebar navigation and tabbed content.
 */

import React, { useEffect, useState } from 'react';
import { Settings, Puzzle, Zap, Brain } from 'lucide-react';
import GeneralTab from './settings/GeneralTab';
import AITab from './settings/AITab';
import ExtensionsTab from './settings/ExtensionsTab';

type Tab = 'general' | 'ai' | 'extensions';

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'general',
    label: 'General',
    icon: <Settings className="w-4 h-4" />,
  },
  {
    id: 'ai',
    label: 'AI',
    icon: <Brain className="w-4 h-4" />,
  },
  {
    id: 'extensions',
    label: 'Extensions',
    icon: <Puzzle className="w-4 h-4" />,
  },
];

function getInitialTab(): Tab {
  try {
    const hash = window.location.hash || '';
    const idx = hash.indexOf('?');
    if (idx === -1) return 'general';
    const params = new URLSearchParams(hash.slice(idx + 1));
    const tab = params.get('tab');
    if (tab === 'ai' || tab === 'extensions' || tab === 'general') return tab;
  } catch {}
  return 'general';
}

const SettingsApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(getInitialTab());

  useEffect(() => {
    (window as any).electron?.onSettingsTabChanged?.((tab: Tab) => {
      if (tab === 'general' || tab === 'ai' || tab === 'extensions') {
        setActiveTab(tab);
      }
    });
  }, []);

  return (
    <div className="h-screen flex glass-effect text-white select-none">
      {/* Sidebar */}
      <div className="w-52 border-r border-white/[0.06] flex flex-col" style={{ background: 'rgba(10,10,14,0.5)' }}>
        {/* Drag region for macOS title bar */}
        <div className="h-12 drag-region" />

        <div className="px-4 mb-6">
          <h1 className="text-sm font-semibold text-white/90 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            SuperCommand
          </h1>
        </div>

        <nav className="px-2 space-y-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                activeTab === tab.id
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:text-white/70 hover:bg-white/[0.04]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Drag region for macOS title bar */}
        <div className="h-12 drag-region flex-shrink-0" />

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'ai' && <AITab />}
          {activeTab === 'extensions' && <ExtensionsTab />}
        </div>
      </div>
    </div>
  );
};

export default SettingsApp;
