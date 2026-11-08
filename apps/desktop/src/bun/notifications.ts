import type { WireEvent } from "../shared/rpc-schema";

export function createCompletionTracker() {
  let running = false;
  let stopReason: string | undefined;
  return (event: WireEvent): "success" | "error" | undefined => {
    if (event.type === "agent_start") {
      running = true;
      stopReason = undefined;
    } else if (
      event.type === "message_end" &&
      event.message.role === "assistant"
    ) {
      stopReason = event.message.stopReason;
    } else if (event.type === "agent_settled") {
      const started = running;
      running = false;
      if (!started || event.aborted || stopReason === "aborted") return;
      return stopReason === "error" ? "error" : "success";
    }
  };
}
