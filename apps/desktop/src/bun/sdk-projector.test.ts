import { expect, spyOn, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "./sdk";
import { projectEntries, SDKProjector } from "./sdk-projector";

test("saved metadata, custom entries/messages, tool details/images and opaque entry IDs survive", () => {
  const manager = SessionManager.inMemory("fixture");
  const userId = manager.appendMessage({
    role: "user",
    content: "Hello",
    timestamp: 1,
  });
  const customId = manager.appendCustomEntry("unknown", {
    raw: { bytes: [1, 2] },
  });
  const messageId = manager.appendCustomMessageEntry(
    "fixture",
    "Custom",
    true,
    { extra: true },
  );
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "call",
    toolName: "read",
    content: [{ type: "image", data: "fixture", mimeType: "image/png" }],
    details: { width: 2 },
    isError: true,
    timestamp: 2,
  });
  const state = projectEntries(manager);
  expect(state.records.find((r) => r.id === userId)?.entryId).toBe(userId);
  expect(state.records.find((r) => r.id === customId)).toMatchObject({
    kind: "custom-entry",
    customType: "unknown",
    data: { raw: { bytes: [1, 2] } },
    parentId: userId,
  });
  expect(state.records.find((r) => r.id === messageId)).toMatchObject({
    kind: "message",
    message: {
      role: "custom",
      customType: "fixture",
      details: { extra: true },
      display: true,
    },
  });
  expect(state.tools.call).toMatchObject({
    status: "error",
    result: {
      details: { width: 2 },
      content: [{ type: "image", data: "fixture" }],
    },
  });
});
test("live IDs map to committed IDs without duplicate rows; only agent_settled completes", () => {
  const manager = SessionManager.inMemory("fixture"),
    projector = new SDKProjector(manager, 7);
  const message = fauxAssistantMessage("Partial");
  projector.event({ type: "agent_start" });
  projector.event({ type: "message_start", message });
  const live = projector.snapshot().current;
  expect(live).toBe("live:7:1");
  if (!live) throw new Error("Missing live ID");
  projector.event({ type: "message_end", message });
  const id = manager.appendMessage(message);
  projector.event({ type: "agent_end", messages: [message], willRetry: false });
  expect(projector.snapshot().running).toBe(true);
  projector.event({ type: "agent_settled", aborted: false });
  expect(projector.snapshot().running).toBe(false);
  expect(projector.snapshot().records).toHaveLength(1);
  expect(projector.snapshot().liveToEntry[live]).toBe(id);
});

test("message_end-before-persistence reconciles the previous live ID at the next start", () => {
  const manager = SessionManager.inMemory("fixture");
  const existing = {
    role: "user" as const,
    content: "Identical",
    timestamp: 1,
  };
  const old = manager.appendMessage(existing);
  const projector = new SDKProjector(manager, 2);
  projector.event({ type: "message_start", message: existing });
  expect(projector.snapshot().current).toBe("live:2:1");
  projector.event({ type: "message_end", message: existing });
  const next = manager.appendMessage(existing);
  projector.event({
    type: "message_start",
    message: fauxAssistantMessage("Next"),
  });
  expect(projector.snapshot().liveToEntry["live:2:1"]).toBe(next);
  expect(projector.snapshot().liveToEntry["live:2:1"]).not.toBe(old);
});

test("history pages are bounded to recent turns, exhaustive and retain full SDK context", () => {
  const manager = SessionManager.inMemory("fixture");
  for (let i = 0; i < 80; i++) {
    manager.appendMessage({
      role: "user",
      content: `Question ${i}`,
      timestamp: i,
    });
    manager.appendMessage(fauxAssistantMessage(`Answer ${i}`));
  }
  const projector = new SDKProjector(manager, 1);
  let page = projector.snapshot();
  expect(page.records).toHaveLength(50);
  expect(JSON.stringify(page)).not.toContain('Question 0"');
  expect(manager.buildSessionContext().messages).toHaveLength(160);
  const pages = [...page.records];
  while (page.history?.before) {
    page = projector.historyPage(page.history.before, page.history.revision);
    pages.unshift(...page.records);
  }
  expect(pages.map((r) => r.entryId)).toEqual(
    manager.getBranch().map((e) => e.id),
  );
  expect(new Set(pages.map((r) => r.id)).size).toBe(160);
});

test("paging keeps a long response and its tool results together; hidden old tool payloads stay out of the tail", () => {
  const manager = SessionManager.inMemory("fixture");
  const projector = new SDKProjector(manager, 1);
  manager.appendMessage({
    role: "user",
    content: "Long response",
    timestamp: 1,
  });
  const call = fauxAssistantMessage("Read file");
  call.content = [
    { type: "toolCall", id: "old", name: "read", arguments: { path: "file" } },
  ];
  manager.appendMessage(call);
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "old",
    toolName: "read",
    content: [{ type: "text", text: "old payload" }],
    isError: false,
    timestamp: 2,
  });
  for (let i = 0; i < 60; i++) {
    manager.appendMessage(fauxAssistantMessage(`Step ${i}`));
  }
  expect(projector.snapshot().records).toHaveLength(63);
  expect(projector.snapshot().tools.old).toMatchObject({
    result: { content: [{ type: "text", text: "old payload" }] },
  });
  projector.event({
    type: "tool_execution_end",
    toolCallId: "old",
    toolName: "read",
    result: { content: [{ type: "text", text: "old payload" }] },
    isError: false,
  });
  for (let i = 0; i < 30; i++) {
    manager.appendMessage({ role: "user", content: `New ${i}`, timestamp: i });
    manager.appendMessage(fauxAssistantMessage("New answer"));
  }
  expect(projector.snapshot().tools.old).toBeUndefined();
  const recent = projector.snapshot();
  expect(JSON.stringify(recent)).not.toContain("Long response");
  if (!recent.history?.before) throw new Error("Missing history cursor");
  const older = projector.historyPage(
    recent.history.before,
    recent.history.revision,
  );
  expect(older.records[0].entryId).toBe(manager.getBranch()[0].id);
  expect(older.tools.old).toMatchObject({
    result: { content: [{ type: "text", text: "old payload" }] },
  });
});

