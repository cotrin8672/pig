import type { ChatRenderer, ChatRendererProps } from "@pig/chat-renderers";
import { Bot, CalendarClock } from "lucide-react";
import type { TranscriptRecord } from "../shared/transcript";
import { useT } from "./i18n";
import "./scheduled-prompt.css";

import { SenderHead } from "./SenderBubble";
import { scheduledMarker } from "./scheduled-prompt-model";

/** The label riding on top of a scheduled prompt's bubble. */
export function ScheduledHead({
  name,
  session,
}: {
  name: string;
  session?: string;
}) {
  const t = useT().agentTools;
  return (
    <SenderHead
      icon={<CalendarClock size={12} aria-hidden="true" />}
      label={t.scheduled}
      name={name}
      detail={session}
    />
  );
}

/** Separate-session jobs: the prompt as a scheduled bubble, then its result. */
export function ScheduledPromptRecord({ data }: ChatRendererProps<"custom">) {
  const t = useT().agentTools;
  const marker = scheduledMarker(data.raw as TranscriptRecord);
  if (!marker) return null;
  if (marker.mode === "subagent_start")
    return (
      <div className="response-turn">
        <article className="message user">
          <div className="user-turn">
            <div className="user-bubble sender-bubble">
              <ScheduledHead name={marker.jobName} session={marker.model} />
              {marker.prompt}
            </div>
          </div>
        </article>
      </div>
    );
  const failed = marker.mode === "subagent_error";
  return (
    <article
      className="scheduled-result"
      data-ui-surface="card"
      data-failed={failed}
    >
      <header>
        <Bot size={13} aria-hidden="true" />
        <span>{t.scheduledSession(marker.jobName)}</span>
        {marker.model && <small>{marker.model}</small>}
      </header>
      <p>{(failed ? marker.error : marker.output) || t.noOutput}</p>
    </article>
  );
}

export const scheduledPromptRenderer: ChatRenderer<"custom"> = {
  id: "builtin:pi-schedule-prompt-marker",
  kind: "custom",
  match: (data) => data.customType === "scheduled_prompt",
  component: ScheduledPromptRecord,
};
