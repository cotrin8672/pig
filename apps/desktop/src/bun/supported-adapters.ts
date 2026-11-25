import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type EventBus, getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  AdapterContext,
  AgentRun,
  PigConfig,
  RunRecord,
  RunState,
  ScheduleDefinition,
  ScheduleTiming,
  SessionAdapter,
  SessionUIState,
} from "../../../../packages/config/src";
import { CODEX_SUBAGENT_COMPLETION } from "../shared/supported-extensions";

// Display connections for the Extensions listed in shared/supported-extensions.ts.
// They only observe what the Extension publishes; the Extension stays the source of truth.

type Value = Record<string, unknown>;
const record = (value: unknown): Value =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Value)
    : {};
const text = (value: unknown, max = 16_000): string | undefined =>
  typeof value === "string" && value.trim() ? value.slice(0, max) : undefined;
const iso = (value: unknown): string | undefined =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : undefined;

/** The source path of a command the Extension package registered, if it is loaded. */
function loadedFrom(ctx: AdapterContext, pkg: string, command: string) {
  return ctx.pi
    .commands()
    .find(
      (c) =>
        c.name === command &&
        c.source.replaceAll("\\", "/").includes(`/node_modules/${pkg}/`),
    )?.source;
}

const SUBAGENT_PKG = "pi-subagents";
const SUBAGENT_RPC = "subagents:rpc:v1";
const SUBAGENT_CHANGES = [
  `${SUBAGENT_RPC}:ready`,
  "subagent:jobs-changed",
  "subagent:async-started",
  "subagent:child-status",
  "subagent:async-complete",
  "subagent:process-terminal",
];

function subagentState(status: unknown): RunState {
  switch (status) {
    case "pending":
    case "queued":
      return { phase: "queued" };
    case "running":
      return { phase: "running" };
    case "paused":
      return { phase: "paused" };
    case "complete":
    case "completed":
      return { phase: "finished", outcome: "success" };
    case "failed":
    case "rejected":
      return { phase: "finished", outcome: "error" };
    case "stopped":
      return { phase: "finished", outcome: "cancelled" };
    case "partial":
      return { phase: "finished", outcome: "unknown", label: "Partial" };
    case "detached":
      return { phase: "unknown", label: "Detached" };
    default:
      return { phase: "unknown" };
  }
}

function subagentTime(value: unknown) {
  return typeof value === "number" && value >= 0 && value <= 8.64e15
    ? new Date(value).toISOString()
    : undefined;
}

const strings = (value: unknown, max: number) =>
  (Array.isArray(value) ? value : [])
    .slice(-max)
    .flatMap((line) => text(line, 300)?.trim() || []);
const toolLine = (mark: string, tool: unknown, args: unknown) =>
  text(tool, 80)
    ? `${mark} ${text(tool, 80)} ${text(args, 200) ?? ""}`.trimEnd()
    : undefined;

/** A short activity log for a running child: recent tools and output, current tool last. */
function foregroundLog(row: Value): string | undefined {
  const lines = [
    ...(Array.isArray(row.recentTools) ? row.recentTools.slice(-8) : []).map(
      (tool) => toolLine("✓", record(tool).tool, record(tool).args),
    ),
    ...strings(row.recentOutput, 8),
    toolLine("→", row.currentTool, row.currentToolArgs),
  ].filter((line): line is string => !!line);
  return lines.length ? lines.join("\n") : undefined;
}

function asyncLog(run: Value): string | undefined {
  const lines = [
    ...(Array.isArray(run.children) ? run.children.slice(0, 20) : []).map(
      (value) => {
        const child = record(value);
        const label = text(child.label, 200);
        return label && `${label} · ${String(child.state)}`;
      },
    ),
    toolLine("→", record(run.activity).currentTool, undefined),
  ].filter((line): line is string => !!line);
  return lines.length ? lines.join("\n") : undefined;
}

