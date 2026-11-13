import { expect, test } from "bun:test";
import {
  type ProviderUsage,
  resetCountdown,
  sortUsage,
  timeRemaining,
  usageLevel,
  usagePercent,
} from "./provider-usage";

test("usage clocks and calendar dates are language independent", () => {
  const now = new Date(2026, 10, 12, 14).getTime();
  expect(resetCountdown(now + 72 * 60000, now)).toBe("1h 12m");
  expect(resetCountdown(now + 3 * 3600000, now)).toBe("3h");
  expect(resetCountdown(now + 12 * 1000, now)).toBe("12s");
  expect(resetCountdown(new Date(2026, 11, 1).getTime(), now)).toBe("12/1");
  expect(resetCountdown(now - 1000, now)).toBe("0s");
});
test("usage rows stay in name order regardless of quota changes", () => {
  const entry = (label: string, usedPercent: number): ProviderUsage => ({
    key: label,
    provider: "test",
    label,
    source: "api",
    status: "ready",
    data: { windows: [{ id: "5h", label: "5h", usedPercent }], balances: [] },
  });
  const entries = [
    entry("OpenAI Work", 100),
    entry("Anthropic", 50),
    entry("OpenAI Personal", 0),
  ];
  const expected = ["Anthropic", "OpenAI Personal", "OpenAI Work"];
  expect(sortUsage(entries).map((e) => e.label)).toEqual(expected);
  expect(
    sortUsage(entries.map((e) => ({ ...e, data: undefined }))).map(
      (e) => e.label,
    ),
  ).toEqual(expected);
  expect(entries[0].label).toBe("OpenAI Work");
  const ties = [entry("same", 100), { ...entry("Same", 0), key: "first" }];
  expect(sortUsage(ties).map((e) => e.key)).toEqual(["first", "same"]);
});

test("time rings need a known duration; expiry does not restore quota", () => {
  const window = {
    id: "vibe",
    label: "Vibe",
    usedPercent: 88,
    resetsAt: 10000,
  };
  expect(timeRemaining(window, 0)).toBeUndefined();
  expect(timeRemaining({ ...window, durationMs: 20000 }, 0)).toBe(50);
  expect(timeRemaining({ ...window, durationMs: 20000 }, 15000)).toBe(0);
  expect(usagePercent(window.usedPercent, "remaining")).toBe(12);
  expect(usagePercent(130, "used")).toBe(130);
  expect(usagePercent(130, "remaining")).toBe(0);
  expect(usageLevel(130)).toBe("critical");
});
