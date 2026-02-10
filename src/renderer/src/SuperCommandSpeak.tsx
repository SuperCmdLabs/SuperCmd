import React from 'react';
import { createPortal } from 'react-dom';

interface SpeakStatus {
  state: 'idle' | 'loading' | 'speaking' | 'done' | 'error';
  text: string;
  index: number;
  total: number;
  message?: string;
}

interface SuperCommandSpeakProps {
  status: SpeakStatus;
  onClose: () => void;
}

const SuperCommandSpeak: React.FC<SuperCommandSpeakProps> = ({ status, onClose }) => {
  if (typeof document === 'undefined') return null;

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

  return createPortal(
    <div className="speak-widget-host">
      <div className="speak-widget-shell">
        <button
          type="button"
          className="speak-close-button"
          onClick={onClose}
          aria-label="Stop speak"
          title="Stop"
        >
          ×
        </button>
        <div className="speak-text-wrap">
          {caption ? <div className="speak-caption">{caption}</div> : null}
          <div className={`speak-main-text ${status.state === 'error' ? 'is-error' : ''}`}>
            {mainText}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SuperCommandSpeak;
