import type { TranscriptRecord } from "../shared/transcript";

export type Turn = {
  /** Record ID of the user message; matches `data-record-id` in the thread. */
  id: string;
  /** Jump target (store `jump`). */
  entryId?: string;
  /** Empty for an image-only message. */
  title: string;
  preview: string;
  /** Last assistant entry of the turn; a branch resumes after it. */
  branchEntryId?: string;
};

const plain = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** One entry per user message, previewed by the turn's last assistant text. */
export function collectTurns(records: readonly TranscriptRecord[]): Turn[] {
  const turns: Turn[] = [];
  for (const record of records) {
    if (record.kind !== "message") continue;
    const { message } = record;
    if (message.role === "user") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("\n");
      turns.push({
        id: record.id,
        entryId: record.entryId,
        title: plain(text),
        preview: "",
      });
    } else if (message.role === "assistant" && turns.length) {
      const turn = turns[turns.length - 1];
      const text = plain(
        message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
      );
      if (text) turn.preview = text;
      turn.branchEntryId = record.entryId ?? turn.branchEntryId;
    }
  }
  return turns;
}
