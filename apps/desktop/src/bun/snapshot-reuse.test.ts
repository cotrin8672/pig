import { expect, test } from "bun:test";
import {
  hydrateChatSnapshot,
  newerSnapshot,
  prependHistory,
} from "../mainview/chat-snapshot";
import { shareTranscript } from "../mainview/transcript-sharing";
import type { Snapshot } from "../shared/rpc-schema";
import {
  expandSnapshotDelta,
  type SnapshotDeltaEvent,
} from "../shared/snapshot-delta";
import { emptyTranscript, type TranscriptRecord } from "../shared/transcript";
import { createRuntimeDeltaEncoder } from "./snapshot-delta";
import { packSnapshot } from "./transcript-wire";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture(): Snapshot {
  const content = [{ type: "text" as const, text: "saved tool output" }];
  const details = { lines: 1 };
  return {
    address: { hostId: "reuse", sessionId: "chat", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "chat", cwd: "fixture", title: "Chat", modified: 1 },
    effort: "off",
    effortLevels: [],
    transcript: {
      ...emptyTranscript(),
      history: { revision: "branch" },
      records: [
        {
          id: "question",
          entryId: "question",
          parentId: null,
          branchId: "leaf",
          order: 0,
          kind: "message",
          message: { role: "user", content: "Read", timestamp: 0 },
        },
        {
          id: "result",
          entryId: "result",
          parentId: "question",
          branchId: "leaf",
          order: 1,
          kind: "message",
          message: {
            role: "toolResult",
            toolCallId: "tool",
            toolName: "read",
            content,
            details,
            isError: false,
            timestamp: 1,
          },
        },
      ],
      tools: {
        tool: {
          status: "done",
          result: { content, details, extra: { value: 1 } },
        },
      },
    },
  };
}
function delta(
  encode: ReturnType<typeof createRuntimeDeltaEncoder>,
  snapshot: Snapshot,
): SnapshotDeltaEvent {
  const event = copy(encode({ type: "snapshot", snapshot }));
  if (event.type !== "snapshotDelta") throw new Error("Expected delta");
  return event;
}
const full = (snapshot: Snapshot) =>
  hydrateChatSnapshot(copy(packSnapshot(snapshot)));

test("unchanged records and canonical completed tools reuse exact bases without retransmitting envelopes", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  encode({ type: "ready", snapshot: initial });
  const current = full(initial);
  const next = { ...copy(initial), snapshotSeq: 2 };
  const event = delta(encode, next);
  expect(event.snapshot.transcript.records).toEqual([]);
  expect(event.reuse).toEqual({
    baseSeq: 1,
    tools: "remaining",
    recordCount: 2,
  });
  expect(event.snapshot.transcript.tools).toEqual({});
  expect(event.snapshot.transcript.toolResultRefs).toBeUndefined();
  const expanded = expandSnapshotDelta(event, current);
  expect(expanded).toEqual(full(next));
  expect(expanded?.transcript.records[0]).toBe(current.transcript.records[0]);
  expect(expanded?.transcript.tools.tool).toBe(current.transcript.tools.tool);
  if (!expanded) throw new Error("Missing base");
  let envelopeReads = 0;
  Object.defineProperty(current.transcript.records[0], "rendererKey", {
    enumerable: true,
    get() {
      envelopeReads++;
      return "same-renderer";
    },
  });
  expect(shareTranscript(current.transcript, expanded.transcript)).toBe(
    expanded.transcript,
  );
  expect(envelopeReads).toBe(0);
});

