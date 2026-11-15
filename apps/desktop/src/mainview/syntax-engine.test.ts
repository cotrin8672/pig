import { expect, test } from "bun:test";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import nord from "shiki/themes/nord.mjs";
import { createCodeTokenizer } from "./syntax-engine";
import {
  canHighlight,
  codeLanguage,
  languageNames,
  MAX_HIGHLIGHT_LENGTH,
  MAX_HIGHLIGHT_LINES,
  terminalText,
} from "./syntax-source";
import { syntaxThemeColor } from "./syntax-theme";

// Independent original full-input algorithm; never uses prefix state/reused rows.
const oracle = await createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  themes: [nord],
  langs: [],
});
async function full(text: string, language?: string) {
  const lang = codeLanguage(language);
  if (!lang || !text || !canHighlight(text)) return undefined;
  if (lang !== "ansi" && !oracle.getLoadedLanguages().includes(lang))
    await oracle.loadLanguage(
      (await import(`shiki/langs/${lang}.mjs`)).default,
    );
  const tokens = oracle.codeToTokensBase(
    lang === "ansi" ? terminalText(text, true) : text,
    {
      lang,
      theme: "nord",
      tokenizeMaxLineLength: 2_000,
      tokenizeTimeLimit: 0,
    },
  );
  for (const row of tokens)
    for (const token of row) {
      if (lang === "ansi") {
        if (token.color === oracle.getTheme("nord").fg) token.color = undefined;
      } else {
        token.color = syntaxThemeColor(token.color);
        token.bgColor = syntaxThemeColor(token.bgColor);
      }
    }
  const lines = (lang === "ansi" ? terminalText(text) : text).split("\n");
  if (tokens.length !== lines.length) return undefined;
  for (let i = 0; i < lines.length; i++) {
    const value = tokens[i].map((token) => token.content).join("");
    if (lines[i].endsWith("\r") && value === lines[i].slice(0, -1))
      tokens[i].push({ content: "\r", offset: 0 });
    else if (value !== lines[i]) return undefined;
  }
  return tokens;
}

for (const language of languageNames)
  test(`syntax checkpoints match full ${language} tokens through appends, edits and shortening`, async () => {
    const tokenize = createCodeTokenizer();
    const sources = [
      "",
      "\n",
      "\n\n",
      "#! /bin/sh\n",
      '/* open\ncontinued\n*/\nconst 日本語 = "😀";',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Highlighted source, not an evaluated template.
      "<script>\nconst value = `hello\n${1 + 2}`;\n</script>\n<div>tail</div>",
      'value = """open\ncontinued\n"""\nnext = 1',
      "cat <<EOF\nhello\nEOF\n",
      "# Title\n\n**bold** _italic_ ~~strike~~\n",
    ];
    for (const source of sources) {
      for (const text of [
        source,
        `${source} tail`,
        `${source} tail\n`,
        `${source} tail\nmore`,
        `${source} tail\nmore\n\n`,
        `${source} tail\nm`,
        `changed\n${source} tail\nmore`,
        source.replaceAll("\n", "\r\n"),
        `${source.replaceAll("\n", "\r\n")} tail\r\nmore\r\n`,
      ])
        expect(await tokenize(text, language)).toEqual(
          await full(text, language),
        );
    }
  });

test("syntax reuses complete rows, reparses the unfinished line, and never mutates published tokens", async () => {
  const tokenize = createCodeTokenizer();
  const initial = await tokenize(
    '/* open\ncontinued\n*/\nconst value = "unfinished',
    "ts",
  );
  const copy = structuredClone(initial);
  const appended = await tokenize(
    '/* open\ncontinued\n*/\nconst value = "unfinished string";\nconst tail = 2;',
    "typescript",
  );
  expect(appended).toEqual(
    await full(
      '/* open\ncontinued\n*/\nconst value = "unfinished string";\nconst tail = 2;',
      "ts",
    ),
  );
  expect(appended?.[0]).toBe(initial?.[0]);
  expect(appended?.[2]).toBe(initial?.[2]);
  expect(appended?.[3]).not.toBe(initial?.[3]);
  expect(initial).toEqual(copy);
});

