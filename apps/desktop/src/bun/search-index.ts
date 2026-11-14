import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, type Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { searchTerms } from "../shared/fuzzy";
import type { ConversationHit } from "../shared/rpc-schema";
import {
  INDEX_READ_BYTES,
  INDEX_SLICE_MS,
  IndexSourceChanged,
  type JsonlLine,
  readIndexLines,
  yieldIndexing,
} from "./search-jsonl";
import {
  conversationSearchQuery,
  SEARCH_VOCAB_SQL,
  searchCandidate,
  selectiveSearchCandidate,
} from "./search-query";
import { sameSessionPath } from "./session-files";

/** One session directory and the registered workspaces whose chats live there. */
export interface SearchRoot {
  dir: string;
  cwds: string[];
}

const VERSION = 1;
/** Committed progress whose captured source has not yet been validated. */
const UNVERIFIED = -2;
const userMarker = Buffer.from('"role":"user"');
const assistantMarker = Buffer.from('"assistant"');
// Some filesystems expose ctime as birthtime; it must not invalidate every
// ordinary append. An open inode cannot be reused until its handle closes.
const sourceIdentity = (info: Stats) =>
  `${info.dev}:${info.ino}${info.ino === 0 ? `:${info.birthtimeMs}` : ""}`;
type Scan = { generation: number; forgotten: Set<string> };
type IndexedFile = {
  session: string;
  cwd: string;
  size: number;
  mtime: number;
  offset: number;
  tail: Uint8Array;
  identity: string | null;
  source_size: number | null;
  source_ctime: number | null;
};

