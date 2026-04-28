/**
 * AgentWidget — floating top-right panel that shows the agent's live progress.
 *
 * Each session gets a deterministic accent color hashed from its session id.
 * The surface is a dark canvas with a soft radial glow in that accent and a
 * very subtle film grain — so every run feels like a distinct, ambient card
 * rather than a stack of bordered boxes.
 *
 * Rendered into a detached top-right popup window via useDetachedPortalWindow.
 */

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useDetachedPortalWindow } from '../useDetachedPortalWindow';
import type { AgentSession, AgentTimelineStep } from '../hooks/useAgentWidget';
import { useI18n } from '../i18n';
import { AgentMarkdown } from './AgentMarkdown';

const WIDGET_NAME = 'supercmd-agent-window';
const WIDGET_WIDTH = 400;
const WIDGET_HEIGHT_COLLAPSED = 52;
const WIDGET_HEIGHT_EXPANDED = 560;

interface AgentWidgetProps {
  session: AgentSession | null;
  isOpen: boolean;
  onCancel: () => void;
  onClose: () => void;
  onApprove: (callId: string) => void;
  onDeny: (callId: string) => void;
}

export function AgentWidget({ session, isOpen, onCancel, onClose, onApprove, onDeny }: AgentWidgetProps) {
  // Caller keys this component on session.id, so each new session gets a
  // fresh mount with isExpanded = false — no stale carry-over from the
  // previous run.
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-expand when an approval prompt arrives so the user can see what's
  // about to run before clicking approve/deny.
  const pendingApprovalId = session?.pendingApproval?.id;
  useEffect(() => {
    if (pendingApprovalId) setIsExpanded(true);
  }, [pendingApprovalId]);

  const height = isExpanded ? WIDGET_HEIGHT_EXPANDED : WIDGET_HEIGHT_COLLAPSED;

  const portalTarget = useDetachedPortalWindow(isOpen && session !== null, {
    name: WIDGET_NAME,
    title: 'SuperCmd Agent',
    width: WIDGET_WIDTH,
    height,
    // Anchor as if fully expanded so toggling doesn't jump the window around.
    positionHeight: WIDGET_HEIGHT_EXPANDED,
    anchor: 'top-right',
    onClosed: onClose,
  });

  if (!portalTarget || !session) return null;

  return createPortal(
    <AgentWidgetSurface
      session={session}
      isExpanded={isExpanded}
      onToggleExpand={() => setIsExpanded((v) => !v)}
      onCancel={onCancel}
      onClose={onClose}
      onApprove={onApprove}
      onDeny={onDeny}
    />,
    portalTarget
  );
}

// ─── Accent (deterministic per-session) ──────────────────────────────

interface SessionAccent {
  /** Brightest stop of the radial glow. */
  glow: string;
  /** Mid-fade of the radial glow. */
  mid: string;
  /** Used for the final-answer accent line + step checks. */
  ink: string;
}

// Curated palette — soft, ambient, readable on very dark bg.
const ACCENT_PALETTE: SessionAccent[] = [
  { glow: 'hsla(22, 75%, 60%, 0.55)',  mid: 'hsla(22, 55%, 32%, 0.30)',  ink: 'hsl(22, 70%, 68%)'  }, // peach
  { glow: 'hsla(10, 75%, 60%, 0.55)',  mid: 'hsla(10, 55%, 32%, 0.30)',  ink: 'hsl(10, 70%, 68%)'  }, // coral
  { glow: 'hsla(348, 65%, 62%, 0.55)', mid: 'hsla(348, 45%, 32%, 0.30)', ink: 'hsl(348, 65%, 70%)' }, // rose
  { glow: 'hsla(285, 50%, 62%, 0.50)', mid: 'hsla(285, 35%, 32%, 0.28)', ink: 'hsl(285, 55%, 72%)' }, // orchid
  { glow: 'hsla(232, 55%, 65%, 0.50)', mid: 'hsla(232, 40%, 30%, 0.30)', ink: 'hsl(232, 65%, 74%)' }, // indigo
  { glow: 'hsla(200, 70%, 60%, 0.50)', mid: 'hsla(200, 50%, 30%, 0.30)', ink: 'hsl(200, 70%, 70%)' }, // sky
  { glow: 'hsla(172, 55%, 52%, 0.50)', mid: 'hsla(172, 40%, 25%, 0.30)', ink: 'hsl(172, 55%, 62%)' }, // teal
  { glow: 'hsla(150, 50%, 52%, 0.50)', mid: 'hsla(150, 38%, 26%, 0.28)', ink: 'hsl(150, 50%, 62%)' }, // emerald
  { glow: 'hsla(92, 45%, 55%, 0.48)',  mid: 'hsla(92, 32%, 28%, 0.26)',  ink: 'hsl(92, 45%, 66%)'  }, // olive
  { glow: 'hsla(42, 70%, 58%, 0.55)',  mid: 'hsla(42, 50%, 30%, 0.30)',  ink: 'hsl(42, 65%, 66%)'  }, // amber
];

