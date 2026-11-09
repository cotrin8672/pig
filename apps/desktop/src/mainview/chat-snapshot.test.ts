import { expect, test } from "bun:test";
import { emptyTranscript } from "../shared/transcript";
import {
  applyChatEvent,
  type ChatSnapshot,
  hydrateChatSnapshot,
  newerSnapshot,
} from "./chat-snapshot";

const snapshot = (): ChatSnapshot => ({
  address: { hostId: "host", sessionId: "sdk-opaque-id", epoch: 4 },
  snapshotSeq: 1,
  info: { id: "sdk-opaque-id", cwd: "/project", title: "Chat", modified: 1 },
  transcript: emptyTranscript(),
  effort: "off",
  effortLevels: ["off"],
});
const event = () => ({
  type: "snapshot" as const,
  address: snapshot().address,
  snapshotSeq: 2,
  transcript: emptyTranscript(),
});

test("failure events retain actionable details without an assistant message", () => {
  const next = applyChatEvent(snapshot(), {
    ...event(),
    failure: "No model configured",
  });
  expect(next.failure).toBe("No model configured");
  expect(next.transcript.records).toHaveLength(0);
});
test("abort events are distinct from failures", () => {
  const next = applyChatEvent(snapshot(), { ...event(), aborted: true });
  expect(next.aborted).toBe(true);
  expect(next.failure).toBeUndefined();
});
test("a new authoritative event clears stale failure and abort state", () => {
  const next = applyChatEvent(
    { ...snapshot(), failure: "Old error", aborted: true },
    { ...event(), transcript: { ...emptyTranscript(), running: true } },
  );
  expect(next.failure).toBeUndefined();
  expect(next.aborted).toBeUndefined();
  expect(next.transcript.running).toBe(true);
});
test("session open preserves supplied projected failure fields", () => {
  expect(
    hydrateChatSnapshot({ ...snapshot(), failure: "faulted" }).failure,
  ).toBe("faulted");
});
test("SDK projected preflight, model, abort and compaction failures survive restore", () => {
  for (const failure of [
    "No model",
    "Provider unavailable",
    "Compaction failed",
  ])
    expect(hydrateChatSnapshot({ ...snapshot(), failure }).failure).toBe(
      failure,
    );
  expect(hydrateChatSnapshot({ ...snapshot(), aborted: true }).aborted).toBe(
    true,
  );
});
test("failure projection is preserved without requiring executable legacy live state", () => {
  const current = { ...snapshot(), failure: "Compaction failed" };
  expect(hydrateChatSnapshot(current)).toBe(current);
});
test("stale, duplicate and foreign-address events cannot affect current epoch", () => {
  const current = snapshot();
  for (const patch of [
    { snapshotSeq: 1 },
    { snapshotSeq: 0 },
    { address: { ...current.address, epoch: 3 } },
    { address: { ...current.address, hostId: "other" } },
    { address: { ...current.address, sessionId: "other" } },
  ])
    expect(applyChatEvent(current, { ...event(), ...patch })).toBe(current);
});
test("late open response cannot regress a newer publication or replacement", () => {
  const current = { ...snapshot(), snapshotSeq: 8 };
  expect(newerSnapshot(current, snapshot())).toBe(current);
  expect(
    newerSnapshot(current, {
      ...snapshot(),
      address: { ...current.address, epoch: 3 },
      snapshotSeq: 100,
    }),
  ).toBe(current);
  expect(
    newerSnapshot(current, {
      ...snapshot(),
      address: { ...current.address, epoch: 5 },
      snapshotSeq: 0,
    }).address.epoch,
  ).toBe(5);
});
