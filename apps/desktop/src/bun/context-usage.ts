import type { Message } from "@earendil-works/pi-ai";
import type { ContextView } from "@earendil-works/pi-durable";
import type { ContextUsage } from "../shared/rpc-schema";

function usage(message: Message) {
  if (
    message.role !== "assistant" ||
    message.stopReason === "error" ||
    message.stopReason === "aborted"
  )
    return 0;
  const value = message.usage;
  return (
    value.totalTokens ||
    value.input + value.output + value.cacheRead + value.cacheWrite
  );
}
function estimate(message: Message) {
  let chars = 0;
  if (typeof message.content === "string") chars = message.content.length;
  else
    for (const block of message.content) {
      if (block.type === "image") chars += 4800;
      else if (block.type === "text") chars += block.text.length;
      else if (block.type === "thinking") chars += block.thinking.length;
      else if (block.type === "toolCall")
        chars += block.name.length + JSON.stringify(block.arguments).length;
    }
  return Math.ceil(chars / 4);
}
/** Active projection only, never the lifetime spend ledger. Old usage is invalid after a head/edit. */
export function projectedContextUsage(
  view: ContextView,
  contextWindow: number,
): ContextUsage | null {
  if (contextWindow <= 0) return null;
  const invalidating = Math.max(
    view.head?.id ?? 0,
    ...view.entries.filter((e) => e.edits?.length).map((e) => Number(e.id)),
  );
  const valid = new Set(
    view.entries.flatMap((entry, index) =>
      Number(entry.id) > invalidating
        ? (view.contributions[index] ?? []).filter((m) => usage(m) > 0)
        : [],
    ),
  );
  let last = -1;
  for (let i = view.messages.length - 1; i >= 0; i--)
    if (valid.has(view.messages[i])) {
      last = i;
      break;
    }
  if (view.head && last < 0)
    return { tokens: null, contextWindow, percent: null };
  const tokens =
    last < 0
      ? view.messages.reduce((n, m) => n + estimate(m), 0)
      : usage(view.messages[last]) +
        view.messages.slice(last + 1).reduce((n, m) => n + estimate(m), 0);
  return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
}
