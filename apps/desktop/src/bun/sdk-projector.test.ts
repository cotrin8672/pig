import { expect, spyOn, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "./sdk";
import { projectEntries, SDKProjector } from "./sdk-projector";

test("manual and automatic compaction stay visible until compaction_end, not agent_end", () => {
  for (const reason of ["manual", "threshold", "overflow"] as const) {
    const manager = SessionManager.inMemory("fixture");
    const projector = new SDKProjector(manager, 1);
    if (reason !== "manual") projector.event({ type: "agent_start" });
    projector.event({ type: "compaction_start", reason });
    const during = projector.snapshot();
    expect(during.compaction).toEqual({ reason });
    expect(during.running).toBe(reason !== "manual");
    projector.event({ type: "agent_end", messages: [], willRetry: false });
    expect(projector.snapshot().compaction).toEqual({ reason });
    const firstKeptEntryId = manager.appendMessage({
      role: "user",
      content: "Keep going",
      timestamp: 1,
    });
    manager.appendCompaction("The summary", firstKeptEntryId, 42000);
    projector.event({
      type: "compaction_end",
      reason,
      result: { summary: "The summary", firstKeptEntryId, tokensBefore: 42000 },
      aborted: false,
      willRetry: reason === "overflow",
    });
    const after = projector.snapshot();
    expect(after.compaction).toBeUndefined();
    expect(after.records.at(-1)).toMatchObject({
      kind: "session-entry",
      entryType: "compaction",
      data: { summary: "The summary", tokensBefore: 42000 },
    });
    expect(during.compaction).toEqual({ reason });
  }
});

test("cancelled, failed, skipped and settled compactions never leave an active indicator", () => {
  for (const outcome of [
    "aborted",
    "error",
    "skipped",
    "settled",
    "failed",
  ] as const) {
    const projector = new SDKProjector(SessionManager.inMemory("fixture"), 1);
    projector.event({ type: "compaction_start", reason: "manual" });
    if (outcome === "settled")
      projector.event({ type: "agent_settled", aborted: true });
    else if (outcome === "failed") projector.fail(new Error("SDK failed"));
    else
      projector.event({
        type: "compaction_end",
        reason: "manual",
        result: undefined,
        aborted: outcome === "aborted",
        willRetry: false,
        errorMessage: outcome === "error" ? "Compaction failed" : undefined,
      });
    expect(projector.snapshot().compaction).toBeUndefined();
    expect(projector.snapshot().records).toEqual([]);
    if (outcome === "error")
      expect(projector.failure).toBe("Compaction failed");
  }
});

test("live snapshots isolate SDK mutations without copying large string payloads through native clone", () => {
  const manager = SessionManager.inMemory("fixture");
  const projector = new SDKProjector(manager, 1);
  const text = "answer\n".repeat(128 * 1024);
  const message = fauxAssistantMessage(text);
  const arguments_ = { nested: { values: [1] } };
  message.content.push({
    type: "toolCall",
    id: "live-tool",
    name: "read",
    arguments: arguments_,
  });
  const partial = {
    content: [{ type: "text" as const, text }],
    details: { progress: [1] },
  };
  projector.event({ type: "message_start", message });
  projector.event({
    type: "tool_execution_update",
    toolCallId: "live-tool",
    toolName: "read",
    args: arguments_,
    partialResult: partial,
  });
  projector.snapshot();
  const native = spyOn(globalThis, "structuredClone");
  let first: ReturnType<SDKProjector["snapshot"]>;
  try {
    first = projector.snapshot();
    expect(native).not.toHaveBeenCalled();
  } finally {
    native.mockRestore();
  }
  const live = first.records.at(-1);
  if (live?.kind !== "message" || live.message.role !== "assistant")
    throw new Error("Missing live assistant");
  const clonedCall = live.message.content[1];
  if (clonedCall.type !== "toolCall") throw new Error("Missing tool call");
  arguments_.nested.values.push(2);
  partial.content[0].text = "new output";
  partial.details.progress.push(2);
  if (message.content[0].type === "text")
    message.content[0].text += " appended";
  expect(clonedCall.arguments).toEqual({ nested: { values: [1] } });
  expect(live.message.content[0]).toMatchObject({ text });
  expect(first.tools["live-tool"].result).toEqual({
    content: [{ type: "text", text }],
    details: { progress: [1] },
  });
  const next = projector.snapshot();
  expect(next.tools["live-tool"].result).toEqual(partial);
  expect(next.records.at(-1)).not.toBe(live);
});

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

test("completed tool results are owned once; running results remain isolated snapshots", () => {
  const manager = SessionManager.inMemory("fixture");
  const call = fauxAssistantMessage("Tool");
  call.content = [
    { type: "toolCall", id: "tool", name: "read", arguments: {} },
  ];
  manager.appendMessage(call);
  const projector = new SDKProjector(manager, 1);
  const result = {
    content: [{ type: "text" as const, text: "partial" }],
    details: { lines: [1] },
    extra: { extensionMetadata: true },
  };
  projector.event({
    type: "tool_execution_update",
    toolCallId: "tool",
    toolName: "read",
    args: {},
    partialResult: result,
  });
  const partial = projector.snapshot();
  result.content[0].text = "final";
  expect(partial.tools.tool.result).toMatchObject({
    content: [{ text: "partial" }],
  });
  const clone = spyOn(globalThis, "structuredClone");
  try {
    projector.event({
      type: "tool_execution_end",
      toolCallId: "tool",
      toolName: "read",
      result,
      isError: false,
    });
    expect(clone).toHaveBeenCalledTimes(1);
    const completed = projector.snapshot().tools.tool;
    expect(completed.result).toEqual(result);
    expect(completed.result).not.toBe(result);
    for (let i = 0; i < 20; i++)
      expect(projector.snapshot().tools.tool).toBe(completed);
    expect(clone).toHaveBeenCalledTimes(1);
    result.content[0].text = "mutated by extension";
    result.details.lines.push(2);
    expect(projector.snapshot().tools.tool.result).toEqual({
      content: [{ type: "text", text: "final" }],
      details: { lines: [1] },
      extra: { extensionMetadata: true },
    });
    projector.event({
      type: "tool_execution_start",
      toolCallId: "tool",
      toolName: "read",
      args: {},
    });
    expect(projector.snapshot().tools.tool).toEqual({ status: "running" });
    projector.event({
      type: "tool_execution_end",
      toolCallId: "tool",
      toolName: "read",
      result,
      isError: true,
    });
    const replacement = projector.snapshot().tools.tool;
    expect(replacement).not.toBe(completed);
    expect(replacement.status).toBe("error");
    expect(replacement.result).toEqual(result);
    expect(completed.result).toMatchObject({ content: [{ text: "final" }] });
  } finally {
    clone.mockRestore();
  }
});

test("completed copies share matching persisted payloads, never differing extension output", () => {
  const manager = SessionManager.inMemory("fixture");
  const projector = new SDKProjector(manager, 1);
  const content = [{ type: "text" as const, text: "saved output" }];
  const details = { lines: [1] };
  projector.event({
    type: "tool_execution_end",
    toolCallId: "tool",
    toolName: "read",
    result: { content, details, extra: "extension metadata" },
    isError: false,
  });
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "tool",
    toolName: "read",
    content,
    details,
    isError: false,
    timestamp: 0,
  });
  const completed = projector.snapshot().tools.tool;
  expect(completed.result).toEqual({
    content,
    details,
    extra: "extension metadata",
  });
  expect((completed.result as { content: unknown }).content).toBe(content);
  expect((completed.result as { details: unknown }).details).toBe(details);
  manager.appendMessage(fauxAssistantMessage("Next"));
  expect(projector.snapshot().tools.tool).toBe(completed);
  for (const result of [
    { content: [{ type: "text" as const, text: "different" }], details },
    { content, details: { lines: [2] } },
  ]) {
    projector.event({
      type: "tool_execution_end",
      toolCallId: "tool",
      toolName: "read",
      result,
      isError: true,
    });
    manager.appendMessage(fauxAssistantMessage("Append"));
    const next = projector.snapshot().tools.tool;
    expect(next.status).toBe("error");
    expect(next.result).toEqual(result);
    expect(next).not.toBe(completed);
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
