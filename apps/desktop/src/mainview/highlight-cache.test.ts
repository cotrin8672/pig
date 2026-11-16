import { expect, test } from "bun:test";
import type { ThemedToken } from "shiki/core";
import { createHighlightCache } from "./highlight-cache";

const tokens = (content: string): ThemedToken[][] => [[{ content, offset: 0 }]];
const deferred = () => Promise.withResolvers<ThemedToken[][] | undefined>();

test("completed highlights obey the byte budget and refresh LRU on reads", async () => {
  const cache = createHighlightCache(async (text) => tokens(text), 1200);
  await cache.run("a", "ts");
  await cache.run("b", "ts");
  expect(cache.peek("a", "ts")).toBeDefined();
  await cache.run("c", "ts");
  expect(cache.peek("b", "ts")).toBeUndefined();
  expect(cache.peek("a", "ts")).toBeDefined();
  expect(cache.peek("c", "ts")).toBeDefined();
  expect(cache.stats()).toMatchObject({ entries: 2, pending: 0 });
  expect(cache.stats().bytes).toBeLessThanOrEqual(1200);
});

test("unused results leave first, but mounted results never exempt the cache from its budget", async () => {
  const cache = createHighlightCache(async (text) => tokens(text), 1200);
  const a = new AbortController();
  const b = new AbortController();
  const mounted = await cache.run("a", "ts", a.signal);
  await cache.run("b", "ts", b.signal);
  b.abort();
  await cache.run("c", "ts");
  expect(cache.peek("a", "ts")).toBe(mounted);
  expect(cache.peek("b", "ts")).toBeUndefined();

  const c = new AbortController();
  await cache.run("c", "ts", c.signal);
  const d = new AbortController();
  await cache.run("d", "ts", d.signal);
  expect(cache.peek("a", "ts")).toBeUndefined();
  expect(mounted).toEqual(tokens("a"));
  expect(cache.stats().bytes).toBeLessThanOrEqual(1200);
  a.abort();
  c.abort();
  d.abort();
});

test("oversized results are returned completely without evicting useful small results", async () => {
  const cache = createHighlightCache(async (text) => tokens(text), 1200);
  const small = await cache.run("small", "ts");
  const big = "x".repeat(1000);
  expect(await cache.run(big, "ts")).toEqual(tokens(big));
  expect(cache.peek(big, "ts")).toBeUndefined();
  expect(cache.peek("small", "ts")).toBe(small);
  expect(cache.stats()).toMatchObject({ entries: 1, pending: 0 });
});

test("pending jobs stay deduplicated beyond the completed-result count budget", async () => {
  const jobs = new Map<string, ReturnType<typeof deferred>>();
  let calls = 0;
  const cache = createHighlightCache((text) => {
    calls++;
    const job = deferred();
    jobs.set(text, job);
    return job.promise;
  });
  const first = cache.run("0", "ts");
  const waiting = Array.from({ length: 40 }, (_, i) =>
    cache.run(String(i + 1), "ts"),
  );
  const again = cache.run("0", "ts");
  await Promise.resolve();
  expect(calls).toBe(41);
  expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 41 });
  for (const [text, job] of jobs) job.resolve(tokens(text));
  expect(await first).toBe(await again);
  await Promise.all(waiting);
  expect(cache.stats()).toMatchObject({ entries: 32, pending: 0 });
});

test("one cancelled consumer never cancels another; the last cancellation prevents stale caching", async () => {
  const jobs: {
    job: ReturnType<typeof deferred>;
    signal: AbortSignal;
  }[] = [];
  const cache = createHighlightCache((_text, _language, signal) => {
    const job = deferred();
    jobs.push({ job, signal });
    return job.promise;
  });
  const a = new AbortController();
  const b = new AbortController();
  const first = cache.run("same", "ts", a.signal);
  const second = cache.run("same", "ts", b.signal);
  await Promise.resolve();
  a.abort();
  expect(await first).toBeUndefined();
  expect(jobs[0].signal.aborted).toBe(false);
  b.abort();
  expect(await second).toBeUndefined();
  expect(jobs[0].signal.aborted).toBe(true);

  const next = cache.run("same", "ts");
  await Promise.resolve();
  const current = tokens("current");
  jobs[1].job.resolve(current);
  expect(await next).toBe(current);
  jobs[0].job.resolve(tokens("stale"));
  await Promise.resolve();
  await Promise.resolve();
  expect(cache.peek("same", "ts")).toBe(current);
  expect(cache.stats().pending).toBe(0);
});

test("failure and pre-aborted requests leave no entries and can be retried", async () => {
  let calls = 0;
  const cache = createHighlightCache(async (text) => {
    if (++calls === 1) throw new Error("Worker failed");
    return tokens(text);
  });
  const controller = new AbortController();
  controller.abort();
  expect(await cache.run("code", "ts", controller.signal)).toBeUndefined();
  expect(calls).toBe(0);
  expect(await cache.run("code", "ts")).toBeUndefined();
  expect(cache.stats()).toEqual({ entries: 0, bytes: 0, pending: 0 });
  expect(await cache.run("code", "ts")).toEqual(tokens("code"));
});
