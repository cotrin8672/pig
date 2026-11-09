import type { Context } from "@earendil-works/chord";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  type Conversation,
  ConversationTranscript,
  type ConversationView,
  type ConversationWatch,
  type EntryRecord,
  type LiveState,
  type TranscriptView,
} from "@earendil-works/pi-durable";
import type { ContextUsage } from "../shared/rpc-schema";
import {
  emptyTranscript,
  type Transcript,
  type TranscriptRecord,
} from "../shared/transcript";

export interface DurableProjectorOptions {
  onChange?: () => void | Promise<void>;
  onFailure?: (error: unknown) => void;
  /** DTO-only image policy. Persistence, context images and input normalization have separate owners. */
  imagePolicy?: (image: ImageContent) => ImageContent | TextContent;
}

const builtinKinds = new Set([
  "pi.user",
  "pi.assistant",
  "pi.tool-result",
  "pi.system",
  "pi.reset",
  "pi.compaction",
]);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const messageId = (entry: EntryRecord, index: number) =>
  `entry:${entry.id}:message:${index}`;

/** Unknown extension payloads remain inspectable without making snapshots unbounded/non-serializable. */
function bounded(value: unknown): unknown {
  let remaining = 32_768;
  let nodes = 2048;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (--nodes < 0 || remaining <= 0 || depth > 12) return "[truncated]";
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number")
      return Number.isFinite(item) ? item : String(item);
    if (typeof item === "string") {
      const size = Math.min(item.length, remaining, 8192);
      remaining -= size;
      return size < item.length ? `${item.slice(0, size)}[truncated]` : item;
    }
    if (typeof item !== "object") return `[${typeof item}]`;
    if (seen.has(item)) return "[circular]";
    seen.add(item);
    if (Array.isArray(item)) {
      const result = item.slice(0, 128).map((child) => visit(child, depth + 1));
      if (item.length > 128) result.push("[truncated]");
      seen.delete(item);
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(item).slice(0, 128)) {
      if (remaining <= 0 || nodes <= 0) {
        result["[truncated]"] = true;
        break;
      }
      remaining -= key.length;
      const name =
        key.length > 256 ? `${key.slice(0, 240)}[key:${nodes}]` : key;
      if (name !== key) result["[truncated keys]"] = true;
      result[name] = visit(child, depth + 1);
    }
    if (Object.keys(item).length > 128) result["[truncated]"] = true;
    seen.delete(item);
    return result;
  };
  return visit(value, 0);
}

function applyImagePolicy<T>(
  value: T,
  policy: NonNullable<DurableProjectorOptions["imagePolicy"]>,
): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => applyImagePolicy(item, policy)) as T;
  if (
    "type" in value &&
    value.type === "image" &&
    "data" in value &&
    "mimeType" in value
  )
    return policy(structuredClone(value) as ImageContent) as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      applyImagePolicy(item, policy),
    ]),
  ) as T;
}

type LiveIdentity = {
  id: string;
  taskId: number;
  timestamp: number;
  after: number;
};

/** A read/watch projection over native history. It never schedules tasks or owns domain documents. */
export class DurableProjector {
  private readonly history: ConversationTranscript;
  private watch?: ConversationWatch;
  private opening?: Promise<ConversationWatch>;
  private starting?: Promise<void>;
  private draining?: Promise<void>;
  private dirty = false;
  private disposed = false;
  private latest?: ConversationView;
  private state = emptyTranscript();
  private live?: LiveIdentity;
  private readonly aliases: Record<string, string> = Object.create(null);
  private projectionFailure?: string;
  private sourceFailure?: string;
  private wasAborted = false;

  constructor(
    private readonly conversation: Conversation,
    private readonly ctx: Context,
    private readonly options: DurableProjectorOptions = {},
  ) {
    this.history = new ConversationTranscript(
      (query, limit, context) =>
        conversation.entries(query, limit, undefined, context),
      { pageSize: 100 },
    );
  }

  get failure(): string | undefined {
    return this.sourceFailure ?? this.projectionFailure;
  }
  get aborted(): boolean {
    return this.wasAborted;
  }
  /** Native builtin documents only; domain document subscriptions belong to the host/domain owner. */
  get view(): ConversationView | undefined {
    return this.latest;
  }