test("in-place envelope/metadata edits, field removals and completed status changes remain authoritative", () => {
  const encode = createRuntimeDeltaEncoder();
  const input = fixture();
  encode({ type: "ready", snapshot: input });
  let current = full(input);
  for (const mutate of [
    () => {
      input.transcript.records[0].requestId = "accepted-send";
      const result = input.transcript.tools.tool.result as {
        extra: { value: number };
      };
      result.extra.value = 2;
    },
    () => {
      delete input.transcript.records[0].requestId;
      delete (input.transcript.tools.tool.result as { extra?: unknown }).extra;
      input.transcript.tools.tool.status = "error";
    },
    () => {
      input.transcript.records.reverse();
      input.transcript.records.forEach((record, index) => {
        record.branchId = "new-leaf";
        record.order = index;
      });
    },
  ]) {
    mutate();
    input.snapshotSeq++;
    const event = delta(encode, input);
    const expanded = expandSnapshotDelta(event, current);
    expect(expanded).toEqual(full(input));
    if (!expanded) throw new Error("Missing base");
    current = expanded;
  }
});

test("extension output differing from persistence and transient tool records never reuse a saved result", () => {
  for (const transient of [false, true]) {
    const encode = createRuntimeDeltaEncoder();
    const initial = fixture();
    if (transient) delete initial.transcript.records[1].entryId;
    encode({ type: "ready", snapshot: initial });
    const next = copy(initial);
    next.snapshotSeq++;
    const content = [
      { type: "text" as const, text: "changed extension output" },
    ];
    next.transcript.tools.tool.result = { content, extra: "changed" };
    if (transient) {
      const record = next.transcript.records[1];
      if (record.kind !== "message" || record.message.role !== "toolResult")
        throw new Error("Missing result");
      record.message.content = content;
      delete record.message.details;
    }
    const event = delta(encode, next);
    expect(event.reuse?.tools ?? []).not.toContain("tool");
    expect(event.snapshot.transcript.tools).toHaveProperty("tool");
    expect(expandSnapshotDelta(event, full(initial))).toEqual(full(next));
  }
});

test("reuse survives explicitly loaded history without inheriting unrelated old tail tools", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  encode({ type: "ready", snapshot: initial });
  const current = full(initial);
  const older: TranscriptRecord = {
    ...current.transcript.records[0],
    id: "older",
    entryId: "older",
    order: -1,
  };
  current.transcript.records = [older, ...current.transcript.records];
  current.transcript.tools.olderTool = { status: "done", result: "older" };
  const next = { ...copy(initial), snapshotSeq: 2 };
  const event = delta(encode, next);
  const expanded = expandSnapshotDelta(event, current);
  expect(expanded).toEqual(full(next));
  expect(expanded?.transcript.tools).not.toHaveProperty("olderTool");
  if (!expanded) throw new Error("Missing base");
  const applied = newerSnapshot(current, expanded);
  expect(applied).toEqual(newerSnapshot(current, full(next)));
  expect(applied.transcript.records[0]).toBe(older);
  const badRecord = copy(event);
  badRecord.snapshot.transcript.records = ["older"];
  expect(expandSnapshotDelta(badRecord, current)).toBeUndefined();
  const badTool = copy(event);
  if (badTool.reuse) badTool.reuse.tools = ["olderTool"];
  expect(expandSnapshotDelta(badTool, current)).toBeUndefined();
});

test("wire-tail membership survives paging and repeated envelope edits, sharing and history retention", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  if (!initial.transcript.history) throw new Error("Missing history");
  initial.transcript.history.before = "question";
  encode({ type: "ready", snapshot: initial });
  const current = full(initial);
  let applied = prependHistory(
    current,
    {
      ...emptyTranscript(),
      history: { revision: "branch" },
      records: [
        {
          ...current.transcript.records[0],
          id: "older",
          entryId: "older",
          order: -1,
        },
      ],
      tools: { olderTool: { status: "done", result: "older" } },
    },
    "question",
  );
  for (let seq = 2; seq < 6; seq++) {
    const next = copy(initial);
    next.snapshotSeq = seq;
    next.transcript.records[0].requestId = `request-${seq}`;
    const event = delta(encode, next);
    expect(event.reuse?.recordCount).toBe(2);
    const expanded = expandSnapshotDelta(event, applied);
    expect(expanded).toEqual(full(next));
    if (!expanded) throw new Error("Missing tail base");
    const updated = newerSnapshot(applied, expanded);
    expect(updated).toEqual(newerSnapshot(applied, full(next)));
    expect(updated.transcript.records).toHaveLength(3);
    expect(updated.transcript.tools.olderTool).toBe(
      applied.transcript.tools.olderTool,
    );
    applied = updated;
  }
});

