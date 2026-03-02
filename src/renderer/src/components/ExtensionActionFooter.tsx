import React from 'react';

interface FooterAction {
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  shortcut?: string[];
}

interface ExtensionActionFooterProps {
  leftContent?: React.ReactNode;
  primaryAction?: FooterAction;
  actionsButton: FooterAction;
}

const KEY_CLASS =
  'inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium';

const ExtensionActionFooter: React.FC<ExtensionActionFooterProps> = ({
  leftContent,
  primaryAction,
  actionsButton,
}) => {
  const primaryVisible = Boolean(primaryAction?.label);
  const showDivider = primaryVisible;

  return (
    <div
      className="sc-glass-footer flex items-center px-4 py-2.5"
    >
      <div className="flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-normal">{leftContent}</div>

      <div className="flex items-center gap-2">
        {primaryVisible && primaryAction ? (
          <button
            onClick={() => {
              if (!primaryAction.disabled) {
                void Promise.resolve(primaryAction.onClick());
              }
            }}
            disabled={primaryAction.disabled}
            className="flex items-center gap-1.5 text-[var(--text-primary)] hover:text-[var(--text-secondary)] disabled:text-[var(--text-disabled)] transition-colors"
          >
            <span className="text-xs font-normal truncate max-w-[220px]">{primaryAction.label}</span>
            {(primaryAction.shortcut || ['↩']).map((key) => (
              <kbd key={`primary-${key}`} className={KEY_CLASS}>
                {key}
              </kbd>
            ))}
          </button>
        ) : null}

        {showDivider ? <span className="h-5 w-px bg-[var(--ui-divider)] mx-1" /> : null}

        <button
          onClick={() => void Promise.resolve(actionsButton.onClick())}
          disabled={actionsButton.disabled}
          className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:text-[var(--text-disabled)] transition-colors"
        >
          <span className="text-xs font-normal">{actionsButton.label}</span>
          {(actionsButton.shortcut || ['⌘', 'K']).map((key) => (
            <kbd key={`actions-${key}`} className={KEY_CLASS}>
              {key}
            </kbd>
          ))}
        </button>
      </div>
    </div>
  );
};

export default ExtensionActionFooter;
