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
