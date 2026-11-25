import { expect, test } from "bun:test";
import { tableToHtml, tableToMarkdown } from "./MarkdownBlocks";

const rows = [
  ["a|b", "<x>"],
  ["1\n2", "c\\d"],
];

test("table copy escapes Markdown cells", () => {
  expect(tableToMarkdown(rows)).toBe(
    "| a\\|b | <x> |\n| --- | --- |\n| 1 2 | c\\\\d |",
  );
});

test("table copy escapes HTML cells", () => {
  expect(tableToHtml(rows)).toBe(
    "<table><thead><tr><th>a|b</th><th>&lt;x&gt;</th></tr></thead><tbody><tr><td>1\n2</td><td>c\\d</td></tr></tbody></table>",
  );
});
