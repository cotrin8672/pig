import type { SessionFlags } from "../shared/desktop-state";

export type SessionStatus = "waiting" | "running" | "completed" | "failed";

export function hasUnreadCompletion(flags?: SessionFlags): boolean {
  return !!flags?.completion && flags.completion.id !== flags.readCompletionId;
}

export function sessionStatus(
  running: boolean,
  waiting: boolean,
  flags?: SessionFlags,
): SessionStatus | undefined {
  if (waiting) return "waiting";
  if (running) return "running";
  if (hasUnreadCompletion(flags))
    return flags?.completion?.outcome === "error" ? "failed" : "completed";
}

export const sessionStatusLabels = {
  waiting: "Waiting for your answer",
  running: "Working",
  completed: "Completed · unread",
  failed: "Failed · unread",
} as const;
