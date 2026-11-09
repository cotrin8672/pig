import type {
  Action,
  AgentRun,
  ScheduleTiming,
  SessionActionRequest,
  SessionUIState,
  ViewEnvelope,
  WorkItem,
} from "../../../../packages/config/src";

/** IDs are scoped to an adapter, not globally unique command names. */
export function actionDisabledReason(
  state: SessionUIState,
  envelope: ViewEnvelope,
  action: Action,
): string | undefined {
  if (action.disabled !== undefined)
    return action.disabled || "Action unavailable";
  const command = state.commands.find(
    (item) =>
      item.adapterId === envelope.adapterId && item.id === action.command,
  );
  if (!command) return "Command not registered for this adapter";
  if (command.busy) return "Command is busy";
  return undefined;
}

export function actionRequest(
  state: SessionUIState,
  envelope: ViewEnvelope,
  action: Action,
  fields: Record<string, string>,
): SessionActionRequest {
  return {
    generation: state.generation,
    adapterId: envelope.adapterId,
    viewId: envelope.view.id,
    revision: envelope.revision,
    actionId: action.id,
    commandId: action.command,
    // Static action.input belongs to the host. Only declared user fields cross back.
    ...(action.fields !== undefined
      ? {
          input: Object.fromEntries(
            action.fields.map((field) => [
              field.name,
              Object.hasOwn(fields, field.name)
                ? (fields[field.name] ?? "")
                : "",
            ]),
          ),
        }
      : {}),
  };
}

/** Also keys forms: old confirmations and drafts must not survive a new envelope. */
export function envelopeKey(
  state: SessionUIState,
  envelope: ViewEnvelope,
): string {
  return JSON.stringify([
    state.generation,
    envelope.adapterId,
    envelope.view.id,
    envelope.revision,
  ]);
}

export function todoProgress(items: readonly WorkItem[]) {
  return {
    total: items.length,
    completed: items.filter((item) => item.state === "completed").length,
    cancelled: items.filter((item) => item.state === "cancelled").length,
  };
}

/** Presentation only: preserve source ordering and cap work/depth, even for cycles. */
export function agentDepths(runs: readonly AgentRun[]): number[] {
  const byId = new Map(runs.map((run) => [run.id, run]));
  return runs.map((run) => {
    const seen = new Set([run.id]);
    let parentId = run.parentId;
    let depth = 0;
    while (parentId && depth < 6) {
      if (seen.has(parentId)) break;
      const parent = byId.get(parentId);
      if (!parent) break;
      seen.add(parentId);
      depth++;
      parentId = parent.parentId;
    }
    return depth;
  });
}

export function timingLabel(timing: ScheduleTiming): string {
  switch (timing.kind) {
    case "once":
      return `Once · ${timing.at}`;
    case "interval":
      return `Interval · ${timing.milliseconds} ms${timing.anchor ? ` · anchor ${timing.anchor}` : ""}`;
    case "cron":
      return `Cron · ${timing.expression}${timing.timezone ? ` · timezone ${timing.timezone}` : ""}`;
    case "opaque":
      return timing.description;
  }
}