test("syntax prefix state is isolated across languages, output switches, invalid inputs and ANSI", async () => {
  const tokenize = createCodeTokenizer();
  for (const [text, language] of [
    ["/*\nopen\ncontinued", "ts"],
    ["/*\nopen\ncontinued\n*/", "python"],
    ["/*\nopen\ncontinued\n*/", "ts"],
    ["unrelated\nconst next = 1;", "ts"],
    ["/*\nopen\ncontinued\n*/", "ts"],
    ["\u001b[1;32mgreen\ncontinued\u001b[0m\nplain", "ansi"],
    ["\u001b[1;32mgreen\ncontinued\u001b[0m\nplain\nmore", "ansi"],
    ["/*\nopen\ncontinued\n*/", "ts"],
    ["/*\nopen\ncontinued\n*/", "unknown"],
    ["/*\nopen\ncontinued\n*/", undefined],
    ["/*\nopen\ncontinued\n*/", "ts"],
    ["x".repeat(MAX_HIGHLIGHT_LENGTH + 1), "ts"],
    ["/*\nopen\ncontinued\n*/", "ts"],
    ["x\n".repeat(MAX_HIGHLIGHT_LINES), "ts"],
    ["/*\nopen\ncontinued\n*/", "ts"],
  ] as const)
    expect(await tokenize(text, language)).toEqual(await full(text, language));
});

test("syntax handles CRLF boundaries, partial CR, surrogate fragments and skipped long lines exactly", async () => {
  const tokenize = createCodeTokenizer();
  for (const text of [
    'const 日本語 = "😀";\r\n',
    'const 日本語 = "😀";\r\n/*',
    'const 日本語 = "😀";\r\n/*\r\ncontinued\r\n',
    'const 日本語 = "😀";\r\n/*\r\ncontinued\r\n*/\r\nlast\r',
    'const 日本語 = "😀";\r\n/*\r\ncontinued\r\n*/\r\nlast\r\n',
    "/*\n\uD83D",
    "/*\n\uD83D\uDE00\n*/",
    `/*\n${"x".repeat(2_000)}\n*/\nconst next = 2;\n`,
    `/*\n${"x".repeat(2_000)}\n*/\nconst next = 2;\ntail`,
  ])
    expect(await tokenize(text, "ts")).toEqual(await full(text, "ts"));
});

test("independent tokenizer instances do not replace each other's reusable prefix", async () => {
  const a = createCodeTokenizer();
  const b = createCodeTokenizer();
  const first = await a("/* A\nopen\nmore", "ts");
  await b('const B = "different";\nother', "ts");
  const next = await a("/* A\nopen\nmore\n*/\n", "ts");
  expect(next?.[0]).toBe(first?.[0]);
  expect(next).toEqual(await full("/* A\nopen\nmore\n*/\n", "ts"));
});

test("concurrent callers and repeated middle edits remain equivalent to independent full parses", async () => {
  const tokenize = createCodeTokenizer();
  const concurrent = [
    ["/* first\nopen\ncontinued", "ts"],
    ['value = """open\ncontinued\n"""', "python"],
    ["/* first\nopen\ncontinued\n*/\nconst next = 1;", "ts"],
    ['<script>\nconst next = "value";\n</script>', "html"],
  ] as const;
  const result = await Promise.all(
    concurrent.map(([text, language]) => tokenize(text, language)),
  );
  for (let i = 0; i < result.length; i++) {
    const [text, language] = concurrent[i];
    expect(result[i]).toEqual(await full(text, language));
  }

  let text = Array.from(
    { length: 24 },
    (_, index) => `const value${index} = call(${index});`,
  ).join("\n");
  for (let index = 0; index < 72; index++) {
    switch (index % 6) {
      case 0:
        text += "\n/* open\ncontinued";
        break;
      case 1:
        text += '\n*/\nconst next = "😀";';
        break;
      case 2:
        text = `// inserted\n${text}`;
        break;
      case 3:
        text = text.slice(0, Math.max(0, text.length - 20));
        break;
      case 4:
        text = text.replace("call", '"changed"');
        break;
      case 5:
        text += "\n\n";
        break;
    }
    expect(await tokenize(text, "ts")).toEqual(await full(text, "ts"));
  }
});
