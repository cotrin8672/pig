import { expect, test } from "bun:test";
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
