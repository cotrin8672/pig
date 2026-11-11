import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "./sdk";
import { SDKProjector } from "./sdk-projector";
import { SessionDiagnosticStore } from "./session-diagnostics";

test("a future recovery schema remains untouched when diagnostics are opened", () =>
  fixture(async (manager, _file, store, dbFile) => {
    new SDKProjector(manager, 1, store).fail("original row");
    const original = store.read(manager)?.metadata;
    const db = new Database(dbFile);
    db.exec("PRAGMA user_version = 2");
    const future = new SessionDiagnosticStore(dbFile);
    const projector = new SDKProjector(manager, 2, future);
    projector.fail("must not overwrite future schema");
    expect(projector.failure).toContain(
      "Unsupported recovery database version",
    );
    expect(store.read(manager)?.metadata).toBe(original);
    future.close();
    db.close();
  }));

async function fixture(
  run: (
    manager: ReturnType<typeof SessionManager.create>,
    file: string,
    store: SessionDiagnosticStore,
    dbFile: string,
  ) => Promise<void>,
) {
  const home = await mkdtemp(join(tmpdir(), "pig-diagnostics-"));
  const dbFile = join(home, "send-recovery.sqlite");
  const store = new SessionDiagnosticStore(dbFile);
  try {
    const manager = SessionManager.create(home, home);
    manager.appendMessage({ role: "user", content: "initial", timestamp: 1 });
    manager.appendMessage(fauxAssistantMessage("saved answer"));
    const file = manager.getSessionFile();
    if (!file) throw new Error("Missing fixture session file");
    await run(manager, file, store, dbFile);
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
}

test("non-message failure, abort and an interrupted run restore from disk without resuming execution", () =>
  fixture(async (manager, file, store) => {
    const projector = new SDKProjector(manager, 1, store);
    projector.event({ type: "agent_start" });
    projector.event({
      type: "compaction_end",
      reason: "manual",
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: "compaction failed fixture",
    });
    projector.event({ type: "agent_settled", aborted: false });
    expect(new SDKProjector(SessionManager.open(file), 2, store).failure).toBe(
      "compaction failed fixture",
    );
    projector.event({ type: "agent_start" });
    projector.event({ type: "agent_settled", aborted: true });
    const aborted = new SDKProjector(SessionManager.open(file), 3, store);
    expect(aborted.aborted).toBe(true);
    expect(aborted.failure).toBeUndefined();
    projector.event({ type: "agent_start" });
    manager.appendMessage({ role: "user", content: "in-flight", timestamp: 2 });
    const interrupted = new SDKProjector(SessionManager.open(file), 4, store);
    expect(interrupted.failure).toContain("execution status is unknown");
    expect(interrupted.snapshot().running).toBe(false);
    projector.stopUnconfirmed("Stop unconfirmed fixture");
    expect(new SDKProjector(SessionManager.open(file), 5, store).failure).toBe(
      "Stop unconfirmed fixture",
    );
    const root = manager.getBranch()[0].id;
    manager.branch(root);
    manager.appendMessage(fauxAssistantMessage("another branch"));
    const branch = new SDKProjector(SessionManager.open(file), 6, store);
    expect(branch.failure).toBeUndefined();
    expect(branch.aborted).toBe(false);
  }));

test("corrupt or foreign metadata is preserved through subsequent run events", () =>
  fixture(async (manager, _file, store, dbFile) => {
    const db = new Database(dbFile);
    const owner = JSON.stringify([
      manager.getSessionId(),
      manager.getCwd(),
      manager.getSessionFile(),
    ]);
    for (const original of [
      "{broken bytes",
      JSON.stringify({
        version: 1,
        sessionId: "another-session",
        cwd: manager.getCwd(),
        recovered: [],
      }),
    ]) {
      db.query("INSERT OR REPLACE INTO run_diagnostics VALUES (?, ?, ?)").run(
        owner,
        1,
        original,
      );
      const projector = new SDKProjector(manager, 1, store);
      expect(projector.failure).toContain("metadata unavailable");
      projector.event({ type: "agent_start" });
      projector.fail("new failure");
      expect(store.read(manager)?.metadata).toBe(original);
    }
    db.close();
  }));

test("competing writers and failed commits cannot replace the last committed metadata", () =>
  fixture(async (manager, _file, store, dbFile) => {
    const first = new SDKProjector(manager, 1, store);
    const stale = new SDKProjector(manager, 2, store);
    first.fail("first committed failure");
    const original = store.read(manager)?.metadata;
    stale.fail("stale writer");
    expect(stale.failure).toContain("another writer");
    expect(store.read(manager)?.metadata).toBe(original);
    const locked = new SDKProjector(manager, 3, store);
    const writer = new Database(dbFile);
    writer.exec("BEGIN IMMEDIATE");
    locked.fail("lock failure");
    expect(locked.failure).toContain("metadata unavailable");
    expect(store.read(manager)?.metadata).toBe(original);
    writer.exec("ROLLBACK");
    writer.close();
    locked.fail("retry after writer release");
    expect(new SDKProjector(manager, 4, store).failure).toBe(
      "retry after writer release",
    );
  }));

test("cancelled queue metadata stores send references and restores full payload only from its matching owner", () =>
  fixture(async (manager, file, store) => {
    const key = {
      hostId: "old-host",
      sessionId: manager.getSessionId(),
      epoch: 1,
      requestId: "queued-image",
    };
    const image = {
      type: "image" as const,
      data: "unique-payload-bytes",
      mimeType: "image/png",
    };
    const secondImage = { ...image, data: "second-image-bytes" };
    const projector = new SDKProjector(manager, 1, store);
    projector.recoverQueue([
      {
        key,
        message: {
          role: "user",
          timestamp: 2,
          content: [{ type: "text", text: "queued original" }, image],
        },
      },
    ]);
    const saved = store.read(manager)?.metadata ?? "";
    expect(saved).toContain("queued-image");
    expect(saved).not.toContain("unique-payload-bytes");
    expect(saved).not.toContain("queued original");
    const intent = {
      receipt: {
        ...key,
        state: "accepted" as const,
        accepted: { disposition: "queued" as const },
        acceptedAt: 1,
      },
      draftRevision: 0,
      hash: "a".repeat(64),
      owner: {
        cwd: manager.getCwd(),
        sessionFile: file,
        branchId: manager.getLeafId(),
      },
      content: {
        text: "  before [paste #1 9 chars] after  ",
        pastes: [
          { id: "paste", marker: "[paste #1 9 chars]", text: "body\nbytes" },
        ],
        images: [
          { id: "image", image },
          { id: "second", image: secondImage },
        ],
      },
    };
    const restored = new SDKProjector(SessionManager.open(file), 2, store);
    let lookups = 0;
    const lookup = (requested: typeof key) => {
      expect(requested).toEqual(key);
      lookups++;
      return intent;
    };
    restored.restoreQueue(lookup);
    restored.restoreQueue(lookup);
    expect(lookups).toBe(1);
    expect(JSON.stringify(restored.snapshot())).toContain(
      "unique-payload-bytes",
    );
    const recovered = restored
      .snapshot()
      .records.find(
        (record) =>
          record.kind === "message" &&
          record.customType === "Cancelled queued prompt",
      );
    expect(recovered?.requestId).toBe(key.requestId);
    expect(recovered?.kind === "message" && recovered.message.content).toEqual([
      { type: "text", text: "before body\nbytes after" },
      image,
      secondImage,
    ]);
    const foreign = new SDKProjector(SessionManager.open(file), 3, store);
    foreign.restoreQueue(() => ({
      ...intent,
      owner: { ...intent.owner, cwd: join(manager.getCwd(), "other") },
    }));
    expect(JSON.stringify(foreign.snapshot())).not.toContain(
      "unique-payload-bytes",
    );
    expect(foreign.failure).toContain("could not be restored");
    expect(await readFile(file, "utf8")).not.toContain("queued original");
  }));

test("process exit in a transaction releases SQLite locks without replacing the committed diagnostic", () =>
  fixture(async (manager, _file, store, dbFile) => {
    new SDKProjector(manager, 1, store).fail("committed before crash");
    const original = store.read(manager)?.metadata;
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
    import {Database} from "bun:sqlite";
    const db = new Database(${JSON.stringify(dbFile)});
    db.exec("BEGIN IMMEDIATE; UPDATE run_diagnostics SET metadata = 'uncommitted crash bytes'");
    process.exit(0);
  `,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await child.exited).toBe(0);
    expect(store.read(manager)?.metadata).toBe(original);
    const afterCrash = new SDKProjector(manager, 2, store);
    afterCrash.fail("committed after crash");
    expect(new SDKProjector(manager, 3, store).failure).toBe(
      "committed after crash",
    );
  }));

test("token updates do not write diagnostics; deletion prevents a late writer from recreating diagnostics", () =>
  fixture(async (manager, _file, store, dbFile) => {
    const projector = new SDKProjector(manager, 1, store);
    projector.event({ type: "agent_start" });
    const revision = store.read(manager)?.revision;
    const message = fauxAssistantMessage("token");
    for (let i = 0; i < 100; i++)
      projector.event({
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "x",
          partial: message,
        },
      });
    expect(store.read(manager)?.revision).toBe(revision);
    projector.event({ type: "agent_settled", aborted: false });
    expect(store.read(manager)?.revision).toBe((revision ?? 0) + 1);
    const db = new Database(dbFile);
    db.query("INSERT INTO deleted VALUES (?)").run(
      JSON.stringify([manager.getSessionId(), manager.getCwd()]),
    );
    store.delete(manager);
    projector.fail("late failure after delete");
    expect(projector.failure).toContain("deleted session");
    expect(store.read(manager)).toBeNull();
    db.close();
  }));
