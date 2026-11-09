import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import {
  type ConversationId,
  defineDoc,
  type EntryId,
} from "@earendil-works/pi-durable";

export type WorkspaceIdentity = { key: string; cwd: string };

/** Identity is canonical and opaque on the wire; agent.cwd is NOT membership. */
export async function workspaceIdentity(
  cwd: string,
): Promise<WorkspaceIdentity> {
  if (typeof cwd !== "string" || !isAbsolute(cwd) || cwd.includes("\0"))
    throw new TypeError("Workspace cwd must be an absolute directory");
  let canonical = normalize(await realpath(cwd));
  if (!(await stat(canonical)).isDirectory())
    throw new TypeError("Workspace cwd must be a directory");
  if (process.platform === "win32") canonical = canonical.toLowerCase();
  return {
    key: createHash("sha256").update(canonical).digest("hex").slice(0, 32),
    cwd: canonical,
  };
}

export function conversationAppId(
  workspaceKey: string,
  id: ConversationId,
): string {
  if (
    !/^[a-f0-9]{32}$/.test(workspaceKey) ||
    !Number.isSafeInteger(id) ||
    id <= 0
  )
    throw new TypeError("Invalid native conversation identity");
  return `d2_${workspaceKey}_${id}`;
}

export function parseConversationAppId(value: string): {
  workspaceKey: string;
  id: ConversationId;
} {
  const match =
    typeof value === "string" &&
    /^d2_([a-f0-9]{32})_([1-9][0-9]*)$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[2])))
    throw new TypeError("INVALID_NATIVE_SESSION_ID");
  return { workspaceKey: match[1], id: Number(match[2]) as ConversationId };
}

/** Entry IDs are decimal native IDs, not transcript row IDs or SDK UUIDs. */
export function parseNativeEntryId(value: string): EntryId {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new TypeError("INVALID_NATIVE_ENTRY_ID");
  return Number(value) as EntryId;
}

export type PigConversationMetadata = {
  workspaceKey: string;
  canonicalCwd: string;
  conversationId: number;
  profile: string;
  title: string;
  titleExplicit: boolean;
  createdAt: number;
  modifiedAt: number;
};

/** A fork gets new identity/times, initialized atomically by WorkspaceRuntime. */
export const PigConversationMeta = defineDoc<PigConversationMetadata>({
  kind: "pig.conversation-meta",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({
    workspaceKey: "",
    canonicalCwd: "",
    conversationId: 0,
    profile: "",
    title: "New chat",
    titleExplicit: false,
    createdAt: 0,
    modifiedAt: 0,
  }),
  checkpointWhen: () => true,
});

export const PigWorkspaceMeta = defineDoc({
  kind: "pig.workspace-meta",
  version: 1,
  scope: "session",
  initial: () => ({ workspaceKey: "", canonicalCwd: "" }),
  checkpointWhen: () => true,
});

export function assertConversationMembership(
  meta: Readonly<PigConversationMetadata> | undefined,
  workspace: WorkspaceIdentity,
  conversationId: ConversationId,
): asserts meta is Readonly<PigConversationMetadata> {
  if (
    !meta ||
    meta.workspaceKey !== workspace.key ||
    meta.canonicalCwd !== workspace.cwd ||
    meta.conversationId !== conversationId ||
    !meta.profile ||
    typeof meta.title !== "string" ||
    typeof meta.titleExplicit !== "boolean" ||
    !Number.isFinite(meta.createdAt) ||
    meta.createdAt <= 0 ||
    !Number.isFinite(meta.modifiedAt) ||
    meta.modifiedAt < meta.createdAt
  )
    throw new Error("CONVERSATION_WORKSPACE_MISMATCH");
}
