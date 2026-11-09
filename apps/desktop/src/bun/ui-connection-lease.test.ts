import { expect, test } from "bun:test";
import { UIConnectionLease } from "./ui-connection-lease";
import { UIRequestBroker } from "./ui-request-broker";

test("Root lease heartbeats extend liveness; expired/foreign clients cannot revive UI", async () => {
  let now = 0,
    lost = 0;
  const broker = new UIRequestBroker(() => {});
  const lease = new UIConnectionLease(
    () => {
      lost++;
      broker.setAvailable(false);
    },
    100,
    () => now,
  );
  const address = { hostId: "host", sessionId: "opaque", epoch: 1 };
  lease.connect("root");
  broker.setAvailable(true);
  const pending = broker.request({
    ...address,
    uiId: "native",
    kind: "confirm",
    title: "Permission",
    message: "Allow?",
  });
  const editor = broker.request({
    ...address,
    uiId: "editor",
    kind: "editor",
    title: "Edit",
  });
  now = 90;
  expect(lease.heartbeat("root")).toBe(true);
  now = 110;
  lease.expire();
  expect(lost).toBe(0);
  expect(lease.heartbeat("foreign")).toBe(false);
  now = 190;
  lease.expire();
  expect(lost).toBe(1);
  expect((await editor).kind).toBe("cancel");
  expect((await pending).kind).toBe("cancel");
  expect(broker.pending()).toEqual([]);
  expect(broker.isAvailable()).toBe(false);
  expect(lease.heartbeat("root")).toBe(false);
  lease.connect("new-root");
  broker.setAvailable(true);
  expect(lease.heartbeat("new-root")).toBe(true);
  lease.disconnect("root");
  expect(broker.isAvailable()).toBe(true);
  lease.disconnect("new-root");
  expect(broker.isAvailable()).toBe(false);
});

test("one lost view does not cancel another live Root; timer is bounded and released", () => {
  let now = 0,
    lost = 0;
  const lease = new UIConnectionLease(
    () => {
      lost++;
    },
    100,
    () => now,
  );
  lease.connect("a");
  now = 50;
  lease.connect("b");
  now = 100;
  lease.expire();
  expect(lost).toBe(0);
  expect(lease.heartbeat("a")).toBe(false);
  expect(lease.heartbeat("b")).toBe(true);
  lease.clear();
  expect(lost).toBe(1);
  expect(lease.heartbeat("b")).toBe(false);
});
