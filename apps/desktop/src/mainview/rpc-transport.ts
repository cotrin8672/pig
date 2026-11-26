import { Electroview } from "electrobun/view";
import type { RpcHandlers } from "../shared/desktop-rpc";
import type { RPCSchema } from "../shared/rpc-schema";

export function createRendererRpc(handlers: RpcHandlers<"webview">) {
  const rpc = Electroview.defineRPC<RPCSchema>({
    maxRequestTime: 600_000,
    handlers,
  });
  new Electroview({ rpc });
  return rpc;
}
