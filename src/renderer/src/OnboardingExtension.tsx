import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accessibility,
  ArrowLeft,
  Bot,
  BookOpen,
  Calculator,
  Check,
  Clipboard,
  ExternalLink,
  FileText,
  FolderOpen,
  Keyboard,
  Mic,
  Search,
  Volume2,
} from 'lucide-react';
import HotkeyRecorder from './settings/HotkeyRecorder';
import supercmdLogo from '../../../supercmd.png';
import onboardingIconVideo from '../../../assets/icon.mp4';

interface OnboardingExtensionProps {
  initialShortcut: string;
  requireWorkingShortcut?: boolean;
  onComplete: () => void;
  onClose: () => void;
}

const STEPS = [
  'Welcome',
  'Core Features',
  'Hotkey Setup',
  'Access',
  'Final Check',
];

const featureCards = [
  { id: 'clipboard', title: 'Clipboard', description: 'Search and paste history instantly.', icon: Clipboard },
  { id: 'snippet', title: 'Snippet', description: 'Store reusable text with quick triggers.', icon: FileText },
  { id: 'whisper', title: 'Whisper', description: 'Hold to speak and release to type.', icon: Mic },
  { id: 'read', title: 'Read', description: 'Read selected text with natural voice.', icon: Volume2 },
  { id: 'global-ai-prompt', title: 'Global AI Prompt', description: 'Transform text from anywhere.', icon: Bot },
  { id: 'unit-conversion', title: 'Unit Conversion', description: 'Convert values directly in launcher.', icon: Calculator },
  { id: 'instant-dictionary', title: 'Instant Dictionary', description: 'Fast definitions without context switching.', icon: BookOpen },
];

const permissionTargets = [
  {
    id: 'files',
    title: 'Files and Folders',
    description: 'Needed for file search, opening files from results, and extension workflows that operate on files.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
    icon: FolderOpen,
    iconTone: 'text-amber-100',
    iconBg: 'bg-amber-500/22 border-amber-100/30',
  },
  {
    id: 'accessibility',
    title: 'Accessibility',
    description: 'Needed for global clipboard actions, keyboard automation, and reliable paste/type behavior across apps.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    icon: Clipboard,
    iconTone: 'text-rose-100',
    iconBg: 'bg-rose-500/22 border-rose-100/30',
  },
  {
    id: 'microphone',
    title: 'Microphone',
    description: 'Required for Whisper so you can dictate and insert text with your hotkey.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    icon: Mic,
    iconTone: 'text-cyan-100',
    iconBg: 'bg-cyan-500/22 border-cyan-100/30',
  },
];

function toHotkeyCaps(shortcut: string): string[] {
  const map: Record<string, string> = {
    Command: '\u2318',
    Control: '\u2303',
    Alt: '\u2325',
    Shift: '\u21E7',
    Space: 'Space',
    Return: 'Enter',
  };
  return String(shortcut || '')
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => map[token] || (token.length === 1 ? token.toUpperCase() : token));
}

