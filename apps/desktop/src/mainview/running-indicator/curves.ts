/** Other dot-and-trail figures beyond the three-body orbits. */
import { normalize, type Orbit, rk4, type Vec } from "./three-body";

function lorenz(): Orbit {
  const f = ([x, y, z]: number[]) => [
    10 * (y - x),
    x * (28 - z) - y,
    x * y - (8 / 3) * z,
  ];
  let s = [1, 1, 20];
  for (let i = 0; i < 400; i++) s = rk4(s, 0.005, f); // settle onto the attractor
  const states: number[][] = [];
  for (let i = 0; i < 4000; i++) {
    states.push(s);
    for (let k = 0; k < 2; k++) s = rk4(s, 0.005, f);
  }
  // Cut where the flow passes closest to its start, so the loop seam barely jumps.
  let end = 2000;
  const d = (a: number[]) => Math.hypot(...a.map((v, i) => v - states[0][i]));
  for (let i = 2000; i < states.length; i++)
    if (d(states[i]) < d(states[end])) end = i;
  const units = end * 0.01;
  return normalize(
    [states.slice(0, end).map(([x, , z]): Vec => [x, -z])],
    units * 1.5,
    2 / units,
  );
}

export const CURVES = { Lorenz: lorenz };
