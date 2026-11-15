import { Database } from "bun:sqlite";
import { createReadStream, existsSync } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
  ChatHistoryImportResult,
  ChatHistoryItem,
  ChatHistoryPreview,
  ChatHistoryWarning,
  LocalHistorySource,
} from "../shared/chat-history-import";
import {
  publishChatHistory,
  recordChatHistoryFailure,
} from "./chat-history-import";
import type { HistoryConversation, HistoryNode } from "./chat-history-parser";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const time = (value: unknown, fallback: number) => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};
// Harness-injected context, not something the user typed.
const injected =
  /^\s*(<(environment_context|user_instructions|permissions|turn_aborted|subagent_notification|user_shell_command|skill|command-|local-command-|system-reminder|bash-|task-notification)|# AGENTS\.md instructions|Caveat: The messages below)/;

type LocalItem = ChatHistoryItem & { file: string; sourceId: string };

// Codex records extended Windows paths. The SDK embeds cwd in a folder name,
// where the namespace's "?" is illegal; use ordinary drive/UNC paths instead.
function workspacePath(path: string | null | undefined) {
  return (
    path
      ?.replace(/^\\\\\?\\UNC\\/i, "\\\\")
      .replace(/^\\\\\?\\(?=[a-z]:\\)/i, "") || undefined
  );
}

/** Streams JSONL records; a torn final line from a live writer is skipped. */
async function* records(file: string): AsyncGenerator<JsonObject> {
  const lines = file.endsWith(".zst")
    ? new TextDecoder()
        .decode(Bun.zstdDecompressSync(await readFile(file)))
        .split("\n")
    : createInterface({
        input: createReadStream(file, { encoding: "utf8" }),
        crlfDelay: Number.POSITIVE_INFINITY,
      });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const value = object(JSON.parse(line));
      if (value) yield value;
    } catch {
      /* partial or foreign line */
    }
  }
}

/** Consecutive assistant output (tool round trips) reads as one reply. */
function pushNode(
  nodes: HistoryNode[],
  role: HistoryNode["role"],
  body: string,
  timestamp: number,
  model: string,
) {
  const last = nodes.at(-1);
  if (role === "assistant" && last?.role === "assistant") {
    last.text += `\n\n${body}`;
    last.model ||= model;
    return;
  }
  nodes.push({
    id: `n${nodes.length}`,
    parentId: last?.id ?? null,
    role,
    text: body,
    timestamp,
    model,
  });
}

function conversation(
  item: LocalItem,
  nodes: HistoryNode[],
  warnings: Set<ChatHistoryWarning>,
): HistoryConversation {
  if (!nodes.length)
    throw new Error(
      "No user or assistant text messages were found in this history.",
    );
  return {
    ...item,
    messageCount: nodes.length,
    modified: nodes.reduce((m, n) => Math.max(m, n.timestamp), item.modified),
    warnings: [...warnings],
    nodes,
    activeId: nodes.at(-1)?.id as string,
  };
}

/** Codex rollout (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`). */
export async function readCodexRollout(
  item: LocalItem,
): Promise<HistoryConversation> {
  const nodes: HistoryNode[] = [];
  const warnings = new Set<ChatHistoryWarning>();
  let model = "";
  for await (const line of records(item.file)) {
    const payload = object(line.payload);
    if (!payload) continue;
    const at = time(line.timestamp, item.modified);
    if (line.type === "turn_context") model = text(payload.model) || model;
    if (line.type === "event_msg" && payload.type === "thread_settings_applied")
      model = text(object(payload.thread_settings)?.model) || model;
    if (line.type !== "response_item") continue;
    if (payload.type === "reasoning") warnings.add("reasoning");
    else if (/call|output/.test(text(payload.type))) warnings.add("tools");
    if (payload.type !== "message") continue;
    const role = payload.role;
    if (role === "developer" || role === "system") continue;
    if (role !== "user" && role !== "assistant") continue;
    const parts: string[] = [];
    for (const value of Array.isArray(payload.content) ? payload.content : []) {
      const part = object(value);
      if (/image|file/.test(text(part?.type))) warnings.add("attachments");
      const body = text(part?.text);
      if (body.trim()) parts.push(body);
    }
    const body = parts.join("\n\n");
    if (!body.trim() || (role === "user" && injected.test(body))) continue;
    pushNode(nodes, role, body, at, model);
  }
  return conversation(item, nodes, warnings);
}

