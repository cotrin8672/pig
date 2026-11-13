import { expect, test } from "bun:test";
import type { Snapshot } from "../shared/rpc-schema";
import { emptyTranscript } from "../shared/transcript";
import { createSnapshotRecovery } from "./snapshot-recovery";

const address = { hostId: "snapshot-recovery", sessionId: "chat", epoch: 1 };
const snapshot = (snapshotSeq: number): Snapshot => ({
  address,
  snapshotSeq,
  info: { id: "chat", cwd: "fixture", title: "Chat", modified: 0 },
  effort: "off",
  effortLevels: [],
  transcript: emptyTranscript(),
});
test("missing delta bases share one full read and follow the newest seen sequence without replaying sends", async () => {
  const reads: ReturnType<typeof Promise.withResolvers<Snapshot>>[] = [];
  const applied: number[] = [];
  const recover = createSnapshotRecovery(
    async () => {
      const read = Promise.withResolvers<Snapshot>();
      reads.push(read);
      return read.promise;
    },
    () => true,
  );
  const apply = (value: Snapshot) => applied.push(value.snapshotSeq);
  const first = recover(address, 2, apply);
  await Bun.sleep(0);
  expect(recover(address, 3, apply)).toBe(first);
  reads[0].resolve(snapshot(2));
  await Bun.sleep(0);
  expect(reads).toHaveLength(2);
  reads[1].resolve(snapshot(4));
  await first;
  expect(applied).toEqual([2, 4]);
});
test("late replies cannot resurrect closed owners and stalled/foreign recovery fails boundedly", async () => {
  const read = Promise.withResolvers<Snapshot>();
  let live = true,
    applied = 0;
  const recover = createSnapshotRecovery(
    () => read.promise,
    () => live,
  );
  const pending = recover(address, 2, () => applied++);
  await Bun.sleep(0);
  live = false;
  read.resolve(snapshot(2));
  await pending;
  expect(applied).toBe(0);
  const stalled = createSnapshotRecovery(
    async () => snapshot(1),
    () => true,
  );
  await expect(stalled(address, 5, () => {})).rejects.toThrow(
    "did not advance",
  );
  const foreign = createSnapshotRecovery(
    async () => ({ ...snapshot(10), address: { ...address, epoch: 2 } }),
    () => true,
  );
  await expect(foreign(address, 5, () => {})).rejects.toThrow("another owner");
});
