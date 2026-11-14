import { type BigIntStats, createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { FileEntry } from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "../shared/rpc-schema";

type ReadResult = { info?: SessionInfo; complete: boolean };

/**
 * Listing-only projection of SDK 1.5.2 buildSessionInfo. Keep title/activity
 * semantics, but never build allMessagesText, hydrate a session, or repair JSONL.
 * Malformed lines are skipped like the SDK; such a read is never cached.
 */
export async function readSessionListInfo(
  file: string,
  fallbackModified: number,
): Promise<ReadResult> {
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header: { id: string; cwd: string; timestamp?: string } | undefined;
  let name: string | undefined;
  let firstMessage = "";
  let activity: number | undefined;
  let complete = true;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let entry: FileEntry | null;
      try {
        entry = JSON.parse(line);
      } catch {
        complete = false;
        continue;
      }
      if (!entry) continue;
      if (!header) {
        if (entry.type !== "session" || typeof entry.id !== "string")
          return { complete: false };
        header = {
          id: entry.id,
          cwd: typeof entry.cwd === "string" ? entry.cwd : "",
          timestamp: entry.timestamp,
        };
        continue;
      }
      if (entry.type === "session_info") name = entry.name?.trim() || undefined;
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (
        typeof message.role !== "string" ||
        !("content" in message) ||
        (message.role !== "user" && message.role !== "assistant")
      )
        continue;
      const timestamp =
        typeof message.timestamp === "number"
          ? message.timestamp
          : new Date(entry.timestamp).getTime();
      if (!Number.isNaN(timestamp))
        activity = Math.max(activity ?? 0, timestamp);
      if (!firstMessage && message.role === "user")
        firstMessage =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join(" ");
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  if (!header) return { complete: false };
  const headerTime =
    typeof header.timestamp === "string"
      ? new Date(header.timestamp).getTime()
      : Number.NaN;
  return {
    complete,
    info: {
      id: header.id,
      cwd: header.cwd,
      title: name ?? (firstMessage || "(no messages)"),
      modified:
        activity !== undefined && activity > 0
          ? new Date(activity).getTime()
          : Number.isNaN(headerTime)
            ? fallbackModified
            : headerTime,
    },
  };
}

type Stamp = Pick<
  BigIntStats,
  "dev" | "ino" | "size" | "mtimeNs" | "ctimeNs" | "birthtimeNs"
>;
type Cached = { stamp: Stamp; info: SessionInfo; bytes: number };
const sameFile = (a: Stamp, b: Stamp) =>
  a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const sameStamp = (a: Stamp, b: Stamp) =>
  sameFile(a, b) &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;

/** Re-enumerate/stat on every refresh; retain only bounded, stable file metadata. */
export class SessionListCache {
  private entries = new Map<string, Cached>();
  private bytes = 0;
  private pending = new Map<string, Promise<SessionInfo[]>>();
  private read: typeof readSessionListInfo;
  private maxEntries: number;
  private maxBytes: number;

  constructor(
    options: {
      read?: typeof readSessionListInfo;
      maxEntries?: number;
      maxBytes?: number;
    } = {},
  ) {
    this.read = options.read ?? readSessionListInfo;
    this.maxEntries = options.maxEntries ?? 4096;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  }

  async list(directory: string): Promise<SessionInfo[]> {
    const dir = resolve(directory);
    let pending = this.pending.get(dir);
    if (!pending) {
      pending = this.scan(dir).finally(() => this.pending.delete(dir));
      this.pending.set(dir, pending);
    }
    // Callers may mutate their list; never expose the cache's metadata objects.
    return (await pending).map((info) => ({ ...info }));
  }

  private forget(file: string) {
    const old = this.entries.get(file);
    if (old) this.bytes -= old.bytes;
    this.entries.delete(file);
  }

  private remember(file: string, stamp: Stamp, info: SessionInfo) {
    this.forget(file);
    const bytes =
      256 +
      2 * (file.length + info.id.length + info.cwd.length + info.title.length);
    if (this.maxEntries <= 0 || bytes > this.maxBytes) return;
    this.entries.set(file, { stamp, info, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.forget(oldest);
    }
  }

  private async scan(dir: string) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )
        for (const file of this.entries.keys())
          if (dirname(file) === dir) this.forget(file);
      // Do not turn a transient directory read failure into a negative cache.
      return [];
    }
    const files = names
      .filter((name) => name.endsWith(".jsonl"))
      .sort((a, b) => b.localeCompare(a))
      .map((name) => join(dir, name));
    const present = new Set(files);
    for (const file of this.entries.keys())
      if (dirname(file) === dir && !present.has(file)) this.forget(file);
    const results: (SessionInfo | undefined)[] = new Array(files.length);
    let next = 0;
    // Match the SDK's bounded I/O concurrency and deterministic tie order.
    const worker = async () => {
      while (next < files.length) {
        const index = next++;
        results[index] = await this.load(files[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(10, files.length) }, worker),
    );
    return results
      .filter((info): info is SessionInfo => !!info)
      .sort((a, b) => b.modified - a.modified);
  }

  private async load(file: string): Promise<SessionInfo | undefined> {
    const previous = this.entries.get(file);
    let before: BigIntStats;
    try {
      before = await stat(file, { bigint: true });
    } catch {
      this.forget(file);
      return;
    }
    if (!before.isFile()) {
      this.forget(file);
      return;
    }
    if (previous && sameStamp(previous.stamp, before)) {
      this.entries.delete(file);
      this.entries.set(file, previous);
      return previous.info;
    }
    let result: ReadResult | undefined;
    try {
      result = await this.read(file, Number(before.mtimeMs));
    } catch {
      // A failed/partial read must be retried on the next explicit/focus refresh.
    }
    let after: BigIntStats;
    try {
      after = await stat(file, { bigint: true });
    } catch {
      this.forget(file);
      return;
    }
    if (sameStamp(before, after) && result?.info) {
      if (result.complete) this.remember(file, after, result.info);
      // Like the SDK, show metadata from valid lines even if another line is
      // malformed/incomplete. Do not commit that partial read to the cache.
      else if (
        previous &&
        (!sameFile(previous.stamp, after) ||
          after.size < previous.stamp.size ||
          result.info.id !== previous.info.id ||
          result.info.cwd !== previous.info.cwd)
      )
        this.forget(file);
      return result.info;
    }
    // Keep a last good title during an append, never across replacement/shrink
    // or a parsed header that belongs to a different session/project.
    if (
      previous &&
      sameFile(previous.stamp, after) &&
      after.size >= previous.stamp.size &&
      (!result?.info ||
        (result.info.id === previous.info.id &&
          result.info.cwd === previous.info.cwd))
    )
      return previous.info;
    this.forget(file);
    return sameStamp(before, after) ? result?.info : undefined;
  }
}
