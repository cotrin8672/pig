import { open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

// pi-durable 1.5 JSONL v1: entries/conversations/receipts/terminal tasks
// live in main.jsonl; document and live-task payloads use ID-named sidecars.
type RecordValue = {
  id: number;
  conversationId?: number;
  parent?: { conversationId: number };
  owner?: { conversationId: number };
  scope?: { kind: string; conversationId?: number; taskId?: number };
};
type Write = {
  type: string;
  id?: number;
  value?: RecordValue;
  record?: RecordValue;
};
type Marker = { format: number; type: string; seq: number; writes: Write[] };

/** Only call with the Harness CLOSED and all tasks idle. Never edit an open store. */
export async function purgeConversation(directory: string, id: number) {
  if (!Number.isSafeInteger(id) || id <= 1) throw new Error("Invalid chat ID.");
  const path = join(directory, "main.jsonl");
  const text = await readFile(path, "utf8");
  if (!text.endsWith("\n"))
    throw new Error("Refusing to purge an incomplete Durable log.");
  const markers: Marker[] = text
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const tasks = new Set<number>();
  const documents = new Set<number>();
  const liveTasks = new Set<number>();
  const terminalTasks = new Set<number>();
  let found = false;
  for (const marker of markers) {
    if (
      marker.format !== 1 ||
      marker.type !== "commit" ||
      !Array.isArray(marker.writes)
    )
      throw new Error("Unsupported Durable storage format.");
    for (const write of marker.writes) {
      if (write.type === "task.sidecar") liveTasks.add(write.id as number);
      if (write.type === "task" && write.value)
        terminalTasks.add(write.value.id);
      if (write.type === "conversation") {
        if (write.value?.id === id) found = true;
        if (
          write.value?.parent?.conversationId === id ||
          write.value?.owner?.conversationId === id
        )
          throw new Error("Delete this chat’s forked or owned children first.");
      }
      if (write.type === "task" && write.value?.conversationId === id)
        tasks.add(write.value.id);
    }
  }
  // Also check the final closed log: a submission already in flight when the
  // maintenance gate closed may have raced the Harness inspection.
  if ([...liveTasks].some((task) => !terminalTasks.has(task)))
    throw new Error("Stop active chats before deleting a chat.");
  if (!found) throw new Error("Chat not found.");
  for (const marker of markers) {
    for (const write of marker.writes) {
      const record = write.record;
      if (
        write.type === "document.create" &&
        record &&
        (record.scope?.conversationId === id ||
          (record.scope?.taskId !== undefined &&
            tasks.has(record.scope.taskId)))
      )
        documents.add(record.id);
    }
  }
  const keep = (write: Write) => {
    switch (write.type) {
      case "conversation":
        return write.value?.id !== id;
      case "entry":
      case "submission":
      case "task":
        return write.value?.conversationId !== id;
      case "task.sidecar":
        return !tasks.has(write.id as number);
      case "document.create":
        return !documents.has(write.record?.id as number);
      case "document.change":
      case "document.retire":
        return !documents.has(write.id as number);
      default:
        throw new Error(`Unsupported Durable write: ${write.type}`);
    }
  };
  // Preserve sequence numbers and sidecar ordinals; only remove target writes.
  // The caller first appends a root watermark, preventing deleted IDs being reused.
  const replacement = `${markers
    .map((marker) =>
      JSON.stringify({ ...marker, writes: marker.writes.filter(keep) }),
    )
    .join("\n")}\n`;
  const temporary = join(directory, `main.jsonl.${crypto.randomUUID()}.purge`);
  try {
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(replacement, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  // Main replacement is the atomic commit. Orphan sidecars are safe on crash;
  // Durable recovery discards unconfirmed records, and no survivor references these.
  for (const [kind, ids] of [
    ["doc", documents],
    ["task", tasks],
  ] as const)
    for (const key of ids) {
      await rm(join(directory, `${kind}-${key}.jsonl`), { force: true });
      await rm(join(directory, `${kind}-${key}.jsonl.reclaim`), {
        force: true,
      });
    }
}
