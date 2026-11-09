import type { PackageEvent, PackageService } from "../shared/packages";

export function createPackageAdapter(
  agentDir: string,
  transport: Pick<PackageService, "search" | "listInstalled" | "operate">,
) {
  const listeners = new Set<(event: PackageEvent) => void>();
  const service: PackageService = {
    agentDir,
    search: (input) => transport.search(input),
    listInstalled: () => transport.listInstalled(),
    operate: (input) => transport.operate(input),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    service,
    receive(event: PackageEvent) {
      const profile =
        event.type === "operation"
          ? event.operation.agentDir
          : event.type === "apply"
            ? event.change.agentDir
            : event.agentDir;
      if (profile === agentDir)
        for (const listener of listeners) listener(event);
    },
  };
}
