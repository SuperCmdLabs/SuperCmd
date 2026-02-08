/**
 * HotkeyRecorder
 *
 * A component that captures keyboard shortcuts.
 * Click to start recording → press key combo → saves as Electron accelerator string.
 * Press Escape to cancel, Backspace/Delete to clear.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';

interface HotkeyRecorderProps {
  value: string;
  onChange: (hotkey: string) => void;
  compact?: boolean;
}

function keyEventToAccelerator(e: React.KeyboardEvent): string | null {
  const parts: string[] = [];

  if (e.metaKey) parts.push('Command');
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // Ignore standalone modifier keys
  const key = e.key;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null;

  // Map special keys to Electron accelerator names
  const keyMap: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ' ': 'Space',
    Enter: 'Return',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab',
    Escape: 'Escape',
  };

  const mappedKey = keyMap[key] || (key.length === 1 ? key.toUpperCase() : key);

  // Must have at least one modifier
  if (parts.length === 0) return null;

  parts.push(mappedKey);
  return parts.join('+');
}

function formatShortcut(shortcut: string): string {
  return shortcut
    .replace(/Command/g, '⌘')
    .replace(/Control/g, '⌃')
    .replace(/Alt/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, ' ');
}

const HotkeyRecorder: React.FC<HotkeyRecorderProps> = ({
  value,
  onChange,
  compact,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRecording && ref.current) {
      ref.current.focus();
    }
  }, [isRecording]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      setIsRecording(false);
      return;
    }

    // Backspace without modifiers = clear
    if (
      (e.key === 'Backspace' || e.key === 'Delete') &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      onChange('');
      setIsRecording(false);
      return;
    }

    const accelerator = keyEventToAccelerator(e);
    if (accelerator) {
      onChange(accelerator);
      setIsRecording(false);
    }
  };

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1">
        <div
          ref={ref}
          tabIndex={0}
          onClick={() => setIsRecording(true)}
          onKeyDown={isRecording ? handleKeyDown : undefined}
          onBlur={() => setIsRecording(false)}
          className={`
            inline-flex items-center justify-center px-2 py-0.5 rounded text-xs cursor-pointer
            transition-all select-none outline-none
            ${
              isRecording
                ? 'bg-blue-500/20 border border-blue-500/40 text-blue-400 min-w-[80px]'
                : value
                  ? 'bg-white/[0.06] border border-white/[0.08] text-white/60 hover:border-white/20'
                  : 'text-white/20 hover:text-white/40'
            }
          `}
        >
          {isRecording
            ? 'Type shortcut…'
            : value
              ? formatShortcut(value)
              : '—'}
        </div>
        {value && !isRecording && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange('');
              setIsRecording(false);
            }}
            className="w-5 h-5 rounded flex items-center justify-center text-red-300/75 hover:text-red-200 hover:bg-red-500/20 transition-colors"
            title="Remove hotkey"
            aria-label="Remove hotkey"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      tabIndex={0}
      onClick={() => setIsRecording(true)}
      onKeyDown={isRecording ? handleKeyDown : undefined}
      onBlur={() => setIsRecording(false)}
      className={`
        inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm cursor-pointer
        transition-all select-none outline-none
        ${
          isRecording
            ? 'bg-blue-500/20 border border-blue-500/40 text-blue-400'
            : 'bg-white/[0.06] border border-white/[0.08] text-white/70 hover:border-white/20'
        }
      `}
    >
      {isRecording ? (
        <span>Press a key combination…</span>
      ) : (
        <span className="font-mono">
          {value ? formatShortcut(value) : 'Click to record'}
        </span>
      )}
    </div>
  );
};

export default HotkeyRecorder;

