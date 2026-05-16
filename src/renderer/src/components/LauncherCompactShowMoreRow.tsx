import React from 'react';
import { ArrowDown } from 'lucide-react';

type LauncherCompactShowMoreRowProps = {
  logoSrc: string;
  onShowMore: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LauncherCompactShowMoreRow: React.FC<LauncherCompactShowMoreRowProps> = ({
  logoSrc,
  onShowMore,
  t,
}) => (
  <div
    className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-[var(--ui-segment-hover-bg)] transition-colors border-t border-[var(--ui-divider)]"
    onClick={onShowMore}
  >
    <div className="flex items-center gap-2 text-[var(--text-muted)]">
      <img src={logoSrc} alt="SuperCmd" className="w-4 h-4" />
    </div>
    <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
      <span className="text-xs font-medium">{t('launcher.compact.showMore')}</span>
      <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-[var(--kbd-bg)] text-[var(--text-subtle)]">
        <ArrowDown className="w-3 h-3" />
      </kbd>
    </div>
  </div>
);

export default LauncherCompactShowMoreRow;
