import React, { useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ExternalLink,
  Keyboard,
  Lock,
  Search,
  Shield,
  Sparkles,
  Workflow,
} from 'lucide-react';
import HotkeyRecorder from './settings/HotkeyRecorder';

interface OnboardingExtensionProps {
  initialShortcut: string;
  requireWorkingShortcut?: boolean;
  onComplete: () => void;
  onClose: () => void;
}

const permissionTargets = [
  {
    id: 'accessibility',
    title: 'Accessibility',
    description: 'Needed for reliable paste and keyboard automation in other apps.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    icon: Accessibility,
    iconTone: 'text-sky-300/85',
    iconBg: 'bg-sky-500/15 border-sky-300/20',
  },
  {
    id: 'automation',
    title: 'Automation',
    description: 'Lets SuperCmd control System Events for command execution.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
    icon: Bot,
    iconTone: 'text-violet-300/85',
    iconBg: 'bg-violet-500/15 border-violet-300/20',
  },
  {
    id: 'privacy',
    title: 'Privacy & Security',
    description: 'Open the full permissions pane to review and approve access.',
    url: 'x-apple.systempreferences:com.apple.preference.security',
    icon: Lock,
    iconTone: 'text-emerald-300/85',
    iconBg: 'bg-emerald-500/15 border-emerald-300/20',
  },
];

