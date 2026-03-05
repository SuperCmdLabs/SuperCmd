import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';

interface SpeakStatus {
  state: 'idle' | 'loading' | 'speaking' | 'paused' | 'done' | 'error';
  text: string;
  index: number;
  total: number;
  message?: string;
  wordIndex?: number;
}

interface SuperCmdReadProps {
  status: SpeakStatus;
  voice: string;
  voiceOptions: Array<{ value: string; label: string }>;
  rate: string;
  onVoiceChange: (voice: string) => void;
  onRateChange: (rate: string) => void;
  onPauseToggle: () => void;
  onPreviousParagraph: () => void;
  onNextParagraph: () => void;
  onClose: () => void;
  portalTarget?: HTMLElement | null;
}

const SPEED_PRESETS = [
  { value: '-15%', label: '0.85x' },
  { value: '+0%', label: '1.0x' },
  { value: '+15%', label: '1.15x' },
  { value: '+30%', label: '1.3x' },
];

const SuperCmdRead: React.FC<SuperCmdReadProps> = ({
  status,
  voice,
  voiceOptions,
  rate,
  onVoiceChange,
  onRateChange,
  onPauseToggle,
  onPreviousParagraph,
  onNextParagraph,
  onClose,
  portalTarget,
}) => {
  if (typeof document === 'undefined') return null;
  const target = portalTarget || document.body;
  if (!target) return null;
  const textScrollRef = useRef<HTMLDivElement | null>(null);

  const caption =
    status.state === 'speaking' || status.state === 'paused'
      ? `${status.index}/${status.total}`
      : status.state === 'loading'
        ? 'Preparing'
        : status.state === 'done'
          ? 'Done'
          : status.state === 'error'
            ? 'Error'
            : '';

  const mainText =
    status.state === 'speaking' || status.state === 'paused'
      ? status.text
      : status.message || (status.state === 'done' ? 'Finished reading selected text.' : 'Ready');

  const isPaused = status.state === 'paused';
  const isSessionActive =
    status.state === 'speaking' ||
    status.state === 'paused' ||
    status.state === 'loading';
  const canGoPrevious = isSessionActive && status.index > 1;
  const canGoNext = isSessionActive && status.index > 0 && status.index < status.total;

  const renderedText = useMemo(() => {
    const text = mainText;
    const wordIndex = status.state === 'speaking' || status.state === 'paused' ? status.wordIndex : undefined;
    if (typeof wordIndex !== 'number' || wordIndex < 0) {
      return text;
    }
    const tokens = text.split(/(\s+)/g);
    let currentWord = 0;
    return tokens.map((token, idx) => {
      if (!token.trim()) {
        return <span key={`sp-${idx}`}>{token}</span>;
      }
      const highlighted = currentWord === wordIndex;
      const thisWordIndex = currentWord;
      currentWord += 1;
      return (
        <span
          key={`wd-${idx}`}
          data-word-idx={thisWordIndex}
          className={highlighted ? 'speak-word-highlight' : undefined}
        >
          {token}
        </span>
      );
    });
  }, [mainText, status.state, status.wordIndex]);

  useEffect(() => {
    if (status.state !== 'speaking' || typeof status.wordIndex !== 'number') return;
    const root = textScrollRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-word-idx="${status.wordIndex}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [status.state, status.wordIndex]);

  return createPortal(
    <div className="speak-widget-host">
      <div className={`speak-widget-shell state-${status.state}`}>
        <div className="speak-header-row">
          <div className="speak-top-row">
            <div className="speak-beacon" aria-hidden="true" />
            <div className="speak-caption">{caption ? `Speak ${caption}` : 'Speak'}</div>
          </div>
          <div className="speak-controls">
            <button
              type="button"
              className="speak-action-button"
              onClick={onPreviousParagraph}
              disabled={!canGoPrevious}
              aria-label="Previous paragraph"
              title="Previous paragraph"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="speak-action-button"
              onMouseDown={(e) => {
                e.preventDefault();
                void onPauseToggle();
              }}
              onClick={(e) => {
                // Mouse path is handled on mousedown for faster response.
                // Keep keyboard activation (detail===0) working here.
                if (e.detail === 0) {
                  void onPauseToggle();
                } else {
                  e.preventDefault();
                }
              }}
              disabled={!isSessionActive}
              aria-label={isPaused ? 'Play' : 'Pause'}
              title={isPaused ? 'Play' : 'Pause'}
            >
              {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              className="speak-action-button"
              onClick={onNextParagraph}
              disabled={!canGoNext}
              aria-label="Next paragraph"
              title="Next paragraph"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
            <select
              className="speak-select speak-voice-select"
              value={voice}
              onChange={(e) => onVoiceChange(e.target.value)}
              aria-label="Voice"
            >
              {(voiceOptions.length > 0 ? voiceOptions : [{ value: voice, label: voice }]).map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              className="speak-select speak-speed-select"
              value={rate}
              onChange={(e) => onRateChange(e.target.value)}
              aria-label="Speed"
            >
              {SPEED_PRESETS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="speak-close-button"
            onClick={onClose}
            aria-label="Stop speak"
            title="Stop"
          >
            ×
          </button>
        </div>
        <div ref={textScrollRef} className="speak-text-wrap" role="status" aria-live="polite">
          <div className={`speak-main-text ${status.state === 'error' ? 'is-error' : ''}`}>
            {renderedText}
          </div>
        </div>
      </div>
    </div>,
    target
  );
};

export default SuperCmdRead;
