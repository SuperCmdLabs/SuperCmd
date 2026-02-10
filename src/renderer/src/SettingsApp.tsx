/**
 * Settings App
 *
 * Compact Raycast-style settings window with horizontal tabs.
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
    <div className="h-screen glass-effect text-white select-none flex flex-col">
      <div className="h-10 drag-region" />
      <div className="px-6 pb-3 border-b border-white/[0.06]">
        <div className="relative flex items-center justify-center">
          <div className="absolute left-0 text-[13px] font-semibold text-white/90 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            SuperCommand Settings
          </div>
          <div className="flex items-center gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white/[0.12] text-white border border-white/[0.14]'
                    : 'text-white/60 border border-white/[0.08] hover:text-white/85 hover:bg-white/[0.05]'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`flex-1 min-h-0 ${activeTab === 'extensions' ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}>
        {activeTab === 'extensions' ? (
          <div className="h-full min-h-0 flex flex-col">
            <ExtensionsTab />
          </div>
        ) : (
          <div className={activeTab === 'ai' ? 'px-6 pt-2 pb-3' : 'p-6'}>
            {activeTab === 'general' && <GeneralTab />}
            {activeTab === 'ai' && <AITab />}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsApp;
