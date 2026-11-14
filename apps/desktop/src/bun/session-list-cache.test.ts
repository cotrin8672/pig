import { expect, test } from "bun:test";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionListInfo, SessionListCache } from "./session-list-cache";

const jsonl = (...entries: unknown[]) =>
  `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
const header = (id = "session-a", cwd = "project") => ({
  type: "session",
  id,
  cwd,
  timestamp: "2026-01-01T00:00:00.000Z",
  version: 3,
});
const message = (role: string, content: unknown, timestamp?: number) => ({
  type: "message",
  timestamp: "2026-01-02T00:00:00.000Z",
  message: { role, content, timestamp },
});
const body = (id = "session-a", title = "Question") =>
  jsonl(header(id), message("user", title, 123));
async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pig-list-cache-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function counted(options: { maxEntries?: number; maxBytes?: number } = {}) {
  let reads = 0;
  const cache = new SessionListCache({
    ...options,
    read: (...args) => {
      reads++;
      return readSessionListInfo(...args);
    },
  });
  return { cache, reads: () => reads };
}

test("warm listing reads no bodies and only an updated file is reparsed", () =>
  fixture(async (dir) => {
    const a = join(dir, "a.jsonl"),
      b = join(dir, "b.jsonl");
    await writeFile(a, body());
    await writeFile(b, body("session-b", "Other question"));
    const { cache, reads } = counted();
    expect(await cache.list(dir)).toHaveLength(2);
    expect(reads()).toBe(2);
    for (let i = 0; i < 10; i++) expect(await cache.list(dir)).toHaveLength(2);
    expect(reads()).toBe(2);
    await appendFile(a, jsonl({ type: "session_info", name: " Renamed " }));
    expect(
      (await cache.list(dir)).find((info) => info.id === "session-a")?.title,
    ).toBe("Renamed");
    expect(reads()).toBe(3);
    const returned = await cache.list(dir);
    returned[0].title = "Caller mutation";
    expect((await cache.list(dir))[0].title).not.toBe("Caller mutation");
  }));

test("listing projection keeps SDK title, activity, clear-name, no-message and tie-order semantics", () =>
  fixture(async (dir) => {
    const file = join(dir, "a.jsonl");
    await writeFile(
      file,
      jsonl(
        header(),
        message("assistant", "Not the title", 1000),
        message(
          "user",
          [
            { type: "image" },
            { type: "text", text: "First" },
            { type: "text", text: "question" },
          ],
          500,
        ),
        message("user", "Later", 200),
        message("toolResult", "Not activity", 99999),
        { type: "session_info", name: "Name" },
        { type: "session_info", name: "  " },
      ),
    );
    const cache = new SessionListCache();
    expect(await cache.list(dir)).toEqual([
      {
        id: "session-a",
        cwd: "project",
        title: "First question",
        modified: 1000,
      },
    ]);
    await writeFile(
      file,
      jsonl(header(), message("user", "Fallback entry timestamp")),
    );
    expect((await cache.list(dir))[0].modified).toBe(
      Date.parse("2026-01-02T00:00:00.000Z"),
    );
    await writeFile(file, jsonl(header()));
    expect((await cache.list(dir))[0]).toMatchObject({
      title: "(no messages)",
      modified: Date.parse("2026-01-01T00:00:00.000Z"),
    });
    await writeFile(join(dir, "z.jsonl"), jsonl(header("session-z")));
    expect((await cache.list(dir)).map((info) => info.id)).toEqual([
      "session-z",
      "session-a",
    ]);
    await writeFile(file, jsonl({ ...header(), timestamp: "invalid" }));
    expect(
      (await cache.list(dir)).find((info) => info.id === "session-a")?.modified,
    ).toBe((await stat(file)).mtime.getTime());
  }));

test("replacement with the same length/mtime, same-size rewrites, shrink and deletion invalidate metadata", () =>
  fixture(async (dir) => {
    const file = join(dir, "a.jsonl"),
      temp = join(dir, "replacement.tmp");
    const { cache, reads } = counted();
    await writeFile(file, body("session-a", "Old title"));
    expect((await cache.list(dir))[0].title).toBe("Old title");
    const originalStat = await stat(file);
    await writeFile(temp, body("session-b", "New title"));
    await utimes(temp, originalStat.atime, originalStat.mtime);
    await rename(temp, file);
    expect((await cache.list(dir))[0]).toMatchObject({
      id: "session-b",
      title: "New title",
    });
    const replacedStat = await stat(file);
    await writeFile(file, body("session-b", "Edit name"));
    await utimes(file, replacedStat.atime, replacedStat.mtime);
    expect((await cache.list(dir))[0].title).toBe("Edit name");
    await writeFile(file, jsonl(header("short")));
    expect((await cache.list(dir))[0]).toMatchObject({
      id: "short",
      title: "(no messages)",
    });
    await unlink(file);
    expect(await cache.list(dir)).toEqual([]);
    await writeFile(file, body("created-again"));
    expect((await cache.list(dir))[0].id).toBe("created-again");
    expect(reads()).toBe(5);
  }));

test("unfinished appends keep the last good title but are retried until the final UTF-8 line is complete", () =>
  fixture(async (dir) => {
    const file = join(dir, "a.jsonl");
    await writeFile(file, body());
    const { cache, reads } = counted();
    const initial = await cache.list(dir);
    const suffix = Buffer.from(
      jsonl({ type: "session_info", name: "新しい名前" }),
    );
    // Split inside a multibyte character as well as inside the JSONL line.
    const cut = suffix.indexOf(Buffer.from("新")) + 1;
    await appendFile(file, suffix.subarray(0, cut));
    expect(await cache.list(dir)).toEqual(initial);
    expect(await cache.list(dir)).toEqual(initial);
    expect(reads()).toBe(3);
    await appendFile(file, suffix.subarray(cut));
    expect((await cache.list(dir))[0].title).toBe("新しい名前");
    await cache.list(dir);
    expect(reads()).toBe(4);
  }));

test("empty, malformed and unreadable files are never negatively cached; valid unterminated JSON is accepted", () =>
  fixture(async (dir) => {
    const file = join(dir, "a.jsonl");
    await writeFile(file, "");
    const { cache, reads } = counted();
    expect(await cache.list(dir)).toEqual([]);
    expect(await cache.list(dir)).toEqual([]);
    expect(reads()).toBe(2);
    await writeFile(file, `broken\n\n${body()}`);
    expect((await cache.list(dir))[0].title).toBe("Question");
    await cache.list(dir);
    expect(reads()).toBe(4);
    await appendFile(
      file,
      `malformed line\n${jsonl({ type: "session_info", name: "Name after malformed line" })}`,
    );
    expect((await cache.list(dir))[0].title).toBe("Name after malformed line");
    await cache.list(dir);
    expect(reads()).toBe(6);
    await writeFile(file, body().trimEnd());
    expect((await cache.list(dir))[0].title).toBe("Question");
    await cache.list(dir);
    expect(reads()).toBe(7);
    let failed = false;
    const retry = new SessionListCache({
      read: (...args) => {
        if (!failed) {
          failed = true;
          throw Error("transient read failure");
        }
        return readSessionListInfo(...args);
      },
    });
    expect(await retry.list(dir)).toEqual([]);
    expect((await retry.list(dir))[0].title).toBe("Question");
  }));

test.each([
  "replace",
  "delete",
  "append",
] as const)("a file changed during its read cannot publish/cache the old result: %s", (change) =>
  fixture(async (dir) => {
    const file = join(dir, "a.jsonl");
    await writeFile(file, body());
    let reads = 0;
    const cache = new SessionListCache({
      read: async (...args) => {
        reads++;
        const result = await readSessionListInfo(...args);
        if (reads === 1) {
          if (change === "delete") await unlink(file);
          else if (change === "append")
            await appendFile(
              file,
              jsonl({ type: "session_info", name: "After append" }),
            );
          else {
            const replacement = join(dir, "replacement.tmp");
            await writeFile(replacement, body("replacement", "Replacement"));
            await rename(replacement, file);
          }
        }
        return result;
      },
    });
    expect(await cache.list(dir)).toEqual([]);
    const next = await cache.list(dir);
    if (change === "delete") expect(next).toEqual([]);
    else {
      expect(next[0].title).toBe(
        change === "append" ? "After append" : "Replacement",
      );
      expect(reads).toBe(2);
    }
  }));

test("directory changes stay isolated; concurrent scans coalesce without exposing shared result objects", () =>
  fixture(async (dir) => {
    const other = join(dir, "other");
    await mkdir(other);
    await writeFile(join(dir, "a.jsonl"), body());
    await writeFile(
      join(other, "a.jsonl"),
      body("other-session", "Other directory"),
    );
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const cache = new SessionListCache({
      read: async (...args) => {
        reads++;
        enter();
        await gate;
        return readSessionListInfo(...args);
      },
    });
    const first = cache.list(dir);
    await entered;
    const second = cache.list(dir);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(reads).toBe(1);
    a[0].title = "Do not share";
    expect(b[0].title).toBe("Question");
    expect((await cache.list(other))[0].title).toBe("Other directory");
    expect((await cache.list(dir))[0].title).toBe("Question");
    expect(reads).toBe(2);
  }));

test("a removed directory releases its metadata even when unchanged files later return", () =>
  fixture(async (dir) => {
    const source = join(dir, "source"),
      moved = join(dir, "moved");
    await mkdir(source);
    await writeFile(join(source, "a.jsonl"), body());
    const { cache, reads } = counted();
    await cache.list(source);
    expect(reads()).toBe(1);
    await rename(source, moved);
    expect(await cache.list(source)).toEqual([]);
    await rename(moved, source);
    expect((await cache.list(source))[0].title).toBe("Question");
    expect(reads()).toBe(2);
  }));

test("cache entry/byte budgets evict metadata without truncating displayed titles", () =>
  fixture(async (dir) => {
    const other = join(dir, "other");
    await mkdir(other);
    await writeFile(join(dir, "a.jsonl"), body());
    await writeFile(join(other, "a.jsonl"), body("other-session"));
    const limited = counted({ maxEntries: 1 });
    await limited.cache.list(dir);
    await limited.cache.list(other);
    await limited.cache.list(dir);
    expect(limited.reads()).toBe(3);
    const title = "Large title 日本語".repeat(1000);
    const file = join(dir, "a.jsonl");
    await writeFile(file, body("large", title));
    const sized = counted({ maxBytes: 1024 });
    for (let i = 0; i < 2; i++)
      expect((await sized.cache.list(dir))[0].title).toBe(title);
    expect(sized.reads()).toBe(2);
    expect(await readFile(file, "utf8")).toBe(body("large", title));
  }));
