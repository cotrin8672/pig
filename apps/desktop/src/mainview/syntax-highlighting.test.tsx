import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CodeText,
  diffHunks,
  HighlightedDiff,
  TerminalOutput,
} from "./HighlightedCode";
import {
  cachedHighlight,
  codeLanguage,
  highlightCode,
  languageFromPath,
  MAX_HIGHLIGHT_LENGTH,
  MAX_HIGHLIGHT_LINES,
  terminalText,
} from "./syntax-highlighting";

const sourceText = (tokens: Awaited<ReturnType<typeof highlightCode>>) =>
  tokens?.map((line) => line.map((token) => token.content).join("")).join("\n");

test("language aliases and Windows/POSIX file names are explicit, not guessed from output", () => {
  expect(codeLanguage("TS")).toBe("typescript");
  expect(codeLanguage("bash")).toBe("shellscript");
  expect(languageFromPath("C:\\work\\Example.TSX")).toBe("tsx");
  expect(languageFromPath("/work/Dockerfile.dev")).toBe("dockerfile");
  expect(languageFromPath("/work/.bashrc")).toBe("shellscript");
  expect(languageFromPath("script.ps1")).toBe("powershell");
  for (const unknown of [
    undefined,
    "text",
    "unknown",
    "constructor",
    "__proto__",
  ])
    expect(codeLanguage(unknown)).toBeUndefined();
  expect(languageFromPath("build.log")).toBeUndefined();
});

test("Shiki colors actual keywords, strings, numbers and comments and reuses tokens", async () => {
  const text =
    'const greeting: string = "こんにちは"; // comment\nconst count = 42;\n';
  const tokens = await highlightCode(text, "ts");
  expect(sourceText(tokens)).toBe(text);
  expect(
    new Set(tokens?.flat().map((token) => token.color)).size,
  ).toBeGreaterThan(3);
  expect(
    tokens?.flat().find((token) => token.content === "const")?.color,
  ).not.toBe(tokens?.flat().find((token) => token.content === "42")?.color);
  expect(await highlightCode(text, "typescript")).toBe(tokens);
  expect(cachedHighlight(text, "TS")).toBe(tokens);
  const html = renderToStaticMarkup(
    <pre>
      <CodeText text={text} language="ts" />
    </pre>,
  );
  expect(html).toContain('class="syntax-token"');
  expect(html).toContain("こんにちは");
});

test("a cold TSX grammar highlights the complete first line instead of timing out halfway", async () => {
  const text = 'const ExampleWidget = () => <div title="hello">{42}</div>;';
  const tokens = await highlightCode(text, "tsx");
  expect(sourceText(tokens)).toBe(text);
  expect(
    new Set(tokens?.flat().map((token) => token.color)).size,
  ).toBeGreaterThan(3);
  expect(tokens?.flat().some((token) => token.content === "42")).toBe(true);
});

test("tokenization preserves blank lines, tabs, Unicode and CRLF exactly", async () => {
  for (const text of [
    "\tconst 日本語 = 1;\n\n",
    "const a = 1;\r\n\r\nconst b = 2;\r\n",
  ]) {
    expect(sourceText(await highlightCode(text, "ts"))).toBe(text);
  }
  // A lone CR is not allowed to make part of a source line disappear.
  const text = "const a = 1;\rconst b = 2;";
  const tokens = await highlightCode(text, "ts");
  expect(tokens === undefined || sourceText(tokens) === text).toBe(true);
});

test("unknown, unlabelled and oversized code stays complete and plain", async () => {
  const text = "<script>alert('not HTML')</script>";
  expect(await highlightCode(text, "unknown")).toBeUndefined();
  expect(await highlightCode(text)).toBeUndefined();
  expect(renderToStaticMarkup(<CodeText text={text} />)).toContain(
    "&lt;script&gt;",
  );
  for (const large of [
    "x".repeat(MAX_HIGHLIGHT_LENGTH + 1),
    "x\n".repeat(MAX_HIGHLIGHT_LINES),
  ]) {
    expect(await highlightCode(large, "ts")).toBeUndefined();
    expect(renderToStaticMarkup(<CodeText text={large} language="ts" />)).toBe(
      large,
    );
  }
});

test("bounded token cache evicts old snapshots", async () => {
  const first = 'const cacheTest = "first";';
  await highlightCode(first, "ts");
  for (let i = 0; i < 33; i++)
    await highlightCode(`const cacheTest = ${i};`, "ts");
  expect(cachedHighlight(first, "ts")).toBeUndefined();
});

