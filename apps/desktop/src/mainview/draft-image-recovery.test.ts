import { expect, test } from "bun:test";
import type { DraftState } from "../shared/runtime-contract";
import { createDraftImageRecovery } from "./draft-image-recovery";

const address = { hostId: "recovery", sessionId: "draft", epoch: 1 };
const draft = (revision: number): DraftState => ({
  text: String(revision),
  pastes: [],
  images: [],
  revision,
});

test("concurrent compact-draft misses share a lookup and a newer target triggers one follow-up read", async () => {
  const reads: ReturnType<typeof Promise.withResolvers<DraftState>>[] = [];
  const applied: number[] = [];
  const recover = createDraftImageRecovery(
    async () => {
      const read = Promise.withResolvers<DraftState>();
      reads.push(read);
      return read.promise;
    },
    (_address, value) => applied.push(value.revision),
    () => true,
  );
  const first = recover(address, 2);
  await Promise.resolve();
  const late = recover(address, 3);
  expect(late).toBe(first);
  reads[0].resolve(draft(2));
  await Bun.sleep(0);
  expect(reads).toHaveLength(2);
  reads[1].resolve(draft(3));
  await first;
  expect(applied).toEqual([2, 3]);
  const again = recover(address, 4);
  await Promise.resolve();
  reads[2].resolve(draft(4));
  await again;
  expect(applied).toEqual([2, 3, 4]);
});

test("late reads for a closed/replaced address are discarded", async () => {
  const read = Promise.withResolvers<DraftState>();
  let current = true,
    applied = 0;
  const recover = createDraftImageRecovery(
    () => read.promise,
    () => {
      applied++;
    },
    () => current,
  );
  const pending = recover(address, 2);
  await Promise.resolve();
  current = false;
  read.resolve(draft(2));
  await pending;
  expect(applied).toBe(0);
});

test("stalled recovery is bounded and failed reads allow retry", async () => {
  let calls = 0;
  const recover = createDraftImageRecovery(
    async () => {
      calls++;
      return draft(1);
    },
    () => {},
    () => true,
  );
  await expect(recover(address, 3)).rejects.toThrow("did not advance");
  expect(calls).toBe(2);
  await recover(address, 1);
  expect(calls).toBe(3);
});
