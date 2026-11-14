import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendFile,
  mkdtemp,
  rename,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchIndex } from "./search-index";

let dir: string,
  file: string,
  database: string,
  index: SearchIndex,
  inspect: Database;
const cwd = join(tmpdir(), "streaming-project");
const json = (value: unknown) => `${JSON.stringify(value)}\n`;
const head = () => json({ type: "session", id: "a", cwd });
const msg = (id: string, text: string, timestamp = 1) =>
  json({
    type: "message",
    id,
    message: { role: "user", content: text, timestamp },
  });
const source = () =>
  head() +
  Array.from({ length: 500 }, (_, i) =>
    msg(
      `entry-${i}`,
      i === 499
        ? "unchanged tail ".repeat(50)
        : `oldword 日本語😀 ${"body ".repeat(20)}`,
      i,
    ),
  ).join("");
const roots = () => [{ dir: join(dir, "sessions"), cwds: [cwd] }];
const count = () =>
  (
    inspect
      .query("SELECT count(*) AS n FROM messages WHERE session='a'")
      .get() as { n: number }
  ).n;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pig-index-stream-"));
  file = join(dir, "sessions", "a.jsonl");
  database = join(dir, "index.sqlite");
  await Bun.write(file, source());
  index = new SearchIndex(database);
  inspect = new Database(database);
});
afterEach(async () => {
  index.close();
  inspect.close();
  await rm(dir, { recursive: true, force: true });
});

async function paused(action: () => void | Promise<void>) {
  index.close();
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let stopped = false;
  index = new SearchIndex(database, async () => {
    if (!stopped && count() > 0) {
      stopped = true;
      ready.resolve();
      await release.promise;
    }
    await Bun.sleep(0);
  });
  const run = index.refresh(roots);
  try {
    await ready.promise;
    await action();
  } finally {
    release.resolve();
    await run;
  }
}

test("forget during a committed slice cannot resurrect rows or checkpoints", async () => {
  await paused(() => {
    expect(count()).toBeGreaterThan(0);
    index.forget("a");
    expect(count()).toBe(0);
  });
  expect(index.search("oldword")).toEqual([]);
  expect(count()).toBe(0);
  expect(inspect.query("SELECT * FROM files").all()).toEqual([]);
  expect(inspect.query("SELECT * FROM file_identity").all()).toEqual([]);
});

test("forget while the roots provider is pending also protects a queued follow-up scan", async () => {
  const gate = Promise.withResolvers<ReturnType<typeof roots>>();
  const run = index.refresh(() => gate.promise);
  const followup = index.refresh(roots);
  index.forget("a");
  gate.resolve(roots());
  expect(followup).toBe(run);
  await run;
  expect(count()).toBe(0);
  expect(index.search("oldword")).toEqual([]);
  // A new explicit refresh after the deleted generation has drained may discover
  // a file that still exists; no permanent session tombstones are retained.
  await index.refresh(roots);
  expect(count()).toBe(500);
});

test("a stale roots-provider failure cannot discard the latest queued refresh", async () => {
  const gate = Promise.withResolvers<ReturnType<typeof roots>>();
  const run = index.refresh(() => gate.promise);
  await Bun.sleep(0);
  let obsolete = 0,
    latest = 0;
  expect(
    index.refresh(() => {
      obsolete++;
      return [];
    }),
  ).toBe(run);
  expect(
    index.refresh(() => {
      latest++;
      return roots();
    }),
  ).toBe(run);
  gate.reject(new Error("obsolete roots failure"));
  await run;
  expect(obsolete).toBe(0);
  expect(latest).toBe(1);
  expect(count()).toBe(500);
  expect(index.indexing).toBe(false);
});

test("new roots cancel an in-flight generation; foreign ownership can later become eligible again", async () => {
  let followup: Promise<void> | undefined;
  await paused(() => {
    followup = index.refresh(() => [{ dir: join(dir, "sessions"), cwds: [] }]);
  });
  await followup;
  expect(count()).toBe(0);
  expect(index.search("oldword")).toEqual([]);
  await index.refresh(roots);
  expect(count()).toBe(500);
  expect(index.search("oldword", 1000)).toHaveLength(499);
});

