import type { Ref } from "react";
import type { DraftContent } from "../shared/runtime-contract";
import { expandedDraft } from "./draft-store";
import { UserMessage } from "./MessageContent";

export function PendingUserMessage({
  content,
  sessionId,
  timestamp,
  arrivalRef,
}: {
  content: DraftContent;
  sessionId: string;
  timestamp: number;
  arrivalRef?: Ref<HTMLElement>;
}) {
  return (
    <div className="response-turn">
      <article ref={arrivalRef} className="message user">
        <UserMessage
          sessionId={sessionId}
          disabled
          message={{
            role: "user",
            timestamp,
            content: [
              { type: "text", text: expandedDraft(content) },
              ...content.images.map(({ image }) => image),
            ],
          }}
        />
      </article>
    </div>
  );
}
