import { useLayoutEffect, useSyncExternalStore } from "react";
import type { Snapshot } from "../shared/rpc-schema";
import { expandedDraft } from "./draft-store";
import { useT } from "./i18n";
import { UserMessage } from "./MessageContent";
import { sends } from "./rpc";

/** Reconcile by request identity, never by matching text or timestamps. */
export function OptimisticMessages({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange?: () => void;
}) {
  const t = useT();
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
  const visible = new Set(
    snapshot.transcript.records.map((record) => record.requestId),
  );
  return sends
    .optimistic(snapshot.address)
    .filter((send) => !visible.has(send.key.requestId))
    .flatMap((send) =>
      send.content ? (
        <div className="response-turn" key={send.key.requestId}>
          <article className="message user">
            <UserMessage
              sessionId={snapshot.info.id}
              disabled
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
          {snapshot.transcript.running && send.delivery === "steer" && (
            <p className="composer-hint" role="status">
              {t["Steering pending"]}
            </p>
          )}
        </div>
      ) : (
        []
      ),
    );
}
