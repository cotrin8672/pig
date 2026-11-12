import { join } from "node:path";
import type { Provider } from "@earendil-works/pi-ai";
import {
  builtinProviders,
  getBuiltinModelDataGeneratedAt,
} from "@earendil-works/pi-ai/providers/all";
import { personalizeOpenRouterCatalog } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelRuntime as SDKModelRuntime } from "@earendil-works/pi-coding-agent";
import type { SessionAccounts } from "../shared/provider-accounts";
import { withCodexImages } from "./codex-images";
import { desktopConfigDir } from "./desktop-config";
import { composeProviders } from "./model-composition";
import { readModelConfig } from "./model-settings";
import { FileModelsStore } from "./models-store";
import { AccountCredentials, providerAccounts } from "./provider-accounts";
import { withPersonalizedCatalog, withRemoteCatalog } from "./remote-catalog";
import { AuthStorage, ModelRuntime } from "./sdk";

const defaultCredentials = AuthStorage.create();
const owned = new Set<SDKModelRuntime>();
const accountCredentials = new WeakMap<SDKModelRuntime, AccountCredentials>();
export function runtimeAccounts(runtime: SDKModelRuntime) {
  const credentials = accountCredentials.get(runtime);
  if (!credentials) throw new Error("ModelRuntime is not app-owned");
  return credentials;
}
const bases = new WeakMap<SDKModelRuntime, Provider[]>();
const applied = new WeakMap<SDKModelRuntime, Map<string, Provider>>();
const virtuals = new WeakMap<
  SDKModelRuntime,
  Map<string, { provider: string; id: string }>
>();
export const modelRuntimeErrors: string[] = [];
const modelsStore = new FileModelsStore(
  join(desktopConfigDir, "model-catalogs"),
  true,
);

/** Distinct runtime per catalog/session; shared persistence, never shared registrations. */
export async function createModelRuntime(accounts: SessionAccounts = {}) {
  const credentials = new AccountCredentials(
    defaultCredentials,
    providerAccounts,
    accounts,
  );
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    modelsStore,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  accountCredentials.set(runtime, credentials);
  const generatedAt = getBuiltinModelDataGeneratedAt();
  const base = builtinProviders().map((builtin) => {
    const provider = withCodexImages(builtin);
    if (provider.id === "radius") return provider;
    return provider.id === "openrouter"
      ? withPersonalizedCatalog(
          provider,
          personalizeOpenRouterCatalog,
          undefined,
          generatedAt,
        )
      : withRemoteCatalog(provider, undefined, generatedAt);
  });
  const openai = base.find((p) => p.id === "openai");
  if (openai) {
    base.push({
      ...openai,
      id: "openai-api",
      name: "OpenAI API",
      auth: { apiKey: openai.auth.apiKey },
      getModels: () =>
        openai
          .getModels()
          .map((model) => ({ ...model, provider: "openai-api" })),
      getAllModels: () =>
        (openai.getAllModels?.() ?? openai.getModels()).map((model) => ({
          ...model,
          provider: "openai-api",
        })),
    });
    base[base.indexOf(openai)] = {
      ...openai,
      auth: { oauth: openai.auth.oauth },
    };
  }
  bases.set(runtime, base);
  applied.set(runtime, new Map());
  const registeredVirtuals = new Map<
    string,
    { provider: string; id: string }
  >();
  virtuals.set(runtime, registeredVirtuals);
  const registerVirtual = runtime.registerVirtualModel.bind(runtime);
  runtime.registerVirtualModel = (definition) => {
    registerVirtual(definition);
    registeredVirtuals.set(
      JSON.stringify([definition.provider, definition.id]),
      definition,
    );
  };
  await applyRuntimeModelSettings(runtime);
  await runtime.refresh({ allowNetwork: false });
  owned.add(runtime);
  return runtime;
}

export async function applyRuntimeModelSettings(
  runtime: SDKModelRuntime,
  selected?: readonly string[],
) {
  const base = bases.get(runtime);
  if (!base) throw new Error("ModelRuntime is not app-owned");
  let providers: Provider[];
  try {
    providers = composeProviders(base, await readModelConfig());
  } catch (error) {
    modelRuntimeErrors.push(`Cannot load models.json: ${String(error)}`);
    providers = base;
  }
  const ids = selected && new Set(selected);
  const previous = applied.get(runtime);
  if (!previous) throw new Error("ModelRuntime is not app-owned");
  for (const [id, provider] of previous) {
    if (ids && !ids.has(id)) continue;
    if (
      !providers.some((p) => p.id === id) &&
      runtime.getRegisteredNativeProvider(id) === provider
    ) {
      runtime.unregisterProvider(id);
      previous.delete(id);
    }
  }
  for (const provider of providers) {
    if (ids && !ids.has(provider.id)) continue;
    const existing = runtime.getRegisteredNativeProvider(provider.id);
    if (
      (existing && existing !== previous.get(provider.id)) ||
      runtime.getRegisteredProviderConfig(provider.id)
    )
      continue;
    runtime.registerNativeProvider(provider);
    previous.set(provider.id, provider);
  }
}
export function isExtensionProvider(
  runtime: SDKModelRuntime,
  id: string,
): boolean {
  const native = runtime.getRegisteredNativeProvider(id);
  return (
    !!runtime.getRegisteredProviderConfig(id) ||
    (!!native && native !== applied.get(runtime)?.get(id)) ||
    [...(virtuals.get(runtime)?.values() ?? [])].some(
      (definition) => definition.provider === id,
    )
  );
}
/** Called by ResourceLoader.reload after old runner shutdown, before new factories. */
export async function resetExtensionProviders(runtime: SDKModelRuntime) {
  for (const id of runtime.getRegisteredProviderIds())
    runtime.unregisterProvider(id);
  for (const definition of virtuals.get(runtime)?.values() ?? [])
    runtime.unregisterVirtualModel(definition.provider, definition.id);
  virtuals.get(runtime)?.clear();
  applied.get(runtime)?.clear();
  await applyRuntimeModelSettings(runtime);
}
export function releaseModelRuntime(runtime: SDKModelRuntime) {
  owned.delete(runtime);
}
export async function refreshAllModelRuntimes(
  options?: Parameters<SDKModelRuntime["refresh"]>[0],
) {
  return Promise.all(
    [...owned].map(async (runtime) => {
      await applyRuntimeModelSettings(runtime, options?.providers);
      return runtime.refresh({
        ...options,
        allowNetwork: options?.allowNetwork ?? false,
      });
    }),
  );
}
