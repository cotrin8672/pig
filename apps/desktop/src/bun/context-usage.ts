import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ContextUsage } from "../shared/rpc-schema";

type SDKContextUsage = ReturnType<AgentSession["getContextUsage"]>;

/**
 * After compaction the SDK reports `tokens: null` until the next response;
 * keep showing the last known count instead of an empty state.
 */
export function keepLastContextTokens(
  next: SDKContextUsage,
  last: SDKContextUsage,
): SDKContextUsage {
  if (next?.tokens !== null || typeof last?.tokens !== "number") return next;
  return {
    ...next,
    tokens: last.tokens,
    percent: (last.tokens / next.contextWindow) * 100,
  };
}

/** SDK projection accounts for branch edits and compaction; never lifetime spend. */
export function projectedContextUsage(
  session: Pick<AgentSession, "getContextUsage">,
): ContextUsage | null {
  const usage = session.getContextUsage();
  return usage
    ? {
        tokens: usage.tokens,
        contextWindow: usage.contextWindow,
        percent: usage.percent,
      }
    : null;
}
