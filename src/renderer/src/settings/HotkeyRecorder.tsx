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
  variant?: 'default' | 'whisper';
}

type KeyboardLikeEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'getModifierState'
>;
type PrimaryModifier = 'Fn' | 'Command' | 'Control' | 'Alt' | 'Shift';

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
    mapCodeToAcceleratorToken(e.code as string) ||
    keyMap[key] ||
    (key.length === 1 && key !== ' ' && key !== '\u00A0' ? key.toUpperCase() : null) ||
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
  const byCode = mapCodeToAcceleratorToken(e.code as string);
  if (byCode) return byCode;
  return mapKeyToAcceleratorToken(e.key);
}

function mapKeyboardEventToPrimaryModifier(e: KeyboardLikeEvent): PrimaryModifier | null {
  const key = String(e.key || '');
  if (key === 'Fn' || key === 'Function') return 'Fn';
  if (key === 'Meta') return 'Command';
  if (key === 'Control') return 'Control';
  if (key === 'Alt') return 'Alt';
  if (key === 'Shift') return 'Shift';
  return null;
}

function hasOtherModifierPressed(e: KeyboardLikeEvent, primary: PrimaryModifier): boolean {
  const hasMeta = e.metaKey && primary !== 'Command';
  const hasCtrl = e.ctrlKey && primary !== 'Control';
  const hasAlt = e.altKey && primary !== 'Alt';
  const hasShift = e.shiftKey && primary !== 'Shift';
  const hasFn = isFnModifierPressed(e) && primary !== 'Fn';
  return hasMeta || hasCtrl || hasAlt || hasShift || hasFn;
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
  variant = 'default',
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pendingPrimaryModifierRef = useRef<PrimaryModifier | null>(null);
  const isRecordingRef = useRef(false);
  const allowLocalShortcutCaptureRef = useRef(false);

  const clearPendingPrimary = () => {
    pendingPrimaryModifierRef.current = null;
  };

  const cancelGlobalCapture = () => {
    void window.electron.cancelGlobalHotkeyCapture().catch(() => {});
  };

  useEffect(() => {
    if (isRecording && ref.current) {
      ref.current.focus();
    }
    isRecordingRef.current = isRecording;
    if (isRecording) {
      allowLocalShortcutCaptureRef.current = false;
    }
  }, [isRecording]);

  useEffect(() => {
    return () => {
      clearPendingPrimary();
    };
  }, []);

  const handleKeyDown = (e: KeyboardLikeEvent, preventDefault?: () => void) => {
    preventDefault?.();

    if (e.key === 'Escape') {
      cancelGlobalCapture();
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
      cancelGlobalCapture();
      clearPendingPrimary();
      setIsRecording(false);
      return;
    }

    // Standalone modifier keys are committed on keyup unless a combo key arrives.
    const modifierPrimary = mapKeyboardEventToPrimaryModifier(e);
    if (modifierPrimary) {
      if (hasOtherModifierPressed(e, modifierPrimary)) {
        clearPendingPrimary();
      } else {
        clearPendingPrimary();
        pendingPrimaryModifierRef.current = modifierPrimary;
      }
      return;
    }

    const pendingPrimary = pendingPrimaryModifierRef.current;
    if (pendingPrimary) {
      const keyToken = mapKeyboardEventToAcceleratorToken(e);
      if (keyToken && keyToken !== pendingPrimary) {
        onChange(`${pendingPrimary}+${keyToken}`);
        cancelGlobalCapture();
        clearPendingPrimary();
        setIsRecording(false);
        return;
      }
    }

    const accelerator = keyEventToAccelerator(e);
    if (accelerator) {
      onChange(accelerator);
      cancelGlobalCapture();
      clearPendingPrimary();
      setIsRecording(false);
    }
  };

  const handleKeyUp = (e: KeyboardLikeEvent, preventDefault?: () => void) => {
    preventDefault?.();

    const pendingPrimary = pendingPrimaryModifierRef.current;
    if (!pendingPrimary) return;

    const releasedPrimary = mapKeyboardEventToPrimaryModifier(e);
    if (!releasedPrimary || releasedPrimary !== pendingPrimary) return;

    onChange(pendingPrimary);
    cancelGlobalCapture();
    clearPendingPrimary();
    setIsRecording(false);
  };

  useEffect(() => {
    if (!isRecording) return;
    let disposed = false;

    void window.electron
      .captureGlobalHotkey({ timeoutMs: 30_000 })
      .then((captured) => {
        if (disposed || !isRecordingRef.current) return;
        const shortcut = String(captured || '').trim();
        if (!shortcut) return;
        onChange(shortcut);
        clearPendingPrimary();
        setIsRecording(false);
      })
      .catch((error) => {
        if (disposed || !isRecordingRef.current) return;
        const message = String((error as any)?.message || error || '').toLowerCase();
        // Fall back to renderer-only capture only when main/global capture is unavailable.
        if (message.includes('unavailable')) {
          allowLocalShortcutCaptureRef.current = true;
        }
      });

    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (!isRecordingRef.current) return;
      const isControlKey =
        e.key === 'Escape' ||
        (
          (e.key === 'Backspace' || e.key === 'Delete') &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.shiftKey
        );
      if (!allowLocalShortcutCaptureRef.current && !isControlKey) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      handleKeyDown(e, () => {
        e.preventDefault();
        e.stopPropagation();
      });
    };

    const onWindowKeyUp = (e: KeyboardEvent) => {
      if (!isRecordingRef.current) return;
      if (!allowLocalShortcutCaptureRef.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      handleKeyUp(e, () => {
        e.preventDefault();
        e.stopPropagation();
      });
    };

    window.addEventListener('keydown', onWindowKeyDown, true);
    window.addEventListener('keyup', onWindowKeyUp, true);
    return () => {
      disposed = true;
      cancelGlobalCapture();
      window.removeEventListener('keydown', onWindowKeyDown, true);
      window.removeEventListener('keyup', onWindowKeyUp, true);
    };
  }, [isRecording, onChange]);

  if (compact) {
    const isWhisper = variant === 'whisper';
    return (
      <div className={`inline-flex items-center ${isWhisper ? 'gap-1.5' : 'gap-1'}`}>
        <div
          ref={ref}
          tabIndex={0}
          onClick={() => setIsRecording(true)}
          onBlur={() => {
            clearPendingPrimary();
            setIsRecording(false);
          }}
          className={`
            inline-flex items-center justify-center rounded text-[13px] leading-none cursor-pointer
            transition-all select-none outline-none
            ${isWhisper ? 'min-h-[34px] min-w-[84px] px-3 py-1.5 rounded-md text-[14px] font-medium' : 'px-2.5 py-1'}
            ${
              isRecording
                  ? isWhisper
                    ? 'bg-[var(--accent-soft)] border border-dashed border-[var(--accent)] text-[var(--accent)] min-w-[80px]'
                    : 'bg-blue-500/20 border border-blue-500/40 text-blue-400 min-w-[80px]'
                : active
                  ? isWhisper
                    ? 'bg-[var(--ui-segment-active-bg)] border border-dashed border-[var(--ui-segment-border)] text-[var(--text-primary)]'
                    : 'bg-[var(--ui-segment-active-bg)] border border-[var(--ui-divider)] text-[var(--text-primary)]'
                : value
                  ? isWhisper
                    ? 'bg-[var(--ui-segment-bg)] border border-dashed border-[var(--ui-segment-border)] text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)]'
                    : 'bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] text-[var(--text-secondary)] hover:border-[var(--ui-segment-border)]'
                  : isWhisper
                    ? 'bg-[var(--ui-segment-bg)] border border-dashed border-[var(--ui-segment-border)] text-[var(--text-muted)] hover:bg-[var(--ui-segment-hover-bg)]'
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
            className="w-6 h-6 rounded flex items-center justify-center text-[color:var(--status-danger-text)] hover:text-[color:var(--status-danger)] hover:bg-[color:var(--status-danger-soft)] transition-colors"
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
              ? 'bg-[var(--ui-segment-active-bg)] border border-[var(--ui-divider)] text-[var(--text-primary)]'
              : 'bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] text-[var(--text-secondary)] hover:border-[var(--ui-segment-border)]'
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
