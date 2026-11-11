import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extension = `export default pi => {
  const gate = async kind => {if(globalThis.__kind === kind) {globalThis.__entered = true; await globalThis.__gate;}};
  pi.on("input", () => gate("input"));
  pi.on("before_agent_start", () => gate("start"));
  pi.on("agent_settled", () => gate("settled"));
  pi.on("session_shutdown", () => gate("shutdown"));
};`;

test("Stop/Close/quit bound non-cooperative hooks, isolate late events and recover exact queued sends", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-stop-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {Database} from "bun:sqlite";
      import {mkdir,writeFile} from "node:fs/promises";
      import {existsSync} from "node:fs";
      import {join} from "node:path";
      import {fauxProvider,fauxAssistantMessage} from "@earendil-works/pi-ai";
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {modelInfo,disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      const cwd = ${JSON.stringify(home)};
      const recoveryFile = join(cwd,"send-recovery.sqlite");
      await mkdir(join(cwd,".pi/extensions"),{recursive:true});
      await writeFile(join(cwd,".pi/extensions/gates.ts"), ${JSON.stringify(extension)});
      const faux = fauxProvider({tokensPerSecond:Infinity,models:[{id:"fixture",input:["text","image"]}]});
      const events = [];
      function makeHost() {
        const host = new SessionHost({modelInfo,recoveryFile,configureModels:m=>m.registerNativeProvider(faux.provider),emit:e=>events.push(e),emitTerminal(){},emitUI(e){
          if(e.type === "request" && e.request.kind === "project-trust") queueMicrotask(()=>host.resolveExtensionUI({...e.request,kind:"project-trust",value:"once"}));
        }});
        host.connectUI({clientId:crypto.randomUUID()}); return host;
      }
      const host = makeHost();
      const wait = async predicate => {const end = Date.now()+8000; while(!predicate()) {if(Date.now()>end) throw new Error("fixture wait exceeded"); await Bun.sleep(1);}};
      const open = async (host,id) => {
        const chat = await host.openSession({cwd,id,openId:crypto.randomUUID()});
        await host.setModel({...chat.address,provider:faux.getModel().provider,id:faux.getModel().id}); return chat;
      };
      const input = (chat,text,requestId=crypto.randomUUID()) => ({...chat.address,text,requestId,draftRevision:host.drafts.read(chat.address).revision});
      let chat = await open(host);
      let dispatches = 0, entered = false;
      const modelGate = Promise.withResolvers();
      faux.setResponses([async () => {dispatches++;entered=true;await modelGate.promise;return fauxAssistantMessage("first answer");},()=>{dispatches++;return fauxAssistantMessage("must not execute queue");}]);
      await host.prompt(input(chat,"first run")); await wait(()=>entered);
      const image = {type:"image",mimeType:"image/png",data:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII="};
      const queued = [input(chat,"same queued text","queue-one"),input(chat,"same queued text","queue-two")];
      for(const request of queued) expect(await host.prompt({...request,draftRevision:host.drafts.read(chat.address).revision,images:[image]})).toEqual({disposition:"queued"});
      host.syncDraft({...chat.address,expectedRevision:host.drafts.read(chat.address).revision,content:{text:"next draft survives Stop",pastes:[],images:[]}});
      const stopping = host.abort(chat.address);
      expect(()=>host.prompt(input(chat,"too early"))).toThrow("STALE");
      modelGate.resolve(); await stopping;
      expect(dispatches).toBe(1);
      expect(host.drafts.read(chat.address).text).toBe("next draft survives Stop");
      const recovered = host.getSessionSnapshot(chat.address).transcript.records.filter(r=>r.kind === "message" && r.customType === "Cancelled queued prompt");
      expect(recovered).toHaveLength(2);
      expect(recovered.map(r=>r.message.details.requestId)).toEqual(["queue-one","queue-two"]);
      expect(JSON.stringify(recovered)).toContain(image.data);
      const file = host.session(chat.info.id).sessionManager.getSessionFile();
      await host.closeSession(chat.address);
      chat = await open(host,chat.info.id);
      expect(host.getSessionSnapshot(chat.address).transcript.records.filter(r=>r.kind === "message" && r.customType === "Cancelled queued prompt")).toHaveLength(2);
      await host.deleteSession(chat.info);
      expect(existsSync(file)).toBe(false);
      const check = new Database(recoveryFile);
      expect(check.query("SELECT count(*) AS count FROM run_diagnostics").get().count).toBe(0);
      check.close();
      console.log("MEASURE queue: 2 distinct IDs, 2 image payloads recovered, 1 invocation, draft preserved, deletion cleared diagnostics");

      chat = await open(host);
      const deliveredGate = Promise.withResolvers(); let deliveredStarted = false;
      faux.setResponses([async () => {deliveredStarted=true;await deliveredGate.promise;return fauxAssistantMessage("first delivered");},fauxAssistantMessage("queued delivered")]);
      await host.prompt(input(chat,"start delivered run")); await wait(()=>deliveredStarted);
      for(const requestId of ["delivered-one","delivered-two"]) await host.prompt(input(chat,"same delivered text",requestId));
      deliveredGate.resolve(); await host.receipts.settled(chat.address);
      const deliveredSession = host.session(chat.info.id);
      deliveredSession._emit({type:"queue_update",steering:[],followUp:["same delivered text","same delivered text"]});
      await host.abort(chat.address);
      expect(host.getSessionSnapshot(chat.address).transcript.records.filter(r=>r.kind === "message" && r.customType === "Cancelled queued prompt")).toHaveLength(0);
      expect(deliveredSession.messages.filter(m=>m.role === "user" && JSON.stringify(m.content).includes("same delivered text"))).toHaveLength(2);
      expect(host.receipts.intents().filter(i=>["delivered-one","delivered-two"].includes(i.receipt.requestId)).every(i=>!i.content)).toBe(true);
      await host.closeSession(chat.address);
      console.log("MEASURE delivered queue: 2 same-text sends delivered, 0 resurrected from stale queue snapshot, payloads released after settle");

      for(const kind of ["input","start","settled"]) {
        chat = await open(host);
        const gate = Promise.withResolvers(); globalThis.__kind=kind;globalThis.__gate=gate.promise;globalThis.__entered=false;
        faux.setResponses([fauxAssistantMessage("late response")]);
        const request = input(chat,"blocked "+kind);
        const pending = host.prompt(request).then(()=>"accepted",()=>"cancelled");
        await wait(()=>globalThis.__entered);
        const session = host.session(chat.info.id);
        const start = performance.now();
        await expect(host.abort(chat.address)).rejects.toThrow("Stop unconfirmed");
        const elapsed = performance.now()-start;
        expect(elapsed).toBeGreaterThanOrEqual(1900); expect(elapsed).toBeLessThan(3500);
        expect(host.runtimeState().sessions.find(s=>s.address.sessionId===chat.info.id).phase).toBe("closing");
        expect(()=>host.prompt(request)).toThrow("STALE");
        await expect(host.openSession({cwd,id:chat.info.id,openId:crypto.randomUUID()})).rejects.toThrow("opening or closing");
        const snapshots = events.filter(e=>e.type === "snapshot").length;
        session._emit({type:"agent_settled",aborted:false});
        expect(events.filter(e=>e.type === "snapshot")).toHaveLength(snapshots);
        globalThis.__kind=undefined; gate.resolve(); await pending;
        await wait(()=>!host.runtimeState().sessions.some(s=>s.address.sessionId===chat.info.id));
        console.log("MEASURE Stop "+kind+": "+Math.round(elapsed)+"ms, late publication rejected");
      }
      for(const kind of ["close","quit"]) {
        const target = kind === "quit" ? makeHost() : host;
        chat = await open(target);
        const gate = Promise.withResolvers();globalThis.__kind="shutdown";globalThis.__gate=gate.promise;globalThis.__entered=false;
        const start = performance.now();
        const closing = kind === "quit" ? target.dispose() : target.closeSession(chat.address);
        await wait(()=>globalThis.__entered); await closing;
        const elapsed=performance.now()-start;
        expect(elapsed).toBeLessThan(3500);
        expect(events.some(e=>e.type === "closed" && e.address.sessionId===chat.info.id && e.message?.includes("Stop unconfirmed"))).toBe(true);
        globalThis.__kind=undefined;gate.resolve();
        await wait(()=>!target.runtimeState().sessions.some(s=>s.address.sessionId===chat.info.id));
        console.log("MEASURE "+kind+": "+Math.round(elapsed)+"ms, shutdown remained unconfirmed until released");
      }
      await host.dispose(); await disposeSessions();
      process.exit(0);
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (stdout) console.log(stdout.trim());
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 45_000);
