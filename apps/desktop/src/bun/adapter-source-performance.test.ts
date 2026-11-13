import { expect, test } from "bun:test";
import type {
  AgentSession,
  AgentSessionEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { createAdapterSource } from "./adapter-source";

test("pure text deltas notify raw listeners but do not invalidate persisted adapter snapshots", () => {
  let emit!: (event: AgentSessionEvent) => void;
  const entries: SessionEntry[] = [];
  const session = {
    sessionManager: {
      getSessionId: () => "snapshot-perf",
      getCwd: () => "fixture",
      getLeafId: () => entries.at(-1)?.id ?? null,
      getEntryCount: () => entries.length,
      getBranch: () => entries,
      getEntries: () => entries,
    },
    subscribe: (listener: typeof emit) => {
      emit = listener;
      return () => {};
    },
  } as unknown as AgentSession;
  const source = createAdapterSource(
    session,
    { on: () => () => {}, emit() {} },
    () => {},
  );
  let snapshots = 0,
    rawEvents = 0;
  source.backend.subscribe(() => snapshots++);
  source.backend.onEvent(() => rawEvents++);
  const delta = {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "delta" }] },
  } as AgentSessionEvent;
  for (let i = 0; i < 100; i++) emit(delta);
  expect(rawEvents).toBe(100);
  expect(snapshots).toBe(0);
  entries.push({
    type: "custom",
    id: "hook-write",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    customType: "state",
    data: {},
  });
  emit(delta);
  expect(snapshots).toBe(1);
  emit({
    type: "tool_execution_update",
    toolName: "read",
    toolCallId: "tool",
    partialResult: { content: [] },
  } as AgentSessionEvent);
  expect(snapshots).toBe(2);
  source.refresh();
  expect(snapshots).toBe(3);
  source.dispose();
});
