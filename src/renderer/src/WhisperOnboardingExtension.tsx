import React, { useEffect, useRef } from 'react';
import { ArrowLeft, Check } from 'lucide-react';

interface WhisperOnboardingExtensionProps {
  speakToggleShortcutLabel: string;
  practiceText: string;
  onPracticeTextChange: (value: string) => void;
  onClose: () => void;
  onComplete: () => void;
}

const SAMPLE_PRACTICE_TEXT =
  'Today I reviewed the roadmap and prioritized the top three tasks for this week. ' +
  'Please draft a short summary and share it with the team before lunch.';

const WhisperOnboardingExtension: React.FC<WhisperOnboardingExtensionProps> = ({
  speakToggleShortcutLabel,
  practiceText,
  onPracticeTextChange,
  onClose,
  onComplete,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      try {
        textareaRef.current?.focus();
      } catch {}
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <div className="w-full h-full">
      <div
        className="glass-effect overflow-hidden h-full flex flex-col"
        style={{
          background: 'var(--whisper-onboarding-shell-bg)',
          WebkitBackdropFilter: 'blur(42px) saturate(148%)',
          backdropFilter: 'blur(42px) saturate(148%)',
        }}
      >
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06]">
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/70 transition-colors p-0.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-white/90 text-[15px] font-medium truncate">Whisper Quick Onboarding</div>
            <div className="text-white/35 text-xs">Hold to record, release to type</div>
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto p-6"
          style={{
            background: 'var(--whisper-onboarding-page-bg)',
          }}
        >
          <div className="max-w-5xl mx-auto space-y-4">
            <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
              <div
                className="absolute inset-0 pointer-events-none rounded-xl"
                style={{
                  background: 'var(--whisper-onboarding-card-bg)',
                }}
              />
              <div className="relative z-10">
                <p className="text-white/90 text-base font-semibold mb-2">Hold to record, release to type</p>
                <p className="text-white/75 text-sm leading-relaxed">
                  Press and hold{' '}
                  <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.16] text-white/95">
                    {speakToggleShortcutLabel}
                  </kbd>{' '}
                  while speaking. Release it to process and type at your current cursor.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
              <p className="text-white/85 text-sm font-medium mb-2">Practice paragraph</p>
              <textarea
                ref={textareaRef}
                value={practiceText}
                onChange={(e) => onPracticeTextChange(e.target.value)}
                placeholder={SAMPLE_PRACTICE_TEXT}
                className="w-full h-64 resize-none rounded-lg border border-white/[0.10] bg-white/[0.03] px-4 py-3 text-white/90 placeholder:text-white/40 text-[20px] leading-relaxed outline-none"
              />
              <p className="text-white/45 text-xs mt-2">
                Practice in this editor: hold hotkey, speak these two sentences, release, and verify the output.
              </p>
            </div>
          </div>
        </div>

        <div className="sc-glass-footer px-4 py-3.5 flex items-center justify-between">
          <span className="text-xs text-white/45">Whisper stays near the bottom when active.</span>
          <button
            onClick={onComplete}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.16] hover:bg-white/[0.22] text-white text-xs font-medium transition-colors"
          >
            Finish
            <Check className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WhisperOnboardingExtension;
