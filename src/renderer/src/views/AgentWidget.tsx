/**
 * AgentWidget — floating top-right panel that shows the agent's live progress.
 *
 * Visual language follows the Raycast-inspired DESIGN.md:
 *  - Near-black blue-tint background (#07080a) with a soft elevated card (#101111)
 *  - 1px rgba(255,255,255,0.06) containment borders; double-ring shadow
 *  - Inter with +0.2px letter-spacing and weight 500 baseline
 *  - Raycast Red for error accents, Raycast Blue for interactive hints
 *
 * The widget is rendered into a detached top-right popup window via
 * useDetachedPortalWindow — it lives outside the launcher window and stays
 * on top across spaces.
 */

import { createPortal } from 'react-dom';
import { useMemo } from 'react';
import { useDetachedPortalWindow } from '../useDetachedPortalWindow';
import type { AgentSession, AgentTimelineStep } from '../hooks/useAgentWidget';
import { useI18n } from '../i18n';

const WIDGET_NAME = 'supercmd-agent-window';
const WIDGET_WIDTH = 420;
const WIDGET_HEIGHT = 560;

interface AgentWidgetProps {
  session: AgentSession | null;
  isOpen: boolean;
  onCancel: () => void;
  onClose: () => void;
}

export function AgentWidget({ session, isOpen, onCancel, onClose }: AgentWidgetProps) {
  const portalTarget = useDetachedPortalWindow(isOpen && session !== null, {
    name: WIDGET_NAME,
    title: 'SuperCmd Agent',
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    anchor: 'top-right',
    onClosed: onClose,
  });

  if (!portalTarget || !session) return null;

  return createPortal(
    <AgentWidgetSurface session={session} onCancel={onCancel} onClose={onClose} />,
    portalTarget
  );
}

interface SurfaceProps {
  session: AgentSession;
  onCancel: () => void;
  onClose: () => void;
}

