import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Calculator,
  Check,
  Clipboard,
  ExternalLink,
  FileText,
  Keyboard,
  Mic,
  Shield,
  Volume2,
} from 'lucide-react';
import HotkeyRecorder from './settings/HotkeyRecorder';
import supercmdLogo from '../../../supercmd.png';
import onboardingIconVideo from '../../../assets/icon.mp4';

interface OnboardingExtensionProps {
  initialShortcut: string;
  requireWorkingShortcut?: boolean;
  dictationPracticeText: string;
  onDictationPracticeTextChange: (value: string) => void;
  onboardingHotkeyPresses?: number;
  onComplete: () => void;
  onClose: () => void;
}

type PermissionTargetId = 'accessibility' | 'input-monitoring' | 'speech-recognition' | 'microphone';

const STEPS = [
  'Welcome',
  'Core Features',
  'Hotkey Setup',
  'Permissions',
  'Dictation Mode',
  'Read Mode',
  'Final Check',
];

const featureCards = [
  { id: 'clipboard', title: 'Clipboard', description: 'Search and paste history instantly.', icon: Clipboard },
  { id: 'snippet', title: 'Snippet', description: 'Store reusable text with quick triggers.', icon: FileText },
  { id: 'whisper', title: 'Whisper', description: 'Hold to speak and release to type.', icon: Mic },
  { id: 'read', title: 'Read', description: 'Read selected text with natural voice.', icon: Volume2 },
  { id: 'global-ai-prompt', title: 'Global AI Prompt', description: 'Transform text from anywhere.', icon: Bot },
  { id: 'unit-conversion', title: 'Unit Conversion', description: 'Convert values directly in launcher.', icon: Calculator },
];

const permissionTargets: Array<{
  id: PermissionTargetId;
  title: string;
  description: string;
  url: string;
  icon: any;
  iconTone: string;
  iconBg: string;
}> = [
  {
    id: 'accessibility',
    title: 'Accessibility',
    description: 'Required for text selection, keyboard automation, and reliable typing into other apps.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    icon: Shield,
    iconTone: 'text-rose-100',
    iconBg: 'bg-rose-500/22 border-rose-100/30',
  },
  {
    id: 'input-monitoring',
    title: 'Input Monitoring',
    description: 'Required for hold-to-talk key detection. Click the button, then in System Settings click "+" and add SuperCmd.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    icon: Keyboard,
    iconTone: 'text-indigo-100',
    iconBg: 'bg-indigo-500/22 border-indigo-100/30',
  },
  {
    id: 'speech-recognition',
    title: 'Speech Recognition',
    description: 'Required for native Whisper transcription.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
    icon: Volume2,
    iconTone: 'text-emerald-100',
    iconBg: 'bg-emerald-500/22 border-emerald-100/30',
  },
  {
    id: 'microphone',
    title: 'Microphone',
    description: 'Required for SuperCmd Whisper dictation.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    icon: Mic,
    iconTone: 'text-cyan-100',
    iconBg: 'bg-cyan-500/22 border-cyan-100/30',
  },
];

const DICTATION_SAMPLE =
  'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.';

const READ_SAMPLE =
  'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.';

const SPEECH_LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'ja-JP', label: 'Japanese' },
];

