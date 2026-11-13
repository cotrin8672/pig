import { expect, test } from "bun:test";
import {
  fetchable,
  formatDateTime,
  formatReset,
  NOW,
  shown,
  usage,
} from "./usage-data";

const after = (seconds: number) => NOW + seconds * 1000;

test("reset times are compact and language-independent", () => {
  expect(formatReset(after(12))).toBe("12s");
  expect(formatReset(after(45 * 60))).toBe("45m");
  expect(formatReset(after(72 * 60))).toBe("1h 12m");
  expect(formatReset(after(3 * 3600))).toBe("3h");
  expect(formatReset(new Date(2026, 11, 1, 9).getTime())).toBe("12/1");
  expect(formatReset(after(-30))).toBe("0s");
  expect(formatDateTime(new Date(2026, 11, 1, 9, 5).getTime())).toBe(
    "12/1 9:05",
  );
});

test("the display setting flips the share; remaining is the default view", () => {
  expect(shown(12, "remaining")).toBe(12);
  expect(shown(12, "used")).toBe(88);
});

test("providers without a fetch path are hidden", () => {
  expect(fetchable(usage).map((e) => e.key)).not.toContain("anthropic");
  expect(fetchable(usage).length).toBe(usage.length - 1);
});
