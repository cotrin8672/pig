import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { hydrateChatSnapshot, newerSnapshot } from "../mainview/chat-snapshot";
import type { Snapshot } from "../shared/rpc-schema";
import {
  expandSnapshotDelta,
  type SnapshotDeltaEvent,
} from "../shared/snapshot-delta";
import { emptyTranscript } from "../shared/transcript";
import { SessionManager } from "./sdk";
import { SDKProjector } from "./sdk-projector";
import { createRuntimeDeltaEncoder } from "./snapshot-delta";
import { packSnapshot } from "./transcript-wire";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture(): Snapshot {
  const content = [{ type: "text" as const, text: "output\n".repeat(300000) }];
  return {
    address: { hostId: "delta", sessionId: "chat", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "chat", cwd: "fixture", title: "Chat", modified: 1 },
    effort: "off",
    effortLevels: [],
    transcript: {
      ...emptyTranscript(),
      history: { revision: "branch" },
      running: true,
      current: "live",
      records: [
        {
          id: "saved",
          entryId: "saved",
          parentId: null,
          branchId: "old-leaf",
          order: 0,
          kind: "message",
          message: { role: "user", content: "question", timestamp: 0 },
        },
        {
          id: "result",
          entryId: "result",
          parentId: "saved",
          branchId: "old-leaf",
          order: 1,
          kind: "message",
          message: {
            role: "toolResult",
            toolName: "read",
            toolCallId: "tool",
            content,
            isError: false,
            timestamp: 1,
          },
        },
        {
          id: "live",
          parentId: "result",
          branchId: "old-leaf",
          order: 2,
          kind: "message",
          message: fauxAssistantMessage("streaming"),
        },
      ],
      tools: { tool: { status: "done", result: { content } } },
    },
  };
}
test("live packets omit immutable payloads but preserve every envelope, tool result and byte", () => {
  const encode = createRuntimeDeltaEncoder();
  const original = fixture();
  const ready = encode({ type: "ready", snapshot: original });
  expect(ready.type).toBe("ready");
  const current = hydrateChatSnapshot(clone(packSnapshot(original)));
  const next = fixture();
  next.snapshotSeq = 2;
  next.info.title = "Renamed";
  next.transcript.records[0].requestId = "receipt";
  for (const record of next.transcript.records) record.branchId = "new-leaf";
  const encoded = clone(encode({ type: "snapshot", snapshot: next }));
  expect(encoded.type).toBe("snapshotDelta");
  const deltaBytes = Buffer.byteLength(JSON.stringify(encoded));
  const fullBytes = Buffer.byteLength(JSON.stringify(packSnapshot(next)));
  expect(deltaBytes).toBeLessThan(10000);
  expect(fullBytes).toBeGreaterThan(2000000);
  console.log(
    "Snapshot delta synthetic bytes",
    JSON.stringify({ fullBytes, deltaBytes }),
  );
  const expanded = expandSnapshotDelta(encoded as SnapshotDeltaEvent, current);
  expect(expanded).toEqual(hydrateChatSnapshot(clone(packSnapshot(next))));
  expect(
    expanded?.transcript.records[1].kind === "message" &&
      expanded.transcript.records[1].message,
  ).toBe(
    current.transcript.records[1].kind === "message" &&
      current.transcript.records[1].message,
  );
});
test("SDK history append through delta transport retains tool identities and updates envelopes", () => {
  const manager = SessionManager.inMemory("fixture");
  manager.appendMessage({ role: "user", content: "Read files", timestamp: 0 });
  const projector = new SDKProjector(manager, 1);
  for (let i = 0; i < 40; i++) {
    const call = fauxAssistantMessage("Read");
    call.content = [
      { type: "toolCall", id: `tool-${i}`, name: "read", arguments: {} },
    ];
    manager.appendMessage(call);
    const result = {
      content: [{ type: "text" as const, text: "large output\n".repeat(1000) }],
      details: { lines: 1000 },
      extra: "extension metadata",
    };
    projector.event({
      type: "tool_execution_end",
      toolCallId: `tool-${i}`,
      toolName: "read",
      result,
      isError: false,
    });
    manager.appendMessage({
      role: "toolResult",
      toolCallId: `tool-${i}`,
      toolName: "read",
      ...result,
      isError: false,
      timestamp: i,
    });
  }
  const encode = createRuntimeDeltaEncoder();
  const initial = { ...fixture(), transcript: projector.snapshot() };
  const ready = clone(encode({ type: "ready", snapshot: initial }));
  if (ready.type !== "ready") throw new Error("Missing ready snapshot");
  let current = hydrateChatSnapshot(ready.snapshot);
  for (let i = 0; i < 3; i++) {
    const leaf = manager.appendMessage(fauxAssistantMessage(`Append ${i}`));
    const snapshot = {
      ...initial,
      snapshotSeq: i + 2,
      transcript: projector.snapshot(),
    };
    const wire = clone(encode({ type: "snapshot", snapshot }));
    if (wire.type !== "snapshotDelta") throw new Error("Expected delta");
    const expanded = expandSnapshotDelta(wire, current);
    if (!expanded) throw new Error("Missing delta base");
    const next = newerSnapshot(current, expanded);
    expect(next).toEqual(hydrateChatSnapshot(clone(packSnapshot(snapshot))));
    expect(next.transcript.history?.revision).toBe(
      current.transcript.history?.revision,
    );
    for (let j = 0; j < initial.transcript.records.length; j++) {
      const record = next.transcript.records[j];
      const old = current.transcript.records[j];
      expect(record.branchId).toBe(leaf);
      expect(record).not.toBe(old);
      if (record.kind === "message" && old.kind === "message")
        expect(record.message).toBe(old.message);
    }
    for (const id of Object.keys(current.transcript.tools))
      expect(next.transcript.tools[id]).toBe(current.transcript.tools[id]);
    current = next;
  }
});