/** Claude Code / Claude desktop Code session (`~/.claude/projects/<dir>/<id>.jsonl`). */
export async function readClaudeSession(
  item: LocalItem,
): Promise<HistoryConversation> {
  const byId = new Map<string, JsonObject>();
  let leaf: JsonObject | undefined;
  for await (const line of records(item.file)) {
    const uuid = text(line.uuid);
    if (uuid) byId.set(uuid, line);
    if (
      (line.type === "user" || line.type === "assistant") &&
      line.isSidechain !== true
    )
      leaf = line;
  }
  // Follow the selected branch back from the last message (rewinds fork the tree).
  const branch: JsonObject[] = [];
  const seen = new Set<string>();
  for (let at = leaf; at; ) {
    const uuid = text(at.uuid);
    if (seen.has(uuid)) break;
    seen.add(uuid);
    branch.push(at);
    at = byId.get(text(at.parentUuid));
  }
  const nodes: HistoryNode[] = [];
  const warnings = new Set<ChatHistoryWarning>();
  for (const line of branch.reverse()) {
    const role = line.type;
    if ((role !== "user" && role !== "assistant") || line.isMeta === true)
      continue;
    const message = object(line.message);
    const parts: string[] = [];
    const content = message?.content;
    for (const value of typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content
        : []) {
      const part = object(value);
      const kind = text(part?.type);
      if (kind === "text") {
        const body = text(part?.text);
        if (body.trim()) parts.push(body);
      } else if (kind === "thinking" || kind === "redacted_thinking")
        warnings.add("reasoning");
      else if (kind === "tool_use" || kind === "tool_result")
        warnings.add("tools");
      else if (kind) warnings.add("attachments");
    }
    const body = parts.join("\n\n");
    if (!body.trim() || (role === "user" && injected.test(body))) continue;
    const model = text(message?.model);
    pushNode(
      nodes,
      role,
      body,
      time(line.timestamp, item.modified),
      model === "<synthetic>" ? "" : model,
    );
  }
  return conversation(item, nodes, warnings);
}

/** Codex keeps a thread index; subagent threads are internal and stay hidden. */
async function listCodex(home: string): Promise<LocalItem[]> {
  const file = join(home, ".codex", "state_5.sqlite");
  if (!existsSync(file)) return [];
  const db = new Database(file, { readonly: true });
  // prepare(), not the cached query(): a finalized statement lets close() release
  // Codex's live database file instead of holding it open.
  const statement = db.prepare(
    `select id, rollout_path, title, preview, cwd, updated_at_ms, updated_at
     from threads where source not like '{"subagent%'
     order by coalesce(updated_at_ms, updated_at * 1000) desc`,
  );
  try {
    const rows = statement.all() as {
      id: string;
      rollout_path: string;
      title: string;
      preview: string | null;
      cwd: string | null;
      updated_at_ms: number | null;
      updated_at: number | null;
    }[];
    return rows.flatMap((row) => {
      const path = [row.rollout_path, `${row.rollout_path}.zst`].find(
        (candidate) => candidate && existsSync(candidate),
      );
      if (!path) return [];
      return [
        {
          id: row.id,
          sourceId: row.id,
          file: path,
          source: "codex" as const,
          title:
            (row.title || row.preview || "Codex")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 200) || "Codex",
          modified: row.updated_at_ms ?? (row.updated_at ?? 0) * 1000,
          workspace: workspacePath(row.cwd),
          warnings: [],
        },
      ];
    });
  } finally {
    statement.finalize();
    db.close();
  }
}

/** Title and project from the head of a session, without reading the whole file. */
async function claudeHead(file: string) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    let title = "";
    let cwd = "";
    for (const line of buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .split("\n")) {
      let value: JsonObject | undefined;
      try {
        value = object(JSON.parse(line));
      } catch {
        continue;
      }
      if (!value) continue;
      cwd ||= text(value.cwd);
      if (value.type === "summary") title = text(value.summary) || title;
      if (title || value.type !== "user" || value.isMeta || value.isSidechain)
        continue;
      const content = object(value.message)?.content;
      const body =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.map((part) => text(object(part)?.text)).join(" ")
            : "";
      if (body.trim() && !injected.test(body)) title = body.trim();
    }
    return { title: title.replace(/\s+/g, " ").slice(0, 200), cwd };
  } finally {
    await handle.close();
  }
}

