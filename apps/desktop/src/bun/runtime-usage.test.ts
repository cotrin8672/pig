import { expect, test } from "bun:test";
import { UI_CONNECTION_LEASE_MS } from "../shared/runtime-contract";
import { RuntimeUsageTracker } from "./runtime-usage";

const address = { hostId: "host", sessionId: "chat", epoch: 1 };
test("all Roots/Panes protect a chat, including stale epochs; expiry is unknown, not unused", () => {
  let now = 0;
  const tracker = new RuntimeUsageTracker(() => now);
  expect(tracker.protects(address)).toBe(true);
  tracker.connect("one");
  expect(tracker.protects(address)).toBe(true);
  tracker.update("one", { sequence: 1, protected: [] });
  expect(tracker.protects(address)).toBe(false);
  tracker.connect("two");
  expect(tracker.protects(address)).toBe(true);
  tracker.update("two", { sequence: 3, protected: [address] });
  expect(tracker.protects({ ...address, epoch: 2 })).toBe(true);
  tracker.update("two", { sequence: 2, protected: [] });
  expect(tracker.protects(address)).toBe(true);
  tracker.update("two", { sequence: 4, protected: [] });
  expect(tracker.protects(address)).toBe(false);
  now += UI_CONNECTION_LEASE_MS;
  expect(tracker.protects(address)).toBe(true);
  tracker.update("one", { sequence: 1, protected: [] });
  tracker.update("two", { sequence: 4, protected: [] });
  expect(tracker.protects(address)).toBe(false);
  tracker.connect("two");
  tracker.update("two", { sequence: 3, protected: [] });
  expect(tracker.protects(address)).toBe(true);
  tracker.disconnect("two");
  expect(tracker.protects(address)).toBe(false);
  tracker.disconnect("one");
  expect(tracker.protects(address)).toBe(false);
});

test("malformed reports cannot release protection", () => {
  const tracker = new RuntimeUsageTracker();
  tracker.connect("root");
  expect(() =>
    tracker.update("root", {
      sequence: -1,
      protected: [],
    }),
  ).toThrow();
  expect(tracker.protects(address)).toBe(true);
});