function asyncRuns(snapshot: Value): AgentRun[] | undefined {
  if (
    snapshot.kind !== "pi-subagents.async-status-snapshot" ||
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.runs)
  )
    return undefined;
  const runs = new Map<string, AgentRun>();
  for (const value of snapshot.runs.slice(0, 20)) {
    const run = record(value);
    const id = text(run.id, 240);
    if (!id) continue;
    const log = asyncLog(run);
    runs.set(id, {
      id: `async:${id}`,
      title: text(run.label, 256) ?? "Subagent",
      state: subagentState(run.state),
      startedAt: subagentTime(run.startedAt),
      endedAt: subagentTime(run.endedAt),
      detail: text(run.progressText, 2_000),
      ...(log ? { output: { text: log } } : {}),
    });
  }
  return [...runs.values()];
}

/** Read-only RPC for background runs, and structured tool updates for foreground runs. */
export function connectNicoSubagents(
  bus: Pick<EventBus, "emit">,
): SessionAdapter {
  return {
    id: "pig:subagents",
    connect(ctx) {
      const isLoaded = () => loadedFrom(ctx, SUBAGENT_PKG, "subagents-fleet");
      if (!isLoaded()) return;
      const foreground = new Map<string, AgentRun>();
      const activeCalls = new Map<string, Set<string>>();
      let background: AgentRun[] = [];
      const render = () => {
        const runs = [...foreground.values()].reverse().concat(background);
        if (!runs.length) return ctx.views.remove("subagents");
        ctx.views.set({
          kind: "agents",
          id: "subagents",
          title: "Subagents",
          source: {
            label: SUBAGENT_PKG,
            scope: { kind: "session", id: ctx.session.id },
            freshness: "live",
          },
          runs,
        });
      };
      let dirty = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let finishRequest: (() => void) | undefined;
      const refresh = () => {
        dirty = true;
        if (timer || finishRequest) return;
        timer = setTimeout(() => {
          timer = undefined;
          dirty = false;
          if (!isLoaded()) return;
          const requestId = randomUUID();
          const stop = () => {
            off();
            clearTimeout(timeout);
            finishRequest = undefined;
            if (dirty) refresh();
          };
          const off = ctx.sources.onBus(
            `${SUBAGENT_RPC}:reply:${requestId}`,
            (data) => {
              const reply = record(data);
              if (reply.version !== 1 || reply.requestId !== requestId) return;
              stop();
              if (reply.success !== true) return;
              const runs = asyncRuns(record(record(reply.data).asyncSnapshot));
              if (!runs) return;
              background = runs;
              render();
            },
          );
          const timeout = setTimeout(stop, 3_000);
          finishRequest = stop;
          // Status is read-only and must work while the host is binding the session.
          bus.emit(`${SUBAGENT_RPC}:request`, {
            version: 1,
            requestId,
            method: "status",
          });
        }, 150);
      };
      const offs = SUBAGENT_CHANGES.map((event) =>
        ctx.sources.onBus(event, refresh),
      );
      // shortcut: foreground activity before this connection stays in tool history.
      offs.push(
        ctx.sources.onEvent((event) => {
          if (
            event.toolName !== "subagent" ||
            (event.type !== "tool_execution_update" &&
              event.type !== "tool_execution_end")
          )
            return;
          const callId = text(event.toolCallId);
          if (!callId) return;
          const finished = event.type === "tool_execution_end";
          const details = record(
            record(finished ? event.result : event.partialResult).details,
          );
          const runId = text(details.runId, 220);
          const rows = finished ? details.results : details.progress;
          const children =
            runId &&
            !details.asyncId &&
            !details.background &&
            details.mode !== "management" &&
            Array.isArray(rows)
              ? rows.slice(0, 100)
              : [];
          const active = activeCalls.get(callId) ?? new Set<string>();
          if (!active.size && !children.length) return;
          for (const value of children) {
            const row = record(value);
            const profile = text(row.agent, 256);
            if (!profile || !Number.isSafeInteger(row.index)) continue;
            const id = `foreground:${runId}:${row.index}`;
            if (finished) active.delete(id);
            else active.add(id);
            const state: RunState = finished
              ? {
                  phase: "finished",
                  outcome: row.stopped
                    ? "cancelled"
                    : row.interrupted || row.detached
                      ? "interrupted"
                      : row.timedOut || row.error
                        ? "error"
                        : row.exitCode === 0
                          ? "success"
                          : typeof row.exitCode === "number"
                            ? "error"
                            : "unknown",
                }
              : subagentState(row.status);
            const output = finished
              ? (text(row.error, 2_000) ?? text(row.finalOutput, 2_000))
              : foregroundLog(row);
            foreground.set(id, {
              id,
              profile,
              title: text(row.task, 256) ?? profile,
              state,
              detail: text(row.progressText, 2_000),
              ...(output ? { output: { text: output } } : {}),
            });
          }
          if (finished) {
            // Aborted tools may emit an end event without any per-child results.
            for (const id of active) {
              const run = foreground.get(id);
              if (run && run.state.phase !== "finished")
                foreground.set(id, {
                  ...run,
                  state: { phase: "finished", outcome: "unknown" },
                });
            }
            activeCalls.delete(callId);
          } else if (active.size) activeCalls.set(callId, active);
          const completed = [...foreground.values()].filter(
            (run) => run.state.phase === "finished",
          );
          for (const run of completed.slice(
            0,
            Math.max(0, completed.length - 50),
          ))
            foreground.delete(run.id);
          render();
        }),
      );
      refresh();
      return () => {
        dirty = false;
        clearTimeout(timer);
        finishRequest?.();
        for (const off of offs) off();
      };
    },
  };
}

