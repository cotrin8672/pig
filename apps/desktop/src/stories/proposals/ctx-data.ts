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
  tool: tool(
    "ctx_index",
    { path: "docs/ui-guidelines.md" },
    "Indexed 1 source(s), 26 chunk(s) from s82. Label: docs/ui-guidelines.md",
  ),
  error: "ctx_index: path not found: docs/ui-guide.md",
};
