import { expect, test } from "bun:test";
import type { WireEvent } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import { createCompletionTracker } from "./notifications";

const event = (running: boolean, rest: Partial<WireEvent> = {}): WireEvent => ({
  type: "snapshot",
  address: { hostId: "fixture", sessionId: "opaque", epoch: 1 },
  snapshotSeq: 1,
  transcript: { ...emptyTranscript(), running },
  ...rest,
});
test("SDK completion is emitted once after agent_settled projection", () => {
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
