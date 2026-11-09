import { join } from "node:path";
import {
  type Api,
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Model,
} from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { displayedEffort, effortOptions } from "../shared/effort";
import type { ExtensionUIEvent } from "../shared/extension-ui";
import type { Effort, ProviderInfo, SessionInfo } from "../shared/rpc-schema";
import type {
  OpenSessionParams,
  PromptParams,
  RuntimeEvent,
  SessionAddress,
} from "../shared/runtime-contract";
import { createApplicationConfigLoader } from "./application-config";
import { createApplicationRuntime } from "./application-runtime";
import { FileCredentials } from "./credentials";
import { desktopConfigDir } from "./desktop-config";
import { getPackageManager } from "./durable-package-manager";
import {
  applyRuntimeModelSettings,
  createModelRuntime,
  isExtensionProvider,
  modelRuntimeErrors,
  refreshAllModelRuntimes,
  releaseModelRuntime,
} from "./model-runtime";
import { defaultEffort, loadEfforts } from "./model-settings";
import { REMOTE_CATALOG_REFRESH_INTERVAL_MS } from "./remote-catalog";
import { currentSettings } from "./settings";

registerBunOAuthFlows();
export const credentials = new FileCredentials(
  join(desktopConfigDir, "auth.json"),
);
// The UI catalog is not a conversation runtime. Each Workspace owns another fresh
// Models collection, registry, Harness, writer lock and SQLite storage.
export const runtime = await createModelRuntime(credentials);
export const modelErrors = modelRuntimeErrors;
export const modelNetworkEnabled = process.env.PI_OFFLINE === undefined;
export async function refreshModels(
  options?: Parameters<typeof runtime.refresh>[0],
) {
  const results = await refreshAllModelRuntimes({
    ...options,
    allowNetwork: options?.allowNetwork ?? modelNetworkEnabled,
  });
  for (const result of results) {
    for (const [provider, error] of result.errors) {
      const message = `Model catalog ${provider}: ${error.message}`;
      modelErrors.push(message);
      console.error(message);
    }
  }
  return results[0];
}
await loadEfforts();
export async function applyModelSettings(selected?: readonly string[]) {
  await applyRuntimeModelSettings(runtime, selected);
  await refreshAllModelRuntimes({ providers: selected, allowNetwork: false });
}
function refreshInBackground() {
  if (modelNetworkEnabled)
    void refreshModels().catch((error) =>
      console.error("Model catalog refresh:", error),
    );
}
refreshInBackground();
const catalogRefreshTimer = setInterval(
  refreshInBackground,
  REMOTE_CATALOG_REFRESH_INTERVAL_MS,
);
catalogRefreshTimer.unref();

