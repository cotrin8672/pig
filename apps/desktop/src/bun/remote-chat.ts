import { createHash } from "node:crypto";
import type { SessionInfo, Snapshot } from "../shared/rpc-schema";
import type { SessionAddress } from "../shared/runtime-contract";
import type { Transcript } from "../shared/transcript";
import type { SessionHost } from "./session-host";

type Host = Pick<
  SessionHost,
  | "openSession"
  | "listSessions"
  | "getSessionHistory"
  | "readSessionSnapshot"
  | "prompt"
  | "getPromptReceipt"
  | "broker"
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
    messages.push({ role: m.role, text });
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
export function remoteChat(host: Host, scopes: () => string[]) {
  let catalog = new Map<string, SessionInfo>();
  const views = new Map<
    string,
    { address: SessionAddress; cwd: string; peer: string }
  >();
  return async (peer: string, raw: unknown, check: () => void) => {
    check();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
    const q = raw as Record<string, unknown>;
    if (q.op === "list") {
      const next = new Map<string, SessionInfo>();
      for (const cwd of new Set(scopes())) {
        for (const chat of await host.listSessions(cwd)) {
          const key = createHash("sha256")
            .update(JSON.stringify([cwd, chat.id]))
            .digest("hex");
          next.set(key, { ...chat, cwd });
        }
      }
      catalog = next;
      const offset = q.offset ?? 0;
      if (
        typeof offset !== "number" ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      )
        return fail();
      return {
        total: next.size,
        chats: [...next]
          .slice(offset, offset + 100)
          .map(([chat, s]) => ({ chat, title: s.title.slice(0, 256) })),
      };
    }
    if (q.op === "open") {
      const info = catalog.get(string(q.chat, 64));
      if (!info || !scopes().includes(info.cwd)) return fail();
      const snapshot: Snapshot = await host.openSession({
        id: info.id,
        cwd: info.cwd,
        openId: crypto.randomUUID(),
      });
      const view = crypto.randomUUID();
      const oldest = views.keys().next().value;
      if (views.size >= 256 && oldest) views.delete(oldest);
      views.set(view, { address: snapshot.address, cwd: info.cwd, peer });
      return { view, ...page(snapshot.transcript) };
    }
    const view = views.get(string(q.view, 64));
    if (!view || view.peer !== peer || !scopes().includes(view.cwd))
      return fail();
    const addr = view.address;
    if (q.op === "read") {
      const snapshot = await host.readSessionSnapshot(addr);
      return {
        ...page(snapshot.transcript),
        failed: !!snapshot.failure,
        waitingForHost: host.broker
          .pending()
          .some(
            (p) => p.sessionId === addr.sessionId && p.epoch === addr.epoch,
          ),
      };
    }
    if (q.op === "history")
      return page(
        await host.getSessionHistory({
          ...addr,
          before: string(q.before, 256),
          revision: string(q.revision, 512),
        }),
      );
    const id = string(q.id, 64);
    if (!/^[\w-]+$/.test(id)) return fail();
    const key = { ...addr, requestId: `remote:${peer}:${id}` };
    if (q.op === "receipt") return { state: host.getPromptReceipt(key).state };
    if (q.op !== "send") return fail();
    const text = string(q.text, 16000);
    if (!text.trim() || /^[!/]/.test(text.trimStart())) return fail();
    check();
    return host.prompt({ ...key, text, draftRevision: 0 }, undefined, true);
  };
}
