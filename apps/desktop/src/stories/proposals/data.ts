import icon from "../../../assets/icon.png";
import type { Tool, ToolFixture } from "./kit";

/** Realistic SDK output, so each proposal is judged on the information it really gets. */
function tool(
  name: string,
  args: Record<string, unknown>,
  text: string,
  extra: Record<string, unknown> = {},
): Tool {
  return {
    call: { id: name, name, arguments: args },
    live: false,
    state: {
      status: "done",
      result: { content: [{ type: "text", text }], ...extra },
    },
  };
}

const source = [
  "export function greeting(locale: Locale, name?: string) {",
  "  const template = templates[locale] ?? templates.en;",
  "  if (!name) return template.anonymous;",
  '  return template.named.replace("{name}", name);',
  "}",
  "",
  "export function farewell(locale: Locale) {",
  "  return (templates[locale] ?? templates.en).farewell;",
  "}",
  "",
  "const templates: Record<Locale, Template> = {",
  '  en: { anonymous: "Hello!", named: "Hello, {name}!", farewell: "Bye" },',
  '  ja: { anonymous: "こんにちは", named: "こんにちは、{name}さん", farewell: "またね" },',
  "};",
].join("\n");

export const read: ToolFixture = {
  tool: tool(
    "read",
    { path: "src/i18n/greeting.ts", offset: 12, limit: 14 },
    `${source}\n\n[48 more lines in file. Use offset=26 to continue.]`,
  ),
  error: "ENOENT: no such file or directory, open 'src/i18n/greeting.ts'",
};

const diff = [
  " 12 export function greeting(locale: Locale, name?: string) {",
  "-13   const template = templates[locale] ?? templates.en;",
  "+13   const template = templates[locale] ?? templates[fallbackLocale];",
  " 14   if (!name) return template.anonymous;",
  "    ...",
  " 22 const templates: Record<Locale, Template> = {",
  '-23   en: { anonymous: "Hello!", named: "Hello, {name}!", farewell: "Bye" },',
  '+23   en: { anonymous: "Hello!", named: "Hello, {name}!", farewell: "Goodbye" },',
  '+24   fr: { anonymous: "Bonjour !", named: "Bonjour, {name} !", farewell: "Au revoir" },',
  ' 25   ja: { anonymous: "こんにちは", named: "こんにちは、{name}さん", farewell: "またね" },',
].join("\n");
export const edit: ToolFixture = {
  tool: tool(
    "edit",
    {
      path: "src/i18n/greeting.ts",
      edits: [
        { oldText: "templates.en;", newText: "templates[fallbackLocale];" },
        {
          oldText: 'farewell: "Bye" },',
          newText: 'farewell: "Goodbye" },\n  fr: { … },',
        },
      ],
    },
    "Successfully replaced 2 blocks in src/i18n/greeting.ts.",
    { details: { diff } },
  ),
  error:
    "Could not find the exact text in src/i18n/greeting.ts. The old text must match exactly including all whitespace and newlines.",
};

const created = [
  'import type { Template } from "../greeting";',
  "",
  "/** French strings; keep the placeholders identical to en. */",
  "export const fr: Template = {",
  '  anonymous: "Bonjour !",',
  '  named: "Bonjour, {name} !",',
  '  farewell: "Au revoir",',
  "};",
  "",
  "export const frPlural = (count: number) =>",
  '  count > 1 ? "messages" : "message";',
  "",
  "export default fr;",
].join("\n");
export const write: ToolFixture = {
  tool: tool(
    "write",
    { path: "src/i18n/locales/fr.ts", content: created },
    "Successfully wrote 412 bytes to src/i18n/locales/fr.ts",
  ),
  error: "EACCES: permission denied, open 'src/i18n/locales/fr.ts'",
};

export const grep: ToolFixture = {
  tool: tool(
    "grep",
    { pattern: "greeting", path: "src", glob: "*.ts" },
    [
      "src/i18n/greeting.ts:12: export function greeting(locale: Locale, name?: string) {",
      'src/app.ts:3: import { greeting } from "./i18n/greeting";',
      "src/app.ts:18:   header.textContent = greeting(user.locale, user.name);",
      "src/app.ts:31:   toast(greeting(user.locale));",
      'src/i18n/greeting.test.ts:5: test("greeting falls back to en", () => {',
      'src/i18n/greeting.test.ts:6:   expect(greeting("xx")).toBe("Hello!");',
      'src/i18n/greeting.test.ts:9:   expect(greeting("ja", "Mina")).toBe("こんにちは、Minaさん");',
      "src/components/Header.tsx:7:   const text = useMemo(() => greeting(locale), [locale]);",
    ].join("\n"),
  ),
  error: "regex parse error: unclosed group (greeting",
};

