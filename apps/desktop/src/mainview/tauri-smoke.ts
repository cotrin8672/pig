import { invoke } from "@tauri-apps/api/core";
import { openChat, rpc } from "./rpc";
import { useStore } from "./store";
import probe from "./tauri-isolation-probe.js?raw";

async function until(predicate: () => unknown, name: string) {
  for (let i = 0; i < 160; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${name}`);
}

async function assertIframeIsolation() {
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
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  await invoke("pig_smoke_done", { failure });
}
