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
