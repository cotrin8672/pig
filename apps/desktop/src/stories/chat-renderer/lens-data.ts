import type { Tool, ToolFixture } from "./tool-fixture";

/*
 * Text and details follow the tool responses from pi-lens 4.4.12.
 */
function tool(
  name: string,
  args: Tool["call"]["arguments"],
  text: string,
  details: Record<string, unknown> = {},
): Tool {
  return {
    call: { id: name, name, arguments: args },
    live: false,
    state: {
      status: "done",
      result: { content: [{ type: "text", text }], details },
    },
  };
}
const footer = (tokens: number, bytes: number) =>
  `\n\nresult ok\nusage tokens=${tokens} elapsed-ms=0 bytes=${bytes} truncated=false`;

const greetingSource = [
  "export function greeting(locale: Locale, name?: string) {",
  "  const template = templates[locale] ?? templates.en;",
  "  if (!name) return template.anonymous;",
  '  return template.named.replace("{name}", name);',
  "}",
].join("\n");

export const readSymbol: ToolFixture = {
  tool: tool(
    "read_symbol",
    { path: "src/i18n/greeting.ts", symbol: "greeting" },
    `function greeting  greeting.ts:12-16\n\n${greetingSource}${footer(94, 373)}`,
    { startLine: 12, endLine: 16, kind: "function", found: true },
  ),
  error: "symbol 'greeting' was not found in src/i18n/greeting.ts",
};

export const readEnclosing: ToolFixture = {
  tool: tool(
    "read_enclosing",
    { path: "src/i18n/greeting.ts", line: 14 },
    `function greeting  greeting.ts:12-16\n\n${greetingSource}${footer(94, 373)}`,
    { startLine: 12, endLine: 16, kind: "function", line: 14 },
  ),
  error: "line 140 is outside src/i18n/greeting.ts (48 lines)",
};

export const astOutline: ToolFixture = {
  tool: tool(
    "ast_grep_outline",
    { paths: ["src/i18n/greeting.ts"] },
    [
      "src/i18n/greeting.ts",
      "1-1 import — import type { Locale, Template } from './types';",
      "3-3 export constant fallbackLocale — export const fallbackLocale: Locale = 'en';",
      "5-9 export struct GreetingOptions — export type GreetingOptions = {",
      "12-16 export function greeting — export function greeting(locale: Locale, name?: string) {",
      "18-20 export function farewell — export function farewell(locale: Locale) {",
      "22-26 constant templates — const templates: Record<Locale, Template> = {",
      "28-34 function pluralize — function pluralize(count: number, forms: PluralForms) {",
      "36-48 export class GreetingCache — export class GreetingCache {",
    ].join("\n") + footer(302, 1206),
  ),
  error: "no file matches src/i18n/greting.ts",
};

export const moduleReport: ToolFixture = {
  tool: tool(
    "module_report",
    { path: "src/i18n/greeting.ts" },
    [
      "src/i18n/greeting.ts jsts 48L [fresh] — 7 symbols, 5 exported, 2 imports (callbackSupport: tuned)",
      "API:",
      "  3-3     constant  fallbackLocale: Locale",
      "  12-16   function  greeting(locale: Locale, name?: string)",
      "  18-20   function  farewell(locale: Locale)",
      "  36-48   class     GreetingCache",
      "  5-9     type      GreetingOptions",
      "INTERNAL:",
      "  22-26   constant  templates",
      "  28-34   function  pluralize(count: number, forms: PluralForms)",
      "IMPORTS:",
      "  external: (none)",
      "  internal: ./types, ./plural",
      "USED BY:",
      "  greeting  ← src/app.ts:18, src/header.tsx:7, src/i18n/greeting.test.ts:4",
      "  farewell  ← src/app.ts:31",
      "RECOMMENDED:",
      "  12-16   greeting  — exported, 3 callers",
      "  36-48   GreetingCache  — exported class",
      "PROVENANCE: symbols=syntax imports=syntax usedBy=graph graphBuiltAt=2026-11-14T09:02:10.704Z",
    ].join("\n") + footer(401, 1601),
    { symbols: 7, exports: 5 },
  ),
  error:
    "module_report: src/i18n/greeting.ts is not a source file this tool can outline",
};

