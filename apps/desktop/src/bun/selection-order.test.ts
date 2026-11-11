import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the host applies a model change after prompts sent before it, and before prompts sent after it", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-selection-order-"));
  try {
    const script = `
      import { expect } from "bun:test";
      import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
      import { SessionHost } from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import { modelInfo, disposeSessions } from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      const faux = fauxProvider({ tokensPerSecond: 200, models: [{ id: "a" }, { id: "b" }] });
      const host = new SessionHost({ modelInfo,
        configureModels: (models) => models.registerNativeProvider(faux.provider),
        emit() {}, emitUI() {}, emitTerminal() {},
      });
      let chat = await host.openSession({ cwd: ${JSON.stringify(home)}, openId: "o" });
      const a = faux.getModel("a"), b = faux.getModel("b");
      await host.setModel({ ...chat.address, provider: a.provider, id: a.id });
      faux.setResponses([
        fauxAssistantMessage("long answer ".repeat(40), { provider: a.provider, model: a.id }),
        fauxAssistantMessage("second", { provider: b.provider, model: b.id }),
      ]);
      // Like the renderer: reserve each send through the draft CAS, then prompt.
      const prompt = (requestId, text) => {
        const { draft } = host.syncDraft({ ...chat.address, requestId, expectedRevision: host.drafts.read(chat.address).revision, content: { text, pastes: [], images: [] } });
        return host.prompt({ ...chat.address, requestId, text, draftRevision: draft.revision });
      };
      // Issue order: prompt, model change, prompt. No awaiting between them.
      const first = prompt("1", "first");
      const change = host.setModel({ ...chat.address, provider: b.provider, id: b.id });
      const second = prompt("2", "second");
      await Promise.all([first, change, second]);
      await host.receipts.settled();
      chat = host.getSessionSnapshot(chat.address);
      const models = chat.transcript.records
        .filter((record) => record.kind === "message" && record.message.role === "assistant")
        .map((record) => record.message.model);
      expect(models).toEqual([a.id, b.id]);
      await host.dispose(); await disposeSessions();
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + error).toBe(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);
