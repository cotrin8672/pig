import { join } from "node:path";
import type {
  CredentialStore,
  Models,
  ModelsRefreshOptions,
  MutableModels,
  Provider,
} from "@earendil-works/pi-ai";
import {
  builtinModels,
  getBuiltinModelDataGeneratedAt,
} from "@earendil-works/pi-ai/providers/all";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { personalizeOpenRouterCatalog } from "@earendil-works/pi-ai/providers/openrouter";
import { withCodexImages } from "./codex-images";
import { desktopConfigDir } from "./desktop-config";
import { composeProviders } from "./model-composition";
import { readModelConfig } from "./model-settings";
import { FileModelsStore } from "./models-store";
import { withPersonalizedCatalog, withRemoteCatalog } from "./remote-catalog";

export const appAuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};
type RuntimeProviders = {
  base: readonly Provider[];
  modelsPath: string;
  app: Map<string, Provider>;
  config: Map<string, Provider>;
};
const owned = new Set<MutableModels>();
const registrations = new WeakMap<Models, RuntimeProviders>();
export const modelRuntimeErrors: string[] = [];

/** Fresh native collection/providers per catalog or workspace; only persistence is shared. */
export async function createModelRuntime(
  credentials: CredentialStore,
  directory = desktopConfigDir,
): Promise<MutableModels> {
  const runtime = builtinModels({
    credentials,
    modelsStore: new FileModelsStore(join(directory, "model-catalogs")),
    authContext: appAuthContext,
  });
  const generatedAt = getBuiltinModelDataGeneratedAt();
  const base = runtime.getProviders().map((builtin) => {
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
    // Separate factory and remote state: API credentials/catalogs never alias the subscription.
    const api = withRemoteCatalog(openaiProvider(), undefined, generatedAt);
    base.push({
      ...api,
      id: "openai-api",
      name: "OpenAI API",
      auth: { apiKey: api.auth.apiKey },
      getModels: () =>
        api.getModels().map((model) => ({ ...model, provider: "openai-api" })),
      getAllModels: () =>
        (api.getAllModels?.() ?? api.getModels()).map((model) => ({
          ...model,
          provider: "openai-api",
        })),
      refreshModels: async (context) =>
        api.refreshModels?.({
          ...context,
          stored: context.stored && {
            ...context.stored,
            models: context.stored.models
              .filter((model) => model.provider === "openai-api")
              .map((model) => ({ ...model, provider: "openai" })),
          },
          publish: (publication) =>
            context.publish({
              ...publication,
              persist: publication.persist && {
                ...publication.persist,
                models: publication.persist.models.map((model) => ({
                  ...model,
                  provider: "openai-api",
                })),
              },
            }),
        }),
    });
    base[base.indexOf(openai)] = {
      ...openai,
      auth: { oauth: openai.auth.oauth },
    };
  }
  for (const provider of base) runtime.setProvider(provider);
  registrations.set(runtime, {
    base,
    modelsPath: join(directory, "models.json"),
    app: new Map(base.map((provider) => [provider.id, provider])),
    config: new Map(),
  });
  await applyRuntimeModelSettings(runtime);
  await runtime.refresh({ allowNetwork: false });
  owned.add(runtime);
  return runtime;
}

export async function applyRuntimeModelSettings(
  runtime: MutableModels,
  selected?: readonly string[],
) {
  const state = registrations.get(runtime);
  if (!state) throw new Error("Models collection is not app-owned");
  let providers: readonly Provider[];
  try {
    providers = composeProviders(
      state.base,
      await readModelConfig(state.modelsPath),
    );
  } catch (error) {
    modelRuntimeErrors.push(`Cannot load models.json: ${String(error)}`);
    providers = state.base;
  }
  const ids = selected && new Set(selected);
  for (const [id, provider] of state.app) {
    if (ids && !ids.has(id)) continue;
    if (!providers.some((p) => p.id === id)) {
      if (runtime.getProvider(id) === provider) runtime.deleteProvider(id);
      state.app.delete(id);
    }
  }
  for (const provider of providers) {
    if (ids && !ids.has(provider.id)) continue;
    const existing = runtime.getProvider(provider.id);
    if (
      !state.config.has(provider.id) &&
      (!existing || existing === state.app.get(provider.id))
    )
      runtime.setProvider(provider);
    state.app.set(provider.id, provider);
  }
}

/** Replace one collection's explicit config providers. Supply fresh instances per collection. */
export function setRuntimeProviders(
  runtime: MutableModels,
  providers: readonly Provider[],
): void {
  const state = registrations.get(runtime);
  if (!state) throw new Error("Models collection is not app-owned");
  const next = new Map<string, Provider>();
  for (const provider of providers) {
    if (next.has(provider.id))
      throw new Error(`Duplicate provider: ${provider.id}`);
    next.set(provider.id, provider);
  }
  for (const [id, provider] of state.config) {
    if (next.has(id) || runtime.getProvider(id) !== provider) continue;
    const app = state.app.get(id);
    if (app) runtime.setProvider(app);
    else runtime.deleteProvider(id);
  }
  for (const provider of next.values()) {
    if (runtime.getProvider(provider.id) !== provider)
      runtime.setProvider(provider);
  }
  state.config = next;
}

export function isExtensionProvider(runtime: Models, id: string): boolean {
  const provider = runtime.getProvider(id);
  const state = registrations.get(runtime);
  return (
    !!provider &&
    (state?.config.get(id) === provider || provider !== state?.app.get(id))
  );
}
export function releaseModelRuntime(runtime: MutableModels) {
  owned.delete(runtime);
}
export async function refreshAllModelRuntimes(options?: ModelsRefreshOptions) {
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
