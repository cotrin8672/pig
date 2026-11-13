import { expect, test } from "bun:test";
import { sameTokens, terminalRuns, tokenRuns } from "./token-runs";

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
