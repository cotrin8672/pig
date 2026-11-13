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
import { defaultSessionDir, SearchIndex, snippet } from "./search-index";

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
