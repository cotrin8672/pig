import { expect, test } from "bun:test";
import type {
  AgentSession,
  AgentSessionEvent,
  EventBus,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { createAdapterSource } from "./adapter-source";

test("source retains parent identity and observes committed changes even after command failure", async () => {
  let listener!: (event: AgentSessionEvent) => void;
  const entries: SessionEntry[] = [];
  let calls = 0;
  let scans = 0;
  const session = {
    isStreaming: false,
    sessionManager: {
      getSessionId: () => "s",
      getCwd: () => "test",
      getLeafId: () => entries.at(-1)?.id ?? null,
      getBranch: () => {
        scans++;
        return entries;
      },
      getEntries: () => entries,
      getEntryCount: () => entries.length,
    },
    subscribe(fn: typeof listener) {
      listener = fn;
      return () => {};
    },
    extensionRunner: {
      getRegisteredCommands: () => [
        {
          name: "change",
          invocationName: "change",
          sourceInfo: { path: "extension.ts" },
          async handler() {
            calls++;
            entries.push({
              id: "custom",
              type: "custom",
              customType: "state",
              data: { changed: true },
              timestamp: new Date().toISOString(),
              parentId: null,
            });
            throw new Error("after commit");
          },
        },
      ],
      createCommandContext: () => ({}),
    },
  } as unknown as AgentSession;
  const bus: EventBus = { on: () => () => {}, emit() {} };
  const source = createAdapterSource(session, bus, () => {});
  let notifications = 0;
  source.backend.subscribe(() => {
    notifications++;
  });
  listener({
    type: "tool_execution_start",
    toolCallId: "child",
    toolName: "work",
    parentToolCallId: "parent",
    args: {},
  });
  listener({
    type: "tool_execution_update",
    toolCallId: "child",
    toolName: "work",
    args: {},
    partialResult: { content: [], details: { progress: 1 } },
  });
  expect(source.backend.tools()[0].parentToolCallId).toBe("parent");
  entries.push({
    id: "tool",
    type: "message",
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "toolResult",
      toolCallId: "child",
      toolName: "work",
      content: [],
      details: { done: true },
      isError: false,
      timestamp: Date.now(),
    },
  });
  listener({
    type: "tool_execution_end",
    toolCallId: "child",
    toolName: "work",
    result: { content: [], details: { done: true } },
    isError: false,
  });
  expect(source.backend.tools()[0].parentToolCallId).toBe("parent");
  expect(source.backend.tools()[0].phase).toBe("finished");
  expect(scans).toBe(2);
  entries.pop();
  expect(source.backend.tools()).toEqual([]);
  const before = notifications;
  await expect(
    source.backend.invoke({ name: "change", source: "extension.ts" }),
  ).rejects.toThrow("after commit");
  expect(notifications).toBe(before + 1);
  expect(source.backend.entries("all").at(-1)?.customType).toBe("state");
  await expect(
    source.backend.invoke({ name: "change", source: "wrong.ts" }),
  ).rejects.toThrow("UNAVAILABLE");
  expect(calls).toBe(1);
  source.dispose();
});
