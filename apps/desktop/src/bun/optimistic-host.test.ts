import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("real SDK sends retain request identities and unavailable saved models fall back without blocking history", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-optimistic-"));
  try {
    const script = `
      import { expect } from "bun:test";
      import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
      import { SessionHost } from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import { writeDefaultModel } from ${JSON.stringify(new URL("./default-model.ts", import.meta.url).href)};
      import { modelInfo, disposeSessions } from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      const faux = fauxProvider({ tokensPerSecond: Infinity, models: [{ id: "a" }, { id: "b" }] });
      let hidden = [];
      const host = new SessionHost({ modelInfo, disabled: () => hidden,
        configureModels: (models) => models.registerNativeProvider(faux.provider),
        emit() {}, emitUI() {}, emitTerminal() {},
      });
      const a = faux.getModel("a"), b = faux.getModel("b");
      await writeDefaultModel({ provider: b.provider, id: b.id }, [a, b]);
      let snapshot = await host.openSession({ cwd: ${JSON.stringify(home)}, openId: "initial" });
      expect(snapshot.model.id).toBe(b.id);
      await writeDefaultModel({ provider: a.provider, id: a.id }, [a, b]);
      const next = await host.openSession({ cwd: ${JSON.stringify(home)}, openId: "next" });
      expect(next.model.id).toBe(a.id);
      expect(host.getSessionSnapshot(snapshot.address).model.id).toBe(b.id);
      await host.closeSession(next.address);
      await host.setModel({ ...snapshot.address, provider: b.provider, id: b.id });
      for (const requestId of ["first", "identical-text-second"]) {
        faux.setResponses([fauxAssistantMessage("answer", { provider: b.provider, model: b.id })]);
        await host.prompt({ ...snapshot.address, requestId, text: "same text", draftRevision: host.drafts.read(snapshot.address).revision });
        await host.receipts.settled();
      }
      snapshot = host.getSessionSnapshot(snapshot.address);
      expect(snapshot.transcript.records.filter((record) => record.kind === "message" && record.message.role === "user").map((record) => record.requestId)).toEqual(["first", "identical-text-second"]);
      const id = snapshot.info.id;
      await host.closeSession(snapshot.address);
      hidden = [b.provider + "/" + b.id];
      snapshot = await host.openSession({ cwd: ${JSON.stringify(home)}, id, openId: "fallback" });
      expect(snapshot.model.id).toBe(a.id);
      expect(snapshot.transcript.records.some((record) => record.kind === "message" && record.message.role === "user")).toBe(true);
      expect(snapshot.modelCatalog.some((model) => model.provider === a.provider && model.id === a.id)).toBe(true);
      host.session(id).settingsManager.setDefaultModelAndProvider(a.provider, a.id);
      expect((await host.setModel({ ...snapshot.address, provider: "missing", id: "gone" })).model.id).toBe(a.id);
      await host.dispose();
      await disposeSessions();
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
