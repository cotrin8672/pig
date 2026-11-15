// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Fixture code is JavaScript source text, not a template.
import type { Tool, ToolFixture } from "./kit";

/*
 * context-mode 2.1.10 fixtures. Its tools return only text (details is
 * always empty), in the shapes below.
 */
function tool(name: string, args: Record<string, unknown>, text: string): Tool {
  return {
    call: { id: name, name, arguments: args },
    live: false,
    state: {
      status: "done",
      result: { content: [{ type: "text", text }], details: {} },
    },
  };
}

/** The common case: code that prints only the answer. */
export const ctxExecute: ToolFixture = {
  description: {
    purpose:
      "コードやコマンドを別プロセスで実行し、大量の生データを会話に流さず必要な答えだけ取り出すツール。大きな出力は索引化して後から検索できる。",
    input:
      "実行言語とコード、必要に応じて対象ファイルや抽出意図。この例はテスト結果JSONを読み、集計と失敗したテスト名だけを出力する。",
    output:
      "実行状態とコードが印字した結果。この例は成功・失敗件数と失敗テスト2件。",
  },
  tool: tool(
    "ctx_execute",
    {
      language: "javascript",
      code: [
        "const r = JSON.parse(require('fs').readFileSync('test-results.json', 'utf8'));",
        "const failed = r.testResults.flatMap((f) =>",
        "  f.assertionResults",
        "    .filter((a) => a.status === 'failed')",
        "    .map((a) => `${f.name.split('/').pop()}  ${a.title}`),",
        ");",
        "console.log(`${r.numPassedTests} passed, ${r.numFailedTests} failed`);",
        "console.log(failed.join('\\n'));",
      ].join("\n"),
    },
    [
      "118 passed, 2 failed",
      "greeting.test.ts  falls back to en",
      "locale.test.ts  parses region subtags",
    ].join("\n"),
  ),
  error:
    "SyntaxError: Unexpected token ')' (script.js:6)\n    at wrapSafe (node:internal/modules/cjs/loader:1469:18)",
};

/** Large output with intent: a summary line, the matching sections and a search handle. */
export const ctxExecuteLarge: ToolFixture = {
  description: {
    purpose:
      "コードやコマンドの大量出力を索引化し、指定した意図に合う部分だけ返す ctx_execute の例。出力全文は会話に載せず後から検索できる。",
    input:
      "実行言語・コマンド・抽出意図。この例は git log --stat -200 の結果から i18n changes に関係する部分を探す。",
    output:
      "終了コード・出力バイト数・一致した抜粋と、保存した出力を ctx_search で再検索するためのハンドル。",
  },
  tool: tool(
    "ctx_execute",
    {
      language: "shell",
      code: "git log --stat -200",
      intent: "i18n changes",
    },
    [
      "exit 0 · 48211 B",
      "commit 3bdb0e4 feat(i18n): add fallbackLocale",
      " src/i18n/greeting.ts      | 12 ++++++----",
      " src/i18n/locales/fr.ts    | 24 ++++++++++++++++++++++++",
      "commit 8169ba8 fix(i18n): keep plural rules per locale",
      " src/i18n/plural.ts        |  9 ++++-----",
      'ctx_search({queries:["i18n changes"], source:"ctx_execute:git log --stat -200"})',
    ].join("\n"),
  ),
  error: "ctx_execute: timed out after 600000 ms; the process tree was killed.",
};

export const ctxBatch: ToolFixture = {
  description: {
    purpose:
      "複数のコマンド実行と、その出力に対する複数の検索を1回にまとめるツール。関連する調査結果をまとめて取り出す。",
    input:
      "コマンド一覧と質問一覧。この例はテストとGit履歴を実行し、失敗テストと最近のコミットを調べる。",
    output:
      "質問ごとの一致箇所、元コマンドの情報、保存した出力を追加検索するためのハンドル。",
  },
  tool: tool(
    "ctx_batch",
    {
      commands: ["pnpm test 2>&1 | tail -20", "git log --oneline -5"],
      queries: ["failing tests", "recent commits"],
    },
    [
      "## failing tests",
      "$ pnpm test 2>&1 | tail -20",
      " × src/i18n/greeting.test.ts > falls back to en",
      "   AssertionError: expected 'Bonjour !' to be 'Hello!'",
      " Tests  1 failed | 117 passed (118)",
      "## recent commits",
      "$ git log --oneline -5",
      "987b16a Merge branch 'main' into dev",
      "62718a9 ci: build nightlies from dev",
      "3bdb0e4 feat(i18n): add fallbackLocale",
      'more: ctx_search({queries:[...], source:"t12:1"})',
    ].join("\n"),
  ),
  error: "ctx_batch: commands[0]: shell did not start (bash not found on PATH)",
};

export const ctxSearch: ToolFixture = {
  description: {
    purpose:
      "ctx_index で保存した資料や過去の実行出力などを検索し、必要な部分を会話に戻すツール。Web検索やコマンドの再実行ではない。",
    input:
      "検索語の配列。必要に応じて対象範囲・ソース・続きの位置を指定する。この例は fallback locale と Template type を探す。",
    output:
      "質問ごとの抜粋、出典とチャンク番号、重複の案内、続きを読むための検索方法。",
  },
  tool: tool(
    "ctx_search",
    { queries: ["fallback locale", "Template type"] },
    [
      'Query "fallback locale":',
      "docs/i18n.md #3: When a locale has no template, greeting() falls back to `fallbackLocale` instead of en.",
      "ctx_execute:git log --stat -200 #1: commit 3bdb0e4 feat(i18n): add fallbackLocale",
      "s82 #14: Locale fallback must not change the layout of the composer.",
      'Query "Template type":',
      "src/i18n/types.ts #0: export type Template = { anonymous: string; named: string; farewell: string };",
      "Same as above: docs/i18n.md (chunk 3)",
      'More: ctx_search({queries:["fallback locale"], offset:3})',
    ].join("\n"),
  ),
  error:
    "ctx_search: no indexed content in this worktree yet; run ctx_index first.",
};

export const ctxIndex: ToolFixture = {
  description: {
    purpose:
      "ローカルファイル・フォルダー・テキスト・URLの内容を保存し、ctx_search で繰り返し検索できるようにするツール。",
    input:
      "保存するパス・テキスト・URLのいずれか。この例では docs/ui-guidelines.md を登録する。",
    output:
      "登録したソース数、分割したチャンク数、ソースのラベル。資料の全文や検索回答を返す操作ではない。",
  },
  tool: tool(
    "ctx_index",
    { path: "docs/ui-guidelines.md" },
    "Indexed 1 source(s), 26 chunk(s) from s82. Label: docs/ui-guidelines.md",
  ),
  error: "ctx_index: path not found: docs/ui-guide.md",
};
