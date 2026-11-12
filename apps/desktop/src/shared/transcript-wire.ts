import type { Transcript } from "./transcript";

/** Wire-only tool IDs point to records in this packet, never to cached history. */
export type WireTranscript = Transcript & {
  toolResultRefs?: Record<string, string>;
};

export function unpackTranscript(transcript: WireTranscript): Transcript {
  if (!transcript.toolResultRefs) return transcript;
  const { toolResultRefs, ...rest } = transcript;
  const records = new Map(
    transcript.records.map((record) => [record.id, record]),
  );
  const tools = { ...transcript.tools };
  for (const [id, recordId] of Object.entries(toolResultRefs)) {
    const record = records.get(recordId);
    if (
      !tools[id] ||
      record?.kind !== "message" ||
      record.message.role !== "toolResult" ||
      record.message.toolCallId !== id
    )
      throw new Error("Invalid tool result reference");
    const { content, details } = record.message;
    tools[id] = {
      ...tools[id],
      result: {
        ...(tools[id].result as Record<string, unknown>),
        content,
        ...(details !== undefined ? { details } : {}),
      },
    };
  }
  return { ...rest, tools };
}
