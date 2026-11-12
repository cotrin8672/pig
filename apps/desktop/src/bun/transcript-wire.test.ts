import { expect, test } from "bun:test";
import {
  applyChatEvent,
  hydrateChatSnapshot,
  newerSnapshot,
  prependHistory,
} from "../mainview/chat-snapshot";
import type { Snapshot } from "../shared/rpc-schema";
import type {
  RuntimeEvent,
  RuntimeViewState,
} from "../shared/runtime-contract";
import { emptyTranscript, type Transcript } from "../shared/transcript";
import { unpackTranscript } from "../shared/transcript-wire";
import {
  packOpenState,
  packRuntimeEvent,
  packRuntimeState,
  packSnapshot,
  packTranscript,
} from "./transcript-wire";

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture(): Transcript {
  const content = [
    { type: "text" as const, text: "large output".repeat(10_000) },
    {
      type: "image" as const,
      mimeType: "image/png",
      data: "YWJj".repeat(10_000),
    },
  ];
  const details = { diff: "large diff".repeat(10_000), nested: ["metadata"] };
  return {
    ...emptyTranscript(),
    history: { revision: "branch", before: "entry" },
    records: [
      {
        id: "entry",
        entryId: "entry",
        parentId: "previous",
        branchId: "branch",
        order: 50,
        kind: "message",
        details: { recordMetadata: true },
        message: {
          role: "toolResult",
          toolCallId: "tool",
          toolName: "read",
          content,
          details,
          isError: true,
          timestamp: 1,
        },
      },
    ],
    tools: {
      tool: {
        status: "error",
        result: {
          content: structuredClone(content),
          details: structuredClone(details),
          extra: { extensionMetadata: true },
        },
      },
    },
  };
}
function snapshot(transcript = fixture()): Snapshot {
  return {
    address: { hostId: "host", sessionId: "chat", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "chat", cwd: "fixture", title: "Chat", modified: 1 },
    effort: "off",
    effortLevels: [],
    transcript,
  };
}
function expectShared(transcript: Transcript) {
  const record = transcript.records.find((r) => r.id === "entry");
  if (record?.kind !== "message" || record.message.role !== "toolResult")
    throw new Error("Missing tool record");
  expect((transcript.tools.tool.result as { content: unknown }).content).toBe(
    record.message.content,
  );
  expect((transcript.tools.tool.result as { details: unknown }).details).toBe(
    record.message.details,
  );
}

test("wire packets halve repeated tool text, images and details without changing SDK projections", () => {
  const transcript = fixture();
  const original = json(transcript);
  const packed = packTranscript(transcript);
  expect(packed.toolResultRefs).toEqual({ tool: "entry" });
  expect(packed.tools.tool.result).toEqual({
    extra: { extensionMetadata: true },
  });
  expect(JSON.stringify(packed).length).toBeLessThan(
    JSON.stringify(transcript).length * 0.51,
  );
  expect(json(transcript)).toEqual(original);
  const decoded = unpackTranscript(json(packed));
  expect(decoded).toEqual(original);
  expectShared(decoded);
  expect(unpackTranscript(decoded)).toBe(decoded);
  expect(packTranscript(packed)).toBe(packed);
});

test("live, absent and mismatched results are retained rather than referenced by tool ID alone", () => {
  const transcript = fixture();
  for (const result of [
    undefined,
    "opaque result",
    ["opaque array"],
    { content: [{ type: "text", text: "partial" }] },
    {
      content: (transcript.tools.tool.result as { content: unknown }).content,
      details: { different: true },
    },
  ]) {
    const current = {
      ...transcript,
      tools: { tool: { status: "running" as const, result } },
    };
    expect(packTranscript(current)).toBe(current);
    expect(unpackTranscript(json(packTranscript(current)))).toEqual(
      json(current),
    );
  }
  const withoutRecord = { ...transcript, records: [] };
  expect(packTranscript(withoutRecord)).toBe(withoutRecord);
});

