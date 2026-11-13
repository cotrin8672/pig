import { expect, test } from "bun:test";
import { runUsageCommand } from "./cli";
import { UsageError } from "./contracts";

test("aborting CLI monitoring reaps the process rather than waiting for its timeout", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const work = runUsageCommand(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    controller.signal,
  );
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await expect(work).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5000);
  } finally {
    clearTimeout(timer);
  }
});
test("oversized CLI output is stopped and never retained as a provider error body", async () => {
  const work = runUsageCommand(
    process.execPath,
    ["-e", 'process.stdout.write("x".repeat(300000));setInterval(()=>{},1000)'],
    new AbortController().signal,
  );
  await expect(work).rejects.toThrow(UsageError);
});