test("deletion and same-name replacement while yielded never publish the old file", async () => {
  await paused(() => unlink(file));
  expect(count()).toBe(0);
  expect(index.search("oldword")).toEqual([]);
  await writeFile(file, source());
  await paused(async () => {
    const before = await stat(file),
      replacement = join(dir, "replacement.jsonl");
    await writeFile(replacement, source().replaceAll("oldword", "newword"));
    await utimes(replacement, before.atime, before.mtime);
    // Windows does not allow rename-overwrite of this open destination. Remove
    // its name first; the reader still holds the old descriptor throughout.
    await unlink(file);
    await rename(replacement, file);
  });
  expect(count()).toBe(500);
  expect(index.search("oldword")).toEqual([]);
  expect(index.search("newword", 1000)).toHaveLength(499);
});

test("same-sized rewrites with unchanged tail and restored mtime are detected across reopening", async () => {
  await index.refresh(roots);
  const before = await stat(file);
  index.close();
  await writeFile(file, source().replaceAll("oldword", "newword"));
  await utimes(file, before.atime, before.mtime);
  index = new SearchIndex(database);
  await index.refresh(roots);
  expect(count()).toBe(500);
  expect(index.search("oldword")).toEqual([]);
  expect(index.search("newword", 1000)).toHaveLength(499);
});

test("a growing rewrite during a slice is verified and restarted instead of mixing old and new records", async () => {
  await paused(() =>
    writeFile(
      file,
      source().replaceAll("oldword", "newword") +
        msg("extra", "newword extra", 1000),
    ),
  );
  expect(count()).toBe(501);
  expect(index.search("oldword")).toEqual([]);
  expect(index.search("newword", 1000)).toHaveLength(500);
});

test("a growing rewrite of header identity outside the checkpoint tail cannot publish to the old session", async () => {
  const body = source().slice(head().length);
  const padded = (id: string) =>
    json({ type: "session", id, cwd, padding: "z".repeat(200) });
  await writeFile(file, padded("a") + body);
  await paused(() =>
    writeFile(file, padded("b") + body + msg("extra", "new identity", 1000)),
  );
  expect(count()).toBe(0);
  const hits = index.search("oldword", 1000);
  expect(hits).toHaveLength(499);
  expect(hits.every((hit) => hit.sessionId === "b")).toBe(true);
});

test("concurrent append stays outside the captured range, then resumes once without duplicates", async () => {
  await paused(() => appendFile(file, msg("late", "late needle", 1000)));
  expect(count()).toBe(500);
  expect(index.search("late needle")).toEqual([]);
  await index.refresh(roots);
  expect(count()).toBe(501);
  expect(index.search("late needle").map((h) => h.entryId)).toEqual(["late"]);
  await index.refresh(roots);
  expect(count()).toBe(501);
});

test("partial UTF-8 JSONL bytes resume from the last complete LF and preserve exact text", async () => {
  const entry = Buffer.from(msg("unicode", "境界😀 needle\nsecond line", 1000)),
    at = entry.indexOf(Buffer.from("😀")) + 2;
  await appendFile(file, entry.subarray(0, at));
  await index.refresh(roots);
  expect(count()).toBe(500);
  const checkpoint = inspect
    .query("SELECT offset,tail FROM files WHERE session='a'")
    .get() as { offset: number; tail: Uint8Array };
  expect(checkpoint.offset).toBe(Buffer.byteLength(source()));
  expect(Buffer.from(checkpoint.tail)).toEqual(
    Buffer.from(source()).subarray(-64),
  );
  await appendFile(file, entry.subarray(at));
  await index.refresh(roots);
  expect(count()).toBe(501);
  expect(
    (
      inspect
        .query("SELECT text FROM messages WHERE entry='unicode'")
        .get() as { text: string }
    ).text,
  ).toBe("境界😀 needle\nsecond line");
});

test("an interrupted growing rewrite discards unverified checkpoints instead of resuming mixed text", async () => {
  index.close();
  let failed = false;
  index = new SearchIndex(database, async () => {
    if (!failed && count() > 0) {
      failed = true;
      await writeFile(
        file,
        source().replaceAll("oldword", "newword") +
          msg("extra", "newword extra", 1000),
      );
      throw new Error("synthetic interruption during a growing rewrite");
    }
    await Bun.sleep(0);
  });
  await index.refresh(roots);
  expect(failed).toBe(true);
  expect(count()).toBe(0);
  expect(inspect.query("SELECT * FROM files").all()).toEqual([]);
  await index.refresh(roots);
  expect(count()).toBe(501);
  expect(index.search("oldword")).toEqual([]);
  expect(index.search("newword", 1000)).toHaveLength(500);
});

