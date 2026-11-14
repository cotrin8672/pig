import { expect, test } from "bun:test";
import { createRenderWorkerQueue } from "./render-worker-queue";

class FakeWorker extends EventTarget {
  sent: { id: number; input: string }[] = [];
  stopped = false;
  postMessage(value: unknown) {
    this.sent.push(value as { id: number; input: string });
  }
  terminate() {
    this.stopped = true;
  }
  reply(id: number, result: string) {
    this.dispatchEvent(new MessageEvent("message", { data: { id, result } }));
  }
}
const tick = () => Bun.sleep(0);

class CloningWorker extends EventTarget {
  sent: { id: number; input: { text: string } }[] = [];
  postMessage(value: unknown) {
    // Native postMessage owns an independent structured clone, not the input.
    this.sent.push(structuredClone(value) as (typeof this.sent)[number]);
  }
  terminate() {}
  reply(id: number) {
    this.dispatchEvent(
      new MessageEvent("message", { data: { id, result: "done" } }),
    );
  }
}
async function collected(reference: WeakRef<object>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await tick(); // End WeakRef's keep-alive job before the forced collection.
    Bun.gc(true);
    if (!reference.deref()) return true;
  }
  return false;
}

test("posted input is released while the worker still computes, without changing its cloned payload", async () => {
  const worker = new CloningWorker();
  const queue = createRenderWorkerQueue<{ text: string }, string>(
    async () => worker,
  );
  const { reference, result } = (() => {
    const input = { text: "Complete source 日本語\n".repeat(64 * 1024) };
    return { reference: new WeakRef(input), result: queue.run(input) };
  })();
  await tick();
  expect(worker.sent[0].input.text).toBe(
    "Complete source 日本語\n".repeat(64 * 1024),
  );
  expect(await collected(reference)).toBe(true);
  expect(queue.stats().running).toBe(true);
  worker.reply(worker.sent[0].id);
  expect(await result).toBe("done");
});

test("cancelled input is released even while worker startup is unresolved", async () => {
  const worker = new CloningWorker();
  const startup = Promise.withResolvers<CloningWorker>();
  const queue = createRenderWorkerQueue<{ text: string }, string>(
    () => startup.promise,
  );
  const controller = new AbortController();
  const { reference, result } = (() => {
    const input = { text: "Cancelled source".repeat(64 * 1024) };
    return {
      reference: new WeakRef(input),
      result: queue.run(input, controller.signal),
    };
  })();
  controller.abort();
  expect(await result).toBeUndefined();
  expect(await collected(reference)).toBe(true);
  const next = queue.run({ text: "next" });
  startup.resolve(worker);
  await tick();
  expect(worker.sent.map((item) => item.input.text)).toEqual(["next"]);
  worker.reply(worker.sent[0].id);
  expect(await next).toBe("done");
});
test("render workers run one task at a time and discard cancelled queued work", async () => {
  const worker = new FakeWorker();
  const queue = createRenderWorkerQueue<string, string>(async () => worker);
  const first = queue.run("first");
  const cancelled = new AbortController();
  const old = queue.run("old", cancelled.signal);
  cancelled.abort();
  const latest = queue.run("latest");
  await tick();
  expect(worker.sent.map((value) => value.input)).toEqual(["first"]);
  worker.reply(worker.sent[0].id, "FIRST");
  expect(await first).toBe("FIRST");
  expect(await old).toBeUndefined();
  await tick();
  expect(worker.sent.map((value) => value.input)).toEqual(["first", "latest"]);
  worker.reply(worker.sent[1].id, "LATEST");
  expect(await latest).toBe("LATEST");
  expect(queue.stats()).toMatchObject({
    pending: 0,
    posted: 2,
    completed: 2,
    cancelled: 1,
    failed: false,
  });
});
test("cancelled in-flight results never release or resolve a different request", async () => {
  const worker = new FakeWorker();
  const queue = createRenderWorkerQueue<string, string>(async () => worker);
  const controller = new AbortController();
  const old = queue.run("old", controller.signal);
  await tick();
  controller.abort();
  const next = queue.run("next");
  expect(await old).toBeUndefined();
  worker.reply(999, "foreign");
  expect(worker.sent).toHaveLength(1);
  worker.reply(worker.sent[0].id, "stale");
  await tick();
  expect(worker.sent).toHaveLength(2);
  worker.reply(worker.sent[1].id, "correct");
  expect(await next).toBe("correct");
});
test("synchronous worker startup failures still return a rejected promise", async () => {
  const queue = createRenderWorkerQueue<string, string>(() => {
    throw new Error("startup failed");
  });
  let result: Promise<string | undefined> | undefined;
  expect(() => {
    result = queue.run("source");
  }).not.toThrow();
  await expect(result).rejects.toThrow("startup failed");
  expect(queue.stats()).toMatchObject({
    pending: 0,
    running: false,
    failed: true,
  });
});

test("postMessage clone failures reject queued work and stop the failed worker", async () => {
  const worker = new FakeWorker();
  worker.postMessage = () => {
    throw new Error("cannot clone payload");
  };
  const queue = createRenderWorkerQueue<string, string>(async () => worker);
  const first = queue.run("first").catch((error) => error.message);
  const second = queue.run("second").catch((error) => error.message);
  expect(await Promise.all([first, second])).toEqual([
    "cannot clone payload",
    "cannot clone payload",
  ]);
  await tick();
  expect(worker.stopped).toBe(true);
  expect(queue.stats()).toMatchObject({
    pending: 0,
    running: false,
    failed: true,
  });
});

test("worker failure releases every waiter and stops the failed worker", async () => {
  const worker = new FakeWorker();
  const queue = createRenderWorkerQueue<string, string>(async () => worker);
  const first = queue.run("one"),
    second = queue.run("two");
  const failures = Promise.all([
    first.catch((error) => error.message),
    second.catch((error) => error.message),
  ]);
  await tick();
  worker.dispatchEvent(new Event("error"));
  expect(await failures).toEqual([
    "Render worker failed",
    "Render worker failed",
  ]);
  await tick();
  expect(queue.stats().pending).toBe(0);
  expect(worker.stopped).toBe(true);
});
