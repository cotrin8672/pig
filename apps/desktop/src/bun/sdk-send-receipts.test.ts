import { expect, test } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PromptParams } from "../shared/runtime-contract";
import { SendReceipts } from "./sdk-send-receipts";

const base: PromptParams = {
  hostId: "host",
  sessionId: "opaque",
  epoch: 1,
  requestId: "one",
  draftRevision: 0,
  text: "hello",
};
const prepare = async () => ({ text: "hello" });

test("pending registered before prepare, same-ID dedupe and conflict, terminal receipt retained", async () => {
  const ledger = new SendReceipts("host"),
    gate = Promise.withResolvers<void>();
  let calls = 0;
  const session: Pick<AgentSession, "prompt"> = {
    prompt: async (_text, options) => {
      calls++;
      await gate.promise;
      options?.preflightResult?.("handled");
    },
  };
  const first = ledger.send(base, session, prepare, () => {});
  expect(ledger.lookup(base).state).toBe("pending");
  expect(ledger.send({ ...base }, session, prepare, () => {})).toBe(first);
  await expect(
    ledger.send({ ...base, text: "changed" }, session, prepare, () => {}),
  ).rejects.toThrow("REQUEST_ID_CONFLICT");
  await Bun.sleep(0);
  expect(calls).toBe(1);
  gate.resolve();
  expect(await first).toEqual({ disposition: "handled" });
  await ledger.settled();
  expect(ledger.lookup(base).state).toBe("accepted");
});
test("different IDs serialize async preflight only, not model completion", async () => {
  const ledger = new SendReceipts("host"),
    auth = Promise.withResolvers<void>(),
    model = Promise.withResolvers<void>();
  let calls = 0;
  const session: Pick<AgentSession, "prompt"> = {
    prompt: async (_text, options) => {
      calls++;
      if (calls === 1) {
        await auth.promise;
        options?.preflightResult?.("started");
        await model.promise;
      } else options?.preflightResult?.("queued");
    },
  };
  const first = ledger.send(base, session, prepare, () => {}),
    second = ledger.send(
      { ...base, requestId: "two" },
      session,
      prepare,
      () => {},
    );
  await Bun.sleep(0);
  expect(calls).toBe(1);
  auth.resolve();
  expect(await first).toEqual({ disposition: "started" });
  expect(await second).toEqual({ disposition: "queued" });
  expect(calls).toBe(2);
  model.resolve();
  await ledger.settled();
});
test("preaccept failure rejects; accepted model errors project separately; unknown is read-only", async () => {
  const ledger = new SendReceipts("host"),
    errors: unknown[] = [];
  await expect(
    ledger.send(
      base,
      {
        prompt: async () => {
          throw new Error("auth failed");
        },
      },
      prepare,
      (e) => errors.push(e),
    ),
  ).rejects.toThrow("auth failed");
  expect(ledger.lookup(base)).toMatchObject({
    state: "rejected",
    code: "PREFLIGHT_FAILED",
  });
  const next = { ...base, requestId: "accepted-error" };
  await ledger.send(
    next,
    {
      prompt: async (_t, opts) => {
        opts?.preflightResult?.("started");
        throw new Error("model failed");
      },
    },
    prepare,
    (e) => errors.push(e),
  );
  await ledger.settled();
  expect(errors).toHaveLength(1);
  expect(ledger.lookup(next).state).toBe("accepted");
  expect(ledger.lookup({ ...base, requestId: "missing" })).toMatchObject({
    state: "unknown",
    reason: "not-found",
  });
  expect(ledger.lookup({ ...base, hostId: "old" })).toMatchObject({
    state: "unknown",
    reason: "host-restarted",
  });
});
test("stop cancels pending preparation and blocks late invocation", async () => {
  const ledger = new SendReceipts("host"),
    gate = Promise.withResolvers<void>();
  let calls = 0;
  const pending = ledger.send(
    base,
    {
      prompt: async () => {
        calls++;
      },
    },
    async () => {
      await gate.promise;
      return prepare();
    },
    () => {},
  );
  await Bun.sleep(0);
  ledger.cancel(base);
  expect(ledger.lookup(base).state).toBe("rejected");
  gate.resolve();
  await expect(pending).rejects.toThrow("cancelled");
  await ledger.settled();
  expect(calls).toBe(0);
});

test("payload identity uses ordered image bytes and lookup cannot mutate the ledger", async () => {
  const ledger = new SendReceipts("host");
  const image = {
    type: "image" as const,
    mimeType: "image/png",
    data: "aGVsbG8=",
  };
  const params = { ...base, images: [image] };
  const session: Pick<AgentSession, "prompt"> = {
    prompt: async (_text, options) => {
      options?.preflightResult?.("handled");
    },
  };
  const first = ledger.send(params, session, prepare, () => {});
  expect(
    ledger.send(
      { ...params, images: [{ ...image, data: "aGVs\nbG8=" }] },
      session,
      prepare,
      () => {},
    ),
  ).toBe(first);
  await first;
  const receipt = ledger.lookup(params);
  if (receipt.state !== "accepted") throw new Error("Missing acceptance");
  receipt.accepted.disposition = "queued";
  expect(ledger.lookup(params)).toMatchObject({
    state: "accepted",
    accepted: { disposition: "handled" },
  });
});
