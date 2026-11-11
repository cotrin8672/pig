import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  DraftContent,
  DraftOwner,
  DraftState,
  RecoveredDraft,
  SendIntent,
  SendKey,
  SessionAddress,
} from "../shared/runtime-contract";
import { validateDraftContent } from "./composer-bridge";
import { sessionKey } from "./ui-request-broker";

type IntentRow = { hash: string; metadata: string; content: string | null };
const key = (r: SendKey) =>
  JSON.stringify([r.hostId, r.sessionId, r.epoch, r.requestId]);
const session = (id: string, cwd: string) => JSON.stringify([id, cwd]);
const addressOf = (a: SessionAddress) => ({
  hostId: a.hostId,
  sessionId: a.sessionId,
  epoch: a.epoch,
});

/** SQLite serializes writers across processes; every ACK commits only the affected owner. */
export class SendRecoveryStore {
  private db?: Database;
  error?: string;
  constructor(file: string) {
    let opened: Database | undefined;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const db = new Database(file, { create: true, strict: true });
      opened = db;
      const version = db.query("PRAGMA user_version").get() as {
        user_version: number;
      };
      if (version.user_version > 1)
        throw new Error("Unsupported send recovery database version");
      db.exec(
        "PRAGMA busy_timeout = 1000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;",
      );
      db.exec(`CREATE TABLE IF NOT EXISTS drafts (owner TEXT PRIMARY KEY, session TEXT NOT NULL, revision INTEGER NOT NULL, metadata TEXT NOT NULL, content TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS drafts_session ON drafts(session);
        CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, session TEXT NOT NULL, host TEXT NOT NULL, hash TEXT NOT NULL, terminal INTEGER NOT NULL, metadata TEXT NOT NULL, content TEXT);
        CREATE INDEX IF NOT EXISTS intents_session ON intents(session, terminal);
        CREATE TABLE IF NOT EXISTS deleted (session TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS discarded (owner TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS images (hash TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS image_refs (object TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(object, hash));
        CREATE INDEX IF NOT EXISTS image_refs_hash ON image_refs(hash);
        CREATE INDEX IF NOT EXISTS drafts_cwd ON drafts(json_extract(metadata, '$.owner.cwd'));
        CREATE INDEX IF NOT EXISTS intents_cwd ON intents(json_extract(metadata, '$.owner.cwd'));
        PRAGMA user_version = 1;`);
      this.db = db;
    } catch (error) {
      opened?.close();
      this.error = `Cannot open send recovery storage; existing data preserved: ${String(error)}`;
    }
  }
  private write<T>(fn: (db: Database) => T): T {
    if (!this.db)
      throw new Error(this.error ?? "Send recovery storage is closed");
    try {
      const result = this.db
        .transaction(() => {
          const result = fn(this.db as Database);
          this.db?.exec(
            "DELETE FROM images WHERE NOT EXISTS (SELECT 1 FROM image_refs WHERE image_refs.hash = images.hash)",
          );
          return result;
        })
        .immediate();
      this.error = undefined;
      return result;
    } catch (error) {
      this.error = `Cannot save send recovery data: ${String(error)}`;
      throw new Error(this.error);
    }
  }
  private alive(db: Database, id: string) {
    if (db.query("SELECT 1 FROM deleted WHERE session = ?").get(id))
      throw new Error("Recovery data belongs to a deleted session");
  }
  private pack(db: Database, object: string, content: DraftContent) {
    db.query("DELETE FROM image_refs WHERE object = ?").run(object);
    const images = content.images.map(({ id, image }) => {
      const hash = createHash("sha256")
        .update(image.mimeType)
        .update("\0")
        .update(image.data)
        .digest("hex");
      if (!db.query("SELECT 1 FROM images WHERE hash = ?").get(hash))
        db.query("INSERT INTO images VALUES (?, ?, ?)").run(
          hash,
          image.mimeType,
          image.data,
        );
      db.query("INSERT OR IGNORE INTO image_refs VALUES (?, ?)").run(
        object,
        hash,
      );
      return { id, hash };
    });
    return JSON.stringify({
      text: content.text,
      pastes: content.pastes,
      images,
    });
  }
  private unpack(data: string): DraftContent {
    const content = JSON.parse(data);
    content.images = content.images.map(
      ({ id, hash }: { id: string; hash: string }) => {
        const image = this.db
          ?.query("SELECT mime, data FROM images WHERE hash = ?")
          .get(hash) as { mime: string; data: string } | null;
        if (!image)
          throw new Error("Recovery image is missing; existing data preserved");
        return {
          id,
          image: { type: "image", mimeType: image.mime, data: image.data },
        };
      },
    );
    validateDraftContent(content);
    return content;
  }
  private putDraft(
    db: Database,
    address: SessionAddress,
    draft: DraftState,
    owner: DraftOwner,
    keepImages = false,
  ) {
    this.alive(db, session(address.sessionId, owner.cwd));
    if (
      db
        .query("SELECT 1 FROM discarded WHERE owner = ?")
        .get(sessionKey(address))
    )
      throw new Error("This retained draft was discarded");
    const previous = db
      .query("SELECT revision, content FROM drafts WHERE owner = ?")
      .get(sessionKey(address)) as { revision: number; content: string } | null;
    if (previous && previous.revision >= draft.revision)
      throw new Error("Stale durable draft revision");
    if (keepImages && (!previous || previous.revision !== draft.revision - 1))
      throw new Error("Cannot reuse images from a different durable revision");
    const packed =
      keepImages && previous
        ? JSON.stringify({
            text: draft.text,
            pastes: draft.pastes,
            images: JSON.parse(previous.content).images,
          })
        : this.pack(db, `draft:${sessionKey(address)}`, draft);
    const result = db
      .query(`INSERT INTO drafts VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision, metadata=excluded.metadata, content=excluded.content
      WHERE drafts.revision < excluded.revision`)
      .run(
        sessionKey(address),
        session(address.sessionId, owner.cwd),
        draft.revision,
        JSON.stringify({
          address: addressOf(address),
          owner,
          consumedRevision: draft.consumedRevision,
        }),
        packed,
      );
    if (!result.changes) throw new Error("Stale durable draft revision");
  }
  draft(
    address: SessionAddress,
    draft: DraftState,
    owner: DraftOwner,
    previous?: SessionAddress,
    keepImages = false,
  ) {
    this.write((db) => {
      this.putDraft(db, address, draft, owner, keepImages);
      if (previous) {
        db.query("DELETE FROM drafts WHERE owner = ?").run(
          sessionKey(previous),
        );
        db.query("DELETE FROM image_refs WHERE object = ?").run(
          `draft:${sessionKey(previous)}`,
        );
      }
    });
  }
  intent(intent: SendIntent, consumed?: RecoveredDraft) {
    this.write((db) => {
      const r = intent.receipt,
        id = session(r.sessionId, intent.owner.cwd);
      this.alive(db, id);
      const prior = db
        .query("SELECT hash, content FROM intents WHERE id = ?")
        .get(key(r)) as { hash: string; content: string | null } | null;
      if (prior && prior.hash !== intent.hash)
        throw new Error("REQUEST_ID_CONFLICT");
      const { content: original, ...metadata } = intent;
      const discarded = !!db
        .query("SELECT 1 FROM discarded WHERE owner = ?")
        .get(sessionKey(r));
      const terminal =
        r.state === "rejected" ||
        (r.state === "accepted" &&
          (r.accepted.disposition !== "queued" || !original));
      const content = terminal || discarded ? undefined : original;
      if (!content)
        db.query("DELETE FROM image_refs WHERE object = ?").run(
          `intent:${key(r)}`,
        );
      const packed = content
        ? (prior?.content ?? this.pack(db, `intent:${key(r)}`, content))
        : null;
      db.query(
        "INSERT INTO intents VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET terminal=excluded.terminal, metadata=excluded.metadata, content=excluded.content",
      ).run(
        key(r),
        id,
        r.hostId,
        intent.hash,
        terminal ? 1 : 0,
        JSON.stringify(metadata),
        packed,
      );
      if (consumed)
        this.putDraft(db, consumed.address, consumed.draft, consumed.owner);
      // Live hosts retain all hashes in memory. Retired host IDs cannot mutate a new host.
      if (terminal)
        db.query(
          "DELETE FROM intents WHERE session = ? AND terminal = 1 AND id <> ?",
        ).run(id, key(r));
    });
  }
  lookup(input: SendKey, withContent = false): SendIntent | undefined {
    if (!this.db) return;
    const row = this.db
      .query(
        withContent
          ? "SELECT hash, metadata, content FROM intents WHERE id = ?"
          : "SELECT hash, metadata, NULL AS content FROM intents WHERE id = ?",
      )
      .get(key(input)) as IntentRow | null;
    if (!row) return;
    const intent = this.decode(row, input.hostId);
    if (key(intent.receipt) !== key(input))
      throw new Error("Invalid saved send identity");
    return intent;
  }
  private decode(row: IntentRow, hostId: string): SendIntent {
    const intent = JSON.parse(row.metadata) as SendIntent;
    if (intent.hash !== row.hash)
      throw new Error("Invalid saved send identity");
    if (row.content !== null) intent.content = this.unpack(row.content);
    if (intent.receipt.hostId !== hostId && intent.receipt.state === "pending")
      intent.receipt = {
        ...intent.receipt,
        state: "unknown",
        reason: "host-restarted",
      };
    return intent;
  }
  snapshot(owners: DraftOwner[], hostId: string) {
    const drafts: RecoveredDraft[] = [],
      intents: SendIntent[] = [];
    if (!this.db) return { drafts, intents };
    for (const cwd of new Set(owners.map((owner) => owner.cwd))) {
      for (const row of this.db
        .query(
          "SELECT metadata, content, revision FROM drafts WHERE json_extract(metadata, '$.owner.cwd') = ?",
        )
        .all(cwd) as {
        metadata: string;
        content: string;
        revision: number;
      }[]) {
        const item = JSON.parse(row.metadata) as RecoveredDraft & {
          consumedRevision?: number;
        };
        const content = this.unpack(row.content);
        drafts.push({
          address: item.address,
          owner: item.owner,
          draft: {
            ...content,
            revision: row.revision,
            consumedRevision: item.consumedRevision,
          },
        });
      }
      for (const row of this.db
        .query(
          "SELECT hash, metadata, content FROM intents WHERE json_extract(metadata, '$.owner.cwd') = ?",
        )
        .all(cwd) as IntentRow[]) {
        const intent = this.decode(row, hostId);
        intents.push(intent);
      }
    }
    return { drafts, intents };
  }
  discard(address: SessionAddress, cwd: string) {
    this.write((db) => {
      const row = db
        .query("SELECT metadata FROM drafts WHERE owner = ?")
        .get(sessionKey(address)) as { metadata: string } | null;
      if (
        !row ||
        (JSON.parse(row.metadata) as RecoveredDraft).owner.cwd !== cwd
      )
        throw new Error("Retained draft owner mismatch");
      db.query("INSERT OR IGNORE INTO discarded VALUES (?)").run(
        sessionKey(address),
      );
      db.query("DELETE FROM drafts WHERE owner = ?").run(sessionKey(address));
      db.query("DELETE FROM image_refs WHERE object = ?").run(
        `draft:${sessionKey(address)}`,
      );
      for (const row of db
        .query("SELECT id, metadata FROM intents WHERE session = ?")
        .all(session(address.sessionId, cwd)) as {
        id: string;
        metadata: string;
      }[])
        if (
          sessionKey((JSON.parse(row.metadata) as SendIntent).receipt) ===
          sessionKey(address)
        ) {
          db.query("UPDATE intents SET content = NULL WHERE id = ?").run(
            row.id,
          );
          db.query("DELETE FROM image_refs WHERE object = ?").run(
            `intent:${row.id}`,
          );
        }
    });
  }
  deleteSession(sessionId: string, cwd: string) {
    return this.write((db) => {
      const id = session(sessionId, cwd);
      const addresses = new Map<string, SessionAddress>();
      for (const row of db
        .query("SELECT metadata FROM drafts WHERE session = ?")
        .all(id) as { metadata: string }[]) {
        const address = (JSON.parse(row.metadata) as RecoveredDraft).address;
        addresses.set(sessionKey(address), address);
      }
      for (const row of db
        .query("SELECT metadata FROM intents WHERE session = ?")
        .all(id) as { metadata: string }[]) {
        const address = addressOf(
          (JSON.parse(row.metadata) as SendIntent).receipt,
        );
        addresses.set(sessionKey(address), address);
      }
      db.query("INSERT OR IGNORE INTO deleted VALUES (?)").run(id);
      for (const row of db
        .query("SELECT owner FROM drafts WHERE session = ?")
        .all(id) as { owner: string }[])
        db.query("DELETE FROM image_refs WHERE object = ?").run(
          `draft:${row.owner}`,
        );
      for (const row of db
        .query("SELECT id FROM intents WHERE session = ?")
        .all(id) as { id: string }[])
        db.query("DELETE FROM image_refs WHERE object = ?").run(
          `intent:${row.id}`,
        );
      db.query("DELETE FROM drafts WHERE session = ?").run(id);
      db.query("DELETE FROM intents WHERE session = ?").run(id);
      return [...addresses.values()];
    });
  }
  close() {
    this.db?.close();
    this.db = undefined;
  }
}
export const sendRecoveryStore = (file: string) => new SendRecoveryStore(file);
