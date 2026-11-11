import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("real SDK: steering joins the active run, editable follow-ups wait until settlement, Stop preserves waiting input", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-steering-"));
  try {
    const script = `
      import { expect } from "bun:test";
      import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
      import { SessionHost } from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import { modelInfo, disposeSessions } from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      const faux = fauxProvider({ tokensPerSecond: Infinity, models: [{ id: "fixture" }] });
      const host = new SessionHost({ modelInfo, configureModels: m => m.registerNativeProvider(faux.provider), emit() {}, emitUI() {}, emitTerminal() {} });
      const cwd = ${JSON.stringify(home)};
      let chat = await host.openSession({ cwd, openId: "open" });
      await host.setModel({ ...chat.address, provider: faux.getModel().provider, id: faux.getModel().id });
      const input = (id, text, delivery = "steer") => ({ ...chat.address, requestId: id, text, delivery, draftRevision: host.drafts.read(chat.address).revision });
      const wait = async predicate => { const end = Date.now() + 8000; while (!predicate()) { if (Date.now() > end) throw new Error("fixture timed out"); await Bun.sleep(1); } };
      const first = Promise.withResolvers(), second = Promise.withResolvers();
      let firstEntered = false, secondEntered = false;
      faux.setResponses([
        async () => { firstEntered = true; await first.promise; return fauxAssistantMessage("first answer"); },
        async () => { secondEntered = true; await second.promise; return fauxAssistantMessage("steered answer"); },
        fauxAssistantMessage("follow-up answer"),
      ]);
      await host.prompt(input("first", "initial task"));
      await wait(() => firstEntered);
      const queued = input("queue", "do afterward", "followUp");
      const dropped = input("delete", "do not run", "followUp");
      const queueResult = host.prompt(queued);
      const droppedResult = host.prompt(dropped).then(() => "sent", () => "cancelled");
      await Bun.sleep(1);
      expect(host.getPromptReceipt(queued)).toMatchObject({ state: "pending", stage: "queued" });
      expect(await host.prompt(input("steer", "change current task"))).toEqual({ disposition: "queued" });
      expect(host.cancelPrompt(dropped)).toMatchObject({ state: "rejected", code: "CANCELLED" });
      expect(await droppedResult).toBe("cancelled");
      const ids = () => host.getSessionSnapshot(chat.address).transcript.records.filter(r => r.kind === "message" && r.message.role === "user").map(r => r.requestId);
      expect(ids()).toEqual(["first"]);
      first.resolve();
      await wait(() => secondEntered);
      expect(ids()).toEqual(["first", "steer"]);
      expect(host.getPromptReceipt(queued).state).toBe("pending");
      second.resolve();
      expect(await queueResult).toEqual({ disposition: "started" });
      await host.receipts.settled(chat.address);
      expect(ids()).toEqual(["first", "steer", "queue"]);
      expect(host.receipts.queuedIntent(queued)?.content).toBeUndefined();
      console.log("Steer entered the active run before follow-up; deleted input never executed.");

      const gate = Promise.withResolvers(); let entered = false;
      faux.setResponses([async () => { entered = true; await gate.promise; return fauxAssistantMessage("stopped"); }]);
      await host.prompt(input("stop-run", "run until stopped"));
      await wait(() => entered);
      const waiting = host.prompt(input("stop-queue", "recover this queue", "followUp")).catch(() => {});
      await Bun.sleep(1);
      const stopping = host.abort(chat.address);
      gate.resolve();
      await stopping; await waiting;
      const recovered = () => host.getSessionSnapshot(chat.address).transcript.records.filter(r => r.customType === "Cancelled queued prompt");
      expect(JSON.stringify(recovered())).toContain("recover this queue");
      const id = chat.info.id;
      await host.closeSession(chat.address);
      chat = await host.openSession({ cwd, id, openId: "reopen" });
      expect(JSON.stringify(recovered())).toContain("recover this queue");
      console.log("Stop preserved host-held queue across close/reopen.");
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