function toHotkeyCaps(shortcut: string): string[] {
  const map: Record<string, string> = {
    Command: '\u2318',
    Control: '\u2303',
    Alt: '\u2325',
    Shift: '\u21E7',
    Space: 'Space',
    Return: 'Enter',
    Fn: 'fn',
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
  dictationPracticeText,
  onDictationPracticeTextChange,
  onboardingHotkeyPresses = 0,
  onComplete,
  onClose,
}) => {
  const [step, setStep] = useState(0);
  const [shortcut, setShortcut] = useState(initialShortcut || 'Alt+Space');
  const [shortcutStatus, setShortcutStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hasValidShortcut, setHasValidShortcut] = useState(!requireWorkingShortcut);
  const [openedPermissions, setOpenedPermissions] = useState<Record<string, boolean>>({});
  const [requestedPermissions, setRequestedPermissions] = useState<Record<string, boolean>>({});
  const [permissionLoading, setPermissionLoading] = useState<Record<string, boolean>>({});
  const [permissionNotes, setPermissionNotes] = useState<Record<string, string>>({});
  const [whisperHoldKey, setWhisperHoldKey] = useState('Fn');
  const [whisperKeyStatus, setWhisperKeyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [whisperKeyTested, setWhisperKeyTested] = useState(false);
  const [speechLanguage, setSpeechLanguage] = useState('en-US');
  const [spotlightReplaceStatus, setSpotlightReplaceStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const introVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setHasValidShortcut(!requireWorkingShortcut);
  }, [requireWorkingShortcut]);

  useEffect(() => {
    window.electron.getSettings().then((settings) => {
      const saved = String(settings.commandHotkeys?.['system-supercmd-whisper-speak-toggle'] || 'Fn').trim();
      setWhisperHoldKey(saved || 'Fn');
      const savedLanguage = String(settings.ai?.speechLanguage || 'en-US').trim();
      setSpeechLanguage(savedLanguage || 'en-US');
    }).catch(() => {});
  }, []);

  const handleSpeechLanguageChange = async (nextLanguage: string) => {
    const targetLanguage = String(nextLanguage || 'en-US').trim() || 'en-US';
    setSpeechLanguage(targetLanguage);
    try {
      const settings = await window.electron.getSettings();
      await window.electron.saveSettings({
        ai: {
          ...(settings?.ai || {}),
          speechLanguage: targetLanguage,
        },
      } as any);
    } catch {}
  };

  const handleReplaceSpotlight = async () => {
    setSpotlightReplaceStatus('loading');
    try {
      const ok = await window.electron.replaceSpotlightWithSuperCmdShortcut();
      if (ok) {
        setSpotlightReplaceStatus('success');
        setShortcut('Command+Space');
        setShortcutStatus('success');
        setTimeout(() => setShortcutStatus('idle'), 1600);
      } else {
        setSpotlightReplaceStatus('error');
      }
    } catch {
      setSpotlightReplaceStatus('error');
    }
  };

  // Fix 4: Auto-refresh permission statuses when user returns from System Settings.
  useEffect(() => {
    if (step !== 3) return;
    const checkPermissions = async () => {
      try {
        const statuses = await window.electron.checkOnboardingPermissions();
        setOpenedPermissions((prev) => {
          const next = { ...prev };
          for (const [id, granted] of Object.entries(statuses)) {
            if (granted) next[id] = true;
          }
          return next;
        });
        setRequestedPermissions((prev) => {
          const next = { ...prev };
          for (const [id, granted] of Object.entries(statuses)) {
            if (granted) next[id] = true;
          }
          return next;
        });
      } catch {}
    };
    void checkPermissions();
    const handleFocus = () => { void checkPermissions(); };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [step]);

  // Auto-unlock Continue on step 4 once the user has dictated something.
  useEffect(() => {
    if (dictationPracticeText.trim()) {
      setWhisperKeyTested(true);
    }
  }, [dictationPracticeText]);

  // Fix 6: Enable Fn watcher when user reaches the Dictation test step (step 4).
  // By this point the user has passed the permissions step, so Input Monitoring
  // should already be granted and it is safe to start the CGEventTap binary.
  useEffect(() => {
    if (step !== 4) return;
    void window.electron.enableFnWatcherForOnboarding().catch(() => {});
    return () => {
      void window.electron.disableFnWatcherForOnboarding().catch(() => {});
    };
  }, [step]);

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

  useEffect(() => {
    if (!onboardingHotkeyPresses) return;
    if (step !== STEPS.length - 1) return;
    onComplete();
  }, [onboardingHotkeyPresses, step, onComplete]);

  // Clear any lingering text selection when the user navigates between steps.
  // Without this, text selected on the Read Mode step (step 5) stays highlighted
  // when the user continues to the Final Check step.
  useEffect(() => {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}
  }, [step]);

  const stepTitle = useMemo(() => STEPS[step] || STEPS[0], [step]);
  const hotkeyCaps = useMemo(() => toHotkeyCaps(shortcut || 'Alt+Space'), [shortcut]);
  const whisperKeyCaps = useMemo(() => toHotkeyCaps(whisperHoldKey || 'Fn'), [whisperHoldKey]);

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

  const handleWhisperKeyChange = async (nextShortcut: string) => {
    const target = nextShortcut || 'Fn';
    setWhisperKeyStatus('idle');
    setWhisperHoldKey(target);
    const result = await window.electron.updateCommandHotkey('system-supercmd-whisper-speak-toggle', target);
    if (result.success) {
      setWhisperKeyStatus('success');
      setTimeout(() => setWhisperKeyStatus('idle'), 1600);
      return;
    }
    setWhisperKeyStatus('error');
    setTimeout(() => setWhisperKeyStatus('idle'), 2200);
  };

  const openPermissionTarget = async (id: PermissionTargetId, url: string) => {
    setPermissionLoading((prev) => ({ ...prev, [id]: true }));
    setPermissionNotes((prev) => ({ ...prev, [id]: '' }));
    try {
      const result = await window.electron.onboardingRequestPermission(id);
      let granted = Boolean(result?.granted);
      let requested = Boolean(result?.requested);
      const mode = String(result?.mode || '');
      let status = String(result?.status || '');
      let latestError = String(result?.error || '').trim();
      if (requested) {
        setRequestedPermissions((prev) => ({ ...prev, [id]: true }));
      }
      if (granted) {
        setOpenedPermissions((prev) => ({ ...prev, [id]: true }));
      }

      if (id === 'microphone') {
        // For microphone, always trigger request from renderer capture path.
        // This ensures the real media capture path is primed in macOS privacy.
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((track) => track.stop());
          requested = true;
          granted = true;
          status = 'granted';
          latestError = '';
        } catch {}
        if (!granted) {
          try {
            const verify = await window.electron.whisperEnsureMicrophoneAccess({ prompt: true });
            granted = granted || Boolean(verify?.granted);
            requested = requested || Boolean(verify?.requested);
            status = String(verify?.status || status);
            if (verify?.error) {
              latestError = String(verify.error || '').trim();
            }
          } catch {}
        }
      }
      if (id === 'speech-recognition' && !granted) {
        try {
          const verify = await window.electron.whisperEnsureSpeechRecognitionAccess({ prompt: true });
          granted = Boolean(verify?.granted);
          requested = requested || Boolean(verify?.requested);
          status = String(verify?.speechStatus || status);
          if (verify?.error) {
            latestError = String(verify.error || '').trim();
          }
        } catch {}
      }

      if (requested) {
        setRequestedPermissions((prev) => ({ ...prev, [id]: true }));
      }
      if (granted) {
        setOpenedPermissions((prev) => ({ ...prev, [id]: true }));
      } else if (id === 'microphone' || id === 'speech-recognition') {
        const targetLabel = id === 'microphone' ? 'Microphone' : 'Speech Recognition';
        if (status === 'denied' || status === 'restricted') {
          setPermissionNotes((prev) => ({
            ...prev,
            [id]: `${targetLabel} access is blocked. Enable SuperCmd in System Settings, then return.`,
          }));
        } else if (latestError) {
          if (/failed to request microphone access/i.test(latestError)) {
            setPermissionNotes((prev) => ({
              ...prev,
              [id]: 'Could not trigger the permission prompt. Open System Settings -> Privacy & Security, enable SuperCmd, then press request again.',
            }));
          } else {
            setPermissionNotes((prev) => ({ ...prev, [id]: latestError }));
          }
        } else if (!requested || mode === 'manual' || status === 'not-determined') {
          setPermissionNotes((prev) => ({
            ...prev,
            [id]: 'Permission prompt did not appear. Open Whisper once and press this again.',
          }));
        }
      }
      if (id === 'microphone') {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      const candidateUrls = id === 'microphone'
        ? [url, 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone']
        : id === 'speech-recognition'
          ? [url, 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_SpeechRecognition']
          : [url];
      let ok = false;
      for (const candidate of candidateUrls) {
        if (ok) break;
        ok = await window.electron.openUrl(candidate);
      }
      if (ok) {
        if (id === 'input-monitoring') {
          // macOS 13+ does not auto-add apps to Input Monitoring via CGEventTap.
          // The user must click "+" in System Settings and manually select SuperCmd.
          setPermissionNotes((prev) => ({
            ...prev,
            [id]: 'In Input Monitoring, click "+" at the bottom left and add SuperCmd from your Applications folder.',
          }));
        } else if (mode === 'manual' && !requested) {
          setRequestedPermissions((prev) => ({ ...prev, [id]: false }));
        }
      }
    } finally {
      setPermissionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const canCompleteOnboarding = hasValidShortcut;
  const canContinueBase = step !== 2 || canCompleteOnboarding;
  const canContinueDictation = step !== 4 || whisperKeyTested;
  const canContinue = canContinueBase && canContinueDictation;
  const canFinish = canCompleteOnboarding && whisperKeyTested;
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
                  className="relative rounded-3xl border border-white/[0.20] p-5 lg:p-6 flex flex-col gap-4 lg:h-[430px] self-center"
                  style={{
                    background:
                      'linear-gradient(168deg, rgba(20,20,24,0.86) 0%, rgba(26,26,31,0.72) 48%, rgba(34,20,20,0.52) 100%)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -14px 34px rgba(7, 7, 10, 0.45), 0 14px 38px rgba(0,0,0,0.36)',
                  }}
                >
                  <span className="inline-flex w-fit px-2.5 py-1 rounded-full border border-white/20 bg-white/[0.06] text-[10px] tracking-[0.14em] uppercase text-white/82">
                    SuperCmd Setup
                  </span>
                  <h2 className="text-white text-[26px] lg:text-[30px] leading-[1.1] font-semibold max-w-xl">
                    One command surface for launch, ask, dictate, and read.
                  </h2>
                  <p className="text-white/72 text-[15px] leading-relaxed max-w-xl">
                    We will configure launcher hotkeys, privacy permissions, and whisper mode in one pass.
                  </p>
                  <div className="rounded-2xl border border-white/[0.10] bg-black/24 px-4 py-3">
                    <p className="text-white/88 text-sm mb-2">What gets configured now:</p>
                    <div className="text-white/72 text-sm space-y-1">
                      <p>1. Launcher hotkey and inline prompt defaults</p>
                      <p>2. Accessibility, Input Monitoring, Speech Recognition, Microphone</p>
                      <p>3. Whisper dictation and Read mode practice</p>
                    </div>
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
                    <p className="text-white/90 text-sm font-medium">Current Launcher Hotkey</p>
                  </div>
                  <p className="text-white/62 text-xs mb-5">
                    Inline prompt default is now Cmd + Shift + K. Configure launcher key below.
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

                  <p className="text-white/52 text-xs mb-4">Click the hotkey field above to update your launcher shortcut.</p>

                  <div className="rounded-xl border border-white/[0.12] bg-white/[0.05] p-3.5">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <p className="text-white/86 text-xs font-medium">Replace Spotlight (Cmd + Space)</p>
                      <button
                        onClick={() => { void handleReplaceSpotlight(); }}
                        disabled={spotlightReplaceStatus === 'loading' || spotlightReplaceStatus === 'success'}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors disabled:opacity-60 ${
                          spotlightReplaceStatus === 'success'
                            ? 'border-emerald-200/35 bg-emerald-500/22 text-emerald-100'
                            : 'border-white/20 bg-white/[0.10] hover:bg-white/[0.18] text-white'
                        }`}
                      >
                        {spotlightReplaceStatus === 'success' ? <Check className="w-3 h-3" /> : null}
                        {spotlightReplaceStatus === 'loading' ? 'Replacing…' : spotlightReplaceStatus === 'success' ? 'Replaced' : 'Auto Replace'}
                      </button>
                    </div>
                    {spotlightReplaceStatus === 'success' ? (
                      <p className="text-emerald-200/85 text-xs mb-1.5">Spotlight shortcut disabled. SuperCmd is now Cmd + Space.</p>
                    ) : spotlightReplaceStatus === 'error' ? (
                      <p className="text-rose-200/85 text-xs mb-1.5">Auto-replace failed. Use the manual steps below.</p>
                    ) : null}
                    <div className="text-white/55 text-xs space-y-1">
                      <p>Manual: System Settings → Keyboard → Keyboard Shortcuts → Spotlight → disable.</p>
                      <p>Then set the launcher hotkey above to Cmd + Space.</p>
                    </div>
                  </div>
                </div>

                {requireWorkingShortcut && !hasValidShortcut ? (
                  <p className="text-xs text-amber-200/92 mt-2">
                    Your current launcher shortcut is unavailable. Set a working shortcut to continue.
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
                <div
                  className="rounded-3xl border border-white/[0.16] p-5"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(33, 19, 24, 0.82), rgba(16, 17, 25, 0.72))',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 34px rgba(0,0,0,0.34)',
                  }}
                >
                  <p className="text-white text-[20px] leading-tight font-semibold mb-2">Grant Access</p>
                  <p className="text-white/72 text-sm leading-relaxed mb-4">
                    We now request each permission first, then jump to the exact Privacy & Security page so SuperCmd appears where needed.
                  </p>
                  <div className="space-y-2 text-xs text-white/70">
                    <p>1. Click each access row once</p>
                    <p>2. Enable SuperCmd in System Settings</p>
                    <p>3. Return and continue setup</p>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/[0.16] bg-white/[0.05] p-4 space-y-3">
                  {permissionTargets.map((target, index) => {
                    const Icon = target.icon;
                    const isDone = Boolean(openedPermissions[target.id]);
                    const isRequested = Boolean(requestedPermissions[target.id]);
                    const note = permissionNotes[target.id];
                    return (
                      <div
                        key={target.id}
                        className="rounded-2xl border p-3.5"
                        style={{
                          borderColor: isDone ? 'rgba(110, 231, 183, 0.44)' : 'rgba(255,255,255,0.16)',
                          background: isDone
                            ? 'linear-gradient(160deg, rgba(16, 82, 56, 0.34), rgba(23, 34, 41, 0.26))'
                            : 'linear-gradient(160deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))',
                          boxShadow: isDone
                            ? 'inset 0 1px 0 rgba(167,243,208,0.35), 0 14px 30px rgba(0,0,0,0.28)'
                            : 'inset 0 1px 0 rgba(255,255,255,0.22), 0 14px 30px rgba(0,0,0,0.28)',
                        }}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="text-white/35 text-[11px] font-semibold mt-1">{String(index + 1).padStart(2, '0')}</div>
                            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${target.iconBg}`}>
                              <Icon className={`w-4 h-4 ${target.iconTone}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <p className="text-white/96 text-sm font-semibold">{target.title}</p>
                                {isDone ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-emerald-200/35 bg-emerald-500/22 text-emerald-100">
                                    <Check className="w-3 h-3" />
                                    Granted
                                  </span>
                                ) : isRequested ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border border-amber-200/30 bg-amber-500/20 text-amber-100">
                                    Requested
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border border-rose-200/30 bg-rose-500/20 text-rose-100">
                                    Required
                                  </span>
                                )}
                              </div>
                              <p className="text-white/68 text-xs leading-relaxed">{target.description}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => openPermissionTarget(target.id, target.url)}
                            disabled={Boolean(permissionLoading[target.id])}
                            className="inline-flex justify-center items-center gap-1.5 px-3 py-2 rounded-md border border-white/20 bg-white/[0.10] hover:bg-white/[0.18] text-white text-xs font-medium transition-colors disabled:opacity-60 md:min-w-[190px]"
                          >
                            {permissionLoading[target.id] ? 'Requesting...' : 'Request + Open Settings'}
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                        {!isDone && isRequested ? (
                          <p className="mt-2 text-[11px] text-amber-100/85">
                            Permission request sent. Enable SuperCmd in System Settings, then return.
                          </p>
                        ) : null}
                        {!isDone && (target.id === 'microphone' || target.id === 'speech-recognition') ? (
                          <p className="mt-1 text-[11px] text-white/52">
                            If this opens Privacy & Security, select the matching access row and press request again.
                          </p>
                        ) : null}
                        {!isDone && note ? (
                          <p className="mt-1 text-[11px] text-rose-100/85">
                            {note}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="max-w-6xl mx-auto min-h-full flex items-center">
              <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-5 w-full items-center">
                <div className="space-y-4">
                  <div className="w-10 h-10 rounded-xl border border-cyan-200/25 bg-cyan-500/15 flex items-center justify-center">
                    <Mic className="w-5 h-5 text-cyan-100" />
                  </div>
                  <h3 className="text-white text-[34px] leading-[1.05] font-semibold">Dictation Mode</h3>
                  <p className="text-white/72 text-[22px] leading-tight">Test your Whisper hold key first.</p>
                  <div className="space-y-2 text-white/82 text-[16px]">
                    <p>1. Hold {whisperKeyCaps.join(' + ')}</p>
                    <p>2. Read the sample message</p>
                    <p>3. Release key to insert text</p>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <HotkeyRecorder value={whisperHoldKey} onChange={handleWhisperKeyChange} compact />
                    {whisperKeyStatus === 'success' ? <span className="text-xs text-emerald-300">Whisper key updated</span> : null}
                    {whisperKeyStatus === 'error' ? <span className="text-xs text-rose-300">Shortcut unavailable</span> : null}
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-white/82 text-xs">Dictation language</p>
                    <select
                      value={speechLanguage}
                      onChange={(e) => { void handleSpeechLanguageChange(e.target.value); }}
                      className="w-full max-w-[260px] bg-white/[0.06] border border-white/[0.18] rounded-md px-3 py-2 text-sm text-white/92 focus:outline-none focus:border-cyan-300/70"
                    >
                      {SPEECH_LANGUAGE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                    <p className="text-white/54 text-[11px]">
                      Default is English. This language is used for Whisper transcription, including ElevenLabs.
                    </p>
                  </div>
                  <button
                    onClick={() => setWhisperKeyTested((prev) => !prev)}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                      whisperKeyTested
                        ? 'border-emerald-200/35 bg-emerald-500/22 text-emerald-100'
                        : 'border-white/20 bg-white/[0.10] hover:bg-white/[0.16] text-white/88'
                    }`}
                  >
                    {whisperKeyTested ? <Check className="w-3.5 h-3.5" /> : null}
                    The whisper key works
                  </button>
                </div>

                <div className="rounded-3xl border border-white/[0.16] p-5 bg-white/[0.04]">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/20 bg-white/[0.06] text-white/85 text-xs mb-3">
                    <Mic className="w-3.5 h-3.5" />
                    Messages sample
                  </div>
                  <div className="rounded-2xl border border-white/[0.12] bg-white/[0.06] p-4 mb-4">
                    <p className="text-white/92 text-sm leading-relaxed">“{DICTATION_SAMPLE}”</p>
                  </div>
                  <p className="text-white/70 text-sm mb-2">Hold down your whisper key and read the message above:</p>
                  <textarea
                    value={dictationPracticeText}
                    onChange={(e) => onDictationPracticeTextChange(e.target.value)}
                    placeholder="Dictated text appears here..."
                    className="w-full h-40 resize-none rounded-xl border border-cyan-300/55 bg-white/[0.05] px-4 py-3 text-white/90 placeholder:text-white/40 text-base leading-relaxed outline-none shadow-[0_0_0_3px_rgba(34,211,238,0.15)]"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-4xl space-y-4">
                <div className="rounded-2xl border border-white/[0.18] bg-white/[0.06] p-6">
                  <p className="text-white text-xl font-semibold mb-2">Whisper Read Test</p>
                  <div className="flex items-center gap-2 flex-wrap mb-4">
                    <p className="text-white/68 text-sm leading-relaxed">Select the paragraph below and press</p>
                    {([
                      { symbol: '⌘', label: 'Cmd' },
                      { symbol: '⇧', label: 'Shift' },
                      { symbol: 'S', label: null },
                    ] as Array<{ symbol: string; label: string | null }>).map((cap, i) => (
                      <span
                        key={i}
                        className="inline-flex flex-col min-w-[36px] h-10 px-2.5 items-center justify-center rounded-lg border border-white/25 bg-white/[0.12] text-white/95 font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.32)]"
                      >
                        <span className="text-sm leading-none">{cap.symbol}</span>
                        {cap.label && <span className="text-[9px] text-white/60 leading-none mt-0.5">{cap.label}</span>}
                      </span>
                    ))}
                    <p className="text-white/68 text-sm leading-relaxed">to read it aloud.</p>
                  </div>

                  <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] p-4 mb-4">
                    <p className="text-white/90 text-[15px] leading-relaxed select-text">{READ_SAMPLE}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-3xl space-y-4">
                <div className="rounded-2xl border border-white/[0.18] bg-white/[0.06] p-6">
                  <p className="text-white text-xl font-semibold mb-2">Final step: start SuperCmd from anywhere</p>
                  <p className="text-white/68 text-sm leading-relaxed mb-4">
                    Press your global shortcut now to start SuperCmd from any app.
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
