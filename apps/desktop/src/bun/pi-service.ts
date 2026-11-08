import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  type AgentSession,
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  providers,
  type SessionInfo,
  type Snapshot,
  type WireEvent,
} from "../shared/rpc-schema";
import {
  hydrate,
  reduceTranscript,
  type Transcript,
} from "../shared/transcript";
import { PromptQueue, withPackageLock } from "./package-queue";

registerBunOAuthFlows();
export const runtime = await ModelRuntime.create();
console.log("[pi] SDK and Bun OAuth flows initialized");
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

export async function availableModels() {
  return (await runtime.getAvailable()).filter((model) =>
    providers.some((p) => p.id === model.provider),
  );
}
export async function listSessions(cwd: string): Promise<SessionInfo[]> {
  const found = new Map(
    (await SessionManager.list(cwd)).map((s) => [
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
  emit: (sessionId: string, event: WireEvent) => void,
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
      model: live.session.model,
    });
  const key = input.path || `new:${input.cwd}`;
  const pending = opening.get(key);
  if (pending) return pending;
  const promise = withPackageLock(async () => {
    if (disposing) throw new Error("Application is closing");
    if (
      input.path &&
      !(await SessionManager.list(input.cwd)).some((s) => s.path === input.path)
    )
      throw new Error("Session does not belong to this project.");
    const sessionManager = input.path
      ? SessionManager.open(input.path)
      : SessionManager.create(input.cwd);
    const cwd = sessionManager.getCwd();
    const model = input.path
      ? undefined
      : ((await availableModels())[0] ??
        runtime.getModels("openai-codex")[0] ??
        runtime.getModels("anthropic")[0]);
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
        if (event.type === "message_update") {
          const { message: _message, ...wire } = event;
          emit(session.sessionId, wire);
        } else emit(session.sessionId, event);
      });
      sessions.set(session.sessionId, managed);
      return {
        info: managed.info,
        transcript: managed.transcript,
        model: session.model,
      };
    } finally {
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
export function closeSession(id: string) {
  if (opening.size > 0) pendingClose.add(id);
  const live = sessions.get(id);
  if (live) promptQueue.abort(live.session);
  return withPackageLock(async () => {
    const managed = sessions.get(id);
    if (!managed) return;
    managed.unsubscribe();
    deferredReloads.delete(managed.session);
    managed.session.dispose();
    sessions.delete(id);
  });
}
export function disposeSessions() {
  disposing = true;
  for (const id of sessions.keys()) void closeSession(id).catch(console.error);
}

export function abortSession(id: string) {
  const session = getSession(id);
  promptQueue.abort(session);
  return session.abort();
}
export async function promptSession(id: string, text: string) {
  const session = getSession(id);
  // Hold the lock only while starting, including pre-streaming SDK awaits.
  await promptQueue.start(session, () => {
    if (getSession(id) !== session) throw new Error("Session is closed");
    prompting.set(session, (prompting.get(session) ?? 0) + 1);
    return session
      .prompt(text, { streamingBehavior: "followUp" })
      .finally(() => {
        const remaining = (prompting.get(session) ?? 1) - 1;
        if (remaining) prompting.set(session, remaining);
        else prompting.delete(session);
        scheduleDeferredReload(session);
      });
  });
}

async function reloadOne(session: AgentSession): Promise<string | undefined> {
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
