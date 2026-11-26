import { invoke } from "@tauri-apps/api/core";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { widgetBlock } from "../shared/widget";
import { openChat, rpc } from "./rpc";
import { useStore } from "./store";
import probe from "./tauri-isolation-probe.js?raw";
import { WidgetFrame } from "./WidgetFrame";

async function until(predicate: () => unknown, name: string) {
  for (let i = 0; i < 160; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${name}`);
}

async function assertIframeIsolation() {
  const { highlightNative } = await import("./native-syntax");
  const source = "const drink = '🍵';\r\n// 日本語";
  const rows = await highlightNative(source);
  if (
    rows
      .map((line) => line.map((token) => token.content).join(""))
      .join("\n") !== source ||
    !rows.some((line) => line.some((token) => token.color))
  )
    throw new Error("Native highlighter lost source or syntax colors.");
  await invoke("preview_ipc_ping", { frame: false });
  let reply: { isolated?: boolean; ipc?: string } | undefined;
  const frame = document.createElement("iframe");
  frame.sandbox.add("allow-scripts");
  frame.hidden = true;
  frame.srcdoc = `<!doctype html><button type="button">Test</button><script>${probe}</script>`;
  const receive = (event: MessageEvent) => {
    if (
      event.source === frame.contentWindow &&
      event.origin === "null" &&
      event.data?.type === "pig-tauri-preview-isolation"
    )
      reply = event.data;
  };
  window.addEventListener("message", receive);
  document.body.append(frame);
  try {
    await until(() => reply !== undefined, "iframe script");
    if (
      reply?.isolated !== true ||
      !["absent", "rejected", "no reply"].includes(reply.ipc ?? "")
    )
      throw new Error("Sandbox could access the parent or invoke native IPC.");
  } finally {
    window.removeEventListener("message", receive);
    frame.remove();
  }
}

async function assertWidgets() {
  const box = document.createElement("div");
  Object.assign(box.style, { position: "fixed", top: "0", left: "0" });
  document.body.append(box);
  const root = createRoot(box);
  const received = new Map<string, MessageEvent>();
  const listen = (event: MessageEvent) => {
    if (event.origin === "null" && typeof event.data?.type === "string")
      received.set(event.data.type, event);
  };
  window.addEventListener("message", listen);
  const viz = widgetBlock(
    `<button type="button">Test</button><script>${probe}
      addEventListener("message", ({source,data}) => {
        if (source === parent && data?.type === "pig:smoke-navigate")
          location.href = "http://pig-widget.localhost/frame?navigation-test";
      });
    </script>`,
    { origin: "tool", title: "Visualize fixture" },
  );
  const mcp = widgetBlock("", { origin: "mcp", title: "MCP fixture" });
  const load = async (interactive: boolean) =>
    interactive
      ? {
          interactive: true as const,
          html: `<html><body><p>MCP fixture</p><script>
const send = (data) => parent.postMessage({jsonrpc:"2.0", ...data}, "*");
let input;
addEventListener("message", ({source, data}) => {
  if (source !== parent) return;
  if (data.id === 1 && data.result?.protocolVersion === "2026-01-26") {
    send({method:"ui/notifications/initialized"});
    send({id:2,method:"tools/call",params:{name:"fixture-no-op",arguments:{}}});
  }
  if (data.method === "ui/notifications/tool-input") input = data.params;
  if (data.method === "ui/notifications/tool-result")
    parent.postMessage({type:"pig:smoke-mcp-result",input,result:data.params},"*");
  if (data.id === 2)
    parent.postMessage({type:"pig:smoke-mcp-denied",denied:data.error?.code === -32601},"*");
});
send({id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"fixture",version:"1"},appCapabilities:{}}});
</script></body></html>`,
        }
      : { html: "<p>Static fallback</p>" };
  root.render([
    createElement(WidgetFrame, { key: "viz", block: viz }),
    createElement(WidgetFrame, {
      key: "mcp",
      block: mcp,
      load,
      mcp: {
        args: { x: 7 },
        result: {
          content: [{ type: "text", text: "MCP result" }],
          details: { hostOnly: true },
        },
      },
    }),
  ]);
  try {
    await until(() => {
      const frame = box.querySelector<HTMLIFrameElement>(
        'iframe[aria-label="Visualize fixture"]',
      );
      const event = received.get("pig-tauri-preview-isolation");
      return (
        frame?.sandbox.value === "allow-scripts" &&
        event &&
        event.source === frame.contentWindow &&
        event.data.isolated &&
        ["absent", "rejected", "no reply"].includes(event.data.ipc)
      );
    }, "Visualize runs in the isolated document");
    await until(() => {
      const frame = box.querySelector<HTMLIFrameElement>(
        'iframe[aria-label="MCP fixture"]',
      );
      if (!frame) return false;
      const result = received.get("pig:smoke-mcp-result");
      const denied = received.get("pig:smoke-mcp-denied");
      return (
        result?.source === frame.contentWindow &&
        result.data.input?.arguments?.x === 7 &&
        result.data.result?.content?.[0]?.text === "MCP result" &&
        !Object.hasOwn(result.data.result, "details") &&
        denied?.source === frame.contentWindow &&
        denied.data.denied === true
      );
    }, "MCP widget handshake, tool data, and denied host calls");
    box
      .querySelector<HTMLIFrameElement>(
        'iframe[aria-label="Visualize fixture"]',
      )
      ?.contentWindow?.postMessage({ type: "pig:smoke-navigate" }, "*");
    // Rust checks that WebView2 cancelled this fixture navigation.
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    window.removeEventListener("message", listen);
    root.unmount();
    box.remove();
  }
}

export async function runTauriSmoke() {
  let failure: string | null = null;
  try {
    await Promise.race([
      rpc.request.bootstrap(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Bun did not reply to bootstrap")),
          10_000,
        ),
      ),
    ]);
    await until(
      () => useStore.getState().initialized,
      "real React UI bootstrap",
    );
    const cwd = useStore.getState().bootstrap.generalCwd;
    const provider = "pig-smoke";
    const id = "pig-smoke-model";
    await rpc.request.setDefaultModel({ model: { provider, id } });
    // Exercise the request, the stream publications and the normal App rendering.
    const chat = await rpc.request.openSession({
      cwd,
      openId: crypto.randomUUID(),
    });
    const expectedRevision = (await rpc.request.getSessionDraft(chat.address))
      .revision;
    const text = "Tauri smoke prompt";
    const requestId = crypto.randomUUID();
    const synced = await rpc.request.syncDraft({
      ...chat.address,
      expectedRevision,
      content: { text, pastes: [], images: [] },
    });
    if (!synced.applied) throw new Error("Draft was not saved.");
    await rpc.request.prompt({
      ...chat.address,
      text,
      requestId,
      draftRevision: synced.draft.revision,
    });
    await until(() => {
      const snapshot = useStore.getState().snapshots[chat.info.id];
      return (
        snapshot?.transcript.running === false &&
        JSON.stringify(snapshot.transcript).includes(
          "Windows Tauri smoke reply",
        )
      );
    }, "live reply publication");
    await rpc.request.closeSession(chat.address);
    await openChat(cwd, chat.info.id);
    await until(
      () =>
        Array.from(document.querySelectorAll(".prose")).some((view) =>
          view.textContent?.includes("Windows Tauri smoke reply"),
        ),
      "restored chat rendered",
    );
    rpc.send.windowControl({ action: "toggleMaximize" });
    await until(() => useStore.getState().maximized, "maximize event");
    rpc.send.windowControl({ action: "toggleMaximize" });
    await until(() => !useStore.getState().maximized, "restore event");
    await assertIframeIsolation();
    await assertWidgets();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  await invoke("pig_smoke_done", { failure });
}
