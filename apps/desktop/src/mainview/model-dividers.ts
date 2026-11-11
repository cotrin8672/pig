import type { TranscriptRecord } from "../shared/transcript";

export function modelDividers(records: TranscriptRecord[]) {
  const changes = new Map<string, string>();
  let previous: string | undefined;
  for (const record of records) {
    if (record.kind !== "session-entry" || record.entryType !== "model_change")
      continue;
    const data = record.data as {
      provider?: unknown;
      modelId?: unknown;
    } | null;
    if (typeof data?.provider !== "string" || typeof data.modelId !== "string")
      continue;
    const model = `${data.provider}/${data.modelId}`;
    if (previous && previous !== model)
      changes.set(record.id, `${previous} → ${model}`);
    previous = model;
  }
  return changes;
}
