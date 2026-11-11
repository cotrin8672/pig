import { expect, test } from "bun:test";
import { flushDraftsBeforeClose } from "./draft-close";

test("normal close waits for the draft ACK", async () => {
  const ack = Promise.withResolvers<void>();
  let finished = false;
  const close = flushDraftsBeforeClose(
    () => ack.promise,
    async () => {
      throw new Error("No failure expected");
    },
  ).then((result) => {
    finished = result;
  });
  await Bun.sleep(0);
  expect(finished).toBe(false);
  ack.resolve();
  await close;
  expect(finished).toBe(true);
});
test("failed saves can cancel, explicitly close unsaved, or retry and wait for the next ACK", async () => {
  const fail = async () => {
    throw new Error("disk full");
  };
  expect(await flushDraftsBeforeClose(fail, async () => "cancel")).toBe(false);
  expect(await flushDraftsBeforeClose(fail, async () => "discard")).toBe(true);
  let calls = 0,
    choices = 0;
  expect(
    await flushDraftsBeforeClose(
      async () => {
        if (++calls === 1) throw new Error("temporary");
      },
      async () => {
        choices++;
        return "retry";
      },
    ),
  ).toBe(true);
  expect({ calls, choices }).toEqual({ calls: 2, choices: 1 });
});
test("a hung renderer also offers an explicit exit without claiming it saved", async () => {
  let choice = 0;
  expect(
    await flushDraftsBeforeClose(
      () => new Promise(() => {}),
      async (error) => {
        expect(String(error)).toContain("timed out");
        choice++;
        return "discard";
      },
      5,
    ),
  ).toBe(true);
  expect(choice).toBe(1);
});
