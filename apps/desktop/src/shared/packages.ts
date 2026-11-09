/** Marketplace transport contract; independent of the session/RPC implementation. */
export type PackageType = "extension" | "skill" | "theme" | "prompt";
export type PackageCompatibility = {
  status: "unverified" | "gui-tested" | "terminal-tested" | "limited";
  /** Required evidence for a tested status; never inferred from npm keywords. */
  evidence?: string;
  limitations?: string;
};
export type MarketPackage = {
  name: string;
  version: string;
  description: string;
  types: PackageType[];
  monthlyDownloads: number;
  compatibility: PackageCompatibility;
};
export type InstalledPackage = {
  source: string;
  scope: "user";
  name: string;
  version?: string;
  description?: string;
  types: PackageType[];
  compatibility: PackageCompatibility;
};
export type PackageSearch = { query: string; page: number };
export type PackageSearchResult = {
  items: MarketPackage[];
  total: number;
  pageSize: number;
};
export type PackageOperation = { opId: string } & (
  | { action: "install"; name: string }
  | { action: "update" | "uninstall"; source: string }
);
export type PackageChange = {
  opId: string;
  action: PackageOperation["action"];
  source: string;
  /** Absolute, process-fixed SDK profile; not the desktop settings directory. */
  agentDir: string;
};
export type PackageOpStatus = PackageChange & {
  status: "queued" | "running" | "done" | "error";
  message?: string;
};
export type PackageApplyReport = {
  status: "pending" | "applying" | "applied" | "error";
  message?: string;
  /** Active/input-waiting sessions must be deferred, never silently destroyed. */
  pendingSessionIds?: string[];
  /** Preserve SDK loader warnings, including duplicate host SDK modules. */
  diagnostics?: string[];
};
export type PackageEvent =
  | { type: "operation"; operation: PackageOpStatus }
  | { type: "installed"; agentDir: string; packages: InstalledPackage[] }
  | { type: "apply"; change: PackageChange; report: PackageApplyReport }
  | { type: "diagnostic"; agentDir: string; message: string };
export type PackageOperationResult = {
  operation: PackageOpStatus;
  apply: PackageApplyReport;
};
/** Bind these methods to RPC and forward subscribe events without renaming fields. */
export interface PackageService {
  readonly agentDir: string;
  search(input: PackageSearch): Promise<PackageSearchResult>;
  listInstalled(): Promise<InstalledPackage[]>;
  operate(input: PackageOperation): Promise<PackageOperationResult>;
  subscribe(listener: (event: PackageEvent) => void): () => void;
}

const types: PackageType[] = ["extension", "skill", "theme", "prompt"];
export function classify(
  keywords: readonly string[] | undefined,
): PackageType[] {
  const keys = (keywords ?? []).map((key) => key.toLowerCase());
  return types.filter((type) =>
    [type, `${type}s`, `pi-${type}`].some((key) => keys.includes(key)),
  );
}
export function validNpmName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length <= 214 &&
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
  );
}
export function npmName(source: string): string | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const name = source.slice(4).match(/^(@[^/@]+\/[^@]+|[^@]+)/)?.[1];
  return validNpmName(name) ? name : undefined;
}

/** No production package/version has passed GUI or terminal verification yet. */
export function packageCompatibility(
  _name: string,
  _version?: string,
): PackageCompatibility {
  return { status: "unverified" };
}
