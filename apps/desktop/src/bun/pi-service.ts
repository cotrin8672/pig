import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { displayedEffort, effortOptions } from "../shared/effort";
import { isModelEnabled } from "../shared/models";
import type {
  Effort,
  ModelSelection,
  Notice,
  ProviderInfo,
  SessionInfo,
  Snapshot,
  UtilityModelInfo,
  WireEvent,
} from "../shared/rpc-schema";
import type { TerminalUICommand, TerminalUIEvent } from "../shared/terminal-ui";
import {
  hydrate,
  reduceTranscript,
  type Transcript,
} from "../shared/transcript";
import { ExtensionDialogs, notificationUI } from "./extension-ui";
import { settings } from "./model-settings";
import { PromptQueue, withPackageLock } from "./package-queue";
import {
  assertSessionDeletable,
  listStoredSessions,
  removeStoredSession,
  renameStoredSession,
  sessionName,
} from "./session-files";
import { TerminalUIHost } from "./terminal-ui";

registerBunOAuthFlows();
export const runtime = await ModelRuntime.create();
console.log("[pi] SDK and Bun OAuth flows initialized");
export const extensionDialogs = new ExtensionDialogs();
const terminalHosts = new Map<string, TerminalUIHost>();
export function acceptTerminalUI(command: TerminalUICommand) {
  for (const host of terminalHosts.values()) host.accept(command);
}
function closeTerminalUI(id: string) {
  terminalHosts.get(id)?.dispose();
  terminalHosts.delete(id);
}
const sessions = new Map<
  string,
  {
    session: AgentSession;
    unsubscribe: () => void;
    info: SessionInfo;
    transcript: Transcript;
  }
>();
const opening = new Map<string, Promise<Snapshot>>();
const pendingClose = new Set<string>();
const prompting = new Map<AgentSession, number>();
const promptQueue = new PromptQueue();
const deferredReloads = new Map<AgentSession, (message: string) => void>();
let disposing = false;

