/**
 * Settings App
 *
 * Compact Raycast-style settings window with horizontal tabs.
 */

import React, { useEffect, useState } from 'react';
import { Settings, Puzzle, Brain, SlidersHorizontal } from 'lucide-react';
import supercmdLogo from '../../../supercmd.svg';
import GeneralTab from './settings/GeneralTab';
import AITab from './settings/AITab';
import ExtensionsTab from './settings/ExtensionsTab';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';
import { applyBaseColor } from './utils/base-color';
import { applyUiStyle } from './utils/ui-style';
import AdvancedTab from './settings/AdvancedTab';

type Tab = 'general' | 'ai' | 'extensions' | 'advanced';
type SettingsTarget = { extensionName?: string; commandName?: string };
type SettingsNavigationPayload = { tab: Tab; target?: SettingsTarget };

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
  {
    id: 'advanced',
    label: 'Advanced',
    icon: <SlidersHorizontal className="w-4 h-4" />,
  },
];

function normalizeTab(input: any): Tab | undefined {
  if (input === 'general' || input === 'ai' || input === 'extensions' || input === 'advanced') return input;
  return undefined;
}

function normalizeSettingsTarget(input: any): SettingsTarget | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const extensionName = typeof input.extensionName === 'string' ? input.extensionName.trim() : '';
  const commandName = typeof input.commandName === 'string' ? input.commandName.trim() : '';
  if (!extensionName && !commandName) return undefined;
  return {
    ...(extensionName ? { extensionName } : {}),
    ...(commandName ? { commandName } : {}),
  };
}

function normalizeSettingsPayload(input: any): SettingsNavigationPayload | undefined {
  if (typeof input === 'string') {
    const tab = normalizeTab(input);
    return tab ? { tab } : undefined;
  }
  if (input && typeof input === 'object') {
    const tab = normalizeTab(input.tab);
    if (!tab) return undefined;
    return {
      tab,
      target: normalizeSettingsTarget(input.target),
    };
  }
  return undefined;
}

function getInitialRoute(): SettingsNavigationPayload {
  try {
    const hash = window.location.hash || '';
    const idx = hash.indexOf('?');
    if (idx === -1) return { tab: 'general' };
    const params = new URLSearchParams(hash.slice(idx + 1));
    const tab = normalizeTab(params.get('tab'));
    const extensionName = (params.get('extension') || '').trim();
    const commandName = (params.get('command') || '').trim();
    const target = normalizeSettingsTarget({ extensionName, commandName });
    if (tab) return { tab, target };
  } catch {}
  return { tab: 'general' };
}

const SettingsApp: React.FC = () => {
  const initialRoute = getInitialRoute();
  const [activeTab, setActiveTab] = useState<Tab>(initialRoute.tab);
  const [extensionFocusTarget, setExtensionFocusTarget] = useState<SettingsTarget | null>(
    initialRoute.target || null
  );

  useEffect(() => {
    (window as any).electron?.onSettingsTabChanged?.((rawPayload: any) => {
      const payload = normalizeSettingsPayload(rawPayload);
      if (!payload) return;
      setActiveTab(payload.tab);
      if (payload.tab === 'extensions') {
        setExtensionFocusTarget(payload.target || null);
      }
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    window.electron.getSettings()
      .then((settings) => {
        if (!disposed) {
          applyAppFontSize(settings.fontSize);
          applyUiStyle(settings.uiStyle || 'default');
          applyBaseColor(settings.baseColor || '#101113');
        }
      })
      .catch(() => {
        if (!disposed) {
          applyAppFontSize(getDefaultAppFontSize());
          applyUiStyle('default');
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((settings) => {
      applyAppFontSize(settings.fontSize);
      applyUiStyle(settings.uiStyle || 'default');
      applyBaseColor(settings.baseColor || '#101113');
    });
    return cleanup;
  }, []);

  return (
    <div className="h-screen glass-effect text-white select-none flex flex-col">
      <div className="h-10 drag-region" />
      <div className="px-5 pb-2.5 border-b border-[var(--ui-divider)]">
        <div className="relative flex items-center justify-center">
          <div className="absolute left-0 text-[12px] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
            <img src={supercmdLogo} alt="" className="w-3.5 h-3.5 object-contain" draggable={false} />
            SuperCmd Settings
          </div>
          <div className="inline-flex items-stretch overflow-hidden rounded-md border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)]">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] transition-colors ${
                  tab.id !== tabs[0].id ? 'border-l border-[var(--ui-divider)]' : ''
                } ${
                  activeTab === tab.id
                    ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)]'
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
            <ExtensionsTab
              focusTarget={extensionFocusTarget}
              onFocusTargetHandled={() => setExtensionFocusTarget(null)}
            />
          </div>
        ) : (
          <div className="p-5">
            {activeTab === 'general' && <GeneralTab />}
            {activeTab === 'ai' && <AITab />}
            {activeTab === 'advanced' && <AdvancedTab />}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsApp;
