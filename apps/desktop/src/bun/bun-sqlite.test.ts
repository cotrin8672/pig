import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { SqliteExecutor, SqliteValue } from "@earendil-works/chord/sqlite";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { BunSqliteDatabase, openBunSqliteDatabase } from "./bun-sqlite";

registerStorageConformance(
  { describe, expect, it },
  "Bun SQLite / Durable 1.5.0",
  async (use) => {
    const directory = await mkdtemp(
      join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-sqlite-"),
    );
    const database = await openBunSqliteDatabase(
      join(directory, "test.sqlite"),
    );
    try {
      const storage = await SqliteStorage.open(database);
      try {
        await use(storage);
      } finally {
        await storage.close(BACKGROUND_CONTEXT);
      }
    } finally {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

function deferred() {
  return Promise.withResolvers<void>();
}

describe("Bun SQLite transaction boundary", () => {
  it("orders nontransaction calls, transactions, reads and close FIFO; commits before resolving", async () => {
    const db = await openBunSqliteDatabase(":memory:");
    await db.exec("CREATE TABLE test (value INTEGER)");
    const entered = deferred();
    const release = deferred();
    let handle: SqliteExecutor | undefined;
    const first = db.transaction(async (tx) => {
      handle = tx;
      await tx.run("INSERT INTO test VALUES (?)", 1);
      entered.resolve();
      await release.promise;
      return 42;
    });
    await entered.promise;
    const read = db.all<{ value: number }>("SELECT value FROM test");
    const outside = db.run("INSERT INTO test VALUES (?)", 2);
    const second = db.transaction(async (tx) => {
      expect(await tx.all("SELECT value FROM test")).toEqual([
        { value: 1 },
        { value: 2 },
      ]);
      await tx.run("INSERT INTO test VALUES (?)", 3);
    });
    const counted = db.runCounted("INSERT INTO test VALUES (?)", 4);
    const rows = db.all("SELECT value FROM test");
    const close = db.close();
    expect(db.close()).toBe(close);
    let readFinished = false;
    void read.then(() => {
      readFinished = true;
    });
    await Promise.resolve();
    expect(readFinished).toBe(false);
    await expect(db.get("SELECT 1")).rejects.toThrow("closed");
    release.resolve();
    expect(await first).toBe(42);
    expect(await read).toEqual([{ value: 1 }]);
    await outside;
    await second;
    expect(await counted).toBe(1);
    expect(await rows).toEqual([
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 4 },
    ]);
    await close;
    if (!handle) throw new Error("missing transaction handle");
    const expired = handle;
    for (const call of [
      () => expired.exec("SELECT 1"),
      () => expired.run("SELECT 1"),
      () => expired.runCounted("SELECT 1"),
      () => expired.get("SELECT 1"),
      () => expired.all("SELECT 1"),
    ]) {
      await expect(call()).rejects.toThrow("no longer active");
    }
    await expect(db.transaction(async () => 1)).rejects.toThrow("closed");
    await expect(db.exec("SELECT 1")).rejects.toThrow("closed");
    await expect(db.run("SELECT 1")).rejects.toThrow("closed");
    await expect(db.all("SELECT 1")).rejects.toThrow("closed");
    await expect(db.runCounted("SELECT 1")).rejects.toThrow("closed");
  });

  it("rolls back callback/commit failure, expires failed handles and keeps queue usable", async () => {
    const native = new Database(":memory:", { strict: true });
    const db = new BunSqliteDatabase(native);
    await db.exec("CREATE TABLE test (value INTEGER)");
    const failure = new Error("callback failure");
    let escaped: SqliteExecutor | undefined;
    await expect(
      db.transaction(async (tx) => {
        escaped = tx;
        await tx.run("INSERT INTO test VALUES (1)");
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expect(escaped?.get("SELECT 1")).rejects.toThrow("no longer active");
    expect(await db.all("SELECT * FROM test")).toEqual([]);
    const exec = native.exec.bind(native);
    native.exec = (sql) => {
      if (sql === "COMMIT") throw failure;
      return exec(sql);
    };
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO test VALUES (2)");
      }),
    ).rejects.toBe(failure);
    native.exec = exec;
    expect(await db.all("SELECT * FROM test")).toEqual([]);
    await db.run("INSERT INTO test VALUES (3)");
    expect(await db.get("SELECT * FROM test")).toEqual({ value: 3 });
    await db.close();
  });

  it("preserves BOTH failures when rollback fails", async () => {
    const native = new Database(":memory:", { strict: true });
    const db = new BunSqliteDatabase(native);
    const exec = native.exec.bind(native);
    const failure = new Error("commit failure");
    const rollback = new Error("rollback failure");
    native.exec = (sql) => {
      if (sql === "COMMIT") throw failure;
      if (sql === "ROLLBACK") throw rollback;
      return exec(sql);
    };
    let caught: unknown;
    try {
      await db.transaction(async () => undefined);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([failure, rollback]);
    native.exec = exec;
    native.exec("ROLLBACK");
    await db.close();
  });

  it("does not roll back a failed BEGIN, and still closes after checkpoint failure", async () => {
    const native = new Database(":memory:", { strict: true });
    const db = new BunSqliteDatabase(native);
    const exec = native.exec.bind(native);
    const failure = new Error("begin failed");
    let rollbacks = 0;
    let callbacks = 0;
    native.exec = (sql) => {
      if (sql === "BEGIN IMMEDIATE") throw failure;
      if (sql === "ROLLBACK") rollbacks++;
      return exec(sql);
    };
    await expect(
      db.transaction(async () => {
        callbacks++;
      }),
    ).rejects.toBe(failure);
    expect(callbacks).toBe(0);
    expect(rollbacks).toBe(0);
    native.exec = exec;
    expect(await db.get("SELECT 1 AS n")).toEqual({ n: 1 });
    const checkpoint = new Error("checkpoint failed");
    native.exec = (sql) => {
      if (sql === "PRAGMA wal_checkpoint(TRUNCATE)") throw checkpoint;
      return exec(sql);
    };
    const closed = db.close();
    await expect(closed).rejects.toBe(checkpoint);
    expect(db.close()).toBe(closed);
    await expect(db.get("SELECT 1")).rejects.toThrow("closed");
    expect(() => native.prepare("SELECT 1")).toThrow();
  });

  it("propagates native close failure and permanently seals admission", async () => {
    const native = new Database(":memory:", { strict: true });
    const db = new BunSqliteDatabase(native);
    const close = native.close.bind(native);
    const failure = new Error("close failed");
    native.close = () => {
      throw failure;
    };
    try {
      const closed = db.close();
      await expect(closed).rejects.toBe(failure);
      expect(db.close()).toBe(closed);
      await expect(db.run("SELECT 1")).rejects.toThrow("closed");
    } finally {
      close();
    }
  });

  it("validates binding values/counts, supports every portable value, and rejects invalid options", async () => {
    const db = await openBunSqliteDatabase(":memory:");
    try {
      expect(
        await db.get(
          "SELECT ? AS n, ? AS s, ? AS f, ? AS b, CAST(? AS TEXT) AS i",
          null,
          "bound",
          1.25,
          new Uint8Array([1, 2]),
          9223372036854775807n,
        ),
      ).toEqual({
        n: null,
        s: "bound",
        f: 1.25,
        b: new Uint8Array([1, 2]),
        i: "9223372036854775807",
      });
      for (const value of [undefined, true, {}, NaN, Infinity, 1n << 63n]) {
        await expect(
          db.get("SELECT ?", value as SqliteValue),
        ).rejects.toThrow();
      }
      await expect(db.get("SELECT ?")).rejects.toThrow();
      await expect(db.get("SELECT ?", 1, 2)).rejects.toThrow();
      expect(await db.get("SELECT 1 WHERE 0")).toBeUndefined();
    } finally {
      await db.close();
    }
    await expect(openBunSqliteDatabase("", {})).rejects.toThrow("path");
    await expect(
      openBunSqliteDatabase(":memory:", { busyTimeoutMs: -1 }),
    ).rejects.toThrow();
    await expect(
      openBunSqliteDatabase(":memory:", { walAutoCheckpointPages: 1.5 }),
    ).rejects.toThrow();
  });
});