const OnboardingExtension: React.FC<OnboardingExtensionProps> = ({
  initialShortcut,
  requireWorkingShortcut = false,
  onComplete,
  onClose,
}) => {
  const [step, setStep] = useState(0);
  const [shortcut, setShortcut] = useState(initialShortcut);
  const [shortcutStatus, setShortcutStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hasValidShortcut, setHasValidShortcut] = useState(!requireWorkingShortcut);
  const [openedPermissions, setOpenedPermissions] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setHasValidShortcut(!requireWorkingShortcut);
  }, [requireWorkingShortcut]);

  const stepTitle = useMemo(() => {
    if (step === 0) return 'Welcome to SuperCmd';
    if (step === 1) return 'Set Your Hotkey';
    return 'Grant Required Permissions';
  }, [step]);

  const handleShortcutChange = async (nextShortcut: string) => {
    setShortcutStatus('idle');
    setShortcut(nextShortcut);
    if (!nextShortcut) return;
    const ok = await window.electron.updateGlobalShortcut(nextShortcut);
    if (ok) {
      setHasValidShortcut(true);
      setShortcutStatus('success');
      setTimeout(() => setShortcutStatus('idle'), 1800);
      return;
    }
    setHasValidShortcut(false);
    setShortcutStatus('error');
    setTimeout(() => setShortcutStatus('idle'), 2500);
  };

  const canCompleteOnboarding = !requireWorkingShortcut || hasValidShortcut;

  const openPermissionTarget = async (id: string, url: string) => {
    const ok = await window.electron.openUrl(url);
    if (ok) {
      setOpenedPermissions((prev) => ({ ...prev, [id]: true }));
    }
  };

  return (
    <div className="w-full h-full">
      <div className="glass-effect overflow-hidden h-full flex flex-col">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06]">
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/70 transition-colors p-0.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-white/90 text-[15px] font-medium truncate">{stepTitle}</div>
            <div className="text-white/35 text-xs">Step {step + 1} of 3</div>
          </div>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all ${idx <= step ? 'w-6 bg-white/70' : 'w-3 bg-white/20'}`}
              />
            ))}
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto p-6"
          style={{
            background:
              'radial-gradient(circle at 15% 8%, rgba(77, 196, 255, 0.12), transparent 42%), radial-gradient(circle at 84% 0%, rgba(143, 255, 188, 0.10), transparent 38%), radial-gradient(circle at 50% 100%, rgba(128, 112, 255, 0.08), transparent 36%), transparent',
          }}
        >
          {step === 0 && (
            <div className="space-y-5 max-w-5xl mx-auto">
              <div
                className="rounded-2xl border border-white/[0.10] p-6"
                style={{
                  background:
                    'radial-gradient(circle at 20% 10%, rgba(69,200,255,0.18), transparent 45%), radial-gradient(circle at 80% 0%, rgba(132,255,167,0.12), transparent 40%), rgba(255,255,255,0.03)',
                }}
              >
                <div className="w-11 h-11 rounded-xl bg-white/[0.08] border border-white/[0.14] flex items-center justify-center mb-4">
                  <Sparkles className="w-5 h-5 text-cyan-300/90" />
                </div>
                <p className="text-white/90 text-lg font-semibold mb-2">Fast command launcher for your Mac</p>
                <p className="text-white/55 text-sm leading-relaxed">
                  Search apps, run system actions, launch extensions, manage clipboard history, and trigger snippets
                  without leaving your keyboard.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                  <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-300/20 flex items-center justify-center mb-2">
                    <Search className="w-4 h-4 text-cyan-300/85" />
                  </div>
                  <p className="text-white/85 text-sm font-medium mb-1">Universal Search</p>
                  <p className="text-white/45 text-xs">Apps, settings, commands, and community extensions in one place.</p>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                  <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-300/20 flex items-center justify-center mb-2">
                    <Workflow className="w-4 h-4 text-violet-300/85" />
                  </div>
                  <p className="text-white/85 text-sm font-medium mb-1">Extension Runtime</p>
                  <p className="text-white/45 text-xs">Run Raycast extensions with native actions, arguments, and commands.</p>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-300/20 flex items-center justify-center mb-2">
                    <Sparkles className="w-4 h-4 text-emerald-300/85" />
                  </div>
                  <p className="text-white/85 text-sm font-medium mb-1">Power Workflows</p>
                  <p className="text-white/45 text-xs">Clipboard history, snippets, and AI all available instantly.</p>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-2xl space-y-5">
                <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
                  <div
                    className="absolute inset-0 pointer-events-none rounded-xl"
                    style={{
                      background:
                        'radial-gradient(circle at 10% 0%, rgba(77, 196, 255, 0.09), transparent 40%), radial-gradient(circle at 100% 10%, rgba(143, 255, 188, 0.07), transparent 36%)',
                    }}
                  />
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2">
                      <Keyboard className="w-4 h-4 text-white/55" />
                      <p className="text-white/85 text-sm font-medium">Launcher Hotkey</p>
                    </div>
                    <p className="text-white/45 text-xs mb-4">
                      Choose a global shortcut to open SuperCmd from anywhere.
                    </p>
                    <div className="flex items-center gap-3">
                      <HotkeyRecorder value={shortcut} onChange={handleShortcutChange} />
                      {shortcutStatus === 'success' ? <span className="text-xs text-green-400">Updated</span> : null}
                      {shortcutStatus === 'error' ? <span className="text-xs text-red-400">Shortcut unavailable</span> : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-cyan-300/80" />
                  <p className="text-white/75 text-sm">Set this once, then launch instantly from any app.</p>
                </div>
                <p className="text-xs text-white/35">
                  You can change this anytime from SuperCmd Settings.
                </p>
                {requireWorkingShortcut && !hasValidShortcut ? (
                  <p className="text-xs text-amber-300/85">
                    Your current launcher shortcut is unavailable. Set a working shortcut to continue.
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-5xl space-y-4">
                <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
                  <div
                    className="absolute inset-0 pointer-events-none rounded-xl"
                    style={{
                      background:
                        'radial-gradient(circle at 12% 0%, rgba(143, 255, 188, 0.09), transparent 36%), radial-gradient(circle at 96% 8%, rgba(77, 196, 255, 0.08), transparent 34%)',
                    }}
                  />
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-4 h-4 text-white/55" />
                      <p className="text-white/85 text-sm font-medium">Permissions</p>
                    </div>
                    <p className="text-white/45 text-xs">
                      Grant macOS permissions so paste actions and app automation work consistently.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {permissionTargets.map((target) => {
                    const Icon = target.icon;
                    return (
                      <div key={target.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${target.iconBg}`}>
                            <Icon className={`w-4 h-4 ${target.iconTone}`} />
                          </div>
                          {openedPermissions[target.id] ? <Check className="w-4 h-4 text-green-400" /> : null}
                        </div>
                        <p className="text-white/85 text-sm font-medium mb-1">{target.title}</p>
                        <p className="text-white/45 text-xs leading-relaxed mb-4">{target.description}</p>
                        <button
                          onClick={() => openPermissionTarget(target.id, target.url)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.09] hover:bg-white/[0.14] text-white/85 text-xs transition-colors"
                        >
                          Open
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3.5 border-t border-white/[0.06] flex items-center justify-between" style={{ background: 'rgba(28,28,32,0.90)' }}>
          <button
            onClick={() => {
              if (step === 0) {
                if (canCompleteOnboarding) onComplete();
                return;
              }
              setStep((prev) => Math.max(prev - 1, 0));
            }}
            disabled={step === 0 && !canCompleteOnboarding}
            className="px-3 py-1.5 rounded-md text-xs text-white/55 hover:text-white/80 hover:bg-white/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {step === 0 ? 'Skip' : 'Back'}
          </button>
          <button
            onClick={() => {
              if (step === 2) {
                if (canCompleteOnboarding) onComplete();
                return;
              }
              setStep((prev) => Math.min(prev + 1, 2));
            }}
            disabled={step === 2 && !canCompleteOnboarding}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.14] hover:bg-white/[0.20] text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {step === 2 ? 'Finish' : 'Continue'}
            {step === 2 ? <Check className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingExtension;
