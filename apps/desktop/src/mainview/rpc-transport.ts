import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { desktopRpc, type RpcHandlers } from "../shared/desktop-rpc";

export function createRendererRpc(handlers: RpcHandlers<"webview">) {
  const channel = new Channel<unknown>();
  let sent = invoke<number>("pig_connect", { channel });
  const ready = sent;
  const rpc = desktopRpc<"webview", "bun">(handlers, (packet) => {
    // Serialize only delivery, not the replies. Bun can have multiple in-flight requests.
    const next = sent
      .then(() => ready)
      .then((generation) => invoke("pig_packet", { generation, packet }));
    sent = next.then(
      () => ready,
      () => ready,
    );
    return next;
  });
  channel.onmessage = (packet) => {
    void rpc.receive(packet);
  };
  const native = getCurrentWindow();
  window.addEventListener("mousedown", (event) => {
    if (
      event.button === 0 &&
      event.detail === 1 &&
      event.target instanceof Element &&
      event.target.closest(".window-drag-region") &&
      !event.target.closest(".window-no-drag")
    )
      void native.startDragging().catch(console.error);
  });
  return rpc;
}