test("terminal text removes OSC links, cursor controls and incomplete streaming sequences", () => {
  const text =
    "\u001b]8;;https://example.com\u0007label\u001b]8;;\u0007\u001b[2K\u001b[31mred\u001b[m";
  expect(terminalText(text)).toBe("labelred");
  expect(terminalText(text, true)).toBe("label\u001b[31mred\u001b[0m");
  for (const partial of [
    "\u001b",
    "\u001b[",
    "\u001b[38;2;",
    "\u001b]8;;url",
    "\u001b]8;;url\u001b",
  ]) {
    expect(terminalText(`visible${partial}`)).toBe("visible");
  }
  expect(terminalText("\u009b32mgreen\u009b0m", true)).toBe(
    "\u001b[32mgreen\u001b[0m",
  );
});

test("ANSI colors, backgrounds, decorations and reset survive newlines without raw escapes", async () => {
  const text =
    "\u001b[1;32mPASS\ncontinued\u001b[0m plain\n\u001b[38;2;12;34;56;48;5;196;4;9mRGB\u001b[m reset";
  const tokens = await highlightCode(text, "ansi");
  expect(sourceText(tokens)).toBe(terminalText(text));
  expect(tokens?.[0][0].color).toBe(tokens?.[1][0].color);
  expect(tokens?.[0][0].fontStyle).toBe(2);
  expect(tokens?.[1].at(-1)?.color).toBeUndefined();
  const rgb = tokens?.[2].find((token) => token.content === "RGB");
  expect(rgb?.color).toBe("#0c2238");
  expect(rgb?.bgColor).toBeDefined();
  expect(Number(rgb?.fontStyle)).toBe(12);
  const html = renderToStaticMarkup(<TerminalOutput text={text} />);
  expect(html).toContain("syntax-bold");
  expect(html).toContain("syntax-underline syntax-strike");
  expect(html).not.toContain("\u001b");
  expect(html).not.toContain("[32m");
});

test("plain terminal verdicts and untrusted text remain literal, not syntax-guessed", () => {
  const html = renderToStaticMarkup(
    <TerminalOutput text={'✓ passed\n✗ <img src=x onerror="bad">'} />,
  );
  expect(html).toContain('<span class="ok">✓ passed\n</span>');
  expect(html).toContain('<span class="bad">✗ &lt;img');
  expect(html).not.toContain("syntax-token");
  expect(html).not.toContain("<img");
});

test("SDK display diffs keep line numbers outside code and reset at gaps", async () => {
  const text =
    '-1 /*\n-2 old comment\n-3 */\n+1 const value = "new";\n 4 const next = 42;\n    ...\n+20 const tail = true;';
  const hunks = diffHunks(text, true);
  expect(hunks).toHaveLength(3);
  expect(hunks[0][0].prefix).toBe("-1 ");
  expect(hunks[0][0].text).toBe("/*");
  expect(hunks[1][0].code).toBe(false);
  expect(
    hunks
      .flat()
      .map((line) => line.prefix + line.text)
      .join("\n"),
  ).toBe(text);
  for (const lines of hunks) {
    for (const excluded of ["add", "del"]) {
      await highlightCode(
        lines
          .filter((line) => line.code && line.tone !== excluded)
          .map((line) => line.text)
          .join("\n"),
        "ts",
      );
    }
  }
  const html = renderToStaticMarkup(
    <HighlightedDiff text={text} path="src/file.ts" numbered />,
  );
  expect(html).toContain('<span class="del">-1 <span class="syntax-token"');
  expect(html).toContain('<span class="add">+20 <span class="syntax-token"');
  expect(html).toContain("old comment");
  const comment = await highlightCode(
    "/*\nold comment\n*/\nconst next = 42;",
    "ts",
  );
  expect(comment?.[1][0].color).toBe(comment?.[0][0].color);
});

test("unified diff headers are not parsed as source and unknown paths retain every byte", () => {
  const text =
    "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-123 old\n+123 new\n";
  const groups = diffHunks(text);
  expect(
    groups
      .flat()
      .filter((line) => line.code)
      .map((line) => line.text),
  ).toEqual(["123 old", "123 new"]);
  expect(
    groups
      .flat()
      .map((line) => line.prefix + line.text)
      .join("\n"),
  ).toBe(text);
  const html = renderToStaticMarkup(
    <HighlightedDiff text={text} path="unknown.log" />,
  );
  expect(html).not.toContain("syntax-token");
  expect(html).toContain("@@ -1 +1 @@");
});
