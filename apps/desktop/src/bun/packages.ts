import { parsePackageSource } from "../shared/packages";
import type { InstalledPackage, PackageOpStatus } from "../shared/rpc-schema";
import { catalogPreviews, searchCatalog } from "./durable-package-catalog";
import {
  getPackageManager,
  PackageManagerError,
} from "./durable-package-manager";

export const searchPackages = async (input: unknown) => searchCatalog(input);
export const packagePreviews = async (input: unknown) => catalogPreviews(input);
export const listInstalled = async () => getPackageManager().listInstalled();

type OperationDependencies = Pick<
  ReturnType<typeof getPackageManager>,
  "mutate" | "listInstalled"
>;

/** Explicit storage mutation only; never import, activate, select or reload chats.
 * Host/config integration uses the manager's generation snapshot/moduleLocation/safety lease.
 */
export async function packageOperation(
  action: PackageOpStatus["action"],
  input: unknown,
  emit: (event: PackageOpStatus) => void,
  pushInstalled: (packages: InstalledPackage[]) => void,
  warn: (message: string) => void = console.warn,
  deps: OperationDependencies = getPackageManager(),
) {
  const value =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (
    typeof value.opId !== "string" ||
    !value.opId ||
    value.opId.length > 200 ||
    [...value.opId].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  ) {
    throw new Error("Invalid package operation ID");
  }
  let source = "(invalid source)";
  try {
    if (!["install", "update", "uninstall"].includes(action))
      throw new PackageManagerError("Invalid package action");
    let request: ReturnType<typeof parsePackageSource>;
    try {
      request = parsePackageSource(
        action === "install" ? value.name : value.source,
      );
    } catch {
      throw new PackageManagerError(
        "Invalid package source: use an npm name/spec or a canonical GitHub repository URL without credentials",
      );
    }
    source = request.source;
    emit({ opId: value.opId, source, action, status: "running" });
    // Manager owns serialization; callbacks below never hold the package queue.
    await deps.mutate(action, request.request);
  } catch (error) {
    const detail =
      error instanceof PackageManagerError
        ? error.message
        : "Package operation could not complete; current installation was not changed";
    const message = `Package ${action} failed for ${source}: ${detail}`;
    emit({ opId: value.opId, source, action, status: "error", message });
    throw new Error(message);
  }
  try {
    pushInstalled(await deps.listInstalled());
  } catch {
    warn(
      "Package storage changed, but the installed-list notification failed. Refresh the installed list; no code was loaded",
    );
  }
  emit({ opId: value.opId, source, action, status: "done" });
}
