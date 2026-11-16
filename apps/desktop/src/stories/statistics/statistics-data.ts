/** Fixture shaped like aggregates of statistics.sqlite; numbers are illustrative only. */
import type { StatisticsData } from "../../shared/statistics";
export type Period = "today" | "7d" | "30d" | "all";
export const periods: { id: Period; label: string }[] = [
  { id: "today", label: "今日" },
  { id: "7d", label: "7日" },
  { id: "30d", label: "30日" },
  { id: "all", label: "全期間" },
];

export const kinds = [
  { id: "input", label: "入力" },
  { id: "output", label: "出力" },
  { id: "cacheRead", label: "キャッシュ読取" },
  { id: "cacheWrite", label: "キャッシュ書込" },
] as const;
export type Kind = (typeof kinds)[number]["id"];
export type TokenSplit = Record<Kind, number>;

export type ModelStats = {
  id: string;
  name: string;
  tokens: TokenSplit;
  requests: number;
  /** Mean output tokens per second over requests with a measured duration. */
  tokensPerSecond: number | null;
  measuredRequests: number;
};
export type ToolStats = {
  tool: string;
  calls: number;
  failures: number;
  /** Estimated tokens of its declaration in the initial context; null if not declared. */
  definitionTokens: number | null;
};
/** Sections of the leading system message (SDK `sections`) plus `toolsAdded`. */
export type ContextPart = { id: string; label: string; tokens: number };
export type StatisticsFixture = StatisticsData;

const split = (
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): TokenSplit => ({ input, output, cacheRead, cacheWrite });
const M = 1e6;
const days = ["11/7", "11/8", "11/9", "11/10", "11/11", "11/12", "11/13"];
const shape = [0.5, 0.9, 0.3, 1, 0.8, 0.95, 0.6];
const series = (total: TokenSplit, weights: number[]) => {
  const sum = weights.reduce((n, v) => n + v, 0);
  return weights.map((w) =>
    split(
      (total.input * w) / sum,
      (total.output * w) / sum,
      (total.cacheRead * w) / sum,
      (total.cacheWrite * w) / sum,
    ),
  );
};

const models: ModelStats[] = [
  {
    id: "anthropic/claude-opus-5-5",
    name: "Claude Opus 5.5",
    tokens: split(3.4 * M, 1.1 * M, 22.6 * M, 2.3 * M),
    requests: 912,
    tokensPerSecond: 58,
    measuredRequests: 904,
  },
  {
    id: "openai-codex/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    tokens: split(2.2 * M, 0.7 * M, 11.4 * M, 0.8 * M),
    requests: 744,
    tokensPerSecond: 84,
    measuredRequests: 731,
  },
  {
    id: "openrouter/kimi-k3",
    name: "Kimi K3",
    tokens: split(0.64 * M, 0.18 * M, 3.1 * M, 0.2 * M),
    requests: 186,
    tokensPerSecond: 132,
    measuredRequests: 150,
  },
];

export const statisticsFixture: StatisticsFixture = {
  collectingSince: "11/2",
  coverage: { unknownUsage: 0, dropped: 0, collection: "active" },
  days,
  daily: Object.fromEntries(
    models.map((m, i) => [
      m.id,
      series(
        m.tokens,
        shape.map((w, d) => w * (1 + ((i + d) % 3) * 0.25)),
      ),
    ]),
  ),
  models,
  tools: [
    { tool: "read", calls: 2310, failures: 41, definitionTokens: 310 },
    { tool: "bash", calls: 1204, failures: 187, definitionTokens: 420 },
    { tool: "edit", calls: 642, failures: 58, definitionTokens: 560 },
    { tool: "grep", calls: 388, failures: 6, definitionTokens: 380 },
    { tool: "write", calls: 211, failures: 3, definitionTokens: 190 },
    { tool: "lsp_navigation", calls: 96, failures: 12, definitionTokens: 2140 },
    { tool: "imagegen", calls: 4, failures: 2, definitionTokens: 890 },
    { tool: "ast_grep_search", calls: 0, failures: 0, definitionTokens: 1260 },
  ],
  initialContext: {
    parts: [
      { id: "base", label: "基本プロンプト", tokens: 640 },
      { id: "toolPrompts", label: "ツール説明・ルール", tokens: 1390 },
      { id: "tools", label: "ツール定義", tokens: 6150 },
      { id: "agents", label: "AGENTS.md", tokens: 2400 },
      { id: "skills", label: "スキル一覧", tokens: 1320 },
      { id: "extensions", label: "拡張のセクション", tokens: 940 },
    ],
    sections: [
      { id: "preamble", tokens: 40 },
      { id: "tools", tokens: 420 },
      { id: "rules", tokens: 970 },
      { id: "docs", tokens: 580 },
      { id: "addendum", tokens: 310 },
      { id: "project_context", tokens: 2400 },
      { id: "skills", tokens: 1320 },
      { id: "cwd", tokens: 20 },
      { id: "lsp_status", tokens: 630 },
    ],
    sources: [
      {
        id: "pi-lens",
        tokens: 3400,
        tools: [
          { name: "lsp_navigation", tokens: 2140 },
          { name: "ast_grep_search", tokens: 1260 },
        ],
      },
      {
        id: "builtin",
        tokens: 1860,
        tools: [
          { name: "edit", tokens: 560 },
          { name: "bash", tokens: 420 },
          { name: "grep", tokens: 380 },
          { name: "read", tokens: 310 },
          { name: "write", tokens: 190 },
        ],
      },
      {
        id: "pi-codex-image-gen",
        tokens: 890,
        tools: [{ name: "imagegen", tokens: 890 }],
      },
    ],
    measuredTotal: null,
    contextWindow: 200_000,
  },
};

export const emptyStatistics: StatisticsFixture = {
  collectingSince: "11/13",
  coverage: { unknownUsage: 0, dropped: 0, collection: "active" },
  days,
  daily: {},
  models: [],
  tools: [],
  initialContext: {
    parts: [],
    sections: [],
    sources: [],
    measuredTotal: null,
    contextWindow: 200_000,
  },
};
