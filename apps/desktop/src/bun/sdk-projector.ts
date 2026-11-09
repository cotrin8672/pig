import type {
  AgentSessionEvent,
  SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  emptyTranscript,
  type Message,
  type Transcript,
  type TranscriptRecord,
} from "../shared/transcript";

function wireMessage(
  message: Extract<SessionEntry, { type: "message" }>["message"],
): Message | undefined {
  if (
    message.role === "user" ||
    message.role === "assistant" ||
    message.role === "toolResult"
  )
    return message;
  if (message.role === "custom")
    return {
      role: "custom",
      customType: message.customType,
      content: message.content,
      display: message.display,
      details: message.details,
      timestamp: message.timestamp,
    };
}
export function projectEntries(
  manager: Pick<
    SessionManager,
    "getEntries" | "getLeafId" | "getBranch" | "getTree"
  >,
): Transcript {
  const state = emptyTranscript();
  const branchId = manager.getLeafId() ?? "root";
  // SessionManager retains the complete tree. The GUI displays the selected
  // branch, not discarded answers from an earlier rewind.
  manager.getEntries();
  manager.getTree();
  for (const entry of manager.getBranch()) {
    const base = {
      id: entry.id,
      entryId: entry.id,
      parentId: entry.parentId,
      branchId,
      order: state.records.length,
    };
    let record: TranscriptRecord;
    if (entry.type === "message" && wireMessage(entry.message)) {
      const message = wireMessage(entry.message) as Message;
      record = { ...base, kind: "message", message };
      if (message.role === "toolResult")
        state.tools[message.toolCallId] = {
          status: message.isError ? "error" : "done",
          result: { content: message.content, details: message.details },
        };
    } else if (entry.type === "custom_message") {
      const message: Message = {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        details: entry.details,
        display: entry.display,
        timestamp: Date.parse(entry.timestamp),
      };
      record = {
        ...base,
        kind: "message",
        message,
        customType: entry.customType,
        details: entry.details,
        display: entry.display,
        rendererKey: entry.customType,
      };
    } else if (entry.type === "custom")
      record = {
        ...base,
        kind: "custom-entry",
        customType: entry.customType,
        data: entry.data,
        rendererKey: entry.customType,
      };
    else
      record = {
        ...base,
        kind: "session-entry",
        entryType: entry.type,
        data: entry,
      };
    state.records.push(record);
  }
  return state;
}

/** A projection only: persistence, tree, context and execution remain SDK-owned. */
export class SDKProjector {
  private counter = 0;
  private live?: TranscriptRecord & { kind: "message" };
  private liveBefore = new Set<string>();
  private aliases: Record<string, string> = {};
  private tools: Transcript["tools"] = {};
  running = false;
  failure?: string;
  aborted = false;
  constructor(
    private readonly manager: SessionManager,
    private readonly epoch: number,
  ) {}
  fail(error: unknown) {
    this.failure = error instanceof Error ? error.message : String(error);
  }
  event(event: AgentSessionEvent) {
    // SDK publishes message_end before persistence. Reconcile it at the next
    // event before assigning another live ID, never by timestamp identity.
    this.commitLive();
    if (event.type === "agent_start") {
      this.running = true;
      this.failure = undefined;
      this.aborted = false;
    }
    if (
      event.type === "message_start" ||
      event.type === "message_update" ||
      event.type === "message_end"
    ) {
      const message = wireMessage(event.message);
      if (message) {
        if (!this.live || event.type === "message_start") {
          this.liveBefore = new Set(
            this.manager.getEntries().map((entry) => entry.id),
          );
          this.live = {
            id: `live:${this.epoch}:${++this.counter}`,
            parentId: this.manager.getLeafId(),
            branchId: this.manager.getLeafId() ?? "root",
            order: this.manager.getEntries().length,
            kind: "message",
            message,
          };
        } else this.live.message = message;
        if (message.role === "assistant" && message.stopReason === "error")
          this.failure = message.errorMessage ?? "Model request failed";
        if (event.type === "message_end") this.commitLive();
      }
    }
    if (event.type === "entry_appended") this.commitLive();
    if (event.type === "tool_execution_start")
      this.tools[event.toolCallId] = { status: "running" };
    if (event.type === "tool_execution_update")
      this.tools[event.toolCallId] = {
        status: "running",
        result: event.partialResult,
      };
    if (event.type === "tool_execution_end")
      this.tools[event.toolCallId] = {
        status: event.isError ? "error" : "done",
        result: event.result,
      };
    if (event.type === "compaction_end" && event.errorMessage)
      this.failure = event.errorMessage;
    if (event.type === "auto_retry_end" && event.finalError)
      this.failure = event.finalError;
    // agent_end is not completion: before-settle hooks may still be executing.
    if (event.type === "agent_settled") {
      this.running = false;
      this.aborted = event.aborted;
      this.commitLive();
    }
  }
  private commitLive() {
    if (!this.live) return;
    const live = this.live;
    const saved = [...projectEntries(this.manager).records]
      .reverse()
      .find(
        (r) =>
          r.kind === "message" &&
          !this.liveBefore.has(r.id) &&
          JSON.stringify(r.message) === JSON.stringify(live.message) &&
          !Object.values(this.aliases).includes(r.id),
      );
    if (saved) {
      this.aliases[live.id] = saved.id;
      this.live = undefined;
    }
  }
  snapshot(): Transcript {
    this.commitLive();
    const state = projectEntries(this.manager);
    if (this.live) state.records.push(structuredClone(this.live));
    state.tools = { ...state.tools, ...structuredClone(this.tools) };
    state.liveToEntry = { ...this.aliases };
    state.current = this.live?.id ?? null;
    state.running = this.running;
    return state;
  }
}
