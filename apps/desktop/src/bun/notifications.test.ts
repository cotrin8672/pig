import { expect, test } from "bun:test";
import type { WireEvent } from "../shared/rpc-schema";
import { createCompletionTracker } from "./notifications";

function message(stopReason: "stop" | "error" | "aborted"): WireEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test",
      stopReason,
      timestamp: 1,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  };
}
const settled: WireEvent = { type: "agent_settled", aborted: false };

test("completion waits for settlement, emits once, and supports another run", () => {
  const track = createCompletionTracker();
  expect(track(settled)).toBeUndefined();
  track({ type: "agent_start" });
  expect(track(message("stop"))).toBeUndefined();
  expect(
    track({ type: "agent_end", messages: [], willRetry: false }),
  ).toBeUndefined();
  expect(track(settled)).toBe("success");
  expect(track(settled)).toBeUndefined();
  track({ type: "agent_start" });
  expect(track(settled)).toBe("success");
});

test("retry errors are replaced by the final result; permanent failure is not success", () => {
  const track = createCompletionTracker();
  track({ type: "agent_start" });
  track(message("error"));
  expect(
    track({ type: "agent_end", messages: [], willRetry: true }),
  ).toBeUndefined();
  track(message("stop"));
  expect(track(settled)).toBe("success");
  track({ type: "agent_start" });
  track(message("error"));
  expect(track(settled)).toBe("error");
});

test("aborted and unstarted runs do not notify; sessions are independent", () => {
  const first = createCompletionTracker();
  const second = createCompletionTracker();
  first({ type: "agent_start" });
  second({ type: "agent_start" });
  expect(first({ type: "agent_settled", aborted: true })).toBeUndefined();
  expect(first(settled)).toBeUndefined();
  expect(second(settled)).toBe("success");
  first({ type: "agent_start" });
  first(message("aborted"));
  expect(first(settled)).toBeUndefined();
});
