import React from 'react';
import { ArrowRight, CornerDownLeft } from 'lucide-react';
import type { CalcResult } from '../smart-calculator';
import { formatCalcKindLabel } from '../utils/launcher-misc';

type LauncherCalculatorCardProps = {
  result: CalcResult;
  selected: boolean;
  itemRef: (el: HTMLDivElement | null) => void;
  onCopy: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LauncherCalculatorCard: React.FC<LauncherCalculatorCardProps> = ({
  result,
  selected,
  itemRef,
  onCopy,
  t,
}) => (
  <div
    ref={itemRef}
    className={`mx-1 mt-0.5 mb-2 px-3 py-3 rounded-xl cursor-pointer transition-colors border ${
      selected
        ? 'bg-[color-mix(in_srgb,var(--launcher-card-selected-bg)_60%,transparent)] border-[color-mix(in_srgb,var(--launcher-card-selected-border)_60%,transparent)]'
        : 'bg-transparent border-[color-mix(in_srgb,var(--launcher-card-border)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--launcher-card-hover-bg)_50%,transparent)]'
    }`}
    onClick={onCopy}
  >
    <div className="relative">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="inline-flex items-center h-5 rounded-md border border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] px-1.5 text-[0.625rem] font-medium uppercase tracking-[0.12em] text-[var(--text-subtle)] leading-none">
            {formatCalcKindLabel(result.kind)}
          </div>
          <div className="text-[0.6875rem] text-[var(--text-muted)] leading-none">
            {selected ? t('launcher.calculator.pressEnterToCopy') : t('launcher.calculator.clickToCopy')}
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-1 text-[0.6875rem] text-[var(--text-subtle)] flex-shrink-0 pl-2">
          <CornerDownLeft className="w-3.5 h-3.5" />
          <span>{t('launcher.calculator.copy')}</span>
        </div>
      </div>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] flex items-center justify-center pointer-events-none">
        <ArrowRight className="w-4 h-4 text-[var(--text-muted)]" />
      </div>

      <div className="flex justify-center">
        <div className="inline-grid grid-cols-[minmax(0,240px)_auto_minmax(0,240px)] items-center gap-x-7">
          <div className="min-w-0 text-center">
            <div className="text-[0.6875rem] uppercase tracking-[0.12em] text-[var(--text-subtle)] truncate">
              {result.inputLabel}
            </div>
            <div
              className="mt-1 text-[1.15rem] leading-7 font-medium text-[var(--text-secondary)] text-center whitespace-normal break-words"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {result.input}
            </div>
          </div>

          <div />

          <div className="min-w-0 text-center">
            <div className="text-[0.6875rem] uppercase tracking-[0.12em] text-[var(--text-subtle)] truncate">
              {result.resultLabel}
            </div>
            <div
              className="mt-1 text-[1.15rem] leading-7 font-medium text-[var(--text-secondary)] text-center whitespace-normal break-words"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {result.result}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default LauncherCalculatorCard;
