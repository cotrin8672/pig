import { expect, test } from "bun:test";
import type { Root } from "hast";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { parseMarkdown } from "./markdown-engine";
import { plainMarkdown, retainedMarkdown } from "./markdown-processing";
import { markdownUrl } from "./markdown-url";

const renderTree = (tree: Root | undefined) => {
  if (!tree) throw new Error("Expected a parsed Markdown tree");
  return renderToStaticMarkup(
    ReactMarkdown({
      children: "",
      rehypePlugins: [() => () => tree],
      urlTransform: markdownUrl,
    }),
  );
};
const baseline = (text: string) =>
  renderToStaticMarkup(
    ReactMarkdown({
      children: text,
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [[rehypeKatex, { throwOnError: false }]],
      urlTransform: markdownUrl,
    }),
  );
test("worker HAST renders identically to the original Markdown/GFM/KaTeX pipeline", () => {
  for (const text of [
    "# Heading\n\nParagraph **strong** and _emphasis_.",
    "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] task",
    "[go][ref]\n\n[ref]: https://example.com\n\nwww.example.com",
    "~~~tsx\nconst v = <div title='literal'/>;\n~~~",
    "$x^2$\n\n$$ x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} $$",
    "$\\notARealCommand{x}$",
    "<script>alert(1)</script>\n\n[bad](javascript:alert) ![bad](javascript:alert)",
    "[chat](pi://session/opaque-session-id)",
    "A &amp; B\nsoft break\n\n---",
  ])
    expect(renderTree(parseMarkdown(text).tree)).toBe(baseline(text));
});
test("the immediate plain-prose path preserves paragraph/soft-break geometry exactly", () => {
  for (const text of [
    "",
    "plain",
    "Previous response",
    "日本語の文章です。",
    "one\nsoft break",
    "one\n\ntwo\n\n",
    "\none\n\n\nsecond!\n",
  ]) {
    const tree = plainMarkdown(text);
    expect(tree).toBeDefined();
    expect(renderTree(tree)).toBe(baseline(text));
  }
  for (const text of [
    "---",
    "1. item",
    "1.",
    "1)",
    "one\n2.",
    "one\n2) item",
    "www.example.com",
    "WWW.example.com",
    "two  \nhard break",
    "$x$",
    "**strong**",
    "<b>x</b>",
    "A &amp; B",
    "    indented",
    "\u00a0",
    "\u2003",
  ])
    expect(plainMarkdown(text)).toBeUndefined();
});
test("pending prose appends stay inside their heading, list item or paragraph", () => {
  for (const initial of [
    "## 調査結果",
    "## 調査結果\n\n- **原因**はMarkdownです。",
    "## 調査結果\n\n1. 最初の項目\n2. 次の項目",
    "## 調査結果\n\n- 親の項目\n  - 子の項目",
    "## 調査結果\n\n- 最初の段落\n\n  次の段落",
    "> **原因**はMarkdownです。",
    "## 調査結果\n\n本文です。",
  ]) {
    const previous = { text: initial, tree: parseMarkdown(initial).tree };
    const text = `${initial}追記です。`;
    const pending = retainedMarkdown(text, previous);
    expect(pending.tail).toBe("");
    expect(renderTree(pending.tree)).toBe(baseline(text));
    if (previous.tree.children.length > 1)
      expect(pending.tree?.children[0]).toBe(previous.tree.children[0]);
  }
});
test("pending changes retain complete blocks across synthetic paragraph separators", () => {
  const initial = "## Heading\n\n- **Stable** item\n\nOld paragraph";
  const previous = { text: initial, tree: parseMarkdown(initial).tree };
  const pending = retainedMarkdown(initial.replace("Old", "New"), previous);
  expect(renderTree(pending.tree)).toContain(
    "<li><strong>Stable</strong> item</li>",
  );
  expect(pending.tree?.children[2]).toBe(previous.tree.children[2]);
  expect(pending.tail).toBe("\n\nNew paragraph");
  const appended = retainedMarkdown(`${initial}\n\nNew paragraph`, previous);
  expect(renderTree(appended.tree)).toBe(baseline(initial));
  expect(appended.tail).toBe("\n\nNew paragraph");
  const unknown: Root = {
    type: "root",
    children: [{ type: "text", value: "unmapped source" }],
  };
  expect(
    retainedMarkdown("old new", { text: "old", tree: unknown }).tree,
  ).toBeUndefined();
});
test("pending code-body updates preserve the pre/code tree and latest source, not a stale body", () => {
  const initial =
    "Before\n\n~~~ts\nconst stable = 1;\nconst growing\n~~~\n\nAfter";
  const previous = { text: initial, tree: parseMarkdown(initial).tree };
  const text = initial.replace("const growing", "const growing = 123;");
  const pending = retainedMarkdown(text, previous);
  expect(pending.tail).toBe("");
  expect(renderTree(pending.tree)).toBe(baseline(text));
  expect(pending.tree?.children[0]).toBe(previous.tree.children[0]);
  for (const open of [
    "~~~ts\nconst stable = 1;\nconst growing",
    "~~~ts\nconst stable = 1;\nconst growing\n",
    "  ~~~ts\n  const stable = 1;\n  const growing\n  ~~~",
    "~~~ts\r\nconst growing\r\n~~~",
  ]) {
    const old = { text: open, tree: parseMarkdown(open).tree };
    const next = open.includes("~~~", 3)
      ? open.replace("const growing", "const growing = 2;")
      : `${open}more`;
    const retained = retainedMarkdown(next, old);
    expect(retained.tail).toBe("");
    expect(renderTree(retained.tree)).toBe(baseline(next));
  }
  const styled = "**Stable formatted text**";
  const inline = retainedMarkdown(`${styled} new words`, {
    text: styled,
    tree: parseMarkdown(styled).tree,
  });
  expect(inline.tail).toBe("");
  expect(renderTree(inline.tree)).toBe(baseline(`${styled} new words`));
  const closed = "~~~ts\nconst x = 1;\n~~~";
  const appended = retainedMarkdown(`${closed}\nAfter`, {
    text: closed,
    tree: parseMarkdown(closed).tree,
  });
  expect(renderTree(appended.tree)).toBe(baseline(closed));
  expect(appended.tail).toBe("After");
  const changedLanguage = retainedMarkdown(
    initial.replace("~~~ts", "~~~python"),
    previous,
  );
  expect(changedLanguage.tail).toContain("~~~python");
  const deleted = retainedMarkdown("Different", previous);
  expect(deleted.tail).toBe("Different");
  expect(deleted.tree).toBeUndefined();
});
