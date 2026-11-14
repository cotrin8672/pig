import type { SessionFlags } from "../shared/desktop-state";
import { dictionary } from "../shared/i18n";
import type { Notice } from "../shared/rpc-schema";
import type { RuntimeEvent } from "../shared/runtime-contract";
import type { Settings } from "../shared/settings";
import { createCompletionTracker } from "./notifications";

type Options = {
  desktopState: {
    readonly value: { sessions: Record<string, SessionFlags | undefined> };
    clearCompletion(sessionId: string): Promise<unknown>;
    completeSession(
      sessionId: string,
      outcome: "success" | "error",
    ): Promise<unknown>;
  };
  language: () => Settings["language"];
  report: (error: unknown) => void;
  /** In-app notice for every connected window. */
  notify: (notice: Notice) => void;
  /** True while the user is looking at any app window. */
  attended: () => boolean;
  showSystemNotification: (body: string) => void;
};

/** Turns runtime snapshots into durable completion flags and notices. */
export function createCompletionNotifier(options: Options) {
  const completions = new Map<
    string,
    { track: ReturnType<typeof createCompletionTracker>; running: boolean }
  >();
  const receive = (event: RuntimeEvent) => {
    if (event.type === "closed") completions.delete(event.address.sessionId);
    if (event.type !== "snapshot") return;
    const snapshot = event.snapshot;
    const sessionId = snapshot.address.sessionId;
    const wire = {
      type: "snapshot" as const,
      address: snapshot.address,
      snapshotSeq: snapshot.snapshotSeq,
      transcript: snapshot.transcript,
      failure: snapshot.failure,
      aborted: snapshot.aborted,
    };
    let completion = completions.get(sessionId);
    if (!completion) {
      completion = { track: createCompletionTracker(), running: false };
      completions.set(sessionId, completion);
    }
    const outcome = completion.track(wire);
    const flags = options.desktopState.value.sessions[sessionId];
    if (
      wire.transcript.running &&
      (!completion.running || flags?.completion || flags?.readCompletionId)
    )
      void options.desktopState
        .clearCompletion(sessionId)
        .catch(options.report);
    completion.running = wire.transcript.running;
    if (!outcome) return;
    void options.desktopState
      .completeSession(sessionId, outcome)
      .catch(options.report);
    const t = dictionary(options.language());
    const notice: Notice = {
      kind: "completion",
      message:
        outcome === "error"
          ? (wire.failure ?? t["Agent failed"])
          : t["Agent finished"],
      level: outcome,
      session: { id: sessionId, cwd: snapshot.info.cwd },
    };
    options.notify(notice);
    if (!options.attended()) {
      try {
        options.showSystemNotification(notice.message);
      } catch (error) {
        console.error("Cannot show desktop notification", error);
      }
    }
  };
  return Object.assign(receive, { tracked: () => completions.size });
}