test("changing the canonical result target or removing tools never reuses a previous payload", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  encode({ type: "ready", snapshot: initial });
  const next = copy(initial);
  next.snapshotSeq = 2;
  next.transcript.records[1].id = "new-result";
  next.transcript.records[1].entryId = "new-result";
  const event = delta(encode, next);
  expect(event.reuse?.tools ?? []).not.toContain("tool");
  expect(event.snapshot.transcript.toolResultRefs).toEqual({
    tool: "new-result",
  });
  const expanded = expandSnapshotDelta(event, full(initial));
  expect(expanded).toEqual(full(next));
  const removed = copy(next);
  removed.snapshotSeq = 3;
  removed.transcript.records.pop();
  delete removed.transcript.tools.tool;
  expect(expandSnapshotDelta(delta(encode, removed), full(next))).toEqual(
    full(removed),
  );
});

test("missing, duplicated, conflicting and out-of-sequence reuse never produces a partial snapshot", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  encode({ type: "ready", snapshot: initial });
  const event = delta(encode, { ...copy(initial), snapshotSeq: 2 });
  const bad: SnapshotDeltaEvent[] = [];
  const change = (mutate: (value: SnapshotDeltaEvent) => void) => {
    const value = copy(event);
    mutate(value);
    bad.push(value);
  };
  change((value) => {
    delete value.reuse;
  });
  change((value) => {
    if (value.reuse) value.reuse.baseSeq = 0;
  });
  change((value) => {
    value.snapshot.transcript.records[0] = "unknown";
  });
  change((value) => {
    value.snapshot.transcript.records.push("question");
    value.snapshot.transcript.records.push("question");
  });
  change((value) => {
    if (value.reuse) value.reuse.recordCount = -1;
  });
  change((value) => {
    if (value.reuse) value.reuse.recordCount = 0;
  });
  change((value) => {
    if (value.reuse) value.reuse.recordCount = 1;
  });
  change((value) => {
    if (value.reuse) value.reuse.recordCount = 100;
  });
  change((value) => {
    if (value.reuse) value.reuse.recordCount = 1.5;
  });
  change((value) => {
    if (value.reuse) value.reuse.tools = ["tool", "tool"];
  });
  change((value) => {
    if (value.reuse) value.reuse.tools = ["missing"];
  });
  change((value) => {
    if (value.reuse) value.reuse.tools = ["tool"];
    value.snapshot.transcript.tools.tool = { status: "done" };
  });
  change((value) => {
    value.snapshot.transcript.toolResultRefs = { tool: "result" };
  });
  const current = full(initial);
  for (const value of bad)
    expect(expandSnapshotDelta(value, current)).toBeUndefined();
  expect(
    expandSnapshotDelta(event, { ...current, snapshotSeq: 2 }),
  ).toBeUndefined();
  expect(expandSnapshotDelta(event, current)).toEqual(
    full({ ...initial, snapshotSeq: 2 }),
  );
});

test("lost metadata deltas recover only from an authoritative complete base", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  encode({ type: "ready", snapshot: initial });
  delta(encode, { ...initial, snapshotSeq: 2 });
  const third = delta(encode, { ...initial, snapshotSeq: 3 });
  expect(expandSnapshotDelta(third, full(initial))).toBeUndefined();
  encode.reset(initial.address);
  const fourth = encode({
    type: "snapshot",
    snapshot: { ...initial, snapshotSeq: 4 },
  });
  expect(fourth.type).toBe("snapshot");
  if (fourth.type !== "snapshot") throw new Error("Expected full recovery");
  const fifth = delta(encode, { ...initial, snapshotSeq: 5 });
  expect(expandSnapshotDelta(fifth, full(fourth.snapshot))).toEqual(
    full({ ...initial, snapshotSeq: 5 }),
  );
});

