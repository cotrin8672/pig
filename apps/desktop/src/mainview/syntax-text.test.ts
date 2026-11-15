import { expect, test } from "bun:test";
import { MAX_HIGHLIGHT_LINES } from "./syntax-source";
import { syntaxLines, syntaxParts, updateSyntaxText } from "./syntax-text";

test("syntax source lines preserve every byte and bound the unhighlighted tail", () => {
  for (const text of [
    "",
    "a\n",
    "\r\n\r\n",
    "😀\n日本語",
    "x\n".repeat(8_000),
  ]) {
    const lines = syntaxLines(text);
    expect(
      lines.map((line) => line.text + (line.newline ? "\n" : "")).join(""),
    ).toBe(text);
    expect(lines.length).toBeLessThanOrEqual(MAX_HIGHLIGHT_LINES);
  }
});

test("syntax only merges color-only text and retains every font/background span", () => {
  const tokens = [
    { content: "a", offset: 0, color: "red" },
    { content: " ", offset: 1, color: "blue", bgColor: "yellow" },
    { content: "bold", offset: 2, color: "red", fontStyle: 2 },
    { content: " ", offset: 6, color: "green", fontStyle: 4 },
    { content: "tail", offset: 7, color: "blue" },
  ];
  const parts = syntaxParts("a bold tail more", tokens);
  expect(parts.map((part) => part.text).join("")).toBe("a bold tail more");
  expect(parts.map((part) => part.text)).toEqual([
    "a ",
    "bold",
    " ",
    "tail more",
  ]);
  expect(parts[1].style).toBe(tokens[2]);
  expect(parts[2].style).toBe(tokens[3]);
  expect(syntaxParts("new text", tokens)).toEqual([{ text: "new text" }]);
});

test("syntax updates edit just the changed characters, not the whole text node", () => {
  const edits: [number, number, string][] = [];
  const node = {
    data: "selected prefix",
    replaceData(offset: number, count: number, value: string) {
      edits.push([offset, count, value]);
      this.data =
        this.data.slice(0, offset) + value + this.data.slice(offset + count);
    },
  };
  updateSyntaxText(node, "selected prefix appended");
  expect(edits).toEqual([[15, 0, " appended"]]);
  updateSyntaxText(node, "selected prefix appended");
  expect(edits).toHaveLength(1);
  updateSyntaxText(node, "changed prefix appended");
  expect(edits[1]).toEqual([0, 6, "chang"]);
  for (let i = 0; i < 300; i++) {
    const value = `${"😀\r\n".repeat(i % 7)}${i % 3 ? "日本語" : "a"}-${i}`;
    updateSyntaxText(node, value);
    expect(node.data).toBe(value);
  }
});