test("delta reconstruction drops removed envelope fields but retains payloads", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  initial.transcript.records[1].requestId = "old request";
  encode({ type: "ready", snapshot: initial });
  const current = hydrateChatSnapshot(clone(packSnapshot(initial)));
  const next = fixture();
  next.snapshotSeq = 2;
  const wire = clone(encode({ type: "snapshot", snapshot: next }));
  if (wire.type !== "snapshotDelta") throw new Error("Expected delta");
  const expanded = expandSnapshotDelta(wire, current);
  expect(expanded?.transcript.records[1]).not.toHaveProperty("requestId");
  expect(expanded).toEqual(hydrateChatSnapshot(clone(packSnapshot(next))));
});

test("missing/foreign/revision bases request a full snapshot, never a partial transcript", () => {
  const encode = createRuntimeDeltaEncoder();
  const initial = fixture();
  encode({ type: "ready", snapshot: initial });
  const event = encode({
    type: "snapshot",
    snapshot: { ...initial, snapshotSeq: 2 },
  }) as SnapshotDeltaEvent;
  expect(expandSnapshotDelta(event)).toBeUndefined();
  for (const altered of [
    { ...initial, address: { ...initial.address, epoch: 2 } },
    { ...initial, transcript: { ...initial.transcript, records: [] } },
    {
      ...initial,
      transcript: { ...initial.transcript, history: { revision: "other" } },
    },
  ])
    expect(expandSnapshotDelta(event, altered)).toBeUndefined();
  expect(initial.transcript.records).toHaveLength(3);
  for (const change of [
    { payloadRef: "missing" },
    { entryId: "foreign" },
    { kind: "other" },
    { message: { role: "user", content: "must not override the base" } },
  ]) {
    const malformed = clone(event);
    Object.assign(malformed.snapshot.transcript.records[0], change);
    expect(expandSnapshotDelta(malformed, initial)).toBeUndefined();
  }
  const missingResult = clone(event);
  missingResult.snapshot.transcript.toolResultRefs = { tool: "unknown-result" };
  expect(expandSnapshotDelta(missingResult, initial)).toBeUndefined();
});
test("branch, epoch, replacement and close reset the encoder; new/live records are always complete", () => {
  const encode = createRuntimeDeltaEncoder();
  let snapshot = fixture();
  encode({ type: "ready", snapshot });
  snapshot = {
    ...snapshot,
    snapshotSeq: 2,
    transcript: { ...snapshot.transcript, history: { revision: "rewind" } },
  };
  expect(encode({ type: "snapshot", snapshot }).type).toBe("snapshot");
  const delta = encode({
    type: "snapshot",
    snapshot: { ...snapshot, snapshotSeq: 3 },
  }) as SnapshotDeltaEvent;
  const live = delta.snapshot.transcript.records.at(-1);
  expect(live).toBeDefined();
  expect(live && "payloadRef" in live).toBe(false);
  encode({ type: "closed", address: snapshot.address, reason: "close" });
  expect(encode({ type: "snapshot", snapshot }).type).toBe("snapshot");
  const previous = snapshot.address;
  snapshot = { ...snapshot, address: { ...previous, epoch: 2 } };
  expect(encode({ type: "replaced", previous, snapshot }).type).toBe(
    "replaced",
  );
});
