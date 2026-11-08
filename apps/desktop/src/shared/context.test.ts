import { expect, test } from "bun:test";
import { contextSummary } from "./context";

const usage = (tokens: number | null, contextWindow = 1_050_000) => ({
  tokens,
  contextWindow,
  percent: tokens === null ? null : (tokens / contextWindow) * 100,
});
test("shows remaining context rather than cumulative or used tokens", () => {
  const summary = contextSummary(usage(439_600));
  expect(summary.percent).toBe(58);
  expect(summary.title).toContain("58% context remaining, 610.4k tokens");
});
test("empty and full contexts stay within zero to one hundred percent", () => {
  expect(contextSummary(usage(0)).percent).toBe(100);
  expect(contextSummary(usage(1_050_000)).percent).toBe(0);
  expect(contextSummary(usage(2_000_000)).percent).toBe(0);
});
test("unknown usage after compaction is not presented as an empty context", () => {
  expect(contextSummary(usage(null)).percent).toBeNull();
  expect(contextSummary(usage(null)).title).toContain("next response");
  expect(contextSummary(null).percent).toBeNull();
  expect(contextSummary().percent).toBeNull();
});
test("model window changes update the percentage and token total", () => {
  expect(contextSummary(usage(50_000, 100_000)).percent).toBe(50);
  expect(contextSummary(usage(50_000, 200_000)).percent).toBe(75);
  expect(contextSummary(usage(50_000, 200_000)).title).toContain(
    "150k tokens (200k total)",
  );
});
test("invalid limits and token counts never produce misleading values", () => {
  for (const input of [
    usage(0, 0),
    usage(0, Number.NaN),
    usage(0, Number.POSITIVE_INFINITY),
    usage(Number.NaN),
    usage(Number.POSITIVE_INFINITY),
    usage(-1),
  ])
    expect(contextSummary(input).percent).toBeNull();
});

test("used context reports the same fraction in title and indicator, clamped", () => {
  const summary = contextSummary(usage(439_600), "used");
  expect(summary.percent).toBe(42);
  expect(summary.title).toContain("42% context used, 439.6k tokens");
  expect(contextSummary(usage(0), "used").percent).toBe(0);
  expect(contextSummary(usage(2_000_000), "used").percent).toBe(100);
  expect(contextSummary(usage(null), "used").percent).toBeNull();
  expect(contextSummary(usage(-1), "used").percent).toBeNull();
  expect(contextSummary(usage(1), "used", "ja").title).toContain("使用済み");
  expect(contextSummary(usage(1), "remaining", "ja").title).toContain("残り");
});
