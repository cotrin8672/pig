import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  type ChatHistoryImportResult,
  type ChatHistoryItem,
  type ChatHistoryPreview,
  IMPORTED_HISTORY_PROVIDER,
} from "../shared/chat-history-import";
import type {
  HistoryConversation,
  ParsedChatHistory,
} from "./chat-history-parser";
import type { ChatHistoryWorkerReply } from "./chat-history-worker";
import { agentDir } from "./runtime-profile";
import { SessionManager } from "./sdk";
import { defaultSessionDir } from "./session-directory";
import { sessionDirFor } from "./session-files";

const sourceModels = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  codex: "Codex",
  "claude-code": "Claude Code",
} as const;

function sessionEntries(conversation: HistoryConversation, cwd: string) {
  const { id: _previewId, ...content } = conversation;
  const scope =
    process.platform === "win32" ? resolve(cwd).toLowerCase() : resolve(cwd);
  const hash = createHash("sha256")
    .update(JSON.stringify([1, scope, content]))
    .digest("hex");
  const id = `import-${hash.slice(0, 32)}`;
  const manager = SessionManager.inMemory(cwd, { id });
  const root = manager.appendCustomEntry("desktop.import", {
    version: 1,
    source: conversation.source,
    sourceId: conversation.sourceId,
    warnings: conversation.warnings,
  });
  const ids = new Map<string, string>();
  for (const node of conversation.nodes) {
    manager.branch(node.parentId ? (ids.get(node.parentId) as string) : root);
    ids.set(
      node.id,
      manager.appendMessage(
        node.role === "user"
          ? { role: "user", content: node.text, timestamp: node.timestamp }
          : {
              role: "assistant",
              content: [{ type: "text", text: node.text }],
              timestamp: node.timestamp,
              api: "openai-completions",
              provider: IMPORTED_HISTORY_PROVIDER,
              model: node.model || sourceModels[conversation.source],
              stopReason: "stop",
              // SDK-required defaults, never presented as measured usage.
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              },
            },
      ),
    );
  }
  manager.branch(ids.get(conversation.activeId) as string);
  // The last persisted entry determines the active branch after reopening.
  manager.appendSessionInfo(conversation.title);
  const first = conversation.nodes.reduce(
    (earliest, node) =>
      node.timestamp > 0 ? Math.min(earliest, node.timestamp) : earliest,
    Number.POSITIVE_INFINITY,
  );
  const created = Number.isFinite(first) ? first : Date.now();
  const modified = conversation.modified || created;
  return {
    id,
    entries: [
      { ...manager.getHeader(), timestamp: new Date(created).toISOString() },
      ...manager.getEntries().map((entry) => ({
        ...entry,
        timestamp: new Date(
          entry.type === "message" &&
            (entry.message.role === "user" ||
              entry.message.role === "assistant")
            ? entry.message.timestamp
            : entry.type === "session_info"
              ? modified
              : created,
        ).toISOString(),
      })),
    ],
  };
}

export async function publishChatHistory(
  conversation: HistoryConversation,
  cwd: string,
  directory?: string,
): Promise<"copied" | "skipped"> {
  const dir =
    directory ?? (await sessionDirFor(cwd)) ?? defaultSessionDir(cwd, agentDir);
  await mkdir(dir, { recursive: true });
  const { id, entries } = sessionEntries(conversation, cwd);
  const destination = join(dir, `${id}.jsonl`);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      { flag: "wx", mode: 0o600 },
    );
    // Unlike rename(), link() cannot replace a concurrently created session.
    await link(temporary, destination);
    return "copied";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return "skipped";
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export function recordChatHistoryFailure(
  result: ChatHistoryImportResult,
  item: ChatHistoryItem,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  result.failed++;
  result.errors ??= [];
  result.errors.push({ id: item.id, title: item.title, message });
  console.error(`[chat-history-import] ${item.source} ${item.id}: ${message}`);
}

export class ChatHistoryImports {
  private plan?: ParsedChatHistory & { id: string };
  private generation = 0;
  private cancelRead?: () => void;
  private busy = false;

  clear() {
    this.generation++;
    this.plan = undefined;
    this.cancelRead?.();
  }

  async prepare(file: string): Promise<ChatHistoryPreview> {
    if (this.busy) throw new Error("An import is already running.");
    this.clear();
    const generation = this.generation;
    const bundled = new URL("./chat-history-worker.js", import.meta.url);
    const url = existsSync(bundled)
      ? bundled
      : new URL("./chat-history-worker.ts", import.meta.url);
    const parsed = await new Promise<ParsedChatHistory>((resolve, reject) => {
      const worker = new Worker(url.href, { name: "pig-chat-history" });
      let settled = false;
      const finish = (error?: string, value?: ParsedChatHistory) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancelRead = undefined;
        worker.terminate();
        if (error) reject(new Error(error));
        else resolve(value as ParsedChatHistory);
      };
      const timer = setTimeout(
        () => finish("Reading the export timed out."),
        60_000,
      );
      this.cancelRead = () => finish("Import cancelled.");
      worker.onmessage = ({ data }: MessageEvent<ChatHistoryWorkerReply>) =>
        "error" in data ? finish(data.error) : finish(undefined, data.parsed);
      worker.onerror = () => finish("Could not read the conversation export.");
      worker.postMessage(file);
    });
    if (generation !== this.generation) throw new Error("Import cancelled.");
    const id = crypto.randomUUID();
    this.plan = { ...parsed, id };
    return {
      id,
      kind: "file",
      label: basename(file),
      conversations: parsed.conversations.map(
        ({ nodes: _nodes, activeId: _active, sourceId: _sourceId, ...item }) =>
          item,
      ),
      rejected: parsed.rejected,
    };
  }

  async import(
    input: {
      previewId: string;
      cwd: string;
      ids: string[] | null;
    },
    directory?: string,
  ): Promise<ChatHistoryImportResult> {
    const plan = this.plan;
    if (this.busy) throw new Error("An import is already running.");
    if (!plan || input?.previewId !== plan.id)
      throw new Error("Choose the export file again.");
    if (typeof input.cwd !== "string" || !input.cwd)
      throw new Error("Choose a destination project.");
    const available = new Set(plan.conversations.map((item) => item.id));
    if (
      input.ids !== null &&
      (!Array.isArray(input.ids) ||
        !input.ids.length ||
        !input.ids.every((id) => typeof id === "string" && available.has(id)))
    )
      throw new Error("Choose conversations from this export.");
    const selected = input.ids === null ? available : new Set(input.ids);
    const generation = this.generation;
    this.busy = true;
    try {
      const dir =
        directory ??
        (await sessionDirFor(input.cwd)) ??
        defaultSessionDir(input.cwd, agentDir);
      await mkdir(dir, { recursive: true });
      const result: ChatHistoryImportResult = {
        copied: 0,
        skipped: 0,
        failed: 0,
      };
      for (const conversation of plan.conversations) {
        if (generation !== this.generation) break;
        if (!selected.has(conversation.id)) continue;
        try {
          const status = await publishChatHistory(conversation, input.cwd, dir);
          result[status]++;
        } catch (error) {
          recordChatHistoryFailure(result, conversation, error);
        }
        await Bun.sleep(0);
      }
      return result;
    } finally {
      this.busy = false;
    }
  }
}
