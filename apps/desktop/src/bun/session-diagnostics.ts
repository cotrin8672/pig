import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SendKey } from "../shared/runtime-contract";
import type { Message } from "../shared/transcript";

export type RunDiagnostic = {
  id: string;
  revision: number;
  leafId: string | null;
  status: "running" | "completed" | "failed" | "aborted" | "stop-unconfirmed";
  failure?: string;
};
export type RecoveredPrompt = {
  id: string;
  leafId: string | null;
  key?: SendKey;
  message?: Extract<Message, { role: "user" }>;
};
type State = {
  version: 1;
  sessionId: string;
  cwd: string;
  run?: RunDiagnostic;
  recovered: RecoveredPrompt[];
};
const ownerKey = (manager: SessionManager) =>
  JSON.stringify([
    manager.getSessionId(),
    manager.getCwd(),
    manager.getSessionFile(),
  ]);
function validMessage(message: RecoveredPrompt["message"]) {
  return (
    message?.role === "user" &&
    Number.isFinite(message.timestamp) &&
    (typeof message.content === "string" ||
      (Array.isArray(message.content) &&
        message.content.every(
          (block) =>
            block &&
            ((block.type === "text" && typeof block.text === "string") ||
              (block.type === "image" &&
                typeof block.data === "string" &&
                typeof block.mimeType === "string")),
        )))
  );
}

/** Uses the F05 database; SQLite owns crash-safe writer locks. No token-event writes. */
export class SessionDiagnosticStore {
  private db?: Database;
  error?: string;
  constructor(file: string) {
    let db: Database | undefined;
    try {
      mkdirSync(dirname(file), { recursive: true });
      db = new Database(file, { create: true, strict: true });
      const version = db.query("PRAGMA user_version").get() as {
        user_version: number;
      };
      if (version.user_version > 1)
        throw new Error("Unsupported recovery database version");
      db.exec(`PRAGMA busy_timeout = 1000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS run_diagnostics (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, metadata TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deleted (session TEXT PRIMARY KEY)`);
      this.db = db;
    } catch (error) {
      db?.close();
      this.error = `Cannot open run diagnostic storage; original data preserved: ${String(error)}`;
    }
  }
  read(manager: SessionManager) {
    if (!this.db) throw new Error(this.error);
    return this.db
      .query("SELECT revision, metadata FROM run_diagnostics WHERE owner = ?")
      .get(ownerKey(manager)) as { revision: number; metadata: string } | null;
  }
  save(manager: SessionManager, revision: number, value: State) {
    if (!this.db) throw new Error(this.error);
    this.db
      .transaction(() => {
        if (
          this.db
            ?.query("SELECT 1 FROM deleted WHERE session = ?")
            .get(JSON.stringify([manager.getSessionId(), manager.getCwd()]))
        )
          throw new Error("Diagnostic metadata belongs to a deleted session");
        const result = this.db
          ?.query(`INSERT INTO run_diagnostics VALUES (?, ?, ?)
        ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision, metadata=excluded.metadata
        WHERE run_diagnostics.revision = ?`)
          .run(
            ownerKey(manager),
            revision + 1,
            JSON.stringify(value),
            revision,
          );
        if (!result?.changes)
          throw new Error(
            "Diagnostic metadata changed in another writer; original data preserved",
          );
      })
      .immediate();
  }
  delete(manager: SessionManager) {
    if (!this.db) throw new Error(this.error);
    this.db
      .query("DELETE FROM run_diagnostics WHERE owner = ?")
      .run(ownerKey(manager));
  }
  close() {
    this.db?.close();
    this.db = undefined;
  }
}

/** Hydration failure never grants permission to overwrite the original row. */
export class SessionDiagnostics {
  value: State;
  private revision = 0;
  private blocked = false;
  error?: string;
  constructor(
    private manager: SessionManager,
    private store?: SessionDiagnosticStore,
  ) {
    this.value = {
      version: 1,
      sessionId: manager.getSessionId(),
      cwd: manager.getCwd(),
      recovered: [],
    };
    try {
      const row = store?.read(manager);
      if (!row) return;
      if (!Number.isSafeInteger(row.revision) || row.revision < 1)
        throw new Error("Invalid diagnostic revision");
      this.revision = row.revision;
      const value = JSON.parse(row.metadata);
      if (
        !value ||
        value.version !== 1 ||
        value.sessionId !== this.value.sessionId ||
        value.cwd !== this.value.cwd ||
        !Array.isArray(value.recovered) ||
        value.recovered.some(
          (item: RecoveredPrompt) =>
            !item ||
            typeof item.id !== "string" ||
            !(item.leafId === null || typeof item.leafId === "string") ||
            (item.key
              ? typeof item.key.hostId !== "string" ||
                item.key.sessionId !== value.sessionId ||
                !Number.isSafeInteger(item.key.epoch) ||
                item.key.epoch < 0 ||
                typeof item.key.requestId !== "string" ||
                item.message !== undefined
              : !validMessage(item.message)),
        ) ||
        (value.run &&
          (typeof value.run.id !== "string" ||
            !Number.isSafeInteger(value.run.revision) ||
            value.run.revision < 1 ||
            !(
              value.run.leafId === null || typeof value.run.leafId === "string"
            ) ||
            ![
              "running",
              "completed",
              "failed",
              "aborted",
              "stop-unconfirmed",
            ].includes(value.run.status) ||
            (value.run.failure !== undefined &&
              typeof value.run.failure !== "string")))
      )
        throw new Error("Invalid session diagnostic metadata");
      this.value = value;
    } catch (error) {
      this.blocked = true;
      this.failed(error);
    }
  }
  private failed(error: unknown) {
    this.error = `Session diagnostic metadata unavailable; original data preserved: ${String(error)}`;
    console.error(this.error);
  }
  save() {
    if (this.blocked) return false;
    try {
      this.store?.save(this.manager, this.revision, this.value);
      this.revision++;
      this.error = undefined;
      return true;
    } catch (error) {
      this.failed(error);
      return false;
    }
  }
}
