import { createHash } from "node:crypto";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import packageInfo from "../../../package.json";
import type {
  StatisticEvent,
  StatisticsSink,
  StatisticValue,
} from "./contracts";
import { initialContextMetadata } from "./initial-context";
import {
  contentMetadata,
  number,
  object,
  toolMetadata,
  usageMetadata,
} from "./normalize";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const statisticsOwner = (
  profile: string,
  cwd: string,
  session: string,
) => hash(JSON.stringify([profile, cwd, session]));

type Identity = {
  profile: string;
  cwd: string;
  session: string;
  host: string;
  epoch: number;
  account?: (provider: string) => string | undefined;
};

/** Owns one SDK binding, not a UI window or a persisted conversation projection. */
export class SessionStatistics {
  private readonly binding = crypto.randomUUID();
  private readonly owner: string;
  private readonly project: string;
  private sequence = 0;
  private run: string | null = null;
  private runStarted = 0;
  private request: {
    id: string;
    started: number;
    firstText: boolean;
    account: string | null;
  } | null = null;
  private lastRequest: string | null = null;
  private tools = new Map<string, number>();
  private ended = new WeakSet<object>();
  private entries = new Set<string>();
  private lastError = false;
  private closed = false;
  private initialContextObserved = false;
  private compactionStarted: number | null = null;

  constructor(
    private readonly identity: Identity,
    private readonly sink: StatisticsSink,
    private readonly clock = () => performance.now(),
  ) {
    this.owner = statisticsOwner(
      identity.profile,
      identity.cwd,
      identity.session,
    );
    this.project = hash(identity.cwd);
    this.emit("binding_open", {
      epoch: identity.epoch,
      collectorVersion: 1,
      appVersion: packageInfo.version,
      sdkVersion: packageInfo.dependencies["@earendil-works/pi-coding-agent"],
      coverage: {
        conversation: "sdk-message-end",
        tools: "sdk-execution-events",
        auxiliaryUsage: "persisted-entry-aggregate-only",
        context: "loaded-and-effective-prompt-only",
        finalPayload: "unobserved",
        extensionNetwork: "unobserved",
        memory: "unobserved",
        usageReportPresence: "unknown",
        historyImport: false,
      },
    });
  }

  private emit(
    type: string,
    data: Record<string, StatisticValue>,
    ids: {
      request?: string | null;
      call?: string;
      parentCall?: string;
    } = {},
  ) {
    const event: StatisticEvent = {
      id: crypto.randomUUID(),
      version: 1,
      owner: this.owner,
      project: this.project,
      session: this.identity.session,
      host: this.identity.host,
      binding: this.binding,
      sequence: ++this.sequence,
      at: Date.now(),
      type,
      run: this.run,
      request: ids.request ?? this.request?.id ?? this.lastRequest,
      call: ids.call ?? null,
      parentCall: ids.parentCall ?? null,
      data,
    };
    this.sink.record(event);
  }

  context(session: AgentSession) {
    const loader = session.resourceLoader;
    const context = session.getContextUsage();
    this.emit("context_snapshot", {
      provider: session.model?.provider ?? null,
      model: session.model?.id ?? null,
      thinkingLevel: session.thinkingLevel,
      tools: session.getActiveToolNames(),
      systemRevision: hash(session.systemPrompt),
      systemBytes: Buffer.byteLength(session.systemPrompt),
      context: context
        ? {
            tokens: context.tokens,
            contextWindow: context.contextWindow,
          }
        : null,
      agents: loader.getAgentsFiles().agentsFiles.map((file) => ({
        source: hash(file.path),
        revision: hash(file.content),
        bytes: Buffer.byteLength(file.content),
        stage: "loaded",
      })),
      skills: loader.getSkills().skills.map((skill) => ({
        source: hash(skill.filePath),
        name: skill.name,
        stage: "catalog",
      })),
      extensions: loader.getExtensions().extensions.map((extension) => ({
        source: hash(extension.path),
      })),
    });
  }