// An unpacked local Pi package need not be inside node_modules.
function pigAgentsCommand(ctx: AdapterContext) {
  const installed = loadedFrom(ctx, "pi-subagent", "agents");
  if (installed) return installed;
  return ctx.pi.commands().find(({ name, source }) => {
    if (name !== "agents") return false;
    try {
      return (
        JSON.parse(readFileSync(join(dirname(source), "package.json"), "utf8"))
          .name === "pi-subagent"
      );
    } catch {
      return false;
    }
  })?.source;
}
export function connectPigSubagents(
  bus: Pick<EventBus, "emit">,
): SessionAdapter {
  return {
    id: "pig:native-subagents",
    connect(ctx) {
      const source = pigAgentsCommand(ctx);
      if (!source) return;
      const parent = ctx.session.id;
      // Delegate to the owning extension's read-only picker. Never open a path from a row.
      ctx.commands.register({
        id: "peek",
        title: "Inspect subagent history",
        run: () => ctx.pi.invoke({ name: "agents", source }),
      });
      let generation = 0;
      const refresh = () => {
        const request = ++generation;
        bus.emit("pig:subagents:snapshot", {
          parentId: parent,
          reply(rows: unknown) {
            if (request !== generation || !Array.isArray(rows)) return;
            const runs = pigAgentRuns(rows);
            if (!runs) return;
            if (!runs.length) return ctx.views.remove("subagents");
            ctx.views.set({
              kind: "agents",
              id: "subagents",
              title: "Subagents",
              source: {
                label: "pi-subagent",
                scope: { kind: "session", id: parent },
                freshness: "live",
              },
              runs,
              actions: runs.some((run) => run.session)
                ? [{ id: "peek", command: "peek", label: "Inspect history" }]
                : undefined,
            });
          },
        });
      };
      const off = ctx.sources.onBus("pig:subagents:changed", (data) => {
        if (record(data).parentId === parent) refresh();
      });
      refresh();
      return () => {
        generation++;
        off();
      };
    },
  };
}