function AgentWidgetSurface({ session, onCancel, onClose }: SurfaceProps) {
  const { t } = useI18n();
  const running = session.lifecycle === 'running';

  const statusLabel = useMemo(() => {
    switch (session.lifecycle) {
      case 'running':
        return session.currentStep > 0
          ? t('agent.statusThinking', { step: session.currentStep })
          : t('agent.statusStarting');
      case 'done':
        return t('agent.statusDone');
      case 'cancelled':
        return t('agent.statusCancelled');
      case 'error':
        return t('agent.statusError');
      default:
        return t('agent.statusIdle');
    }
  }, [session.lifecycle, session.currentStep, t]);

  const accent = lifecycleAccent(session.lifecycle);

  return (
    <>
      <style>{`
        @keyframes scAgentPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.9); }
        }
        @keyframes scAgentSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        [data-sc-agent-widget="1"] ::-webkit-scrollbar { width: 8px; height: 8px; }
        [data-sc-agent-widget="1"] ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 4px;
        }
        [data-sc-agent-widget="1"] ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.14);
        }
        [data-sc-agent-widget="1"] ::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    <div
      data-sc-agent-widget="1"
      style={{
        width: '100%',
        height: '100%',
        fontFamily: "Inter, 'Inter Fallback', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
        fontFeatureSettings: "'calt' on, 'kern' on, 'liga' on, 'ss03' on",
        letterSpacing: '0.2px',
        color: '#f9f9f9',
        background: '#07080a',
        borderRadius: 16,
        // Double-ring containment: outer ring + inner inset, per DESIGN.md Level 2 + Level 5
        boxShadow: [
          'rgb(27, 28, 30) 0px 0px 0px 1px',
          'rgb(7, 8, 10) 0px 0px 0px 1px inset',
          'rgba(0, 0, 0, 0.5) 0px 30px 60px -20px',
          'rgba(255, 255, 255, 0.04) 0px 1px 0px 0px inset',
        ].join(', '),
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <StatusDot accent={accent} pulsing={running} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.2px', lineHeight: 1.1 }}>
            {t('agent.title')}
          </div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: '#9c9c9d',
              letterSpacing: '0.2px',
              marginTop: 2,
              lineHeight: 1.15,
            }}
          >
            {statusLabel}
          </div>
        </div>
        <HeaderButton
          onClick={running ? onCancel : onClose}
          label={running ? t('agent.cancel') : t('common.close')}
        />
      </div>

      {/* Query banner */}
      <div
        style={{
          padding: '12px 14px 10px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.6px',
            textTransform: 'uppercase',
            color: '#6a6b6c',
            marginBottom: 6,
          }}
        >
          {t('agent.queryLabel')}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: '#f9f9f9',
            letterSpacing: '0.2px',
            lineHeight: 1.4,
            wordBreak: 'break-word',
          }}
        >
          {session.query}
        </div>
      </div>

      {/* Timeline */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 14px 4px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {session.steps.length === 0 && session.lifecycle === 'running' && (
          <EmptyThinking label={t('agent.thinking')} />
        )}
        {session.steps.map((step, idx) => (
          <StepRow key={step.id} step={step} index={idx + 1} />
        ))}
        {session.message && (
          <FinalMessage text={session.message} accent={accent} />
        )}
        {session.error && (
          <ErrorBanner text={session.error} />
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '8px 14px 10px',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 11, color: '#6a6b6c', letterSpacing: '0.2px', fontWeight: 500 }}>
          {running
            ? t('agent.footerRunning', { step: Math.max(1, session.currentStep) })
            : t('agent.footerSteps', { count: session.steps.length })}
        </div>
        <KeyCap>{running ? t('agent.hotkeyCancel') : t('agent.hotkeyClose')}</KeyCap>
      </div>
    </div>
    </>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────

function StatusDot({ accent, pulsing }: { accent: string; pulsing: boolean }) {
  return (
    <div
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: accent,
        boxShadow: `0 0 0 2px ${hexToRgba(accent, 0.18)}`,
        animation: pulsing ? 'scAgentPulse 1.2s ease-in-out infinite' : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function HeaderButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.3px',
        color: '#cecece',
        padding: '4px 10px',
        borderRadius: 6,
        background: 'transparent',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: 'rgba(255, 255, 255, 0.05) 0px 1px 0px 0px inset',
        transition: 'opacity 120ms ease',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.6'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
    >
      {label}
    </button>
  );
}

function StepRow({ step, index }: { step: AgentTimelineStep; index: number }) {
  const accent = stepAccent(step);

  return (
    <div
      style={{
        background: '#101111',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 10,
        padding: '10px 12px',
        boxShadow: 'rgba(0, 0, 0, 0.28) 0px 1.189px 2.377px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StepIcon step={step} accent={accent} />
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.3px',
            color: '#cecece',
            textTransform: 'lowercase',
            flexShrink: 0,
          }}
        >
          {index}. {step.tool}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 500,
            color: '#f9f9f9',
            letterSpacing: '0.2px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={step.summary}
        >
          {step.summary}
        </div>
      </div>
      {step.output && (
        <pre
          style={{
            margin: '8px 0 0',
            padding: '8px 10px',
            background: '#07080a',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: 6,
            fontFamily: "GeistMono, ui-monospace, SFMono-Regular, 'Roboto Mono', Menlo, Monaco, monospace",
            fontSize: 11,
            lineHeight: 1.5,
            letterSpacing: '0.2px',
            color: step.status === 'error' ? '#ff9b9b' : '#c0c0c0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 140,
            overflowY: 'auto',
          }}
        >
          {clampOutput(step.output)}
        </pre>
      )}
    </div>
  );
}

function StepIcon({ step, accent }: { step: AgentTimelineStep; accent: string }) {
  if (step.status === 'running') {
    return (
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          border: `1.5px solid ${accent}`,
          borderTopColor: 'transparent',
          animation: 'scAgentSpin 0.9s linear infinite',
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 12,
        height: 12,
        borderRadius: 999,
        background: accent,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#07080a',
        fontSize: 9,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {step.status === 'error' ? '!' : '✓'}
    </div>
  );
}

function EmptyThinking({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 16px',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.2px',
        color: '#9c9c9d',
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          border: '1.5px solid hsl(202, 100%, 67%)',
          borderTopColor: 'transparent',
          animation: 'scAgentSpin 0.9s linear infinite',
        }}
      />
      {label}
    </div>
  );
}

function FinalMessage({ text, accent }: { text: string; accent: string }) {
  return (
    <div
      style={{
        marginTop: 6,
        padding: '12px 14px',
        background: '#101111',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderLeft: `2px solid ${accent}`,
        borderRadius: 10,
        boxShadow: `rgba(0, 0, 0, 0.28) 0px 1.189px 2.377px, ${hexToRgba(accent, 0.12)} 0px 0px 20px -4px`,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.6px',
          textTransform: 'uppercase',
          color: '#6a6b6c',
          marginBottom: 6,
        }}
      >
        Result
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: '#f9f9f9',
          letterSpacing: '0.2px',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: 6,
        padding: '10px 12px',
        background: '#101111',
        border: '1px solid hsla(0, 100%, 69%, 0.4)',
        borderRadius: 10,
        boxShadow: 'hsla(0, 100%, 69%, 0.15) 0px 0px 16px -4px',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.6px',
          textTransform: 'uppercase',
          color: '#FF6363',
          marginBottom: 4,
        }}
      >
        Error
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: '#f9f9f9',
          letterSpacing: '0.2px',
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: "GeistMono, ui-monospace, SFMono-Regular, 'Roboto Mono', Menlo, Monaco, monospace",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0,
        color: '#9c9c9d',
        padding: '2px 6px',
        borderRadius: 4,
        background: 'linear-gradient(to bottom, #121212, #0d0d0d)',
        boxShadow: [
          'rgba(0, 0, 0, 0.4) 0px 1.5px 0.5px 2.5px',
          'rgba(255, 255, 255, 0.06) 0px 1px 0px 0px inset',
          'rgba(0, 0, 0, 0.2) 0px -1px 0px 0px inset',
        ].join(', '),
      }}
    >
      {children}
    </kbd>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function lifecycleAccent(lifecycle: AgentSession['lifecycle']): string {
  switch (lifecycle) {
    case 'done':
      return 'hsl(151, 59%, 59%)'; // Raycast Green
    case 'error':
      return '#FF6363'; // Raycast Red
    case 'cancelled':
      return '#9c9c9d';
    case 'running':
    default:
      return 'hsl(202, 100%, 67%)'; // Raycast Blue
  }
}

function stepAccent(step: AgentTimelineStep): string {
  if (step.status === 'running') return 'hsl(202, 100%, 67%)';
  if (step.status === 'error') return '#FF6363';
  return 'hsl(151, 59%, 59%)';
}

function hexToRgba(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const bigint = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // hsl(...) or hsla(...) — inject alpha
  if (color.startsWith('hsl(')) {
    return color.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
  }
  return color;
}

function clampOutput(text: string): string {
  const MAX = 2400;
  if (text.length <= MAX) return text;
  return `${text.slice(0, MAX)}\n…[truncated ${text.length - MAX} chars]`;
}
