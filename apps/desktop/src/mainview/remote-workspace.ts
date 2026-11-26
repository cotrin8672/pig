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