export const symbolSearch: ToolFixture = {
  tool: tool(
    "symbol_search",
    { query: "greeting locale fallback", limit: 5 },
    [
      'Top 4 file(s) for "greeting locale fallback":',
      "  1. src/i18n/greeting.ts 12 (score 8.42, 6 hit(s), fanIn 3, complexity 4)",
      "  2. src/i18n/locale.ts 4 (score 5.10, 3 hit(s), fanIn 5)",
      "  3. src/app.ts 18 (score 2.37, 2 hit(s))",
      "  4. src/i18n/greeting.test.ts 4 (score 1.12, 1 hit(s))",
      "",
      "Index covers 128 files.",
    ].join("\n") + footer(188, 742),
    { count: 4 },
  ),
  error:
    "symbol_search: index is cold. A background build started; retry in a few seconds.",
};

export const astSearch: ToolFixture = {
  tool: tool(
    "ast_grep_search",
    { lang: "typescript", pattern: "templates[$LOCALE]", paths: ["src"] },
    [
      "src/i18n/greeting.ts:13:20: templates[locale]  [TypeScript]",
      "  $LOCALE=locale",
      "src/i18n/greeting.ts:19:11: templates[locale]  [TypeScript]",
      "  $LOCALE=locale",
      "src/i18n/plural.ts:8:17: templates[current]  [TypeScript]",
      "  $LOCALE=current",
      "src/app.ts:27:9: templates[user.locale]  [TypeScript]",
      "  $LOCALE=user.locale",
    ].join("\n") + footer(152, 607),
    { matchCount: 4, totalMatches: 4, truncated: false },
  ),
  error: "Invalid pattern: templates[$LOCALE is not valid typescript",
};

export const astReplace: ToolFixture = {
  tool: tool(
    "ast_grep_replace",
    {
      lang: "typescript",
      pattern: "templates.en",
      rewrite: "templates[fallbackLocale]",
      paths: ["src"],
      apply: false,
    },
    [
      "[DRY-RUN] 3 replacement(s):",
      "",
      "src/i18n/greeting.ts:13:41",
      "  - templates.en",
      "  + templates[fallbackLocale]",
      "src/i18n/greeting.ts:19:33",
      "  - templates.en",
      "  + templates[fallbackLocale]",
      "src/i18n/plural.ts:8:30",
      "  - templates.en",
      "  + templates[fallbackLocale]",
      "",
      "(Dry run — use apply=true to apply changes)",
    ].join("\n") + footer(140, 560),
    { matchCount: 3, applied: false },
  ),
  error: "ast-grep CLI not found",
};

export const lspNavigation: ToolFixture = {
  tool: tool(
    "lsp_navigation",
    {
      operation: "references",
      path: "src/i18n/greeting.ts",
      line: 12,
      symbol: "greeting",
    },
    [
      "src/i18n/greeting.ts:12:17",
      "src/app.ts:3:10",
      "src/app.ts:18:24",
      "src/header.tsx:2:10",
      "src/header.tsx:7:12",
      "src/i18n/greeting.test.ts:4:10",
    ].join("\n") + footer(82, 325),
    { operation: "references", resultCount: 6, servers: ["typescript"] },
  ),
  error:
    "lsp_navigation: no language server is running for .ts in this workspace",
};

export const lensDiagnostics: ToolFixture = {
  tool: tool(
    "lens_diagnostics",
    { source: "lsp", scope: "paths", paths: ["src/i18n"] },
    [
      "Directory: src/i18n",
      "Files scanned: 6",
      "Files with errors: 2",
      "Total diagnostics: 4",
      "",
      "Primary findings (3):",
      "greeting.ts:13:41: error[typescript] (2304): Cannot find name 'fallbackLocale'.",
      "greeting.ts:28:10: warning[typescript] (6133): 'pluralize' is declared but its value is never read.",
      "locales/fr.ts:6:3: error[typescript] (2741): Property 'plural' is missing in type '{ anonymous: string; }' but required in type 'Template'.",
      "",
      "Auxiliary findings (1):",
      "locale.ts:4:1: hint[biome] (lint/style/useConst): This let declares a variable that is only assigned once.",
    ].join("\n") + footer(240, 980),
    {
      mode: "directory",
      filesScanned: 6,
      totalDiagnostics: 4,
      cleanFiles: 4,
      unconfirmedFiles: 0,
      diagnostics: [
        {
          file: "greeting.ts",
          line: 12,
          character: 40,
          severity: 1,
          source: "typescript",
          code: 2304,
          message: "Cannot find name 'fallbackLocale'.",
        },
        {
          file: "greeting.ts",
          line: 27,
          character: 9,
          severity: 2,
          source: "typescript",
          code: 6133,
          message: "'pluralize' is declared but its value is never read.",
        },
        {
          file: "locales/fr.ts",
          line: 5,
          character: 2,
          severity: 1,
          source: "typescript",
          code: 2741,
          message:
            "Property 'plural' is missing in type '{ anonymous: string; }' but required in type 'Template'.",
        },
        {
          file: "locale.ts",
          line: 3,
          character: 0,
          severity: 4,
          source: "biome",
          code: "lint/style/useConst",
          message: "This let declares a variable that is only assigned once.",
        },
      ],
    },
  ),
  error:
    "lens_diagnostics: typescript language server timed out after 8000ms; 6 files unconfirmed",
};

