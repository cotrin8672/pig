import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { FileEntry } from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "../shared/rpc-schema";
import { isProjectTrusted } from "./project-trust";
import { agentDir, expandHome } from "./runtime-profile";
import { SessionManager, SettingsManager } from "./sdk";

/** Pi CLI precedence (without --session-dir): PI_CODING_AGENT_SESSION_DIR,
 * then settings sessionDir; undefined selects the SDK per-cwd default.
 * Every create/list/find/open must use this same value.
 */
export async function sessionDirFor(cwd: string) {
  const env = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (env) return expandHome(env);
  // A missing/unreadable cwd cannot be trusted; fall back to global settings only.
  const projectTrusted = await isProjectTrusted(cwd).catch(() => false);
  return SettingsManager.create(cwd, agentDir, {
    projectTrusted,
  }).getSessionDir();
}

export function validSessionId(id: string) {
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(id) ||
    /^\d+$/.test(id)
  )
    throw new Error("Invalid SDK session ID");
  return id;
}
export function sameSessionPath(left: string, right: string) {
  if (!left || !right) return false;
  const key = (path: string) => {
    const absolute = resolve(path);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  };
  return key(left) === key(right);
}
export async function listSessionFiles(cwd: string): Promise<SessionInfo[]> {
  return (await SessionManager.list(cwd, await sessionDirFor(cwd)))
    .filter((info) => sameSessionPath(info.cwd, cwd))
    .map((info) => ({
      id: info.id,
      cwd,
      title: info.name ?? info.firstMessage ?? "New chat",
      modified: info.modified.getTime(),
    }));
}
export async function resolveSessionFile(cwd: string, id: string) {
  validSessionId(id);
  const file = SessionManager.findById(cwd, id, await sessionDirFor(cwd));
  if (file) {
    const stream = createReadStream(file, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      // Default SDK discovery groups by directory; still validate header ownership.
      for await (const line of lines) {
        if (!line.trim()) continue;
        const header = JSON.parse(line);
        if (
          header.type === "session" &&
          header.id === id &&
          typeof header.cwd === "string" &&
          sameSessionPath(header.cwd, cwd)
        )
          return file;
        break;
      }
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  throw new Error("Session does not belong to this project or was not found");
}
export async function removeSessionFile(cwd: string, id: string) {
  await unlink(await resolveSessionFile(cwd, id));
}

/** SDK open repairs files and skips malformed lines; browsing must do neither. */
export async function readSessionFile(cwd: string, id: string) {
  const file = await resolveSessionFile(cwd, id);
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const entries: FileEntry[] = [];
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as FileEntry;
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw new Error("Invalid session history entry");
      entries.push(entry);
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  const header = entries[0];
  if (
    header?.type !== "session" ||
    header.id !== id ||
    typeof header.cwd !== "string" ||
    !sameSessionPath(header.cwd, cwd)
  )
    throw new Error("Session does not belong to this project or was not found");
  const manager = SessionManager.inMemory(cwd, undefined, entries);
  const seen = new Set<string>();
  for (const entry of manager.getEntries()) {
    if (
      typeof entry.id !== "string" ||
      seen.has(entry.id) ||
      (entry.parentId !== null && !seen.has(entry.parentId))
    )
      throw new Error("Invalid session history branch");
    seen.add(entry.id);
  }
  return manager;
}
