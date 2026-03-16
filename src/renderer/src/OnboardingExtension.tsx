import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Calculator,
  Check,
  Clipboard,
  FileText,
  FolderOpen,
  Keyboard,
  Mic,
  Shield,
  Volume2,
} from 'lucide-react';
import HotkeyRecorder from './settings/HotkeyRecorder';
import supercmdLogo from '../../../supercmd.png';
import onboardingIconVideo from '../../../assets/icon.mp4';
import type { WhisperCppModelStatus, ParakeetModelStatus } from '../types/electron';

interface OnboardingExtensionProps {
  initialShortcut: string;
  requireWorkingShortcut?: boolean;
  dictationPracticeText: string;
  onDictationPracticeTextChange: (value: string) => void;
  onboardingHotkeyPresses?: number;
  onComplete: () => void;
  onClose: () => void;
}

type PermissionTargetId = 'accessibility' | 'input-monitoring' | 'speech-recognition' | 'microphone' | 'home-folder';

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
    id: 'home-folder',
    title: 'Home Folder',
    description: 'Required for file search.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
    icon: FolderOpen,
    iconTone: 'text-blue-100',
    iconBg: 'bg-blue-500/22 border-blue-100/30',
  },
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
    description: 'Required for Fn hold-to-talk detection and other global key monitoring in Whisper mode.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    icon: Keyboard,
    iconTone: 'text-amber-100',
    iconBg: 'bg-amber-500/22 border-amber-100/30',
  },
  {
    id: 'speech-recognition',
    title: 'Speech Recognition',
    description: 'Optional. Needed only if you switch Whisper to the Apple Speech Recognition fallback.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
    icon: Volume2,
    iconTone: 'text-emerald-100',
    iconBg: 'bg-emerald-500/22 border-emerald-100/30',
  },
  {
    id: 'microphone',
    title: 'Microphone',
    description: 'Required for SuperCmd Whisper Dictation.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    icon: Mic,
    iconTone: 'text-cyan-100',
    iconBg: 'bg-cyan-500/22 border-cyan-100/30',
  },
];

const DICTATION_SAMPLE =
  'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.';

const READ_SAMPLE =
  'Voice-first interfaces are having a moment. After years of being dismissed as gimmicks, a new wave of tools is making it genuinely faster to speak than type — with transcription that keeps up, smart corrections, and shortcut keys that slot into existing workflows without disruption.';

