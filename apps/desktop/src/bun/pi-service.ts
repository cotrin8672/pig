import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  type Api,
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type ImageContent,
  type Model,
} from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  builtinModels,
  getBuiltinModelDataGeneratedAt,
} from "@earendil-works/pi-ai/providers/all";
import { personalizeOpenRouterCatalog } from "@earendil-works/pi-ai/providers/openrouter";
import type {
  ConversationWatch,
  EntryRecord,
  LiveState,
} from "@earendil-works/pi-durable";
import { displayedEffort, effortOptions } from "../shared/effort";
import { isModelEnabled } from "../shared/models";
import type {
  ContextUsage,
  Effort,
  ModelSelection,
  ProviderInfo,
  SessionInfo,
  Snapshot,
  WireEvent,
} from "../shared/rpc-schema";
import { durableTranscript } from "../shared/transcript";
import { withCodexImages } from "./codex-images";
import { projectedContextUsage } from "./context-usage";
import { purgeConversation } from "./conversation-purge";
import { rewindConversation, visibleHistory } from "./conversation-rewind";
import { FileCredentials } from "./credentials";
import { desktopConfigDir } from "./desktop-config";
import { DurableService, durableStorageDir } from "./durable-service";
import { composeProviders } from "./model-composition";
import { defaultEffort, loadEfforts, readModelConfig } from "./model-settings";
import { FileModelsStore } from "./models-store";
import {
  REMOTE_CATALOG_REFRESH_INTERVAL_MS,
  withPersonalizedCatalog,
  withRemoteCatalog,
} from "./remote-catalog";