  start(): Promise<void> {
    if (this.disposed)
      return Promise.reject(new Error("DurableProjector is disposed"));
    if (this.starting) return this.starting;
    if (this.watch) return this.refresh();
    const starting = this.attach();
    this.starting = starting;
    const clear = () => {
      if (this.starting === starting) this.starting = undefined;
    };
    starting.then(clear, clear);
    return starting;
  }

  private async attach(): Promise<void> {
    const opening = this.conversation.watch(this.ctx, this.history.resume);
    this.opening = opening;
    try {
      const watch = await opening;
      if (this.disposed) {
        await watch.stop();
        return;
      }
      this.watch = watch;
      this.latest = watch.value;
      watch.start(async (call) => {
        if (this.disposed || this.watch !== watch) return;
        if (call.kind === "failed") {
          this.fail(call.error);
          return;
        }
        this.latest = call.value;
        try {
          await this.invalidate();
        } catch (error) {
          this.fail(error);
        }
      });
      void watch.closed.then((end) => {
        if (this.disposed || this.watch !== watch) return;
        this.watch = undefined;
        if (end.kind === "failed" || end.kind === "listener_error")
          this.fail(end.error);
        else
          this.fail(
            new Error(
              `Native conversation watch ${end.kind}; refresh to reconnect`,
            ),
          );
      });
      await this.invalidate();
    } catch (error) {
      if (!this.disposed) this.fail(error);
      throw error;
    } finally {
      if (this.opening === opening) this.opening = undefined;
    }
  }