const SPEECH_LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ar-EG', label: 'Arabic' },
  { value: 'zh-CN', label: 'Chinese (Mandarin)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'fr-CA', label: 'French (Canada)' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'ko-KR', label: 'Korean' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'ru-RU', label: 'Russian' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
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
  const [openAtLogin, setOpenAtLogin] = useState(true);
  const [whisperHoldKey, setWhisperHoldKey] = useState('Fn');
  const [whisperKeyStatus, setWhisperKeyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isHoldKeyActive, setIsHoldKeyActive] = useState(false);
  const [speechLanguage, setSpeechLanguage] = useState('en-US');
  const [whisperCppModelStatus, setWhisperCppModelStatus] = useState<WhisperCppModelStatus | null>(null);
  const [whisperCppModelBusy, setWhisperCppModelBusy] = useState(false);
  const [parakeetModelStatus, setParakeetModelStatus] = useState<ParakeetModelStatus | null>(null);
  const [parakeetModelBusy, setParakeetModelBusy] = useState(false);
  const [sttProvider, setSttProvider] = useState<string>('parakeet');
  const introVideoRef = useRef<HTMLVideoElement | null>(null);
  const openedPermissionsRef = useRef<Record<string, boolean>>({});
  const requestedPermissionsRef = useRef<Record<string, boolean>>({});
  const finalStepHotkeyBaselineRef = useRef(0);

  useEffect(() => {
    openedPermissionsRef.current = openedPermissions;
  }, [openedPermissions]);

  useEffect(() => {
    requestedPermissionsRef.current = requestedPermissions;
  }, [requestedPermissions]);

  useEffect(() => {
    setHasValidShortcut(!requireWorkingShortcut);
  }, [requireWorkingShortcut]);

  useEffect(() => {
    window.electron.getSettings().then((settings) => {
      const saved = String(settings.commandHotkeys?.['system-supercmd-whisper-speak-toggle'] ?? '').trim();
      setWhisperHoldKey(saved);
      const savedLanguage = String(settings.ai?.speechLanguage || 'en-US').trim();
      setSpeechLanguage(savedLanguage || 'en-US');
      const stt = String(settings.ai?.speechToTextModel || 'parakeet').trim();
      setSttProvider(!stt || stt === 'default' ? 'parakeet' : stt);
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

  const refreshWhisperCppModelStatus = async (): Promise<WhisperCppModelStatus | null> => {
    try {
      const status = await window.electron.whisperCppModelStatus();
      setWhisperCppModelStatus(status);
      return status;
    } catch {
      return null;
    }
  };

  const startWhisperCppModelDownload = async () => {
    if (whisperCppModelBusy || whisperCppModelStatus?.state === 'downloaded') return;
    setWhisperCppModelBusy(true);
    setWhisperCppModelStatus((current) => ({
      state: 'downloading',
      modelName: current?.modelName || 'base',
      path: current?.path || '',
      bytesDownloaded: current?.bytesDownloaded || 0,
      totalBytes: current?.totalBytes ?? null,
    }));
    try {
      const status = await window.electron.whisperCppDownloadModel();
      setWhisperCppModelStatus(status);
    } catch {
      await refreshWhisperCppModelStatus();
    } finally {
      setWhisperCppModelBusy(false);
    }
  };

  const refreshParakeetModelStatus = async (): Promise<ParakeetModelStatus | null> => {
    try {
      const status = await window.electron.parakeetModelStatus();
      setParakeetModelStatus(status);
      return status;
    } catch {
      return null;
    }
  };

  const startParakeetModelDownload = async () => {
    if (parakeetModelBusy || parakeetModelStatus?.state === 'downloaded') return;
    setParakeetModelBusy(true);
    setParakeetModelStatus((current) => ({
      state: 'downloading',
      modelName: current?.modelName || 'parakeet-tdt-0.6b-v3',
      path: current?.path || '',
      progress: current?.progress || 0,
    }));
    try {
      const status = await window.electron.parakeetDownloadModel();
      setParakeetModelStatus(status);
    } catch {
      await refreshParakeetModelStatus();
    } finally {
      setParakeetModelBusy(false);
    }
  };

  // Step 4: auto-download the appropriate model
  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    let timer: number | null = null;

    const scheduleNextTick = (delay: number) => {
      timer = window.setTimeout(() => { void tick(); }, delay);
    };

    const tick = async () => {
      if (sttProvider === 'parakeet') {
        const status = await refreshParakeetModelStatus();
        if (cancelled) return;
        if (
          !parakeetModelBusy &&
          status &&
          (status.state === 'not-downloaded' || status.state === 'error')
        ) {
          void startParakeetModelDownload();
          scheduleNextTick(400);
          return;
        }
        if (parakeetModelBusy || status?.state === 'downloading') {
          scheduleNextTick(500);
        }
      } else if (sttProvider === 'whispercpp') {
        const status = await refreshWhisperCppModelStatus();
        if (cancelled) return;
        if (
          !whisperCppModelBusy &&
          status &&
          (status.state === 'not-downloaded' || status.state === 'error')
        ) {
          void startWhisperCppModelDownload();
          scheduleNextTick(400);
          return;
        }
        if (whisperCppModelBusy || status?.state === 'downloading') {
          scheduleNextTick(500);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [step, sttProvider, whisperCppModelBusy, parakeetModelBusy]);

  const whisperCppDownloadPercent = useMemo(() => {
    if (!whisperCppModelStatus || whisperCppModelStatus.state !== 'downloading' || !whisperCppModelStatus.totalBytes) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((whisperCppModelStatus.bytesDownloaded / whisperCppModelStatus.totalBytes) * 100)));
  }, [whisperCppModelStatus]);

  const parakeetDownloadPercent = useMemo(() => {
    if (!parakeetModelStatus || parakeetModelStatus.state !== 'downloading') return 0;
    return Math.max(0, Math.min(100, Math.round((parakeetModelStatus.progress || 0) * 100)));
  }, [parakeetModelStatus]);

  // Apply the default openAtLogin preference when the user first reaches the hotkey step.
  useEffect(() => {
    if (step !== 2) return;
    void window.electron.setOpenAtLogin(openAtLogin);
  }, [step === 2]);

  // Fix 4: Auto-refresh permission statuses when user returns from System Settings.
  useEffect(() => {
    if (step !== 3) return;
    const checkPermissions = async () => {
      try {
        const statuses = await window.electron.checkOnboardingPermissions();
        setOpenedPermissions((prev) => {
          const next = { ...prev };
          for (const [id, granted] of Object.entries(statuses)) {
            if (!granted) continue;
            // Avoid auto-marking Input Monitoring unless the user has already
            // initiated that row in onboarding.
            if (
              id === 'input-monitoring' &&
              !openedPermissionsRef.current[id] &&
              !requestedPermissionsRef.current[id]
            ) {
              continue;
            }
            next[id] = true;
          }
          return next;
        });
        setRequestedPermissions((prev) => {
          const next = { ...prev };
          for (const [id, granted] of Object.entries(statuses)) {
            if (!granted) continue;
            if (
              id === 'input-monitoring' &&
              !openedPermissionsRef.current[id] &&
              !requestedPermissionsRef.current[id]
            ) {
              continue;
            }
            next[id] = true;
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
    if (step !== 4) {
      setIsHoldKeyActive(false);
      return;
    }

    const holdKey = String(whisperHoldKey || '').trim().toLowerCase();
    const matchesHoldKey = (key: string) => {
      if (!holdKey) return false;
      if (holdKey === 'fn') {
        return key === 'Fn' || key === 'Function';
      }
      return key.toLowerCase() === holdKey;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (matchesHoldKey(event.key)) {
        setIsHoldKeyActive(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (matchesHoldKey(event.key)) {
        setIsHoldKeyActive(false);
      }
    };
    const handleWindowBlur = () => setIsHoldKeyActive(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      setIsHoldKeyActive(false);
    };
  }, [step, whisperHoldKey]);

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
    if (step !== STEPS.length - 1) return;
    finalStepHotkeyBaselineRef.current = onboardingHotkeyPresses;
  }, [step]);

  useEffect(() => {
    if (step !== STEPS.length - 1) return;
    if (onboardingHotkeyPresses <= finalStepHotkeyBaselineRef.current) return;
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
  const whisperKeyCaps = useMemo(() => toHotkeyCaps(whisperHoldKey), [whisperHoldKey]);

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
    const target = nextShortcut;
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
        setPermissionNotes((prev) => ({ ...prev, [id]: '' }));
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
      } else if (id === 'home-folder') {
        if (latestError) {
          setPermissionNotes((prev) => ({ ...prev, [id]: latestError }));
        } else if (!requested || mode === 'manual' || status === 'not-determined') {
          setPermissionNotes((prev) => ({
            ...prev,
            [id]: 'Select your Home folder when prompted, then enable SuperCmd under Files and Folders if needed.',
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
          : id === 'input-monitoring'
            ? [url, 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent']
            : id === 'home-folder'
              ? [url, 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_FilesAndFolders']
          : [url];
      try {
        await window.electron.setLauncherMode('onboarding');
      } catch {}
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
  const canContinue = step !== 2 || canCompleteOnboarding;
  const canFinish = canCompleteOnboarding;
  const contentBackground = step === 0
    ? 'var(--onboarding-content-bg-step0)'
    : 'var(--onboarding-content-bg-default)';

  return (
    <div className="w-full h-full onboarding-flow">
      <div
        className="glass-effect overflow-hidden h-full flex flex-col"
        style={{
          background: 'var(--onboarding-shell-bg)',
          WebkitBackdropFilter: 'blur(50px) saturate(165%)',
          backdropFilter: 'blur(50px) saturate(165%)',
        }}
      >
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.05]">
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
                  className="relative w-full aspect-square rounded-3xl overflow-hidden border border-white/[0.10]"
                  style={{
                    background: 'var(--onboarding-video-bg)',
                    boxShadow: 'var(--onboarding-video-shadow)',
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
                  className="relative rounded-3xl border border-white/[0.10] p-5 lg:p-6 flex flex-col gap-4 lg:h-[430px] self-center"
                  style={{
                    background: 'var(--onboarding-panel-bg)',
                    boxShadow: 'var(--onboarding-panel-shadow)',
                  }}
                >
                  <span className="inline-flex w-fit px-2.5 py-1 rounded-full border border-white/[0.12] bg-white/[0.06] text-[10px] tracking-[0.14em] uppercase text-white/82">
                    SuperCmd Setup
                  </span>
                  <h2 className="text-white text-[26px] lg:text-[30px] leading-[1.1] font-semibold max-w-xl">
                    One command surface for launch, ask, dictate, and read.
                  </h2>
                  <p className="text-white/72 text-[15px] leading-relaxed max-w-xl">
                    We will configure launcher hotkeys, privacy permissions, and whisper mode in one pass.
                  </p>
                  <div className="rounded-2xl border border-white/[0.07] bg-black/24 px-4 py-3">
                    <p className="text-white/88 text-sm mb-2">What gets configured now:</p>
                    <div className="text-white/72 text-sm space-y-1">
                      <p>1. Launcher hotkey</p>
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
                        className="group rounded-2xl border border-white/[0.08] p-4 transition-all duration-200 hover:translate-y-[-1px] hover:border-white/[0.14] hover:bg-white/[0.09]"
                        style={{
                          background: 'var(--onboarding-feature-card-bg)',
                          boxShadow: 'var(--onboarding-feature-card-shadow)',
                        }}
                      >
                        <div className="w-8 h-8 rounded-lg border border-white/[0.14] bg-white/10 flex items-center justify-center mb-2.5">
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
                  className="rounded-2xl border border-white/[0.10] p-7"
                  style={{
                    background: 'var(--onboarding-shortcut-card-bg)',
                    boxShadow: 'var(--onboarding-shortcut-card-shadow)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Keyboard className="w-4 h-4 text-rose-100" />
                    <p className="text-white/90 text-sm font-medium">Current Launcher Hotkey</p>
                  </div>
                  <p className="text-white/62 text-xs mb-5">
                    Configure your launcher key below. You can add AI Prompt and Memory hotkeys later from Settings.
                  </p>

                  <div className="flex flex-wrap items-center gap-2 mb-5">
                    {hotkeyCaps.map((cap) => (
                      <span
                        key={`${cap}-${shortcut}`}
                        className="inline-flex min-w-[38px] h-9 px-3 items-center justify-center rounded-lg border border-white/[0.14] bg-white/[0.12] text-white/95 text-sm font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.20)]"
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

                  <label className="flex items-center gap-2.5 mb-4 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={openAtLogin}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setOpenAtLogin(enabled);
                        void window.electron.setOpenAtLogin(enabled);
                      }}
                      className="settings-checkbox"
                    />
                    <span className="text-white/86 text-xs font-medium">Start SuperCmd at login</span>
                  </label>

                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.05] p-3.5">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <p className="text-white/86 text-xs font-medium">Replace Spotlight (Cmd + Space)</p>
                    </div>
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
                  className="rounded-3xl border border-white/[0.09] p-5"
                  style={{
                    background: 'var(--onboarding-permission-side-bg)',
                    boxShadow: 'var(--onboarding-permission-side-shadow)',
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

                <div className="rounded-3xl border border-white/[0.09] bg-white/[0.05] p-4 space-y-3">
                  {permissionTargets.map((target, index) => {
                    const Icon = target.icon;
                    const isDone = Boolean(openedPermissions[target.id]);
                    const isRequested = Boolean(requestedPermissions[target.id]);
                    const note = permissionNotes[target.id];
                    const permissionNoteClass = 'mt-1 pl-[60px] text-[11px]';
                    return (
                      <div
                        key={target.id}
                        className="rounded-2xl border p-3.5"
                        style={{
                          borderColor: isDone ? 'var(--onboarding-permission-border-done)' : 'var(--onboarding-permission-border-pending)',
                          background: isDone
                            ? 'var(--onboarding-permission-done-bg)'
                            : 'var(--onboarding-permission-pending-bg)',
                          boxShadow: isDone
                            ? 'var(--onboarding-permission-done-shadow)'
                            : 'var(--onboarding-permission-pending-shadow)',
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
                            className="inline-flex justify-center items-center gap-1.5 px-3 py-2 rounded-md border border-white/[0.12] bg-white/[0.10] hover:bg-white/[0.18] text-white text-xs font-medium transition-colors disabled:opacity-60 md:min-w-[190px]"
                          >
                            {permissionLoading[target.id] ? 'Requesting...' : 'Request Access'}
                          </button>
                        </div>
                        {!isDone && isRequested ? (
                          <p className={`${permissionNoteClass} text-amber-100/85`}>
                            Permission request sent. Enable SuperCmd in System Settings, then return.
                          </p>
                        ) : null}
                        {target.id === 'input-monitoring' ? (
                          <p className={`${permissionNoteClass} text-amber-700 dark:text-amber-100/85`}>
                            If SuperCmd is not visible here, click + and manually add SuperCmd from the Applications folder.
                          </p>
                        ) : null}
                        {target.id === 'home-folder' ? (
                          <p className={`${permissionNoteClass} text-white/52`}>
                            Pick your Home folder when prompted. This powers Search Files and launcher file results.
                          </p>
                        ) : null}
                        {!isDone && note ? (
                          <p className={`${permissionNoteClass} text-rose-100/85`}>
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
            <div className="max-w-5xl mx-auto min-h-full flex flex-col justify-center">
              <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6 w-full items-start">
                <div className="flex flex-col gap-3 lg:pt-3">
                  <div className="w-8 h-8 rounded-lg border border-cyan-200/25 bg-cyan-500/15 flex items-center justify-center">
                    <Mic className="w-4 h-4 text-cyan-100" />
                  </div>
                  <h3 className="text-white text-[26px] leading-[1.05] font-semibold">Dictation Mode</h3>
                  <div>
                    <p className="text-white/58 text-[9px] uppercase tracking-[0.08em] mb-1">How to test</p>
                    <p className="text-white/72 text-[11px] leading-relaxed">Hold key, read sample, release to insert.</p>
                  </div>
                  <div className="mt-2 flex items-center gap-3 flex-wrap">
                    <HotkeyRecorder value={whisperHoldKey} onChange={handleWhisperKeyChange} large active={isHoldKeyActive} />
                    {whisperKeyStatus === 'success' ? <span className="text-xs text-emerald-300">Hold key updated</span> : null}
                    {whisperKeyStatus === 'error' ? <span className="text-xs text-rose-300">Shortcut unavailable</span> : null}
                  </div>
                  <div className="space-y-1">
                    <p className="text-white/82 text-xs">Dictation language</p>
                    <select
                      value={speechLanguage}
                      onChange={(e) => { void handleSpeechLanguageChange(e.target.value); }}
                      className="w-full max-w-[200px] bg-white/[0.06] border border-white/[0.10] rounded-md px-2 py-1.5 text-xs text-white/92 focus:outline-none focus:border-cyan-300/70"
                    >
                      {SPEECH_LANGUAGE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-2 rounded-[28px] border border-white/[0.08] bg-white/[0.05] p-4">
                    {sttProvider === 'parakeet' ? (
                      <>
                        <p className="text-white/88 text-xs font-medium mb-1.5">Parakeet TDT v3</p>
                        {parakeetModelStatus?.state === 'downloaded' ? (
                          <p className="text-emerald-200 text-[11px] leading-relaxed">
                            Download complete. Parakeet v3 dictation is ready.
                          </p>
                        ) : parakeetModelStatus?.state === 'downloading' ? (
                          <div className="space-y-2.5">
                            <div className="space-y-1">
                              <p className="text-white/90 text-[11px] font-medium leading-relaxed">
                                Downloading models, just a moment.
                              </p>
                              <p className="text-white/62 text-[11px] leading-relaxed">
                                Downloading Parakeet v3 CoreML models
                                {parakeetDownloadPercent > 0 ? ` (${parakeetDownloadPercent}%)` : '...'}
                              </p>
                            </div>
                            <div
                              className="h-2.5 rounded-full bg-black/25 overflow-hidden ring-1 ring-inset ring-white/[0.06]"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={parakeetDownloadPercent > 0 ? parakeetDownloadPercent : undefined}
                              aria-label="Parakeet model download progress"
                            >
                              <div
                                className={parakeetDownloadPercent > 0
                                  ? 'h-full bg-cyan-300/80 transition-[width] duration-300'
                                  : 'h-full w-[34%] bg-cyan-300/70 animate-pulse'
                                }
                                style={parakeetDownloadPercent > 0
                                  ? { width: `${Math.max(6, parakeetDownloadPercent)}%` }
                                  : undefined
                                }
                              />
                            </div>
                          </div>
                        ) : parakeetModelStatus?.state === 'error' ? (
                          <p className="text-rose-200 text-[11px] leading-relaxed">
                            {parakeetModelStatus.error || 'Model download failed. Retry now or use Settings → AI → SuperCmd Whisper.'}
                          </p>
                        ) : (
                          <p className="text-white/72 text-[11px] leading-relaxed">
                            SuperCmd starts downloading Parakeet v3 models on this step so dictation is ready before first use.
                          </p>
                        )}
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => { void startParakeetModelDownload(); }}
                            disabled={parakeetModelBusy || parakeetModelStatus?.state === 'downloading' || parakeetModelStatus?.state === 'downloaded'}
                            className="inline-flex min-h-[32px] items-center justify-center rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors border border-white/[0.12] bg-white/[0.10] text-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {parakeetModelStatus?.state === 'downloaded'
                              ? 'Downloaded'
                              : parakeetModelStatus?.state === 'downloading'
                                ? 'Downloading...'
                                : 'Download Model'}
                          </button>
                        </div>
                      </>
                    ) : sttProvider === 'whispercpp' ? (
                      <>
                        <p className="text-white/88 text-xs font-medium mb-1.5">SuperCmd Whisper</p>
                        {whisperCppModelStatus?.state === 'downloaded' ? (
                          <p className="text-emerald-200 text-[11px] leading-relaxed">
                            Download complete. SuperCmd Whisper dictation is ready.
                          </p>
                        ) : whisperCppModelStatus?.state === 'downloading' ? (
                          <div className="space-y-2.5">
                            <div className="space-y-1">
                              <p className="text-white/90 text-[11px] font-medium leading-relaxed">
                                Downloading model, just a moment.
                              </p>
                              <p className="text-white/62 text-[11px] leading-relaxed">
                                Downloading the ~300 MB ggml base model
                                {whisperCppModelStatus.totalBytes ? ` (${whisperCppDownloadPercent}%)` : '...'}
                              </p>
                            </div>
                            <div
                              className="h-2.5 rounded-full bg-black/25 overflow-hidden ring-1 ring-inset ring-white/[0.06]"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={whisperCppModelStatus.totalBytes ? whisperCppDownloadPercent : undefined}
                              aria-label="Whisper model download progress"
                            >
                              <div
                                className={whisperCppModelStatus.totalBytes
                                  ? 'h-full bg-cyan-300/80 transition-[width] duration-300'
                                  : 'h-full w-[34%] bg-cyan-300/70 animate-pulse'
                                }
                                style={whisperCppModelStatus.totalBytes
                                  ? { width: `${Math.max(6, whisperCppDownloadPercent)}%` }
                                  : undefined
                                }
                              />
                            </div>
                          </div>
                        ) : whisperCppModelStatus?.state === 'error' ? (
                          <p className="text-rose-200 text-[11px] leading-relaxed">
                            {whisperCppModelStatus.error || 'Model download failed. Retry now or use Settings → AI → SuperCmd Whisper.'}
                          </p>
                        ) : (
                          <p className="text-white/72 text-[11px] leading-relaxed">
                            SuperCmd starts downloading the SuperCmd Whisper model on this step so dictation is ready before first use.
                          </p>
                        )}
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => { void startWhisperCppModelDownload(); }}
                            disabled={whisperCppModelBusy || whisperCppModelStatus?.state === 'downloading' || whisperCppModelStatus?.state === 'downloaded'}
                            className="inline-flex min-h-[32px] items-center justify-center rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors border border-white/[0.12] bg-white/[0.10] text-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {whisperCppModelStatus?.state === 'downloaded'
                              ? 'Downloaded'
                              : whisperCppModelStatus?.state === 'downloading'
                                ? 'Downloading...'
                                : 'Download Model'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-white/88 text-xs font-medium mb-1.5">Cloud Transcription</p>
                        <p className="text-emerald-200 text-[11px] leading-relaxed">
                          Using cloud-based transcription. No model download needed.
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <div className="self-start rounded-3xl border border-white/[0.09] p-3 bg-white/[0.04]">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/[0.12] text-white/85 text-xs mb-2">
                    <Mic className="w-3.5 h-3.5" />
                    Messages sample
                  </div>
                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.06] p-2.5 mb-2.5">
                    <p className="text-white/92 text-[15px] leading-relaxed">“{DICTATION_SAMPLE}”</p>
                  </div>
                  <p className="text-white/70 text-sm mb-2">Hold your key and read the message above:</p>
                  <textarea
                    value={dictationPracticeText}
                    onChange={(e) => onDictationPracticeTextChange(e.target.value)}
                    placeholder="Dictated text appears here..."
                    className="w-full h-[250px] resize-none rounded-xl border border-cyan-300/55 bg-white/[0.05] px-4 py-3 text-white/90 placeholder:text-white/40 text-base leading-relaxed outline-none shadow-[0_0_0_3px_rgba(34,211,238,0.15)]"
                  />
                  <p className="mt-2 text-[11px] text-white/40 leading-relaxed">
                    SuperCmd Whisper uses a local ggml base model by default. Apple Speech Recognition remains available as a fallback in Settings.
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-3xl">
                {/* Article card */}
                <div
                  className="rounded-2xl border border-white/[0.10] overflow-hidden"
                  style={{
                    background: 'var(--onboarding-read-card-bg)',
                    boxShadow: 'var(--onboarding-read-card-shadow)',
                  }}
                >
                  {/* Article header bar */}
                  <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.05] bg-white/[0.03]">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-rose-500/60" />
                      <div className="w-3 h-3 rounded-full bg-amber-400/60" />
                      <div className="w-3 h-3 rounded-full bg-emerald-400/60" />
                    </div>
                    <div className="flex-1 mx-3">
                      <div className="h-5 rounded-full border border-white/[0.07] bg-white/[0.05] flex items-center px-3 gap-2">
                        <div className="w-2.5 h-2.5 rounded-full border border-white/[0.12] bg-white/10 shrink-0" />
                        <span className="text-[10px] text-white/35 truncate">classic-literature.com/pride-and-prejudice</span>
                      </div>
                    </div>
                  </div>

                  {/* Article content */}
                  <div className="px-8 py-6">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-rose-200/25 bg-rose-500/15 text-[10px] text-rose-200/85 font-medium uppercase tracking-wider">
                        <Volume2 className="w-2.5 h-2.5" />
                        Classic Literature
                      </span>
                      <span className="text-white/28 text-[10px]">·</span>
                      <span className="text-white/38 text-[10px]">1 min read</span>
                    </div>

                    <h2 className="text-white/92 text-xl font-semibold mb-1 leading-snug">Pride and Prejudice</h2>
                    <p className="text-white/42 text-xs mb-4">Jane Austen · Chapter I · 1813</p>

                    <div className="w-10 h-px bg-white/[0.14] mb-4" />

                    <p className="text-white/88 text-[15px] leading-[1.75] select-text font-light">{READ_SAMPLE}</p>

                    <div className="mt-5 pt-4 border-t border-white/[0.05] flex items-center gap-2 flex-wrap">
                      <p className="text-white/45 text-xs">Select the text above then press</p>
                      {([
                        { symbol: '⌘', label: 'Cmd' },
                        { symbol: '⇧', label: 'Shift' },
                        { symbol: 'S', label: ''},
                      ] as Array<{ symbol: string; label: string | null }>).map((cap, i) => (
                        <React.Fragment key={`${cap.symbol}-${i}`}>
                          <span className="inline-flex items-center gap-2 min-w-[70px] h-9 px-3 rounded-md border border-white/[0.12] bg-white/[0.10] text-white/90 font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
                            <span className="inline-flex w-5 h-5 items-center justify-center rounded bg-white/[0.08] text-[11px] leading-none">
                              {cap.symbol}
                            </span>
                            <span className="text-[11px] text-white/72 leading-none">
                              {cap.label}
                            </span>
                          </span>
                          {i < 2 ? <span className="text-white/40 text-sm font-semibold">+</span> : null}
                        </React.Fragment>
                      ))}
                      <p className="text-white/45 text-xs">to hear it read aloud.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-3xl space-y-4">
                <div className="rounded-2xl border border-white/[0.10] bg-white/[0.06] p-6">
                  <p className="text-white text-xl font-semibold mb-2">Final step: start SuperCmd from anywhere</p>
                  <p className="text-white/68 text-sm leading-relaxed mb-4">
                    Press your global shortcut now to start SuperCmd from any app.
                  </p>

                  <div className="flex flex-wrap gap-2 mb-4">
                    {hotkeyCaps.map((cap) => (
                      <span
                        key={`${cap}-final-${shortcut}`}
                        className="inline-flex min-w-[38px] h-9 px-3 items-center justify-center rounded-lg border border-white/[0.14] bg-white/[0.12] text-white/95 text-sm font-medium"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                  <p className="text-white/46 text-xs leading-relaxed">
                    Next step: Setup Hotkeys for AI Prompt and Memory from SuperCmd Settings {'->'} Extensions to start using AI anywhere.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          className="px-5 py-3.5 border-t border-white/[0.04] flex items-center justify-between"
          style={{
            background: 'var(--onboarding-footer-bg)',
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.14] bg-gradient-to-r from-rose-500/70 to-red-500/70 hover:from-rose-500/85 hover:to-red-500/85 text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
