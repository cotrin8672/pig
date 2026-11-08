import { expect, test } from "bun:test";
import {
  legacyUiPreferences,
  validateDesktopState,
  validateSessionFlags,
  validateUiPreferences,
} from "./desktop-state";

test("validates UI preferences, clamps widths to 480–1600, and deduplicates without mutating input", () => {
  const input = {
    chatWidth: 799.6,
    recentModels: ["a/model", "a/model", "b/model"],
  };
  expect(validateUiPreferences(input)).toEqual({
    chatWidth: 800,
    recentModels: ["a/model", "b/model"],
  });
  expect(input.recentModels).toEqual(["a/model", "a/model", "b/model"]);
  expect(validateUiPreferences({ chatWidth: -1 })).toEqual({ chatWidth: 480 });
  expect(validateUiPreferences({ chatWidth: 9999 })).toEqual({
    chatWidth: 1600,
  });
  expect(validateUiPreferences({})).toEqual({});
  for (const invalid of [
    null,
    [],
    "preferences",
    { chatWidth: "800" },
    { chatWidth: Number.NaN },
    { chatWidth: Infinity },
    { recentModels: "model" },
    { recentModels: [""] },
    { recentModels: [1] },
    { recentModels: ["x".repeat(1025)] },
    { recentModels: Array(7).fill("a") },
  ]) {
    expect(() => validateUiPreferences(invalid)).toThrow();
  }
});

test("validates session flags and desktop records while rejecting unsafe IDs or invalid shapes", () => {
  expect(
    validateSessionFlags({ pinned: false, archived: true, ignored: "value" }),
  ).toEqual({ pinned: false, archived: true });
  expect(validateDesktopState({})).toEqual({ sessions: {} });
  expect(
    validateDesktopState({
      chatWidth: 9000,
      sessions: { local: { pinned: true } },
    }),
  ).toEqual({ chatWidth: 1600, sessions: { local: { pinned: true } } });
  for (const invalid of [null, [], { pinned: "true" }, { archived: 1 }]) {
    expect(() => validateSessionFlags(invalid)).toThrow();
  }
  for (const invalid of [
    null,
    [],
    { sessions: [] },
    { sessions: "invalid" },
    { sessions: { local: { archived: "false" } } },
  ]) {
    expect(() => validateDesktopState(invalid)).toThrow();
  }
  for (const id of [
    "",
    "folder/id",
    "folder\\id",
    "bad\nID",
    "x".repeat(129),
  ]) {
    expect(() =>
      validateDesktopState({ sessions: { [id]: { pinned: true } } }),
    ).toThrow("Invalid session ID");
  }
});

test("legacy migration never overrides persisted preferences, including an empty recents list", () => {
  const current = { chatWidth: 850, recentModels: [] };
  expect(legacyUiPreferences(current, "1200", '["legacy/model"]')).toEqual({});
  expect(current).toEqual({ chatWidth: 850, recentModels: [] });
  expect(
    legacyUiPreferences({ chatWidth: 850 }, "1200", '["legacy/model"]'),
  ).toEqual({ recentModels: ["legacy/model"] });
  expect(
    legacyUiPreferences({ recentModels: [] }, "1200", '["legacy/model"]'),
  ).toEqual({ chatWidth: 1200 });
});

test("legacy migration filters, bounds, and deduplicates recents and clamps imported widths", () => {
  expect(
    legacyUiPreferences({}, "2000", '["a","b","c","d","e","f","g"]'),
  ).toEqual({ chatWidth: 1600, recentModels: ["a", "b", "c", "d", "e", "f"] });
  expect(legacyUiPreferences({}, "0", '["a","a",null,"",4,"b"]')).toEqual({
    chatWidth: 480,
    recentModels: ["a", "b"],
  });
  expect(legacyUiPreferences({}, "799.6", null)).toEqual({ chatWidth: 800 });
});

test("invalid or absent legacy data produces no preference patch", () => {
  expect(legacyUiPreferences({}, null, null)).toEqual({});
  for (const recent of [
    "{broken",
    "{}",
    '"model"',
    JSON.stringify(["x".repeat(1025)]),
  ]) {
    expect(legacyUiPreferences({}, "not a width", recent)).toEqual({});
  }
  const invalidWidths = ["not a width", "NaN", "Infinity", "", "   "];
  const imported = invalidWidths.flatMap((width) => {
    const patch = legacyUiPreferences({}, width, null);
    return Object.keys(patch).length ? [{ width, patch }] : [];
  });
  expect(imported).toEqual([]);
});

test("completion fields round-trip, legacy records stay without completion, malformed metadata is rejected", () => {
  const flags = {
    pinned: true,
    completion: { id: "run-1", outcome: "error" as const },
    readCompletionId: "run-0",
  };
  expect(validateSessionFlags(flags)).toEqual(flags);
  expect(validateDesktopState({ sessions: { chat: {} } })).toEqual({
    sessions: { chat: {} },
  });
  for (const invalid of [
    { completion: null },
    { completion: {} },
    { completion: { id: "", outcome: "success" } },
    { completion: { id: "ok", outcome: "aborted" } },
    { completion: { id: 4, outcome: "error" } },
    { readCompletionId: "" },
    { readCompletionId: 4 },
    { readCompletionId: "x".repeat(129) },
  ])
    expect(() => validateSessionFlags(invalid)).toThrow();
});
