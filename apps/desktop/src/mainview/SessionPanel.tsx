import {
  Bot,
  Check,
  ChevronRight,
  Clock,
  Info,
  ListChecks,
  type LucideIcon,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  Action,
  AgentRun,
  BackgroundRun,
  ResourceRef,
  RunRecord,
  RunState,
  ScheduleTiming,
  SessionActionRequest,
  SessionUIState,
  SessionView,
  ViewEnvelope,
} from "../../../../packages/config/src";
import { ComposerCountButton } from "./ComposerCountButton";
import { useT } from "./i18n";
import { Markdown } from "./MessageContent";
import { TextField } from "./primitives/TextField";
import {
  type DockRun,
  type DockTab,
  dismissDockRun,
  dockOtherViews,
  dockRuns,
  dockTodoSummary,
  dockTodos,
  isActiveRun,
  nextDockExpiry,
  observeDockRuns,
  type RunVisibility,
  visibleDockRuns,
} from "./session-dock-state";
import {
  actionDisabledReason,
  actionRequest,
  envelopeKey,
  timingLabel,
} from "./session-panel-model";
import { isInlineResultVisible } from "./session-read";
import { useComposerPopover } from "./useComposerPopover";
import "./session-indicators.css";
import "./session-panel.css";

export interface SessionPanelProps {
  state?: SessionUIState;
  configError?: string;
  onAction: (request: SessionActionRequest) => Promise<void>;
  onActionError?: (error: unknown) => void;
  onReload: () => Promise<void>;
  sessionId?: string;
  /** Opens this section on mount (Storybook previews and SSR tests). */
  initialTab?: DockTab;
}

