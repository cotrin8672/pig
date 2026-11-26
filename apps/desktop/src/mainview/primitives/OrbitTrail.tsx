import { useEffect, useRef } from "react";
import { CURVES } from "./curves";
import { ORBITS, type Orbit } from "./three-body";

export const FIGURES = { ...ORBITS, ...CURVES };
export type Figure = keyof typeof FIGURES;

const cache = new Map<Figure, Orbit>();

/** Dots moving along precomputed paths, each trailing a hairline that fades with age. */
export function OrbitTrail({ figure }: { figure: Figure }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let data = cache.get(figure);
    if (!data) {
      data = FIGURES[figure]();
      cache.set(figure, data);
    }
    const { bodies, seconds } = data;
    const n = bodies[0].length;
    const trail = Math.round(data.trail * n);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let frame = 0;

    const draw = (now: number) => {
      const dpr = devicePixelRatio;
      const size = canvas.clientWidth * dpr;
      if (canvas.width !== size) canvas.width = canvas.height = size;
      // Floors in device px keep the trail visible at the inline (~17px) size.
      const dot = Math.max(size * 0.055, 1.5 * dpr);
      const line = Math.max(size * 0.018, 0.9 * dpr);
      const half = size / 2 - dot;
      const jump = half * 0.5; // longer steps are a loop seam, not motion
      const at = (b: number, i: number) => {
        const [x, y] = bodies[b][((i % n) + n) % n];
        return [size / 2 + x * half, size / 2 + y * half] as const;
      };
      const t = still ? n / 3 : (((now - start) / 1000 / seconds) * n) % n;
      const head = Math.floor(t);
      const pos = bodies.map((_, b) => {
        const [x0, y0] = at(b, head);
        const [x1, y1] = at(b, head + 1);
        const frac = Math.hypot(x1 - x0, y1 - y0) > jump ? 0 : t - head;
        return [x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac] as const;
      });

      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = ctx.fillStyle = getComputedStyle(canvas).color;
      ctx.lineCap = "butt"; // round caps overlap and bead under alpha
      ctx.lineWidth = line;
      for (let b = 0; b < bodies.length; b++) {
        let [px, py] = pos[b];
        // A thin hairline that starts a little behind the dot, so the two read as separate.
        let gap = dot * 1.8;
        for (let k = 0; k < trail; k++) {
          const [x, y] = at(b, head - k);
          const step = Math.hypot(x - px, y - py);
          if (step > jump) break;
          if (gap > 0) {
            gap -= step;
            [px, py] = [x, y];
            continue;
          }
          const fade = 1 - k / trail;
          ctx.globalAlpha = fade ** 1.5 * 0.8;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(x, y);
          ctx.stroke();
          [px, py] = [x, y];
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(...pos[b], dot, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [figure]);

  return <canvas ref={ref} className="turn-spinner-geo" />;
}
