import { expect, test } from "bun:test";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import { OpenController } from "./open-controller";

const snapshot: Snapshot = {
  address: { hostId: "h", sessionId: "opaque", epoch: 1 },
  snapshotSeq: 1,
  info: { id: "opaque", cwd: "/fake", title: "Fake", modified: 1 },
  effort: "off",
  effortLevels: ["off"],
  transcript: emptyTranscript(),
};
const params = { openId: "client-key", cwd: "/fake" };
test("open timeout performs only openId lookup across transient loss and human startup wait", async () => {
  let opens = 0;
  let lookups = 0;
  const keys: string[] = [];
  const statuses: string[] = [];
  const controller = new OpenController(
    {
      openSession: async () => {
        opens++;
        throw new Error("600000ms timeout");
      },
      getOpenState: async ({ openId }) => {
        keys.push(openId);
        lookups++;
        if (lookups === 1) throw new Error("transport offline");
        if (lookups === 2)
          return { state: "opening", address: snapshot.address };
        return { state: "ready", snapshot };
      },
      cancelOpen: async () => {},
    },
    async () => {},
  );
  expect(
    await controller.open(params, (message) => {
      statuses.push(message);
    }),
  ).toBe(snapshot);
  expect(opens).toBe(1);
  expect(keys).toEqual([params.openId, params.openId, params.openId]);
  expect(statuses.join(" ")).toContain("no second open");
});
test("Cancel before opening address immediately sends cancelOpen and discards late result", async () => {
  let finish: (value: Snapshot) => void = () => {};
  const cancelled: string[] = [];
  const controller = new OpenController({
    openSession: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    getOpenState: async () => ({ state: "unknown" }),
    cancelOpen: async ({ openId }) => {
      cancelled.push(openId);
    },
  });
  const pending = controller.open(params, () => {});
  await controller.cancel(params.openId);
  expect(cancelled).toEqual([params.openId]);
  finish(snapshot);
  expect(await pending).toBeUndefined();
});
test("unknown open state never opens again and reports explicit uncertainty", async () => {
  let calls = 0;
  const controller = new OpenController({
    openSession: async () => {
      calls++;
      throw new Error("lost");
    },
    getOpenState: async () => ({ state: "unknown" }),
    cancelOpen: async () => {},
  });
  await expect(controller.open(params, () => {})).rejects.toThrow(
    "No automatic retry",
  );
  expect(calls).toBe(1);
});
