import { expect, test } from "bun:test";
import type { Snapshot } from "../shared/rpc-schema";
import type { RuntimeWireEvent } from "../shared/snapshot-delta";
import { emptyTranscript } from "../shared/transcript";
import { ClientHub, type ClientSender } from "./client-hub";

function client() {
  const received: { name: string; payload: unknown }[] = [];
  const send: ClientSender = (name, payload) => {
    received.push({ name, payload });
  };
  return { received, send };
}
function snapshot(): Snapshot {
  const record = {
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
    snapshotSeq: 1,
    info: { id: "chat", cwd: "fixture", title: "Chat", modified: 1 },
    transcript: {
      ...emptyTranscript(),
      history: { revision: "r1" },
      records: [record],
    } as unknown as Snapshot["transcript"],
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
  hub.runtime({ type: "snapshot", snapshot: snapshot() });
  hub.runtime({ type: "snapshot", snapshot: snapshot() });
  // A window opened later must not receive deltas against bases it never saw.
  const second = client();
  hub.add("second", second.send);
  hub.runtime({ type: "snapshot", snapshot: snapshot() });
  expect(runtimeEvents(first.received)).toEqual([
    "snapshot",
    "snapshotDelta",
    "snapshotDelta",
  ]);
  expect(runtimeEvents(second.received)).toEqual(["snapshot"]);
  // A reloaded page starts again from a self-contained snapshot.
  hub.reset("first");
  hub.runtime({ type: "snapshot", snapshot: snapshot() });
  expect(runtimeEvents(first.received).at(-1)).toBe("snapshot");
  expect(runtimeEvents(second.received).at(-1)).toBe("snapshotDelta");
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
