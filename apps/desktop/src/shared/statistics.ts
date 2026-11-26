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
/** Command outcome from the structured shell exit code, not the SDK `isError`. */
export type ShellCommandStatistics = {
  shell: string;
  command: string;
  /** Finished calls, including those whose outcome is unknown. */
  calls: number;
  failures: number;
  /** No exit code, or one that cannot be told apart (PowerShell `rg` exit 1). */
  unknown: number;
  sdkErrors: number;
  /** Result text bytes returned to the model by failed calls. Not tokens. */
  failureBytes: number;
};
export type InitialContext = {
  parts: { id: string; label: string; tokens: number }[];
  /** System prompt sections by SDK name (`content` for unsectioned text). */
  sections: { id: string; tokens: number }[];
  /** Tool declarations grouped by the registering extension (`builtin`, or null if unknown). */
  sources: {
    id: string | null;
    tokens: number;
    tools: { name: string; tokens: number }[];
  }[];
  measuredTotal: number | null;
  contextWindow: number | null;
};
export type StatisticsData = {
  cost: { usd: number | null; missing: number };
  collectingSince: string | null;
  days: string[];
  daily: Record<string, TokenSplit[]>;
  models: ModelStatistics[];
  tools: ToolStatistics[];
  commands: {
    rows: ShellCommandStatistics[];
    unclassified: number;
    /** Shell calls recorded before command keys were collected. */
    unmeasured: number;
  };
  initialContext: InitialContext;
  coverage: {
    unknownUsage: number;
    dropped: number;
    collection: "active" | "disabled";
  };
};

export type StatisticsProgress = {
  requestId: string;
  data: Partial<StatisticsData>;
};

export function validateStatisticsPeriod(value: unknown): StatisticsPeriod {
  if (!statisticsPeriods.includes(value as StatisticsPeriod))
    throw new Error("Invalid statistics period");
  return value as StatisticsPeriod;
}
