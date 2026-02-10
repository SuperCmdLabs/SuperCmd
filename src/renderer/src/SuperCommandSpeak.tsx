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

interface SuperCommandSpeakProps {
  status: SpeakStatus;
  onClose: () => void;
}

const SuperCommandSpeak: React.FC<SuperCommandSpeakProps> = ({ status, onClose }) => {
  if (typeof document === 'undefined') return null;
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
    document.body
  );
};

export default SuperCommandSpeak;
