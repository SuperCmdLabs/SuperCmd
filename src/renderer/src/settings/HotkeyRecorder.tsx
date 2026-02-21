/**
 * HotkeyRecorder
 *
 * A component that captures keyboard shortcuts.
 * Click to start recording → press key combo → saves as Electron accelerator string.
 * Press Escape to cancel, Backspace/Delete to clear.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { formatShortcutForDisplay } from '../utils/hyper-key';

interface HotkeyRecorderProps {
  value: string;
  onChange: (hotkey: string) => void;
  compact?: boolean;
  large?: boolean;
  active?: boolean;
}

type KeyboardLikeEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'getModifierState'
>;

function isFnModifierPressed(e: KeyboardLikeEvent): boolean {
  return Boolean(e.getModifierState?.('Fn') || e.getModifierState?.('Function'));
}

function mapCodeToAcceleratorToken(code: string): string | null {
  if (!code) return null;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad') && code.length > 6) return code;
  if (/^F\d{1,2}$/i.test(code)) return code.toUpperCase();
  const codeMap: Record<string, string> = {
    Space: 'Space',
    Enter: 'Return',
    Tab: 'Tab',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    CapsLock: 'CapsLock',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  return codeMap[code] || null;
}

function keyEventToAccelerator(e: KeyboardLikeEvent): string | null {
  const parts: string[] = [];

  // Hyper support temporarily disabled.
  // const hasHyper = e.metaKey && e.ctrlKey && e.altKey && e.shiftKey;
  // if (hasHyper) {
  //   parts.push('Hyper');
  // } else {
  if (isFnModifierPressed(e)) parts.push('Fn');
  if (e.metaKey) parts.push('Command');
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  // }

  // Support fn/function as a standalone hold key for whisper dictation.
  if (e.key === 'Fn' || e.key === 'Function') return 'Fn';

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
    CapsLock: 'CapsLock',
    F1: 'F1',
    F2: 'F2',
    F3: 'F3',
    F4: 'F4',
    F5: 'F5',
    F6: 'F6',
    F7: 'F7',
    F8: 'F8',
    F9: 'F9',
    F10: 'F10',
    F11: 'F11',
    F12: 'F12',
  };

  const mappedKey =
    keyMap[key] ||
    (key.length === 1 ? key.toUpperCase() : null) ||
    mapCodeToAcceleratorToken(e.code) ||
    key;

  const allowWithoutModifier = /^F\d{1,2}$/i.test(mappedKey) || mappedKey === 'CapsLock' || mappedKey === 'Fn';
  if (parts.length === 0 && !allowWithoutModifier) return null;

  parts.push(mappedKey);
  return parts.join('+');
}

function mapKeyToAcceleratorToken(key: string): string | null {
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
    CapsLock: 'CapsLock',
    F1: 'F1',
    F2: 'F2',
    F3: 'F3',
    F4: 'F4',
    F5: 'F5',
    F6: 'F6',
    F7: 'F7',
    F8: 'F8',
    F9: 'F9',
    F10: 'F10',
    F11: 'F11',
    F12: 'F12',
  };
  if (!key) return null;
  const mapped = keyMap[key];
  if (mapped) return mapped;
  if (key.length === 1) return key.toUpperCase();
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null;
  return key;
}

function mapKeyboardEventToAcceleratorToken(e: KeyboardLikeEvent): string | null {
  const byKey = mapKeyToAcceleratorToken(e.key);
  if (byKey) return byKey;
  return mapCodeToAcceleratorToken(e.code);
}

function formatShortcut(shortcut: string): string {
  return formatShortcutForDisplay(shortcut);
}

const HotkeyRecorder: React.FC<HotkeyRecorderProps> = ({
  value,
  onChange,
  compact,
  large,
  active,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pendingPrimaryModifierRef = useRef<'Fn' | null>(null);
  const isRecordingRef = useRef(false);

  const clearPendingPrimary = () => {
    pendingPrimaryModifierRef.current = null;
  };

  useEffect(() => {
    if (isRecording && ref.current) {
      ref.current.focus();
    }
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    return () => {
      clearPendingPrimary();
    };
  }, []);

  const handleKeyDown = (e: KeyboardLikeEvent, preventDefault?: () => void) => {
    preventDefault?.();

    if (e.key === 'Escape') {
      clearPendingPrimary();
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
      clearPendingPrimary();
      setIsRecording(false);
      return;
    }

    // Fn is handled as a pending primary and committed on keyup if no combo key arrives.
    if (e.key === 'Fn' || e.key === 'Function') {
      const primary = 'Fn';
      clearPendingPrimary();
      pendingPrimaryModifierRef.current = primary;
      return;
    }

    const pendingPrimary = pendingPrimaryModifierRef.current;
    if (pendingPrimary) {
      const keyToken = mapKeyboardEventToAcceleratorToken(e);
      if (keyToken && keyToken !== pendingPrimary) {
        onChange(`Fn+${keyToken}`);
        clearPendingPrimary();
        setIsRecording(false);
        return;
      }
    }

    const accelerator = keyEventToAccelerator(e);
    if (accelerator) {
      onChange(accelerator);
      clearPendingPrimary();
      setIsRecording(false);
    }
  };

  const handleKeyUp = (e: KeyboardLikeEvent, preventDefault?: () => void) => {
    preventDefault?.();

    const pendingPrimary = pendingPrimaryModifierRef.current;
    if (!pendingPrimary) return;

    const releasedPrimary = (e.key === 'Fn' || e.key === 'Function' ? 'Fn' : null);
    if (!releasedPrimary || releasedPrimary !== pendingPrimary) return;

    onChange(pendingPrimary);
    clearPendingPrimary();
    setIsRecording(false);
  };

  useEffect(() => {
    if (!isRecording) return;

    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (!isRecordingRef.current) return;
      handleKeyDown(e, () => {
        e.preventDefault();
        e.stopPropagation();
      });
    };

    const onWindowKeyUp = (e: KeyboardEvent) => {
      if (!isRecordingRef.current) return;
      handleKeyUp(e, () => {
        e.preventDefault();
        e.stopPropagation();
      });
    };

    window.addEventListener('keydown', onWindowKeyDown, true);
    window.addEventListener('keyup', onWindowKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown, true);
      window.removeEventListener('keyup', onWindowKeyUp, true);
    };
  }, [isRecording]);

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1">
        <div
          ref={ref}
          tabIndex={0}
          onClick={() => setIsRecording(true)}
          onBlur={() => {
            clearPendingPrimary();
            setIsRecording(false);
          }}
          className={`
            inline-flex items-center justify-center px-2.5 py-1 rounded text-[13px] leading-none cursor-pointer
            transition-all select-none outline-none
            ${
              isRecording
                ? 'bg-blue-500/20 border border-blue-500/40 text-blue-400 min-w-[80px]'
                : active
                  ? 'bg-white/20 border border-white/70 text-white shadow-[0_0_0_2px_rgba(255,255,255,0.14),0_0_18px_rgba(255,255,255,0.28)]'
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
            className="w-6 h-6 rounded flex items-center justify-center text-red-300/75 hover:text-red-200 hover:bg-red-500/20 transition-colors"
            title="Remove hotkey"
            aria-label="Remove hotkey"
          >
            <Trash2 className="w-3.5 h-3.5" />
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
      onBlur={() => {
        clearPendingPrimary();
        setIsRecording(false);
      }}
      className={`
        inline-flex items-center gap-2 rounded-lg cursor-pointer
        transition-all select-none outline-none
        ${large ? 'px-6 py-3 text-base' : 'px-4 py-2 text-sm'}
        ${
          isRecording
            ? 'bg-blue-500/20 border border-blue-500/40 text-blue-400'
            : active
              ? 'bg-white/20 border border-white/70 text-white shadow-[0_0_0_2px_rgba(255,255,255,0.14),0_0_24px_rgba(255,255,255,0.26)]'
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
