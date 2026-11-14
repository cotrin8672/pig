import type { SessionFlags } from "../shared/desktop-state";
import type { Snapshot } from "../shared/rpc-schema";

/** Diagnostics may be absent in older sessions; inspect only the latest turn. */
export function interruptedSession(
  snapshot: Pick<Snapshot, "transcript" | "failure" | "aborted">,
): "failed" | "stopped" | undefined {
  if (snapshot.failure) return "failed";
  if (snapshot.transcript.running) return;
  const stopped = snapshot.aborted ? "stopped" : undefined;
  const records = snapshot.transcript.records;
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (record.kind !== "message") continue;
    const message = record.message;
    if (message.role === "user") return stopped;
    if (message.role !== "assistant") continue;
    if (message.stopReason === "error") return "failed";
    if (message.stopReason === "aborted") return "stopped";
    return stopped;
  }
  return stopped;
}

export type SessionStatus = "waiting" | "running" | "completed" | "failed";

export function hasUnreadCompletion(flags?: SessionFlags): boolean {
  return !!flags?.completion && flags.completion.id !== flags.readCompletionId;
}

export function sessionStatus(
  running: boolean,
  waiting: boolean,
  flags?: SessionFlags,
  failure = false,
): SessionStatus | undefined {
  if (waiting) return "waiting";
  if (failure) return "failed";
  if (running) return "running";
  // Reading a notification does not resolve the underlying failure.
  if (flags?.completion?.outcome === "error") return "failed";
  if (hasUnreadCompletion(flags)) return "completed";
}

export const sessionStatusLabels = {
  waiting: "Waiting for your answer",
  running: "Working",
  completed: "Completed · unread",
  failed: "Failed",
} as const;