test("oversized metadata falls back to full tool state without retaining it in the reuse table", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  (initial.transcript.tools.tool.result as { extra: unknown }).extra =
    "large".repeat(10000);
  encode({ type: "ready", snapshot: initial });
  const next = { ...initial, snapshotSeq: 2 };
  const event = delta(encode, next);
  expect(event.reuse?.tools ?? []).not.toContain("tool");
  expect(event.snapshot.transcript.tools).toHaveProperty("tool");
  expect(expandSnapshotDelta(event, full(initial))).toEqual(full(next));
});

test("the aggregate tool metadata budget falls back without omitting any tool state", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  const record = initial.transcript.records.pop();
  const tool = initial.transcript.tools.tool;
  if (record?.kind !== "message" || record.message.role !== "toolResult")
    throw new Error("Missing result fixture");
  const message = record.message;
  initial.transcript.tools = {};
  for (let i = 0; i < 800; i++) {
    const id = `result-${i}`;
    const toolCallId = `tool-${i}`;
    initial.transcript.records.push({
      ...record,
      id,
      entryId: id,
      order: i + 1,
      message: { ...message, toolCallId },
    });
    initial.transcript.tools[toolCallId] = {
      ...tool,
      result: {
        content: message.content,
        details: message.details,
        extra: "x".repeat(1024),
      },
    };
  }
  encode({ type: "ready", snapshot: initial });
  const next = { ...initial, snapshotSeq: 2 };
  const event = delta(encode, next);
  const completeTools = Object.keys(event.snapshot.transcript.tools).length;
  expect(completeTools).toBeGreaterThan(0);
  expect(completeTools).toBeLessThan(800);
  expect(expandSnapshotDelta(event, full(initial))).toEqual(full(next));
});

test("large numeric metadata stops the reuse probe before walking the complete payload", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  const metadata = Array.from({ length: 100000 }, (_, index) => index);
  let reads = 0;
  Object.defineProperty(metadata, 90000, {
    enumerable: true,
    get() {
      reads++;
      return 90000;
    },
  });
  (initial.transcript.tools.tool.result as { extra: unknown }).extra = metadata;
  encode({ type: "ready", snapshot: initial });
  const event = encode({
    type: "snapshot",
    snapshot: { ...initial, snapshotSeq: 2 },
  });
  expect(reads).toBe(0);
  expect(event.type).toBe("snapshotDelta");
  if (event.type !== "snapshotDelta") throw new Error("Expected delta");
  expect(event.snapshot.transcript.tools.tool).toBeDefined();
  expect(expandSnapshotDelta(copy(event), full(initial))).toEqual(
    full({ ...initial, snapshotSeq: 2 }),
  );
});

test("reuse bases release saved record bodies and SDK tool objects", async () => {
  const encode = createRuntimeDeltaEncoder();
  const seed = () => {
    const initial = fixture();
    const record = initial.transcript.records[1];
    const tool = initial.transcript.tools.tool;
    if (
      record.kind !== "message" ||
      record.message.role !== "toolResult" ||
      !tool.result ||
      typeof tool.result !== "object"
    )
      throw new Error("Missing result fixture");
    encode({ type: "ready", snapshot: initial });
    return [
      new WeakRef(record),
      new WeakRef(record.message.content),
      new WeakRef(tool),
      new WeakRef(tool.result),
    ];
  };
  const refs = seed();
  for (let index = 0; index < 8; index++) {
    await Bun.sleep(0);
    Bun.gc(true);
  }
  for (const ref of refs) expect(ref.deref()).toBeUndefined();
});
