import { expect, test } from "bun:test";
import type { WireEvent } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import { createCompletionTracker } from "./notifications";

const event = (running: boolean, rest: Partial<WireEvent> = {}): WireEvent => ({
  type: "snapshot",
  transcript: { ...emptyTranscript(), running },
  ...rest,
});
test("Durable completion is emitted once after run settlement", () => {
  const track = createCompletionTracker();
  expect(track(event(false))).toBeUndefined();
  expect(track(event(true))).toBeUndefined();
  expect(track(event(true))).toBeUndefined();
  expect(track(event(false))).toBe("success");
  expect(track(event(false))).toBeUndefined();
  track(event(true));
  expect(track(event(false, { failure: "failed" }))).toBe("error");
});
test("abort never reports success; independent conversations stay independent", () => {
  const first = createCompletionTracker();
  const second = createCompletionTracker();
  first(event(true));
  second(event(true));
  expect(first(event(false, { aborted: true }))).toBeUndefined();
  expect(first(event(false))).toBeUndefined();
  expect(second(event(false))).toBe("success");
});
