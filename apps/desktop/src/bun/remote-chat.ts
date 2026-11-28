import { createHash } from "node:crypto";
import { opendir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import type { SessionInfo, Snapshot } from "../shared/rpc-schema";
import type { SessionAddress } from "../shared/runtime-contract";
import type { Transcript } from "../shared/transcript";
import type { SessionHost } from "./session-host";

type Host = Pick<
  SessionHost,
  | "openSession"
  | "cancelOpen"
  | "cancelPrompt"
  | "remoteReceipt"
  | "listSessions"
  | "getSessionHistory"
  | "readSessionSnapshot"
  | "prompt"
  | "getPromptReceipt"
  | "broker"
  | "sessionAddress"
  | "isSuspended"
  | "wakeSession"
>;
const fail = (): never => {
  throw new Error("Invalid remote operation");
};
function string(value: unknown, max: number) {
  if (typeof value !== "string" || !value.length || value.length > max)
    return fail();
  return value;
}
function page(t: Transcript) {
  // Never serialize the SDK message or content blocks themselves (tools, images, thinking).
  let budget = 100_000;
  let truncated = false;
  const messages = [];
  for (const r of [...t.records].reverse()) {
    if (r.kind !== "message") continue;
    const m = r.message;
    if (m.role !== "assistant" && m.role !== "user") continue;
    let text = "";
    const append = (s: string) => {
      const part = s.slice(0, budget);
      truncated ||= part.length !== s.length;
      text += part;
      budget -= part.length;
    };
    if (typeof m.content === "string") append(m.content);
    else
      for (const block of m.content)
        if (block.type === "text") append(block.text);
    messages.push({ id: r.id, role: m.role, text });
    if (!budget || messages.length >= 256) {
      truncated = true;
      break;
    }
  }
  return {
    messages: messages.reverse(),
    running: t.running,
    truncated,
    history: t.history,
  };
}

/** No window RPC dispatch here. All paths and live addresses originate on this host. */
export function remoteChat(
  host: Host,
  scopes: () => string[],
  register?: (cwd: string, check: () => void) => Promise<string>,
) {
  const catalog = new Map<string, SessionInfo>();
  const chatKey = (cwd: string, id: string) =>
    createHash("sha256")
      .update(JSON.stringify([cwd, id]))
      .digest("hex");
  const folders = new Map<string, { cwd: string; root: string }>();
  const projectKey = (cwd: string) =>
    createHash("sha256").update(cwd).digest("hex");
  const project = (cwd: string) => ({
    id: projectKey(cwd),
    name: cwd === scopes()[0] ? "Projectなしのチャット" : basename(cwd) || cwd,
  });
  const projectPath = (id: unknown) =>
    scopes().find((cwd) => projectKey(cwd) === id) ?? fail();
  async function folderPath(id: unknown) {
    const f = folders.get(string(id, 64));
    if (!f || !scopes().slice(1).includes(f.root)) return fail();
    const cwd = await realpath(f.cwd);
    const rel = relative(await realpath(f.root), cwd);
    if (isAbsolute(rel) || rel.split(/[\\/]/)[0] === ".." || cwd !== f.cwd)
      return fail();
    return { ...f, cwd };
  }
  const views = new Map<
    string,
    { address: SessionAddress; cwd: string; peer: string }
  >();
  function issueView(address: SessionAddress, cwd: string, peer: string) {
    const token = crypto.randomUUID();
    const oldest = views.keys().next().value;
    if (views.size >= 256 && oldest) views.delete(oldest);
    views.set(token, { address, cwd, peer });
    return token;
  }
  async function handle(
    peer: string,
    raw: unknown,
    check: () => void,
    signal?: AbortSignal,
  ) {
    check();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
    const q = raw as Record<string, unknown>;
    const scoped = (cwd: string) => {
      check();
      if (!scopes().includes(cwd)) fail();
    };
    if (q.op === "projects") return scopes().map(project);
    if (q.op === "folders") {
      const result: { id: string; name: string }[] = [];
      async function add(path: string, root: string) {
        scoped(root);
        const cwd = await realpath(path);
        const id = projectKey(cwd);
        const oldest = folders.keys().next().value;
        if (folders.size >= 8192 && oldest) folders.delete(oldest);
        folders.set(id, { cwd, root });
        result.push({ id, name: basename(cwd) || cwd });
      }
      if (q.parent === undefined) {
        for (const root of scopes().slice(1)) await add(root, root);
      } else {
        const { cwd, root } = await folderPath(q.parent);
        for await (const dir of await opendir(cwd)) {
          signal?.throwIfAborted();
          if (
            dir.isDirectory() &&
            !dir.isSymbolicLink() &&
            !dir.name.startsWith(".")
          )
            await add(join(cwd, dir.name), root);
          if (result.length >= 500) break;
        }
      }
      check();
      if (
        result.some(
          (item) => !scopes().includes(folders.get(item.id)?.root ?? ""),
        )
      )
        return fail();
      return result;
    }
    if (q.op === "addFolder") {
      const { cwd, root } = await folderPath(q.folder);
      check();
      if (!register) return fail();
      return project(await register(cwd, () => scoped(root)));
    }
    if (q.op === "list") {
      const next = new Map<string, SessionInfo>();
      for (const cwd of q.project === undefined
        ? new Set(scopes())
        : [projectPath(q.project)]) {
        for (const [id, info] of catalog)
          if (info.cwd === cwd) catalog.delete(id);
        const chats = await host.listSessions(cwd);
        scoped(cwd);
        for (const chat of chats) {
          const key = chatKey(cwd, chat.id);
          next.set(key, { ...chat, cwd });
          catalog.set(key, { ...chat, cwd });
        }
      }
      const offset = q.offset ?? 0;
      if (
        typeof offset !== "number" ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      )
        return fail();
      const visible = [...next].filter(([, s]) => scopes().includes(s.cwd));
      return {
        total: visible.length,
        chats: visible
          .slice(offset, offset + 100)
          .map(([chat, s]) => ({ chat, title: s.title.slice(0, 256) })),
      };
    }
    if (q.op === "open" || q.op === "new") {
      const info =
        q.op === "new"
          ? { cwd: projectPath(q.project), id: undefined }
          : catalog.get(string(q.chat, 64));
      if (!info || !scopes().includes(info.cwd)) return fail();
      const openId = crypto.randomUUID();
      const cancel = () => host.cancelOpen({ openId });
      signal?.addEventListener("abort", cancel, { once: true });
      let snapshot: Snapshot;
      try {
        snapshot = await host.openSession({
          id: info.id,
          cwd: info.cwd,
          openId,
        });
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
      scoped(info.cwd);
      if (snapshot.info.cwd !== info.cwd) return fail();
      return {
        view: issueView(snapshot.address, info.cwd, peer),
        chat: chatKey(info.cwd, snapshot.info.id),
        ...page(snapshot.transcript),
      };
    }
    const view = views.get(string(q.view, 64));
    if (!view || view.peer !== peer || !scopes().includes(view.cwd))
      return fail();
    const addr = view.address;
    if (q.op === "read") {
      const current = host.sessionAddress(addr.sessionId, view.cwd);
      const snapshot = host.isSuspended(current)
        ? await host.wakeSession(current)
        : await host.readSessionSnapshot(current);
      scoped(view.cwd);
      if (
        snapshot.info.cwd !== view.cwd ||
        snapshot.address.hostId !== addr.hostId
      )
        return fail();
      const replaced = snapshot.address.epoch !== addr.epoch;
      return {
        ...page(snapshot.transcript),
        ...(replaced
          ? { view: issueView(snapshot.address, view.cwd, peer) }
          : {}),
        failed: !!snapshot.failure,
        waitingForHost: host.broker
          .pending()
          .some(
            (p) =>
              p.sessionId === addr.sessionId &&
              p.epoch === snapshot.address.epoch,
          ),
      };
    }
    if (q.op === "history") {
      const result = page(
        await host.getSessionHistory({
          ...addr,
          before: string(q.before, 256),
          revision: string(q.revision, 512),
        }),
      );
      scoped(view.cwd);
      return result;
    }
    const id = string(q.id, 64);
    if (!/^[\w-]+$/.test(id)) return fail();
    const key = { ...addr, requestId: `remote:${peer}:${id}` };
    if (q.op === "receipt") {
      const state = host.getPromptReceipt(key).state;
      return {
        state:
          state === "unknown"
            ? host.remoteReceipt(addr.sessionId, view.cwd, key.requestId)
            : state,
      };
    }
    if (q.op !== "send") return fail();
    const text = string(q.text, 16000);
    if (!text.trim() || /^[!/]/.test(text.trimStart())) return fail();
    check();
    const cancel = () => host.cancelPrompt(key);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await host.prompt(
        { ...key, text, draftRevision: 0 },
        undefined,
        () => scoped(view.cwd),
      );
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  // Keep control/receipt requests available. Count actual work until settlement,
  // even when the caller has disconnected from a shared SDK wake or admission.
  let work = 0;
  return async (
    peer: string,
    raw: unknown,
    check: () => void,
    signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted();
    const op = (raw as { op?: string } | null)?.op;
    if (op === "receipt" || op === "projects")
      return handle(peer, raw, check, signal);
    if (work >= 6) throw Error("Remote host busy");
    work++;
    const task = handle(peer, raw, check, signal).finally(() => {
      work--;
    });
    if (!signal) return task;
    let abort = () => {};
    const gone = new Promise<never>((_, reject) => {
      abort = () => reject(Error("Request expired"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      return await Promise.race([task, gone]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
}
