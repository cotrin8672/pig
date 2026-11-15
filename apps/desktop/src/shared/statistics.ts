export const statisticsPeriods = ["today", "7d", "30d", "all"] as const;
export type StatisticsPeriod = (typeof statisticsPeriods)[number];
export const tokenKinds = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
] as const;
export type TokenKind = (typeof tokenKinds)[number];
export type TokenSplit = Record<TokenKind, number>;
export type ModelStatistics = {
  id: string;
  name: string;
  tokens: TokenSplit;
  requests: number;
  tokensPerSecond: number | null;
  measuredRequests: number;
};
export type ToolStatistics = {
  tool: string;
  calls: number;
  failures: number;
  definitionTokens: number | null;
};
export type InitialContext = {
  parts: { id: string; label: string; tokens: number }[];
  measuredTotal: number | null;
  contextWindow: number | null;
};
export type StatisticsData = {
  collectingSince: string | null;
  days: string[];
  daily: Record<string, TokenSplit[]>;
  models: ModelStatistics[];
  tools: ToolStatistics[];
  initialContext: InitialContext;
  coverage: {
    unknownUsage: number;
    dropped: number;
    collection: "active" | "disabled";
  };
};

export function validateStatisticsPeriod(value: unknown): StatisticsPeriod {
  if (!statisticsPeriods.includes(value as StatisticsPeriod))
    throw new Error("Invalid statistics period");
  return value as StatisticsPeriod;
}
