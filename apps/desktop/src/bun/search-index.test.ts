import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendFile,
  mkdtemp,
  rm,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TERMS, searchTerms } from "../shared/fuzzy";
import { defaultSessionDir, SearchIndex, snippet } from "./search-index";
import { FULL_SCAN_SEARCH_SQL } from "./search-query";

let dir: string;
let index: SearchIndex;
const cwd = join(tmpdir(), "pig-search-project");
const roots = () => [{ dir: join(dir, "sessions"), cwds: [cwd] }];
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const header = (id: string, at = cwd) =>
  line({ type: "session", id, cwd: at, timestamp: "2026-01-01T00:00:00Z" });
const message = (id: string, role: string, content: unknown, timestamp = 1) =>
  line({ type: "message", id, message: { role, content, timestamp } });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pig-search-index-"));
  await Bun.write(join(dir, "sessions", ".keep"), "");
  index = new SearchIndex(join(dir, "search.sqlite"));
});
afterEach(async () => {
  index.close();
  await rm(dir, { recursive: true, force: true });
});

test("indexes user and assistant text only, newest first", async () => {
  await writeFile(
    join(dir, "sessions", "a.jsonl"),
    header("a") +
      message("u1", "user", "Fix the scrollbar inset", 1) +
      message(
        "a1",
        "assistant",
        [
          { type: "thinking", thinking: "scrollbar secret" },
          { type: "text", text: "The scrollbar now uses --scrollbar-inset." },
          { type: "toolCall", id: "t", name: "bash", arguments: {} },
        ],
        2,
      ) +
      message("r1", "toolResult", [{ type: "text", text: "scrollbar log" }], 3),
  );
  await index.refresh(roots);
  const hits = index.search("SCROLLBAR");
  expect(hits.map((hit) => hit.entryId)).toEqual(["a1", "u1"]);
  expect(hits[0]).toMatchObject({ sessionId: "a", cwd, role: "assistant" });
  expect(index.search("secret")).toEqual([]);
  expect(index.search("log")).toEqual([]);
});

test("all terms must match; two-character and Japanese terms work", async () => {
  await writeFile(
    join(dir, "sessions", "a.jsonl"),
    header("a") +
      message("u1", "user", "検索の設定を変える") +
      message("u2", "user", "設定だけ"),
  );
  await index.refresh(roots);
  expect(
    index
      .search("設定")
      .map((h) => h.entryId)
      .sort(),
  ).toEqual(["u1", "u2"]);
  expect(index.search("設定 検索").map((h) => h.entryId)).toEqual(["u1"]);
  expect(index.search("x")).toEqual([]);
  expect(index.search("100%")).toEqual([]);
});

test("appends are read incrementally; rewrites and deletions are reindexed", async () => {
  const file = join(dir, "sessions", "a.jsonl");
  await writeFile(file, header("a") + message("u1", "user", "alpha"));
  await index.refresh(roots);
  // A partial trailing line is picked up once completed.
  const next = message("u2", "user", "bravo");
  await appendFile(file, next.slice(0, 10));
  await index.refresh(roots);
  expect(index.search("bravo")).toEqual([]);
  await appendFile(file, next.slice(10));
  await index.refresh(roots);
  expect(index.search("bravo").map((h) => h.entryId)).toEqual(["u2"]);
  expect(index.search("alpha")).toHaveLength(1);

  await truncate(file, 0);
  await writeFile(file, header("a") + message("u3", "user", "charlie"));
  await index.refresh(roots);
  expect(index.search("alpha")).toEqual([]);
  expect(index.search("charlie")).toHaveLength(1);

  await unlink(file);
  await index.refresh(roots);
  expect(index.search("charlie")).toEqual([]);
});

test("skips other workspaces' files and forgets deleted chats", async () => {
  await writeFile(
    join(dir, "sessions", "other.jsonl"),
    header("o", join(tmpdir(), "elsewhere")) + message("u", "user", "hidden"),
  );
  await writeFile(
    join(dir, "sessions", "a.jsonl"),
    header("a") + message("u1", "user", "visible"),
  );
  await index.refresh(roots);
  expect(index.search("hidden")).toEqual([]);
  expect(index.search("visible")).toHaveLength(1);
  index.forget("a");
  expect(index.search("visible")).toEqual([]);
});

test("the index survives reopening", async () => {
  await writeFile(
    join(dir, "sessions", "a.jsonl"),
    header("a") + message("u1", "user", "persistent"),
  );
  await index.refresh(roots);
  index.close();
  index = new SearchIndex(join(dir, "search.sqlite"));
  expect(index.search("persistent")).toHaveLength(1);
});

