import type { DesktopState } from "../shared/desktop-state";
import { modelKey, replaceModelVisibility } from "../shared/models";
import type { SessionInfo } from "../shared/rpc-schema";
import { OptimisticValue } from "./optimistic-value";
import { showError, useStore } from "./store";

const flags = new OptimisticValue<boolean>(showError);
export const sessionNames = new OptimisticValue<string>(showError);
export const projectNames = new OptimisticValue<string>(showError);
export const modelVisibility = new OptimisticValue<string[]>(showError);
export function overlayModelVisibility(disabled: string[]) {
  const models = useStore.getState().bootstrap.models;
  for (const provider of new Set(models.map((model) => model.provider))) {
    const desired = modelVisibility.value(provider);
    if (desired)
      disabled = replaceModelVisibility(
        disabled,
        models.filter((model) => model.provider === provider).map(modelKey),
        desired,
      );
  }
  return disabled;
}
const flagKey = (kind: string, id: string, field: string) =>
  JSON.stringify([kind, id, field]);
export function updateFlag(
  kind: "sessions" | "projects",
  id: string,
  field: "pinned" | "archived",
  desired: boolean,
  request: () => Promise<unknown>,
) {
  const current = !!useStore.getState().bootstrap.desktop[kind]?.[id]?.[field];
  return flags.change(
    flagKey(kind, id, field),
    current,
    desired,
    (value) => {
      useStore.setState((state) => ({
        bootstrap: {
          ...state.bootstrap,
          desktop: {
            ...state.bootstrap.desktop,
            [kind]: {
              ...state.bootstrap.desktop[kind],
              [id]: { ...state.bootstrap.desktop[kind]?.[id], [field]: value },
            },
          },
        },
      }));
    },
    async () => {
      await request();
      return desired;
    },
  );
}
export function overlayDesktop(desktop: DesktopState): DesktopState {
  const current = useStore.getState().bootstrap.desktop;
  const sessions = { ...desktop.sessions };
  const projects = { ...desktop.projects };
  for (const [kind, entries] of [
    ["sessions", sessions],
    ["projects", projects],
  ] as const) {
    for (const id of new Set([
      ...Object.keys(entries),
      ...Object.keys(current[kind] ?? {}),
    ])) {
      for (const field of ["pinned", "archived"] as const) {
        const value = flags.value(flagKey(kind, id, field));
        if (value !== undefined)
          entries[id] = { ...entries[id], [field]: value };
      }
    }
  }
  for (const cwd of new Set([
    ...Object.keys(projects),
    ...Object.keys(current.projects ?? {}),
  ])) {
    const name = projectNames.value(cwd);
    if (name !== undefined) projects[cwd] = { ...projects[cwd], name };
  }
  return { ...desktop, sessions, projects };
}
export function overlaySessionInfo(info: SessionInfo): SessionInfo {
  const name = sessionNames.value(info.id);
  return name === undefined ? info : { ...info, title: name };
}
export async function waitPreferenceWrites(
  kind: "sessions" | "projects",
  id: string,
) {
  await Promise.all([
    flags.flush(flagKey(kind, id, "pinned")),
    flags.flush(flagKey(kind, id, "archived")),
    (kind === "sessions" ? sessionNames : projectNames).flush(id),
  ]);
}
export function publishSessionName(id: string, title: string) {
  useStore.setState((state) => ({
    sessions: Object.fromEntries(
      Object.entries(state.sessions).map(([cwd, sessions]) => [
        cwd,
        sessions.map((session) =>
          session.id === id ? { ...session, title } : session,
        ),
      ]),
    ),
    snapshots: state.snapshots[id]
      ? {
          ...state.snapshots,
          [id]: {
            ...state.snapshots[id],
            info: { ...state.snapshots[id].info, title },
          },
        }
      : state.snapshots,
  }));
}
