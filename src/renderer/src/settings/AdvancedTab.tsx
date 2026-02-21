import React, { useEffect, useMemo, useState } from 'react';
import { Palette, Bug, Brain, Shield, Sparkles, Wrench } from 'lucide-react';
import type { AppSettings, AgentSettings } from '../../types/electron';
import { applyBaseColor, normalizeBaseColorHex } from '../utils/base-color';

type SettingsRowProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  withBorder?: boolean;
  children: React.ReactNode;
};

const SettingsRow: React.FC<SettingsRowProps> = ({
  icon,
  title,
  description,
  withBorder = true,
  children,
}) => (
  <div
    className={`grid gap-3 px-4 py-3.5 md:px-5 md:grid-cols-[220px_minmax(0,1fr)] ${
      withBorder ? 'border-b border-white/[0.08]' : ''
    }`}
  >
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 text-white/65 shrink-0">{icon}</div>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-white/95">{title}</h3>
        <p className="mt-0.5 text-[12px] text-white/50 leading-snug">{description}</p>
      </div>
    </div>
    <div className="flex items-center min-h-[32px]">{children}</div>
  </div>
);

const SKILL_OPTIONS = [
  { id: 'organize', label: 'Organize Files' },
  { id: 'cleanup', label: 'Cleanup Tasks' },
  { id: 'coding', label: 'Code Workflows' },
  { id: 'research', label: 'Research Assistant' },
  { id: 'automation', label: 'Automation Flows' },
];

const TOOL_CATEGORY_OPTIONS = [
  { id: 'filesystem', label: 'Filesystem' },
  { id: 'shell', label: 'Shell' },
  { id: 'applescript', label: 'AppleScript' },
  { id: 'clipboard', label: 'Clipboard' },
  { id: 'http', label: 'HTTP' },
  { id: 'app_control', label: 'App Control' },
  { id: 'memory', label: 'Memory' },
];

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)));
}

