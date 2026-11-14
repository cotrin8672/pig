import type { TranscriptRecord } from "../shared/transcript";

/**
 * A user message the agent picked up mid-run (steering). The SDK only injects
 * steering between a tool step and the next assistant response, so it follows
 * an assistant message that stopped for tool use. A new prompt follows a
 * finished (`stop`/`error`/`aborted`) response instead. Derived from the
 * transcript itself, so it holds after a reload.
 */
export function isSteeredUser(
  records: readonly TranscriptRecord[],
  index: number,
) {
  const record = records[index];
  if (record?.kind !== "message" || record.message.role !== "user")
    return false;
  for (let i = index - 1; i >= 0; i--) {
    const previous = records[i];
    if (previous.kind !== "message") continue;
    const { message } = previous;
    if (message.role === "assistant") return message.stopReason === "toolUse";
    if (message.role === "user") return false;
  }
  return false;
}