test("a pre-optimization version-1 index opens without migration or reindexing", () => {
  const file = join(dir, "legacy.sqlite");
  const legacy = new Database(file, { create: true });
  legacy.exec(`CREATE TABLE files(path TEXT PRIMARY KEY, session TEXT NOT NULL, cwd TEXT NOT NULL,
    size INTEGER NOT NULL, mtime REAL NOT NULL, offset INTEGER NOT NULL, tail BLOB NOT NULL);
    CREATE VIRTUAL TABLE messages USING fts5(text, session UNINDEXED, entry UNINDEXED,
      role UNINDEXED, ts UNINDEXED, tokenize='trigram'); PRAGMA user_version=1;`);
  legacy
    .query("INSERT INTO files VALUES(?,?,?,0,0,0,x'')")
    .run("legacy.jsonl", "legacy", cwd);
  legacy
    .query("INSERT INTO messages VALUES(?,?,?,?,?)")
    .run("legacy needle 100%_", "legacy", "saved-entry", "assistant", 42);
  legacy.close();
  const reopened = new SearchIndex(file);
  try {
    expect(reopened.search("needle 100%_")).toEqual([
      {
        sessionId: "legacy",
        cwd,
        entryId: "saved-entry",
        role: "assistant",
        timestamp: 42,
        snippet: "legacy needle 100%_",
      },
    ]);
  } finally {
    reopened.close();
  }
});

test("indexed search keeps complete hit metadata, snippets, limits and jump destinations identical to the old SQL", async () => {
  const file = join(dir, "sessions", "a.jsonl");
  await writeFile(
    file,
    header("a") +
      Array.from({ length: 300 }, (_, i) => {
        const text =
          (i % 3
            ? `Alpha 設定 path C:\\temp\\file 100%_ text ${i}`
            : `alphabet without literal symbols ${i}`) +
          (i === 7 ? " rare-literal" : "");
        return message(
          `entry-${i}`,
          i % 2 ? "assistant" : "user",
          i % 2 ? [{ type: "text", text }] : text,
          Math.floor(i / 4),
        );
      }).join(""),
  );
  await index.refresh(roots);
  const db = new Database(join(dir, "search.sqlite"));
  try {
    for (const query of [
      "ALPHA",
      "設定",
      "100%_ 設定",
      "C:\\temp\\file",
      "alphabet symbols",
      "rare-literal",
      "100%_ rare-literal",
      "text 7",
      "missing",
    ])
      for (const limit of [0, 1, 7, 50]) {
        const terms = searchTerms(query);
        const patterns = Array.from({ length: MAX_TERMS }, (_, i) =>
          terms[i] === undefined
            ? "%"
            : `%${terms[i].replace(/[\\%_]/g, "\\$&")}%`,
        );
        const expected = (
          db.query(FULL_SCAN_SEARCH_SQL).all(...patterns, limit) as {
            text: string;
            session: string;
            entry: string;
            role: "user" | "assistant";
            ts: number;
          }[]
        ).map((row) => ({
          sessionId: row.session,
          cwd,
          entryId: row.entry,
          role: row.role,
          timestamp: row.ts,
          snippet: snippet(row.text, terms),
        }));
        expect(index.search(query, limit)).toEqual(expected);
      }
  } finally {
    db.close();
  }
  const before = index.search("100%_ 設定");
  index.close();
  index = new SearchIndex(join(dir, "search.sqlite"));
  expect(index.search("100%_ 設定")).toEqual(before);
  expect(index.search("rare-literal").map((hit) => hit.entryId)).toEqual([
    "entry-7",
  ]);
  index.forget("a");
  expect(index.search("rare-literal")).toEqual([]);
});

test("snippets centre on the first match", () => {
  const text = `${"x".repeat(100)} needle ${"y".repeat(300)}`;
  const result = snippet(text, ["needle"]);
  expect(result.startsWith("…")).toBe(true);
  expect(result.endsWith("…")).toBe(true);
  expect(result).toContain("needle");
  expect(snippet("a\n\nb needle", ["needle"])).toBe("a b needle");
});

test("default session directory matches the SDK", async () => {
  const { getDefaultSessionDir } = (await import(
    new URL(
      "./core/session-manager.js",
      import.meta.resolve("@earendil-works/pi-coding-agent"),
    ).href
  )) as { getDefaultSessionDir(cwd: string, agentDir: string): string };
  const agent = join(dir, "agent");
  expect(defaultSessionDir(cwd, agent)).toBe(getDefaultSessionDir(cwd, agent));
});
