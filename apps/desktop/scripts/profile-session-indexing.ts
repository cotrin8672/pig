import { Database } from "bun:sqlite";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { SearchIndex } from "../src/bun/search-index";

// Explicit opt-in only. Never modify the original or log message text/IDs.
if (process.argv[2] !== "--current-session" || !process.env.PI_SESSION_FILE)
  throw new Error(
    "Usage: profile-session-indexing.ts --current-session (requires PI_SESSION_FILE)",
  );
const dir = await mkdtemp(join(tmpdir(), "pig-real-index-profile-"));
let index: SearchIndex | undefined, inspect: Database | undefined;
try {
  const sessions = join(dir, "sessions"),
    copy = join(sessions, "copy.jsonl"),
    database = join(dir, "index.sqlite");
  await mkdir(sessions);
  await copyFile(process.env.PI_SESSION_FILE, copy);
  const source = await readFile(copy);
  const lines = source
    .subarray(0, source.lastIndexOf(10) + 1)
    .toString("utf8")
    .split("\n");
  const head = JSON.parse(lines.find((line) => line.trim()) ?? "{}");
  if (
    head.type !== "session" ||
    typeof head.cwd !== "string" ||
    typeof head.id !== "string"
  )
    throw new Error("Unsupported session header");
  const expected: {
    text: string;
    session: string;
    entry: string;
    role: string;
    ts: number;
  }[] = [];
  for (const line of lines) {
    if (!line.includes('"role":"user"') && !line.includes('"assistant"'))
      continue;
    let entry: {
      type?: unknown;
      id?: unknown;
      timestamp?: unknown;
      message?: { role?: unknown; content?: unknown; timestamp?: unknown };
    } | null = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const m = entry?.message;
    if (
      entry?.type !== "message" ||
      typeof entry.id !== "string" ||
      (m?.role !== "user" && m?.role !== "assistant")
    )
      continue;
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter(
                (b: { type?: string; text?: unknown }) =>
                  b?.type === "text" && typeof b.text === "string",
              )
              .map((b: { text: string }) => b.text)
              .join("\n\n")
          : "";
    if (text.trim())
      expected.push({
        text,
        session: head.id,
        entry: entry.id,
        role: m.role,
        ts:
          typeof m.timestamp === "number"
            ? m.timestamp
            : typeof entry.timestamp === "string"
              ? Date.parse(entry.timestamp) || 0
              : 0,
      });
  }
  index = new SearchIndex(database);
  let last = performance.now();
  const gaps: number[] = [];
  const timer = setInterval(() => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
  }, 2);
  const started = performance.now();
  let elapsedMs: number;
  try {
    await index.refresh(() => [{ dir: sessions, cwds: [head.cwd] }]);
    elapsedMs = performance.now() - started;
  } finally {
    await Bun.sleep(5);
    clearInterval(timer);
  }
  inspect = new Database(database);
  const actual = inspect
    .query("SELECT text,session,entry,role,ts FROM messages ORDER BY rowid")
    .all();
  if (!isDeepStrictEqual(actual, expected))
    throw new Error(
      "Indexed data differs from the source oracle (contents withheld)",
    );
  gaps.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      bytes: (await stat(copy)).size,
      lines: lines.length - 1,
      indexedMessages: expected.length,
      elapsedMs,
      maxGapMs: gaps.at(-1),
      p95GapMs: gaps[Math.floor(gaps.length * 0.95)],
      ticks: gaps.length,
      exactRows: true,
      scope:
        "Read-only copy of current session; temporary derived index removed; not the reported heavy conversation or actual WebView scrolling/input",
    }),
  );
} finally {
  inspect?.close();
  index?.close();
  await rm(dir, { recursive: true, force: true });
}