function pigAgentRuns(rows: unknown[]): AgentRun[] | undefined {
  const runs: AgentRun[] = [];
  const ids = new Set<string>();
  // Split the output preview budget across the snapshot so older final responses
  // cannot crowd a live run out of the adapter view (1 MiB wire limit).
  const previewLimit = Math.min(
    16_000,
    Math.floor(96_000 / Math.max(1, rows.length)),
  );
  for (const item of rows) {
    const row = record(item);
    const {
      run_id: id,
      agent_id: agentId,
      task_name: title,
      child_session_id: child,
    } = row;
    if (
      !validId(id) ||
      !validId(agentId) ||
      !validId(title) ||
      (child !== undefined && !validId(child)) ||
      ids.has(id)
    )
      return;
    const state = pigAgentState(row.status);
    if (!state) return; // Reject a malformed replacement as a whole; don't drop a live pin.
    ids.add(id);
    const result =
      text(row.error, previewLimit) ?? text(row.final_response, previewLimit);
    runs.push({
      id,
      agentId,
      title,
      state,
      session: child ? { kind: "session", id: child } : undefined,
      output: result ? { text: result } : undefined,
    });
  }
  return runs;
}

function validId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 16384 && !!id.trim();
}
function pigAgentState(status: unknown): RunState | undefined {
  switch (status) {
    case "starting":
      return { phase: "queued" };
    case "running":
      return { phase: "running" };
    case "completed":
      return { phase: "finished", outcome: "success" };
    case "failed":
      return { phase: "finished", outcome: "error" };
    case "interrupted":
      return { phase: "finished", outcome: "interrupted" };
  }
}

const CODEX_SUBAGENTS_PKG = "@ogulcancelik/pi-codex-subagents";
const codexAgentName = (value: unknown) =>
  text(value, 256)
    ?.trim()
    .replace(/^\/+|\/+$/g, "") || "";
const codexOutcome = (status: unknown) =>
  status === "completed"
    ? "success"
    : status === "failed"
      ? "error"
      : status === "interrupted"
        ? "interrupted"
        : undefined;

