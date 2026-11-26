import { expect, test } from "bun:test";
import { FIGURES } from "./OrbitTrail";
import { ORBITS } from "./three-body";

test("every figure is finite and fits [-1, 1]", () => {
  for (const make of Object.values(FIGURES)) {
    const { bodies, seconds, trail } = make();
    expect(seconds).toBeGreaterThan(0);
    expect(trail).toBeGreaterThan(0);
    for (const [x, y] of bodies.flat()) {
      expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  }
});

test("each orbit closes after one period", () => {
  for (const make of Object.values(ORBITS)) {
    for (const b of make().bodies) {
      const step = Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]);
      const last = b[b.length - 1];
      const gap = Math.hypot(b[0][0] - last[0], b[0][1] - last[1]);
      expect(gap).toBeLessThan(step * 1.5 + 0.005);
    }
  }
});