const AdvancedTab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    window.electron.getSettings().then((next) => {
      setSettings(next);
      applyBaseColor(next.baseColor || '#101113');
    });
  }, []);

  const updateAgent = async (patch: Partial<AgentSettings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return { ...prev, agent: { ...prev.agent, ...patch } };
    });
    const current = settings;
    if (!current) return;
    const updated = await window.electron.saveSettings({
      agent: { ...current.agent, ...patch },
    } as any);
    setSettings(updated);
  };

  const handleBaseColorPreview = (value: string) => {
    const normalized = normalizeBaseColorHex(value);
    setSettings((prev) => (prev ? { ...prev, baseColor: normalized } : prev));
    applyBaseColor(normalized);
  };

  const handleBaseColorCommit = async (value: string) => {
    const normalized = normalizeBaseColorHex(value);
    handleBaseColorPreview(normalized);
    const updated = await window.electron.saveSettings({ baseColor: normalized });
    setSettings(updated);
  };

  const customSkillsText = useMemo(() => {
    if (!settings?.agent.customSkills?.length) return '';
    return settings.agent.customSkills.join('\n');
  }, [settings?.agent.customSkills]);

  if (!settings) {
    return <div className="p-6 text-white/50 text-[12px]">Loading advanced settings...</div>;
  }

  const agent = settings.agent;

  return (
    <div className="w-full max-w-[980px] mx-auto space-y-3">
      <h2 className="text-[15px] font-semibold text-white">Advanced</h2>

      <div className="overflow-hidden rounded-xl border border-white/[0.10] bg-[rgba(20,20,20,0.34)]">
        <SettingsRow
          icon={<Brain className="w-4 h-4" />}
          title="Agent Mode"
          description="Enable autonomous agent behavior in SuperCmd."
        >
          <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
            <input
              type="checkbox"
              checked={agent.enabled ?? true}
              onChange={(e) => { void updateAgent({ enabled: e.target.checked }); }}
              className="w-4 h-4 rounded accent-cyan-400"
            />
            Enable agent mode
          </label>
        </SettingsRow>

        <SettingsRow
          icon={<Shield className="w-4 h-4" />}
          title="Access Level"
          description="Safe = guarded. Power = confirmations for dangerous actions. Ultimate = minimal interruptions (not OS root)."
        >
          <select
            value={agent.accessLevel || 'power'}
            onChange={(e) => { void updateAgent({ accessLevel: e.target.value as AgentSettings['accessLevel'] }); }}
            className="w-full max-w-[360px] bg-white/[0.04] border border-white/[0.12] rounded-lg px-3 py-2.5 text-sm text-white/92 outline-none"
          >
            <option value="safe">Safe</option>
            <option value="power">Power</option>
            <option value="ultimate">Ultimate</option>
          </select>
        </SettingsRow>

        <SettingsRow
          icon={<Sparkles className="w-4 h-4" />}
          title="Personality + Soul"
          description="Define style and long-lived behavior identity for the agent."
        >
          <div className="w-full space-y-2">
            <select
              value={agent.personalityPreset || 'balanced'}
              onChange={(e) => { void updateAgent({ personalityPreset: e.target.value as AgentSettings['personalityPreset'] }); }}
              className="w-full max-w-[360px] bg-white/[0.04] border border-white/[0.12] rounded-lg px-3 py-2.5 text-sm text-white/92 outline-none"
            >
              <option value="balanced">Balanced</option>
              <option value="operator">Operator</option>
              <option value="builder">Builder</option>
              <option value="analyst">Analyst</option>
            </select>
            <textarea
              value={agent.soulPrompt || ''}
              onChange={(e) => { void updateAgent({ soulPrompt: e.target.value }); }}
              placeholder="Soul prompt (example: calm, precise, never verbose, always proposes safe rollback first)"
              rows={2}
              className="w-full bg-white/[0.04] border border-white/[0.12] rounded-lg px-3 py-2 text-sm text-white/92 outline-none resize-y"
            />
            <textarea
              value={agent.personalityPrompt || ''}
              onChange={(e) => { void updateAgent({ personalityPrompt: e.target.value }); }}
              placeholder="Additional system behavior instructions"
              rows={3}
              className="w-full bg-white/[0.04] border border-white/[0.12] rounded-lg px-3 py-2 text-sm text-white/92 outline-none resize-y"
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Wrench className="w-4 h-4" />}
          title="Skills"
          description="Select default skill packs and add your own custom skills."
        >
          <div className="w-full space-y-2">
            <div className="grid grid-cols-2 gap-2 max-w-[560px]">
              {SKILL_OPTIONS.map((skill) => {
                const checked = (agent.enabledSkills || []).includes(skill.id);
                return (
                  <label key={skill.id} className="inline-flex items-center gap-2 text-[12px] text-white/85 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const current = new Set(agent.enabledSkills || []);
                        if (e.target.checked) current.add(skill.id);
                        else current.delete(skill.id);
                        void updateAgent({ enabledSkills: Array.from(current) });
                      }}
                      className="w-4 h-4 rounded accent-cyan-400"
                    />
                    {skill.label}
                  </label>
                );
              })}
            </div>
            <textarea
              value={customSkillsText}
              onChange={(e) => {
                const list = uniqueList(e.target.value.split('\n'));
                void updateAgent({ customSkills: list });
              }}
              placeholder="Custom skills (one per line)"
              rows={3}
              className="w-full bg-white/[0.04] border border-white/[0.12] rounded-lg px-3 py-2 text-sm text-white/92 outline-none resize-y"
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Brain className="w-4 h-4" />}
          title="Adaptive Learning"
          description="Learn user preferences over time and adapt style automatically."
        >
          <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
            <input
              type="checkbox"
              checked={agent.adaptiveLearning !== false}
              onChange={(e) => { void updateAgent({ adaptiveLearning: e.target.checked }); }}
              className="w-4 h-4 rounded accent-cyan-400"
            />
            Learn from user style and preferences
          </label>
        </SettingsRow>

        <SettingsRow
          icon={<Shield className="w-4 h-4" />}
          title="Reliability"
          description="Keep runs stable and reduce user-facing errors."
        >
          <div className="w-full space-y-2">
            <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
              <input
                type="checkbox"
                checked={agent.autoRecover !== false}
                onChange={(e) => { void updateAgent({ autoRecover: e.target.checked }); }}
                className="w-4 h-4 rounded accent-cyan-400"
              />
              Auto-recover on transient failures
            </label>
            <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
              <input
                type="checkbox"
                checked={agent.autoSelectBestModel !== false}
                onChange={(e) => { void updateAgent({ autoSelectBestModel: e.target.checked }); }}
                className="w-4 h-4 rounded accent-cyan-400"
              />
              Auto-select strongest model for agent runs
            </label>
            <div className="flex items-center gap-2 max-w-[360px]">
              <span className="text-[12px] text-white/60">Max steps</span>
              <input
                type="range"
                min={5}
                max={80}
                value={agent.maxSteps || 15}
                onChange={(e) => { void updateAgent({ maxSteps: Number(e.target.value) }); }}
                className="flex-1"
              />
              <span className="text-[12px] text-white/80 w-8 text-right">{agent.maxSteps || 15}</span>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Wrench className="w-4 h-4" />}
          title="Tool Access"
          description="Select which capabilities the agent can use."
        >
          <div className="grid grid-cols-2 gap-2 max-w-[560px]">
            {TOOL_CATEGORY_OPTIONS.map((opt) => {
              const checked = (agent.enabledToolCategories || []).includes(opt.id);
              return (
                <label key={opt.id} className="inline-flex items-center gap-2 text-[12px] text-white/85 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = new Set(agent.enabledToolCategories || []);
                      if (e.target.checked) next.add(opt.id);
                      else next.delete(opt.id);
                      void updateAgent({ enabledToolCategories: Array.from(next) });
                    }}
                    className="w-4 h-4 rounded accent-cyan-400"
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Bug className="w-4 h-4" />}
          title="Debug Mode"
          description="Show detailed logs when extensions fail to load or build."
        >
          <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.debugMode ?? false}
              onChange={async (e) => {
                const debugMode = e.target.checked;
                setSettings((prev) => (prev ? { ...prev, debugMode } : prev));
                await window.electron.saveSettings({ debugMode });
              }}
              className="w-4 h-4 rounded accent-cyan-400"
            />
            Enable debug mode
          </label>
        </SettingsRow>

        <SettingsRow
          icon={<Palette className="w-4 h-4" />}
          title="Base Color"
          description="Changes only the core glass base color. Preview updates live while you drag."
          withBorder={false}
        >
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={normalizeBaseColorHex(settings.baseColor || '#101113')}
              onInput={(e) => handleBaseColorPreview((e.target as HTMLInputElement).value)}
              onChange={(e) => { void handleBaseColorCommit((e.target as HTMLInputElement).value); }}
              className="w-12 h-8 rounded border border-white/[0.14] bg-transparent cursor-pointer"
            />
            <input
              type="text"
              value={normalizeBaseColorHex(settings.baseColor || '#101113')}
              onChange={(e) => handleBaseColorPreview(e.target.value)}
              onBlur={(e) => { void handleBaseColorCommit(e.target.value); }}
              className="w-28 bg-white/[0.05] border border-white/[0.10] rounded-md px-2.5 py-1.5 text-xs text-white/90 outline-none"
            />
          </div>
        </SettingsRow>
      </div>
    </div>
  );
};

export default AdvancedTab;