export function connectCodexSubagents(): SessionAdapter {
  return {
    id: "pig:codex-subagents",
    connect(ctx) {
      if (!loadedFrom(ctx, CODEX_SUBAGENTS_PKG, "subagents")) return;
      const runs = new Map<string, AgentRun>();
      const calls = new Map<string, Map<string, string>>();
      const render = () => {
        const finished = [...runs].filter(
          ([, run]) => run.state.phase === "finished",
        );
        for (const [name] of finished.slice(
          0,
          Math.max(0, finished.length - 50),
        ))
          runs.delete(name);
        if (!runs.size) return ctx.views.remove("codex-subagents");
        ctx.views.set({
          kind: "agents",
          id: "codex-subagents",
          title: "Subagents",
          source: {
            label: CODEX_SUBAGENTS_PKG,
            scope: { kind: "session", id: ctx.session.id },
            freshness: "live",
          },
          runs: [...runs.values()].reverse(),
        });
      };
      const finish = (
        name: string,
        outcome: RunState["outcome"],
        callId?: string,
      ) => {
        const run = runs.get(name);
        if (!outcome || !run || run.state.phase === "finished") return;
        if (callId && run.id !== callId) return;
        runs.set(name, {
          ...run,
          state: { phase: "finished", outcome },
          endedAt: new Date().toISOString(),
        });
      };
      // shortcut: track live calls from this connection; use an upstream status API when available.
      return ctx.sources.onEvent((event) => {
        if (event.type === "message_start") {
          const message = record(event.message);
          if (
            message.role !== "custom" ||
            message.customType !== CODEX_SUBAGENT_COMPLETION
          )
            return;
          const d = record(message.details);
          finish(codexAgentName(d.agent_name), codexOutcome(d.status));
          render();
          return;
        }
        if (
          event.type !== "tool_execution_start" &&
          event.type !== "tool_execution_end"
        )
          return;
        const callId = text(event.toolCallId, 256);
        if (!callId) return;
        const tool = event.toolName;
        const launch = tool === "spawn_agent" || tool === "send_message";
        if (event.type === "tool_execution_start") {
          const a = record(event.args);
          const name = codexAgentName(
            tool === "spawn_agent" ? a.task_name : a.target,
          );
          const run = runs.get(name);
          if (launch && name && (!run || run.state.phase === "finished")) {
            runs.delete(name);
            runs.set(name, {
              id: callId,
              title: name,
              state: { phase: "queued" },
              startedAt: new Date().toISOString(),
            });
            calls.set(callId, new Map([[name, callId]]));
            render();
          } else if (tool === "interrupt_agent" && run) {
            calls.set(callId, new Map([[name, run.id]]));
          } else if (tool === "wait_all_agents") {
            const targets = Array.isArray(a.targets)
              ? a.targets.map(codexAgentName).filter(Boolean)
              : [];
            calls.set(
              callId,
              new Map(
                [...runs].flatMap(([name, run]) =>
                  (
                    targets.length
                      ? targets.includes(name)
                      : run.state.phase === "running"
                  )
                    ? [[name, run.id] as const]
                    : [],
                ),
              ),
            );
          }
          return;
        }

        const targets = calls.get(callId);
        calls.delete(callId);
        const result = record(event.result);
        const d = record(result.details);
        if (launch) {
          const name = targets?.keys().next().value;
          const run = name ? runs.get(name) : undefined;
          if (!name || run?.id !== callId || run.state.phase !== "queued")
            return;
          if (event.isError === true) runs.delete(name);
          else runs.set(name, { ...run, state: { phase: "running" } });
        } else if (event.isError === true) {
          return;
        } else if (tool === "interrupt_agent") {
          for (const [name, id] of targets ?? [])
            finish(name, codexOutcome(d.previous_status) ?? "interrupted", id);
        } else if (tool === "wait_agent") {
          const match =
            /^Wait completed: (\S+) (completed|failed|interrupted)\.$/.exec(
              text(d.message) ?? "",
            );
          if (match) finish(codexAgentName(match[1]), codexOutcome(match[2]));
        } else if (tool === "wait_all_agents") {
          if (
            d.truncated === true &&
            d.message === "All target agents reached final status."
          ) {
            for (const [name, id] of targets ?? []) finish(name, "unknown", id);
          } else {
            const first = Array.isArray(result.content)
              ? record(result.content[0])
              : {};
            let payload: Value;
            try {
              payload = record(
                JSON.parse(typeof first.text === "string" ? first.text : ""),
              );
            } catch {
              return;
            }
            if (Array.isArray(payload.responses)) {
              for (const item of payload.responses) {
                const response = record(item);
                const name = codexAgentName(response.agent_name);
                finish(name, codexOutcome(response.status), targets?.get(name));
              }
            }
          }
        } else return;
        render();
      });
    },
  };
}

const SCHEDULE_PKG = "pi-schedule-prompt";

// Mirrors pi-schedule-prompt 0.5.x storage.ts: <agentDir>/schedule-prompts/projects/<sha256(realpath(cwd))>.json
function scheduleStorePath(storeDir: string, cwd: string) {
  let path = resolve(cwd);
  try {
    path = realpathSync.native(path);
  } catch {
    /* The Extension falls back to the resolved path too. */
  }
  return join(
    storeDir,
    `${createHash("sha256").update(path).digest("hex")}.json`,
  );
}

function scheduleTiming(job: Value): ScheduleTiming {
  const schedule = text(job.schedule, 256) ?? "";
  if (job.type === "once") {
    const at = iso(job.nextRun) ?? iso(schedule);
    return at
      ? { kind: "once", at }
      : { kind: "opaque", description: `once ${schedule}` };
  }
  if (
    job.type === "interval" &&
    typeof job.intervalMs === "number" &&
    job.intervalMs > 0
  )
    return { kind: "interval", milliseconds: job.intervalMs };
  if (job.type === "cron" && schedule)
    return { kind: "cron", expression: schedule };
  return { kind: "opaque", description: `${String(job.type)} ${schedule}` };
}

