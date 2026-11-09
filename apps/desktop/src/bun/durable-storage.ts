import { Database } from "bun:sqlite";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { SqliteDatabase } from "@earendil-works/chord/sqlite";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { openBunSqliteDatabase } from "./bun-sqlite";

export interface DurableStorageOptions {
  /** App-owned config/data directory, not a project directory. Must be explicit and absolute. */
  dataRoot: string;
  /** Opaque app-owned key; never a user-supplied path or an old conversation ID. */
  workspaceId: string;
}

// Keep live connections strongly reachable, including fail-closed cleanup failures.
const writers = new Map<string, Database | undefined>();

export function durableStoragePath(options: DurableStorageOptions): string {
  if (!isAbsolute(options.dataRoot) || options.dataRoot.includes("\0")) {
    throw new TypeError("Durable dataRoot must be an absolute path");
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.workspaceId)) {
    throw new TypeError("Invalid Durable workspaceId");
  }
  return join(
    options.dataRoot,
    "agent-v2",
    "workspaces",
    options.workspaceId,
    "state.sqlite",
  );
}

/**
 * A separate SQLite file holds an EXCLUSIVE OS lock for the entire storage lifetime.
 * No TTL, stale-file deletion, PID reuse or clock-based stealing. The OS releases it on crash.
 * Never delete/replace the lock file: doing so could create two independent lock domains.
 * This is a local-filesystem single-writer boundary, not a distributed/network-share lease.
 */
async function acquireWriter(path: string): Promise<() => void> {
  await mkdir(dirname(path), { recursive: true });
  const canonical = join(await realpath(dirname(path)), "state.sqlite");
  const key =
    process.platform === "win32" ? canonical.toLowerCase() : canonical;
  if (writers.has(key))
    throw new Error("Durable storage already has a live writer");
  writers.set(key, undefined);
  let lock: Database | undefined;
  try {
    lock = new Database(`${canonical}.writer-lock`, {
      create: true,
      strict: true,
    });
    lock.exec("PRAGMA busy_timeout = 0");
    lock.exec("PRAGMA journal_mode = DELETE");
    lock.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    try {
      lock?.close();
    } finally {
      writers.delete(key);
    }
    throw new Error("Cannot acquire Durable single-writer lock", {
      cause: error,
    });
  }
  writers.set(key, lock);
  const owned = lock;
  let released = false;
  return () => {
    if (released) return;
    owned.close();
    released = true;
    writers.delete(key);
  };
}

/**
 * Owns a NEW agent-v2 storage only. Does not discover, import, scan or delete any legacy data.
 * Pass the result directly to Harness.open; Harness.close -> Storage.close releases ownership.
 * If Harness.open fails, the caller must close this storage. A close failure retains ownership.
 */
export async function openDurableStorage(
  options: DurableStorageOptions,
): Promise<SqliteStorage> {
  const path = durableStoragePath(options);
  const release = await acquireWriter(path);
  let database: Awaited<ReturnType<typeof openBunSqliteDatabase>>;
  try {
    database = await openBunSqliteDatabase(path);
  } catch (error) {
    // The adapter uses AggregateError only when opening AND closing failed.
    // Do not allow another owner while the connection's closure is uncertain.
    if (!(error instanceof AggregateError)) release();
    throw error;
  }
  let closing: Promise<void> | undefined;
  const owned: SqliteDatabase = {
    exec: (sql) => database.exec(sql),
    run: (sql, ...params) => database.run(sql, ...params),
    runCounted: (sql, ...params) => database.runCounted(sql, ...params),
    get: (sql, ...params) => database.get(sql, ...params),
    all: (sql, ...params) => database.all(sql, ...params),
    transaction: (callback) => database.transaction(callback),
    close: () => {
      closing ??= database.close().then(() => release());
      return closing;
    },
  };
  try {
    return await SqliteStorage.open(owned);
  } catch (error) {
    try {
      await owned.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "Durable storage open and cleanup failed",
      );
    }
    throw error;
  }
}
