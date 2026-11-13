// These adapters understand the official Pi examples, not a Host/core protocol.
// When copying out of this repository, import these types from "@pig/config".
import type {
  AdapterContext,
  AgentRun,
  Provenance,
  ResourceRef,
  RunState,
  SessionAdapter,
  SourceEntry,
  ToolObservation,
  WorkItem,
} from "../../packages/config/src";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const label = (value: unknown): string => text(value).slice(0, 16_000);

function source(
  ctx: AdapterContext,
  name: string,
  freshness: Provenance["freshness"],
): Provenance {
  return {
    label: name,
    scope: { kind: "session", id: ctx.session.id },
    freshness,
  };
}
function snapshotOrigin(ctx: AdapterContext, entry?: SourceEntry): ResourceRef {
  return {
    kind: "session",
    id: ctx.session.id,
    ...(entry ? { revision: entry.id } : {}),
  };
}
function messageOrigin(entry: SourceEntry): ResourceRef {
  return { kind: "message", id: entry.id, revision: entry.id };
}
function watch(
  ctx: AdapterContext,
  render: () => void,
  events = false,
): () => void {
  const unsubscribe = ctx.sources.subscribe(render);
  // Raw command/lifecycle events can change availability without persistence.
  // Streaming message bodies cannot change these saved-state views.
  const offEvent = events
    ? ctx.sources.onEvent((event) => {
        if (event.type !== "message_update") render();
      })
    : () => {};
  return () => {
    unsubscribe();
    offEvent();
  };
}

interface NativeTodo {
  id: number;
  text: string;
  done: boolean;
}
function todoDetails(
  value: unknown,
): { todos: NativeTodo[]; nextId: number } | undefined {
  const details = record(value);
  if (
    details.error ||
    !Number.isSafeInteger(details.nextId) ||
    (details.nextId as number) < 1 ||
    !Array.isArray(details.todos)
  )
    return;
  const ids = new Set<number>();
  for (const item of details.todos) {
    const todo = record(item);
    if (
      !Number.isSafeInteger(todo.id) ||
      (todo.id as number) < 1 ||
      typeof todo.text !== "string" ||
      typeof todo.done !== "boolean" ||
      ids.has(todo.id as number)
    )
      return;
    ids.add(todo.id as number);
  }
  return details as unknown as { todos: NativeTodo[]; nextId: number };
}

/** Read-only: /todos only opens Pi's TUI; there is no public todo mutation API. */
export function connectPiTodos({
  id = "pi-todos",
}: {
  id?: string;
} = {}): SessionAdapter {
  return {
    id,
    connect(ctx) {
      return watch(ctx, () => {
        let latest:
          | {
              entry: SourceEntry;
              message: RecordValue;
              details: NonNullable<ReturnType<typeof todoDetails>>;
            }
          | undefined;
        // Follow the extension's branch reconstruction, never all-session entries.
        for (const entry of ctx.sources.entries("branch")) {
          const message = record(entry.message);
          if (
            entry.type !== "message" ||
            message.role !== "toolResult" ||
            message.toolName !== "todo" ||
            message.isError
          )
            continue;
          const details = todoDetails(message.details);
          if (details) latest = { entry, message, details };
        }
        const live =
          latest &&
          ctx.sources
            .tools()
            .some(
              (tool) =>
                tool.toolName === "todo" &&
                tool.toolCallId === latest.message.toolCallId &&
                tool.origin === "live" &&
                tool.phase === "finished" &&
                !tool.isError,
            );
        ctx.views.set({
          kind: "todo",
          id,
          title: "Pi todos",
          source: source(
            ctx,
            "Official todo extension · current branch",
            latest ? (live ? "live" : "saved") : "unknown",
          ),
          origin: latest ? messageOrigin(latest.entry) : snapshotOrigin(ctx),
          explanation:
            "Read-only tool-result snapshot. Native IDs may be reused after clear or branching; the view revision identifies this snapshot.",
          facts: latest
            ? [
                {
                  label: "Next native ID",
                  value: String(latest.details.nextId),
                },
              ]
            : [],
          items:
            latest?.details.todos.map((todo) => ({
              id: String(todo.id),
              identity: "native",
              title: label(todo.text),
              state: todo.done ? "completed" : "pending",
            })) ?? [],
        });
      });
    },
  };
}