function scheduleDefinition(job: Value, id: string): ScheduleDefinition {
  const lastRun = iso(job.lastRun);
  const runs: RunRecord[] = lastRun
    ? [
        {
          id: `${id}:last`,
          title: "Last run",
          // "success" means the prompt was dispatched, not that the agent finished the work.
          state:
            job.lastStatus === "running"
              ? { phase: "running" }
              : {
                  phase: "finished",
                  outcome: job.lastStatus === "error" ? "error" : "success",
                  label: job.lastStatus === "error" ? undefined : "Prompt sent",
                },
          startedAt: lastRun,
          detail: text(job.prompt),
        },
      ]
    : [];
  return {
    id,
    title: text(job.name, 256) ?? id,
    enabled: typeof job.enabled === "boolean" ? job.enabled : null,
    timing: scheduleTiming(job),
    ...(iso(job.nextRun) && job.enabled ? { nextRunAt: iso(job.nextRun) } : {}),
    lifetime: job.session ? "This session" : "Shared in this project",
    runs,
  };
}

/** Jobs from pi-schedule-prompt's own store, re-read on its `cron:change` event. */
export function connectSchedulePrompt(
  storeDir = join(getAgentDir(), "schedule-prompts", "projects"),
): SessionAdapter {
  return {
    id: "pig:schedule-prompt",
    connect(ctx) {
      const file = scheduleStorePath(storeDir, ctx.session.cwd);
      let registered = false;
      const render = () => {
        const source = loadedFrom(ctx, SCHEDULE_PKG, "schedule-prompt");
        if (!source) return ctx.views.remove("schedule-prompt");
        if (!registered) {
          registered = true;
          // Opens the Extension's own Jobs UI; pig never edits its store.
          ctx.commands.register({
            id: "manage",
            title: "Manage scheduled prompts",
            run: () => ctx.pi.invoke({ name: "schedule-prompt", source }),
          });
        }
        let jobs: Value[] = [];
        try {
          const store = record(JSON.parse(readFileSync(file, "utf-8")));
          if (Array.isArray(store.jobs)) jobs = store.jobs.map(record);
        } catch {
          /* No store yet, or one being rewritten: show nothing. */
        }
        const schedules = jobs
          .filter((job) => !job.session || job.session === ctx.session.id)
          .flatMap((job) => {
            const id = text(job.id, 256);
            return id ? [scheduleDefinition(job, id)] : [];
          });
        if (!schedules.length) return ctx.views.remove("schedule-prompt");
        ctx.views.set({
          kind: "schedule",
          id: "schedule-prompt",
          title: "Scheduled prompts",
          source: {
            label: SCHEDULE_PKG,
            scope: { kind: "session", id: ctx.session.id },
            freshness: "live",
          },
          schedules,
          actions: [{ id: "manage", label: "Manage", command: "manage" }],
        });
      };
      const off = ctx.sources.onBus("cron:change", render);
      render();
      return off;
    },
  };
}

/** True while a live view reports work that only exists inside the loaded Extension. */
export function holdsLiveWork(state: SessionUIState): boolean {
  return state.views.some(({ adapterId, view }) => {
    if (view.source.freshness !== "live") return false;
    if (view.kind === "agents")
      return view.runs.some(({ state }) =>
        adapterId === "pig:subagents"
          ? state.phase === "queued" || state.phase === "running"
          : state.phase !== "finished",
      );
    if (view.kind === "schedule")
      return view.schedules.some((schedule) => schedule.enabled !== false);
    return false;
  });
}

/** Supported-Extension adapters run before user adapters and never replace them. */
export function withSupportedAdapters(
  config: PigConfig,
  bus: Pick<EventBus, "emit">,
): PigConfig {
  return {
    ...config,
    sessionAdapters: [
      connectPigSubagents(bus),
      connectCodexSubagents(),
      connectNicoSubagents(bus),
      connectSchedulePrompt(),
      ...(config.sessionAdapters ?? []),
    ],
  };
}
