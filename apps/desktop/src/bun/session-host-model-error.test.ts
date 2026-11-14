import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("model errors retry within budget, then stop, preserve queued input and allow a later manual send", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-model-error-"));
  try {
    const script = `
      import { expect } from "bun:test";
      import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
      import { SessionHost } from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import { createCompletionTracker } from ${JSON.stringify(new URL("./notifications.ts", import.meta.url).href)};
      import { modelInfo, disposeSessions } from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      const faux = fauxProvider({ tokensPerSecond: Infinity, models: [{ id: "fixture" }] });
      const outcomes = [];
      const track = createCompletionTracker();
      const host = new SessionHost({ modelInfo,
        configureModels: models => models.registerNativeProvider(faux.provider),
        emit(event) {
          if (event.type !== "snapshot") return;
          const outcome = track(event.snapshot);
          if (outcome) outcomes.push(outcome);
        }, emitUI() {}, emitTerminal() {},
      });
      const chat = await host.openSession({ cwd: ${JSON.stringify(home)}, openId: "error" });
      const model = faux.getModel();
      await host.setModel({ ...chat.address, provider: model.provider, id: model.id });
      const session = host.session(chat.info.id);
      session.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } });
      const events = [];
      session.subscribe(event => events.push(event));
      let stopped;
      const abort = host.abort.bind(host);
      host.abort = address => stopped = abort(address);
      const input = (text, requestId) => ({ ...chat.address, text, requestId, draftRevision: host.drafts.read(chat.address).revision });
      const wait = async predicate => {
        const end = Date.now() + 5000;
        while (!predicate()) {
          if (Date.now() > end) throw new Error("fixture wait exceeded");
          await Bun.sleep(1);
        }
      };
      for (const [error, retries] of [
        ['429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account rate limit."}}', 3],
        ["401 authentication_error", 0],
        ["503 service unavailable", 3],
        ["Unexpected model failure", 0],
        ["WebSocket closed 1012", 3],
      ]) {
        let entered = false;
        const gate = Promise.withResolvers();
        const before = faux.state.callCount;
        const eventStart = events.length;
        stopped = undefined;
        const failed = () => fauxAssistantMessage([], { stopReason: "error", errorMessage: error });
        faux.setResponses([
          async () => { entered = true; await gate.promise; return failed(); },
          ...Array.from({ length: retries }, failed),
          fauxAssistantMessage("must not exceed the retry budget or deliver queued input"),
        ]);
        await host.prompt(input("request", crypto.randomUUID()));
        await wait(() => entered);
        const queuedId = crypto.randomUUID();
        expect(await host.prompt(input("keep this queued input", queuedId))).toEqual({ disposition: "queued" });
        gate.resolve();
        await host.receipts.settled(chat.address);
        await session.waitForIdle();
        expect(stopped).toBeDefined();
        await stopped;
        const snapshot = host.getSessionSnapshot(chat.address);
        expect(snapshot.transcript.running).toBe(false);
        expect(snapshot.failure).toBe(error);
        expect(outcomes.at(-1)).toBe("error");
        expect(faux.state.callCount - before).toBe(1 + retries);
        expect(events.slice(eventStart).filter(event => event.type === "auto_retry_start").length).toBe(retries);
        expect(snapshot.retry).toBeUndefined();
        expect(snapshot.transcript.records.some(record => record.kind === "message" && record.message.role === "assistant" && record.message.errorMessage === error)).toBe(true);
        // A retry continues the same run, so the SDK delivers queued input with it;
        // without a retry the queued input is restored as cancelled.
        expect(snapshot.transcript.records.some(record => retries
          ? record.kind === "message" && record.message.role === "user" && JSON.stringify(record.message.content).includes("keep this queued input")
          : record.customType === "Cancelled queued prompt" && record.message.details.requestId === queuedId)).toBe(true);
      }
      faux.setResponses([fauxAssistantMessage("manual send succeeded")]);
      await host.prompt(input("try again manually", "manual"));
      await host.receipts.settled(chat.address);
      expect(host.getSessionSnapshot(chat.address).failure).toBeUndefined();
      // A transient failure that recovers on retry completes as a success.
      const recoveredStart = events.length;
      faux.setResponses([
        fauxAssistantMessage([], { stopReason: "error", errorMessage: "WebSocket closed 1012" }),
        fauxAssistantMessage("recovered"),
      ]);
      await host.prompt(input("recover", "recover"));
      await host.receipts.settled(chat.address);
      await session.waitForIdle();
      const recovered = host.getSessionSnapshot(chat.address);
      expect(recovered.failure).toBeUndefined();
      expect(recovered.aborted).toBe(false);
      expect(events.slice(recoveredStart).filter(event => event.type === "auto_retry_start").length).toBe(1);
      expect(session.getLastAssistantText()).toBe("recovered");
      expect(outcomes).toEqual(["error", "error", "error", "error", "error", "success", "success"]);
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
