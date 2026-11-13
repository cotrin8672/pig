import { expect, test } from "bun:test";
import { fuzzyMatch, searchTerms, termRanges } from "./fuzzy";

test("subsequence matches highlight the tightest window", () => {
  expect(fuzzyMatch("sbar", "Toggle sidebar")?.positions).toEqual([
    7, 11, 12, 13,
  ]);
  expect(fuzzyMatch("xyz", "Toggle sidebar")).toBeNull();
  expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
});

test("exact, word-start and earlier matches rank higher", () => {
  const score = (query: string, text: string) =>
    fuzzyMatch(query, text)?.score ?? -Infinity;
  expect(score("set", "Settings")).toBeGreaterThan(score("set", "Reset"));
  expect(score("font", "Code font")).toBeGreaterThan(
    score("font", "Frontend notes"),
  );
  expect(score("open", "Open settings")).toBeGreaterThan(
    score("open", "Reopen the settings window"),
  );
  // Prefers the word-start occurrence when the substring repeats.
  expect(fuzzyMatch("set", "Reset settings")?.positions).toEqual([6, 7, 8]);
});

test("every space-separated word must match", () => {
  expect(fuzzyMatch("win op", "Window opacity")).not.toBeNull();
  expect(fuzzyMatch("win zz", "Window opacity")).toBeNull();
});

test("letters scattered across a long title do not match", () => {
  expect(
    fuzzyMatch(
      "abc",
      "a long chat title that mentions b somewhere and then c at the end",
    ),
  ).toBeNull();
});

test("Japanese text matches without case folding issues", () => {
  expect(fuzzyMatch("背景", "背景効果を切り替え")?.positions).toEqual([0, 1]);
});

test("content terms are de-duplicated, lower-cased and bounded", () => {
  expect(searchTerms("  Foo foo  BAR ")).toEqual(["foo", "bar"]);
  expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
  expect(termRanges("Foo bar foo", ["foo"])).toEqual([0, 1, 2, 8, 9, 10]);
});