test("append preserves cursors, but branch changes reject stale pages even in the same epoch", () => {
  const manager = SessionManager.inMemory("fixture");
  const root = manager.appendMessage({
    role: "user",
    content: "Root",
    timestamp: 1,
  });
  manager.appendMessage(fauxAssistantMessage("First branch"));
  const projector = new SDKProjector(manager, 1);
  const before = projector.snapshot();
  manager.appendMessage({ role: "user", content: "Append", timestamp: 2 });
  expect(projector.snapshot().history?.revision).toBe(before.history?.revision);
  manager.branch(root);
  manager.appendMessage(fauxAssistantMessage("Replacement branch"));
  expect(() => projector.historyPage(root, before.history?.revision)).toThrow(
    "STALE_HISTORY_CURSOR",
  );
  expect(() => projector.historyPage("not-on-branch")).toThrow(
    "STALE_HISTORY_CURSOR",
  );
});

test("live updates reuse a saved page without scanning or projecting the branch again", () => {
  const manager = SessionManager.inMemory("fixture");
  for (let i = 0; i < 1000; i++)
    manager.appendMessage({
      role: "user",
      content: `Saved ${i}`,
      timestamp: i,
    });
  const branch = spyOn(manager, "getBranch");
  const entries = spyOn(manager, "getEntries");
  try {
    const projector = new SDKProjector(manager, 1);
    const saved = projector.snapshot();
    const first = saved.records[0];
    const message = fauxAssistantMessage("Live");
    projector.event({ type: "agent_start" });
    projector.event({ type: "message_start", message });
    for (let i = 0; i < 100; i++) {
      projector.event({
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "x",
          partial: message,
        },
      });
      const state = projector.snapshot();
      expect(state.records[0]).toBe(first);
      expect(state.records).toHaveLength(51);
    }
    expect(branch).toHaveBeenCalledTimes(1);
    expect(entries).not.toHaveBeenCalled();
    projector.event({ type: "message_end", message });
    expect(projector.snapshot().current).toBe("live:1:1");
    const id = manager.appendMessage(message);
    const committed = projector.snapshot();
    expect(committed.current).toBeNull();
    expect(committed.liveToEntry["live:1:1"]).toBe(id);
    expect(committed.records).toEqual(
      projectEntries(
        {
          getLeafId: () => manager.getLeafId(),
          getBranch: () => manager.getBranch().slice(-50),
        },
        manager.getBranch().length - 50,
      ).records,
    );
    expect(saved.records).toHaveLength(50);
  } finally {
    branch.mockRestore();
    entries.mockRestore();
  }
});

test("cached history invalidates on rewind/reset and preserves final tool results", () => {
  const manager = SessionManager.inMemory("fixture");
  const root = manager.appendMessage({
    role: "user",
    content: "Root",
    timestamp: 1,
  });
  const projector = new SDKProjector(manager, 1);
  const call = fauxAssistantMessage("Tool");
  call.content = [
    { type: "toolCall", id: "tool", name: "read", arguments: {} },
  ];
  manager.appendMessage(call);
  projector.event({
    type: "tool_execution_update",
    toolCallId: "tool",
    toolName: "read",
    args: {},
    partialResult: {
      content: [{ type: "text", text: "partial" }],
      details: {},
    },
  });
  const partial = projector.snapshot();
  const result = {
    role: "toolResult" as const,
    toolCallId: "tool",
    toolName: "read",
    content: [{ type: "text" as const, text: "final" }],
    isError: false,
    timestamp: 2,
  };
  manager.appendMessage(result);
  projector.event({
    type: "tool_execution_end",
    toolCallId: "tool",
    toolName: "read",
    result: { content: result.content, details: {} },
    isError: false,
  });
  expect(projector.snapshot().tools.tool).toMatchObject({
    result: { content: result.content },
  });
  const revision = partial.history?.revision;
  manager.branch(root);
  const rewound = projector.snapshot();
  expect(rewound.history?.revision).not.toBe(revision);
  expect(rewound.records).toEqual(projectEntries(manager).records);
  expect(rewound.tools).toEqual({});
  manager.resetLeaf();
  expect(projector.snapshot().records).toEqual([]);
  manager.appendCustomEntry("fixture.compacted", { summary: true });
  expect(projector.snapshot().records).toEqual(projectEntries(manager).records);
  manager.branch(root);
  manager.appendCompaction("Fixture summary", root, 1000);
  expect(projector.snapshot().records).toEqual(projectEntries(manager).records);
});