test("duplicate tool IDs only reference a matching record in the same packet", () => {
  const transcript = fixture();
  const record = transcript.records[0];
  if (record.kind !== "message" || record.message.role !== "toolResult")
    throw new Error("Missing result");
  transcript.records.unshift({
    ...record,
    id: "different",
    message: {
      ...record.message,
      content: [{ type: "text", text: "different" }],
    },
  });
  expect(packTranscript(transcript).toolResultRefs).toEqual({ tool: "entry" });
  expect(unpackTranscript(json(packTranscript(transcript)))).toEqual(
    json(transcript),
  );
  expect(() =>
    unpackTranscript({
      ...packTranscript(transcript),
      toolResultRefs: { tool: "missing" },
    }),
  ).toThrow("Invalid tool result reference");
  expect(() =>
    unpackTranscript({
      ...packTranscript(transcript),
      toolResultRefs: { foreign: "entry" },
    }),
  ).toThrow("Invalid tool result reference");
});

test("missing optional details and empty results remain lossless", () => {
  const transcript = fixture();
  const record = transcript.records[0];
  if (record.kind !== "message" || record.message.role !== "toolResult")
    throw new Error("Missing result");
  delete record.message.details;
  record.message.content = [];
  transcript.tools.tool.result = { content: [] };
  expect(unpackTranscript(json(packTranscript(transcript)))).toEqual(
    json(transcript),
  );
});

test("open, live, replaced and reconnect snapshots all carry self-contained references", () => {
  const original = snapshot();
  const events: RuntimeEvent[] = [
    { type: "ready", openId: "open", snapshot: original },
    { type: "snapshot", snapshot: original },
    {
      type: "replaced",
      previous: { ...original.address, epoch: 0 },
      snapshot: original,
    },
  ];
  for (const event of events) {
    const packet = json(packRuntimeEvent(event));
    if (!("snapshot" in packet)) throw new Error("Missing snapshot");
    expect(hydrateChatSnapshot(packet.snapshot)).toEqual(json(original));
    expectShared(hydrateChatSnapshot(packet.snapshot).transcript);
  }
  const open = json(packOpenState({ state: "ready", snapshot: original }));
  if (open.state !== "ready") throw new Error("Missing open snapshot");
  expect(hydrateChatSnapshot(open.snapshot)).toEqual(json(original));
  const state: RuntimeViewState = {
    hostId: "host",
    sessions: [
      { phase: "ready", address: original.address, snapshot: original },
      {
        phase: "opening",
        address: { ...original.address, sessionId: "pending" },
      },
    ],
    drafts: [],
    pendingUI: [],
    statuses: [],
  };
  const packed = json(packRuntimeState(state));
  expect(packed.sessions[1].snapshot).toBeUndefined();
  const restored = packed.sessions[0].snapshot;
  if (!restored) throw new Error("Missing reconnect snapshot");
  expect(hydrateChatSnapshot(restored)).toEqual(json(original));
  for (const state of [
    { state: "unknown" },
    { state: "failed", message: "fixture" },
  ] as const)
    expect(packOpenState(state)).toBe(state);
  const closed: RuntimeEvent = {
    type: "closed",
    address: original.address,
    reason: "close",
  };
  expect(packRuntimeEvent(closed)).toBe(closed);
});

test("frontend hydration handles initial, streaming, replacement and history pages before merging", () => {
  const original = snapshot();
  const packed = json(packSnapshot(original));
  expectShared(newerSnapshot(undefined, packed).transcript);
  const current = snapshot({
    ...emptyTranscript(),
    history: { revision: "branch", before: "entry" },
  });
  const incoming = { ...packed, snapshotSeq: 2 };
  expectShared(newerSnapshot(current, incoming).transcript);
  expectShared(
    applyChatEvent(current, {
      type: "snapshot",
      address: original.address,
      snapshotSeq: 2,
      transcript: incoming.transcript,
    }).transcript,
  );
  expectShared(
    prependHistory(current, json(packTranscript(original.transcript)), "entry")
      .transcript,
  );
  const replacement = { ...packed, address: { ...packed.address, epoch: 2 } };
  expectShared(newerSnapshot(current, replacement).transcript);
  expect(newerSnapshot(current, packed)).toBe(current);
});
