import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStatisticsWorker } from "../../../scripts/pre-build";
import { fixture } from "./fixtures";
import { StatisticsService } from "./service";

test("worker flushes batches; deletion orders against in-flight writes and late events", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-statistics-worker-"));
  try {
    const file = join(root, "statistics.sqlite");
    const service = new StatisticsService(file);
    const { events } = fixture();
    for (let i = 0; i < 250; i++)
      service.record({ ...events[0], id: `event-${i}`, sequence: i + 1 });
    await service.flush();
    expect((await service.snapshot("today")).collectingSince).not.toBeNull();
    const db = new Database(file, { readonly: true });
    expect(db.query("SELECT count(*) AS n FROM events").get()).toEqual({
      n: 250,
    });
    db.close();
    service.record({ ...events[0], id: "queued" });
    await service.forget(events[0].owner);
    service.record({ ...events[0], id: "late" });
    await service.close();
    const check = new Database(file, { readonly: true });
    expect(check.query("SELECT count(*) AS n FROM events").get()).toEqual({
      n: 0,
    });
    check.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("storage failure never escapes record or close and exposes only a safe code", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-statistics-failure-"));
  try {
    const file = join(root, "not-a-directory");
    await writeFile(file, "secret");
    const service = new StatisticsService(join(file, "statistics.sqlite"));
    const { events } = fixture();
    expect(() => service.record(events[0])).not.toThrow();
    await expect(service.flush()).rejects.toThrow("Statistics unavailable");
    expect(service.error).toBe("storage");
    expect(() => service.record(events[0])).not.toThrow();
    await service.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("oversized metadata is dropped with a persisted counter, without stopping later tool facts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-statistics-overflow-"));
  try {
    const file = join(root, "statistics.sqlite");
    const service = new StatisticsService(file);
    const { events } = fixture();
    service.record({
      ...events[0],
      id: "oversized",
      data: { metadata: "x".repeat(300 * 1024) },
    });
    service.record({
      ...events[0],
      id: "tool",
      type: "tool_execution_end",
      data: { isError: true },
    });
    await service.flush();
    await service.close();
    const db = new Database(file, { readonly: true });
    expect(db.query("SELECT id FROM events").all()).toEqual([{ id: "tool" }]);
    expect(
      db
        .query("SELECT value FROM collection_state WHERE key = 'dropped'")
        .get(),
    ).toEqual({ value: 1 });
    db.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled host and worker run relocated without source paths or package installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-statistics-bundle-"));
  try {
    const source = join(root, "fixture.ts");
    const { events } = fixture();
    await writeFile(
      source,
      `
      import { StatisticsService } from ${JSON.stringify(fileURLToPath(new URL("./service.ts", import.meta.url)))};
      const service = new StatisticsService(process.argv[2]);
      service.record(${JSON.stringify(events[0])});
      await service.flush();
      await service.close();
    `,
    );
    const host = await Bun.build({
      entrypoints: [source],
      target: "bun",
      outdir: root,
      naming: "host.js",
    });
    expect(host.success).toBe(true);
    // Same build function used by Electrobun's preBuild hook.
    await buildStatisticsWorker(join(import.meta.dir, "../../.."));
    await Bun.write(
      join(root, "statistics-worker.js"),
      Bun.file(
        join(import.meta.dir, "../../../build/statistics/statistics-worker.js"),
      ),
    );
    const file = join(root, "statistics.sqlite");
    const child = Bun.spawn(
      [process.execPath, "--no-install", join(root, "host.js"), file],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const db = new Database(file, { readonly: true });
    expect(db.query("SELECT count(*) AS n FROM events").get()).toEqual({
      n: 1,
    });
    db.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
