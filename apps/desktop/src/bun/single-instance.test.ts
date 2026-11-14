import { expect, test } from "bun:test";
import { claimInstance, instancePipe } from "./single-instance";

const pipe = () =>
  instancePipe(`test-${process.pid}-${crypto.randomUUID().slice(0, 8)}`);

test("a second claim asks the primary for a window instead of starting", async () => {
  const path = pipe();
  let opened = 0;
  const primary = await claimInstance(path, () => opened++);
  expect(primary).toBeDefined();
  try {
    expect(await claimInstance(path, () => {})).toBeUndefined();
    expect(await claimInstance(path, () => {})).toBeUndefined();
    expect(opened).toBe(2);
  } finally {
    primary?.close();
  }
});

test("the pipe is free again once the primary stops", async () => {
  const path = pipe();
  const first = await claimInstance(path, () => {});
  await new Promise((resolve) => first?.close(resolve));
  const second = await claimInstance(path, () => {});
  expect(second).toBeDefined();
  second?.close();
});