async function listClaude(home: string): Promise<LocalItem[]> {
  const root = join(home, ".claude", "projects");
  if (!existsSync(root)) return [];
  const items: LocalItem[] = [];
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const dir = join(root, project.name);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const file = join(dir, entry.name);
      const [info, head] = await Promise.all([stat(file), claudeHead(file)]);
      if (!head.title) continue;
      const id = entry.name.slice(0, -".jsonl".length);
      items.push({
        id: `${project.name}/${id}`,
        sourceId: id,
        file,
        source: "claude-code",
        title: head.title,
        modified: info.mtimeMs,
        workspace: workspacePath(head.cwd),
        warnings: [],
      });
    }
  }
  return items.sort((a, b) => b.modified - a.modified);
}

export const localHistoryLabels: Record<LocalHistorySource, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

/** Desktop apps' own history files: readable without any sign-in. */
export class LocalChatHistory {
  private plan?: { id: string; source: LocalHistorySource; items: LocalItem[] };
  private busy = false;
  private generation = 0;
  constructor(private readonly home = homedir()) {}

  clear() {
    this.generation++;
    this.plan = undefined;
  }
  owns(previewId: string) {
    return this.plan?.id === previewId;
  }

  async list(source: LocalHistorySource): Promise<ChatHistoryPreview> {
    if (source !== "codex" && source !== "claude-code")
      throw new Error("Unknown history source.");
    this.clear();
    const generation = this.generation;
    const items =
      source === "codex"
        ? await listCodex(this.home)
        : await listClaude(this.home);
    if (generation !== this.generation) throw new Error("Cancelled.");
    if (!items.length)
      throw new Error(
        `No ${localHistoryLabels[source]} history was found on this computer.`,
      );
    const id = crypto.randomUUID();
    this.plan = { id, source, items };
    return {
      id,
      kind: "local",
      source,
      label: localHistoryLabels[source],
      rejected: 0,
      conversations: items.map(
        ({ file: _file, sourceId: _sourceId, ...item }) => item,
      ),
    };
  }

  async import(
    input: {
      previewId: string;
      // A fixed scope, or one chosen per chat from its original workspace.
      cwd: string | ((workspace?: string) => Promise<string>);
      ids: string[] | null;
    },
    directory?: string,
  ): Promise<ChatHistoryImportResult> {
    const plan = this.plan;
    if (this.busy) throw new Error("An import is already running.");
    if (!plan || input?.previewId !== plan.id)
      throw new Error("Choose the history source again.");
    if (
      !(
        typeof input.cwd === "function" ||
        (typeof input.cwd === "string" && input.cwd)
      ) ||
      (input.ids !== null &&
        (!Array.isArray(input.ids) ||
          !input.ids.every((value) => typeof value === "string")))
    )
      throw new Error("Invalid history import request.");
    const requested = input.ids === null ? null : new Set(input.ids);
    const selected =
      requested === null
        ? plan.items
        : plan.items.filter((item) => requested.has(item.id));
    if (!selected.length || (requested && requested.size !== selected.length))
      throw new Error("Choose conversations from this list.");
    const generation = this.generation;
    const read = plan.source === "codex" ? readCodexRollout : readClaudeSession;
    const result: ChatHistoryImportResult = {
      copied: 0,
      skipped: 0,
      failed: 0,
    };
    this.busy = true;
    try {
      for (const item of selected) {
        if (generation !== this.generation) break;
        try {
          const cwd =
            typeof input.cwd === "string"
              ? input.cwd
              : await input.cwd(item.workspace);
          result[await publishChatHistory(await read(item), cwd, directory)]++;
        } catch (error) {
          recordChatHistoryFailure(result, item, error);
        }
        // Large rollouts are streamed; yield between chats to keep the host responsive.
        await Bun.sleep(0);
      }
      return result;
    } finally {
      this.busy = false;
    }
  }
}
