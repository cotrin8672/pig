import type { TranscriptRecord } from "../shared/transcript";

/*
 * pi-schedule-prompt posts a visible `scheduled_prompt` marker right before it
 * sends the job's prompt as a normal user message (scheduler.ts). The marker
 * carries no text of its own, so pig folds it into that user bubble instead of
 * drawing a separate row. Jobs with a model run in a separate session and only
 * post markers (subagent_start / _done / _error); those draw themselves.
 */

export type Marker = {
  jobName: string;
  prompt: string;
  mode?: string;
  model?: string;
  output?: string;
  error?: string;
};
const text = (value: unknown) => (typeof value === "string" ? value : "");

export function scheduledMarker(record: TranscriptRecord): Marker | undefined {
  if (
    record.kind !== "message" ||
    record.message.role !== "custom" ||
    record.message.customType !== "scheduled_prompt"
  )
    return undefined;
  const details = (record.message.details ?? record.details) as
    | Record<string, unknown>
    | undefined;
  if (!details || typeof details !== "object") return undefined;
  return {
    jobName: text(details.jobName) || text(details.jobId),
    prompt: text(details.prompt),
    mode: text(details.mode) || undefined,
    model: text(details.model) || undefined,
    output: text(details.output) || undefined,
    error: text(details.error) || undefined,
  };
}

/** Fire markers are folded into the user bubble that carries their prompt. */
export const isFoldedScheduledMarker = (record: TranscriptRecord) => {
  const marker = scheduledMarker(record);
  return !!marker && !marker.mode;
};

function userText(record: TranscriptRecord): string | undefined {
  if (record.kind !== "message" || record.message.role !== "user")
    return undefined;
  const { content } = record.message;
  return typeof content === "string"
    ? content
    : content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}

/** User record ID → job name, pairing each fire marker with its prompt. */
export function scheduledUsers(
  records: readonly TranscriptRecord[],
): Map<string, string> {
  const result = new Map<string, string>();
  records.forEach((record, index) => {
    const marker = scheduledMarker(record);
    if (!marker || marker.mode) return;
    // A prompt delivered while streaming lands after the current response.
    for (const next of records.slice(index + 1)) {
      if (
        !result.has(next.id) &&
        userText(next)?.trim() === marker.prompt.trim()
      ) {
        result.set(next.id, marker.jobName);
        return;
      }
    }
  });
  return result;
}