function sessionAccent(seed: string): SessionAccent {
  // FNV-1a hash — deterministic, good spread on short strings.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ACCENT_PALETTE[(h >>> 0) % ACCENT_PALETTE.length];
}

// ─── Surface ─────────────────────────────────────────────────────────

interface SurfaceProps {
  session: AgentSession;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onCancel: () => void;
  onClose: () => void;
  onApprove: (callId: string) => void;
  onDeny: (callId: string) => void;
}

function AgentWidgetSurface({ session, isExpanded, onToggleExpand, onCancel, onClose, onApprove, onDeny }: SurfaceProps) {
  const { t } = useI18n();
  const running = session.lifecycle === 'running';
  const accent = useMemo(() => sessionAccent(session.id), [session.id]);

  const statusLabel = useMemo(() => {
    if (session.pendingApproval) return 'AWAITING APPROVAL';
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
  }, [session.lifecycle, session.currentStep, session.pendingApproval, t]);

  // One-line summary shown in the collapsed bar — the latest useful signal.
  const compactLine = useMemo(() => {
    if (session.error) return session.error;
    if (session.message) return session.message;
    const lastStep = session.steps[session.steps.length - 1];
    if (lastStep) return lastStep.summary;
    return session.query;
  }, [session.error, session.message, session.steps, session.query]);

  const statusDotColor = session.pendingApproval
    ? '#ffb27a'
    : lifecycleStatusColor(session.lifecycle, accent);

  return (
    <>
      <style>{`
        @keyframes scAgentPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes scAgentSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        [data-sc-agent-widget="1"] ::-webkit-scrollbar { width: 6px; height: 6px; }
        [data-sc-agent-widget="1"] ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 3px;
        }
        [data-sc-agent-widget="1"] ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.16);
        }
        [data-sc-agent-widget="1"] ::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      <div
        data-sc-agent-widget="1"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          fontFamily:
            "Inter, 'Inter Fallback', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
          fontFeatureSettings: "'calt' on, 'kern' on, 'liga' on, 'ss03' on",
          letterSpacing: '0.1px',
          color: '#f4f4f5',
          // Clean dark surface — flat, subtly lifted by the 1px border and a
          // hairline of light at the top edge for a glass-card feel.
          background: '#0d0d0f',
          borderRadius: isExpanded ? 14 : 12,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: [
            'rgba(0, 0, 0, 0.55) 0px 20px 50px -20px',
            'rgba(255, 255, 255, 0.05) 0px 1px 0px 0px inset',
          ].join(', '),
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          WebkitAppRegion: 'no-drag',
          transition: 'border-radius 160ms ease',
        } as React.CSSProperties}
      >

        {/* Compact bar — always visible. In collapsed mode this IS the whole
            widget; in expanded mode it acts as a header. */}
        <CompactBar
          statusDotColor={statusDotColor}
          running={running}
          statusLabel={statusLabel}
          compactLine={compactLine}
          isExpanded={isExpanded}
          showLineInBar={!isExpanded}
          onToggleExpand={onToggleExpand}
          onCancel={onCancel}
          onClose={onClose}
          cancelLabel={t('agent.cancel')}
          closeLabel={t('common.close')}
          expandLabel={isExpanded ? 'Collapse' : 'Expand'}
        />

        {/* Body — only rendered when expanded. */}
        {isExpanded && (
          <ExpandedBody
            session={session}
            accent={accent}
            running={running}
            thinkingLabel={t('agent.thinking')}
            footerRunningLabel={t('agent.footerRunning', { step: Math.max(1, session.currentStep) })}
            footerStepsLabel={t('agent.footerSteps', { count: session.steps.length })}
            hotkeyCancelLabel={t('agent.hotkeyCancel')}
            hotkeyCloseLabel={t('agent.hotkeyClose')}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        )}
      </div>
    </>
  );
}

interface ExpandedBodyProps {
  session: AgentSession;
  accent: SessionAccent;
  running: boolean;
  thinkingLabel: string;
  footerRunningLabel: string;
  footerStepsLabel: string;
  hotkeyCancelLabel: string;
  hotkeyCloseLabel: string;
  onApprove: (callId: string) => void;
  onDeny: (callId: string) => void;
}

function ExpandedBody({
  session,
  accent,
  running,
  thinkingLabel,
  footerRunningLabel,
  footerStepsLabel,
  hotkeyCancelLabel,
  hotkeyCloseLabel,
  onApprove,
  onDeny,
}: ExpandedBodyProps) {
  // Auto-expand the thinking accordion while running and on error so the user
  // can see what's happening; auto-collapse once the agent settles into a
  // clean done/cancelled state. User toggles override until next transition.
  const [isThinkingOpen, setIsThinkingOpen] = useState(true);
  useEffect(() => {
    if (session.lifecycle === 'done' || session.lifecycle === 'cancelled') {
      setIsThinkingOpen(false);
    } else if (session.lifecycle === 'error') {
      setIsThinkingOpen(true);
    }
  }, [session.lifecycle]);

  // final_answer is the terminal "I'm done" step — its message is already
  // shown as the Result above, so filtering it out avoids a duplicate.
  const visibleSteps = useMemo(
    () => session.steps.filter((s) => s.tool !== 'final_answer'),
    [session.steps],
  );
  const hasSteps = visibleSteps.length > 0;
  const showThinkingSection = hasSteps || running;
  const thinkingTitle = thinkingSectionTitle({
    lifecycle: session.lifecycle,
    stepCount: visibleSteps.length,
    currentStep: visibleSteps[visibleSteps.length - 1],
    runningLabel: thinkingLabel,
  });

  return (
    <>
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          flex: 1,
          minHeight: 0, // critical for flex child with overflow — without this
                        // the child grows to fit content and scroll never engages
          overflowY: 'auto',
          padding: '6px 18px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.35,
            letterSpacing: '-0.05px',
            color: '#f7f7f8',
            wordBreak: 'break-word',
          }}
        >
          {session.query}
        </div>

        {session.workingDir && <CwdChip path={session.workingDir} />}

        {session.pendingApproval && (
          <ApprovalPrompt
            pending={session.pendingApproval}
            accent={accent}
            onApprove={() => onApprove(session.pendingApproval!.id)}
            onDeny={() => onDeny(session.pendingApproval!.id)}
          />
        )}

        {/* Final answer / error pulled to the top so it's the first thing
            you see when scrolling. */}
        {session.message && <Result text={session.message} accent={accent} />}
        {session.error && <ErrorBlock text={session.error} />}

        {showThinkingSection && (
          <ThinkingSection
            title={thinkingTitle}
            isOpen={isThinkingOpen}
            onToggle={() => setIsThinkingOpen((v) => !v)}
            running={running}
            accent={accent}
          >
            {!hasSteps && running && <ThinkingRow label={thinkingLabel} />}
            {visibleSteps.map((step) => (
              <StepItem key={step.id} step={step} accent={accent} />
            ))}
          </ThinkingSection>
        )}
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 2,
          padding: '8px 14px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: 'rgba(244, 244, 245, 0.42)',
            letterSpacing: '0.4px',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          {running ? footerRunningLabel : footerStepsLabel}
        </div>
        <KeyCap>{running ? hotkeyCancelLabel : hotkeyCloseLabel}</KeyCap>
      </div>
    </>
  );
}

function thinkingSectionTitle({
  lifecycle,
  stepCount,
  currentStep,
  runningLabel,
}: {
  lifecycle: AgentSession['lifecycle'];
  stepCount: number;
  currentStep: AgentTimelineStep | undefined;
  runningLabel: string;
}): string {
  if (lifecycle === 'running') {
    if (currentStep) return `${runningLabel} · ${currentStep.tool}`;
    return runningLabel;
  }
  if (lifecycle === 'error') return `Failed after ${stepCount} step${stepCount === 1 ? '' : 's'}`;
  if (lifecycle === 'cancelled') return `Cancelled after ${stepCount} step${stepCount === 1 ? '' : 's'}`;
  // done
  return `Thought for ${stepCount} step${stepCount === 1 ? '' : 's'}`;
}

interface CompactBarProps {
  statusDotColor: string;
  running: boolean;
  statusLabel: string;
  compactLine: string;
  isExpanded: boolean;
  showLineInBar: boolean;
  onToggleExpand: () => void;
  onCancel: () => void;
  onClose: () => void;
  cancelLabel: string;
  closeLabel: string;
  expandLabel: string;
}

function CompactBar({
  statusDotColor,
  running,
  statusLabel,
  compactLine,
  isExpanded,
  showLineInBar,
  onToggleExpand,
  onCancel,
  onClose,
  cancelLabel,
  closeLabel,
  expandLabel,
}: CompactBarProps) {
  return (
    <div
      style={{
        position: 'relative',
        zIndex: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: isExpanded ? '10px 10px 4px 12px' : '0 8px 0 12px',
        height: isExpanded ? undefined : '100%',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <StatusDot color={statusDotColor} pulsing={running} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          lineHeight: 1.15,
        }}
      >
        <div
          style={{
            fontSize: showLineInBar ? 12.5 : 11,
            fontWeight: showLineInBar ? 600 : 500,
            letterSpacing: showLineInBar ? '0.1px' : '0.3px',
            color: showLineInBar ? '#f4f4f5' : 'rgba(244, 244, 245, 0.62)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={showLineInBar ? compactLine : undefined}
        >
          {showLineInBar ? compactLine : statusLabel}
        </div>
        {showLineInBar && (
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 500,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: 'rgba(244, 244, 245, 0.4)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: 1,
            }}
          >
            {statusLabel}
          </div>
        )}
      </div>
      <IconButton
        onClick={onToggleExpand}
        label={expandLabel}
        glyph={<ChevronGlyph direction={isExpanded ? 'up' : 'down'} />}
      />
      <GhostButton
        onClick={running ? onCancel : onClose}
        label={running ? cancelLabel : closeLabel}
      />
    </div>
  );
}

function IconButton({
  onClick,
  label,
  glyph,
}: {
  onClick: () => void;
  label: string;
  glyph: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        all: 'unset',
        cursor: 'pointer',
        width: 22,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        color: 'rgba(244, 244, 245, 0.66)',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        transition: 'background 120ms ease, color 120ms ease',
        WebkitAppRegion: 'no-drag',
        flexShrink: 0,
      } as React.CSSProperties}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.08)';
        (e.currentTarget as HTMLButtonElement).style.color = '#f7f7f8';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.04)';
        (e.currentTarget as HTMLButtonElement).style.color = 'rgba(244, 244, 245, 0.66)';
      }}
    >
      {glyph}
    </button>
  );
}

function ChevronGlyph({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      aria-hidden
      style={{
        transform: direction === 'up' ? 'rotate(180deg)' : 'none',
        transition: 'transform 160ms ease',
      }}
    >
      <path
        d="M3 4.5 L6 7.5 L9 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────

function StatusDot({ color, pulsing }: { color: string; pulsing: boolean }) {
  return (
    <div
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
        boxShadow: `0 0 0 3px ${tint(color, 0.2)}`,
        animation: pulsing ? 'scAgentPulse 1.4s ease-in-out infinite' : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function GhostButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.2px',
        color: 'rgba(244, 244, 245, 0.72)',
        padding: '3px 9px',
        borderRadius: 6,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        transition: 'background 120ms ease, color 120ms ease',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.08)';
        (e.currentTarget as HTMLButtonElement).style.color = '#f7f7f8';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.04)';
        (e.currentTarget as HTMLButtonElement).style.color = 'rgba(244, 244, 245, 0.72)';
      }}
    >
      {label}
    </button>
  );
}

function CwdChip({ path }: { path: string }) {
  return (
    <div
      title={path}
      style={{
        display: 'inline-flex',
        alignSelf: 'flex-start',
        alignItems: 'center',
        gap: 5,
        maxWidth: '100%',
        fontSize: 11,
        fontWeight: 500,
        color: 'rgba(244, 244, 245, 0.62)',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 5,
        padding: '3px 7px 3px 6px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        letterSpacing: '0.1px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      <FolderGlyph />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{prettyPath(path)}</span>
    </div>
  );
}

function FolderGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M1.5 3.25a.75.75 0 0 1 .75-.75h2.19c.2 0 .39.08.53.22l.72.72c.14.14.33.22.53.22h4.03a.75.75 0 0 1 .75.75v5.34a.75.75 0 0 1-.75.75h-8A.75.75 0 0 1 1.5 9.75z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StepItem({ step, accent }: { step: AgentTimelineStep; accent: SessionAccent }) {
  const elapsedSec = useElapsedSeconds(step.status === 'running' ? step.startedAt : null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <StepIcon step={step} accent={accent} />
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.2px',
            color: 'rgba(244, 244, 245, 0.54)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            flexShrink: 0,
          }}
        >
          {step.tool}
        </div>
        <div
          title={step.summary}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 500,
            color: 'rgba(244, 244, 245, 0.9)',
            letterSpacing: '0.1px',
            lineHeight: 1.35,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {step.summary}
        </div>
        {step.status === 'running' && elapsedSec >= 3 && (
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.3px',
              color: elapsedSec >= 10 ? '#ffb27a' : 'rgba(244, 244, 245, 0.45)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              flexShrink: 0,
            }}
            title="Elapsed time since this step started"
          >
            {elapsedSec}s
          </div>
        )}
      </div>
      {step.output && (
        <pre
          style={{
            margin: '2px 0 0 20px',
            padding: '7px 9px',
            background: 'rgba(0, 0, 0, 0.32)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: 6,
            fontFamily:
              "GeistMono, ui-monospace, SFMono-Regular, 'Roboto Mono', Menlo, Monaco, monospace",
            fontSize: 10.5,
            lineHeight: 1.5,
            letterSpacing: '0.1px',
            color: step.status === 'error' ? '#ffb1b1' : 'rgba(244, 244, 245, 0.75)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 'none',
            overflow: 'visible',
          }}
        >
          {clampOutput(step.output)}
        </pre>
      )}
    </div>
  );
}

function StepIcon({ step, accent }: { step: AgentTimelineStep; accent: SessionAccent }) {
  if (step.status === 'running') {
    return (
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          border: `1.5px solid ${accent.ink}`,
          borderTopColor: 'transparent',
          animation: 'scAgentSpin 0.9s linear infinite',
          flexShrink: 0,
          alignSelf: 'center',
        }}
      />
    );
  }
  if (step.status === 'error') {
    return (
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: '#FF6363',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#0a0a0c',
          fontSize: 8,
          fontWeight: 800,
          flexShrink: 0,
          alignSelf: 'center',
        }}
      >
        !
      </div>
    );
  }
  // ok
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      aria-hidden
      style={{ flexShrink: 0, alignSelf: 'center', color: accent.ink }}
    >
      <path
        d="M2.5 6.2l2.4 2.4 4.6-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThinkingSection({
  title,
  isOpen,
  onToggle,
  running,
  accent,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  running: boolean;
  accent: SessionAccent;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.07)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={onToggle}
        style={{
          all: 'unset',
          cursor: 'pointer',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          boxSizing: 'border-box',
          color: 'rgba(244, 244, 245, 0.62)',
          transition: 'color 120ms ease, background 120ms ease',
        } as React.CSSProperties}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'rgba(244, 244, 245, 0.85)';
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.02)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'rgba(244, 244, 245, 0.62)';
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        {running ? (
          <ThinkingShimmerDot accent={accent} />
        ) : (
          <SparkleGlyph />
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.1px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
        <ChevronGlyph direction={isOpen ? 'up' : 'down'} />
      </button>
      {isOpen && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '4px 10px 10px',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function ThinkingShimmerDot({ accent }: { accent: SessionAccent }) {
  return (
    <div
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: accent.ink,
        boxShadow: `0 0 8px ${accent.ink}`,
        animation: 'scAgentPulse 1.4s ease-in-out infinite',
        flexShrink: 0,
      }}
    />
  );
}

function SparkleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden style={{ flexShrink: 0 }}>
      <path
        d="M6 1.5 L6.9 4.6 L10 5.5 L6.9 6.4 L6 9.5 L5.1 6.4 L2 5.5 L5.1 4.6 Z"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  );
}

function ThinkingRow({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '2px 0',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.1px',
        color: 'rgba(244, 244, 245, 0.55)',
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          border: '1.5px solid rgba(244, 244, 245, 0.55)',
          borderTopColor: 'transparent',
          animation: 'scAgentSpin 0.9s linear infinite',
        }}
      />
      {label}
    </div>
  );
}

function ApprovalPrompt({
  pending,
  accent,
  onApprove,
  onDeny,
}: {
  pending: { id: string; tool: string; args: Record<string, any>; summary: string };
  accent: SessionAccent;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const preview = useMemo(() => formatApprovalPreview(pending.tool, pending.args), [pending.tool, pending.args]);
  return (
    <div
      role="alertdialog"
      style={{
        background: 'rgba(255, 170, 100, 0.06)',
        border: '1px solid rgba(255, 170, 100, 0.28)',
        borderRadius: 10,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden style={{ color: '#ffb27a', flexShrink: 0 }}>
          <path
            d="M8 1.5 L15 14 H1 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M8 6.5 V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="12" r="0.9" fill="currentColor" />
        </svg>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.6px',
            textTransform: 'uppercase',
            color: '#ffb27a',
          }}
        >
          Approve action?
        </div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: 'rgba(244,244,245,0.55)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            marginLeft: 'auto',
          }}
        >
          {pending.tool}
        </div>
      </div>
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          color: '#f7f7f8',
          lineHeight: 1.45,
          wordBreak: 'break-word',
        }}
      >
        {pending.summary}
      </div>
      {preview && (
        <pre
          style={{
            margin: 0,
            padding: '7px 9px',
            background: 'rgba(0, 0, 0, 0.32)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: 6,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 11,
            lineHeight: 1.45,
            color: 'rgba(244, 244, 245, 0.78)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 140,
            overflowY: 'auto',
          }}
        >
          {preview}
        </pre>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          onClick={onDeny}
          style={{
            all: 'unset',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 500,
            padding: '4px 10px',
            borderRadius: 5,
            color: 'rgba(244,244,245,0.72)',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          } as React.CSSProperties}
        >
          Deny
        </button>
        <button
          onClick={onApprove}
          style={{
            all: 'unset',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            padding: '4px 12px',
            borderRadius: 5,
            color: '#0b0b0d',
            background: accent.ink,
          } as React.CSSProperties}
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function formatApprovalPreview(tool: string, args: Record<string, any>): string {
  if (!args) return '';
  if (tool === 'run_shell') {
    const cmd = String(args.command || '');
    return args.cwd ? `cd ${args.cwd} && ${cmd}` : cmd;
  }
  if (tool === 'run_applescript') {
    return String(args.script || '').slice(0, 600);
  }
  if (tool === 'write_file') {
    const content = String(args.content || '');
    return `${args.path}\n\n${content.slice(0, 400)}${content.length > 400 ? '\n…' : ''}`;
  }
  if (tool === 'apply_patch') {
    return String(args.patch || '').slice(0, 600);
  }
  try {
    return JSON.stringify(args, null, 2).slice(0, 600);
  } catch {
    return '';
  }
}

function Result({ text, accent }: { text: string; accent: SessionAccent }) {
  return <AgentMarkdown text={text} accentInk={accent.ink} />;
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: 4,
        paddingLeft: 12,
        borderLeft: '2px solid #FF6363',
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
          color: '#FF8585',
          marginBottom: 6,
        }}
      >
        Error
      </div>
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          color: '#f7f7f8',
          letterSpacing: '0.1px',
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
        fontFamily:
          "GeistMono, ui-monospace, SFMono-Regular, 'Roboto Mono', Menlo, Monaco, monospace",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0,
        color: 'rgba(244, 244, 245, 0.7)',
        padding: '2px 6px',
        borderRadius: 4,
        background: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      {children}
    </kbd>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (startedAt == null) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function lifecycleStatusColor(lifecycle: AgentSession['lifecycle'], accent: SessionAccent): string {
  switch (lifecycle) {
    case 'done':
      return 'hsl(151, 59%, 59%)';
    case 'error':
      return '#FF6363';
    case 'cancelled':
      return 'rgba(244, 244, 245, 0.45)';
    case 'running':
    default:
      return accent.ink;
  }
}

// Inject/replace the alpha channel of any color string (hex, rgb(a), hsl(a)).
function tint(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith('hsla(') || color.startsWith('rgba(')) {
    return color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  }
  if (color.startsWith('hsl(')) {
    return color.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  return color;
}

function prettyPath(absPath: string): string {
  if (!absPath) return '';
  const match = absPath.match(/^\/Users\/[^/]+(?:\/(.*))?$/);
  if (match) return match[1] ? `~/${match[1]}` : '~';
  return absPath;
}

function clampOutput(text: string): string {
  const MAX = 2400;
  if (text.length <= MAX) return text;
  return `${text.slice(0, MAX)}\n…[truncated ${text.length - MAX} chars]`;
}
