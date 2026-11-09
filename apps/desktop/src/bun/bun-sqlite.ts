import { Database } from "bun:sqlite";
import type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteValue,
} from "@earendil-works/chord/sqlite";

export interface BunSqliteOptions {
  busyTimeoutMs?: number;
  walAutoCheckpointPages?: number;
}

function integerOption(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function validateBindings(params: SqliteValue[]): void {
  for (const value of params) {
    if (
      value === null ||
      typeof value === "string" ||
      value instanceof Uint8Array ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "bigint" && value >= -(1n << 63n) && value < 1n << 63n)
    ) {
      continue;
    }
    throw new TypeError(
      "Invalid SQLite binding (expected a portable SqliteValue)",
    );
  }
}

/** A transaction executor never goes back through the connection queue. */
class Executor implements SqliteExecutor {
  constructor(
    private readonly db: Database,
    private readonly dispatch: <T>(operation: () => T) => Promise<T>,
  ) {}

  exec(sql: string): Promise<void> {
    return this.dispatch(() => {
      this.db.exec(sql);
    });
  }

  private statement<T>(
    sql: string,
    params: SqliteValue[],
    use: (statement: ReturnType<Database["prepare"]>) => T,
  ): Promise<T> {
    return this.dispatch(() => {
      validateBindings(params);
      const statement = this.db.prepare(sql);
      try {
        if (statement.paramsCount !== params.length) {
          throw new RangeError(
            `SQLite binding count: expected ${statement.paramsCount}, got ${params.length}`,
          );
        }
        return use(statement);
      } finally {
        statement.finalize();
      }
    });
  }

  run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.statement(sql, params, (statement) => {
      statement.run(...params);
    });
  }

  runCounted(sql: string, ...params: SqliteValue[]): Promise<number> {
    return this.statement(sql, params, (statement) =>
      Number(statement.run(...params).changes),
    );
  }

  get<T extends object>(
    sql: string,
    ...params: SqliteValue[]
  ): Promise<T | undefined> {
    return this.statement(
      sql,
      params,
      (statement) => (statement.get(...params) ?? undefined) as T | undefined,
    );
  }

  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.statement(
      sql,
      params,
      (statement) => statement.all(...params) as T[],
    );
  }
}

/** FIFO for every connection operation, not just transactions. Owns the supplied connection. */
export class BunSqliteDatabase extends Executor implements SqliteDatabase {
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  private closePromise?: Promise<void>;

  constructor(private readonly connection: Database) {
    super(connection, (operation) => this.admit(operation));
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    // This observes only the queue barrier; the caller still receives the original rejection.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private admit<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.closing)
      return Promise.reject(new Error("SQLite database is closed"));
    return this.enqueue(operation);
  }

  transaction<T>(
    callback: (transaction: SqliteExecutor) => Promise<T>,
  ): Promise<T> {
    return this.admit(async () => {
      this.connection.exec("BEGIN IMMEDIATE");
      let active = true;
      const transaction = new Executor(this.connection, async (operation) => {
        if (!active)
          throw new Error("SQLite transaction handle is no longer active");
        return operation();
      });
      try {
        const result = await callback(transaction);
        active = false;
        this.connection.exec("COMMIT");
        return result;
      } catch (error) {
        active = false;
        try {
          this.connection.exec("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "SQLite transaction failed and rollback failed",
          );
        }
        throw error;
      }
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.enqueue(() => {
      try {
        this.connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        this.connection.close();
      }
    });
    return this.closePromise;
  }
}

/** Does not create parent directories. No node:sqlite dependency or implicit user paths. */
export async function openBunSqliteDatabase(
  path: string,
  options: BunSqliteOptions = {},
): Promise<BunSqliteDatabase> {
  if (!path || path.includes("\0")) throw new TypeError("Invalid SQLite path");
  const timeout = integerOption(
    options.busyTimeoutMs ?? 5_000,
    "busyTimeoutMs",
  );
  const checkpoint = integerOption(
    options.walAutoCheckpointPages ?? 1_000,
    "walAutoCheckpointPages",
  );
  const native = new Database(path, { create: true, strict: true });
  const database = new BunSqliteDatabase(native);
  try {
    await database.exec(`PRAGMA busy_timeout = ${timeout}`);
    await database.exec("PRAGMA journal_mode = WAL");
    await database.exec("PRAGMA synchronous = NORMAL");
    await database.exec(`PRAGMA wal_autocheckpoint = ${checkpoint}`);
    return database;
  } catch (error) {
    try {
      // Initialization failed before handing out the adapter; a corrupt database cannot checkpoint.
      native.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "SQLite open and cleanup failed",
      );
    }
    throw error;
  }
}
