import { expect, test } from "bun:test";
import { displayedEffort, effortOptions } from "./effort";

test("uses the five supported ordinary effort levels in order", () => {
  expect(effortOptions(["max", "xhigh", "high", "medium", "low"])).toEqual([
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
});
test("GPT minimal alias does not create a sixth low setting", () => {
  const map = {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  };
  const levels = effortOptions(
    ["minimal", "low", "medium", "high", "xhigh", "max"],
    map,
  );
  expect(levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
  expect(displayedEffort("minimal", levels, map)).toBe("low");
});
test("does not invent unsupported model levels", () => {
  expect(effortOptions(["low", "medium", "high"])).toEqual([
    "low",
    "medium",
    "high",
  ]);
  expect(
    effortOptions(["off", "minimal", "low", "medium", "high", "max"], {
      xhigh: null,
    }),
  ).toEqual(["off", "minimal", "low", "medium", "high", "max"]);
});
test("keeps genuinely distinct minimal and off levels", () => {
  expect(
    effortOptions(["off", "minimal", "low", "high"], {
      minimal: "minimal",
      low: "low",
    }),
  ).toEqual(["off", "minimal", "low", "high"]);
});
test("collapses provider aliases beyond minimal too", () => {
  expect(
    effortOptions(["low", "medium", "high", "xhigh", "max"], {
      xhigh: "high",
      max: "high",
    }),
  ).toEqual(["low", "medium", "high"]);
  expect(effortOptions([])).toEqual([]);
  expect(displayedEffort("high", [])).toBe("off");
});
