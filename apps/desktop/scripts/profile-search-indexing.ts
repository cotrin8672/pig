import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { SearchIndex } from "../src/bun/search-index";

const count = Number(process.argv[2] ?? 6000);
const dir = await mkdtemp(join(tmpdir(), "pig-indexing-profile-"));
const sessions = join(dir, "sessions"),
  cwd = join(dir, "project");
let index: SearchIndex | undefined;
try {
  await mkdir(sessions);
  async function seed() {
    const lines = [JSON.stringify({ type: "session", id: "synthetic", cwd })];
    for (let i = 0; i < count; i++)
      lines.push(
        JSON.stringify({
          type: "message",
          id: `entry-${i}`,
          message: {
            role: i % 10 ? "toolResult" : "user",
            timestamp: i,
            content:
              i % 10
                ? "tool output 日本語😀 ".repeat(200)
                : `needle 設定 100%_ ${i} ${"body ".repeat(100)}`,
          },
        }),
      );
    const text = `${lines.join("\n")}\n`;
    await writeFile(join(sessions, "synthetic.jsonl"), text);
    return Buffer.byteLength(text);
  }
  const bytes = await seed();
  index = new SearchIndex(join(dir, "index.sqlite"));
  Bun.gc(true);
  const initial = process.memoryUsage();
  let peakHeap = initial.heapUsed,
    peakRss = initial.rss,
    last = performance.now();
  const gaps: number[] = [];
  const timer = setInterval(() => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    const memory = process.memoryUsage();
    peakHeap = Math.max(peakHeap, memory.heapUsed);
    peakRss = Math.max(peakRss, memory.rss);
  }, 2);
  const start = performance.now();
  try {
    await index.refresh(() => [{ dir: sessions, cwds: [cwd] }]);
  } finally {
    await Bun.sleep(5);
    clearInterval(timer);
  }
  const elapsedMs = performance.now() - start;
  const hits = index.search("needle 設定 100%_", count + 1);
  const expected = Array.from(
    { length: Math.ceil(count / 10) },
    (_, i) => `entry-${i * 10}`,
  ).reverse();
  if (
    !isDeepStrictEqual(
      hits.map((hit) => hit.entryId),
      expected,
    )
  )
    throw new Error("Index results differ from the complete source oracle");
  gaps.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      records: count,
      bytes,
      elapsedMs,
      maxGapMs: gaps.at(-1),
      p95GapMs: gaps[Math.floor(gaps.length * 0.95)],
      ticks: gaps.length,
      sampledHeapGrowthMiB: (peakHeap - initial.heapUsed) / 1048576,
      sampledRssGrowthMiB: (peakRss - initial.rss) / 1048576,
      hits: hits.length,
      scope:
        "Synthetic Bun backend indexing; timer sampling can miss transient peaks; not actual WebView input or real-conversation latency",
    }),
  );
} finally {
  index?.close();
  await rm(dir, { recursive: true, force: true });
}