  initialContext(
    messages: Parameters<typeof initialContextMetadata>[0],
    contextWindow: number | null,
  ) {
    if (this.closed || this.initialContextObserved) return;
    this.initialContextObserved = true;
    const metadata = initialContextMetadata(messages, contextWindow);
    if (metadata) this.emit("initial_context", metadata);
  }

  event(event: AgentSessionEvent, sendId?: string) {
    if (this.closed) return;
    switch (event.type) {
      case "agent_start":
        if (!this.run) {
          this.run = crypto.randomUUID();
          this.runStarted = this.clock();
          this.emit("run_start", {});
        }
        this.emit(event.type, {});
        break;
      case "message_start":
        if (event.message.role === "assistant") {
          this.request = {
            id: crypto.randomUUID(),
            started: this.clock(),
            firstText: false,
            account: this.identity.account?.(event.message.provider) ?? null,
          };
          this.lastRequest = this.request.id;
          this.emit("model_start", {
            provider: event.message.provider,
            model: event.message.model,
            timestamp: event.message.timestamp,
            account: this.request.account,
          });
        } else if (event.message.role === "user")
          this.emit("user_message", {
            sendId: sendId ?? null,
            ...contentMetadata(event.message.content),
          });
        break;
      case "message_update":
        if (
          this.request &&
          !this.request.firstText &&
          event.assistantMessageEvent.type === "text_delta" &&
          event.assistantMessageEvent.delta.length
        ) {
          this.request.firstText = true;
          this.emit("first_text", {
            elapsedMs: this.clock() - this.request.started,
          });
        }
        break;
      case "message_end": {
        const message = event.message;
        if (this.ended.has(message)) break;
        this.ended.add(message);
        if (message.role === "toolResult") {
          this.emit(
            "tool_result",
            {
              tool: message.toolName,
              isError: message.isError,
              ...contentMetadata(message.content),
              nestedComplete: message.nestedCalls?.complete ?? null,
              nestedCalls:
                message.nestedCalls?.calls.map((call) => ({
                  id: call.id,
                  tool: call.name,
                  status: call.status,
                  durationMs: number(call.durationMs),
                  argumentsBytes: number(call.argumentsBytes),
                })) ?? [],
            },
            { call: message.toolCallId },
          );
          if (message.usage)
            this.emit(
              "auxiliary_usage",
              {
                purpose: "tool",
                provider: null,
                model: null,
                aggregation: "tool-aggregate",
                ...usageMetadata(message.usage),
              },
              { request: hash(`${this.binding}:${message.toolCallId}:usage`) },
            );
          break;
        }
        if (message.role !== "assistant") break;
        const request = this.request?.id ?? crypto.randomUUID();
        this.lastError = message.stopReason === "error";
        this.emit(
          "model_end",
          {
            provider: message.provider,
            api: message.api,
            model: message.model,
            account: this.request?.account ?? null,
            responseId: message.responseId ?? null,
            responseModel: message.responseModel ?? null,
            thinkingLevel: message.thinkingLevel ?? null,
            providerThinkingLevel: message.providerThinkingLevel ?? null,
            stopReason: message.stopReason,
            rawStopReason: message.rawStopReason ?? null,
            diagnostics: message.diagnostics?.length ?? 0,
            timestamp: number(message.timestamp),
            durationMs: number(message.durationMs),
            observedDurationMs: this.request
              ? this.clock() - this.request.started
              : null,
            purpose: "conversation",
            aggregation: "request",
            ...usageMetadata(message.usage),
            ...contentMetadata(message.content),
            toolCalls: message.content.filter(
              (block) => block.type === "toolCall",
            ).length,
            invalidToolArguments: message.content.filter(
              (block) =>
                block.type === "toolCall" && Boolean(block.argumentsError),
            ).length,
          },
          { request },
        );
        this.request = null;
        break;
      }
      case "tool_execution_start":
        this.tools.set(event.toolCallId, this.clock());
        this.emit(
          event.type,
          {
            tool: event.toolName,
            argumentFields: Object.keys(object(event.args)).length,
          },
          { call: event.toolCallId, parentCall: event.parentToolCallId },
        );
        break;
      case "tool_execution_end": {
        const started = this.tools.get(event.toolCallId);
        this.tools.delete(event.toolCallId);
        this.emit(
          event.type,
          {
            tool: event.toolName,
            isError: event.isError,
            executionDurationMs: number(event.durationMs),
            executionObserved: event.durationMs !== undefined,
            observedDurationMs:
              started === undefined ? null : this.clock() - started,
            ...toolMetadata(event.toolName, event.result),
          },
          { call: event.toolCallId, parentCall: event.parentToolCallId },
        );
        break;
      }
      case "auto_retry_start":
      case "summarization_retry_scheduled":
        this.emit(event.type, {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          hasError: Boolean(event.errorMessage),
        });
        break;
      case "auto_retry_end":
        this.emit(event.type, {
          attempt: event.attempt,
          success: event.success,
          hasError: Boolean(event.finalError),
        });
        break;
      case "summarization_retry_attempt_start":
        this.emit(event.type, { source: event.source });
        break;
      case "summarization_retry_finished":
        this.emit(event.type, {});
        break;
      case "compaction_start":
        this.compactionStarted = this.clock();
        this.emit(event.type, { reason: event.reason });
        break;
      case "compaction_end":
        this.emit(event.type, {
          reason: event.reason,
          aborted: event.aborted,
          willRetry: event.willRetry,
          hasError: Boolean(event.errorMessage),
          hasResult: Boolean(event.result),
          tokensBefore: number(event.result?.tokensBefore),
          estimatedTokensAfter: number(event.result?.estimatedTokensAfter),
          firstKeptEntry: event.result?.firstKeptEntryId ?? null,
          durationMs:
            this.compactionStarted === null
              ? null
              : this.clock() - this.compactionStarted,
        });
        this.compactionStarted = null;
        break;
      case "queue_update":
        this.emit(event.type, {
          steering: event.steering.length,
          followUp: event.followUp.length,
        });
        break;
      case "thinking_level_changed":
        this.emit(event.type, { level: event.level });
        break;
      case "entry_appended": {
        const entry = event.entry;
        if (this.entries.has(entry.id)) break;
        this.entries.add(entry.id);
        this.emit("session_entry", {
          entry: entry.id,
          parent: entry.parentId,
          entryType: entry.type,
        });
        if (
          entry.type === "usage" ||
          entry.type === "compaction" ||
          entry.type === "branch_summary"
        ) {
          this.emit(
            "auxiliary_usage",
            {
              entry: entry.id,
              purpose: entry.type === "usage" ? entry.kind : entry.type,
              provider: entry.type === "usage" ? entry.provider : null,
              model: entry.type === "usage" ? entry.model : null,
              aggregation: "entry-aggregate",
              fromHook:
                entry.type === "usage" ? null : (entry.fromHook ?? false),
              ...usageMetadata(entry.usage),
            },
            { request: hash(`${this.owner}:${entry.id}`) },
          );
        } else if (entry.type === "model_change")
          this.emit(entry.type, {
            provider: entry.provider,
            model: entry.modelId,
          });
        else if (entry.type === "context_edit")
          this.emit(entry.type, {
            target: entry.targetId,
            omitted: entry.replacement === null,
          });
        break;
      }
      case "agent_end":
        this.emit(event.type, { willRetry: event.willRetry });
        break;
      case "agent_settled":
        this.emit(event.type, { aborted: event.aborted });
        this.finish(
          event.aborted ? "aborted" : this.lastError ? "failed" : "completed",
        );
        break;
    }
  }

  private finish(status: string) {
    if (!this.run) return;
    this.emit("run_end", {
      status,
      durationMs: this.clock() - this.runStarted,
      unfinishedTools: this.tools.size,
    });
    this.run = null;
    this.lastError = false;
    this.request = null;
    this.lastRequest = null;
    this.tools.clear();
  }

  close() {
    if (this.closed) return;
    this.finish("interrupted");
    this.emit("binding_close", {});
    this.closed = true;
  }
}
