import type {
  InstalledPackage,
  PackageApplyReport,
  PackageChange,
  PackageEvent,
  PackageOpStatus,
} from "../shared/packages";

export type PackageViewState = {
  installed: InstalledPackage[];
  operations: PackageOpStatus[];
  applications: { change: PackageChange; report: PackageApplyReport }[];
  diagnostics: string[];
};
export function emptyPackageState(): PackageViewState {
  return { installed: [], operations: [], applications: [], diagnostics: [] };
}
/** Stale/cross-profile events never replace the selected profile's Installed state. */
export function receivePackageEvent(
  state: PackageViewState,
  agentDir: string,
  event: PackageEvent,
): PackageViewState {
  const profile =
    event.type === "operation"
      ? event.operation.agentDir
      : event.type === "apply"
        ? event.change.agentDir
        : event.agentDir;
  if (profile !== agentDir) return state;
  if (event.type === "installed")
    return { ...state, installed: event.packages };
  if (event.type === "diagnostic")
    return {
      ...state,
      diagnostics: [...state.diagnostics, event.message].slice(-30),
    };
  if (event.type === "operation")
    return {
      ...state,
      operations: [
        ...state.operations.filter((op) => op.opId !== event.operation.opId),
        event.operation,
      ].slice(-30),
    };
  return {
    ...state,
    applications: [
      ...state.applications.filter(
        (app) => app.change.opId !== event.change.opId,
      ),
      { change: event.change, report: event.report },
    ].slice(-30),
  };
}
export function compatibilityLabel(status: string): string {
  switch (status) {
    case "gui-tested":
      return "GUI tested";
    case "terminal-tested":
      return "Terminal tested";
    case "limited":
      return "Some limitations";
    default:
      return "UI unverified";
  }
}
