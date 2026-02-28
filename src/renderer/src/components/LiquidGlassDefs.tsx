import React from 'react';

const LiquidGlassDefs: React.FC = () => (
  <svg className="sc-liquid-glass-defs" aria-hidden="true" width="0" height="0">
    <filter id="sc-liquid-glass" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="2" result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="16" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
);

export default LiquidGlassDefs;
