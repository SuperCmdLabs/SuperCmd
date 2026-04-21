/**
 * ConfirmDeleteDialog.tsx
 *
 * Shared destructive-action confirmation dialog.
 * - Matches NotesManager's delete dialog styling (card over dimmed scrim)
 * - Enter confirms, Escape cancels (capture phase to beat editors/inputs)
 * - Confirm button autofocuses so keyboard input doesn't leak to whatever
 *   was active before the dialog opened
 */

import React, { useEffect, useRef } from 'react';

export interface ConfirmDeleteDialogProps {
  /** Heading text, e.g. "Delete Note" or "Delete Chat" */
  title: string;
  /**
   * Body text. Use `target` to highlight the subject name inline.
   * If `message` is supplied it is rendered verbatim.
   */
  message?: React.ReactNode;
  /** Highlighted target name injected into the default message. */
  target?: string;
  /** Confirm button label. Defaults to "Delete". */
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({
  title,
  message,
  target,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onConfirm, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="w-[320px] rounded-xl shadow-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(var(--card-bg), var(--card-bg)), var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1.5">{title}</h3>
          <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
            {message ?? (
              <>
                Are you sure you want to delete
                {target ? (
                  <>
                    {' "'}
                    <span className="text-[var(--text-secondary)]">{target}</span>
                    {'"'}
                  </>
                ) : (
                  ' this item'
                )}
                ? This action cannot be undone.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={() => onConfirm()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-white bg-red-400/70 hover:bg-red-400/90 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400/50"
          >
            {confirmLabel}
            <kbd className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded bg-white/15 text-[10px] font-medium">↩</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteDialog;
