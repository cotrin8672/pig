import type { WireEvent } from "../shared/rpc-schema";

export function createCompletionTracker() {
  let running = false;
  return (event: WireEvent): "success" | "error" | undefined => {
    const wasRunning = running;
    running = event.transcript.running;
    if (!wasRunning || running) return;
    // The host aborts after model errors the SDK does not (or no longer) retry.
    // Preserve that failure as a durable outcome, not a quiet manual stop.
    if (event.failure) return "error";
    if (!event.aborted) return "success";
  };
}
