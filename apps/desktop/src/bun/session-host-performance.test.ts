import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("progress coalesces without delaying boundaries; completed opens retain only lightweight handles", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-publish-lifetime-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {fauxProvider, fauxAssistantMessage} from "@earendil-works/pi-ai";
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {modelInfo, disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      const cwd = ${JSON.stringify(home)};
      const faux = fauxProvider({tokensPerSecond: Infinity});
      const repetitions = 3;
      const events = [], deliveries = [];
      const host = new SessionHost({modelInfo,
        connectionNow: () => 0,
        configureModels: m => m.registerNativeProvider(faux.provider),
        emit: e => {events.push(e); deliveries.push(e.type);},
        emitUI: e => deliveries.push(e.type), emitTerminal() {},
      });
      host.connectUI({clientId: "root"});
      let chat = await host.openSession({cwd, openId: "first"});
      const session = host.session(chat.info.id);
      const manager = session.sessionManager;
      const modifiedBeforeRun = chat.info.modified;
      const managed = host.sessions.get(chat.info.id);
      const seen = [];
      const projectEvent = managed.projector.event.bind(managed.projector);
      managed.projector.event = event => {seen.push(event); projectEvent(event);};
      session._emit({type: "agent_start"});
      await Bun.sleep(5);
      manager.appendMessage({role: "user", content: "First question", timestamp: Date.now()});
      let message = fauxAssistantMessage("initial");
      session._emit({type: "message_start", message});
      events.length = deliveries.length = seen.length = 0;
      for (let i = 0; i < 100; i++) {
        message = fauxAssistantMessage(String(i));
        session._emit({type: "message_update", message});
      }
      expect(seen).toHaveLength(100);
      expect(seen.at(-1).message.content).toEqual(message.content);
      expect(events).toHaveLength(0);
      await Bun.sleep(50);
      expect(events).toHaveLength(1);
      expect(events[0].snapshot.transcript.records.at(-1).message.content).toEqual(message.content);
      expect(events[0].snapshot.info.title).toBe("First question");
      expect(events[0].snapshot.info.modified).toBe(modifiedBeforeRun);

      events.length = deliveries.length = 0;
      session._emit({type: "message_update", message});
      const request = {...chat.address, uiId: "confirm", kind: "confirm", title: "Confirm", message: "Continue?"};
      const pending = host.broker.request(request);
      expect(deliveries).toEqual(["snapshot", "request"]);
      expect(managed.publishTimer).toBeUndefined();
      host.resolveExtensionUI({...request, value: true});
      await pending;

      message.content.push({type: "toolCall", id: "tool", name: "read", arguments: {}});
      events.length = 0;
      for (let i = 0; i < 100; i++)
        session._emit({type: "tool_execution_update", toolCallId: "tool", toolName: "read", partialResult: {content: [{type: "text", text: String(i)}]}});
      expect(events).toHaveLength(0);
      session._emit({type: "tool_execution_end", toolCallId: "tool", toolName: "read", result: {content: [{type: "text", text: "final"}]}, isError: false});
      expect(events).toHaveLength(1);
      expect(events[0].snapshot.transcript.tools.tool).toMatchObject({status: "done", result: {content: [{type: "text", text: "final"}]}});
      session._emit({type: "message_update", message: {...message, stopReason: "error", errorMessage: "fixture update error"}});
      expect(events.at(-1).snapshot.failure).toBe("fixture update error");
      expect(managed.publishTimer).toBeUndefined();
      session._emit({type: "message_update", message});
      manager.appendMessage(message);
      session._emit({type: "message_end", message: {...message, stopReason: "error", errorMessage: "fixture error"}});
      expect(events.at(-1).snapshot.failure).toBe("fixture error");
      session._emit({type: "agent_end", messages: [message], willRetry: false});
      expect(events.at(-1).snapshot.transcript.running).toBe(true);
      expect(events.every(e => e.snapshot.info.modified === modifiedBeforeRun)).toBe(true);
      expect((await host.listSessions(cwd)).find(s => s.id === chat.info.id).modified).toBe(modifiedBeforeRun);
      session._emit({type: "agent_settled", aborted: false});
      expect(events.at(-1).snapshot.transcript.running).toBe(false);
      const completedModified = events.at(-1).snapshot.info.modified;
      expect(completedModified).toBeGreaterThan(modifiedBeforeRun);
      expect((await host.listSessions(cwd)).find(s => s.id === chat.info.id).modified).toBe(completedModified);
      const finalCount = events.length;
      await Bun.sleep(50);
      expect(events).toHaveLength(finalCount);

      for (let i = 0; i < 1000; i++)
        manager.appendMessage(i % 2 ? fauxAssistantMessage(String(i)) : {role: "user", content: String(i), timestamp: i});
      expect(host.opens.size).toBe(0);
      let contextReads = 0, branchReads = 0;
      const getContextUsage = session.getContextUsage.bind(session);
      const getBranch = manager.getBranch.bind(manager);
      session.getContextUsage = () => {contextReads++; return getContextUsage();};
      manager.getBranch = (...args) => {branchReads++; return getBranch(...args);};
      host.getSessionSnapshot(chat.address);
      contextReads = branchReads = 0;
      for (let i = 0; i < 100; i++) host.getSessionSnapshot(chat.address);
      expect(contextReads).toBe(0); expect(branchReads).toBe(0);
      manager.appendSessionInfo("Renamed fixture");
      expect(host.getSessionSnapshot(chat.address).info.title).toBe("Renamed fixture");
      expect(contextReads).toBeGreaterThan(0); expect(branchReads).toBeGreaterThan(0);
      const same = await host.openSession({cwd, openId: "first"});
      expect(same.address).toEqual(chat.address);
      await expect(host.openSession({cwd, openId: "first", id: "different"})).rejects.toThrow("OPEN_ID_CONFLICT");

      for (let i = 0; i < repetitions; i++) {
        const previous = chat.address;
        session._emit({type: "message_update", message});
        const replacing = host.reloadSession(previous);
        expect(host.getOpenState({openId: i ? "epoch-" + (i - 1) : "first"}).state).toBe("cancelled");
        await replacing;
        chat = host.getSessionSnapshot(host.sessionAddress(chat.info.id));
        expect(chat.address.epoch).toBeGreaterThan(previous.epoch);
        expect(managed.publishTimer).toBeUndefined();
        const input = {cwd, id: chat.info.id, openId: "epoch-" + i};
        await host.openSession(input);
        expect(host.opens.size).toBe(0);
        if (i) expect(host.getOpenState({openId: "epoch-" + (i - 1)}).state).toBe("cancelled");
        events.length = deliveries.length = 0;
      }
      expect(host.getOpenState({openId: "first"}).state).toBe("cancelled");
      await expect(host.openSession({cwd, openId: "first"})).rejects.toThrow("closed or replaced");

      const id = chat.info.id;
      await host.closeSession(chat.address);
      for (let i = 0; i < repetitions; i++) {
        const input = {cwd, id, openId: "cycle-" + i};
        expect(host.sessions.size).toBe(0);
        chat = await host.openSession(input);
        const m = host.sessions.get(id);
        m.runtime.session._emit({type: "message_update", message});
        expect(m.publishTimer).toBeDefined();
        await host.closeSession(chat.address);
        expect(m.publishTimer).toBeUndefined();
        expect(host.getOpenState(input).state).toBe("cancelled");
        await expect(host.openSession(input)).rejects.toThrow("closed or replaced");
        expect(host.sessions.size).toBe(0);
        events.length = deliveries.length = 0;
      }
      expect(host.opens.size).toBe(0);
      for (const result of host.openResults.values()) {
        expect(Object.keys(result).sort()).toEqual(["input", "state"]);
        expect(Object.keys(result.state).sort()).toEqual(result.state.state === "ready" ? ["address", "state"] : ["message", "state"]);
      }
      await host.dispose(); await disposeSessions();
      console.log(JSON.stringify({burstEvents: 100, burstPublishes: 1, replacements: repetitions, openCloseCycles: repetitions, retainedInFlightOpens: host.opens.size, retainedSessions: host.sessions.size}));
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
      stdout: "inherit",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect({ code, stderr }).toMatchObject({ code: 0 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);
