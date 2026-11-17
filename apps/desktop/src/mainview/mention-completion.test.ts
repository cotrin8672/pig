import { expect, test } from "bun:test";
import { applyMention, mentionContext } from "./mention-completion";

test("finds the @ token at the cursor, not inside words", () => {
  expect(mentionContext("see @src/ma", 11, 11)).toEqual({
    prefix: "src/ma",
    start: 4,
    end: 11,
  });
  expect(mentionContext("@", 1, 1)).toEqual({ prefix: "", start: 0, end: 1 });
  expect(mentionContext("a@b.com", 7, 7)).toBeUndefined();
  expect(mentionContext("@src done", 9, 9)).toBeUndefined();
  expect(mentionContext("@src", 1, 3)).toBeUndefined();
  expect(mentionContext('x @"my dir/fi', 13, 13)).toEqual({
    prefix: "my dir/fi",
    start: 2,
    end: 13,
  });
});

test("inserts files with a space and keeps folders open", () => {
  const text = "see @sr tail";
  const context = mentionContext(text, 7, 7);
  if (!context) throw new Error("no context");
  expect(applyMention(text, context, "src/app.ts", false)).toEqual({
    text: "see @src/app.ts tail",
    cursor: 15,
  });
  expect(applyMention(text, context, "src", true)).toEqual({
    text: "see @src/ tail",
    cursor: 9,
  });
  const quoted = mentionContext("@my", 3, 3);
  if (!quoted) throw new Error("no context");
  expect(applyMention("@my", quoted, "my dir/a.ts", false).text).toBe(
    '@"my dir/a.ts" ',
  );
  expect(applyMention("@my", quoted, "my dir", true).text).toBe('@"my dir/');
});