type ActionContext = {
  state: SessionUIState;
  envelope: ViewEnvelope;
  onAction: SessionPanelProps["onAction"];
  onActionError?: SessionPanelProps["onActionError"];
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function Fact({ label, value }: { label: string; value?: ReactNode }) {
  return value === undefined || value === null || value === "" ? null : (
    <div className="session-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
/** Resource references are deliberately inert: a file/URL is not permission to read it. */
function Resource({ resource }: { resource: ResourceRef }) {
  return (
    <span className="session-resource">
      {resource.kind}: {resource.label ? `${resource.label} · ` : ""}
      {resource.id}
      {resource.revision !== undefined
        ? ` · revision ${resource.revision}`
        : ""}
    </span>
  );
}
function RunStatus({ state }: { state: RunState }) {
  return (
    <span
      className={`session-badge session-state-${state.outcome ?? state.phase}`}
    >
      {state.label ? `${state.label} · ` : ""}
      {state.phase}
      {state.outcome ? ` · ${state.outcome}` : ""}
    </span>
  );
}

function ActionForm({
  context,
  action,
}: {
  context: ActionContext;
  action: Action;
}) {
  const id = useId();
  const t = useT();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string>();
  const reason = actionDisabledReason(context.state, context.envelope, action);
  const disabled = pending || reason !== undefined;
  const busy = context.state.commands.find(
    (command) =>
      command.adapterId === context.envelope.adapterId &&
      command.id === action.command,
  )?.busy;
  const explanation =
    action.disabled !== undefined || !busy ? reason : undefined;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (pendingRef.current || disabled) return;
    setError(undefined);
    if (action.confirmation !== undefined && !armed) {
      setArmed(true);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setArmed(false);
    try {
      await context.onAction(
        actionRequest(context.state, context.envelope, action, fields),
      );
    } catch (failure) {
      setError(errorText(failure));
      if (
        !isInlineResultVisible(
          form,
          document.visibilityState === "visible",
          document.hasFocus(),
        )
      )
        context.onActionError?.(failure);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return (
    <form
      className="session-action"
      aria-label={action.label}
      onSubmit={submit}
    >
      {action.fields?.map((field, index) => {
        const props = {
          id: `${id}-${index}`,
          name: field.name,
          required: field.required,
          disabled,
          value: Object.hasOwn(fields, field.name) ? fields[field.name] : "",
          onChange: (
            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
          ) => {
            setFields((previous) => ({
              ...previous,
              [field.name]: event.target.value,
            }));
            setArmed(false);
          },
        };
        return (
          <div className="session-field" key={field.name}>
            <label htmlFor={props.id}>
              {field.label}
              {field.required ? ` (${t.dockRequired})` : ""}
            </label>
            {field.multiline ? (
              <textarea {...props} rows={3} />
            ) : (
              <TextField {...props} />
            )}
          </div>
        );
      })}
      {armed && (
        <p
          id={`${id}-confirmation`}
          className="session-confirmation"
          role="status"
        >
          {action.confirmation}
        </p>
      )}
      <div className="session-action-buttons">
        <button
          type="submit"
          disabled={disabled}
          aria-busy={pending || busy}
          aria-describedby={
            explanation !== undefined
              ? `${id}-reason`
              : armed
                ? `${id}-confirmation`
                : undefined
          }
        >
          {armed ? t.dockConfirm(action.label) : action.label}
        </button>
        {armed && (
          <button type="button" onClick={() => setArmed(false)}>
            {t.dockCancel(action.label)}
          </button>
        )}
      </div>
      {explanation !== undefined && (
        <small id={`${id}-reason`}>{explanation}</small>
      )}
      {error && (
        <p className="session-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
function Actions({
  context,
  actions,
}: {
  context: ActionContext;
  actions?: Action[];
}) {
  return actions?.length ? (
    <div className="session-actions">
      {actions.map((action) => (
        <ActionForm key={action.id} context={context} action={action} />
      ))}
    </div>
  ) : null;
}
function ViewContent({
  view,
  context,
}: {
  view: SessionView;
  context: ActionContext;
}) {
  switch (view.kind) {
    case "todo":
    case "agents":
    case "background":
    case "schedule":
      return null;
    case "mode":
      return (
        <>
          <dl>
            <Fact label="Axis" value={view.axis} />
            <Fact label="Current value" value={view.value ?? "Unknown"} />
          </dl>
          {view.description && <p>{view.description}</p>}
          <ul className="session-items">
            {view.choices.map((choice) => (
              <li key={choice.id}>
                <span>
                  {choice.label}{" "}
                  <span className="session-muted">({choice.id})</span>
                  {view.value === choice.id && (
                    <span className="session-badge">Current</span>
                  )}
                </span>
                {choice.action ? (
                  <Actions context={context} actions={[choice.action]} />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      );
    case "goal":
      return (
        <>
          <p className="session-objective">{view.objective}</p>
          <RunStatus state={view.state} />
          {view.reason && <p>{view.reason}</p>}
          <dl>
            {view.measures?.map((measure, index) => (
              <Fact
                // biome-ignore lint/suspicious/noArrayIndexKey: Measures have no IDs or local state; duplicate labels are allowed.
                key={index}
                label={measure.label}
                value={`${measure.value}${measure.limit !== undefined ? ` / ${measure.limit}` : ""} ${measure.unit}`}
              />
            ))}
          </dl>
        </>
      );
    case "annotations":
      return (
        <>
          <ul className="session-items">
            {view.threads.map((thread) => (
              <li key={thread.id}>
                <h4>Thread {thread.id}</h4>
                <span className="session-badge">
                  Thread state: {thread.state}
                </span>
                <p>
                  <Resource resource={thread.target.resource} />
                </p>
                <dl>
                  <Fact
                    label="Target resolution"
                    value={thread.target.resolution}
                  />
                  {thread.target.range && (
                    <Fact
                      label="Target range"
                      value={`${thread.target.range.kind} ${thread.target.range.start}–${thread.target.range.end} · ${thread.target.range.kind === "text" ? thread.target.range.unit : (thread.target.range.side ?? "side unspecified")}`}
                    />
                  )}
                </dl>
                {thread.target.quote && (
                  <blockquote>
                    {thread.target.quote.prefix && (
                      <span className="session-muted">
                        {thread.target.quote.prefix}
                      </span>
                    )}
                    <mark>{thread.target.quote.exact}</mark>
                    {thread.target.quote.suffix && (
                      <span className="session-muted">
                        {thread.target.quote.suffix}
                      </span>
                    )}
                  </blockquote>
                )}
                <ol className="session-comments">
                  {thread.comments.map((comment) => (
                    <li key={comment.id}>
                      <small>
                        {comment.author ?? "Unknown author"}
                        {comment.createdAt ? ` · ${comment.createdAt}` : ""}
                      </small>
                      <p className="session-text">{comment.body}</p>
                    </li>
                  ))}
                </ol>
                {!thread.comments.length && (
                  <p className="session-muted">No comments.</p>
                )}
                <Actions context={context} actions={thread.actions} />
              </li>
            ))}
          </ul>
          {!view.threads.length && (
            <p className="session-muted">No annotation threads.</p>
          )}
        </>
      );
    case "document":
      return (
        <>
          <p>
            <span className={`session-badge session-stage-${view.stage}`}>
              {view.stage}
            </span>{" "}
            <Resource resource={view.resource} />
          </p>
          {view.format === "markdown" ? (
            <div className="session-document markdown">
              <Markdown text={view.text} />
            </div>
          ) : (
            <pre className="session-document">{view.text}</pre>
          )}
        </>
      );
    case "status":
      return (
        <p
          className={`session-text session-tone-${view.tone}`}
          role={view.tone === "error" ? "alert" : "status"}
        >
          {view.text}
        </p>
      );
  }
}

function ViewCard({ context }: { context: ActionContext }) {
  const { view } = context.envelope;
  return (
    <section
      className={`session-view-details session-kind-${view.kind}`}
      aria-label={view.title}
    >
      <h4 className="session-view-title">{view.title}</h4>
      <div className="session-detail-body">
        <ViewContent view={view} context={context} />
        <Actions
          key={envelopeKey(context.state, context.envelope)}
          context={context}
          actions={view.actions}
        />
      </div>
    </section>
  );
}

function TodoRows({ context }: { context: ActionContext }) {
  const t = useT();
  const view = context.envelope.view;
  if (view.kind !== "todo") return null;
  return (
    <section aria-label={view.title}>
      {view.explanation && (
        <p className="session-list-description">{view.explanation}</p>
      )}
      <ul className="session-todo-list">
        {view.items.map((item) => (
          <li key={item.id} className={`session-todo-row is-${item.state}`}>
            <span
              className="session-todo-symbol"
              role="img"
              aria-label={t.dockState(item.state)}
            >
              {item.state === "completed" ? (
                <Check size={13} />
              ) : item.state === "active" ? (
                "•"
              ) : item.state === "cancelled" ? (
                "−"
              ) : item.state === "unknown" ? (
                "?"
              ) : (
                ""
              )}
            </span>
            <div className="session-todo-copy">
              <span aria-description={item.description ?? item.title}>
                {item.title}
              </span>
              {item.state === "active" && item.activeLabel && (
                <small className="session-todo-active">
                  {item.activeLabel}
                </small>
              )}
              <Actions
                key={envelopeKey(context.state, context.envelope)}
                context={context}
                actions={item.actions}
              />
            </div>
          </li>
        ))}
      </ul>
      <Actions
        key={envelopeKey(context.state, context.envelope)}
        context={context}
        actions={view.actions}
      />
    </section>
  );
}

function runTime(run: RunRecord, now: number): string {
  if (!run.startedAt || (run.state.phase === "finished" && !run.endedAt))
    return "";
  const seconds = Math.max(
    0,
    Math.floor(
      ((run.endedAt ? Date.parse(run.endedAt) : now) -
        Date.parse(run.startedAt)) /
        1000,
    ),
  );
  if (!Number.isFinite(seconds)) return "";
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m${seconds % 60}s`
      : `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}

/** One line per run plus, when reported, what it is doing (or said) last. */
function TaskRow({
  item,
  context,
  now,
  onDismiss,
}: {
  item: DockRun;
  context: ActionContext;
  now: number;
  onDismiss(): void;
}) {
  const t = useT();
  const run = item.run;
  const process =
    item.kind === "background" ? (run as BackgroundRun) : undefined;
  const agent = item.kind === "agents" ? (run as AgentRun) : undefined;
  const label = process?.command ?? run.title;
  const active = isActiveRun(item);
  const meta = [
    run.state.label ?? t.dockState(run.state.outcome ?? run.state.phase),
    item.envelope.view.source.freshness === "live"
      ? runTime(run, now)
      : t.dockSaved,
    process?.exit?.code !== undefined
      ? `${t["Exit code"]} ${process.exit.code}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const [open, setOpen] = useState(false);
  const log = run.output?.text.trim();
  const line =
    run.detail ??
    (open
      ? undefined
      : log
          ?.split("\n")
          .map((text) => text.trim())
          .filter(Boolean)
          .at(-1));
  const Main = log ? "button" : "div";
  return (
    <li
      className="session-task-row"
      data-state={active ? run.state.phase : (run.state.outcome ?? "unknown")}
    >
      <div className="session-task-band">
        <Main
          className="session-task-main"
          {...(log && {
            type: "button" as const,
            "aria-expanded": open,
            onClick: () => setOpen((value) => !value),
          })}
        >
          <span className="session-task-dot" aria-hidden="true" />
          {agent ? (
            <Bot size={13} aria-hidden="true" />
          ) : (
            <Terminal size={13} aria-hidden="true" />
          )}
          <span
            className={`session-task-name${process ? " is-command" : ""}`}
            aria-description={agent?.task ?? label}
          >
            {label}
          </span>
          <span className="session-task-meta">{meta}</span>
          {log && (
            <ChevronRight
              className="session-task-chevron"
              size={13}
              aria-hidden="true"
            />
          )}
        </Main>
        <Actions
          key={envelopeKey(context.state, context.envelope)}
          context={context}
          actions={run.actions}
        />
        {run.state.phase === "finished" && (
          <button
            type="button"
            className="session-task-dismiss"
            aria-label={`${t.dockDismiss}: ${run.title}`}
            onClick={onDismiss}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {line && <p className="session-task-line">{line}</p>}
      {open && log && <pre className="session-task-log">{log}</pre>}
    </li>
  );
}

function clockTime(iso: string, now: number): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const time = at.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return at.toDateString() === new Date(now).toDateString()
    ? time
    : `${at.getMonth() + 1}/${at.getDate()} ${time}`;
}
function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  return minutes % 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60}m`
    : `${minutes / 60}h`;
}
function shortTiming(timing: ScheduleTiming, now: number): string {
  switch (timing.kind) {
    case "once":
      return `1× ${clockTime(timing.at, now)}`;
    case "interval":
      return `↻ ${duration(timing.milliseconds)}`;
    case "cron":
      return timing.expression;
    case "opaque":
      return timing.description;
  }
}

/** One compact row per schedule: name, cadence and the next run at a glance. */
function ScheduleList({
  context,
  now,
}: {
  context: ActionContext;
  now: number;
}) {
  const t = useT();
  const view = context.envelope.view;
  if (view.kind !== "schedule") return null;
  return (
    <section aria-label={view.title}>
      <ul className="session-schedule-list">
        {view.schedules.map((schedule) => (
          <li
            key={schedule.id}
            className="session-schedule-row"
            data-enabled={schedule.enabled !== false}
          >
            <div className="session-schedule-band">
              <Clock size={13} aria-hidden="true" />
              <span className="session-schedule-name">{schedule.title}</span>
              <code
                className="session-schedule-timing"
                aria-description={timingLabel(schedule.timing)}
              >
                {shortTiming(schedule.timing, now)}
              </code>
              <span className="session-schedule-next">
                {schedule.enabled === false
                  ? t.dockPaused
                  : schedule.nextRunAt && schedule.timing.kind !== "once"
                    ? t.dockNextRun(clockTime(schedule.nextRunAt, now))
                    : ""}
              </span>
            </div>
            <Actions context={context} actions={schedule.actions} />
          </li>
        ))}
      </ul>
      <div className="session-task-group-actions">
        <Actions
          key={envelopeKey(context.state, context.envelope)}
          context={context}
          actions={view.actions}
        />
      </div>
    </section>
  );
}

const tabIcons: Record<DockTab, LucideIcon> = {
  todo: ListChecks,
  tasks: Bot,
  schedule: Clock,
  info: Info,
};

/**
 * Session activity (todos, subagents/background runs, scheduled prompts and
 * other adapter views) as counters in the composer toolbar. Contents open in
 * one top-layer panel above the composer, so their presence never adds a band
 * to the composer or moves the conversation.
 */
export function SessionPanel({
  state,
  configError,
  onAction,
  onActionError,
  onReload,
  initialTab,
}: SessionPanelProps) {
  const t = useT();
  const [reloading, setReloading] = useState(false);
  const reloadPending = useRef(false);
  const [reloadError, setReloadError] = useState<string>();
  const [, tick] = useReducer((value) => value + 1, 0);
  const allRuns = useMemo(() => dockRuns(state), [state]);
  const todos = useMemo(() => dockTodos(state), [state]);
  const views = useMemo(() => dockOtherViews(state), [state]);
  const schedules = views.filter(({ view }) => view.kind === "schedule");
  const others = views.filter(({ view }) => view.kind !== "schedule");
  const progress = dockTodoSummary(todos);
  const now = Date.now();
  const [visibility, setVisibility] = useState<RunVisibility>(() => new Map());
  const observed = observeDockRuns(visibility, allRuns, now);
  if (observed !== visibility) setVisibility(observed);
  const runs = visibleDockRuns(observed, allRuns, now);
  const taskEnvelopes = [
    ...new Map(
      runs.map((item) => [
        JSON.stringify([item.envelope.adapterId, item.envelope.view.id]),
        item.envelope,
      ]),
    ).values(),
  ];
  const activeRuns = runs.filter(isActiveRun);
  const running = activeRuns.filter(
    (item) => item.run.state.phase === "running",
  ).length;
  const problems = [
    configError,
    reloadError,
    ...(state?.diagnostics.map(
      (item) => `${item.adapterId}: ${item.message}`,
    ) ?? []),
  ].filter((message): message is string => !!message);
  const scheduleCount = schedules.reduce(
    (sum, { view }) =>
      sum + (view.kind === "schedule" ? view.schedules.length : 0),
    0,
  );
  const tabs: DockTab[] = [
    ...(todos.length ? ["todo" as const] : []),
    ...(runs.length ? ["tasks" as const] : []),
    ...(scheduleCount ? ["schedule" as const] : []),
    ...(others.length || problems.length ? ["info" as const] : []),
  ];
  const { shown, trigger, panel } = useComposerPopover(tabs, 420, initialTab);
  const expiry = nextDockExpiry(observed, allRuns, now);
  useEffect(() => {
    const delay =
      shown === "tasks" && activeRuns.length
        ? Math.min(1000, expiry ? Math.max(1, expiry - now) : 1000)
        : expiry
          ? Math.max(1, expiry - now)
          : null;
    if (delay === null) return;
    const timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [shown, activeRuns.length, expiry, now]);
  async function reload() {
    if (reloadPending.current) return;
    reloadPending.current = true;
    setReloading(true);
    setReloadError(undefined);
    try {
      await onReload();
    } catch (error) {
      setReloadError(errorText(error));
    } finally {
      reloadPending.current = false;
      setReloading(false);
    }
  }
  if (!tabs.length) return null;
  const counts: Record<DockTab, string> = {
    todo:
      progress.cancelled === progress.total
        ? "0"
        : `${progress.completed}/${progress.total - progress.cancelled}`,
    tasks: String(runs.length),
    schedule: String(scheduleCount),
    info: String(others.length + problems.length),
  };
  const tabLabels: Record<DockTab, string> = {
    todo: t.dockProgress,
    tasks: t.dockTasks,
    schedule: t.dockSchedules,
    info: problems.length ? t.dockProblem : t.dockInfo,
  };
  const icon = (tab: DockTab) =>
    tab === "info" && problems.length ? TriangleAlert : tabIcons[tab];
  const ActiveIcon = shown ? icon(shown) : null;
  const chipLabel = (tab: DockTab) =>
    tab === "todo"
      ? `${t.dockProgress}: ${t.dockTodoProgress(progress.completed, progress.total - progress.cancelled)}`
      : tab === "tasks" && running
        ? `${t.sessionIndicator(t.dockTasks, runs.length)} · ${t.dockRunningCount(running)}`
        : t.sessionIndicator(tabLabels[tab], Number(counts[tab]));
  const context = (envelope: ViewEnvelope): ActionContext => ({
    state: state as SessionUIState,
    envelope,
    onAction,
    onActionError,
  });
  return (
    <div className="session-activity">
      {tabs.map((tab) => (
        <ComposerCountButton
          {...trigger(tab)}
          key={tab}
          data-tab={tab}
          icon={icon(tab)}
          count={counts[tab]}
          warning={tab === "info" && problems.length > 0}
          live={
            (tab === "tasks" && running > 0) ||
            (tab === "todo" && progress.activeCount > 0)
          }
          aria-label={chipLabel(tab)}
        />
      ))}
      <div
        {...panel}
        className="session-indicator-panel session-panel"
        role="dialog"
        aria-label={shown ? tabLabels[shown] : t.dockTitle}
      >
        {shown && (
          <section>
            <h3>
              {ActiveIcon && <ActiveIcon size={13} aria-hidden="true" />}
              {tabLabels[shown]}
              {shown === "todo" && progress.current && (
                <em className="session-panel-current">{progress.current}</em>
              )}
              <span>{counts[shown]}</span>
            </h3>
            {shown === "todo" &&
              todos.map((envelope) => (
                <TodoRows
                  key={JSON.stringify([envelope.adapterId, envelope.view.id])}
                  context={context(envelope)}
                />
              ))}
            {shown === "tasks" && (
              <ul className="session-task-list">
                {runs.map((item) => (
                  <TaskRow
                    key={item.key}
                    item={item}
                    context={context(item.envelope)}
                    now={now}
                    onDismiss={() => {
                      setVisibility(dismissDockRun(observed, item.key));
                      panel.ref.current?.focus();
                    }}
                  />
                ))}
              </ul>
            )}
            {shown === "tasks" &&
              taskEnvelopes.map((envelope) => (
                <div
                  className="session-task-group-actions"
                  key={JSON.stringify([envelope.adapterId, envelope.view.id])}
                >
                  <Actions
                    key={envelopeKey(state as SessionUIState, envelope)}
                    context={context(envelope)}
                    actions={envelope.view.actions}
                  />
                </div>
              ))}
            {shown === "schedule" &&
              schedules.map((envelope) => (
                <ScheduleList
                  key={JSON.stringify([envelope.adapterId, envelope.view.id])}
                  context={context(envelope)}
                  now={now}
                />
              ))}
            {shown === "info" && (
              <>
                {problems.map((message) => (
                  <p className="session-error" role="alert" key={message}>
                    {message}
                  </p>
                ))}
                {others.map((envelope) => (
                  <ViewCard
                    key={JSON.stringify([envelope.adapterId, envelope.view.id])}
                    context={context(envelope)}
                  />
                ))}
                {problems.length > 0 && (
                  <div className="session-reload">
                    <button
                      type="button"
                      disabled={reloading}
                      aria-busy={reloading}
                      onClick={() => void reload()}
                    >
                      {reloading ? t.dockReloading : t.dockReload}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
