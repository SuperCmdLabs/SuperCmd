import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

interface SpeakStatus {
  state: 'idle' | 'loading' | 'speaking' | 'done' | 'error';
  text: string;
  index: number;
  total: number;
  message?: string;
  wordIndex?: number;
}

interface SuperCmdReadProps {
  status: SpeakStatus;
  voice: string;
  rate: string;
  onVoiceChange: (voice: string) => void;
  onRateChange: (rate: string) => void;
  onClose: () => void;
  portalTarget?: HTMLElement | null;
}

const VOICE_PRESETS = [
  { value: 'en-US-JennyNeural', label: 'Jenny (US)' },
  { value: 'en-US-AriaNeural', label: 'Aria (US)' },
  { value: 'en-US-GuyNeural', label: 'Guy (US)' },
  { value: 'en-GB-SoniaNeural', label: 'Sonia (UK)' },
  { value: 'en-GB-RyanNeural', label: 'Ryan (UK)' },
];

const SPEED_PRESETS = [
  { value: '-15%', label: '0.85x' },
  { value: '+0%', label: '1.0x' },
  { value: '+15%', label: '1.15x' },
  { value: '+30%', label: '1.3x' },
];

const SuperCmdRead: React.FC<SuperCmdReadProps> = ({
  status,
  voice,
  rate,
  onVoiceChange,
  onRateChange,
  onClose,
  portalTarget,
}) => {
  if (typeof document === 'undefined') return null;
  const target = portalTarget || document.body;
  if (!target) return null;
  const textScrollRef = useRef<HTMLDivElement | null>(null);

  const caption =
    status.state === 'speaking'
      ? `${status.index}/${status.total}`
      : status.state === 'loading'
        ? 'Preparing'
        : status.state === 'done'
          ? 'Done'
          : status.state === 'error'
            ? 'Error'
            : '';

  const mainText =
    status.state === 'speaking'
      ? status.text
      : status.message || (status.state === 'done' ? 'Finished reading selected text.' : 'Ready');

  const renderedText = useMemo(() => {
    const text = mainText;
    const wordIndex = status.state === 'speaking' ? status.wordIndex : undefined;
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
            <select
              className="speak-select"
              value={voice}
              onChange={(e) => onVoiceChange(e.target.value)}
              aria-label="Voice"
            >
              {VOICE_PRESETS.map((opt) => (
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
