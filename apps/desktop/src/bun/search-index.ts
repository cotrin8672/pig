import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { MAX_TERMS, searchTerms } from "../shared/fuzzy";
import type { ConversationHit } from "../shared/rpc-schema";
import { sameSessionPath } from "./session-files";

/** One session directory and the registered workspaces whose chats live there. */
export interface SearchRoot {
  dir: string;
  cwds: string[];
}

const VERSION = 1;
/** Static statement: unused term slots are bound to "%", which matches everything. */
const SEARCH_SQL = `SELECT text, session, entry, role, ts FROM messages
  WHERE text LIKE ?1 ESCAPE '\\' AND text LIKE ?2 ESCAPE '\\'
    AND text LIKE ?3 ESCAPE '\\' AND text LIKE ?4 ESCAPE '\\'
    AND text LIKE ?5 ESCAPE '\\' AND text LIKE ?6 ESCAPE '\\'
    AND text LIKE ?7 ESCAPE '\\' AND text LIKE ?8 ESCAPE '\\'
  ORDER BY ts DESC LIMIT ?9`;
/** Bytes before the indexed offset re-checked to detect rewritten files. */
const TAIL = 64;
const SLICE_MS = 8;

/**
 * Pi's per-cwd default session directory. The SDK only exports a variant that
 * creates the directory as a side effect.
 * shortcut: mirrors getDefaultSessionDirPath in SDK 1.5.2; recheck on SDK upgrades.
 */