export const availableModels = () => runtime.getAvailable();
export async function utilityModels() {
  const project = ({
    provider,
    id,
    name,
  }: {
    provider: string;
    id: string;
    name: string;
  }) => ({ provider, id, name });
  return {
    imageModels: (await runtime.getAvailableOfType("image")).map(project),
    decisionModels: (await runtime.getAvailableOfType("classifier")).map(
      project,
    ),
    decisionProviders: [
      ...new Set(runtime.getModelsOfType("classifier").map((m) => m.provider)),
    ],
  };
}
const providerNames: Record<string, string> = {
  "openai-codex": "OpenAI Codex",
  openai: "OpenAI ChatGPT",
  "openai-api": "OpenAI API",
};
export async function listProviders(): Promise<ProviderInfo[]> {
  const stored = new Set(
    (await credentials.list()).map((item) => item.providerId),
  );
  return Promise.all(
    runtime.getProviders().map(async (p) => {
      const auth = await runtime.checkAuth(p.id);
      return {
        id: p.id,
        name: providerNames[p.id] ?? p.name,
        oauth: p.auth.oauth && {
          label: p.auth.oauth.loginLabel,
          subscription: !!p.auth.oauth.isSubscription,
        },
        apiKey: !!p.auth.apiKey?.login,
        configured: !!auth,
        source: auth?.source,
        stored: stored.has(p.id),
        extension: isExtensionProvider(runtime, p.id),
      };
    }),
  );
}
export function modelInfo(model: Model<Api>) {
  const thinkingLevels = getSupportedThinkingLevels(model) as Effort[];
  const effortLevels = model.reasoning
    ? effortOptions(thinkingLevels, model.thinkingLevelMap)
    : [];
  const preferred = defaultEffort(model.provider, model.id);
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
    vision: model.input.includes("image"),
    maxTokens: model.maxTokens,
    adaptiveThinking:
      model.api === "anthropic-messages"
        ? (model.compat as { forceAdaptiveThinking?: boolean } | undefined)
            ?.forceAdaptiveThinking
        : undefined,
    thinkingLevels,
    effortLevels,
    defaultEffort: preferred,
    effectiveDefaultEffort: displayedEffort(
      clampThinkingLevel(model, preferred ?? "medium"),
      effortLevels,
      model.thinkingLevelMap,
    ),
  };
}
type EventSinks = {
  runtime: (event: RuntimeEvent) => void;
  ui: (event: ExtensionUIEvent) => void;
};
let sinks: EventSinks | undefined;
function transport() {
  if (!sinks) throw new Error("Application event transport is not configured");
  return sinks;
}
let disabled: readonly string[] = [];
export function configureApplication(
  events: EventSinks,
  hidden: readonly string[] = [],
) {
  sinks = events;
  disabled = hidden;
}
export function setDisabledModels(hidden: readonly string[]) {
  disabled = hidden;
}
const packages = getPackageManager();
export const configLoader = createApplicationConfigLoader(
  join(desktopConfigDir, "config.ts"),
  packages,
  runtime,
);
export const application = createApplicationRuntime({
  dataRoot: desktopConfigDir,
  modelDirectory: desktopConfigDir,
  credentials,
  configLoader,
  settings: currentSettings,
  modelInfo,
  defaultEffort: (model) => defaultEffort(model.provider, model.id),
  research: { inheritParent: true },
  emit: (event) => transport().runtime(event),
  emitUI: (event) => transport().ui(event),
  disabled: () => disabled,
  onFailure: (error) => modelErrors.push(`Native workspace: ${String(error)}`),
});
export const host = application.host;
let initialization: Promise<void> | undefined;
/** Called by the trusted desktop bootstrap AFTER configuration, settings and scopes are ready.
 * Reads only the new agent-v2 namespace. Failed recovery also prevents package replacement. */
export function initializeApplication(
  authorizedWorkspaces: readonly string[],
): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    const result = await application.reload();
    if (result.state !== "applied")
      modelErrors.push(`Native config: ${result.reason ?? result.state}`);
    const opened = await Promise.allSettled(
      [...new Set(authorizedWorkspaces)].map((cwd) => host.workspace(cwd)),
    );
    const failures = opened.flatMap((entry) =>
      entry.status === "rejected" ? [entry.reason] : [],
    );
    if (failures.length)
      throw new AggregateError(
        failures,
        "Native workspace initialization/recovery failed; package replacement is blocked",
      );
  })();
  void initialization.catch(() => {});
  return initialization;
}
packages.setMutationGuard(async () => {
  if (!initialization) throw new Error("AUTHORIZED_WORKSPACES_NOT_INITIALIZED");
  await initialization;
  return host.acquirePackageMutationLease();
});
export const openSession = (input: OpenSessionParams) => host.open(input);
export const listSessions = (cwd: string) => host.list(cwd);
export const promptSession = (input: PromptParams) => host.prompt(input);
export const abortSession = (address: SessionAddress) =>
  application.abort(address);
export const closeSession = (address: SessionAddress) => host.close(address);
export const setSessionModel = (
  input: SessionAddress & { provider: string; id: string },
) => host.setModel(input);
export const setSessionEffort = (input: SessionAddress & { effort: Effort }) =>
  host.setEffort(input);
export const forkSession = (input: SessionAddress & { entryId: string }) =>
  host.fork(input);
export const rewindSession = (input: SessionAddress & { entryId: string }) =>
  host.regenerateFrom(input);
export const renameSession = (info: SessionInfo, name: string) =>
  host.rename(info, name);
export const deleteSession = (info: SessionInfo) => host.delete(info);
export async function disposeSessions() {
  clearInterval(catalogRefreshTimer);
  try {
    await application.dispose();
  } finally {
    releaseModelRuntime(runtime);
  }
}
