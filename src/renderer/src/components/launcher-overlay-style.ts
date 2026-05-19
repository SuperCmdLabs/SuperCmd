import type React from 'react';

export function getLauncherFloatingPanelStyle(
  isNativeLiquidGlass: boolean,
  isGlassyTheme: boolean
): React.CSSProperties {
  return {
    ...(isNativeLiquidGlass
      ? {
          background: 'rgba(var(--surface-base-rgb), 0.72)',
          backdropFilter: 'blur(44px) saturate(155%)',
          WebkitBackdropFilter: 'blur(44px) saturate(155%)',
          border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
          boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26)',
        }
      : isGlassyTheme
      ? {
          background:
            'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
          backdropFilter: 'blur(96px) saturate(190%)',
          WebkitBackdropFilter: 'blur(96px) saturate(190%)',
          border: '1px solid rgba(var(--on-surface-rgb), 0.05)',
        }
      : {
          background: 'var(--card-bg)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          border: '1px solid var(--border-primary)',
        }),
    outline: 'none',
  };
}

export function getQuickLinkPromptPanelStyle(
  isNativeLiquidGlass: boolean,
  isGlassyTheme: boolean
): React.CSSProperties {
  return isNativeLiquidGlass
    ? {
        background: 'rgba(var(--surface-base-rgb), 0.72)',
        backdropFilter: 'blur(44px) saturate(155%)',
        WebkitBackdropFilter: 'blur(44px) saturate(155%)',
        border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
        boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26)',
      }
    : isGlassyTheme
    ? {
        background: 'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
        backdropFilter: 'blur(96px) saturate(190%)',
        WebkitBackdropFilter: 'blur(96px) saturate(190%)',
        border: '1px solid var(--ui-panel-border)',
      }
    : {
        background: 'var(--bg-overlay-strong)',
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
        border: '1px solid var(--snippet-divider)',
      };
}
