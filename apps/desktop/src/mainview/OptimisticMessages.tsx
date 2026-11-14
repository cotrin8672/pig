import { useLayoutEffect, useSyncExternalStore } from "react";
import type { Snapshot } from "../shared/rpc-schema";
import { expandedDraft } from "./draft-store";
import { UserMessage } from "./MessageContent";
import { sends } from "./rpc";
import { transcriptRequestIds } from "./transcript-requests";

/** Reconcile by request identity, never by matching text or timestamps. */
export function OptimisticMessages({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange?: () => void;
}) {
  const tick = useSyncExternalStore(
    sends.subscribe,
    sends.getTick,
    sends.getTick,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new optimistic bubble does not change the server transcript.
  useLayoutEffect(() => {
    if (!onChange) return;
    const frame = requestAnimationFrame(onChange);
    return () => cancelAnimationFrame(frame);
  }, [tick, onChange]);
  return sends
    .optimistic(snapshot.address)
    .filter(
      (send) =>
        !transcriptRequestIds(snapshot.transcript.records).has(
          send.key.requestId,
        ),
    )
    .flatMap((send) =>
      send.content ? (
        <div className="response-turn" key={send.key.requestId}>
          <article className="message user">
            <UserMessage
              sessionId={snapshot.info.id}
              disabled
              steer={
                // Queued by the SDK until the next step boundary.
                send.delivery === "steer" &&
                (send.disposition === "queued" ||
                  (send.disposition === undefined &&
                    snapshot.transcript.running))
                  ? "pending"
                  : undefined
              }
              message={{
                role: "user",
                timestamp: send.timestamp ?? 0,
                content: [
                  { type: "text", text: expandedDraft(send.content) },
                  ...send.content.images.map(({ image }) => image),
                ],
              }}
            />
          </article>
        </div>
      ) : (
        []
      ),
    );
}
