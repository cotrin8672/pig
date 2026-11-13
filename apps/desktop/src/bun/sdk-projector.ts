import type {
  AgentSessionEvent,
  SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { unfoldPastes } from "../shared/paste";
import type { SendIntent, SendKey } from "../shared/runtime-contract";
import {
  emptyTranscript,
  type Message,
  type Transcript,
  type TranscriptRecord,
} from "../shared/transcript";
import {
  type RecoveredPrompt,
  type RunDiagnostic,
  type SessionDiagnosticStore,
  SessionDiagnostics,
} from "./session-diagnostics";

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
  manager: Pick<SessionManager, "getLeafId" | "getBranch">,
  offset = 0,
): Transcript {
  const state = emptyTranscript();
  const branchId = manager.getLeafId() ?? "root";
  // SessionManager retains the complete tree. The GUI displays the selected
  // branch, not discarded answers from an earlier rewind.
  for (const entry of manager.getBranch()) {
    const base = {
      id: entry.id,
      entryId: entry.id,
      parentId: entry.parentId,
      branchId,
      order: offset + state.records.length,
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
  private liveBefore: string | null = null;
  private liveChecked?: SessionEntry;
  private aliases: Record<string, string> = {};
  private requestIds = new Map<string, string>();
  private tools: Transcript["tools"] = {};
  private historyRevision = crypto.randomUUID();
  private branchLeaf?: SessionEntry;
  private branch: SessionEntry[] = [];
  private branchIds = new Set<string>();
  private page?: Transcript;
  running = false;
  failure?: string;
  aborted = false;
  readonly diagnostics: SessionDiagnostics;
  private recovered: (RecoveredPrompt & {
    message: Extract<Message, { role: "user" }>;
  })[] = [];
  constructor(
    private readonly manager: SessionManager,
    private readonly epoch: number,
    diagnostics?: SessionDiagnosticStore,
  ) {
    this.diagnostics = new SessionDiagnostics(manager, diagnostics);
    const run = this.diagnostics.value.run;
    const branch = this.entries();
    if (
      run &&
      (run.leafId === manager.getLeafId() ||
        (run.status === "running" &&
          (!run.leafId || branch.some((entry) => entry.id === run.leafId))))
    ) {
      this.failure =
        run.status === "running"
          ? "Previous run ended without a confirmed completion; execution status is unknown."
          : run.failure;
      this.aborted = run.status === "aborted";
    } else {
      this.diagnostics.value.run = undefined;
      this.failure = this.diagnostics.error;
    }
  }
  private saveDiagnostic(status: RunDiagnostic["status"]) {
    const previous = this.diagnostics.value.run;
    this.diagnostics.value.run = {
      id: previous?.id ?? crypto.randomUUID(),
      revision: (previous?.revision ?? 0) + 1,
      leafId: this.manager.getLeafId(),
      status,
      failure: this.failure,
    };
    if (!this.diagnostics.save())
      this.failure = [this.failure, this.diagnostics.error]
        .filter(Boolean)
        .join("\n");
  }
  stopUnconfirmed(error: unknown) {
    this.failure = error instanceof Error ? error.message : String(error);
    this.saveDiagnostic("stop-unconfirmed");
  }
  checkpoint() {
    const run = this.diagnostics.value.run;
    if (
      run &&
      run.status !== "stop-unconfirmed" &&
      run.leafId !== this.manager.getLeafId()
    )
      this.saveDiagnostic(run.status);
  }
  restoreQueue(lookup: (key: SendKey) => SendIntent | undefined) {
    for (const item of this.diagnostics.value.recovered) {
      if (this.recovered.some((old) => old.id === item.id)) continue;
      if (item.message) {
        this.recovered.push({ ...item, message: item.message });
        continue;
      }
      const intent = item.key && lookup(item.key);
      if (
        intent?.content &&
        intent.owner.cwd === this.manager.getCwd() &&
        intent.owner.sessionFile === this.manager.getSessionFile()
      )
        this.recovered.push({
          ...item,
          message: {
            role: "user",
            timestamp: 0,
            content: [
              {
                type: "text",
                text: unfoldPastes(
                  intent.content.text,
                  intent.content.pastes,
                ).trim(),
              },
              ...intent.content.images.map(({ image }) => image),
            ],
          },
        });
      else
        this.failure =
          "Cancelled queued input could not be restored. Original send recovery data was preserved; inspect history before resending.";
    }
  }
  recoverQueue(
    messages: { message: Extract<Message, { role: "user" }>; key?: SendKey }[],
  ) {
    if (!messages.length) return;
    const recovered = messages.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      leafId: this.manager.getLeafId(),
    }));
    this.recovered.push(...recovered);
    this.diagnostics.value.recovered.push(
      ...recovered.map(({ message, ...item }) =>
        item.key ? item : { ...item, message },
      ),
    );
    if (!this.diagnostics.save())
      this.failure = [this.failure, this.diagnostics.error]
        .filter(Boolean)
        .join("\n");
  }
  fail(error: unknown) {
    this.failure = error instanceof Error ? error.message : String(error);
    this.saveDiagnostic(this.running ? "running" : "failed");
  }
  event(event: AgentSessionEvent, requestId?: string) {
    // SDK publishes message_end before persistence. Reconcile it at the next
    // event before assigning another live ID, never by timestamp identity.
    this.commitLive();
    if (event.type === "agent_start") {
      this.running = true;
      this.failure = undefined;
      this.aborted = false;
      this.diagnostics.value.run = undefined;
      this.saveDiagnostic("running");
    }
    if (
      event.type === "message_start" ||
      event.type === "message_update" ||
      event.type === "message_end"
    ) {
      const message = wireMessage(event.message);
      if (message) {
        if (!this.live || event.type === "message_start") {
          this.liveBefore = this.manager.getLeafId();
          this.liveChecked = this.manager.getLeafEntry();
          this.live = {
            id: `live:${this.epoch}:${++this.counter}`,
            parentId: this.manager.getLeafId(),
            branchId: this.manager.getLeafId() ?? "root",
            order: this.entries().length,
            kind: "message",
            message,
            requestId: message.role === "user" ? requestId : undefined,
          };
        } else this.live.message = message;
        if (message.role === "assistant" && message.stopReason === "error")
          this.failure = message.errorMessage ?? "Model request failed";
        if (event.type === "message_end") {
          this.liveChecked = undefined;
          this.commitLive();
        }
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
        // Own the completed payload; SDK/extension objects may still be mutated.
        result: structuredClone(event.result),
      };
    if (event.type === "compaction_end" && event.errorMessage)
      this.fail(event.errorMessage);
    if (event.type === "auto_retry_end" && event.finalError)
      this.fail(event.finalError);
    // agent_end is not completion: before-settle hooks may still be executing.
    if (event.type === "agent_settled") {
      this.running = false;
      this.aborted = event.aborted;
      this.commitLive();
      this.saveDiagnostic(
        this.aborted ? "aborted" : this.failure ? "failed" : "completed",
      );
    }
  }
  private commitLive() {
    const leaf = this.manager.getLeafEntry();
    if (!this.live || !leaf || leaf === this.liveChecked) return;
    this.liveChecked = leaf;
    const live = this.live;
    const appended: SessionEntry[] = [];
    let entry: SessionEntry | undefined = leaf;
    while (entry && entry.id !== this.liveBefore) {
      appended.push(entry);
      entry = entry.parentId
        ? this.manager.getEntry(entry.parentId)
        : undefined;
    }
    if (this.liveBefore && !entry) return;
    const message = JSON.stringify(live.message);
    const saved = projectEntries({
      getLeafId: () => leaf.id,
      getBranch: () => appended,
    }).records.find(
      (r) =>
        r.kind === "message" &&
        JSON.stringify(r.message) === message &&
        !Object.values(this.aliases).includes(r.id),
    );
    if (saved) {
      this.aliases[live.id] = saved.id;
      if (live.requestId) this.requestIds.set(saved.id, live.requestId);
      this.live = undefined;
    }
  }
  private entries() {
    const leaf = this.manager.getLeafEntry();
    if (leaf !== this.branchLeaf) {
      const branch = this.manager.getBranch();
      if (
        this.branchLeaf &&
        !branch.some((entry) => entry.id === this.branchLeaf?.id)
      )
        this.historyRevision = crypto.randomUUID();
      this.branchLeaf = leaf;
      this.branch = branch;
      this.branchIds = new Set(branch.map((entry) => entry.id));
      this.page = undefined;
    }
    return this.branch;
  }
  historyPage(before?: string, revision?: string): Transcript {
    const branch = this.entries();
    if (revision !== undefined && revision !== this.historyRevision)
      throw new Error("STALE_HISTORY_CURSOR");
    if (before === undefined && this.page)
      return {
        ...this.page,
        records: [...this.page.records],
        tools: { ...this.page.tools },
      };
    const end =
      before === undefined
        ? branch.length
        : branch.findIndex((entry) => entry.id === before);
    if (end < 0) throw new Error("STALE_HISTORY_CURSOR");
    let start = Math.max(0, end - 50);
    // shortcut: keep whole responses for tool links/totals; oversized turns need per-turn summaries before splitting.
    while (start > 0) {
      const entry = branch[start];
      if (entry.type === "message" && entry.message.role === "user") break;
      start--;
    }
    const state = projectEntries(
      {
        getLeafId: () => this.manager.getLeafId(),
        getBranch: () => branch.slice(start, end),
      },
      start,
    );
    // Release owned copies once persistence has the same payload. Do this only
    // when projecting a page, not on every streaming snapshot.
    for (const [id, saved] of Object.entries(state.tools)) {
      const tool = this.tools[id];
      const result = tool?.result;
      const canonical = saved.result as { content: unknown; details?: unknown };
      if (
        !tool ||
        tool.status === "running" ||
        !result ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        !("content" in result) ||
        (result.content === canonical.content &&
          (result as { details?: unknown }).details === canonical.details) ||
        !Bun.deepEquals(result.content, canonical.content) ||
        !Bun.deepEquals(
          (result as { details?: unknown }).details,
          canonical.details,
        )
      )
        continue;
      this.tools[id] = {
        ...tool,
        result: {
          ...result,
          content: canonical.content,
          ...(canonical.details !== undefined
            ? { details: canonical.details }
            : {}),
        },
      };
    }
    state.history = {
      revision: this.historyRevision,
      before: start > 0 ? branch[start].id : undefined,
    };
    if (before === undefined)
      this.page = {
        ...state,
        records: [...state.records],
        tools: { ...state.tools },
      };
    return state;
  }
  snapshot(): Transcript {
    this.commitLive();
    const state = this.historyPage();
    state.records = state.records.map((record) => {
      const requestId = this.requestIds.get(record.id);
      return requestId ? { ...record, requestId } : record;
    });
    for (const item of this.recovered) {
      if (item.leafId && !this.branchIds.has(item.leafId)) continue;
      state.records.push({
        id: `recovered:${item.id}`,
        requestId: item.key?.requestId,
        parentId: item.leafId,
        branchId: this.manager.getLeafId() ?? "root",
        order: state.records.length,
        kind: "message",
        customType: "Cancelled queued prompt",
        display: true,
        message: {
          role: "custom",
          customType: "Cancelled queued prompt",
          display: true,
          timestamp: item.message.timestamp,
          content: item.message.content,
          details: { requestId: item.key?.requestId },
        },
      });
    }
    if (this.live) state.records.push(structuredClone(this.live));
    const calls = new Set(Object.keys(state.tools));
    for (const record of state.records)
      if (record.kind === "message" && record.message.role === "assistant")
        for (const block of record.message.content)
          if (block.type === "toolCall") calls.add(block.id);
    for (const id of calls)
      if (this.tools[id])
        state.tools[id] =
          this.tools[id].status === "running"
            ? structuredClone(this.tools[id])
            : this.tools[id];
    state.liveToEntry = { ...this.aliases };
    state.current = this.live?.id ?? null;
    state.running = this.running;
    return state;
  }
}
