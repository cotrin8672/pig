import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { SessionInfo } from "../shared/rpc-schema";
import { SessionManager } from "./sdk";

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
  return (await SessionManager.list(cwd))
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
  const file = SessionManager.findById(cwd, id);
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
