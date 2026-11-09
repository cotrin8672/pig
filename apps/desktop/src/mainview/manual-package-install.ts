import { parsePackageSource } from "../shared/packages";
import type { PackageOpStatus } from "../shared/rpc-schema";

type PackageAction = PackageOpStatus["action"];
export type PackageDispatchResult =
  | { status: "started" | "running"; opId: string; source: string }
  | { status: "invalid"; message: string }
  | { status: "error"; opId: string; source: string; message: string };

export interface PackageDispatchPorts {
  operations: () => Record<string, PackageOpStatus>;
  // Record synchronously so a second submission sees the same operation ID.
  emit: (event: PackageOpStatus) => void;
  send: {
    installPackage: (input: { opId: string; name: string }) => void;
    uninstallPackage: (input: { opId: string; source: string }) => void;
    updatePackage: (input: { opId: string; source: string }) => void;
  };
  newOpId: () => string;
  messages: { invalid: string; transport: string };
}

function canonicalSource(input: string) {
  try {
    return parsePackageSource(input.trim()).source;
  } catch {
    return undefined;
  }
}

export function findPackageOperation(
  input: string,
  operations: Record<string, PackageOpStatus>,
) {
  const source = canonicalSource(input);
  if (!source) return undefined;
  const matches = Object.values(operations).filter(
    (op) => canonicalSource(op.source) === source,
  );
  return matches.find((op) => op.status === "running") ?? matches.at(-1);
}

/** Validate before publishing; only canonical, credential-free sources leave the field.
 * Installation is a storage operation, not a load, selection or config reload. */
export function dispatchPackageOperation(
  action: PackageAction,
  input: string,
  ports: PackageDispatchPorts,
): PackageDispatchResult {
  let parsed: ReturnType<typeof parsePackageSource>;
  try {
    parsed = parsePackageSource(input.trim());
  } catch {
    return { status: "invalid", message: ports.messages.invalid };
  }
  const pending = findPackageOperation(parsed.source, ports.operations());
  if (pending?.status === "running")
    return { status: "running", opId: pending.opId, source: parsed.source };

  const operation = { opId: ports.newOpId(), source: parsed.source, action };
  ports.emit({ ...operation, status: "running" });
  try {
    if (action === "install")
      ports.send.installPackage({ opId: operation.opId, name: parsed.request });
    else if (action === "uninstall")
      ports.send.uninstallPackage({
        opId: operation.opId,
        source: parsed.request,
      });
    else
      ports.send.updatePackage({
        opId: operation.opId,
        source: parsed.request,
      });
  } catch {
    // Bridge errors can include the input or credentials; never stringify them.
    const message = ports.messages.transport;
    ports.emit({ ...operation, status: "error", message });
    return {
      status: "error",
      opId: operation.opId,
      source: parsed.source,
      message,
    };
  }
  return { status: "started", opId: operation.opId, source: parsed.source };
}

/** Protect confirmation keys; the source field has no submit form or Enter action. */
export function guardPackageInstallKey(event: {
  nativeEvent: Pick<KeyboardEvent, "isComposing" | "keyCode" | "repeat">;
  preventDefault: () => void;
}) {
  const key = event.nativeEvent;
  if (key.isComposing || key.keyCode === 229 || key.repeat)
    event.preventDefault();
}
