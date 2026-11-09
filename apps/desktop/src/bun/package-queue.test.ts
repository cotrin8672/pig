import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { withPackageLock } from "./package-queue";

test("profile queue is FIFO, survives rejections and shares normalized profile keys", async () => {
  const events: string[] = [];
  const profile = resolve("isolated-package-queue-profile");
  const first = withPackageLock(profile, async () => {
    events.push("first");
    throw new Error("failed");
  });
  const rejected = expect(first).rejects.toThrow("failed");
  const second = withPackageLock(
    `${profile}/../isolated-package-queue-profile`,
    async () => {
      events.push("second");
      return 42;
    },
  );
  await rejected;
  expect(await second).toBe(42);
  expect(events).toEqual(["first", "second"]);
});

test("waiting on one profile does not lock a different profile", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withPackageLock("isolated-profile-a", () => barrier);
  expect(
    await withPackageLock("isolated-profile-b", async () => "unblocked"),
  ).toBe("unblocked");
  release();
  await first;
});