const OnboardingExtension: React.FC<OnboardingExtensionProps> = ({
  initialShortcut,
  requireWorkingShortcut = false,
  onComplete,
  onClose,
}) => {
  const [step, setStep] = useState(0);
  const [shortcut, setShortcut] = useState(initialShortcut || 'Alt+Space');
  const [shortcutStatus, setShortcutStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hasValidShortcut, setHasValidShortcut] = useState(!requireWorkingShortcut);
  const [openedPermissions, setOpenedPermissions] = useState<Record<string, boolean>>({});
  const [isReplacingSpotlight, setIsReplacingSpotlight] = useState(false);
  const [spotlightStatus, setSpotlightStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hotkeyTested, setHotkeyTested] = useState(false);
  const introVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setHasValidShortcut(!requireWorkingShortcut);
  }, [requireWorkingShortcut]);

  useEffect(() => {
    const video = introVideoRef.current;
    if (!video) return;
    let reverseRaf = 0;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const stopReverse = () => {
      if (reverseRaf) {
        cancelAnimationFrame(reverseRaf);
        reverseRaf = 0;
      }
    };
    const stopHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    const reverseTick = () => {
      if (disposed) return;
      const current = introVideoRef.current;
      if (!current) return;
      if (current.currentTime <= 0.04) {
        current.currentTime = 0;
        void current.play().catch(() => {});
        return;
      }
      current.currentTime = Math.max(0, current.currentTime - 1 / 30);
      reverseRaf = requestAnimationFrame(reverseTick);
    };

    const onEnded = () => {
      stopReverse();
      stopHold();
      video.pause();
      holdTimer = setTimeout(() => {
        reverseRaf = requestAnimationFrame(reverseTick);
      }, 450);
    };

    video.addEventListener('ended', onEnded);
    return () => {
      disposed = true;
      stopReverse();
      stopHold();
      video.removeEventListener('ended', onEnded);
    };
  }, []);

  const stepTitle = useMemo(() => STEPS[step] || STEPS[0], [step]);
  const hotkeyCaps = useMemo(() => toHotkeyCaps(shortcut || 'Alt+Space'), [shortcut]);

  const handleShortcutChange = async (nextShortcut: string) => {
    setShortcutStatus('idle');
    setShortcut(nextShortcut);
    if (!nextShortcut) {
      setHasValidShortcut(false);
      return;
    }
    const ok = await window.electron.updateGlobalShortcut(nextShortcut);
    if (ok) {
      setHasValidShortcut(true);
      setShortcutStatus('success');
      setTimeout(() => setShortcutStatus('idle'), 1600);
      return;
    }
    setHasValidShortcut(false);
    setShortcutStatus('error');
    setTimeout(() => setShortcutStatus('idle'), 2200);
  };

  const openPermissionTarget = async (id: string, url: string) => {
    const ok = await window.electron.openUrl(url);
    if (ok) {
      setOpenedPermissions((prev) => ({ ...prev, [id]: true }));
    }
  };

  const handleReplaceSpotlight = async () => {
    setIsReplacingSpotlight(true);
    setSpotlightStatus('idle');
    try {
      const ok = await window.electron.replaceSpotlightWithSuperCmdShortcut();
      if (ok) {
        setShortcut('Command+Space');
        setHasValidShortcut(true);
        setSpotlightStatus('success');
        return;
      }
      setSpotlightStatus('error');
    } finally {
      setIsReplacingSpotlight(false);
      setTimeout(() => setSpotlightStatus('idle'), 2400);
    }
  };

  const canCompleteOnboarding = !requireWorkingShortcut || hasValidShortcut;
  const canContinue = step !== 2 || canCompleteOnboarding;
  const canFinish = canCompleteOnboarding && hotkeyTested;
  const contentBackground = step === 0
    ? 'radial-gradient(circle at 10% 0%, rgba(255, 90, 118, 0.26), transparent 34%), radial-gradient(circle at 92% 2%, rgba(255, 84, 70, 0.19), transparent 36%), linear-gradient(180deg, rgba(5,5,7,0.98) 0%, rgba(8,8,11,0.95) 48%, rgba(10,10,13,0.93) 100%)'
    : 'radial-gradient(circle at 5% 0%, rgba(255, 92, 127, 0.30), transparent 36%), radial-gradient(circle at 100% 10%, rgba(255, 87, 73, 0.24), transparent 38%), radial-gradient(circle at 82% 100%, rgba(84, 212, 255, 0.12), transparent 34%), transparent';

  return (
    <div className="w-full h-full">
      <div
        className="glass-effect overflow-hidden h-full flex flex-col"
        style={{
          background:
            'linear-gradient(140deg, rgba(6, 8, 12, 0.80) 0%, rgba(12, 14, 20, 0.78) 52%, rgba(20, 11, 13, 0.76) 100%)',
          WebkitBackdropFilter: 'blur(50px) saturate(165%)',
          backdropFilter: 'blur(50px) saturate(165%)',
        }}
      >
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.08]">
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/75 transition-colors p-0.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-white/92 text-[15px] font-medium truncate">{stepTitle}</div>
            <div className="text-white/38 text-xs">Step {step + 1} of {STEPS.length}</div>
          </div>
          <div className="w-[74px]" />
        </div>

        <div
          className="flex-1 overflow-hidden px-6 py-5"
          style={{
            background: contentBackground,
          }}
        >
          {step === 0 && (
            <div className="max-w-6xl mx-auto min-h-full flex items-center">
              <div className="grid grid-cols-1 lg:grid-cols-[430px_minmax(0,1fr)] gap-5 w-full items-center">
                <div
                  className="relative w-full aspect-square rounded-3xl overflow-hidden border border-white/[0.20]"
                  style={{
                    background: 'rgba(0,0,0,0.92)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16), 0 14px 30px rgba(0,0,0,0.46)',
                  }}
                >
                  <video
                    ref={introVideoRef}
                    src={onboardingIconVideo}
                    className="w-full h-full object-cover"
                    autoPlay
                    muted
                    playsInline
                  />
                </div>

                <div
                  className="relative rounded-3xl border border-white/[0.20] p-5 lg:p-6 flex flex-col justify-between lg:h-[430px] self-center"
                  style={{
                    background:
                      'linear-gradient(168deg, rgba(20,20,24,0.86) 0%, rgba(26,26,31,0.72) 48%, rgba(34,20,20,0.52) 100%)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -14px 34px rgba(7, 7, 10, 0.45), 0 14px 38px rgba(0,0,0,0.36)',
                  }}
                >
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: 'linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.10) 40%, rgba(0,0,0,0.36) 100%)',
                    }}
                  />
                  <div>
                    <span className="relative z-10 inline-flex px-2.5 py-1 rounded-full border border-white/20 bg-white/[0.06] text-[10px] tracking-[0.14em] uppercase text-white/82 mb-3">
                      SuperCmd Onboarding
                    </span>
                    <h2 className="relative z-10 text-white text-[26px] lg:text-[30px] leading-[1.1] font-semibold max-w-xl">
                      Supercharge your Mac with SuperCmd.
                    </h2>
                    <p className="relative z-10 text-white/72 text-[15px] leading-relaxed mt-3 max-w-xl">
                      A single command surface for launching apps, running workflows, and triggering AI-powered actions
                      without leaving your keyboard.
                    </p>
                  </div>
                  <div className="relative z-10 rounded-2xl border border-white/[0.10] bg-black/24 px-4 py-2.5 mt-4">
                    <p className="text-white/82 text-[15px]">
                      Built for speed, polished with real glass depth, and ready for instant daily use.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="max-w-6xl mx-auto h-full">
              <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-5 min-h-[460px]">
                <div className="p-2 flex items-center justify-center">
                  <img
                    src={supercmdLogo}
                    alt="SuperCmd logo"
                    className="w-full max-w-[240px] h-auto object-contain drop-shadow-[0_22px_54px_rgba(255,58,98,0.68)]"
                    draggable={false}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {featureCards.map((feature) => {
                    const Icon = feature.icon;
                    return (
                      <div
                        key={feature.id}
                        className="group rounded-2xl border border-white/[0.14] p-4 transition-all duration-200 hover:translate-y-[-1px] hover:border-white/[0.28] hover:bg-white/[0.09]"
                        style={{
                          background:
                            'linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03))',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.24), 0 10px 28px rgba(0,0,0,0.28)',
                        }}
                      >
                        <div className="w-8 h-8 rounded-lg border border-white/25 bg-white/10 flex items-center justify-center mb-2.5">
                          <Icon className="w-4 h-4 text-white/92" />
                        </div>
                        <p className="text-white/92 text-sm font-medium mb-1">{feature.title}</p>
                        <p className="text-white/60 text-xs leading-relaxed">{feature.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-3xl">
                <div
                  className="rounded-2xl border border-white/[0.18] p-7"
                  style={{
                    background:
                      'linear-gradient(160deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -10px 24px rgba(12, 10, 20, 0.35), 0 12px 30px rgba(0,0,0,0.32)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Keyboard className="w-4 h-4 text-rose-100" />
                    <p className="text-white/90 text-sm font-medium">Current Hotkey</p>
                  </div>
                  <p className="text-white/62 text-xs mb-5">
                    This is your current launcher shortcut.
                  </p>

                  <div className="flex flex-wrap items-center gap-2 mb-5">
                    {hotkeyCaps.map((cap) => (
                      <span
                        key={`${cap}-${shortcut}`}
                        className="inline-flex min-w-[38px] h-9 px-3 items-center justify-center rounded-lg border border-white/25 bg-white/[0.12] text-white/95 text-sm font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.32)]"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <HotkeyRecorder value={shortcut} onChange={handleShortcutChange} />
                    {shortcutStatus === 'success' ? <span className="text-xs text-emerald-300">Hotkey updated</span> : null}
                    {shortcutStatus === 'error' ? <span className="text-xs text-rose-300">Shortcut unavailable</span> : null}
                  </div>

                  <p className="text-white/52 text-xs mb-4">Click the hotkey field above to update your shortcut.</p>

                  <div className="rounded-xl border border-white/[0.12] bg-white/[0.05] p-3.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Search className="w-3.5 h-3.5 text-amber-100" />
                      <p className="text-white/86 text-xs font-medium">Replace Spotlight</p>
                    </div>
                    <p className="text-white/56 text-xs mb-2.5">
                      Disable Spotlight shortcut and set SuperCmd to Cmd + Space.
                    </p>
                    <button
                      onClick={handleReplaceSpotlight}
                      disabled={isReplacingSpotlight}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/22 bg-white/[0.11] hover:bg-white/[0.18] text-white/90 text-xs transition-colors disabled:opacity-55"
                    >
                      Replace Spotlight
                      {spotlightStatus === 'success' ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : null}
                    </button>
                    {spotlightStatus === 'error' ? (
                      <p className="text-rose-300 text-xs mt-2">Could not replace automatically.</p>
                    ) : null}
                  </div>
                </div>

                {requireWorkingShortcut && !hasValidShortcut ? (
                  <p className="text-xs text-amber-200/92">
                    Your current launcher shortcut is unavailable. Set a working shortcut to continue.
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-6xl space-y-4">
                <div
                  className="rounded-2xl border border-rose-200/24 px-5 py-4"
                  style={{
                    background:
                      'linear-gradient(160deg, rgba(255, 94, 122, 0.18), rgba(255, 120, 90, 0.07))',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.24), 0 12px 30px rgba(0,0,0,0.28)',
                  }}
                >
                  <p className="text-white text-base font-semibold mb-1">Action Required: Grant Access</p>
                  <p className="text-white/78 text-sm">
                    SuperCmd needs these permissions to work reliably across clipboard actions, file workflows, and whisper dictation.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {permissionTargets.map((target) => {
                    const Icon = target.icon;
                    return (
                      <div
                        key={target.id}
                        className="rounded-2xl border border-white/[0.18] p-4 flex flex-col"
                        style={{
                          background:
                            'linear-gradient(160deg, rgba(255,255,255,0.13), rgba(255,255,255,0.04))',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.24), 0 14px 32px rgba(0,0,0,0.34)',
                        }}
                      >
                        <div className="flex items-center justify-between gap-2 mb-3.5">
                          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${target.iconBg}`}>
                            <Icon className={`w-4 h-4 ${target.iconTone}`} />
                          </div>
                          {openedPermissions[target.id] ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-emerald-200/35 bg-emerald-500/22 text-emerald-100">
                              <Check className="w-3 h-3" />
                              Added
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border border-rose-200/30 bg-rose-500/20 text-rose-100">
                              Required
                            </span>
                          )}
                        </div>
                        <p className="text-white/96 text-sm font-semibold mb-1">{target.title}</p>
                        <p className="text-white/66 text-xs leading-relaxed flex-1">{target.description}</p>
                        <button
                          onClick={() => openPermissionTarget(target.id, target.url)}
                          className="mt-4 inline-flex w-full justify-center items-center gap-1.5 px-3 py-2 rounded-md border border-rose-200/25 bg-gradient-to-r from-rose-500/58 to-red-500/58 hover:from-rose-500/75 hover:to-red-500/75 text-white text-xs font-medium transition-colors"
                        >
                          Open Settings
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-3xl space-y-4">
                <div className="rounded-2xl border border-white/[0.18] bg-white/[0.06] p-6">
                  <p className="text-white text-xl font-semibold mb-2">Final step: test your hotkey</p>
                  <p className="text-white/68 text-sm leading-relaxed mb-4">
                    Press your global shortcut to open SuperCmd from any app. If this window closes, use the hotkey to reopen it.
                  </p>

                  <div className="flex flex-wrap gap-2 mb-4">
                    {hotkeyCaps.map((cap) => (
                      <span
                        key={`${cap}-final-${shortcut}`}
                        className="inline-flex min-w-[38px] h-9 px-3 items-center justify-center rounded-lg border border-white/25 bg-white/[0.12] text-white/95 text-sm font-medium"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={() => setHotkeyTested((prev) => !prev)}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                      hotkeyTested
                        ? 'border-emerald-200/35 bg-emerald-500/22 text-emerald-100'
                        : 'border-white/20 bg-white/[0.10] hover:bg-white/[0.16] text-white/88'
                    }`}
                  >
                    {hotkeyTested ? <Check className="w-3.5 h-3.5" /> : null}
                    I pressed the hotkey and it works
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-between"
          style={{
            background:
              'linear-gradient(180deg, rgba(25, 20, 28, 0.56) 0%, rgba(11, 12, 17, 0.84) 100%)',
          }}
        >
          <button
            onClick={() => {
              if (step === 0) {
                if (canCompleteOnboarding) onComplete();
                return;
              }
              setStep((prev) => Math.max(prev - 1, 0));
            }}
            disabled={step === 0 && !canCompleteOnboarding}
            className="px-3 py-1.5 rounded-md text-xs text-white/62 hover:text-white/90 hover:bg-white/[0.10] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {step === 0 ? 'Skip Setup' : 'Back'}
          </button>
          <button
            onClick={() => {
              if (step === STEPS.length - 1) {
                if (canFinish) onComplete();
                return;
              }
              if (!canContinue) return;
              setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
            }}
            disabled={step === STEPS.length - 1 ? !canFinish : !canContinue}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/25 bg-gradient-to-r from-rose-500/70 to-red-500/70 hover:from-rose-500/85 hover:to-red-500/85 text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {step === STEPS.length - 1 ? 'Finish' : `Continue → ${STEPS[step + 1]}`}
            {step === STEPS.length - 1 ? <Check className="w-3.5 h-3.5" /> : null}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingExtension;