export function availableModels() {
  return runtime.getAvailable();
}
export async function utilityModels(): Promise<{
  imageModels: UtilityModelInfo[];
  classificationModels: UtilityModelInfo[];
  classificationProviders: string[];
}> {
  const [images, classifiers] = await Promise.all([
    runtime.getAvailableOfType("image"),
    runtime.getAvailableOfType("classifier"),
  ]);
  const project = ({
    provider,
    id,
    name,
  }: UtilityModelInfo): UtilityModelInfo => ({ provider, id, name });
  return {
    imageModels: images.map(project),
    classificationModels: classifiers.map(project),
    classificationProviders: [
      ...new Set(
        runtime.getModelsOfType("classifier").map((model) => model.provider),
      ),
    ],
  };
}
export async function listProviders(): Promise<ProviderInfo[]> {
  await runtime.getAvailable(); // refreshes the auth snapshot read below
  const extension = new Set(runtime.getRegisteredProviderIds());
  return runtime
    .getProviders()
    .map((p) => {
      const status = runtime.getProviderAuthStatus(p.id);
      return {
        id: p.id,
        name: p.name,
        oauth: p.auth.oauth && {
          label: p.auth.oauth.loginLabel,
          subscription: !!p.auth.oauth.isSubscription,
        },
        apiKey: !!p.auth.apiKey?.login,
        configured: status.configured,
        source: status.label ?? status.source,
        stored: status.source === "stored",
        extension: extension.has(p.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
// User-scope extensions are loaded without a session so their providers can be
// configured before any chat opens; sessions re-register them on the same runtime.
// shortcut: providers registered inside session_start handlers only appear once a chat
// loads them, upgrade if such extensions become common.
let userExtensionProviders = new Set<string>();
export async function loadUserExtensionProviders() {
  const loader = new DefaultResourceLoader({
    // agentDir as cwd: no project .pi exists there, so only user-scope resources load.
    cwd: getAgentDir(),
    agentDir: getAgentDir(),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const { runtime: extensions, errors } = loader.getExtensions();
  for (const { path, error } of errors)
    console.warn(`[pi] Extension ${path} failed to load: ${error}`);
  const next = new Set<string>();
  const register = (id: string, apply: () => void, from: string) => {
    try {
      apply();
      next.add(id);
    } catch (error) {
      console.warn(`[pi] ${from} cannot register provider ${id}:`, error);
    }
  };
  for (const {
    name,
    config,
    extensionPath,
  } of extensions.pendingProviderRegistrations)
    register(name, () => runtime.registerProvider(name, config), extensionPath);
  for (const {
    provider,
    extensionPath,
  } of extensions.pendingNativeProviderRegistrations)
    register(
      provider.id,
      () => runtime.registerNativeProvider(provider),
      extensionPath,
    );
  for (const id of userExtensionProviders)
    if (!next.has(id)) runtime.unregisterProvider(id);
  userExtensionProviders = next;
}
export function modelInfo(model: NonNullable<AgentSession["model"]>) {
  const thinkingLevels = model.reasoning
    ? (getSupportedThinkingLevels(model) as Effort[])
    : undefined;
  const effortLevels = thinkingLevels
    ? effortOptions(thinkingLevels, model.thinkingLevelMap)
    : [];
  const defaultEffort = settings().getModelThinkingLevel(
    model.provider,
    model.id,
  );
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
    vision: model.input.includes("image"),
    maxTokens: model.maxTokens,
    thinkingLevels,
    effortLevels,
    defaultEffort,
    effectiveDefaultEffort: displayedEffort(
      clampThinkingLevel(
        model,
        defaultEffort ?? settings().getDefaultThinkingLevel() ?? "medium",
      ),
      effortLevels,
      model.thinkingLevelMap,
    ),
    adaptiveThinking:
      model.api === "anthropic-messages"
        ? !!(model.compat as { forceAdaptiveThinking?: boolean } | undefined)
            ?.forceAdaptiveThinking
        : undefined,
  };
}
// Re-read pi's models.json/settings.json and hand fresh models to open chats.
export async function applyModelSettings() {
  await runtime.refresh({ allowNetwork: false });
  for (const { session } of sessions.values()) {
    await session.settingsManager.reload();
    const current = session.model;
    const fresh = current && runtime.getModel(current.provider, current.id);
    if (fresh) session.agent.state.model = fresh;
  }
}
export function modelSelection(session: AgentSession): ModelSelection {
  const model = session.model;
  const levels = session.supportsThinking()
    ? effortOptions(
        session.getAvailableThinkingLevels(),
        model?.thinkingLevelMap,
      )
    : [];
  return {
    model: model ? modelInfo(model) : undefined,
    effort: displayedEffort(
      session.thinkingLevel,
      levels,
      model?.thinkingLevelMap,
    ),
    effortLevels: levels,
    contextUsage: session.getContextUsage() ?? null,
  };
}
export async function listSessions(cwd: string): Promise<SessionInfo[]> {
  const found = new Map(
    (await listStoredSessions(cwd)).map((s) => [
      s.id,
      {
        id: s.id,
        cwd: s.cwd,
        path: s.path,
        title: s.name || s.firstMessage || "New chat",
        modified: s.modified.getTime(),
      } as SessionInfo,
    ]),
  );
  for (const [id, live] of sessions)
    if (live.info.cwd === cwd)
      found.set(id, { ...found.get(id), ...live.info });
  return [...found.values()].sort((a, b) => b.modified - a.modified);
}
export function getSession(id: string) {
  const managed = sessions.get(id);
  if (!managed) throw new Error("Session is closed");
  return managed.session;
}
export function openSession(
  input: { cwd: string; path?: string; id?: string },
  emit: (
    sessionId: string,
    event: WireEvent,
    contextUsage?: ModelSelection["contextUsage"],
  ) => void,
  disabledModels: readonly string[] = [],
  warn: (message: string) => void = console.warn,
  notify: (notice: Notice) => void = (notice) => warn(notice.message),
  terminalEmit?: (event: TerminalUIEvent) => void,
): Promise<Snapshot> {
  if (disposing) return Promise.reject(new Error("Application is closing"));
  const live = input.id
    ? sessions.get(input.id)
    : [...sessions.values()].find(
        (s) => input.path && s.session.sessionFile === input.path,
      );
  if (live && live.info.cwd !== input.cwd)
    return Promise.reject(
      new Error("Session does not belong to this project."),
    );
  if (live)
    return Promise.resolve({
      info: live.info,
      transcript: live.transcript,
      pendingDialogs: extensionDialogs.list(live.info.id),
      ...modelSelection(live.session),
    });
  const key = input.path || `new:${input.cwd}`;
  const pending = opening.get(key);
  if (pending) return pending;
  const promise = withPackageLock(async () => {
    if (disposing) throw new Error("Application is closing");
    if (
      input.path &&
      !(await listStoredSessions(input.cwd)).some((s) => s.path === input.path)
    )
      throw new Error("Session does not belong to this project.");
    const sessionManager = input.path
      ? SessionManager.open(input.path)
      : SessionManager.create(input.cwd);
    const cwd = sessionManager.getCwd();
    const model = input.path
      ? undefined
      : (await availableModels()).find((candidate) =>
          isModelEnabled(candidate, disabledModels),
        );
    const pendingId = sessionManager.getSessionId();
    try {
      const { session } = await createAgentSession({
        cwd,
        modelRuntime: runtime,
        sessionManager,
        ...(model ? { model } : {}),
      });
      if (
        disposing ||
        pendingClose.has(pendingId) ||
        (input.id && pendingClose.has(input.id))
      ) {
        session.dispose();
        throw new Error("Session was closed while opening.");
      }
      extensionDialogs.activate(session.sessionId);
      // Emits session_start and loads extension resources; stored bindings are reused by reload().
      const uiContext = notificationUI(
        session.extensionRunner.getUIContext(),
        (message, level = "info") =>
          notify({ message, level, session: { id: session.sessionId, cwd } }),
        extensionDialogs,
        session.sessionId,
      );
      if (terminalEmit) {
        const host = new TerminalUIHost(
          session.sessionId,
          uiContext.theme,
          terminalEmit,
        );
        terminalHosts.set(session.sessionId, host);
        uiContext.custom = host.custom;
      }
      try {
        await session.bindExtensions({
          uiContext,
          mode: terminalEmit ? "tui" : "rpc",
          onError: (e) =>
            warn(
              `Extension ${e.extensionPath} failed on ${e.event}: ${e.error}`,
            ),
        });
      } catch (error) {
        extensionDialogs.close(session.sessionId);
        session.dispose();
        throw error;
      }
      if (
        disposing ||
        pendingClose.has(pendingId) ||
        (input.id && pendingClose.has(input.id))
      ) {
        extensionDialogs.close(session.sessionId);
        session.dispose();
        throw new Error("Session was closed while opening.");
      }
      const firstUser = session.messages.find((m) => m.role === "user");
      const title =
        sessionManager.getSessionName() ||
        (firstUser
          ? typeof firstUser.content === "string"
            ? firstUser.content
            : firstUser.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join(" ")
          : "New chat");
      const managed = {
        session,
        unsubscribe: () => {},
        info: {
          id: session.sessionId,
          cwd,
          path: session.sessionFile,
          title,
          modified: Date.now(),
        },
        transcript: hydrate(session.messages),
      };
      managed.unsubscribe = session.subscribe((event) => {
        managed.transcript = reduceTranscript(managed.transcript, event);
        if (event.type === "agent_settled") scheduleDeferredReload(session);
        if (
          event.type === "message_end" ||
          event.type === "session_info_changed"
        ) {
          managed.info.path = session.sessionFile;
          managed.info.modified = Date.now();
          if (event.type === "session_info_changed")
            managed.info.title = event.name || managed.info.title;
          else if (
            event.message.role === "user" &&
            managed.info.title === "New chat"
          ) {
            const content = event.message.content;
            managed.info.title =
              typeof content === "string"
                ? content
                : content
                    .filter((c) => c.type === "text")
                    .map((c) => c.text)
                    .join(" ");
          }
        }
        const contextUsage = [
          "message_end",
          "agent_settled",
          "compaction_end",
        ].includes(event.type)
          ? (session.getContextUsage() ?? null)
          : undefined;
        if (event.type === "message_update") {
          const { message: _message, ...wire } = event;
          emit(session.sessionId, wire);
        } else emit(session.sessionId, event, contextUsage);
      });
      sessions.set(session.sessionId, managed);
      return {
        info: managed.info,
        transcript: managed.transcript,
        pendingDialogs: extensionDialogs.list(session.sessionId),
        ...modelSelection(session),
      };
    } finally {
      if (!sessions.has(pendingId)) closeTerminalUI(pendingId);
      pendingClose.delete(pendingId);
      if (input.id) {
        pendingClose.delete(input.id);
      }
    }
  }).finally(() => {
    opening.delete(key);
    if (opening.size === 0) pendingClose.clear();
  });
  opening.set(key, promise);
  return promise;
}
export function renameSession(info: SessionInfo, value: unknown) {
  const name = sessionName(value);
  return withPackageLock(async () => {
    const live = sessions.get(info.id);
    if (live && (live.info.cwd !== info.cwd || live.info.path !== info.path))
      throw new Error("Session does not belong to this project.");
    if (live) {
      live.session.setSessionName(name);
      live.info.title = live.session.sessionName ?? name;
      live.info.modified = Date.now();
      return { ...live.info };
    }
    return {
      ...info,
      title: renameStoredSession(info, name),
      modified: Date.now(),
    };
  });
}
function retireSession(id: string) {
  closeTerminalUI(id);
  extensionDialogs.close(id);
  const managed = sessions.get(id);
  if (!managed) return;
  promptQueue.abort(managed.session);
  managed.unsubscribe();
  deferredReloads.delete(managed.session);
  managed.session.dispose();
  sessions.delete(id);
}
export function deleteSession(info: SessionInfo) {
  return withPackageLock(async () => {
    const live = sessions.get(info.id);
    if (live && (live.info.cwd !== info.cwd || live.info.path !== info.path))
      throw new Error("Session does not belong to this project.");
    const pendingWriter = [...prompting].some(
      ([session, count]) => count > 0 && session.sessionId === info.id,
    );
    assertSessionDeletable(live?.session, pendingWriter);
    retireSession(info.id);
    await removeStoredSession(info);
  });
}
export function closeSession(id: string) {
  closeTerminalUI(id);
  extensionDialogs.close(id);
  if (opening.size > 0) pendingClose.add(id);
  const live = sessions.get(id);
  if (live) promptQueue.abort(live.session);
  return withPackageLock(async () => retireSession(id));
}
export function disposeSessions() {
  for (const host of terminalHosts.values()) host.dispose();
  terminalHosts.clear();
  disposing = true;
  extensionDialogs.dispose();
  for (const id of sessions.keys()) void closeSession(id).catch(console.error);
}

export function abortSession(id: string) {
  terminalHosts.get(id)?.cancelAll("Run aborted");
  extensionDialogs.cancelSession(id);
  const session = getSession(id);
  promptQueue.abort(session);
  return session.abort();
}
export async function promptSession(
  id: string,
  text: string,
  images?: import("@earendil-works/pi-ai").ImageContent[],
  onAccepted?: (disposition: "started" | "queued" | "handled") => void,
) {
  const session = getSession(id);
  // Hold the lock only while starting, including pre-streaming SDK awaits.
  await promptQueue.start(session, () => {
    if (getSession(id) !== session) throw new Error("Session is closed");
    if (images?.length && !session.model?.input.includes("image"))
      throw new Error("The current model does not accept images.");
    prompting.set(session, (prompting.get(session) ?? 0) + 1);
    return (
      session
        // preflightResult is SDK-internal; keep this dependency in the pi adapter.
        .prompt(text, {
          images,
          streamingBehavior: "followUp",
          preflightResult: onAccepted,
        })
        .finally(() => {
          const remaining = (prompting.get(session) ?? 1) - 1;
          if (remaining) prompting.set(session, remaining);
          else prompting.delete(session);
          scheduleDeferredReload(session);
        })
    );
  });
}

// Transcript turns carry no entry ids; a message's start timestamp identifies it on the branch.
function messageEntryId(
  session: AgentSession,
  role: "user" | "assistant",
  timestamp: number,
) {
  const entry = session.sessionManager
    .getBranch()
    .find(
      (e) =>
        e.type === "message" &&
        e.message.role === role &&
        e.message.timestamp === timestamp,
    );
  if (!entry) throw new Error("Message not found in this chat.");
  return entry.id;
}
/** Moves the leaf to just before a user message so it can be sent again. */
export function rewindSession(id: string, timestamp: number) {
  return withPackageLock(async (): Promise<Snapshot> => {
    const managed = sessions.get(id);
    if (!managed) throw new Error("Session is closed");
    const { session } = managed;
    if (!session.isIdle || prompting.has(session))
      throw new Error("Wait for the current response to finish.");
    const result = await session.navigateTree(
      messageEntryId(session, "user", timestamp),
    );
    if (result.cancelled) throw new Error("An extension cancelled this.");
    managed.transcript = hydrate(session.messages);
    return {
      info: managed.info,
      transcript: managed.transcript,
      pendingDialogs: extensionDialogs.list(id),
      ...modelSelection(session),
    };
  });
}
/** Copies the conversation up to an assistant message into a new session file. */
export function forkSession(id: string, timestamp: number) {
  const { session, info } = sessions.get(id) ?? {};
  if (!session || !info) throw new Error("Session is closed");
  if (!session.sessionFile) throw new Error("This chat is not saved yet.");
  const entryId = messageEntryId(session, "assistant", timestamp);
  // A separate manager keeps the live session on its own file.
  const path = SessionManager.open(session.sessionFile).createBranchedSession(
    entryId,
  );
  if (!path) throw new Error("This chat is not saved yet.");
  return { cwd: info.cwd, path };
}

async function reloadOne(session: AgentSession): Promise<string | undefined> {
  terminalHosts.get(session.sessionId)?.cancelAll("Session reloaded");
  try {
    await session.reload();
  } catch (error) {
    return `${session.sessionId}: ${String(error)}`;
  }
}
function scheduleDeferredReload(session: AgentSession) {
  if (!deferredReloads.has(session)) return;
  void withPackageLock(async () => {
    const warn = deferredReloads.get(session);
    if (!warn || !session.isIdle || prompting.has(session)) return;
    deferredReloads.delete(session);
    const failure = await reloadOne(session);
    if (failure) warn(`Reloading 1 open chat failed: ${failure}`);
  }).catch(console.error);
}
// Called with the package lock held; close/open cannot race resource reload.
export async function reloadPackageSessions(
  warn: (message: string) => void = console.warn,
) {
  const failures: string[] = [];
  for (const { session } of sessions.values()) {
    if (!session.isIdle || prompting.has(session)) {
      deferredReloads.set(session, warn);
      continue;
    }
    deferredReloads.delete(session);
    const failure = await reloadOne(session);
    if (failure) failures.push(failure);
  }
  return failures;
}
