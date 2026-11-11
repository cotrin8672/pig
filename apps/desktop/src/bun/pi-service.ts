import "./runtime-profile";
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
import type { TerminalHostEvent } from "../shared/terminal-ui";
import { manualModelRefresh } from "./manual-model-refresh";
import {
  applyRuntimeModelSettings,
  createModelRuntime,
  isExtensionProvider,
  modelRuntimeErrors,
  refreshAllModelRuntimes,
} from "./model-runtime";
import { defaultEffort, loadEfforts } from "./model-settings";
import { REMOTE_CATALOG_REFRESH_INTERVAL_MS } from "./remote-catalog";
import { loadExclusive, SessionHost } from "./session-host";
import { reloadUserCatalog } from "./user-catalog";

registerBunOAuthFlows();
export const runtime = await createModelRuntime();
export const modelErrors = modelRuntimeErrors;
export async function refreshUserCatalog() {
  const services = await loadExclusive(() => reloadUserCatalog(runtime));
  const extensions = services.resourceLoader.getExtensions();
  for (const error of extensions.errors)
    modelErrors.push(`${error.path}: ${error.error}`);
  for (const warning of extensions.warnings ?? [])
    modelErrors.push(`${warning.path}: ${warning.warning}`);
  return services.diagnostics.map((diagnostic) => diagnostic.message);
}
await refreshUserCatalog()
  .then((diagnostics) => modelErrors.push(...diagnostics))
  .catch((error) => modelErrors.push(`User extensions: ${String(error)}`));
export async function refreshModels(
  options?: Parameters<typeof runtime.refresh>[0],
) {
  const results = await refreshAllModelRuntimes({
    ...options,
    allowNetwork: options?.allowNetwork ?? modelNetworkEnabled,
  });
  const result = results[0];
  for (const [provider, error] of result?.errors ?? []) {
    const message = `Model catalog ${provider}: ${error.message}`;
    modelErrors.push(message);
    console.error(message);
  }
  return result;
}
await loadEfforts();
export const modelNetworkEnabled = process.env.PI_OFFLINE === undefined;
export function refreshProviderModels(provider: string) {
  return manualModelRefresh(provider, {
    hasProvider: (id) => !!runtime.getProvider(id),
    online: modelNetworkEnabled,
    refresh: refreshAllModelRuntimes,
  });
}
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
    classificationModels: (await runtime.getAvailableOfType("classifier")).map(
      project,
    ),
    classificationProviders: [
      ...new Set(runtime.getModelsOfType("classifier").map((m) => m.provider)),
    ],
  };
}
// pi-ai labels the subscription Codex provider "legacy"; name both by what they sign in to.
const providerNames: Record<string, string> = {
  "openai-codex": "OpenAI Codex",
  openai: "OpenAI ChatGPT",
  "openai-api": "OpenAI API",
};
export async function listProviders(): Promise<ProviderInfo[]> {
  const stored = new Set(
    (await runtime.listCredentials()).map((item) => item.providerId),
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
  terminal: (event: TerminalHostEvent) => void;
};
let sinks: EventSinks | undefined;
function transport() {
  if (!sinks) throw new Error("Session host event transport is not configured");
  return sinks;
}
let disabled: readonly string[] = [];
export function configureSessionHost(
  events: EventSinks,
  hidden: readonly string[] = [],
) {
  sinks = events;
  disabled = hidden;
}
export function setDisabledModels(hidden: readonly string[]) {
  disabled = hidden;
}
export const sessionHost = new SessionHost({
  modelInfo,
  emit: (event) => transport().runtime(event),
  emitUI: (event) => transport().ui(event),
  emitTerminal: (event) => transport().terminal(event),
  disabled: () => disabled,
});
export const openSession = (input: OpenSessionParams) =>
  sessionHost.openSession(input);
export const listSessions = (cwd: string) => sessionHost.listSessions(cwd);
export const promptSession = (input: PromptParams) => sessionHost.prompt(input);
export const abortSession = (address: SessionAddress) =>
  sessionHost.abort(address);
export const closeSession = (address: SessionAddress) =>
  sessionHost.closeSession(address);
export const setSessionModel = (
  input: SessionAddress & { provider: string; id: string },
) => sessionHost.setModel(input);
export const setSessionEffort = (input: SessionAddress & { effort: Effort }) =>
  sessionHost.setEffort(input);
export const forkSession = (input: SessionAddress & { entryId: string }) =>
  sessionHost.forkSession(input);
export const rewindSession = (input: SessionAddress & { entryId: string }) =>
  sessionHost.rewindSession(input);
export const renameSession = (info: SessionInfo, name: string) =>
  sessionHost.renameSession(info, name);
export const deleteSession = (info: SessionInfo) =>
  sessionHost.deleteSession(info);
export const modelSelection = async (id: string) =>
  sessionHost.getSessionSnapshot(sessionHost.sessionAddress(id));
export const contextUsage = async (id: string) =>
  (await modelSelection(id)).contextUsage;
export const sessionCwd = async (id: string) =>
  (await modelSelection(id)).info.cwd;
export async function disposeSessions() {
  clearInterval(catalogRefreshTimer);
  await sessionHost.dispose();
}
