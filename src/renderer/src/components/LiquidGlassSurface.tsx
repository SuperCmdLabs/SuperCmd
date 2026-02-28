import React, { forwardRef } from 'react';
import LiquidGlass from 'liquid-glass-react';

type LiquidGlassMode = 'standard' | 'polar' | 'prominent' | 'shader';

interface LiquidGlassSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  contentClassName?: string;
  cornerRadius?: number;
  mode?: LiquidGlassMode;
  overLight?: boolean;
}

function joinClasses(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(' ');
}

const LiquidGlassSurface = forwardRef<HTMLDivElement, LiquidGlassSurfaceProps>(function LiquidGlassSurface(
  {
    children,
    className,
    contentClassName,
    style,
    cornerRadius = 16,
    mode = 'standard',
    overLight = false,
    ...rest
  },
  ref
) {
  return (
    <div
      ref={ref}
      className={joinClasses('sc-liquid-glass-surface', className)}
      style={style}
      {...rest}
    >
      <div className="sc-liquid-glass-shell" style={{ borderRadius: `${cornerRadius}px` }}>
        <div className="sc-liquid-glass-bg" aria-hidden="true">
          <LiquidGlass
            cornerRadius={cornerRadius}
            mode={mode}
            overLight={overLight}
            padding="0px"
            blurAmount={0.085}
            displacementScale={72}
            saturation={145}
            aberrationIntensity={1.4}
            elasticity={0}
            className="sc-liquid-glass-instance"
            style={{ width: '100%', height: '100%', position: 'relative', display: 'block' }}
          >
            <div className="sc-liquid-glass-fill" />
          </LiquidGlass>
        </div>
        <div className={joinClasses('sc-liquid-glass-content', contentClassName)}>{children}</div>
      </div>
    </div>
  );
});

export default LiquidGlassSurface;