registerBunOAuthFlows();
export const credentials = new FileCredentials(
  join(desktopConfigDir, "auth.json"),
);
export const runtime = builtinModels({
  credentials,
  modelsStore: new FileModelsStore(join(desktopConfigDir, "model-catalogs")),
  // Only app-saved credentials count; never discover environment keys or
  // AWS/GCP/CLI credential files. Models rejects unauthenticated requests
  // before dispatch, so provider SDKs cannot fall back to ambient credentials.
  authContext: {
    env: async () => undefined,
    fileExists: async () => false,
  },
});
export const modelErrors: string[] = [];
export async function refreshModels(
  options?: Parameters<typeof runtime.refresh>[0],
) {
  await applyModelSettings(options?.providers).catch((error) => {
    const message = `Cannot load models.json: ${String(error)}`;
    modelErrors.push(message);
    console.error(message);
  });
  const result = await runtime.refresh({
    ...options,
    allowNetwork: options?.allowNetwork ?? modelNetworkEnabled,
  });
  for (const [provider, error] of result.errors) {
    const message = `Model catalog ${provider}: ${error.message}`;
    modelErrors.push(message);
    console.error(message);
  }
  return result;
}
await loadEfforts();
export const modelNetworkEnabled = process.env.PI_OFFLINE === undefined;
const generatedAt = getBuiltinModelDataGeneratedAt();
const originalProviders = runtime.getProviders().map((builtin) => {
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
const openai = originalProviders.find((provider) => provider.id === "openai");
if (openai) {
  originalProviders.push({
    ...openai,
    id: "openai-api",
    name: "OpenAI API",
    auth: { apiKey: openai.auth.apiKey },
    getModels: () =>
      openai.getModels().map((model) => ({ ...model, provider: "openai-api" })),
    getAllModels: () =>
      (openai.getAllModels?.() ?? openai.getModels()).map((model) => ({
        ...model,
        provider: "openai-api",
      })),
    // Keep the wrapped OpenAI refresh closure: it fetches the upstream id,
    // using this provider's credential and cache even on selected-only refresh.
    refreshModels: openai.refreshModels,
  });
  originalProviders[originalProviders.indexOf(openai)] = {
    ...openai,
    auth: { oauth: openai.auth.oauth },
  };
}
for (const provider of originalProviders) runtime.setProvider(provider);
const configuredProviders = new Set<string>();
export async function applyModelSettings(selected?: readonly string[]) {
  const providers = composeProviders(
    originalProviders,
    await readModelConfig(),
  );
  const selectedIds = selected && new Set(selected);
  for (const id of configuredProviders) {
    if (selectedIds && !selectedIds.has(id)) continue;
    if (!providers.some((p) => p.id === id)) {
      runtime.deleteProvider(id);
      configuredProviders.delete(id);
    }
  }
  for (const provider of providers) {
    if (selectedIds && !selectedIds.has(provider.id)) continue;
    runtime.setProvider(provider);
    configuredProviders.add(provider.id);
  }
}
await refreshModels({ allowNetwork: false });
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
// Open lazily, after desktop config migration; one Harness owns every project conversation.
let servicePromise: Promise<DurableService> | undefined;
let maintainingStorage = false;
export const durable = () => {
  if (maintainingStorage)
    throw new Error("Chat storage maintenance in progress. Try again.");
  servicePromise ??= DurableService.open(runtime);
  return servicePromise;
};
const attachments = new Map<
  string,
  {
    input: { cwd: string; id: string };
    emit: Parameters<typeof openSession>[1];
    disabled: readonly string[];
  }
>();
const sessions = new Map<
  string,
  {
    info: SessionInfo;
    watch: ConversationWatch;
    entries: Map<number, EntryRecord>;
    live: LiveState;
  }
>();
type PendingOpen = {
  promise?: Promise<Snapshot>;
  cancelled: boolean;
  watch?: ConversationWatch;
  stopping?: ReturnType<ConversationWatch["stop"]>;
};
const pendingOpens = new Map<string, PendingOpen>();
function stopPending(open: PendingOpen) {
  if (open.watch) open.stopping ??= open.watch.stop();
  return open.stopping;
}

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
        extension: false,
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
export async function modelSelection(id: string): Promise<ModelSelection> {
  const agent = await (await (await durable()).conversation(id)).agent(context);
  const model =
    agent.model && runtime.getModel(agent.model.provider, agent.model.modelId);
  const info = model && modelInfo(model);
  return {
    model: info,
    effort: displayedEffort(
      agent.thinkingLevel,
      info?.effortLevels ?? [],
      model?.thinkingLevelMap,
    ),
    effortLevels: info?.effortLevels ?? [],
    contextUsage: await contextUsage(id, model?.contextWindow ?? 0),
  };
}
export async function contextUsage(id: string, window?: number) {
  const conversation = await (await durable()).conversation(id);
  const agent = await conversation.agent(context);
  const size =
    window ??
    (agent.model &&
      runtime.getModel(agent.model.provider, agent.model.modelId)
        ?.contextWindow) ??
    0;
  return projectedContextUsage(await conversation.context(context), size);
}
function updateSessionInfo(
  managed: { info: SessionInfo; entries: Map<number, EntryRecord> },
  changed = false,
) {
  const entries = [...managed.entries.values()].sort((a, b) => a.id - b.id);
  const messages = entries.flatMap((e) => e.model ?? []);
  const raw = [...entries].reverse().find((e) => e.kind === "pig.name")?.data;
  // Renames are stored as { name, timestamp }; older entries hold the bare string.
  const name = raw && typeof raw === "object" && "name" in raw ? raw.name : raw;
  const first = messages.find((m) => m.role === "user");
  const title =
    typeof name === "string"
      ? name
      : first
        ? typeof first.content === "string"
          ? first.content
          : first.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join(" ")
        : managed.info.title;
  managed.info = {
    ...managed.info,
    title,
    modified: Math.max(
      managed.info.modified,
      messages.at(-1)?.timestamp ?? 0,
      changed ? Date.now() : 0,
    ),
  };
}
function failureState(live: LiveState) {
  const failure = live.runFailure;
  return {
    failure:
      failure && failure.reason !== "aborted"
        ? (failure.detail ?? live.compactionFailure?.error ?? failure.reason)
        : live.compactionFailure?.error,
    aborted: failure?.reason === "aborted",
  };
}
export async function sessionCwd(id: string) {
  return (
    (await (await (await durable()).conversation(id)).agent(context)).cwd ?? ""
  );
}
export async function listSessions(cwd: string): Promise<SessionInfo[]> {
  return (await durable()).list(cwd);
}
export function openSession(
  input: { cwd: string; id?: string },
  emit: (id: string, event: WireEvent, usage?: ContextUsage | null) => void,
  disabled: readonly string[] = [],
): Promise<Snapshot> {
  const id = input.id;
  if (!id) return loadSession(input, emit, disabled);
  const existing = pendingOpens.get(id);
  if (existing?.promise)
    return existing.promise.then((snapshot) => {
      if (snapshot.info.cwd !== input.cwd)
        throw new Error("Session does not belong to this project.");
      return snapshot;
    });
  const open: PendingOpen = { cancelled: false };
  pendingOpens.set(id, open);
  open.promise = loadSession(input, emit, disabled, open)
    .then((snapshot) => {
      if (open.cancelled) throw new Error("Chat closed.");
      return snapshot;
    })
    .catch(async (error) => {
      if (open.watch && sessions.get(id)?.watch === open.watch)
        sessions.delete(id);
      await stopPending(open);
      throw error;
    })
    .finally(() => {
      if (pendingOpens.get(id) === open) pendingOpens.delete(id);
    });
  return open.promise;
}
async function loadSession(
  input: { cwd: string; id?: string },
  emit: (id: string, event: WireEvent, usage?: ContextUsage | null) => void,
  disabled: readonly string[] = [],
  opening?: PendingOpen,
): Promise<Snapshot> {
  const service = await durable();
  let id = input.id;
  if (!id) {
    const model = (await availableModels()).find((candidate) =>
      isModelEnabled(candidate, disabled),
    );
    id = String(
      (
        await service.create(
          input.cwd,
          model && { provider: model.provider, modelId: model.id },
        )
      ).id,
    );
    if (model)
      await service.configure(id, {
        thinkingLevel: defaultEffort(model.provider, model.id) ?? "medium",
      });
    return openSession({ ...input, id }, emit, disabled);
  }
  if ((await sessionCwd(id)) !== input.cwd)
    throw new Error("Session does not belong to this project.");
  if (opening?.cancelled) throw new Error("Chat closed.");
  if (!sessions.has(id)) {
    if (!opening) throw new Error("Missing pending open.");
    try {
      const info = (await service.list(input.cwd)).find(
        (item) => item.id === id,
      );
      if (!info) throw new Error("Chat not found.");
      if (opening.cancelled) throw new Error("Chat closed.");
      const watch = await service.watch(id);
      opening.watch = watch;
      if (opening.cancelled) throw new Error("Chat closed.");
      const managed = {
        info,
        watch,
        entries: new Map<number, EntryRecord>(),
        live: (watch.value.docs["pi.live"] ?? {}) as LiveState,
      };
      for (const entry of watch.value.entries)
        managed.entries.set(Number(entry.id), entry);
      const sessionId = id;
      watch.start(async (call) => {
        if (call.kind !== "value") return;
        let changed = false;
        for (const entry of call.value.entries) {
          if (!managed.entries.has(Number(entry.id))) changed = true;
          managed.entries.set(Number(entry.id), entry);
        }
        updateSessionInfo(managed, changed);
        managed.live = (call.value.docs["pi.live"] ?? {}) as LiveState;
        emit(
          sessionId,
          {
            type: "snapshot",
            transcript: durableTranscript(
              visibleHistory(
                [...managed.entries.values()].sort((a, b) => a.id - b.id),
              ),
              managed.live,
            ),
            ...failureState(managed.live),
          },
          await contextUsage(sessionId).catch((error) => {
            console.error("Context usage:", error);
            return null;
          }),
        );
      });
      const history = await service.history(id);
      for (const entry of history)
        if (!managed.entries.has(Number(entry.id)))
          managed.entries.set(Number(entry.id), entry);
      updateSessionInfo(managed);
      if (opening.cancelled) throw new Error("Chat closed.");
      sessions.set(id, managed);
      attachments.set(id, { input: { cwd: input.cwd, id }, emit, disabled });
    } catch (error) {
      await stopPending(opening);
      throw error;
    }
  }
  const managed = sessions.get(id);
  if (!managed) throw new Error("Chat closed.");
  return {
    info: managed.info,
    transcript: durableTranscript(
      visibleHistory([...managed.entries.values()].sort((a, b) => a.id - b.id)),
      managed.live,
    ),
    ...failureState(managed.live),
    ...(await modelSelection(id)),
  };
}
export async function promptSession(
  id: string,
  text: string,
  requestId: string,
  images?: ImageContent[],
) {
  const service = await durable();
  const agent = await (await service.conversation(id)).agent(context);
  const model =
    agent.model &&
    (await availableModels()).find(
      (m) =>
        m.provider === agent.model?.provider && m.id === agent.model.modelId,
    );
  if (!model) throw new Error("Choose an available model first.");
  if (images?.length && !model.input.includes("image"))
    throw new Error("The current model does not accept images.");
  const submission = await service.submit(id, text, requestId, images);
  const status = await submission.status(context);
  return {
    disposition:
      status.status === "queued" ? ("queued" as const) : ("started" as const),
  };
}
export async function abortSession(id: string) {
  await (await durable()).abort(id);
}
export async function closeSession(id: string) {
  const opening = pendingOpens.get(id);
  if (opening) {
    opening.cancelled = true;
    pendingOpens.delete(id);
  }
  if (opening || sessions.has(id)) await abortSession(id); // Abort before detaching completion tracking.
  const live = sessions.get(id);
  sessions.delete(id);
  attachments.delete(id);
  await Promise.all([
    opening && stopPending(opening),
    live && live.watch !== opening?.watch ? live.watch.stop() : undefined,
  ]);
}
export async function disposeSessions() {
  clearInterval(catalogRefreshTimer);
  await Promise.all(
    [...new Set([...sessions.keys(), ...pendingOpens.keys()])].map(
      closeSession,
    ),
  );
  if (servicePromise) await (await servicePromise).close();
}
export async function renameSession(info: SessionInfo, name: string) {
  await (await durable()).rename(info.id, name);
  const next = { ...info, title: name.trim(), modified: Date.now() };
  const live = sessions.get(info.id);
  if (live) live.info = next;
  return next;
}
export async function deleteSession(info: SessionInfo) {
  const service = await durable();
  if (maintainingStorage || pendingOpens.size)
    throw new Error("Wait for chats to finish opening, then try again.");
  maintainingStorage = true;
  const reconnect = [...attachments.values()];
  let closed = false;
  let deleted = false;
  try {
    // This store is shared: never rewrite it while ANY run/background task is live.
    const inspection = await service.harness.inspect(context);
    if (inspection.tasks.length || inspection.submissions.length)
      throw new Error("Stop active chats before deleting a chat.");
    // Keep the global ID high-water mark even when the newest chat is purged.
    await (await service.harness.root(context)).submit(
      { type: "write", entry: { kind: "pig.storage-watermark" } },
      context,
    );
    await Promise.all(
      [...sessions.values()].map((session) => session.watch.stop()),
    );
    sessions.clear();
    attachments.clear();
    await service.close();
    closed = true;
    await purgeConversation(durableStorageDir, Number(info.id));
    deleted = true;
  } finally {
    if (closed) servicePromise = DurableService.open(runtime);
    maintainingStorage = false;
    if (closed) {
      await servicePromise;
      for (const attachment of reconnect) {
        if (deleted && attachment.input.id === info.id) continue;
        await openSession(
          attachment.input,
          attachment.emit,
          attachment.disabled,
        );
      }
    }
  }
}
export async function setSessionModel(
  id: string,
  provider: string,
  modelId: string,
) {
  await (await durable()).configure(id, {
    model: { provider, modelId },
    thinkingLevel: defaultEffort(provider, modelId) ?? "medium",
  });
  return modelSelection(id);
}
export async function setSessionEffort(id: string, effort: Effort) {
  if (!(await modelSelection(id)).effortLevels.includes(effort))
    throw new Error("Unsupported reasoning effort.");
  await (await durable()).configure(id, { thinkingLevel: effort });
  return modelSelection(id);
}
export async function forkSession(id: string, timestamp: number) {
  const service = await durable();
  const entry = (await service.history(id)).find((e) =>
    e.model?.some((m) => m.role === "assistant" && m.timestamp === timestamp),
  );
  if (!entry) throw new Error("Message not found.");
  const fork = await service.fork(id, entry.id);
  return { cwd: await sessionCwd(id), id: String(fork.id) };
}
/** Replace the active context in this conversation; immutable history remains fork-safe. */
export async function rewindSession(id: string, timestamp: number) {
  const service = await durable();
  await rewindConversation(
    await service.conversation(id),
    await service.history(id),
    timestamp,
  );
  // Refresh the cache before RPC returns, rather than waiting for a watch delivery.
  const managed = sessions.get(id);
  if (managed) {
    for (const entry of await service.history(id))
      managed.entries.set(Number(entry.id), entry);
    managed.live = (managed.watch.value.docs["pi.live"] ?? {}) as LiveState;
  }
  return { cwd: await sessionCwd(id), id };
}