export function defaultSessionDir(cwd: string, agentDir: string) {
  const safe = `--${resolve(cwd)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;
  return join(resolve(agentDir), "sessions", safe);
}

export function snippet(text: string, terms: string[], width = 160) {
  const lower = text.toLowerCase();
  const at = Math.max(
    0,
    Math.min(
      ...terms.map((term) => {
        const index = lower.indexOf(term);
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      }),
    ),
  );
  const index = Number.isFinite(at) ? at : 0;
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, start + width);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, end).replace(/\s+/g, " ").trim() +
    (end < text.length ? "…" : "")
  );
}

function messageText(line: string) {
  let entry: {
    type?: unknown;
    id?: unknown;
    timestamp?: unknown;
    message?: {
      role?: unknown;
      content?: unknown;
      timestamp?: unknown;
    };
  };
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  const message = entry?.message;
  if (
    entry?.type !== "message" ||
    typeof entry.id !== "string" ||
    (message?.role !== "user" && message?.role !== "assistant")
  )
    return;
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .filter(
              (block): block is { type: "text"; text: string } =>
                block?.type === "text" && typeof block.text === "string",
            )
            .map((block) => block.text)
            .join("\n\n")
        : "";
  if (!text.trim()) return;
  const timestamp =
    typeof message.timestamp === "number"
      ? message.timestamp
      : typeof entry.timestamp === "string"
        ? Date.parse(entry.timestamp) || 0
        : 0;
  return { entry: entry.id, role: message.role, text, timestamp };
}

function header(line: string) {
  try {
    const value = JSON.parse(line);
    if (
      value?.type === "session" &&
      typeof value.id === "string" &&
      typeof value.cwd === "string"
    )
      return { id: value.id as string, cwd: value.cwd as string };
  } catch {}
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Derived, disposable full-text index of user/assistant text in pi session
 * JSONL files. Files are append-only in normal use, so each file is read from
 * its last indexed byte; shrinking or rewritten files are reindexed.
 */
export class SearchIndex {
  private db: Database;
  private running?: Promise<void>;
  private queued?: () => SearchRoot[] | Promise<SearchRoot[]>;
  private cwds = new Map<string, string>();

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    const { user_version } = this.db.query("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (user_version !== VERSION)
      this.db.exec(`DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS messages;
        CREATE TABLE files(path TEXT PRIMARY KEY, session TEXT NOT NULL,
          cwd TEXT NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL,
          offset INTEGER NOT NULL, tail BLOB NOT NULL);
        CREATE VIRTUAL TABLE messages USING fts5(text, session UNINDEXED,
          entry UNINDEXED, role UNINDEXED, ts UNINDEXED, tokenize = 'trigram');
        PRAGMA user_version = ${VERSION};`);
    this.loadCwds();
  }

  get indexing() {
    return !!this.running;
  }

  private loadCwds() {
    this.cwds = new Map(
      (
        this.db
          .query("SELECT session, cwd FROM files WHERE session != ''")
          .all() as { session: string; cwd: string }[]
      ).map((row) => [row.session, row.cwd]),
    );
  }

  /** Coalesces overlapping refreshes into one follow-up run with the latest roots. */
  refresh(roots: () => SearchRoot[] | Promise<SearchRoot[]>): Promise<void> {
    this.queued = roots;
    if (this.running) return this.running;
    const run = (async () => {
      try {
        while (this.queued) {
          const next = this.queued;
          this.queued = undefined;
          await this.sync(await next());
        }
      } finally {
        this.running = undefined;
      }
    })();
    this.running = run;
    return run;
  }

  forget(sessionId: string) {
    this.db.transaction(() => {
      this.db.query("DELETE FROM messages WHERE session = ?").run(sessionId);
      this.db.query("DELETE FROM files WHERE session = ?").run(sessionId);
    })();
    this.cwds.delete(sessionId);
  }

  private forgetFile(path: string) {
    const row = this.db
      .query("SELECT session FROM files WHERE path = ?")
      .get(path) as { session: string } | null;
    this.db.transaction(() => {
      if (row?.session)
        this.db
          .query("DELETE FROM messages WHERE session = ?")
          .run(row.session);
      this.db.query("DELETE FROM files WHERE path = ?").run(path);
    })();
  }

  private async sync(roots: SearchRoot[]) {
    const seen = new Set<string>();
    for (const root of roots) {
      let names: string[];
      try {
        names = await readdir(root.dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".jsonl")) continue;
        const path = join(root.dir, name);
        seen.add(path);
        try {
          await this.indexFile(path, root.cwds);
        } catch (error) {
          console.warn(`Cannot index chat ${path}:`, error);
        }
      }
    }
    const known = this.db.query("SELECT path FROM files").all() as {
      path: string;
    }[];
    for (const { path } of known) if (!seen.has(path)) this.forgetFile(path);
    this.loadCwds();
  }

  private async indexFile(path: string, cwds: string[]) {
    const info = await stat(path);
    const row = this.db
      .query("SELECT * FROM files WHERE path = ?")
      .get(path) as {
      session: string;
      cwd: string;
      size: number;
      mtime: number;
      offset: number;
      tail: Uint8Array;
    } | null;
    if (row && row.size === info.size && row.mtime === info.mtimeMs) return;
    const handle = await open(path, "r");
    try {
      let from = 0;
      let session = "";
      let cwd = "";
      if (row && row.offset <= info.size && row.offset >= row.tail.length) {
        const tail = Buffer.alloc(row.tail.length);
        await handle.read(tail, 0, tail.length, row.offset - tail.length);
        if (tail.equals(Buffer.from(row.tail))) {
          from = row.offset;
          session = row.session;
          cwd = row.cwd;
        }
      }
      if (row && from === 0) this.forgetFile(path);
      const length = info.size - from;
      const bytes = Buffer.alloc(length);
      if (length) await handle.read(bytes, 0, length, from);
      const end = bytes.lastIndexOf(0x0a) + 1;
      const lines = bytes.subarray(0, end).toString("utf8").split("\n");
      let index = 0;
      if (from === 0) {
        while (index < lines.length && !lines[index].trim()) index++;
        const head = lines[index] ? header(lines[index]) : undefined;
        const owner = head && cwds.find((c) => sameSessionPath(head.cwd, c));
        if (!end) return; // Header still being written.
        if (!head || !owner) {
          // Another workspace's file sharing this directory: remember and skip.
          this.saveFile(path, "", "", info, info.size, Buffer.alloc(0));
          return;
        }
        session = head.id;
        cwd = owner;
        index++;
      }
      if (!session) {
        this.saveFile(path, "", "", info, info.size, Buffer.alloc(0));
        return;
      }
      const insert = this.db.query(
        "INSERT INTO messages(text, session, entry, role, ts) VALUES (?, ?, ?, ?, ?)",
      );
      while (index < lines.length) {
        const started = performance.now();
        const rows: NonNullable<ReturnType<typeof messageText>>[] = [];
        for (
          ;
          index < lines.length && performance.now() - started < SLICE_MS;
          index++
        ) {
          const line = lines[index];
          // Cheap prefilter: most bytes are tool results.
          if (!line.includes('"role":"user"') && !line.includes('"assistant"'))
            continue;
          const message = messageText(line);
          if (message) rows.push(message);
        }
        this.db.transaction(() => {
          for (const r of rows)
            insert.run(r.text, session, r.entry, r.role, r.timestamp);
        })();
        if (index < lines.length) await pause();
      }
      const offset = from + end;
      const tail = Buffer.alloc(Math.min(TAIL, offset));
      if (tail.length)
        await handle.read(tail, 0, tail.length, offset - tail.length);
      this.saveFile(path, session, cwd, info, offset, tail);
      this.cwds.set(session, cwd);
    } finally {
      await handle.close();
    }
    await pause();
  }

  private saveFile(
    path: string,
    session: string,
    cwd: string,
    info: { size: number; mtimeMs: number },
    offset: number,
    tail: Buffer,
  ) {
    // A file whose last line is incomplete keeps its size unrecorded so the
    // completed line is read on the next refresh.
    this.db
      .query(
        "INSERT OR REPLACE INTO files(path, session, cwd, size, mtime, offset, tail) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        path,
        session,
        cwd,
        offset === info.size ? info.size : -1,
        info.mtimeMs,
        offset,
        tail,
      );
  }

  /** All terms must occur (case-insensitive substring); newest first. */
  search(query: string, limit = 50): ConversationHit[] {
    const terms = searchTerms(query);
    if (!terms.some((term) => term.length >= 2)) return [];
    const patterns = Array.from({ length: MAX_TERMS }, (_, i) =>
      terms[i] === undefined ? "%" : `%${terms[i].replace(/[\\%_]/g, "\\$&")}%`,
    );
    const rows = this.db.query(SEARCH_SQL).all(...patterns, limit) as {
      text: string;
      session: string;
      entry: string;
      role: "user" | "assistant";
      ts: number;
    }[];
    return rows.flatMap((row) => {
      const cwd = this.cwds.get(row.session);
      return cwd
        ? [
            {
              sessionId: row.session,
              cwd,
              entryId: row.entry,
              role: row.role,
              timestamp: row.ts,
              snippet: snippet(row.text, terms),
            },
          ]
        : [];
    });
  }

  close() {
    this.db.close();
  }
}
