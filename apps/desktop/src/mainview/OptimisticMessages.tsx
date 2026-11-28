import { useLayoutEffect, useSyncExternalStore } from "react";
import type { Snapshot } from "../shared/rpc-schema";
import { RESUME_REQUEST_PREFIX } from "../shared/runtime-contract";
import { usePendingArrival } from "./MessageQueue";
import { PendingUserMessage } from "./PendingUserMessage";
import { sends } from "./rpc";
import { isPendingSteer } from "./send-controller";
import { transcriptRequestIds } from "./transcript-requests";

/** Reconcile by request identity, never by matching text or timestamps. */
export function OptimisticMessages({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange?: () => void;
}) {
  const arrival = usePendingArrival(snapshot.ready !== false);
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
        !send.key.requestId.startsWith(RESUME_REQUEST_PREFIX) &&
        // Unread steering waits in the composer's queue tray instead.
        !isPendingSteer(send, snapshot.transcript.running) &&
        !transcriptRequestIds(snapshot.transcript.records).has(
          send.key.requestId,
        ),
    )
    .flatMap((send) =>
      send.content ? (
        <PendingUserMessage
          key={send.key.requestId}
          arrivalRef={arrival(send.key.requestId, send.content)}
          sessionId={snapshot.info.id}
          timestamp={send.timestamp ?? 0}
          content={send.content}
        />
      ) : (
        []
      ),
    );
}