  snapshot(): Transcript {
    return structuredClone(this.state);
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (!this.watch) {
      await this.start();
      return;
    }
    this.latest = this.watch.value;
    try {
      await this.invalidate();
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private invalidate(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.dirty = true;
    if (this.draining) return this.draining;
    const draining = this.drain();
    this.draining = draining;
    const clear = () => {
      if (this.draining === draining) this.draining = undefined;
    };
    draining.then(clear, clear);
    return draining;
  }

  private async drain(): Promise<void> {
    while (this.dirty && !this.disposed && this.latest) {
      this.dirty = false;
      let full = this.history.merge(this.latest);
      // The existing UI has no gap controls: materialize ALL earlier/gap pages, never just the watch window.
      while (!this.disposed) {
        const missing = full.items.find((item) => item.kind !== "entry");
        if (!missing) break;
        const before = full.items;
        full =
          missing.kind === "earlier"
            ? await this.history.loadEarlier(this.ctx)
            : await this.history.fillGap(missing, this.ctx);
        if (full.items === before)
          throw new Error("Native transcript paging made no progress");
      }
      if (this.disposed) return;
      const next = this.project(full);
      this.state = this.options.imagePolicy
        ? applyImagePolicy(next, this.options.imagePolicy)
        : next;
      this.sourceFailure = undefined;
      try {
        await this.options.onChange?.();
      } catch (error) {
        this.fail(error);
        throw error;
      }
    }
  }

  private project(view: TranscriptView): Transcript {
    const state = emptyTranscript();
    state.tools = Object.create(null);
    const entries = view.items.flatMap((item) =>
      item.kind === "entry" ? [item.entry] : [],
    );
    const branchId = String(view.conversation.id);
    let parentId: string | null = null;
    let terminalFailure: string | undefined;
    let terminalAborted = false;
    for (const entry of entries) {
      const base = { entryId: String(entry.id), parentId, branchId };
      for (const [index, message] of (entry.model ?? []).entries()) {
        const id = messageId(entry, index);
        state.records.push({
          ...base,
          id,
          order: state.records.length,
          kind: "message",
          message: structuredClone(message),
        });
        if (message.role === "user") {
          terminalFailure = undefined;
          terminalAborted = false;
        }
        if (message.role === "assistant") {
          terminalFailure =
            message.stopReason === "error"
              ? (message.errorMessage ?? "Model request failed")
              : undefined;
          terminalAborted = message.stopReason === "aborted";
          if (
            this.live &&
            entry.id > this.live.after &&
            entry.byTaskId === this.live.taskId &&
            message.timestamp === this.live.timestamp
          )
            this.aliases[this.live.id] = id;
        }
        if (message.role === "toolResult")
          state.tools[message.toolCallId] = {
            status: message.isError ? "error" : "done",
            result: {
              content: structuredClone(message.content),
              details: bounded(message.details ?? entry.data),
            },
          };
      }
      if (
        !builtinKinds.has(entry.kind) ||
        !entry.model?.length ||
        entry.data !== undefined ||
        entry.head !== undefined ||
        entry.edits !== undefined
      ) {
        const record: TranscriptRecord = {
          ...base,
          id: `entry:${entry.id}:data`,
          order: state.records.length,
          ...(entry.kind.startsWith("pi.")
            ? {
                kind: "session-entry" as const,
                entryType: entry.kind,
                data: bounded(entry),
              }
            : {
                kind: "custom-entry" as const,
                customType: entry.kind,
                rendererKey: entry.kind,
                data: bounded(entry),
              }),
        };
        state.records.push(record);
      }
      // Native entries have no SDK tree parent: this is the predecessor in the fork-aware visible history.
      parentId = String(entry.id);
    }
    const live = (view.docs["pi.live"] ?? {}) as LiveState;
    state.running =
      !!live.run ||
      !!live.generation ||
      !!live.compactions?.length ||
      [...(live.tools ?? []), ...(live.nestedTools ?? [])].some(
        (tool) => tool.status !== "done",
      );
    const failure = live.runFailure;
    this.wasAborted =
      failure?.reason === "aborted" || (!live.run && terminalAborted);
    this.projectionFailure =
      failure && failure.reason !== "aborted"
        ? `${failure.reason}${failure.detail ? `: ${failure.detail}` : ""}`
        : failure?.reason === "aborted" || live.run
          ? undefined
          : terminalFailure;
    if (live.compactionFailure)
      this.projectionFailure = [
        this.projectionFailure,
        `Compaction failed: ${live.compactionFailure.error}`,
      ]
        .filter(Boolean)
        .join("\n");

    const partial = live.generation?.message;
    if (partial && live.run) {
      const id = `live:${view.conversation.id}:${live.run.taskId}:${live.generation?.attempt}`;
      if (this.live?.id !== id)
        this.live = {
          id,
          taskId: live.run.taskId,
          timestamp: partial.timestamp,
          after: entries.at(-1)?.id ?? 0,
        };
      state.records.push({
        id,
        parentId,
        branchId,
        order: state.records.length,
        kind: "message",
        message: structuredClone(partial),
      });
      state.current = id;
    } else this.live = undefined;
    for (const tool of live.tools ?? []) {
      // A terminal slot without a persisted result is NOT a successful tool invocation.
      if (tool.status === "done" && state.tools[tool.callId]) continue;
      state.tools[tool.callId] = {
        status: tool.status === "done" ? "error" : "running",
        result: {
          content: [{ type: "text", text: tool.output ?? "" }],
          details: bounded(tool),
          ...(tool.status === "done"
            ? { error: "Tool ended without a persisted result" }
            : {}),
        },
      };
    }
    for (const tool of live.nestedTools ?? [])
      state.tools[tool.callId] = {
        status:
          tool.status !== "done"
            ? "running"
            : tool.summary && !tool.summary.isError
              ? "done"
              : "error",
        result: {
          content: [{ type: "text", text: tool.output ?? "" }],
          details: bounded(tool),
        },
      };
    state.liveToEntry = { ...this.aliases };
    return state;
  }

  /** The host supplies its workspace-resolved model window; no global model registry or cumulative spend. */
  async contextUsage(contextWindow?: number): Promise<ContextUsage | null> {
    if (
      this.disposed ||
      !contextWindow ||
      !Number.isFinite(contextWindow) ||
      contextWindow <= 0
    )
      return null;
    const context = await this.conversation.context(this.ctx);
    if (this.disposed) return null;
    const tokens = estimateContextTokens(context.messages).tokens;
    return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
  }

  private fail(error: unknown): void {
    if (this.disposed) return;
    this.sourceFailure = errorText(error);
    try {
      this.options.onFailure?.(error);
    } catch (callbackError) {
      this.sourceFailure = `${this.sourceFailure}; onFailure: ${errorText(callbackError)}`;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.dirty = false;
    const watch = this.watch;
    this.watch = undefined;
    await watch?.stop();
    // An attachment still in flight must also be released. Native stop does not join caller-owned callbacks.
    if (this.opening) await (await this.opening).stop();
  }
}
