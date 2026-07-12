declare module 'liquid-glass-react' {
  import type React from 'react';

  export type LiquidGlassMode = 'standard' | 'polar' | 'prominent' | 'shader';

  export interface LiquidGlassProps {
    children?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    cornerRadius?: number;
    mode?: LiquidGlassMode;
    overLight?: boolean;
    padding?: string | number;
    blurAmount?: number;
    displacementScale?: number;
    saturation?: number;
    aberrationIntensity?: number;
    elasticity?: number;
  }

  const LiquidGlass: React.FC<LiquidGlassProps>;
  export default LiquidGlass;
}