export const diagnosticMark: ToolFixture = {
  tool: tool(
    "lens_diagnostic_mark",
    {
      path: "src/i18n/locale.ts",
      line: 4,
      message: "This let declares a variable that is only assigned once.",
      rule: "lint/style/useConst",
      tool: "biome",
      disposition: "suppress",
      reason: "Reassigned by the hot-reload shim in development builds.",
    },
    "Suppressed lint/style/useConst at src/i18n/locale.ts:4 (anchor 3f9c1a).\nFuture runs will hide this finding while the line is unchanged.",
    { anchor: "3f9c1a", disposition: "suppress", line: 4 },
  ),
  error:
    "Refused: line 4 of src/i18n/locale.ts no longer contains the reported diagnostic.",
};

export const projectReport: ToolFixture = {
  tool: tool(
    "project_report",
    { focus: "i18n fallback", limit: 3 },
    [
      "project_report — 118/128 files (92% coverage), built 2026-11-14T09:02:10.704Z",
      "TRUST:",
      "  coverage: 118/128 (92%)",
      "  resolution: exact 71%, import 18%, receiver-type 3%, name-only 8% (2104 tagged edges)",
      "HUBS:",
      "  - src/i18n/locale.ts (fanIn 14)",
      "  - src/i18n/greeting.ts (fanIn 9)",
      "  - src/store.ts (fanIn 8)",
      "ENTRY POINTS:",
      "  - src/main.tsx",
      "  - src/worker.ts",
      "SUBSYSTEMS:",
      "  DIRECTORIES:",
      "    - src/i18n (12 files)",
      "    - src/ui (41 files)",
      "    - src/store (9 files)",
      "  CYCLES:",
      "    - src/i18n/locale.ts → src/i18n/plural.ts → src/i18n/locale.ts",
      "RISK HOTSPOTS:",
      "  - src/i18n/greeting.ts (complexity 12, churn 9, untested branches 2)",
      "DEAD WEIGHT:",
      "  - src/i18n/legacy-format.ts",
    ].join("\n") + footer(302, 1206),
    { hubs: 3, entryPoints: 2 },
  ),
  error:
    "project_report: review graph is cold. A background build started; retry shortly.",
};

export const effectiveConfig: ToolFixture = {
  tool: tool(
    "effective_config",
    { path: "src/i18n/greeting.ts" },
    `effective_config ~/work/pig/src/i18n/greeting.ts — 1 config file(s) · 2 server(s) selected · 4 runner(s)\n${JSON.stringify(
      {
        configFiles: [{ path: "~/work/pig/.pi-lens.json", scope: "project" }],
        file: {
          path: "src/i18n/greeting.ts",
          language: "typescript",
          servers: [
            {
              id: "typescript",
              selected: true,
              reason: "selected",
              role: "language",
            },
            { id: "biome", selected: true, reason: "selected", role: "linter" },
            {
              id: "deno",
              selected: false,
              reason: "no deno.json in workspace",
              role: "language",
            },
            {
              id: "eslint",
              selected: false,
              reason: "disabled by .pi-lens.json",
              role: "linter",
            },
          ],
          runners: [
            { id: "tsc", enabled: true, tier: "cheap" },
            { id: "biome-lint", enabled: true, tier: "cheap" },
            { id: "knip", enabled: false, tier: "heavy" },
            { id: "jscpd", enabled: true, tier: "heavy" },
          ],
        },
      },
      null,
      2,
    )}`,
  ),
  error:
    "effective_config: path must resolve inside the workspace (~/work/pig)",
};

export const activateTools: ToolFixture = {
  tool: tool(
    "pi_lens_activate_tools",
    { tools: ["ast_grep_search", "ast_grep_outline", "lsp_navigation"] },
    "Activated: ast_grep_search, ast_grep_outline, lsp_navigation. Available starting next turn." +
      footer(23, 91),
    {
      matches: ["ast_grep_search", "ast_grep_outline", "lsp_navigation"],
      added: ["ast_grep_outline", "lsp_navigation"],
    },
  ),
  error: "Unknown situational tool: ast_grep_rewrite",
};
