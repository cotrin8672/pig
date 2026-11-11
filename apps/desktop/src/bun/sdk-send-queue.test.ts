import { expect, test } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PromptParams } from "../shared/runtime-contract";
import { SendReceipts } from "./sdk-send-receipts";

const base: PromptParams = {
  hostId: "h",
  sessionId: "s",
  epoch: 1,
  requestId: "queue",
  text: "later",
  draftRevision: 1,
  delivery: "followUp",
};
const prepare = async () => ({ text: "later" });

test("follow-ups wait outside admission: steering overtakes them, deletion cancels without stopping the run", async () => {
  const ledger = new SendReceipts("h");
  const idle = Promise.withResolvers<void>();
  const calls: string[] = [];
  let streaming = true;
  const session: Pick<AgentSession, "prompt" | "isStreaming" | "waitForIdle"> =
    {
      get isStreaming() {
        return streaming;
      },
      waitForIdle: () => (streaming ? idle.promise : Promise.resolve()),
      prompt: async (text, options) => {
        calls.push(text);
        options?.preflightResult?.(streaming ? "queued" : "started");
      },
    };
  const first = ledger.send(base, session, prepare, () => {});
  const secondKey = { ...base, requestId: "second" };
  const second = ledger.send(secondKey, session, prepare, () => {});
  await Bun.sleep(0);
  expect(calls).toEqual([]);
  expect(ledger.lookup(base)).toMatchObject({
    state: "pending",
    stage: "queued",
  });
  await ledger.send(
    { ...base, requestId: "steer", delivery: "steer" },
    session,
    async () => ({ text: "change direction" }),
    () => {},
  );
  expect(calls).toEqual(["change direction"]);
  expect(ledger.withdraw(base)).toMatchObject({
    state: "rejected",
    code: "CANCELLED",
  });
  await expect(first).rejects.toThrow("cancelled");
  streaming = false;
  idle.resolve();
  await second;
  await ledger.settled();
  expect(calls).toEqual(["change direction", "later"]);
});

test("each follow-up waits for the previous complete response, not merely its acceptance", async () => {
  const ledger = new SendReceipts("h");
  const gate = Promise.withResolvers<void>();
  const calls: string[] = [];
  const session: Pick<AgentSession, "prompt" | "waitForIdle"> = {
    waitForIdle: async () => {},
    prompt: async (text, options) => {
      calls.push(text);
      options?.preflightResult?.("started");
      if (calls.length === 1) await gate.promise;
    },
  };
  const first = ledger.send(base, session, prepare, () => {});
  const second = ledger.send(
    { ...base, requestId: "two" },
    session,
    async () => ({ text: "second" }),
    () => {},
  );
  await first;
  expect(calls).toEqual(["later"]);
  gate.resolve();
  await second;
  await ledger.settled();
  expect(calls).toEqual(["later", "second"]);
});

test("Stop releases queued waits even if the session never becomes idle", async () => {
  const ledger = new SendReceipts("h");
  let calls = 0;
  const pending = ledger.send(
    base,
    {
      waitForIdle: () => new Promise(() => {}),
      prompt: async () => {
        calls++;
      },
    },
    prepare,
    () => {},
  );
  await Bun.sleep(0);
  ledger.cancel(base);
  await expect(pending).rejects.toThrow("cancelled");
  await ledger.settled();
  expect(calls).toBe(0);
});

test("delivery is immutable across draft reservation and prompt, and defaults to steering", async () => {
  const ledger = new SendReceipts("h");
  ledger.register(base, {
    owner: { cwd: "/p", sessionFile: null, branchId: null },
    content: { text: "later", pastes: [], images: [] },
  });
  expect(ledger.intents()[0]).toMatchObject({
    delivery: "followUp",
    timestamp: expect.any(Number),
  });
  await expect(
    ledger.send(
      { ...base, delivery: "steer" },
      { prompt: async () => {} },
      prepare,
      () => {},
    ),
  ).rejects.toThrow("REQUEST_ID_CONFLICT");
  let mode: string | undefined;
  await ledger.send(
    { ...base, requestId: "normal", delivery: undefined },
    {
      prompt: async (_, options) => {
        mode = options?.streamingBehavior;
        options?.preflightResult?.("queued");
      },
    },
    prepare,
    () => {},
  );
  expect(mode).toBe("steer");
  expect(() =>
    ledger.register({
      ...base,
      requestId: "invalid",
      delivery: "bad" as "steer",
    }),
  ).toThrow("Invalid prompt payload");
});

test("cancelling an admission slot cannot let a later send bypass ongoing preflight", async () => {
  const ledger = new SendReceipts("h");
  const gate = Promise.withResolvers<void>();
  const calls: string[] = [];
  const session: Pick<AgentSession, "prompt"> = {
    prompt: async (text, options) => {
      calls.push(text);
      if (text === "first") await gate.promise;
      options?.preflightResult?.("queued");
    },
  };
  const send = (requestId: string) =>
    ledger.send(
      { ...base, requestId, delivery: "steer" },
      session,
      async () => ({ text: requestId }),
      () => {},
    );
  const first = send("first");
  const cancelled = send("cancelled");
  const third = send("third");
  await Bun.sleep(0);
  ledger.withdraw({ ...base, requestId: "cancelled" });
  await expect(cancelled).rejects.toThrow("cancelled");
  await Bun.sleep(0);
  expect(calls).toEqual(["first"]);
  gate.resolve();
  await Promise.all([first, third]);
  expect(calls).toEqual(["first", "third"]);
});

test("withdrawal cannot claim success once SDK preflight starts", async () => {
  const ledger = new SendReceipts("h");
  const gate = Promise.withResolvers<void>();
  const pending = ledger.send(
    base,
    {
      prompt: async (_, options) => {
        await gate.promise;
        options?.preflightResult?.("started");
      },
    },
    prepare,
    () => {},
  );
  await Bun.sleep(0);
  expect(ledger.withdraw(base)).toMatchObject({
    state: "pending",
    stage: "dispatched",
  });
  gate.resolve();
  expect(await pending).toEqual({ disposition: "started" });
});