/** source must exactly equal the registered command's sourceInfo.path, not its display name. */
export function connectPiPlanMode({
  id = "pi-plan-mode",
  source: commandSource,
}: {
  id?: string;
  source: string;
}): SessionAdapter {
  if (typeof commandSource !== "string" || !commandSource.trim())
    throw new Error(
      "Pi plan mode requires an explicit command sourceInfo.path",
    );
  return {
    id,
    connect(ctx) {
      let registered = false;
      const matches = () =>
        ctx.pi
          .commands()
          .some(
            (command) =>
              command.name === "plan" && command.source === commandSource,
          );
      const render = () => {
        // The official extension restores the last custom entry from getEntries(), not getBranch().
        const entry = [...ctx.sources.entries("all")]
          .reverse()
          .find(
            (entry) =>
              entry.type === "custom" && entry.customType === "plan-mode",
          );
        const state = record(entry?.data);
        const enabled =
          typeof state.enabled === "boolean" ? state.enabled : null;
        const executing =
          typeof state.executing === "boolean" ? state.executing : null;
        const available = matches();
        if (available && !registered) {
          ctx.commands.register({
            id: "toggle",
            title: "Toggle Pi plan mode (clears plan)",
            async run() {
              if (!matches())
                throw new Error(
                  "Matching Pi plan command source is no longer registered",
                );
              // Toggle only: never a slash-command prompt or a fabricated set-mode operation.
              await ctx.pi.invoke({ name: "plan", source: commandSource });
              // No optimistic update. Persisted source changes are the authority.
            },
          });
          registered = true;
        }
        const origin = snapshotOrigin(ctx, entry);
        const provenance = source(
          ctx,
          "Official plan-mode extension · latest saved state",
          entry ? "saved" : "unknown",
        );
        ctx.views.set({
          kind: "mode",
          id,
          title: "Pi plan mode",
          axis: "plan-mode",
          source: provenance,
          origin,
          value: enabled === null ? null : enabled ? "plan" : "normal",
          choices: [
            { id: "plan", label: "Plan" },
            { id: "normal", label: "Normal" },
          ],
          description:
            "Saved mode, not a set-mode control. Toggling resets execution and clears the current plan.",
          facts: [
            {
              label: "Executing plan",
              value: executing === null ? "Unknown" : executing ? "Yes" : "No",
            },
          ],
          actions: available
            ? [
                {
                  id: "toggle",
                  command: "toggle",
                  label: "Toggle plan mode",
                  confirmation:
                    "Toggle Pi plan mode? This clears the current plan and resets execution.",
                },
              ]
            : [],
        });
        const items: WorkItem[] = [];
        for (const [index, value] of array(state.todos).entries()) {
          const todo = record(value);
          if (typeof todo.text !== "string") continue;
          items.push({
            id: `${entry?.id ?? "unknown"}:${index}`,
            identity: "snapshot",
            title: label(todo.text),
            state:
              typeof todo.completed === "boolean"
                ? todo.completed
                  ? "completed"
                  : "pending"
                : "unknown",
            ...(typeof todo.step === "number"
              ? { stateLabel: `Step ${todo.step}` }
              : {}),
          });
        }
        ctx.views.set({
          kind: "todo",
          id: `${id}:todos`,
          title: "Pi plan steps",
          source: provenance,
          origin,
          items,
          explanation:
            "Plan steps are separate from the Plan/Normal mode. Saved snapshots only; no editing API is exposed.",
        });
      };
      // Command registration/reload events can change availability without changing entries.
      return watch(ctx, render, true);
    },
  };
}

function runState(
  result: RecordValue,
  tool: ToolObservation,
  mode: string,
  index: number,
  count: number,
): RunState {
  if (result.stopReason === "aborted")
    return { phase: "finished", outcome: "cancelled", label: "Aborted" };
  if (
    result.stopReason === "error" ||
    (typeof result.exitCode === "number" &&
      result.exitCode !== 0 &&
      result.exitCode !== -1)
  )
    return { phase: "finished", outcome: "error" };
  if (result.exitCode === -1)
    return {
      phase: "unknown",
      outcome: "unknown",
      label:
        tool.origin === "live" && tool.phase === "running"
          ? "Queued or running (source does not distinguish)"
          : "Saved incomplete result; current status unknown",
    };
  if (
    tool.origin === "live" &&
    tool.phase === "running" &&
    result.exitCode === 0
  ) {
    // runSingleAgent initializes exitCode to zero BEFORE the process has exited.
    if (mode === "single" || (mode === "chain" && index === count - 1))
      return {
        phase: "running",
        label: "Live invocation; completion not confirmed",
      };
    if (mode === "parallel")
      return {
        phase: "unknown",
        label: "Running or completed (awaiting final result)",
      };
  }
  if (result.exitCode === 0) return { phase: "finished", outcome: "success" };
  return { phase: "unknown", outcome: "unknown" };
}