export const find: ToolFixture = {
  tool: tool(
    "find",
    { pattern: "**/*.test.ts", path: "." },
    [
      "apps/cli/src/args.test.ts",
      "apps/cli/src/run.test.ts",
      "packages/config/src/validate.test.ts",
      "src/app.test.ts",
      "src/i18n/greeting.test.ts",
      "src/i18n/locale.test.ts",
    ].join("\n"),
  ),
  error: "fd exited with code 2: invalid glob '**/*.test.[ts'",
};

export const ls: ToolFixture = {
  tool: tool(
    "ls",
    { path: "src" },
    [
      ".env.example",
      "app.test.ts",
      "app.ts",
      "assets/",
      "components/",
      "i18n/",
      "index.ts",
      "styles.css",
      "vite-env.d.ts",
    ].join("\n"),
  ),
  error: "Not a directory: src/app.ts",
};

const testLog = [
  "\u001b[2m> pig@0.4.0 test /work/pig\u001b[0m",
  "\u001b[2m> vitest run --filter greeting\u001b[0m",
  "",
  " \u001b[32m✓\u001b[0m src/i18n/greeting.test.ts \u001b[2m(6 tests)\u001b[0m 12ms",
  " \u001b[32m✓\u001b[0m src/i18n/locale.test.ts \u001b[2m(4 tests)\u001b[0m 8ms",
  " \u001b[32m✓\u001b[0m src/app.test.ts \u001b[2m(2 tests)\u001b[0m 31ms",
  "",
  '\u001b[33m(!) fr.ts: Missing translation for key "plural.other"\u001b[0m',
  "",
  " \u001b[2mTest Files\u001b[0m  \u001b[1;32m3 passed\u001b[0m (3)",
  " \u001b[2m     Tests\u001b[0m  \u001b[1;32m12 passed\u001b[0m (12)",
  " \u001b[2m  Duration\u001b[0m  1.42s",
].join("\n");
export const bash: ToolFixture = {
  tool: tool("bash", { command: "pnpm test --filter greeting" }, testLog, {
    structuredContent: { exit_code: 0, wall_time_seconds: 2.1 },
  }),
  error: [
    "\u001b[2m> vitest run --filter greeting\u001b[0m",
    "",
    " \u001b[31m×\u001b[0m src/i18n/greeting.test.ts > greeting falls back to en",
    "   AssertionError: expected 'Bonjour !' to be 'Hello!'",
    "    ❯ src/i18n/greeting.test.ts:6:24",
    "",
    " \u001b[2m     Tests\u001b[0m  \u001b[1;31m1 failed\u001b[0m | \u001b[32m11 passed\u001b[0m (12)",
    "",
    "Command exited with code 1",
  ].join("\n"),
};
export const powershell: ToolFixture = {
  tool: tool(
    "powershell",
    {
      command:
        "Get-ChildItem src -Recurse -Filter *.test.ts | Select Name, Length",
    },
    [
      "",
      "Name               Length",
      "----               ------",
      "app.test.ts          1824",
      "greeting.test.ts      912",
      "locale.test.ts        640",
      "",
    ].join("\n"),
    { structuredContent: { exit_code: 0, wall_time_seconds: 0.4 } },
  ),
  error:
    "Get-ChildItem: Cannot find path 'C:\\work\\pig\\src' because it does not exist.\nCommand exited with code 1",
};

export const lookup: ToolFixture = {
  tool: tool(
    "lookup",
    { symbol: "greeting", scope: "workspace", includeTests: false },
    "function greeting(locale: Locale, name?: string): string\nDefined in src/i18n/greeting.ts:12\n3 references in 2 files",
  ),
  error: "lookup: language server is not running for this workspace",
};

export const card: ToolFixture = {
  tool: {
    ...tool("review", {}, ""),
    card: {
      title: "Review",
      target: "src/i18n",
      meta: "2 files",
      body: [
        {
          type: "facts",
          items: [
            { label: "Files changed", value: "2" },
            { label: "Tests", value: "12 passed" },
            { label: "Coverage", value: "94%" },
          ],
        },
        {
          type: "list",
          items: [
            {
              title: "Fallback locale",
              description: "Uses fallbackLocale instead of en",
              state: "completed",
            },
            {
              title: "French strings",
              description: "fr.ts added",
              state: "completed",
            },
            {
              title: "Plural rules",
              description: "plural.other is still missing",
              state: "pending",
            },
          ],
        },
        {
          type: "text",
          format: "markdown",
          text: "**Result:** ready to merge once the plural key is translated.",
        },
        { type: "diff", text: '-  farewell: "Bye"\n+  farewell: "Goodbye"' },
        { type: "terminal", text: "$ pnpm test\n\u001b[32m12 passed\u001b[0m" },
        {
          type: "code",
          text: 'export const fr: Template = { anonymous: "Bonjour !" };',
        },
      ],
    },
  },
  error: "review: could not read the git index",
};

