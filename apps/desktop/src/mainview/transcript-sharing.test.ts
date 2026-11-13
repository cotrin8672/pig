import { expect, test } from "bun:test";
import { packTranscript } from "../bun/transcript-wire";
import { emptyTranscript, type Transcript } from "../shared/transcript";
import { unpackTranscript } from "../shared/transcript-wire";
import { applyChatEvent, newerSnapshot } from "./chat-snapshot";
import { shareTranscript } from "./transcript-sharing";

function fixture(): Transcript {
  const content = [
    { type: "text" as const, text: "large output\n".repeat(1000) },
  ];
  const details = { lines: 1000 };
  return {
    ...emptyTranscript(),
    history: { revision: "branch" },
    records: [
      {
        id: "saved",
        entryId: "saved",
        parentId: null,
        branchId: "branch",
        order: 0,
        kind: "message",
        message: { role: "user", content: "question", timestamp: 0 },
      },
      {
        id: "result",
        entryId: "result",
        parentId: "saved",
        branchId: "branch",
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
      {
        id: "live",
        parentId: "result",
        branchId: "branch",
        order: 2,
        kind: "message",
        message: { role: "user", content: "changing", timestamp: 2 },
      },
    ],
    tools: { tool: { status: "done", result: { content, details } } },
  };
}
const throughIPC = (value: Transcript) =>
  unpackTranscript(JSON.parse(JSON.stringify(packTranscript(value))));

test("IPC clones reuse immutable entries and canonical results, never live records", () => {
  const current = fixture();
  for (const incoming of [structuredClone(current), throughIPC(current)]) {
    const next = shareTranscript(current, incoming);
    expect(next.records[0]).toBe(current.records[0]);
    expect(next.records[1]).toBe(current.records[1]);
    expect(next.tools.tool).toBe(current.tools.tool);
    expect(next.records[2]).toBe(incoming.records[2]);
    expect(next).toEqual(incoming);
  }
});

test("sharing does not hide envelope changes or cross branch revisions", () => {
  const current = fixture();
  for (const patch of [
    { requestId: "receipt" },
    { order: 10 },
    { parentId: "new" },
    { branchId: "new" },
  ]) {
    const incoming = throughIPC(current);
    Object.assign(incoming.records[0], patch);
    const shared = shareTranscript(current, incoming).records[0];
    expect(shared).toEqual(incoming.records[0]);
    expect(shared).not.toBe(current.records[0]);
    if (shared.kind !== "message" || current.records[0].kind !== "message")
      throw new Error("Missing message");
    expect(shared.message).toBe(current.records[0].message);
  }
  for (const history of [undefined, { revision: "replacement" }]) {
    const incoming = { ...throughIPC(current), history };
    expect(shareTranscript(current, incoming)).toBe(incoming);
  }
});

test("envelope changes retain immutable payloads and canonical tool state", () => {
  const current = fixture();
  for (const patch of [
    { requestId: "receipt" },
    { order: 10 },
    { parentId: "new" },
    { branchId: "new" },
    { rendererKey: "extension" },
  ]) {
    const incoming = throughIPC(current);
    for (const record of incoming.records) Object.assign(record, patch);
    const next = shareTranscript(current, incoming);
    expect(next).toEqual(incoming);
    for (let i = 0; i < 2; i++) {
      expect(next.records[i]).not.toBe(current.records[i]);
      expect(next.records[i]).toMatchObject(patch);
      const record = next.records[i];
      const old = current.records[i];
      if (record.kind !== "message" || old.kind !== "message")
        throw new Error("Missing message");
      expect(record.message).toBe(old.message);
    }
    expect(next.tools.tool).toBe(current.tools.tool);
    expect(next.records[2]).toBe(incoming.records[2]);
  }
  const withRequest = throughIPC(current);
  withRequest.records[1].requestId = "removed";
  const next = shareTranscript(withRequest, throughIPC(current));
  expect(next.records[1]).not.toHaveProperty("requestId");
  expect(next).toEqual(current);
});

test("custom and session payloads survive metadata changes without retaining old envelopes", () => {
  const current = fixture();
  current.records = [
    {
      id: "custom",
      entryId: "custom",
      parentId: null,
      branchId: "branch",
      order: 0,
      kind: "custom-entry",
      customType: "extension",
      data: { large: [1, 2] },
    },
    {
      id: "session",
      entryId: "session",
      parentId: "custom",
      branchId: "branch",
      order: 1,
      kind: "session-entry",
      entryType: "compaction",
      data: { summary: "saved" },
    },
  ];
  const incoming = throughIPC(current);
  for (const record of incoming.records) record.branchId = "new";
  const next = shareTranscript(current, incoming);
  expect(next).toEqual(incoming);
  for (let i = 0; i < 2; i++) {
    const record = next.records[i];
    const old = current.records[i];
    if (record.kind === "message" || old.kind === "message")
      throw new Error("Unexpected message");
    expect(record.data).toBe(old.data);
    expect(record.branchId).toBe("new");
  }
});

test("extension/live result differences and result metadata remain authoritative", () => {
  const current = fixture();
  const incoming = throughIPC(current);
  incoming.tools.tool = {
    status: "error",
    result: {
      content: [{ type: "text", text: "different live output" }],
      details: { lines: 1 },
    },
  };
  expect(shareTranscript(current, incoming).tools.tool).toBe(
    incoming.tools.tool,
  );
  const metadata = throughIPC(current);
  metadata.tools.tool.status = "error";
  (metadata.tools.tool.result as Record<string, unknown>).extra =
    "new metadata";
  const next = shareTranscript(current, metadata);
  expect(next.tools.tool).not.toBe(current.tools.tool);
  expect(next.tools.tool).toEqual(metadata.tools.tool);
  expect(next.records[1]).toBe(current.records[1]);
});

test("full and wire snapshots share only inside the same epoch", () => {
  const current = {
    address: { hostId: "host", sessionId: "chat", epoch: 1 },
    snapshotSeq: 1,
    info: { id: "chat", cwd: "project", title: "Chat", modified: 0 },
    effort: "off" as const,
    effortLevels: [],
    transcript: fixture(),
  };
  const incoming = {
    ...current,
    snapshotSeq: 2,
    transcript: throughIPC(current.transcript),
  };
  expect(newerSnapshot(current, incoming).transcript.records[0]).toBe(
    current.transcript.records[0],
  );
  const event = {
    type: "snapshot" as const,
    address: current.address,
    snapshotSeq: 2,
    transcript: incoming.transcript,
  };
  expect(applyChatEvent(current, event).transcript.tools.tool).toBe(
    current.transcript.tools.tool,
  );
  const replacement = {
    ...incoming,
    address: { ...current.address, epoch: 2 },
  };
  expect(newerSnapshot(current, replacement).transcript.records[0]).toBe(
    incoming.transcript.records[0],
  );
});
