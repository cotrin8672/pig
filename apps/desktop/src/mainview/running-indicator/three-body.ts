/** Periodic three-body orbits (G = m = 1), integrated once and sampled at equal time steps. */

export type Vec = [number, number];
/** x1 y1 x2 y2 x3 y3 vx1 vy1 vx2 vy2 vx3 vy3 */
type State = number[];

export type Orbit = {
  /** Positions per body at equal time steps, normalized into [-1, 1] keeping aspect ratio. */
  bodies: Vec[][];
  /** Wall-clock length of one loop. */
  seconds: number;
  /** Trail length as a fraction of the loop. */
  trail: number;
};

/** Fit every body into [-1, 1] around the shared bounding-box center. */
export function normalize(
  bodies: Vec[][],
  seconds: number,
  trail: number,
): Orbit {
  const pts = bodies.flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const scale = 2 / Math.max(x1 - x0, y1 - y0);
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  return {
    seconds,
    trail,
    bodies: bodies.map((b) =>
      b.map((p): Vec => [(p[0] - cx) * scale, (p[1] - cy) * scale]),
    ),
  };
}

function accel(s: State): number[] {
  const a = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const dx = s[2 * j] - s[2 * i];
      const dy = s[2 * j + 1] - s[2 * i + 1];
      const r2 = dx * dx + dy * dy;
      const f = 1 / (r2 * Math.sqrt(r2));
      a[2 * i] += dx * f;
      a[2 * i + 1] += dy * f;
      a[2 * j] -= dx * f;
      a[2 * j + 1] -= dy * f;
    }
  }
  return a;
}

function deriv(s: State): State {
  return [...s.slice(6), ...accel(s)];
}

export function rk4(s: State, h: number, f = deriv): State {
  const add = (a: State, b: State, k: number) => a.map((v, i) => v + b[i] * k);
  const k1 = f(s);
  const k2 = f(add(s, k1, h / 2));
  const k3 = f(add(s, k2, h / 2));
  const k4 = f(add(s, k3, h));
  return s.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

export function integrate(start: State, period: number, samples: number) {
  const dt = period / samples;
  const out: State[] = [start];
  let s = start;
  for (let n = 1; n <= samples; n++) {
    // Close encounters need a step shrinking with the free-fall time r^1.5.
    const r = Math.min(
      Math.hypot(s[0] - s[2], s[1] - s[3]),
      Math.hypot(s[0] - s[4], s[1] - s[5]),
      Math.hypot(s[2] - s[4], s[3] - s[5]),
    );
    const steps = Math.ceil(dt / (0.002 * r ** 1.5));
    for (let k = 0; k < steps; k++) s = rk4(s, dt / steps);
    out.push(s);
  }
  return out;
}

function orbit(start: State, period: number, samples: number): Orbit {
  const states = integrate(start, period, samples).slice(0, samples);
  return normalize(
    [0, 1, 2].map((b) => states.map((s): Vec => [s[2 * b], s[2 * b + 1]])),
    period * 0.7,
    2.4 / period,
  );
}

/** Lagrange's equilateral solution released at apocenter with k × circular speed. */
function lagrange(k: number) {
  const v = k * 3 ** -0.25; // circular speed at r = 1 (side √3)
  const s: State = [];
  const vel: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3;
    s.push(Math.cos(a), Math.sin(a));
    vel.push(-Math.sin(a) * v, Math.cos(a) * v);
  }
  const mu = 1 / Math.sqrt(3); // central pull on each body = mu / r²
  const semi = 1 / (2 - k * k);
  return orbit([...s, ...vel], 2 * Math.PI * Math.sqrt(semi ** 3 / mu), 400);
}

export const ORBITS = {
  Lagrange: () => lagrange(0.75),
  // Chenciner–Montgomery figure-eight.
  FigureEight: () =>
    orbit(
      [
        0.97000436, -0.24308753, -0.97000436, 0.24308753, 0, 0, 0.466203685,
        0.43236573, 0.466203685, 0.43236573, -0.93240737, -0.86473146,
      ],
      6.32591398,
      240,
    ),
};
