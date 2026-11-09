import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ContextUsage } from "../shared/rpc-schema";

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
