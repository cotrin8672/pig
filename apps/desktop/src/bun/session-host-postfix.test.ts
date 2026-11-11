import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extension = `export default function(pi) {
  pi.on("session_shutdown", async (event) => {
    globalThis.__shutdown.push(event.reason);
    if (globalThis.__holdShutdown) { globalThis.__shutdownEntered = true; await globalThis.__shutdownGate; }
  });
  pi.registerCommand("fixture-new", {handler: async (_args, ctx) => {await ctx.newSession();}});
  pi.registerCommand("fixture-switch", {handler: async (path, ctx) => {await ctx.switchSession(path);}});
}`;

test("F1/F2: target selection, metadata-only restore, transitions reject sends and cancellation closes dead runtimes", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-postfix-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {mkdir,writeFile} from "node:fs/promises";
      import {join} from "node:path";
      import {fauxProvider,fauxAssistantMessage} from "@earendil-works/pi-ai";
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {SessionManager} from ${JSON.stringify(new URL("./sdk.ts", import.meta.url).href)};
      import {modelInfo,disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      const cwd = ${JSON.stringify(home)};
      await mkdir(join(cwd,".pi/extensions"),{recursive:true});
      await writeFile(join(cwd,".pi/extensions/fixture.ts"),${JSON.stringify(extension)});
      const faux = fauxProvider({tokensPerSecond:Infinity,models:[{id:"a",reasoning:true},{id:"b",reasoning:true}]});
      globalThis.__shutdown = [];
      let hidden = [], trust = "once", waitingTrust;
      const events = [];
      const host = new SessionHost({modelInfo,disabled:()=>hidden,configureModels:m=>{m.registerNativeProvider(faux.provider);},emit:e=>events.push(e),emitTerminal(){},emitUI(e){
        if(e.type === "request" && e.request.kind === "project-trust") {
          if(trust === "hold") {waitingTrust = e.request; return;}
          queueMicrotask(()=>host.resolveExtensionUI({...e.request,kind:"project-trust",value:trust}));
        }
      }});
      host.connectUI({clientId:"root"});
      const A = faux.getModel("a"), B = faux.getModel("b");
      const assertB = snapshot => {expect(snapshot.model.id).toBe("b");expect(snapshot.effort).toBe("high");};
      const send = async (chat,text) => {
        faux.setResponses([fauxAssistantMessage(text,{model:"b",provider:B.provider})]);
        const accepted = await host.prompt({...chat.address,text,requestId:crypto.randomUUID(),draftRevision:host.drafts.read(chat.address).revision});
        await host.receipts.settled(); return accepted;
      };
      let chat = await host.openSession({cwd,openId:"first"});
      await host.setModel({...chat.address,provider:B.provider,id:B.id}); await host.setEffort({...chat.address,effort:"high"});
      await send(chat,"answer");
      chat = host.getSessionSnapshot(chat.address);
      const answer = chat.transcript.records.find(r=>r.kind === "message" && r.message.role === "assistant");
      // Do not call setModel after fork: that masked the original restore bug.
      chat = await host.forkSession({...chat.address,entryId:answer.entryId}); assertB(chat);
      const persistedId = chat.info.id;
      await host.closeSession(chat.address);
      chat = await host.openSession({cwd,id:persistedId,openId:"reopen"}); assertB(chat);
      const metadata = SessionManager.create(cwd);
      metadata.appendModelChange(B.provider,"b"); metadata.appendThinkingLevelChange("high"); metadata.appendSessionInfo("metadata-only");
      const metadataPath = metadata.getSessionFile();
      // SDK delays its initial file until an assistant exists; explicitly persist
      // a metadata-only SDK JSONL fixture without a synthetic model message.
      await mkdir(metadata.getSessionDir(),{recursive:true});
      await writeFile(metadataPath,[metadata.getHeader(),...metadata.getEntries()].map(e=>JSON.stringify(e)).join("\\n")+"\\n");
      expect(await send(chat,"/fixture-switch " + metadataPath)).toEqual({disposition:"handled"});
      chat = host.runtimeState().sessions.find(s=>s.phase === "ready").snapshot; assertB(chat);
      expect(chat.info.title).toBe("metadata-only"); expect(chat.transcript.records.filter(r=>r.kind === "message")).toHaveLength(0);
      // New from an originally reopened session still obeys hidden models.
      hidden = [A.provider + "/" + A.id];
      expect(await send(chat,"/fixture-new")).toEqual({disposition:"handled"});
      chat = host.runtimeState().sessions.find(s=>s.phase === "ready").snapshot; expect(chat.model.id).toBe("b");
      hidden = [];
      await host.setEffort({...chat.address,effort:"high"}); await send(chat,"transition answer");
      chat = host.getSessionSnapshot(chat.address);
      // Gate shutdown before any SDK invalidation: prompt/draft/model mutation
      // must fail synchronously, while read-only receipts and Stop remain usable.
      for (const kind of ["reload","fork","new","switch"]) {
        const gate = Promise.withResolvers(); globalThis.__holdShutdown = true; globalThis.__shutdownEntered = false; globalThis.__shutdownGate = gate.promise;
        const prior = chat.address;
        const target = chat.transcript.records.find(r=>r.kind === "message" && r.message.role === "assistant");
        const operation = kind === "reload" ? host.reloadSession(prior) : kind === "fork" ? host.forkSession({...prior,entryId:target.entryId}) : send(chat,kind === "new" ? "/fixture-new" : "/fixture-switch " + metadataPath);
        while(!globalThis.__shutdownEntered) await Bun.sleep(1);
        expect(()=>host.prompt({...prior,text:"must not execute",requestId:"during-"+kind,draftRevision:host.drafts.read(prior).revision})).toThrow("STALE");
        expect(()=>host.syncDraft({...prior,expectedRevision:host.drafts.read(prior).revision,content:{text:"blocked",pastes:[],images:[]}})).toThrow("STALE");
        await expect(host.setModel({...prior,provider:A.provider,id:A.id})).rejects.toThrow("STALE");
        expect(host.getPromptReceipt({...prior,requestId:"during-"+kind}).state).toBe("unknown");
        globalThis.__holdShutdown = false; gate.resolve(); await operation;
        chat = host.runtimeState().sessions.find(s=>s.phase === "ready").snapshot;
        await send(chat,"next answer"); chat = host.getSessionSnapshot(chat.address);
      }
      // R2: changed fingerprint forces Trust AFTER old fork runtime teardown.
      await writeFile(join(cwd,".pi/SYSTEM.md"),"changed trust fingerprint"); trust = "hold";
      const before = chat.address;
      const target = chat.transcript.records.find(r=>r.kind === "message" && r.message.role === "assistant");
      const failed = host.forkSession({...before,entryId:target.entryId}).then(()=>"ready",()=>"failed");
      while(!waitingTrust) await Bun.sleep(1);
      expect(()=>host.prompt({...before,text:"during trust",requestId:"trust-send",draftRevision:0})).toThrow("STALE");
      // Cancellation reply must be accepted even though prompt mutations are blocked.
      host.resolveExtensionUI({...waitingTrust,kind:"cancel"});
      expect(await failed).toBe("failed");
      while(host.runtimeState().sessions.length) await Bun.sleep(1);
      expect(events.some(e=>e.type === "closed" && e.reason === "failed")).toBe(true);
      // The disposed old runtime already emitted fork shutdown; no fake quit replay.
      expect(globalThis.__shutdown.at(-1)).toBe("fork");
      trust = "once"; waitingTrust = undefined;
      chat = await host.openSession({cwd,openId:"after-failure"});
      const gate = Promise.withResolvers(); globalThis.__holdShutdown = true; globalThis.__shutdownEntered = false; globalThis.__shutdownGate = gate.promise;
      const cancelled = host.reloadSession(chat.address).then(()=>"ready",()=>"failed");
      while(!globalThis.__shutdownEntered) await Bun.sleep(1);
      const stopping = host.abort(chat.address);
      globalThis.__holdShutdown = false; gate.resolve(); await stopping;
      expect(await cancelled).toBe("failed");
      while(host.runtimeState().sessions.length) await Bun.sleep(1);
      // Host wiring: dead renderer cancels startup native and actual terminal
      // UI without a native hook or cooperative disconnect message.
      await writeFile(join(cwd,".pi/extensions/lease.ts"), 'export default function(pi){pi.on("session_start",async (_e,ctx)=>{if(globalThis.__leaseMode === "native") await ctx.ui.confirm("Lease","Wait"); else await ctx.ui.custom(()=>({render:()=>["Wait"]}));});}');
      let clock = 0;
      const leaseHost = new SessionHost({modelInfo,connectionNow:()=>clock,configureModels:m=>m.registerNativeProvider(faux.provider),emit(){},emitTerminal(){},emitUI(e){if(e.type === "request" && e.request.kind === "project-trust") queueMicrotask(()=>leaseHost.resolveExtensionUI({...e.request,kind:"project-trust",value:"once"}));}});
      for (const mode of ["native","terminal"]) {
        globalThis.__leaseMode = mode; leaseHost.connectUI({clientId:mode});
        const opening = leaseHost.openSession({cwd,openId:"lease-"+mode}).then(()=>"ready",()=>"cancelled");
        for(let attempt=0;!leaseHost.broker.pending().some(r=>r.kind === (mode === "native" ? "confirm" : "terminal"));attempt++) {if(attempt>2000) throw new Error("No lease startup UI " + mode + " " + JSON.stringify(leaseHost.getOpenState({openId:"lease-"+mode}))); await Bun.sleep(1);}
        clock += 30001;
        expect(leaseHost.heartbeatUI({clientId:mode})).toEqual({connected:false});
        expect(await opening).toBe("cancelled"); expect(leaseHost.broker.pending()).toEqual([]);
        expect(leaseHost.runtimeState().sessions).toEqual([]);
      }
      await leaseHost.dispose();
      await host.dispose(); await disposeSessions();
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
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 60_000);
