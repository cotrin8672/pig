import type { WireEvent } from "../shared/rpc-schema";

export function createCompletionTracker() {
  let running = false;
  return (event: WireEvent): "success" | "error" | undefined => {
    const wasRunning = running;
    running = event.transcript.running;
    if (!wasRunning || running || event.aborted) return;
    return event.failure ? "error" : "success";
  };
}
