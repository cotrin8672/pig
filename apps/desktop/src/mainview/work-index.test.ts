import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createFinishedWorkIndex, finishedWork } from "../shared/tool-view";
import {
  emptyTranscript,
  type Message,
  type Transcript,
  type TranscriptRecord,
} from "../shared/transcript";
import { isVisibleRecord } from "./custom-data";
import { shareTranscript } from "./transcript-sharing";

type Turn = Extract<TranscriptRecord, { kind: "message" }>;
function turn(id: string, message: Message): Turn {
  return {
    id,
    entryId: id,
    parentId: null,
    branchId: "branch",
    order: 0,
    kind: "message",
    message,
  };
}
const user = (id: string) =>
  turn(id, { role: "user", content: id, timestamp: 0 });
function assistant(id: string, live = false) {
  const message = fauxAssistantMessage(id);
  message.content.unshift({ type: "thinking", thinking: "working" });
  const record = turn(id, message);
  if (live) delete record.entryId;
  return record;
}
function response(id: string) {
  const step = assistant(`${id}-step`);
  if (step.message.role !== "assistant") throw new Error("Missing assistant");
  step.message.content.push({
    type: "toolCall",
    id: `${id}-tool`,
    name: "read",
    arguments: {},
  });
  return [
    user(`${id}-user`),
    step,
    turn(`${id}-result`, {
      role: "toolResult",
      toolCallId: `${id}-tool`,
      toolName: "read",
      content: [],
      isError: false,
      timestamp: 0,
    }),
    assistant(`${id}-final`),
  ];
}
function verifiedIndex() {
  const index = createFinishedWorkIndex(isVisibleRecord);
  return (records: TranscriptRecord[], running: boolean, revision?: string) => {
    const actual = index(records, running, revision);
    expect([...actual]).toEqual([
      ...finishedWork(records, running, isVisibleRecord),
    ]);
    for (const range of actual.values())
      expect(actual.get(range.final)).toBe(range);
    return actual;
  };
}

test("work index matches full calculation on finish/start, prepend, replacement and branch changes", () => {
  const index = verifiedIndex();
  const past = response("past");
  const tail = [user("next"), assistant("live", true)];
  const records = [...past, ...tail];
  const first = index(records, true, "branch");
  expect(
    index([...past, tail[0], assistant("live", true)], true, "branch"),
  ).toBe(first);
  index(records, false, "branch");
  index(records, true, "branch");
  index([...records, user("following")], true, "branch");
  index([...records, ...response("following")], false, "branch");
  index([...response("earlier"), ...records], false, "branch");
  index(records.slice(2), false, "branch");
  index([assistant("partial"), ...records], false, "branch");
  index([...past.slice(0, 1), assistant("regenerated")], false, "branch");
  index([...records].reverse(), false, "branch");
  index([...records].reverse(), true, "branch");
  index(records, false, "replacement");
  index(records, false);
  index([], false, "replacement");
});

test("visibility and live-to-saved identity changes invalidate the containing response", () => {
  const index = verifiedIndex();
  const custom: TranscriptRecord = {
    id: "custom",
    entryId: "custom",
    parentId: null,
    branchId: "branch",
    order: 0,
    kind: "custom-entry",
    customType: "extension",
    data: { value: true },
  };
  const final = assistant("live", true);
  const records = [user("u"), custom, final];
  expect(index(records, false, "branch").get(1)?.key).toBe("custom");
  index(
    [{ ...records[0] }, { ...custom, customType: "pig.rewind" }, final],
    false,
    "branch",
  );
  index(
    [records[0], custom, { ...final, id: "saved", entryId: "saved" }],
    false,
    "branch",
  );
  index([records[0], { ...final, display: false }], false, "branch");
  const mutable = [...records];
  index(mutable, false, "branch");
  mutable.push(user("next"));
  index(mutable, true, "branch");
  mutable.pop();
  index(mutable, false, "branch");
  final.entryId = final.id;
  final.message = fauxAssistantMessage("   ");
  expect(index(mutable, false, "branch").size).toBe(0);
});

test("IPC-shared records reuse work, while new envelopes remain authoritative", () => {
  const index = verifiedIndex();
  let current: Transcript = {
    ...emptyTranscript(),
    history: { revision: "branch" },
    running: true,
    records: [...response("saved"), user("next"), assistant("live", true)],
  };
  const first = index(current.records, true, "branch");
  for (let i = 0; i < 10; i++) {
    const incoming = structuredClone(current);
    incoming.records[incoming.records.length - 1] = assistant(
      `live-${i}`,
      true,
    );
    current = { ...current, ...shareTranscript(current, incoming) };
    expect(index(current.records, true, "branch")).toBe(first);
  }
  const incoming = structuredClone(current);
  for (const [i, record] of incoming.records.entries()) {
    record.branchId = "new leaf";
    record.order = i + 10;
    record.requestId = `receipt-${i}`;
  }
  current = { ...current, ...shareTranscript(current, incoming) };
  index(current.records, true, "branch");
  expect(current.records[0]).toMatchObject({
    branchId: "new leaf",
    order: 10,
    requestId: "receipt-0",
  });
});

test("100 live updates do not re-inspect completed response visibility or content", () => {
  const history = Array.from({ length: 200 }, (_, i) =>
    response(`saved-${i}`),
  ).flat();
  const prompt = user("new prompt");
  let visibilityReads = 0,
    contentReads = 0;
  for (const record of history) {
    if (record.message.role !== "assistant") continue;
    const content = record.message.content;
    Object.defineProperty(record.message, "content", {
      get() {
        contentReads++;
        return content;
      },
    });
  }
  const index = createFinishedWorkIndex((record) => {
    visibilityReads++;
    return isVisibleRecord(record);
  });
  const first = index(
    [...history, prompt, assistant("live", true)],
    true,
    "branch",
  );
  expect(visibilityReads).toBeGreaterThan(0);
  expect(contentReads).toBeGreaterThan(0);
  visibilityReads = contentReads = 0;
  for (let i = 0; i < 100; i++)
    expect(
      index([...history, prompt, assistant(`live-${i}`, true)], true, "branch"),
    ).toBe(first);
  expect(visibilityReads).toBe(0);
  expect(contentReads).toBe(0);
  expect(first.size).toBe(600);
});

test("mixed history edits always agree with full calculation", () => {
  const index = verifiedIndex();
  let records: TranscriptRecord[] = response("initial");
  let seed = 8672;
  for (let step = 0; step < 300; step++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const id = `step-${step}`;
    switch (seed % 7) {
      case 0:
        records = [...records, ...response(id)];
        break;
      case 1:
        records = [...records, assistant(id, true)];
        break;
      case 2:
        records = [...response(id), ...records];
        break;
      case 3:
        records = records.slice(seed % (records.length + 1));
        break;
      case 4:
        records = [...records].reverse();
        break;
      case 5:
        records = records.map((record, i) =>
          i === seed % records.length ? assistant(record.id) : record,
        );
        break;
      case 6:
        records = records.map((record, i) =>
          i === seed % records.length
            ? { ...record, requestId: id, branchId: id }
            : record,
        );
        break;
    }
    if (records.length > 100) records = records.slice(-80);
    index(records, !!(seed & 8), step % 17 === 0 ? id : "branch");
  }
});
