import { unlink } from "node:fs/promises";
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
export async function listSessionFiles(cwd: string): Promise<SessionInfo[]> {
  return (await SessionManager.list(cwd))
    .filter((info) => info.cwd === cwd)
    .map((info) => ({
      id: info.id,
      cwd: info.cwd,
      title: info.name ?? info.firstMessage ?? "New chat",
      modified: info.modified.getTime(),
    }));
}
export async function resolveSessionFile(cwd: string, id: string) {
  validSessionId(id);
  const info = (await SessionManager.list(cwd)).find(
    (info) => info.id === id && info.cwd === cwd,
  );
  if (!info)
    throw new Error("Session does not belong to this project or was not found");
  return info.path;
}
export async function removeSessionFile(cwd: string, id: string) {
  await unlink(await resolveSessionFile(cwd, id));
}