for (const mode of ["refresh", "reopen"] as const) {
  test(`unverified progress is not reused after a growing rewrite and ${mode}`, async () => {
    let followup: Promise<void> | undefined;
    await paused(async () => {
      expect(
        (
          inspect.query("SELECT size FROM files WHERE session='a'").get() as {
            size: number;
          }
        ).size,
      ).toBe(-2);
      await writeFile(
        file,
        source().replaceAll("oldword", "newword") +
          msg("extra", "newword extra", 1000),
      );
      if (mode === "refresh") followup = index.refresh(roots);
      else index.close();
    });
    if (mode === "reopen") {
      index = new SearchIndex(database);
      expect(index.search("oldword")).toEqual([]);
      await index.refresh(roots);
    } else await followup;
    expect(count()).toBe(501);
    expect(index.search("oldword")).toEqual([]);
    expect(index.search("newword", 1000)).toHaveLength(500);
  });
}

test("interruption after a committed checkpoint resumes without duplicating committed rows", async () => {
  index.close();
  let failed = false;
  index = new SearchIndex(database, async () => {
    if (!failed && count() > 0) {
      failed = true;
      throw new Error("synthetic interruption after commit");
    }
    await Bun.sleep(0);
  });
  await index.refresh(roots);
  expect(count()).toBeGreaterThan(0);
  expect(count()).toBeLessThan(500);
  await index.refresh(roots);
  expect(count()).toBe(500);
  expect(
    inspect
      .query(
        "SELECT entry,count(*) AS n FROM messages GROUP BY entry HAVING n!=1",
      )
      .all(),
  ).toEqual([]);
});

test("close while yielded prevents subsequent database work and a throwing roots provider does not leave indexing stuck", async () => {
  await expect(
    index.refresh(() => {
      throw new Error("roots unavailable");
    }),
  ).rejects.toThrow("roots unavailable");
  expect(index.indexing).toBe(false);
  await paused(() => index.close());
  expect(index.indexing).toBe(false);
  await expect(index.refresh(roots)).rejects.toThrow("closed");
});

test("truncated or unfinished replacement headers clear the preceding searchable generation", async () => {
  await index.refresh(roots);
  await writeFile(file, "");
  await index.refresh(roots);
  expect(count()).toBe(0);
  expect(index.search("oldword")).toEqual([]);
  await writeFile(file, source());
  await index.refresh(roots);
  expect(count()).toBe(500);
  await writeFile(file, '{"type":"session","id":');
  await index.refresh(roots);
  expect(count()).toBe(0);
  expect(index.search("oldword")).toEqual([]);
  await writeFile(file, source());
  await index.refresh(roots);
  expect(count()).toBe(500);
});

test("complete rows equal a whole-file source oracle for large indexed and ignored records", async () => {
  const texts = [
    "設定😀 needle ".repeat(80000),
    "end needle 100%_",
    "画像の後の本文",
  ];
  await writeFile(
    file,
    "\n" +
      head() +
      json({
        type: "message",
        id: "big",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "ignored" },
            { type: "text", text: texts[0] },
            { type: "text", text: texts[1] },
          ],
          timestamp: 2,
        },
      }) +
      json({
        type: "message",
        id: "image",
        message: {
          role: "user",
          content: [
            { type: "image", data: "x".repeat(200000) },
            { type: "text", text: texts[2] },
          ],
          timestamp: 3,
        },
      }) +
      json({
        type: "message",
        id: "tool",
        message: { role: "toolResult", content: "assistant ".repeat(100000) },
      }) +
      "{malformed}\n" +
      msg("last", "needle last", 4),
  );
  await index.refresh(roots);
  expect(
    inspect
      .query("SELECT text,session,entry,role,ts FROM messages ORDER BY rowid")
      .all(),
  ).toEqual([
    {
      text: `${texts[0]}\n\n${texts[1]}`,
      session: "a",
      entry: "big",
      role: "assistant",
      ts: 2,
    },
    { text: texts[2], session: "a", entry: "image", role: "user", ts: 3 },
    { text: "needle last", session: "a", entry: "last", role: "user", ts: 4 },
  ]);
  expect(index.search("needle").map((h) => h.entryId)).toEqual(["last", "big"]);
});
