import { dirname, join } from "node:path";
import type { MutableModels, Provider } from "@earendil-works/pi-ai";
import type {
  ProviderFactory,
  ProviderFactoryContext,
} from "../../../../packages/config/src";
import { type ConfigApplyGate, ConfigLoader } from "./config-loader";
import { validateConfig } from "./config-validation";
import {
  type DurablePackageManager,
  hostModuleNames,
  type PackageSnapshot,
} from "./durable-package-manager";
import { setRuntimeProviders } from "./model-runtime";

// Includes the catalog and every workspace/generation. A factory is trusted code,
// but recycling an instance is still an invalid application ownership contract.
const claimedProviders = new WeakSet<Provider>();
export async function createConfigProviders(
  factories: readonly ProviderFactory[],
  context: ProviderFactoryContext,
): Promise<readonly Provider[]> {
  const providers: Provider[] = [];
  for (const create of factories)
    providers.push(await create(Object.freeze({ ...context })));
  validateConfig({ apiVersion: 2, runtime: { providers } });
  for (const provider of providers) {
    if (claimedProviders.has(provider))
      throw new Error("PROVIDER_INSTANCE_REUSED");
    claimedProviders.add(provider);
  }
  return providers;
}

/** Explicit imports only; acquisition is NEVER part of prepare/reload/recovery. */
export function createApplicationConfigLoader(
  file: string,
  manager: Pick<DurablePackageManager, "root" | "snapshot" | "moduleLocation">,
  catalog: MutableModels,
): ConfigLoader {
  let snapshot: PackageSnapshot | undefined;
  const loader = new ConfigLoader(file, {
    moduleRoot: async () => {
      snapshot = await manager.snapshot();
      return snapshot.generation
        ? join(manager.root, "generations", snapshot.generation)
        : dirname(file);
    },
    resolveModule: async (specifier, from) => {
      const name = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (hostModuleNames.some((core) => core === name))
        return Bun.resolveSync(specifier, import.meta.dir);
      const managed = snapshot?.packages.find((pkg) => pkg.name === name);
      if (managed) {
        const location = await manager.moduleLocation(
          managed.source,
          snapshot?.generation,
        );
        return Bun.resolveSync(specifier, dirname(location.resolveFrom));
      }
      return Bun.resolveSync(specifier, from);
    },
  });
  // Stage fresh catalog providers within the SAME candidate gate. Neither a
  // failed provider factory nor a rejected Host gate changes the catalog.
  return new Proxy(loader, {
    get(target, key) {
      if (key === "reload")
        return (gate?: ConfigApplyGate) =>
          target.reload(async (candidate, accepted) => {
            if (!gate) throw new Error("Native Host config gate required");
            if (candidate.config.runtime?.providers?.length)
              throw new Error(
                "WORKSPACE_PROVIDER_FACTORY_REQUIRED: use runtime.providerFactories",
              );
            const providers = await createConfigProviders(
              candidate.config.runtime?.providerFactories ?? [],
              { scope: "catalog" },
            );
            const decision = await gate(candidate, accepted);
            if (decision.status !== "ready") return decision;
            return {
              ...decision,
              apply() {
                decision.apply?.();
                setRuntimeProviders(catalog, providers);
              },
            };
          });
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
