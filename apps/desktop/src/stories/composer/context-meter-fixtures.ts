import type { ContextUsage } from "../../shared/rpc-schema";

export const states = {
  通常: { tokens: 42_300, contextWindow: 200_000, percent: null },
  逼迫: { tokens: 184_000, contextWindow: 200_000, percent: null },
  不明: null,
  計測待ち: { tokens: null, contextWindow: 200_000, percent: null },
} satisfies Record<string, ContextUsage | null>;

export type HoverArgs = { state: keyof typeof states };
