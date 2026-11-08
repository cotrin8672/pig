import { expect, mock, test } from "bun:test";
import { awaitPromptAcceptance } from "./prompt-acceptance";

test.each([
  "started",
  "queued",
  "handled",
] as const)("acknowledges %s before the run finishes", async (disposition) => {
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const report = mock();
  const result = await awaitPromptAcceptance(async (accept) => {
    accept(disposition);
    await completion;
  }, report);
  expect(result).toEqual({ disposition });
  expect(report).not.toHaveBeenCalled();
  finish();
  await completion;
});

test("rejects before acceptance, including a cancelled queued start", async () => {
  const report = mock();
  await expect(
    awaitPromptAcceptance(async () => {
      throw new Error("No credentials");
    }, report),
  ).rejects.toThrow("No credentials");
  await expect(awaitPromptAcceptance(async () => {}, report)).rejects.toThrow(
    "cancelled before acceptance",
  );
  expect(report).not.toHaveBeenCalled();
});

test("reports execution errors after acceptance without rejecting the accepted input", async () => {
  const error = new Error("stream failed");
  const report = mock();
  const result = await awaitPromptAcceptance(async (accept) => {
    accept("started");
    throw error;
  }, report);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(result.disposition).toBe("started");
  expect(report).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith(error);
});