export { defaultSessionDir } from "./session-directory";

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
  } catch {
    return undefined;
  }
}

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
  private messageCount = 0;
  private generation = 0;
  private forgotten?: Set<string>;
  private closed = false;

  constructor(
    file: string,
    private readonly yieldControl = yieldIndexing,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    const { user_version } = this.db.query("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (user_version !== VERSION)
      this.db.exec(`DROP TABLE IF EXISTS file_identity; DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS messages;
        CREATE TABLE files(path TEXT PRIMARY KEY, session TEXT NOT NULL,
          cwd TEXT NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL,
          offset INTEGER NOT NULL, tail BLOB NOT NULL);
        CREATE VIRTUAL TABLE messages USING fts5(text, session UNINDEXED,
          entry UNINDEXED, role UNINDEXED, ts UNINDEXED, tokenize = 'trigram');
        PRAGMA user_version = ${VERSION};`);
    // Optional source metadata: legacy version-1 rows remain usable without a rebuild.
    this.db.exec(`CREATE TABLE IF NOT EXISTS file_identity(path TEXT PRIMARY KEY,
      identity TEXT NOT NULL, source_size INTEGER NOT NULL, source_ctime REAL NOT NULL)`);
    this.db.exec(SEARCH_VOCAB_SQL);
    // FTS5's existing one-row-per-document metadata supports a cheap count,
    // without scanning/tokenizing message text. This is only a planning hint.
    this.messageCount = (
      this.db.query("SELECT count(*) AS count FROM messages_docsize").get() as {
        count: number;
      }
    ).count;
    this.loadCwds();
  }

  get indexing() {
    return !!this.running;
  }

  private loadCwds() {
    this.cwds = new Map(
      (
        this.db
          .query(
            `SELECT session, cwd FROM files WHERE session != '' AND size != ${UNVERIFIED}`,
          )
          .all() as { session: string; cwd: string }[]
      ).map((row) => [row.session, row.cwd]),
    );
  }

  /** Coalesces overlapping refreshes into one follow-up run with the latest roots. */
  refresh(roots: () => SearchRoot[] | Promise<SearchRoot[]>): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Search index is closed"));
    this.generation++;
    this.queued = roots;
    if (this.running) return this.running;
    const forgotten = new Set<string>();
    this.forgotten = forgotten;
    const run = (async () => {
      try {
        while (this.queued) {
          const next = this.queued;
          this.queued = undefined;
          const generation = this.generation;
          let roots: SearchRoot[];
          try {
            roots = await Promise.resolve().then(next);
          } catch (error) {
            if (this.closed) return;
            if (generation !== this.generation && this.queued) continue;
            throw error;
          }
          if (generation !== this.generation || this.closed) continue;
          await this.sync(roots, { generation, forgotten });
        }
      } finally {
        if (this.forgotten === forgotten) this.forgotten = undefined;
        this.running = undefined;
      }
    })();
    this.running = run;
    return run;
  }

  forget(sessionId: string) {
    this.forgotten?.add(sessionId);
    const removed = this.db.transaction(() => {
      const result = this.db
        .query("DELETE FROM messages WHERE session = ?")
        .run(sessionId);
      this.db
        .query(
          "DELETE FROM file_identity WHERE path IN (SELECT path FROM files WHERE session = ?)",
        )
        .run(sessionId);
      this.db.query("DELETE FROM files WHERE session = ?").run(sessionId);
      return Number(result.changes);
    })();
    this.messageCount = Math.max(0, this.messageCount - removed);
    this.cwds.delete(sessionId);
  }

  private forgetFile(path: string) {
    const row = this.db
      .query("SELECT session FROM files WHERE path = ?")
      .get(path) as { session: string } | null;
    const removed = this.db.transaction(() => {
      const count = row?.session
        ? Number(
            this.db
              .query("DELETE FROM messages WHERE session = ?")
              .run(row.session).changes,
          )
        : 0;
      this.db.query("DELETE FROM files WHERE path = ?").run(path);
      this.db.query("DELETE FROM file_identity WHERE path = ?").run(path);
      return count;
    })();
    this.messageCount = Math.max(0, this.messageCount - removed);
  }

  private current(scan: Scan) {
    return !this.closed && scan.generation === this.generation;
  }

  private async sync(roots: SearchRoot[], scan: Scan) {
    const seen = new Set<string>();
    for (const root of roots) {
      let names: string[];
      try {
        names = await readdir(root.dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!this.current(scan)) return;
        if (!name.endsWith(".jsonl")) continue;
        const path = join(root.dir, name);
        seen.add(path);
        try {
          // One retry for a replaced/rewritten source; never spin on an active writer.
          if (
            (await this.indexFile(path, root.cwds, scan)) === false &&
            this.current(scan)
          )
            await this.indexFile(path, root.cwds, scan);
        } catch (error) {
          if (this.current(scan)) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              this.forgetFile(path);
            else console.warn("Cannot index chat %s:", path, error);
          }
        }
      }
    }
    if (!this.current(scan)) return;
    const known = this.db.query("SELECT path FROM files").all() as {
      path: string;
    }[];
    for (const { path } of known) if (!seen.has(path)) this.forgetFile(path);
    this.loadCwds();
  }

  private async indexFile(path: string, cwds: string[], scan: Scan) {
    const before = await stat(path);
    if (!this.current(scan)) return;
    const row = this.db
      .query(`SELECT files.*, identity, source_size, source_ctime
      FROM files LEFT JOIN file_identity USING(path) WHERE path = ?`)
      .get(path) as IndexedFile | null;
    if (
      row?.session &&
      cwds.some((c) => sameSessionPath(row.cwd, c)) &&
      row.size === before.size &&
      row.mtime === before.mtimeMs &&
      (!row.identity ||
        (row.identity === sourceIdentity(before) &&
          row.source_ctime === before.ctimeMs))
    ) {
      if (!row.identity) this.saveIdentity(path, before);
      return;
    }
    const handle = await open(path, "r");
    let session = row?.session ?? "";
    let snapshot: Stats | undefined;
    const current = () => this.current(scan) && !scan.forgotten.has(session);
    try {
      const info = await handle.stat();
      snapshot = info;
      if (!current()) return;
      const validate = async () => {
        const descriptor = await handle.stat();
        let visible: Stats;
        try {
          visible = await stat(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            throw new IndexSourceChanged("Index source deleted");
          throw error;
        }
        if (!current()) return descriptor;
        if (
          sourceIdentity(visible) !== sourceIdentity(info) ||
          sourceIdentity(descriptor) !== sourceIdentity(info) ||
          descriptor.size < info.size ||
          visible.size < info.size ||
          (descriptor.size === info.size &&
            (descriptor.mtimeMs !== info.mtimeMs ||
              descriptor.ctimeMs !== info.ctimeMs))
        )
          throw new IndexSourceChanged("Index source replaced or rewritten");
        return descriptor;
      };
      let first: JsonlLine | undefined;
      for await (const line of readIndexLines(handle, 0, info.size, {
        chunkBytes: 4096,
        current,
        yieldControl: this.yieldControl,
      })) {
        if (line.text.trim()) {
          first = line;
          break;
        }
      }
      if (!current()) return;
      if (!first) {
        // A rewritten/truncated header must not leave the previous generation
        // searchable while its replacement is still being written.
        if (row) {
          this.forgetFile(path);
          this.cwds.delete(row.session);
        }
        return;
      }
      const head = header(first.text),
        owner = head && cwds.find((c) => sameSessionPath(head.cwd, c));
      await validate();
      if (!current()) return;
      if (!head || !owner) {
        if (row) this.forgetFile(path);
        this.db.transaction(() =>
          this.saveFile(path, "", "", info, info.size, Buffer.alloc(0), true),
        )();
        return;
      }
      session = head.id;
      if (!current()) return;
      let from = first.end,
        tail = first.tail;
      const sameSource =
        row && (!row.identity || row.identity === sourceIdentity(info));
      const unchangedSize =
        (row?.source_size ??
          (row && row.size >= 0 ? row.size : row?.offset)) === info.size;
      const unverifiedChanged =
        row?.size === UNVERIFIED &&
        (row.source_size !== info.size ||
          row.mtime !== info.mtimeMs ||
          row.source_ctime !== info.ctimeMs ||
          !sameSource);
      const rewritten =
        unchangedSize &&
        row &&
        (row.mtime !== info.mtimeMs ||
          (row.source_ctime !== null && row.source_ctime !== info.ctimeMs));
      if (
        row?.session === session &&
        sameSessionPath(row.cwd, owner) &&
        sameSource &&
        !unverifiedChanged &&
        !rewritten &&
        row.offset >= first.end &&
        row.offset <= info.size &&
        row.offset >= row.tail.length
      ) {
        const expected = Buffer.from(row.tail),
          actual = Buffer.alloc(expected.length);
        let read = 0;
        while (read < actual.length) {
          const result = await handle.read(
            actual,
            read,
            actual.length - read,
            row.offset - actual.length + read,
          );
          if (!result.bytesRead)
            throw new IndexSourceChanged("Index checkpoint was truncated");
          read += result.bytesRead;
        }
        if (actual.equals(expected)) {
          from = row.offset;
          tail = actual;
        }
      }
      if (!current()) return;
      if (from === first.end) {
        if (row) this.forgetFile(path);
        this.db.transaction(() =>
          this.saveFile(path, session, owner, info, from, tail),
        )();
      }
      const originalTail = tail;
      const digest = createHash("sha256");
      const insert = this.db.query(
        "INSERT INTO messages(text, session, entry, role, ts) VALUES (?, ?, ?, ?, ?)",
      );
      type Action = Pick<JsonlLine, "end" | "tail"> & {
        message?: ReturnType<typeof messageText>;
      };
      let pending: Action[] = [],
        bytes = 0,
        started = performance.now(),
        offset = from;
      const flush = async () => {
        let next = 0;
        const hasMessages = pending.some((action) => action.message);
        while (next < pending.length && current()) {
          // Tool-only progress is unverified metadata, not searchable new text.
          // Validate before inserting messages and again before final publication.
          if (hasMessages) await validate();
          if (!current()) return;
          let inserted = 0;
          this.db.transaction(() => {
            const started = performance.now();
            do {
              const action = pending[next++],
                message = action.message;
              if (message) {
                insert.run(
                  message.text,
                  session,
                  message.entry,
                  message.role,
                  message.timestamp,
                );
                inserted++;
              }
              offset = action.end;
              tail = action.tail;
            } while (
              next < pending.length &&
              performance.now() - started < INDEX_SLICE_MS
            );
            // Rows and the exact byte checkpoint are committed together. A later
            // I/O failure/cancellation cannot replay already committed entries.
            this.saveFile(path, session, owner, info, offset, tail);
          })();
          this.messageCount += inserted;
          await this.yieldControl();
        }
        pending = [];
        bytes = 0;
        started = performance.now();
      };
      for await (const line of readIndexLines(handle, from, info.size, {
        tail,
        current,
        yieldControl: async () => {
          // A flush may already have yielded while the generator was suspended.
          if (performance.now() - started >= INDEX_SLICE_MS) {
            await this.yieldControl();
            started = performance.now();
          }
        },
        onRead: (chunk) => digest.update(chunk),
        shouldDecode: (line) =>
          line.includes(userMarker) || line.includes(assistantMarker),
      })) {
        // Preserve the existing cheap prefilter and text extraction semantics.
        const message = line.text ? messageText(line.text) : undefined;
        // Ignored tool output must not fill a batch or retain its raw JSON.
        // Coalesce its checkpoint while budgeting only normalized indexed text.
        const action = { end: line.end, tail: line.tail, message };
        if (!message && pending.length && !pending.at(-1)?.message)
          pending[pending.length - 1] = action;
        else pending.push(action);
        bytes += (message?.text.length ?? 0) * 2;
        if (
          pending.length >= 128 ||
          bytes >= 256 * 1024 ||
          performance.now() - started >= INDEX_SLICE_MS
        )
          await flush();
        if (!current()) return;
      }
      await flush();
      if (!current()) return;
      const after = await validate();
      if (!current()) return;
      if (
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs ||
        after.ctimeMs !== info.ctimeMs
      ) {
        // Appends are allowed, but a growing rewrite must not mix generations.
        // Recheck only the range consumed by this run, in bounded byte chunks.
        const verification = createHash("sha256"),
          buffer = Buffer.alloc(
            Math.min(INDEX_READ_BYTES, Math.max(1, info.size - from)),
          );
        let position = from,
          budget = performance.now();
        while (position < info.size && current()) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, info.size - position),
            position,
          );
          if (!current()) return;
          if (!bytesRead)
            throw new IndexSourceChanged(
              "Index source truncated during verification",
            );
          verification.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
          if (performance.now() - budget >= INDEX_SLICE_MS) {
            await this.yieldControl();
            budget = performance.now();
          }
        }
        if (!current()) return;
        const checkpoint = Buffer.alloc(originalTail.length);
        let checked = 0;
        while (checked < checkpoint.length) {
          const result = await handle.read(
            checkpoint,
            checked,
            checkpoint.length - checked,
            from - checkpoint.length + checked,
          );
          if (!result.bytesRead)
            throw new IndexSourceChanged(
              "Index checkpoint ended during verification",
            );
          checked += result.bytesRead;
        }
        if (
          !checkpoint.equals(originalTail) ||
          digest.digest("hex") !== verification.digest("hex")
        )
          throw new IndexSourceChanged(
            "Index source changed inside the captured range",
          );
        let verifiedHeader: JsonlLine | undefined;
        for await (const line of readIndexLines(handle, 0, info.size, {
          chunkBytes: 4096,
          current,
          yieldControl: this.yieldControl,
        })) {
          if (line.text.trim()) {
            verifiedHeader = line;
            break;
          }
        }
        if (!current()) return;
        if (
          !verifiedHeader ||
          verifiedHeader.text !== first.text ||
          verifiedHeader.end !== first.end
        )
          throw new IndexSourceChanged("Index source header changed");
        await validate();
      }
      if (!current()) return;
      this.db.transaction(() =>
        this.saveFile(path, session, owner, info, offset, tail, true),
      )();
      this.cwds.set(session, owner);
    } catch (error) {
      if (error instanceof IndexSourceChanged) {
        if (current()) {
          this.forgetFile(path);
          this.cwds.delete(session);
          return false;
        }
        return;
      }
      if (current()) {
        // A failed run may keep a checkpoint only if the captured source is
        // still unchanged. Otherwise an interrupted growing rewrite could
        // make a mixed prefix look like a valid append on the next refresh.
        let unchanged = false;
        const captured = snapshot;
        if (captured) {
          try {
            const descriptor = await handle.stat(),
              visible = await stat(path);
            unchanged = [descriptor, visible].every(
              (info) =>
                sourceIdentity(info) === sourceIdentity(captured) &&
                info.size === captured.size &&
                info.mtimeMs === captured.mtimeMs &&
                info.ctimeMs === captured.ctimeMs,
            );
          } catch {
            // Unable to validate: discard unverified progress below.
            unchanged = false;
          }
        }
        if (!current()) return;
        if (!unchanged) {
          this.forgetFile(path);
          this.cwds.delete(session);
        } else if (captured) {
          this.db
            .query(
              "UPDATE files SET size=CASE WHEN offset=? THEN ? ELSE -1 END WHERE path=? AND size=?",
            )
            .run(captured.size, captured.size, path, UNVERIFIED);
        }
        throw error;
      }
    } finally {
      await handle.close();
    }
  }

  private saveIdentity(path: string, info: Stats) {
    this.db
      .query("INSERT OR REPLACE INTO file_identity VALUES (?, ?, ?, ?)")
      .run(path, sourceIdentity(info), info.size, info.ctimeMs);
  }

  private saveFile(
    path: string,
    session: string,
    cwd: string,
    info: Stats,
    offset: number,
    tail: Buffer,
    verified = false,
  ) {
    this.saveIdentity(path, info);
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
        verified ? (offset === info.size ? info.size : -1) : UNVERIFIED,
        info.mtimeMs,
        offset,
        tail,
      );
  }

  /** All terms must occur (case-insensitive substring); newest first. */
  search(query: string, limit = 50): ConversationHit[] {
    const terms = searchTerms(query);
    if (!terms.some((term) => term.length >= 2)) return [];
    const candidate = selectiveSearchCandidate(
      this.db,
      searchCandidate(terms),
      this.messageCount,
    );
    const { sql, parameters } = conversationSearchQuery(
      terms,
      limit,
      candidate ?? null,
    );
    const rows = this.db.query(sql).all(...parameters) as {
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
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    this.queued = undefined;
    this.db.close();
  }
}
