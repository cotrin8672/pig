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
      import { DraftStore } from ${JSON.stringify(new URL("../mainview/draft-store.ts", import.meta.url).href)};
      import { SendController } from ${JSON.stringify(new URL("../mainview/send-controller.ts", import.meta.url).href)};
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

      const session = host.session(chat.info.id);
      for (const boundary of ["idle", "message_end", "agent_end", "agent_settled"]) {
        let next;
        let subsequent;
        const sendNext = () => {
          const requestId = "boundary-" + boundary;
          const text = "日本語で答えて " + boundary;
          const { draft } = host.syncDraft({
            ...chat.address, requestId, delivery: "steer",
            expectedRevision: host.drafts.read(chat.address).revision,
            content: { text, pastes: [], images: [] },
          });
          next = { ...chat.address, requestId, text, delivery: "steer", draftRevision: draft.revision };
          return host.prompt(next);
        };
        faux.setResponses([
          fauxAssistantMessage("completed response " + boundary),
          fauxAssistantMessage("次の応答 " + boundary),
        ]);
        if (boundary === "idle") subsequent = sendNext();
        else {
          const unsubscribe = session.subscribe(event => {
            if (subsequent || event.type !== boundary) return;
            if (boundary === "message_end" && event.message.role !== "assistant") return;
            subsequent = sendNext();
          });
          await host.prompt(input("before-" + boundary, "finish this response"));
          await wait(() => !!subsequent);
          unsubscribe();
        }
        await subsequent;
        await host.receipts.settled(chat.address);
        await session.waitForIdle();
        const snapshot = host.getSessionSnapshot(chat.address);
        expect(snapshot.failure).toBeUndefined();
        expect(snapshot.transcript.running).toBe(false);
        expect(snapshot.transcript.records.filter(r => r.requestId === next.requestId)).toHaveLength(1);
        expect(session.messages.filter(m => m.role === "user" && JSON.stringify(m.content).includes(next.text))).toHaveLength(1);
        expect(session.pendingMessageCount).toBe(0);
        expect(host.getPromptReceipt(next).state).toBe("accepted");
      }
      console.log("Steering while idle, at message_end, agent_end and agent_settled dispatched once and completed.");

      const agentPrompt = session.agent.prompt;
      const failedDispatch = Promise.withResolvers();
      let dispatchEntered = false;
      let failedStop;
      const abort = host.abort.bind(host);
      host.abort = address => failedStop = abort(address);
      faux.setResponses([fauxAssistantMessage("response before SDK failure")]);
      session.agent.prompt = async (...args) => {
        await agentPrompt.apply(session.agent, args);
        dispatchEntered = true;
        await failedDispatch.promise;
        throw new Error("SDK dispatch failed");
      };
      await host.prompt(input("failed-dispatch", "start failing run"));
      await wait(() => dispatchEntered);
      expect(await host.prompt(input("failed-steer", "preserve failed steering"))).toEqual({ disposition: "queued" });
      const afterFailure = host.prompt(input("failed-follow-up", "preserve waiting follow-up", "followUp")).then(() => "sent", () => "cancelled");
      failedDispatch.resolve();
      await host.receipts.settled(chat.address);
      await wait(() => session.pendingMessageCount === 0);
      expect(failedStop).toBeDefined();
      await failedStop;
      expect(await afterFailure).toBe("cancelled");
      expect(JSON.stringify(recovered())).toContain("preserve failed steering");
      expect(JSON.stringify(recovered())).toContain("preserve waiting follow-up");
      expect(recovered().some(r => r.requestId === "failed-steer")).toBe(true);
      expect(ids()).toContain("failed-dispatch");
      expect(host.getSessionSnapshot(chat.address).failure).toBe("SDK dispatch failed");
      const recoveredKey = { ...chat.address, requestId: "failed-steer" };
      expect(() => host.acknowledgePromptRecovery({
        ...chat.address, key: { ...chat.address, requestId: "failed-dispatch" },
      })).toThrow("Queued input was not cancelled");
      const clientDrafts = new DraftStore(), notices = [];
      clientDrafts.receive(chat.address, host.getSessionDraft(chat.address));
      const transport = {
        syncDraft: async params => host.syncDraft(params),
        prompt: async () => { throw new Error("Recovery must never resend"); },
        getPromptReceipt: async key => host.getPromptReceipt(key),
        acknowledgeRecovery: async params => host.acknowledgePromptRecovery(params),
      };
      const sends = new SendController(clientDrafts, transport, () => {}, 5000, error => { throw new Error(error); }, undefined, kind => notices.push(kind));
      sends.restore(host.receipts.intents());
      sends.reconcile(host.getSessionSnapshot(chat.address));
      expect(clientDrafts.read(chat.address).content.text).toBe("preserve failed steering");
      await wait(() => host.receipts.queuedIntent(recoveredKey)?.recovered);
      expect(host.getSessionDraft(chat.address).text).toBe("preserve failed steering");
      expect(notices).toEqual(["restored"]);
      const fresh = new SendController(clientDrafts, transport, () => {});
      fresh.restore(host.receipts.intents());
      fresh.reconcile(host.getSessionSnapshot(chat.address));
      expect(clientDrafts.read(chat.address).content.text).toBe("preserve failed steering");
      session.agent.prompt = agentPrompt;
      faux.setResponses([fauxAssistantMessage("manual send after dispatch failure")]);
      await host.prompt(input("after-dispatch-failure", "new instruction"));
      await host.receipts.settled(chat.address);
      expect(session.getLastAssistantText()).toBe("manual send after dispatch failure");
      expect(session.messages.filter(m => m.role === "user").some(m => JSON.stringify(m.content).includes("preserve failed steering"))).toBe(false);
      console.log("SDK failure cleared steering and follow-ups without replay; the same chat accepted a manual send.");
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
