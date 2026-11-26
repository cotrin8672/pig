import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { StatisticsPeriod } from "../../shared/statistics";
import type { StatisticEvent } from "./contracts";
import { queryStatistics } from "./queries";

const retentionMs = 365 * 24 * 60 * 60 * 1000;

/** Private database: never shares tables or failure modes with session recovery. */
export class StatisticsStore {
  private readonly db: Database;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    const db = new Database(file, { create: true, strict: true });
    try {
      const version = db.query("PRAGMA user_version").get() as {
        user_version: number;
      };
      if (version.user_version > 1)
        throw new Error("Unsupported statistics schema");
      db.exec(`PRAGMA busy_timeout = 1000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;`);
      db.transaction(() => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, version INTEGER NOT NULL,
            owner TEXT NOT NULL, project TEXT NOT NULL, session TEXT NOT NULL,
            host TEXT NOT NULL, binding TEXT NOT NULL, sequence INTEGER NOT NULL,
            at INTEGER NOT NULL, type TEXT NOT NULL, run TEXT, request TEXT,
            call TEXT, parent_call TEXT, data TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS events_time ON events(at);
          CREATE INDEX IF NOT EXISTS events_owner ON events(owner, at);
          CREATE INDEX IF NOT EXISTS events_run ON events(run, sequence);
          CREATE INDEX IF NOT EXISTS events_type ON events(type, at);
          CREATE TABLE IF NOT EXISTS model_requests (
            owner TEXT NOT NULL, request TEXT NOT NULL, at INTEGER NOT NULL,
            project TEXT NOT NULL, session TEXT NOT NULL, run TEXT,
            provider TEXT, model TEXT, purpose TEXT NOT NULL,
            input REAL, output REAL, cache_read REAL, cache_write REAL,
            reasoning REAL, total_tokens REAL, cost_total REAL, cost_source TEXT,
            duration_ms REAL, data TEXT NOT NULL,
            PRIMARY KEY(owner, request));
          CREATE INDEX IF NOT EXISTS requests_time ON model_requests(at);
          CREATE INDEX IF NOT EXISTS requests_model ON model_requests(provider, model, at);
          CREATE INDEX IF NOT EXISTS requests_project ON model_requests(project, at);
          CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, started_at INTEGER NOT NULL,
            ended_at INTEGER, status TEXT NOT NULL, duration_ms REAL);
          CREATE INDEX IF NOT EXISTS runs_owner ON runs(owner);
          CREATE TABLE IF NOT EXISTS deleted (owner TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS collection_state (
            key TEXT PRIMARY KEY, value INTEGER NOT NULL);
          PRAGMA user_version = 1;`);
      })();
      this.db = db;
      this.prune(Date.now() - retentionMs);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  save(events: StatisticEvent[], dropped = 0) {
    const insert = this.db.query(
      `INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const deleted = this.db.query("SELECT 1 FROM deleted WHERE owner = ?");
    const request = this.db.query(
      `INSERT OR IGNORE INTO model_requests VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      for (const event of events) {
        if (
          event.version !== 1 ||
          !event.id ||
          !event.owner ||
          !Number.isSafeInteger(event.sequence) ||
          !Number.isSafeInteger(event.at) ||
          event.at < 0
        )
          throw new Error("Invalid statistics event");
        const data = JSON.stringify(event.data);
        if (Buffer.byteLength(data) > 256 * 1024)
          throw new Error("Statistics event exceeds limit");
        if (deleted.get(event.owner)) continue;
        const result = insert.run(
          event.id,
          event.version,
          event.owner,
          event.project,
          event.session,
          event.host,
          event.binding,
          event.sequence,
          event.at,
          event.type,
          event.run,
          event.request,
          event.call,
          event.parentCall,
          data,
        );
        if (!result.changes) continue;
        const d = event.data;
        if (
          event.request &&
          (event.type === "model_end" || event.type === "auxiliary_usage")
        )
          request.run(
            event.owner,
            event.request,
            typeof d.timestamp === "number" &&
              Number.isSafeInteger(d.timestamp) &&
              d.timestamp >= 0
              ? d.timestamp
              : event.at,
            event.project,
            event.session,
            event.run,
            typeof d.provider === "string" ? d.provider : null,
            typeof d.model === "string" ? d.model : null,
            typeof d.purpose === "string" ? d.purpose : "unknown",
            typeof d.input === "number" ? d.input : null,
            typeof d.output === "number" ? d.output : null,
            typeof d.cacheRead === "number" ? d.cacheRead : null,
            typeof d.cacheWrite === "number" ? d.cacheWrite : null,
            typeof d.reasoning === "number" ? d.reasoning : null,
            typeof d.totalTokens === "number" ? d.totalTokens : null,
            typeof d.costTotal === "number" ? d.costTotal : null,
            typeof d.costSource === "string" ? d.costSource : null,
            typeof d.durationMs === "number" ? d.durationMs : null,
            data,
          );
        if (event.type === "run_start" && event.run)
          this.db
            .query(
              "INSERT OR IGNORE INTO runs VALUES (?, ?, ?, NULL, 'running', NULL)",
            )
            .run(event.run, event.owner, event.at);
        if (event.type === "run_end" && event.run)
          this.db
            .query(
              "UPDATE runs SET ended_at = ?, status = ?, duration_ms = ? WHERE id = ? AND owner = ?",
            )
            .run(
              event.at,
              typeof d.status === "string" ? d.status : "unknown",
              typeof d.durationMs === "number" ? d.durationMs : null,
              event.run,
              event.owner,
            );
      }
      this.db
        .query(`INSERT INTO collection_state VALUES ('dropped', ?)
          ON CONFLICT(key) DO UPDATE SET value = value + excluded.value`)
        .run(dropped);
    })();
  }

  forget(owner: string) {
    this.db.transaction(() => {
      this.db.query("INSERT OR IGNORE INTO deleted VALUES (?)").run(owner);
      this.db.query("DELETE FROM events WHERE owner = ?").run(owner);
      this.db.query("DELETE FROM model_requests WHERE owner = ?").run(owner);
      this.db.query("DELETE FROM runs WHERE owner = ?").run(owner);
    })();
  }

  private prune(before: number) {
    this.db.transaction(() => {
      this.db.query("DELETE FROM events WHERE at < ?").run(before);
      this.db.query("DELETE FROM model_requests WHERE at < ?").run(before);
      this.db.query("DELETE FROM runs WHERE started_at < ?").run(before);
    })();
  }

  close() {
    this.db.close();
  }
  snapshot(
    period: StatisticsPeriod,
    now?: number,
    publish?: Parameters<typeof queryStatistics>[3],
  ) {
    return this.db.transaction(() =>
      queryStatistics(this.db, period, now, publish),
    )();
  }
}
