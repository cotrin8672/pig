import { expect, test } from "bun:test";
import type { ThemedToken } from "shiki/core";
import {
  type HighlightSnapshot,
  retainedHighlight,
} from "./retained-highlighting";
import { MAX_HIGHLIGHT_LENGTH } from "./syntax-highlighting";

const snapshot = (text: string, language = "ts"): HighlightSnapshot => ({
  text,
  language,
  tokens: text
    .split("\n")
    .map((content) => [{ content, offset: 0, color: "#abcdef" }]),
});
const contents = (tokens?: ThemedToken[]) =>
  tokens?.map((token) => token.content).join("");

test("appending preserves complete lines and the colored prefix of a growing line", () => {
  const previous = snapshot("const first = 1;\nconst next");
  const tokens = retainedHighlight(
    `${previous.text} = 2;\nconst last = 3;`,
    "typescript",
    previous,
  );
  expect(tokens?.[0]).toBe(previous.tokens[0]);
  expect(tokens?.[1]?.[0]).toBe(previous.tokens[1][0]);
  expect(contents(tokens?.[1])).toBe("const next = 2;");
  expect(tokens?.[1]?.at(-1)?.color).toBeUndefined();
  expect(tokens?.[2]).toBeUndefined();
});

test("replacements and deletions never display old text or reuse a changed lexical suffix", () => {
  const previous = snapshot(
    "const first = 1;\nconst next = 2;\nconst last = 3;",
  );
  const text = "const first = 1;\n/* changed */\nconst last = 3;";
  const tokens = retainedHighlight(text, "ts", previous);
  expect(tokens?.[0]).toBe(previous.tokens[0]);
  expect(tokens?.[1]).toBeUndefined();
  // An unchanged suffix is unsafe: a changed comment/string can recolor it.
  expect(tokens?.[2]).toBeUndefined();

  for (const replacement of ["const first", "const first = 9;"])
    expect(contents(retainedHighlight(replacement, "ts", previous)?.[0])).toBe(
      replacement,
    );
  expect(retainedHighlight("", "ts", previous)).toBeUndefined();
  expect(retainedHighlight("replacement", "ts", previous)).toBeUndefined();
});

test("retained tokens keep blank lines, CRLF, tabs and Unicode text literal", () => {
  const previous = snapshot("\tconst 日本語 = '😀';\r\n\r\nconst tail");
  const text = `${previous.text} = 42;\r\n`;
  const tokens = retainedHighlight(text, "ts", previous);
  expect(
    text
      .split("\n")
      .map((line, index) => contents(tokens?.[index]) ?? line)
      .join("\n"),
  ).toBe(text);
  const emoji = retainedHighlight("'😁'", "ts", snapshot("'😀'"));
  expect(emoji?.[0]?.[0].content).toBe("'");
  expect(emoji?.[0]?.[1].content).toBe("😁'");
});

test("language changes and oversized sources immediately discard old colors", () => {
  const previous = snapshot("const first = 1;");
  for (const language of [undefined, "unknown", "python"])
    expect(
      retainedHighlight(previous.text, language, previous),
    ).toBeUndefined();
  expect(
    retainedHighlight("x".repeat(MAX_HIGHLIGHT_LENGTH + 1), "ts", previous),
  ).toBeUndefined();
  expect(retainedHighlight(previous.text, "ts")).toBeUndefined();
});

test("ANSI reuse follows raw controls, not just identical visible output", () => {
  const previous: HighlightSnapshot = {
    text: "\u001b[32mPASS\ncontinued",
    language: "ansi",
    tokens: [
      [{ content: "PASS", offset: 0, color: "#00ff00" }],
      [{ content: "continued", offset: 5, color: "#00ff00" }],
    ],
  };
  const appended = retainedHighlight(`${previous.text}!`, "ansi", previous);
  expect(appended?.[0]).toBe(previous.tokens[0]);
  expect(contents(appended?.[1])).toBe("continued!");
  expect(appended?.[1]?.at(-1)?.color).toBeUndefined();
  expect(
    retainedHighlight("\u001b[31mPASS\ncontinued", "ansi", previous),
  ).toBeUndefined();
  const changed = retainedHighlight(
    "\u001b[32mPASS\ncon\u001b[31mtinued",
    "ansi",
    previous,
  );
  expect(changed?.[0]).toBe(previous.tokens[0]);
  expect(changed?.[1]?.[0].content).toBe("con");
  expect(changed?.[1]?.[1].content).toBe("tinued");
  expect(changed?.[1]?.[1].color).toBeUndefined();
});
