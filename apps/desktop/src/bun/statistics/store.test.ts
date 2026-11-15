import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./fixtures";
import { StatisticsStore } from "./store";

test("SQLite is idempotent, persists null usage, and deletion prevents replay resurrection", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-statistics-store-"));
  const file = join(root, "statistics.sqlite");
  try {
    const { events, collector } = fixture();
    collector.event({ type: "agent_start" });
    collector.close();
    const model = {
      ...events[0],
      id: "request-end",
      type: "model_end",
      request: "request",
      data: {
        purpose: "conversation",
        input: null,
        output: 20,
        reasoning: 8,
        costSource: "unknown",
      },
    };
    const store = new StatisticsStore(file);
    store.save([...events, model]);
    store.save([...events, model]);
    store.close();
    const read = new Database(file);
    expect(read.query("SELECT count(*) AS n FROM events").get()).toEqual({
      n: events.length + 1,
    });
    expect(
      read.query("SELECT input, output, reasoning FROM model_requests").get(),
    ).toEqual({
      input: null,
      output: 20,
      reasoning: 8,
    });
    expect(read.query("SELECT status FROM runs").get()).toEqual({
      status: "interrupted",
    });
    read.close();
    const reopened = new StatisticsStore(file);
    reopened.forget(events[0].owner);
    reopened.save([...events, model]);
    reopened.close();
    const deleted = new Database(file);
    expect(deleted.query("SELECT count(*) AS n FROM events").get()).toEqual({
      n: 0,
    });
    expect(
      deleted.query("SELECT count(*) AS n FROM model_requests").get(),
    ).toEqual({ n: 0 });
    expect(deleted.query("SELECT count(*) AS n FROM runs").get()).toEqual({
      n: 0,
    });
    deleted.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a future schema is preserved rather than overwritten", async () => {
  const root = await mkdtemp(join(tmpdir(), "pig-statistics-version-"));
  try {
    const file = join(root, "statistics.sqlite");
    const db = new Database(file, { create: true });
    db.exec(
      "PRAGMA user_version = 100; CREATE TABLE sentinel (n INTEGER); INSERT INTO sentinel VALUES (42)",
    );
    db.close();
    expect(() => new StatisticsStore(file)).toThrow(
      "Unsupported statistics schema",
    );
    const check = new Database(file);
    expect(check.query("SELECT n FROM sentinel").get()).toEqual({ n: 42 });
    expect(check.query("PRAGMA user_version").get()).toEqual({
      user_version: 100,
    });
    check.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
