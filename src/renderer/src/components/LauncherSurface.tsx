import React from 'react';
import {
  DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT,
  clampLauncherBackgroundPercent,
  launcherBackgroundBlurPercentToPx,
} from '../utils/launcher-background';

type LauncherSurfaceProps = {
  backgroundImageUrl: string;
  showBackground: boolean;
  backgroundBlurPercent: number;
  backgroundOpacityPercent: number;
  className?: string;
  children: React.ReactNode;
};

const LauncherSurface: React.FC<LauncherSurfaceProps> = ({
  backgroundImageUrl,
  showBackground,
  backgroundBlurPercent,
  backgroundOpacityPercent,
  className = '',
  children,
}) => {
  const backgroundOpacity = clampLauncherBackgroundPercent(
    backgroundOpacityPercent,
    DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT
  ) / 100;
  const backgroundBlurPx = launcherBackgroundBlurPercentToPx(backgroundBlurPercent);

  return (
    <div className="w-full h-full">
      <div className={`glass-effect overflow-hidden h-full flex flex-col relative ${className}`.trim()}>
        {showBackground && backgroundImageUrl ? (
          <div className="launcher-background-media" aria-hidden="true">
            <div
              className="launcher-background-image"
              style={
                {
                  backgroundImage: `url("${backgroundImageUrl}")`,
                  ['--launcher-background-opacity' as any]: String(backgroundOpacity),
                  ['--launcher-background-blur' as any]: `${backgroundBlurPx}px`,
                } as React.CSSProperties
              }
            />
            <div className="launcher-background-tint" />
          </div>
        ) : null}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
};

export default LauncherSurface;
