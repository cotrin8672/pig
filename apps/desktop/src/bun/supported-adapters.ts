import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
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

const SUBAGENT_PKG = "@gotgenes/pi-subagents";
const MAX_FINISHED_AGENTS = 50;

function subagentState(status: unknown): RunState {
  switch (status) {
    case "queued":
      return { phase: "queued" };
    case "running":
      return { phase: "running" };
    case "completed":
      return { phase: "finished", outcome: "success" };
    case "error":
      return { phase: "finished", outcome: "error" };
    case "stopped":
      return { phase: "finished", outcome: "cancelled" };
    case "aborted":
      return { phase: "finished", outcome: "interrupted" };
    default:
      return { phase: "finished", outcome: "unknown" };
  }
}

/** Live runs from the session's `subagents:*` lifecycle events (per-session event bus). */
export function connectGotgenesSubagents(): SessionAdapter {
  return {
    id: "pig:subagents",
    connect(ctx) {
      // shortcut: runs started before this connection (e.g. before a config reload) are not shown; upgrade by reading the Extension's persisted records.
      const runs = new Map<string, AgentRun>();
      const render = () => {
        const finished = [...runs.values()].filter(
          (run) => run.state.phase === "finished",
        );
        for (const old of finished.slice(
          0,
          Math.max(0, finished.length - MAX_FINISHED_AGENTS),
        ))
          runs.delete(old.id);
        if (!runs.size || !loadedFrom(ctx, SUBAGENT_PKG, "subagents:settings"))
          return ctx.views.remove("subagents");
        ctx.views.set({
          kind: "agents",
          id: "subagents",
          title: "Subagents",
          source: {
            label: SUBAGENT_PKG,
            scope: { kind: "session", id: ctx.session.id },
            freshness: "live",
          },
          runs: [...runs.values()].reverse(),
        });
      };
      const update = (data: unknown, state: (data: Value) => RunState) => {
        const event = record(data);
        const id = text(event.id, 256);
        if (!id) return;
        const now = new Date().toISOString();
        const previous = runs.get(id);
        const next = state(event);
        const run: AgentRun = {
          ...previous,
          id,
          title: text(event.description, 256) ?? previous?.title ?? "Subagent",
          profile: text(event.type, 256) ?? previous?.profile,
          state: next,
          startedAt:
            previous?.startedAt && previous.state.phase !== "finished"
              ? previous.startedAt
              : now,
        };
        if (next.phase === "finished") {
          run.endedAt = now;
          const output = text(event.error) ?? text(event.result);
          if (output) run.output = { text: output };
        } else {
          // A resumed run must not show the previous run's result as its own.
          delete run.endedAt;
          delete run.output;
        }
        runs.delete(id);
        runs.set(id, run);
        render();
      };
      const on = (channel: string, state: (data: Value) => RunState) =>
        ctx.sources.onBus(channel, (data) => update(data, state));
      const offs = [
        on("subagents:created", () => ({ phase: "queued" })),
        on("subagents:started", () => ({ phase: "running" })),
        on("subagents:resuming", () => ({ phase: "running" })),
        on("subagents:completed", (e) => subagentState(e.status)),
        on("subagents:failed", (e) => subagentState(e.status)),
        on("subagents:resumed", (e) => subagentState(e.status)),
        ctx.sources.onBus("subagents:update", (data) => {
          const event = record(data);
          const run = runs.get(text(event.id, 256) ?? "");
          const message = text(event.message, 2_000);
          if (!run || !message) return;
          run.detail = message;
          render();
        }),
      ];
      return () => {
        for (const off of offs) off();
      };
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
  return state.views.some(({ view }) => {
    if (view.source.freshness !== "live") return false;
    if (view.kind === "agents")
      return view.runs.some((run) => run.state.phase !== "finished");
    if (view.kind === "schedule")
      return view.schedules.some((schedule) => schedule.enabled !== false);
    return false;
  });
}

/** Supported-Extension adapters run before user adapters and never replace them. */
export function withSupportedAdapters(config: PigConfig): PigConfig {
  return {
    ...config,
    sessionAdapters: [
      connectGotgenesSubagents(),
      connectSchedulePrompt(),
      ...(config.sessionAdapters ?? []),
    ],
  };
}