/** Retain diagnostics AND partial assistant text, fairly bounding all sections together. */
function combinedOutput(result: RecordValue): NonNullable<AgentRun["output"]> {
  const messages = array(result.messages)
    .flatMap((value) => {
      const message = record(value);
      return message.role === "assistant"
        ? array(message.content).flatMap((part) => {
            const block = record(part);
            return block.type === "text" && typeof block.text === "string"
              ? [block.text]
              : [];
          })
        : [];
    })
    .join("\n\n");
  const sections = [
    text(result.errorMessage) && `Error: ${text(result.errorMessage)}`,
    text(result.stderr) && `Stderr:\n${text(result.stderr)}`,
    messages && `Output:\n${messages}`,
  ].filter(Boolean);
  const budget = 20_000 - Math.max(0, sections.length - 1) * 2;
  const sizes = sections.map((part) =>
    Math.min(part.length, Math.floor(budget / Math.max(1, sections.length))),
  );
  let spare = budget - sizes.reduce((sum, size) => sum + size, 0);
  for (let i = 0; i < sections.length; i++) {
    const extra = Math.min(spare, sections[i].length - sizes[i]);
    sizes[i] += extra;
    spare -= extra;
  }
  return {
    text: sections.map((part, i) => part.slice(0, sizes[i])).join("\n\n"),
    stream: "combined",
    truncated: sections.some((part, i) => part.length > sizes[i]),
  };
}

/** Read structured per-child results; the parent parallel tool can succeed despite failures. */
export function connectPiSubagents({
  id = "pi-subagents",
}: {
  id?: string;
} = {}): SessionAdapter {
  return {
    id,
    connect(ctx) {
      return watch(ctx, () => {
        const entries = ctx.sources.entries("branch");
        const tools = ctx.sources
          .tools()
          .filter((tool) => tool.toolName === "subagent");
        const runs: AgentRun[] = [];
        for (const tool of tools) {
          const details = record(record(tool.result).details);
          const results = array(details.results);
          const mode = text(details.mode);
          const entry = [...entries].reverse().find((entry) => {
            const message = record(entry.message);
            return (
              entry.type === "message" &&
              message.role === "toolResult" &&
              message.toolCallId === tool.toolCallId
            );
          });
          for (const [index, value] of results.entries()) {
            const result = record(value);
            if (!text(result.agent)) continue;
            const facts = [
              { label: "Tool call", value: tool.toolCallId },
              { label: "Mode", value: mode || "Unknown" },
              { label: "Snapshot", value: tool.origin },
              {
                label: "Agent source",
                value: text(result.agentSource) || "unknown",
              },
            ];
            if (typeof result.exitCode === "number")
              facts.push({
                label: "Exit code",
                value: String(result.exitCode),
              });
            if (text(result.stopReason))
              facts.push({
                label: "Stop reason",
                value: text(result.stopReason),
              });
            for (const [key, value] of Object.entries(record(result.usage))) {
              if (typeof value === "number" && Number.isFinite(value))
                facts.push({ label: `Usage · ${key}`, value: String(value) });
            }
            runs.push({
              id: `${tool.toolCallId}:${index}`,
              title: label(result.agent),
              profile: label(result.agent),
              task: text(result.task),
              ...(text(result.model) ? { model: label(result.model) } : {}),
              state: runState(result, tool, mode, index, results.length),
              output: combinedOutput(result),
              facts,
              origin: entry ? messageOrigin(entry) : snapshotOrigin(ctx),
              // Chain steps are siblings with dependencies, not nested agent invocations.
              ...(mode === "chain" && index > 0
                ? { dependsOn: [`${tool.toolCallId}:${index - 1}`] }
                : {}),
            });
          }
        }
        ctx.views.set({
          kind: "agents",
          id,
          title: "Pi subagents",
          runs,
          origin: snapshotOrigin(ctx),
          source: source(
            ctx,
            "Official subagent tool",
            tools.some((tool) => tool.origin === "live")
              ? "live"
              : tools.length
                ? "saved"
                : "unknown",
          ),
          facts: [
            {
              label: "Controls",
              value:
                "Read-only: no stop/resume API or child session reference is exposed by this example.",
            },
          ],
        });
      });
    },
  };
}
