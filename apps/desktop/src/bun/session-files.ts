import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type AgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "../shared/rpc-schema";

function projectKey(cwd: string) {
  const path = resolve(cwd);
  return process.platform === "win32" ? path.toLowerCase() : path;
}
export async function listStoredSessions(cwd: string, sessionDir?: string) {
  const key = projectKey(cwd);
  // Different projects can share pi's lossy encoded history directory.
  return (await SessionManager.list(cwd, sessionDir)).filter(
    (session) => projectKey(session.cwd) === key,
  );
}

export function sessionName(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid chat name.");
  const name = value.replace(/[\r\n]+/g, " ").trim();
  if (!name || name.length > 512)
    throw new Error("Enter a chat name of 1–512 characters.");
  return name;
}
export function renameStoredSession(info: SessionInfo, name: string) {
  if (!info.path) throw new Error("Chat history is unavailable.");
  const safeName = sessionName(name);
  const manager = SessionManager.open(info.path);
  if (manager.getSessionId() !== info.id || manager.getCwd() !== info.cwd)
    throw new Error("Chat history changed. Refresh the session list.");
  manager.appendSessionInfo(safeName);
  return manager.getSessionName() ?? name;
}
export function assertSessionDeletable(
  session?: Pick<AgentSession, "isIdle" | "isBashRunning">,
  prompting = false,
) {
  if (prompting || (session && (!session.isIdle || session.isBashRunning)))
    throw new Error("Stop the current response before deleting this chat.");
}
export async function removeStoredSession(info: SessionInfo) {
  if (!info.path) return;
  try {
    await unlink(info.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
