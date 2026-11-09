import type {
  RunRecord,
  SessionUIState,
  ViewEnvelope,
} from "../../../../packages/config/src";

export type DockTab = "todo" | "tasks" | "info";
export type DockRun = {
  key: string;
  envelope: ViewEnvelope;
  run: RunRecord;
  kind: "agents" | "background";
};

export function dockRuns(state: SessionUIState | undefined): DockRun[] {
  if (!state) return [];
  return state.views.flatMap((envelope) => {
    const view = envelope.view;
    if (view.kind !== "agents" && view.kind !== "background") return [];
    return view.runs.map((run) => ({
      key: JSON.stringify([
        state.generation,
        envelope.adapterId,
        view.id,
        run.id,
        run.startedAt ?? null,
      ]),
      envelope,
      run,
      kind: view.kind,
    }));
  });
}

export function dockTodos(state: SessionUIState | undefined): ViewEnvelope[] {
  return (state?.views ?? []).filter(
    ({ view }) => view.kind === "todo" && view.items.length > 0,
  );
}

export function dockOtherViews(
  state: SessionUIState | undefined,
): ViewEnvelope[] {
  return (state?.views ?? []).filter(({ view }) => {
    switch (view.kind) {
      case "todo":
      case "agents":
      case "background":
        return false;
      case "schedule":
        return view.schedules.length > 0;
      case "annotations":
        return view.threads.length > 0;
      case "status":
      case "document":
        return view.text.trim().length > 0;
      case "goal":
        return view.objective.trim().length > 0;
      case "mode":
        return true;
      default:
        return false;
    }
  });
}

export function isActiveRun(item: DockRun): boolean {
  if (item.envelope.view.source.freshness !== "live") return false;
  switch (item.run.state.phase) {
    case "queued":
    case "running":
    case "waiting":
    case "paused":
      return true;
    default:
      return false;
  }
}

export type RunVisibility = ReadonlyMap<
  string,
  { active: boolean; endedAt?: number; dismissed?: boolean }
>;

/** Renderer-only observations: a loss of freshness is not a successful outcome. */
export function observeDockRuns(
  previous: RunVisibility,
  items: readonly DockRun[],
  now: number,
): RunVisibility {
  const next = new Map<
    string,
    { active: boolean; endedAt?: number; dismissed?: boolean }
  >();
  let changed = false;
  for (const item of items) {
    const before = previous.get(item.key);
    const active = isActiveRun(item);
    const after = !before
      ? { active }
      : before.active === active
        ? before
        : active
          ? { active: true }
          : { ...before, active: false, endedAt: now };
    next.set(item.key, after);
    if (after !== before) changed = true;
  }
  return changed || next.size !== previous.size ? next : previous;
}

const GRACE_MS = 10_000;

export function visibleDockRuns(
  visibility: RunVisibility,
  items: readonly DockRun[],
  now: number,
  pinnedKey?: string | null,
): DockRun[] {
  return items.filter((item) => {
    const observed = visibility.get(item.key);
    if (observed?.dismissed) return false;
    if (item.key === pinnedKey) return true;
    if (observed?.active && isActiveRun(item)) return true;
    return observed?.endedAt !== undefined && now < observed.endedAt + GRACE_MS;
  });
}

/** Dismissal changes only local visibility, never a run or its source envelope. */
export function dismissDockRun(
  visibility: RunVisibility,
  key: string,
): RunVisibility {
  const observed = visibility.get(key);
  if (!observed || observed.dismissed) return visibility;
  const next = new Map(visibility);
  next.set(key, { ...observed, dismissed: true });
  return next;
}

export function nextDockExpiry(
  visibility: RunVisibility,
  items: readonly DockRun[],
  now: number,
  pinnedKey?: string | null,
): number | null {
  let earliest: number | null = null;
  for (const { key } of items) {
    const observed = visibility.get(key);
    if (!observed || observed.active || observed.dismissed || key === pinnedKey)
      continue;
    if (observed.endedAt === undefined) continue;
    const expiry = observed.endedAt + GRACE_MS;
    if (expiry > now && (earliest === null || expiry < earliest))
      earliest = expiry;
  }
  return earliest;
}

export function dockTodoSummary(envelopes: readonly ViewEnvelope[]): {
  total: number;
  completed: number;
  cancelled: number;
  remaining: number;
  current: string | undefined;
  activeCount: number;
  symbol: string;
  finished: boolean;
} {
  let total = 0;
  let completed = 0;
  let cancelled = 0;
  let activeCount = 0;
  let current: string | undefined;
  for (const { view } of envelopes) {
    if (view.kind !== "todo") continue;
    for (const item of view.items) {
      total++;
      if (item.state === "completed") completed++;
      if (item.state === "cancelled") cancelled++;
      if (item.state === "active") {
        activeCount++;
        current ??= item.activeLabel ?? item.title;
      }
    }
  }
  const remaining = total - completed - cancelled;
  const finished = remaining === 0;
  return {
    total,
    completed,
    cancelled,
    remaining,
    current,
    activeCount,
    finished,
    symbol: total > 0 && cancelled === total ? "⊘" : finished ? "✓" : "◐",
  };
}

export function resolveDockTab(
  chosen: DockTab | null,
  available: readonly DockTab[],
  activeRuns: number,
  activeTodos: number,
): DockTab | null {
  if (chosen !== null && available.includes(chosen)) return chosen;
  if (activeRuns > 0 && available.includes("tasks")) return "tasks";
  if (activeTodos > 0 && available.includes("todo")) return "todo";
  return available[0] ?? null;
}
