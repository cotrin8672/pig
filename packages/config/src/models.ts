import type { Json } from "./index";

/** All values cross the Host/WebView boundary as data, never components or handlers. */
export interface Action {
  id: string;
  label: string;
  command: string;
  input?: Json;
  disabled?: string;
  confirmation?: string;
  /** User-entered values are passed as { value: input, fields: Record<string,string> }. */
  fields?: {
    name: string;
    label: string;
    required?: boolean;
    multiline?: boolean;
  }[];
}
export interface ResourceRef {
  kind: "message" | "session" | "file" | "document" | "diff" | "url";
  id: string;
  label?: string;
  revision?: string;
}
export interface Provenance {
  label: string;
  scope: { kind: "session" | "project" | "shared" | "global"; id: string };
  freshness: "live" | "saved" | "unknown";
  observedAt?: string;
}
export interface ViewBase {
  id: string;
  title: string;
  source: Provenance;
  origin?: ResourceRef;
  actions?: Action[];
  /** Displayable source-specific facts; not an execution-policy escape hatch. */
  facts?: { label: string; value: string }[];
}
export interface WorkItem {
  id: string;
  identity: "native" | "snapshot";
  title: string;
  state: "pending" | "active" | "completed" | "cancelled" | "unknown";
  stateLabel?: string;
  description?: string;
  activeLabel?: string;
  owner?: string;
  dependsOn?: string[];
  availability?: string;
  actions?: Action[];
}
export interface TodoView extends ViewBase {
  kind: "todo";
  explanation?: string;
  items: WorkItem[];
}
/** Phase is not outcome: a finished invocation need not be a successful agent. */
export interface RunState {
  phase: "queued" | "running" | "waiting" | "paused" | "finished" | "unknown";
  outcome?: "success" | "error" | "cancelled" | "interrupted" | "unknown";
  label?: string;
}
export interface RunRecord {
  id: string;
  title: string;
  state: RunState;
  startedAt?: string;
  endedAt?: string;
  detail?: string;
  output?: {
    text: string;
    truncated?: boolean;
    stream?: "stdout" | "stderr" | "combined";
  };
  origin?: ResourceRef;
  actions?: Action[];
  facts?: { label: string; value: string }[];
}
export interface AgentRun extends RunRecord {
  /** Definition/worker identity, invocation identity (id), and conversation are distinct. */
  agentId?: string;
  session?: ResourceRef;
  parentId?: string;
  dependsOn?: string[];
  profile?: string;
  previousRunId?: string;
  task?: string;
  model?: string;
}
export interface AgentView extends ViewBase {
  kind: "agents";
  relations?: { kind: string; from: string; to: string }[];
  runs: AgentRun[];
}
export interface BackgroundRun extends RunRecord {
  command?: string;
  cwd?: string;
  processId?: string;
  exit?: { code?: number; signal?: string };
  lifetime?: "turn" | "session" | "host" | "external" | "unknown";
}
export interface BackgroundView extends ViewBase {
  kind: "background";
  runs: BackgroundRun[];
}
export type ScheduleTiming =
  | { kind: "once"; at: string }
  | { kind: "interval"; milliseconds: number; anchor?: string }
  | { kind: "cron"; expression: string; timezone?: string }
  | { kind: "opaque"; description: string };
export interface ScheduleDefinition {
  id: string;
  title: string;
  enabled: boolean | null;
  timing: ScheduleTiming;
  nextRunAt?: string;
  lifetime?: string;
  policy?: string;
  runs?: RunRecord[];
  actions?: Action[];
}
export interface ScheduleView extends ViewBase {
  kind: "schedule";
  schedules: ScheduleDefinition[];
}
export interface ModeView extends ViewBase {
  kind: "mode";
  axis: string;
  value: string | null;
  choices: { id: string; label: string; action?: Action }[];
  description?: string;
}
export interface GoalView extends ViewBase {
  kind: "goal";
  objective: string;
  state: RunState;
  reason?: string;
  measures?: { label: string; value: number; unit: string; limit?: number }[];
}
export interface AnnotationTarget {
  resource: ResourceRef;
  resolution: "exact" | "outdated" | "unresolved";
  range?:
    | {
        kind: "text";
        start: number;
        end: number;
        unit: "unicode-codepoint" | "utf16";
      }
    | { kind: "lines"; start: number; end: number; side?: "before" | "after" };
  quote?: { exact: string; prefix?: string; suffix?: string };
}
export interface AnnotationThread {
  id: string;
  target: AnnotationTarget;
  state: "open" | "resolved" | "unknown";
  comments: { id: string; body: string; author?: string; createdAt?: string }[];
  actions?: Action[];
}
export interface AnnotationView extends ViewBase {
  kind: "annotations";
  threads: AnnotationThread[];
}
export interface DocumentView extends ViewBase {
  kind: "document";
  resource: ResourceRef;
  text: string;
  format: "text" | "markdown";
  stage: "draft" | "final" | "unknown";
}
export interface StatusView extends ViewBase {
  kind: "status";
  text: string;
  tone: "info" | "warning" | "error";
}
export type SessionView =
  | TodoView
  | AgentView
  | BackgroundView
  | ScheduleView
  | ModeView
  | GoalView
  | AnnotationView
  | DocumentView
  | StatusView;

/** Action IDs are unique within a view, even when displayed on different items. */
export function viewActions(view: SessionView): Action[] {
  const actions = [...(view.actions ?? [])];
  if (view.kind === "todo")
    for (const item of view.items) actions.push(...(item.actions ?? []));
  if (view.kind === "agents" || view.kind === "background")
    for (const run of view.runs) actions.push(...(run.actions ?? []));
  if (view.kind === "schedule")
    for (const item of view.schedules) {
      actions.push(...(item.actions ?? []));
      for (const run of item.runs ?? []) actions.push(...(run.actions ?? []));
    }
  if (view.kind === "mode")
    for (const choice of view.choices)
      if (choice.action) actions.push(choice.action);
  if (view.kind === "annotations")
    for (const thread of view.threads) actions.push(...(thread.actions ?? []));
  return actions;
}
