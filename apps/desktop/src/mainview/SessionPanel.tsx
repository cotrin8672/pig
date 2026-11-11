import { Bot, Check, ChevronDown, ChevronUp, Terminal, X } from "lucide-react";
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
  SessionActionRequest,
  SessionUIState,
  SessionView,
  ViewEnvelope,
} from "../../../../packages/config/src";
import { useT } from "./i18n";
import { Markdown } from "./MessageContent";
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
  resolveDockTab,
  visibleDockRuns,
} from "./session-dock-state";
import {
  actionDisabledReason,
  actionRequest,
  envelopeKey,
  timingLabel,
} from "./session-panel-model";
import { isInlineResultVisible } from "./session-read";
import "./session-panel.css";

export interface SessionPanelProps {
  state?: SessionUIState;
  configError?: string;
  onAction: (request: SessionActionRequest) => Promise<void>;
  onActionError?: (error: unknown) => void;
  onReload: () => Promise<void>;
  sessionId?: string;
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
function Facts({ facts }: { facts?: { label: string; value: string }[] }) {
  return facts?.length ? (
    <dl>
      {facts.map((fact, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Facts have no IDs or local state; duplicates are allowed.
        <Fact key={index} {...fact} />
      ))}
    </dl>
  ) : null;
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
              <input {...props} type="text" />
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
function Run({
  run,
  context,
  children,
}: {
  run: RunRecord;
  context: ActionContext;
  children?: ReactNode;
}) {
  return (
    <>
      <h4>{run.title}</h4>
      <RunStatus state={run.state} />
      <dl>
        <Fact label="Run ID" value={run.id} />
        <Fact label="Started" value={run.startedAt} />
        <Fact label="Ended" value={run.endedAt} />
      </dl>
      {run.detail && <p className="session-text">{run.detail}</p>}
      {children}
      {run.origin && (
        <p>
          <Resource resource={run.origin} />
        </p>
      )}
      <Facts facts={run.facts} />
      {run.output && (
        <details>
          <summary>
            Logs / result · {run.output.stream ?? "output"}
            {run.output.truncated ? " · truncated" : ""}
          </summary>
          <pre>{run.output.text}</pre>
        </details>
      )}
      <Actions context={context} actions={run.actions} />
    </>
  );
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
      return null;
    case "schedule":
      return (
        <>
          <ul className="session-items">
            {view.schedules.map((schedule) => (
              <li key={schedule.id}>
                <h4>{schedule.title}</h4>
                <span className="session-badge">
                  {schedule.enabled === null
                    ? "Enabled state unknown"
                    : schedule.enabled
                      ? "Enabled"
                      : "Disabled"}
                </span>
                <dl>
                  <Fact label="Schedule ID" value={schedule.id} />
                  <Fact label="Timing" value={timingLabel(schedule.timing)} />
                  <Fact
                    label="Next run (reported)"
                    value={schedule.nextRunAt ?? "Not reported"}
                  />
                  <Fact label="Lifetime" value={schedule.lifetime} />
                  <Fact label="Policy" value={schedule.policy} />
                </dl>
                <Actions context={context} actions={schedule.actions} />
                <details>
                  <summary>Run history ({schedule.runs?.length ?? 0})</summary>
                  {schedule.runs?.length ? (
                    <ul className="session-items">
                      {schedule.runs.map((run) => (
                        <li key={run.id}>
                          <Run run={run} context={context} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No reported runs.</p>
                  )}
                </details>
              </li>
            ))}
          </ul>
          {!view.schedules.length && (
            <p className="session-muted">No schedules.</p>
          )}
        </>
      );
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
  const { view, adapterId, revision } = context.envelope;
  const t = useT();
  return (
    <details
      className={`session-view-details session-kind-${view.kind}`}
      open={view.kind === "status"}
    >
      <summary>{view.title}</summary>
      <div className="session-detail-body">
        <ViewContent view={view} context={context} />
        <Facts facts={view.facts} />
        <Actions
          key={envelopeKey(context.state, context.envelope)}
          context={context}
          actions={view.actions}
        />
        <details className="session-provenance">
          <summary>{t.dockConnections}</summary>
          <dl>
            <Fact label="Adapter" value={adapterId} />
            <Fact label="View ID" value={view.id} />
            <Fact label="Revision" value={revision} />
            <Fact label="Source" value={view.source.label} />
            <Fact label="State" value={view.source.freshness} />
          </dl>
          {view.origin && <Resource resource={view.origin} />}
        </details>
      </div>
    </details>
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
              <span title={item.title}>{item.title}</span>
              {(item.description ||
                item.owner ||
                item.dependsOn?.length ||
                item.availability ||
                item.stateLabel) && (
                <details className="session-row-details">
                  <summary>{t.dockDetails}</summary>
                  <p>{item.description}</p>
                  <dl>
                    <Fact label="Owner" value={item.owner} />
                    <Fact
                      label="Depends on"
                      value={item.dependsOn?.join(", ")}
                    />
                    <Fact label="Availability" value={item.availability} />
                    <Fact label="Status" value={item.stateLabel} />
                  </dl>
                </details>
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
      {!!view.facts?.length && (
        <details className="session-row-details">
          <summary>{t.dockDetails}</summary>
          <Facts facts={view.facts} />
        </details>
      )}
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

function TaskRow({
  item,
  context,
  expanded,
  now,
  onToggle,
  onDismiss,
}: {
  item: DockRun;
  context: ActionContext;
  expanded: boolean;
  now: number;
  onToggle(): void;
  onDismiss(): void;
}) {
  const t = useT();
  const contentId = useId();
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
  return (
    <li
      className="session-task-row"
      data-state={active ? run.state.phase : (run.state.outcome ?? "unknown")}
      data-expanded={expanded}
    >
      <div className="session-task-band">
        <button
          type="button"
          className="session-task-main"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={onToggle}
        >
          <span className="session-task-dot" aria-hidden="true" />
          {agent ? (
            <Bot size={13} aria-hidden="true" />
          ) : (
            <Terminal size={13} aria-hidden="true" />
          )}
          <span
            className={`session-task-name${process ? " is-command" : ""}`}
            title={label}
          >
            {label}
          </span>
          <span className="session-task-meta">{meta}</span>
        </button>
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
            title={t.dockDismiss}
            onClick={onDismiss}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {expanded && (
        <div id={contentId} className="session-task-output">
          {run.detail && <p>{run.detail}</p>}
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll this bounded output. */}
          <pre tabIndex={0}>{run.output?.text || t.dockNoOutput}</pre>
          {run.output?.truncated && <small>{t["Output truncated"]}</small>}
          <details className="session-row-details">
            <summary>{t.dockDetails}</summary>
            <dl>
              <Fact label="Task" value={agent?.task} />
              <Fact label="Model" value={agent?.model} />
              <Fact label="Profile" value={agent?.profile} />
              <Fact label="Parent" value={agent?.parentId} />
              <Fact label="Depends on" value={agent?.dependsOn?.join(", ")} />
              <Fact label="Working directory" value={process?.cwd} />
              <Fact label="Lifetime" value={process?.lifetime} />
              <Fact label="Exit signal" value={process?.exit?.signal} />
            </dl>
            {agent?.session && <Resource resource={agent.session} />}
            <Facts facts={run.facts} />
          </details>
        </div>
      )}
    </li>
  );
}

// Renderer-only disclosure memory; changing sessions must not reopen a closed dock.
let dockExpanded = false;
const chosenTabs = new Map<string, DockTab>();

export function SessionPanel({
  state,
  configError,
  onAction,
  onActionError,
  onReload,
  sessionId,
}: SessionPanelProps) {
  const t = useT();
  const id = useId();
  const key = sessionId ?? state?.generation ?? id;
  const [expanded, setExpanded] = useState(dockExpanded);
  const [chosenTab, setChosenTab] = useState<DockTab | null>(
    () => chosenTabs.get(key) ?? null,
  );
  const [openedRun, setOpenedRun] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const reloadPending = useRef(false);
  const [reloadError, setReloadError] = useState<string>();
  const summaryRef = useRef<HTMLButtonElement>(null);
  const [, tick] = useReducer((value) => value + 1, 0);
  const allRuns = useMemo(() => dockRuns(state), [state]);
  const todos = useMemo(() => dockTodos(state), [state]);
  const others = useMemo(() => dockOtherViews(state), [state]);
  const progress = dockTodoSummary(todos);
  const now = Date.now();
  const [visibility, setVisibility] = useState<RunVisibility>(() => new Map());
  const observed = observeDockRuns(visibility, allRuns, now);
  if (observed !== visibility) setVisibility(observed);
  const pinned = expanded && chosenTab === "tasks" ? openedRun : null;
  const runs = visibleDockRuns(observed, allRuns, now, pinned);
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
  const problems = !!(configError || reloadError || state?.diagnostics.length);
  const tabs: DockTab[] = [
    ...(todos.length ? ["todo" as const] : []),
    ...(runs.length ? ["tasks" as const] : []),
    ...(others.length || problems ? ["info" as const] : []),
  ];
  const tab = resolveDockTab(
    chosenTab,
    tabs,
    activeRuns.length,
    progress.activeCount,
  );
  const expiry = nextDockExpiry(observed, allRuns, now, pinned);
  useEffect(() => {
    const delay =
      expanded && activeRuns.length
        ? Math.min(1000, expiry ? Math.max(1, expiry - now) : 1000)
        : expiry
          ? Math.max(1, expiry - now)
          : null;
    if (delay === null) return;
    const timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [expanded, activeRuns.length, expiry, now]);
  function choose(next: DockTab) {
    setChosenTab(next);
    chosenTabs.set(key, next);
    if (chosenTabs.size > 64)
      chosenTabs.delete(chosenTabs.keys().next().value as string);
  }
  function disclose(next: boolean) {
    dockExpanded = next;
    setExpanded(next);
    if (next && tab) choose(tab);
    if (!next) summaryRef.current?.focus();
  }
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
  if (!tab) return null;
  const label = todos.length
    ? progress.cancelled === progress.total
      ? t.Cancelled
      : t.dockTodoProgress(
          progress.completed,
          progress.total - progress.cancelled,
        )
    : runs.length
      ? t.dockTaskCount(runs.length)
      : problems
        ? t.dockProblem
        : (others[0]?.view.title ?? t.dockInfo);
  const tabLabels = {
    todo: t.dockProgress,
    tasks: t.dockTasks,
    info: t.dockInfo,
  };
  const context = (envelope: ViewEnvelope): ActionContext => ({
    state: state as SessionUIState,
    envelope,
    onAction,
    onActionError,
  });
  return (
    <aside
      className="session-panel"
      aria-label={t.dockTitle}
      data-expanded={expanded}
    >
      <header className="session-dock-header">
        <button
          ref={summaryRef}
          id={`${id}-summary`}
          type="button"
          className="session-dock-summary"
          aria-expanded={expanded}
          aria-controls={`${id}-content`}
          onClick={() => disclose(!expanded)}
        >
          <span
            className={`session-dock-symbol${problems ? " is-warning" : ""}`}
            aria-hidden="true"
          >
            {problems ? "!" : todos.length ? progress.symbol : "◐"}
          </span>
          <span className="session-dock-label">{label}</span>
          {progress.current && (
            <span className="session-dock-current" title={progress.current}>
              {progress.current}
              {progress.activeCount > 1
                ? ` · ${t.dockMoreActive(progress.activeCount - 1)}`
                : ""}
            </span>
          )}
          {running > 0 && (
            <span className="session-dock-live">
              <i aria-hidden="true" />
              <span>{t.dockRunningCount(running)}</span>
            </span>
          )}
        </button>
        {tabs.length > 1 && (
          <div
            className="session-dock-tabs"
            role="tablist"
            aria-label={t.dockTitle}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const index = tabs.indexOf(tab);
              const next =
                tabs[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          tabs.length) %
                        tabs.length
                ];
              disclose(true);
              choose(next);
              document.getElementById(`${id}-${next}-tab`)?.focus();
            }}
          >
            {tabs.map((value) => (
              <button
                type="button"
                key={value}
                id={`${id}-${value}-tab`}
                role="tab"
                tabIndex={value === tab ? 0 : -1}
                aria-selected={value === tab}
                aria-controls={`${id}-${value}`}
                onClick={() => {
                  disclose(true);
                  choose(value);
                }}
              >
                {tabLabels[value]}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="session-dock-toggle"
          aria-label={expanded ? t.dockCollapse : t.dockExpand}
          aria-expanded={expanded}
          aria-controls={`${id}-content`}
          onClick={() => disclose(!expanded)}
        >
          {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
      </header>
      {/* biome-ignore lint/a11y/useSemanticElements: This is a keyboard event group, not a form fieldset. */}
      <div
        id={`${id}-content`}
        className="session-dock-content"
        role="group"
        aria-label={t.dockTitle}
        hidden={!expanded}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            disclose(false);
          }
        }}
      >
        {tabs.map((value) => (
          <div
            key={value}
            id={`${id}-${value}`}
            className="session-dock-viewport"
            role="tabpanel"
            aria-labelledby={
              tabs.length > 1 ? `${id}-${value}-tab` : `${id}-summary`
            }
            hidden={tab !== value}
            tabIndex={expanded && tab === value ? 0 : -1}
          >
            {value === "todo" &&
              todos.map((envelope) => (
                <TodoRows
                  key={JSON.stringify([envelope.adapterId, envelope.view.id])}
                  context={context(envelope)}
                />
              ))}
            {value === "tasks" && (
              <ul className="session-task-list">
                {runs.map((item) => (
                  <TaskRow
                    key={item.key}
                    item={item}
                    context={context(item.envelope)}
                    expanded={openedRun === item.key}
                    now={now}
                    onToggle={() => {
                      choose("tasks");
                      setOpenedRun(openedRun === item.key ? null : item.key);
                    }}
                    onDismiss={() => {
                      setVisibility(dismissDockRun(observed, item.key));
                      if (openedRun === item.key) setOpenedRun(null);
                      summaryRef.current?.focus();
                    }}
                  />
                ))}
              </ul>
            )}
            {value === "tasks" &&
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
                  {!!envelope.view.facts?.length && (
                    <details>
                      <summary>
                        {envelope.view.title} · {t.dockDetails}
                      </summary>
                      <Facts facts={envelope.view.facts} />
                    </details>
                  )}
                  {envelope.view.kind === "agents" &&
                    !!envelope.view.relations?.length && (
                      <details>
                        <summary>{t.dockDetails}</summary>
                        <ul>
                          {envelope.view.relations.map((relation, index) => (
                            <li
                              // biome-ignore lint/suspicious/noArrayIndexKey: Relations have no native IDs or local state; duplicates are allowed.
                              key={`${relation.from}:${relation.to}:${index}`}
                            >
                              {relation.from} → {relation.to} · {relation.kind}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                </div>
              ))}
            {value === "info" && (
              <>
                {(configError || reloadError) && (
                  <p className="session-error" role="alert">
                    {configError || reloadError}
                  </p>
                )}
                {state?.diagnostics.map((item) => (
                  <p
                    className="session-error"
                    role="alert"
                    key={item.adapterId}
                  >
                    {item.adapterId}: {item.message}
                  </p>
                ))}
                {others.map((envelope) => (
                  <ViewCard
                    key={JSON.stringify([envelope.adapterId, envelope.view.id])}
                    context={context(envelope)}
                  />
                ))}
              </>
            )}
          </div>
        ))}
        <details className="session-connections">
          <summary>{t.dockConnections}</summary>
          <div>
            <button
              type="button"
              disabled={reloading}
              aria-busy={reloading}
              onClick={() => void reload()}
            >
              {t.dockReload}
            </button>
            {reloadError && tab !== "info" && <p role="alert">{reloadError}</p>}
            <ul>
              {state?.commands.map((command) => (
                <li
                  key={JSON.stringify([command.adapterId, command.id])}
                  aria-busy={command.busy}
                >
                  {command.title} · {command.adapterId}/{command.id}
                </li>
              ))}
            </ul>
            <ul>
              {state?.keymaps.map((binding) => (
                <li
                  key={JSON.stringify([
                    binding.adapter,
                    binding.command,
                    binding.keys,
                    binding.when,
                  ])}
                >
                  <kbd>{binding.keys}</kbd> · {binding.adapter}/
                  {binding.command} · {binding.when}
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </aside>
  );
}
