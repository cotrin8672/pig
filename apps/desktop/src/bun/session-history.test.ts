import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("persisted history is available before model initialization, pages are read-only and cancellation remains final", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-history-first-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {mkdir} from "node:fs/promises";
      import {join} from "node:path";
      import {fauxProvider,fauxAssistantMessage} from "@earendil-works/pi-ai";
      import {SessionManager} from ${JSON.stringify(new URL("./sdk.ts", import.meta.url).href)};
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {FileCredentials} from ${JSON.stringify(new URL("./credentials.ts", import.meta.url).href)};
      const cwd = join(${JSON.stringify(home)},"project");
      await mkdir(cwd);
      const faux = fauxProvider({tokensPerSecond:Infinity,models:[{id:"fixture"}]});
      const manager = SessionManager.create(cwd);
      for(let i=0;i<80;i++) {
        manager.appendMessage({role:"user",content:"Question "+i,timestamp:i});
        manager.appendMessage({...fauxAssistantMessage("Answer "+i),provider:faux.getModel().provider,model:faux.getModel().id});
      }
      const id = manager.getSessionId();
      let gate = Promise.withResolvers(), started = false, fail = false;
      const events = [];
      const host = new SessionHost({
        credentials:new FileCredentials(join(${JSON.stringify(home)},"auth.json")),
        modelInfo: m => ({id:m.id,provider:m.provider,name:m.name}),
        configureModels: async m => {started = true; await gate.promise; if(fail) throw new Error("fixture model failure"); m.registerNativeProvider(faux.provider);},
        emit:e => events.push(e),emitUI() {},emitTerminal() {},
      });
      host.connectUI({clientId:"test"});
      let done = false;
      const pending = host.openSession({cwd,id,openId:"open"}).then(s => {done=true;return s;});
      while(!started) await Bun.sleep(1);
      const preview = events.find(e => e.type === "snapshot").snapshot;
      expect(preview.ready).toBe(false);
      expect(preview.transcript.records).toHaveLength(50);
      expect(done).toBe(false);
      expect(JSON.stringify(preview.transcript)).toContain("Question 79");
      expect(host.runtimeState().sessions[0].snapshot.ready).toBe(false);
      expect(() => host.listSlashCommands(preview.address)).toThrow("STALE");
      expect(() => host.prompt({...preview.address,requestId:"premature",draftRevision:0,text:"must not send"})).toThrow("STALE");
      const cursor = preview.transcript.history;
      const page = host.getSessionHistory({...preview.address,...cursor});
      expect(page.records).toHaveLength(50);
      expect(page.records.at(-1).order).toBe(preview.transcript.records[0].order-1);
      gate.resolve();
      const ready = await pending;
      expect(ready.ready).toBeUndefined();
      expect(ready.transcript.history.revision).toBe(cursor.revision);
      expect(host.session(id).sessionManager.getBranch().filter(e => e.type === "message")).toHaveLength(160);
      await host.closeSession(ready.address);
      expect(() => host.getSessionHistory({...ready.address,...cursor})).toThrow("STALE");
      // A failed runtime still publishes its readable history before closing.
      fail = true; started = false; events.length = 0;
      await expect(host.openSession({cwd,id,openId:"failed"})).rejects.toThrow("fixture model failure");
      expect(events.find(e => e.type === "snapshot").snapshot.ready).toBe(false);
      expect(events.at(-1).type).toBe("closed");
      // Cancelling during slow initialization cannot publish a late ready.
      fail = false; started = false; events.length = 0; gate = Promise.withResolvers();
      const cancelled = host.openSession({cwd,id,openId:"cancelled"}).then(() => "ready", () => "cancelled");
      while(!started) await Bun.sleep(1);
      host.cancelOpen({openId:"cancelled"});
      gate.resolve();
      expect(await cancelled).toBe("cancelled");
      expect(events.some(e => e.type === "ready")).toBe(false);
      expect(host.runtimeState().sessions).toHaveLength(0);
      await host.dispose();
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
