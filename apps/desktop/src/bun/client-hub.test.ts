import { expect, test } from "bun:test";
import type { Snapshot } from "../shared/rpc-schema";
import type { RuntimeWireEvent } from "../shared/snapshot-delta";
import { emptyTranscript, type TranscriptRecord } from "../shared/transcript";
import { ClientHub, type ClientSender } from "./client-hub";

function client() {
  const received: { name: string; payload: unknown }[] = [];
  const send: ClientSender = (name, payload) => {
    received.push({ name, payload });
  };
  return { received, send };
}
function snapshot(seq = 1): Snapshot {
  const record: TranscriptRecord = {
    id: "entry",
    entryId: "entry",
    kind: "message",
    parentId: null,
    branchId: "main",
    order: 0,
    message: { role: "user", content: "hello", timestamp: 1 },
  };
  return {
    address: { hostId: "host", sessionId: "chat", epoch: 1 },
    snapshotSeq: seq,
    info: { id: "chat", cwd: "fixture", title: "Chat", modified: 1 },
    transcript: {
      ...emptyTranscript(),
      history: { revision: "r1" },
      records: [record],
    },
    effort: "off",
    effortLevels: [],
  };
}
const runtimeEvents = (received: { name: string; payload: unknown }[]) =>
  received
    .filter((item) => item.name === "runtimeEvent")
    .map((item) => (item.payload as RuntimeWireEvent).type);

test("each window gets its own delta base and one transcript per publication", () => {
  const hub = new ClientHub();
  const first = client();
  hub.add("first", first.send);
  hub.runtime({ type: "snapshot", snapshot: snapshot(1) });
  hub.runtime({ type: "snapshot", snapshot: snapshot(2) });
  // A window opened later must not receive deltas against bases it never saw.
  const second = client();
  hub.add("second", second.send);
  hub.runtime({ type: "snapshot", snapshot: snapshot(3) });
  expect(runtimeEvents(first.received)).toEqual([
    "snapshot",
    "snapshotDelta",
    "snapshotDelta",
  ]);
  expect(runtimeEvents(second.received)).toEqual(["snapshot"]);
  // A reloaded page starts again from a self-contained snapshot.
  hub.reset("first");
  hub.runtime({ type: "snapshot", snapshot: snapshot(4) });
  expect(runtimeEvents(first.received).at(-1)).toBe("snapshot");
  expect(runtimeEvents(second.received).at(-1)).toBe("snapshotDelta");
});

test("full RPC reads reset the owner's base in every window without resetting other chats", () => {
  const hub = new ClientHub();
  const first = client();
  const second = client();
  hub.add("first", first.send);
  hub.add("second", second.send);
  const other: Snapshot = {
    ...snapshot(),
    address: { ...snapshot().address, sessionId: "other" },
    info: { ...snapshot().info, id: "other" },
  };
  hub.runtime({ type: "snapshot", snapshot: snapshot(1) });
  hub.runtime({ type: "snapshot", snapshot: other });
  hub.resetRuntime(snapshot().address);
  hub.runtime({ type: "snapshot", snapshot: snapshot(2) });
  hub.runtime({ type: "snapshot", snapshot: { ...other, snapshotSeq: 2 } });
  for (const target of [first, second])
    expect(runtimeEvents(target.received)).toEqual([
      "snapshot",
      "snapshot",
      "snapshot",
      "snapshotDelta",
    ]);
  hub.resetRuntime();
  hub.runtime({ type: "snapshot", snapshot: snapshot(3) });
  expect(runtimeEvents(first.received).at(-1)).toBe("snapshot");
  expect(runtimeEvents(second.received).at(-1)).toBe("snapshot");
});

test("broadcast survives a failing window; targeted messages reach one window", () => {
  const hub = new ClientHub();
  const healthy = client();
  const errors = console.error;
  console.error = () => {};
  try {
    hub.add("broken", () => {
      throw new Error("closed");
    });
    hub.add("healthy", healthy.send);
    hub.broadcast("projects", ["/work"]);
    hub.to("healthy", "windowState", { maximized: true });
    hub.to("missing", "windowState", { maximized: false });
  } finally {
    console.error = errors;
  }
  expect(healthy.received).toEqual([
    { name: "projects", payload: ["/work"] },
    { name: "windowState", payload: { maximized: true } },
  ]);
  hub.remove("broken");
  expect(hub.ids()).toEqual(["healthy"]);
  expect(() => hub.add("healthy", healthy.send)).toThrow();
});
