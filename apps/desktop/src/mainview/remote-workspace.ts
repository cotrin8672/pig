import type { RemoteQuery, RemoteResults } from "../shared/remote-workspace";
import { rpc } from "./rpc";

export async function remote<Q extends RemoteQuery>(
  id: string,
  query: Q,
): Promise<RemoteResults[Q["op"]]> {
  return (await rpc.request.remoteWorkspace({
    id,
    query,
  })) as RemoteResults[Q["op"]];
}
export const refreshRemoteSidebar = () =>
  window.dispatchEvent(new Event("remote-sidebar-changed"));

export const remoteDraftKey = (host: string, chat: string) =>
  `pig.remote.draft:${host}:${chat}`;
export type RemotePending = { view: string; id: string };
type RemoteDraft = { text?: string; pending?: RemotePending };
export const remoteSendAccepted = new EventTarget();

function parseDraft(value: string | null) {
  try {
    return (JSON.parse(value ?? "{}") as RemoteDraft | null) ?? {};
  } catch {
    return {};
  }
}

export function readRemoteDraft(key: string) {
  try {
    const pending = Object.keys(localStorage).find((entry) =>
      entry.startsWith(`${key}:pending:`),
    );
    return parseDraft(
      (pending && localStorage.getItem(pending)) || sessionStorage.getItem(key),
    );
  } catch {
    return {};
  }
}

export function saveRemoteDraft(
  key: string,
  text: string,
  pending?: RemotePending,
  settled?: string,
) {
  if (pending)
    localStorage.setItem(
      `${key}:pending:${pending.id}`,
      JSON.stringify({ text, pending }),
    );
  else if (settled) localStorage.removeItem(`${key}:pending:${settled}`);
  if (text || pending)
    sessionStorage.setItem(key, JSON.stringify({ text, pending }));
  else sessionStorage.removeItem(key);
}

export function acceptRemoteSend(key: string, id: string) {
  localStorage.removeItem(`${key}:pending:${id}`);
  if (parseDraft(sessionStorage.getItem(key)).pending?.id === id)
    sessionStorage.removeItem(key);
  remoteSendAccepted.dispatchEvent(new CustomEvent(key, { detail: id }));
}
