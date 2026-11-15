import { expect, test } from "bun:test";
import type { ThemedToken } from "shiki/core";
import { codeRuns, sameTokens, terminalRuns, tokenRuns } from "./token-runs";

test("token compaction keeps every byte and every visible style boundary", () => {
  const tokens = [
    { content: "const", offset: 0, color: "blue" },
    { content: " ", offset: 5, color: "blue" },
    { content: "value", offset: 6, color: "blue" },
    { content: " = ", offset: 11, color: "gray" },
    { content: "1", offset: 14, color: "gray", fontStyle: 1 },
  ];
  const runs = tokenRuns(tokens);
  expect(runs).toHaveLength(3);
  expect(runs.map((value) => value.content).join("")).toBe(
    tokens.map((value) => value.content).join(""),
  );
  expect(runs[0].content).toBe("const value");
  expect(tokens[0].content).toBe("const");
  expect(sameTokens(tokens, structuredClone(tokens))).toBe(true);
  expect(sameTokens(tokens, [{ ...tokens[0], color: "red" }])).toBe(false);
});
test("plain terminal compaction preserves CRLF, blank lines, verdict colors and text selection order", () => {
  const text = `one\r\n\n${"plain\n".repeat(10000)}✓ done\n✔ good\n✗ fail\nlast`;
  const runs = terminalRuns(text.split("\n"));
  expect(runs).toHaveLength(4);
  expect(runs.map((value) => value.text).join("")).toBe(text);
  expect(runs.map((value) => value.tone)).toEqual([
    undefined,
    "ok",
    "bad",
    undefined,
  ]);
});

test("code runs merge across lines without merging their text leaves", () => {
  const lines = Array.from({ length: 1000 }, (_, i) => `// comment ${i}`);
  const tokens = lines.map((content) => [
    { content, offset: 0, color: "gray", fontStyle: 0 },
  ]);
  const runs = codeRuns(lines.join("\n"), tokens);
  expect(runs).toHaveLength(1);
  expect(runs[0].parts).toHaveLength(1999);
  expect(runs[0].parts.map((part) => part.text).join("")).toBe(
    lines.join("\n"),
  );
  expect(runs[0].parts[2]).toEqual({ key: "1:0", text: "// comment 1" });
  expect(
    codeRuns(`${lines.join("\n")}\n// appended`, [
      ...tokens,
      [{ content: "// appended", offset: 0, color: "gray", fontStyle: 0 }],
    ])[0].parts.slice(0, 1999),
  ).toEqual(runs[0].parts);
});

test("backgrounds and font decorations never extend onto code newlines", () => {
  for (const style of [
    { bgColor: "red" },
    ...[1, 2, 4, 8, 15].map((fontStyle) => ({ fontStyle })),
  ]) {
    const runs = codeRuns("first\nsecond", [
      [{ content: "first", offset: 0, color: "blue", ...style }],
      [{ content: "second", offset: 0, color: "blue", ...style }],
    ]);
    expect(runs).toHaveLength(3);
    expect(runs[1].parts.map((part) => part.text).join("")).toBe("\n");
    expect(runs[1].bgColor).toBeUndefined();
    expect(runs[1].fontStyle).toBeUndefined();
  }
});

test("code compaction preserves bytes and ink styles across varied partial token arrays", () => {
  const contents = ["x", "日本語", "😀", " \t", "\r", "", "<script>", "end"];
  const styles = [
    {},
    { color: "blue" },
    { color: "red", bgColor: "pink" },
    { color: "blue", fontStyle: 5 },
  ];
  for (let variation = 0; variation < 150; variation++) {
    const tokens = Array.from({ length: 8 }, (_, line) =>
      Array.from(
        { length: 4 },
        (_, part): ThemedToken => ({
          content: contents[(variation + line * 3 + part) % contents.length],
          offset: part,
          ...styles[(variation + line + part) % styles.length],
        }),
      ),
    );
    const text = tokens
      .map((line) => line.map((token) => token.content).join(""))
      .join("\n");
    const partial = tokens.map((line, index) =>
      (variation + index) % 5 ? line : undefined,
    );
    const original = structuredClone(tokens);
    const runs = codeRuns(text, partial);
    expect(
      runs
        .flatMap((run) => run.parts)
        .map((part) => part.text)
        .join(""),
    ).toBe(text);
    expect(tokens).toEqual(original);
    const expected = partial.flatMap((line, index) => [
      ...(line ?? [{ content: text.split("\n")[index], offset: 0 }]).flatMap(
        (token) =>
          token.content.split("").map((character) => ({
            character,
            color: token.color,
            bgColor: token.bgColor,
            fontStyle: token.fontStyle,
          })),
      ),
      ...(index < partial.length - 1
        ? [
            {
              character: "\n",
              color: undefined,
              bgColor: undefined,
              fontStyle: undefined,
            },
          ]
        : []),
    ]);
    const actual = runs.flatMap((run) =>
      run.parts.flatMap((part) =>
        part.text.split("").map((character) => ({
          character,
          color: run.color,
          bgColor: run.bgColor,
          fontStyle: run.fontStyle,
        })),
      ),
    );
    const ink = (values: typeof actual) =>
      values.filter((value) => value.character !== "\n");
    expect(ink(actual)).toEqual(ink(expected));
  }
});
