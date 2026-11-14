import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { hydrate, type Message } from "../shared/transcript";
import { interruptedSession } from "./session-status";

const error = fauxAssistantMessage("", {
  stopReason: "error",
  errorMessage: "WebSocket closed 1000",
});
const aborted = fauxAssistantMessage("Partial work", { stopReason: "aborted" });
const success = fauxAssistantMessage("Done");
const user: Message = { role: "user", content: "Next task", timestamp: 1 };
const snapshot = (...messages: Message[]) => ({
  transcript: hydrate(messages),
});

test("legacy message failures and manual stops remain resumable without diagnostics", () => {
  expect(interruptedSession(snapshot(user, error))).toBe("failed");
  expect(interruptedSession(snapshot(user, aborted))).toBe("stopped");
  expect(interruptedSession({ ...snapshot(error), aborted: true })).toBe(
    "failed",
  );
  expect(interruptedSession({ ...snapshot(), aborted: true })).toBe("stopped");
  expect(
    interruptedSession({ ...snapshot(), failure: "Preflight failed" }),
  ).toBe("failed");
  expect(interruptedSession(snapshot())).toBeUndefined();
});

test("only the current turn controls interruption; new execution clears stale history", () => {
  expect(interruptedSession(snapshot(error, success))).toBeUndefined();
  expect(interruptedSession(snapshot(error, user))).toBeUndefined();
  const running = snapshot(error);
  running.transcript.running = true;
  expect(interruptedSession(running)).toBeUndefined();
  expect(
    interruptedSession({ ...running, failure: "Current run failed" }),
  ).toBe("failed");
});

test("tool and metadata records do not conceal the interrupted assistant", () => {
  const state = snapshot(error, {
    role: "toolResult",
    toolCallId: "call",
    toolName: "read",
    content: [{ type: "text", text: "tool output" }],
    isError: false,
    timestamp: 2,
  });
  state.transcript.records.push({
    id: "metadata",
    parentId: null,
    branchId: "root",
    order: 2,
    kind: "custom-entry",
    customType: "fixture",
    data: {},
  });
  expect(interruptedSession(state)).toBe("failed");
  expect(
    interruptedSession(
      snapshot(success, {
        role: "toolResult",
        toolCallId: "call",
        toolName: "read",
        content: [],
        isError: true,
        timestamp: 3,
      }),
    ),
  ).toBeUndefined();
});
