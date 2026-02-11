import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Keyboard, Mic, Sparkles, Volume2 } from 'lucide-react';

interface WhisperOnboardingExtensionProps {
  speakToggleShortcutLabel: string;
  onClose: () => void;
  onComplete: () => void;
}

const practiceSentences = [
  'Schedule a design review for Thursday at 2 PM.',
  'Summarize today\'s standup notes and send them to the team.',
  'Create a checklist for launching the next release candidate.',
];

const WhisperOnboardingExtension: React.FC<WhisperOnboardingExtensionProps> = ({
  speakToggleShortcutLabel,
  onClose,
  onComplete,
}) => {
  const [step, setStep] = useState(0);
  const [checkedSamples, setCheckedSamples] = useState<Record<number, boolean>>({});

  const stepTitle = useMemo(() => {
    if (step === 0) return 'Whisper Basics';
    if (step === 1) return 'Hold-To-Talk Hotkey';
    return 'Practice Dictation';
  }, [step]);

  const allSamplesChecked = practiceSentences.every((_, idx) => Boolean(checkedSamples[idx]));

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
              'radial-gradient(circle at 15% 8%, rgba(77, 196, 255, 0.10), transparent 42%), radial-gradient(circle at 84% 0%, rgba(143, 255, 188, 0.09), transparent 38%), transparent',
          }}
        >
          {step === 0 && (
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="rounded-xl border border-white/[0.10] bg-white/[0.03] p-5">
                <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-300/20 flex items-center justify-center mb-3">
                  <Mic className="w-5 h-5 text-sky-300/90" />
                </div>
                <p className="text-white/90 text-lg font-semibold mb-2">Use Whisper without moving your hands off the keyboard</p>
                <p className="text-white/55 text-sm leading-relaxed">
                  Keep your cursor in any editor, hold the Whisper hotkey to record, then release to transcribe and type.
                  The floating widget stays near the bottom and should not steal focus.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 mb-2 text-white/80 text-sm font-medium">
                  <Sparkles className="w-4 h-4 text-cyan-300/85" />
                  What to watch for
                </div>
                <p className="text-white/50 text-xs leading-relaxed">
                  1) Hold hotkey: recording starts with a soft chime.
                  {' '}2) Release hotkey: processing starts and text appears at your current cursor.
                  {' '}3) Widget stays open until you close it.
                </p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="rounded-xl border border-white/[0.10] bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Keyboard className="w-4 h-4 text-white/70" />
                  <p className="text-white/85 text-sm font-medium">Hold-To-Talk Shortcut</p>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.18] bg-black/30">
                  <kbd className="text-xs text-white/90 font-mono">{speakToggleShortcutLabel}</kbd>
                </div>
                <p className="text-white/50 text-xs mt-3 leading-relaxed">
                  Press and hold this key combo to record. Release it to transcribe.
                  You can change it later in Settings {'->'} AI {'->'} SuperCommand Whisper.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Volume2 className="w-4 h-4 text-emerald-300/85" />
                  <p className="text-white/80 text-sm font-medium">Audio cues</p>
                </div>
                <p className="text-white/50 text-xs">
                  A subtle tone plays when recording starts and another when it stops, so you can dictate without looking.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="rounded-xl border border-white/[0.10] bg-white/[0.03] p-5">
                <p className="text-white/88 text-sm font-medium mb-2">Practice 3 short dictations</p>
                <p className="text-white/50 text-xs mb-4">Hold hotkey, speak one sentence, release, then verify it typed correctly.</p>
                <div className="space-y-2">
                  {practiceSentences.map((sentence, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCheckedSamples((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                        checkedSamples[idx]
                          ? 'border-emerald-300/35 bg-emerald-500/12'
                          : 'border-white/[0.10] bg-white/[0.03] hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center ${checkedSamples[idx] ? 'border-emerald-300/45' : 'border-white/25'}`}>
                          {checkedSamples[idx] ? <Check className="w-3 h-3 text-emerald-300" /> : null}
                        </span>
                        <span className="text-white/85 text-sm leading-relaxed">{sentence}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3.5 border-t border-white/[0.06] flex items-center justify-between" style={{ background: 'rgba(28,28,32,0.90)' }}>
          <button
            onClick={step === 0 ? onClose : () => setStep((prev) => Math.max(prev - 1, 0))}
            className="px-3 py-1.5 rounded-md text-xs text-white/55 hover:text-white/80 hover:bg-white/[0.08] transition-colors"
          >
            {step === 0 ? 'Close' : 'Back'}
          </button>
          <button
            onClick={step === 2 ? onComplete : () => setStep((prev) => Math.min(prev + 1, 2))}
            disabled={step === 2 && !allSamplesChecked}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.14] hover:bg-white/[0.20] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
          >
            {step === 2 ? 'Finish Whisper Setup' : 'Continue'}
            {step === 2 ? <Check className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WhisperOnboardingExtension;
