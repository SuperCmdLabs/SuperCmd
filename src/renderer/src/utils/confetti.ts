let activeCanvas: HTMLCanvasElement | null = null;
let rafId: number | null = null;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rot: number;
  rotSpeed: number;
};

const COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#b8f2e6'];

function cleanup() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (activeCanvas) {
    activeCanvas.remove();
    activeCanvas = null;
  }
}

export function fireConfettiBurst(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  cleanup();

  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '2147483647';
  canvas.width = Math.max(1, Math.floor(window.innerWidth * window.devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * window.devicePixelRatio));
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  document.body.appendChild(canvas);
  activeCanvas = canvas;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    cleanup();
    return;
  }

  const centerX = canvas.width * 0.5;
  const centerY = canvas.height * 0.35;
  const gravity = 0.28 * window.devicePixelRatio;
  const particles: Particle[] = Array.from({ length: 170 }).map(() => {
    const angle = (Math.random() * Math.PI) + (Math.PI * 0.05);
    const speed = (7 + Math.random() * 9) * window.devicePixelRatio;
    return {
      x: centerX,
      y: centerY,
      vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
      vy: -Math.abs(Math.sin(angle) * speed) - (2.4 * window.devicePixelRatio),
      size: (4 + Math.random() * 7) * window.devicePixelRatio,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.22,
    };
  });

  const start = performance.now();
  const durationMs = 1600;

  const tick = (now: number) => {
    if (!activeCanvas || activeCanvas !== canvas) return;
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += gravity;
      p.vx *= 0.994;
      p.rot += p.rotSpeed;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size * 0.5, -p.size * 0.5, p.size, p.size * 0.62);
      ctx.restore();
    }

    if (elapsed < durationMs) {
      rafId = requestAnimationFrame(tick);
    } else {
      cleanup();
    }
  };

  rafId = requestAnimationFrame(tick);
}