/** Consecutive exploration calls, as the transcript groups them. */
export const exploreSteps: Tool[] = [
  ls.tool,
  grep.tool,
  read.tool,
  {
    ...tool(
      "read",
      { path: "src/app.ts" },
      'import { greeting } from "./i18n/greeting";\n\nexport function mount() {}',
    ),
    call: { id: "read-app", name: "read", arguments: { path: "src/app.ts" } },
  },
  find.tool,
];

export const answer = [
  "フォールバック先のロケールを設定可能にし、フランス語を追加しました。",
  "",
  "### 変更点",
  "",
  "- " +
    "\u0060greeting\u0060" +
    " は未対応ロケールで **fallbackLocale** を使うようになりました。",
  "- " + "\u0060src/i18n/locales/fr.ts\u0060" + " を新規作成しました。",
  "",
  "### 使い方",
  "",
  "\u0060\u0060\u0060ts",
  'import { greeting } from "./i18n/greeting";',
  "",
  'greeting("fr", "Mina"); // "Bonjour, Mina !"',
  "\u0060\u0060\u0060",
  "",
  "### 検証",
  "",
  "| チェック | 結果 |",
  "| --- | --- |",
  "| 単体テスト | 12 passed |",
  "| 型チェック | OK |",
  "",
  "### 残っていること",
  "",
  "複数形のキー " +
    "\u0060plural.other\u0060" +
    " の訳がまだありません。決めてもらえれば追加します。",
].join("\n");

export const request =
  "挨拶の文言をロケールごとに切り替えられるようにしたい。未対応のロケールが来たら英語ではなく設定で指定したロケールにフォールバックして、ついでにフランス語も追加して。テストも通るようにお願い。";
export const shortRequest = "greeting はどこで定義されてる？";

export const reasoning = [
  "**既存の実装を確認する**",
  "",
  "greeting は templates[locale] が無いと templates.en に落ちている。フォールバック先を設定から受け取れば要件を満たせる。",
  "",
  "**影響範囲を調べる**",
  "",
  "呼び出しは app.ts に 2 箇所、Header.tsx に 1 箇所。どれも locale を渡しているだけなのでシグネチャは変えなくていい。",
  "",
  "**フランス語の追加方法を決める**",
  "",
  "テンプレートを locales/ に分けると既存の en / ja と書き方が揃わない。今回は templates に 1 行足し、ファイル分割は別に提案する。",
].join("\n");

export const images = {
  one: [icon],
  two: [icon, new URL("../../../assets/icon.svg", import.meta.url).href],
  many: [
    icon,
    new URL("../../../assets/icon.svg", import.meta.url).href,
    icon,
    new URL("../../../assets/icon.svg", import.meta.url).href,
    icon,
  ],
};

export const annotations = [
  {
    quote:
      "greeting は未対応ロケールで fallbackLocale を使うようになりました。",
    comment: "fallbackLocale の既定値も書いておいて。",
  },
  {
    quote:
      "テンプレートを locales/ に分けると既存の en / ja と書き方が揃わないため、今回は templates に 1 行足し、ファイル分割は別に提案します。",
    comment: "分割していい。en と ja も locales/ に移して揃えて。",
  },
  { quote: "複数形のキー plural.other の訳がまだありません。", comment: "" },
];

export const stats = {
  stopReason: "stop",
  durationMs: 48_200,
  endedAt: Date.UTC(2026, 10, 12, 3, 24),
  timestamp: Date.UTC(2026, 10, 12, 3, 23),
  tools: 9,
  totalTokens: 18_420,
  tokensPerSecond: 61,
  model: "claude-opus-5-5",
  text: answer,
};

/** The folded intermediate work of one finished response. */
export const workSteps = [
  { kind: "thinking", label: "既存の実装を確認する" },
  { kind: "explore", label: "src を調べた", detail: "5 件" },
  { kind: "edit", label: "src/i18n/greeting.ts", detail: "+2 −2" },
  { kind: "write", label: "src/i18n/locales/fr.ts", detail: "+13" },
  { kind: "thinking", label: "テストの失敗を直す" },
  { kind: "shell", label: "pnpm test --filter greeting", detail: "exit 1" },
  { kind: "edit", label: "src/i18n/greeting.test.ts", detail: "+1 −1" },
  { kind: "shell", label: "pnpm test --filter greeting", detail: "exit 0" },
] as const;

export const record = {
  customType: "review.checkpoint",
  data: {
    status: "approved",
    reviewer: "mina",
    files: ["src/i18n/greeting.ts", "src/i18n/locales/fr.ts"],
    checks: { tests: "12 passed", typecheck: "ok" },
    note: "plural.other は次の PR で対応",
  },
};
