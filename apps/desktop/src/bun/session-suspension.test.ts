import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("isolated SDK: idle suspension, cold drafts/history, single-flight wake and startup failure", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-suspension-"));
  try {
    const script = `
      import {expect, spyOn} from "bun:test";
      import * as sessionFiles from ${JSON.stringify(new URL("./session-files.ts", import.meta.url).href)};
      import {mkdir, writeFile, readFile, stat, utimes} from "node:fs/promises";
      import {join} from "node:path";
      import {fauxProvider, fauxAssistantMessage} from "@earendil-works/pi-ai";
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {SessionManager} from ${JSON.stringify(new URL("./sdk.ts", import.meta.url).href)};
      import {modelInfo, disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      import {RUNTIME_IDLE_MS} from ${JSON.stringify(new URL("../shared/runtime-contract.ts", import.meta.url).href)};
      const cwd = ${JSON.stringify(home)};
      const faux = fauxProvider({tokensPerSecond:Infinity,models:[{id:"fixture",input:["text"]}]});
      let now = 0, starts = 0, requests = 0, failStartup = false;
      let startupGate;
      const events = [];
      const host = new SessionHost({
        modelInfo, idleNow:()=>now,
        historyModel:()=>modelInfo(faux.getModel()),
        configureModels:async models => {
          starts++;
          if(startupGate) await startupGate.promise;
          if(failStartup) throw new Error("startup failure fixture");
          models.registerNativeProvider(faux.provider);
        },
        emit:event=>events.push(event), emitTerminal() {},
        emitUI:event=>{
          if(event.type==="request" && event.request.kind==="project-trust")
            queueMicrotask(()=>host.resolveExtensionUI({...event.request,kind:"project-trust",value:"once"}));
        }
      });
      const usage = (protectedChats=[])=>({sequence:++sequence,protected:protectedChats});
      let sequence=0;
      const heartbeat=(protectedChats=[])=>host.heartbeatUI({clientId:"root",usage:usage(protectedChats)});
      host.connectUI({clientId:"root",usage:usage()});
      let chat = await host.openSession({cwd,openId:"initial"});
      await host.setModel({...chat.address,provider:faux.getModel().provider,id:faux.getModel().id});
      faux.setResponses([()=>{requests++;return fauxAssistantMessage("saved answer");}]);
      await host.prompt({...chat.address,requestId:"first",text:"first question",draftRevision:0});
      await host.receipts.settled();
      const id=chat.address.sessionId;
      const file=host.session(id).sessionManager.getSessionFile();
      const releasedSession=new WeakRef(host.session(id));
      const releasedManager=new WeakRef(host.session(id).sessionManager);
      chat=host.getSessionSnapshot(chat.address);
      const revision=chat.transcript.history.revision;
      const initialAddress=chat.address;
      // Every Pane/Root protects use, irrespective of focus.
      heartbeat([chat.address]);
      await host.suspendIdle(); now+=RUNTIME_IDLE_MS; heartbeat([chat.address]);
      expect(await host.suspendIdle()).toBe(0);
      host.connectUI({clientId:"other",usage:usage([chat.address])});
      heartbeat();
      expect(await host.suspendIdle()).toBe(0);
      host.disconnectUI({clientId:"other"});
      // Nonempty drafts also protect invisible runtimes.
      let draft=host.getSessionDraft(chat.address);
      host.syncDraft({...chat.address,expectedRevision:draft.revision,content:{text:"unsent",pastes:[],images:[]}});
      now+=RUNTIME_IDLE_MS;heartbeat();expect(await host.suspendIdle()).toBe(0);
      draft=host.getSessionDraft(chat.address);
      host.syncDraft({...chat.address,expectedRevision:draft.revision,content:{text:"",pastes:[],images:[]}});
      heartbeat();expect(await host.suspendIdle()).toBe(0);
      now+=RUNTIME_IDLE_MS-1;heartbeat();expect(await host.suspendIdle()).toBe(0);
      now++;heartbeat();expect(await host.suspendIdle()).toBe(1);
      let row=host.runtimeState().sessions.find(item=>item.address.sessionId===id);
      expect(row.phase).toBe("ready");expect(row.snapshot).toBeUndefined();
      expect(row.suspended).toBeDefined();expect(row.address.epoch).toBeGreaterThan(initialAddress.epoch);
      expect(()=>host.session(id)).toThrow();
      for(let i=0;i<8;i++){await Bun.sleep(0);Bun.gc(true);}
      expect(releasedSession.deref()).toBeUndefined();
      expect(releasedManager.deref()).toBeUndefined();
      let cold=await host.readSessionSnapshot(row.address);
      expect(cold.suspended).toBe(true);
      expect(cold.transcript.history.revision).toBe(revision);
      expect(JSON.stringify(cold.transcript)).toContain("saved answer");
      expect(host.listSlashCommands(cold.address)).toEqual([]);
      expect(starts).toBe(1);expect(requests).toBe(1);
      draft=host.getSessionDraft(cold.address);
      host.syncDraft({...cold.address,expectedRevision:draft.revision,content:{text:"cold draft",pastes:[],images:[]}});
      const coldAddress=cold.address;
      const retiredHistory=host.histories.get(id);
      const replies=await Promise.all([host.wakeSession(coldAddress),host.wakeSession(coldAddress)]);
      chat=replies[0];
      expect(starts).toBe(2);expect(requests).toBe(1);
      expect(chat.address).toEqual(coldAddress);
      expect(chat.suspended).toBeUndefined();
      expect((await host.historySnapshot(retiredHistory)).suspended).toBeUndefined();
      expect(host.getSessionDraft(chat.address).text).toBe("cold draft");
      expect(()=>host.getSessionSnapshot(initialAddress)).toThrow("STALE");
      // Extensions do not veto suspension; the SDK shuts them down officially.
      await mkdir(join(cwd,".pi/extensions"),{recursive:true});
      await writeFile(join(cwd,".pi/extensions/shutdown-probe.ts"),'export default pi => pi.on("session_shutdown",()=>{globalThis.__shutdowns=(globalThis.__shutdowns??0)+1;});');
      const pkg=join(cwd,".pi/extensions/subagents");
      await mkdir(pkg,{recursive:true});
      await writeFile(join(pkg,"package.json"),JSON.stringify({name:"pi-subagent",pi:{extensions:["index.ts"]}}));
      await writeFile(join(pkg,"index.ts"), 'export default pi => { let parentId; let status="starting"; pi.registerCommand("agents",{handler:()=>{}}); pi.on("session_start",(_e,ctx)=>{parentId=ctx.sessionManager.getSessionId(); globalThis.__finishChild=()=>{status="completed";pi.events.emit("pig:subagents:changed",{parentId});};}); pi.events.on("pig:subagents:snapshot",q=>{if(q.parentId===parentId)q.reply([{agent_id:"a",task_name:"Review",run_id:"r",status}]);}); }');
      await host.reloadSession(chat.address);
      chat=host.runtimeState().sessions.find(item=>item.address.sessionId===id).snapshot;
      draft=host.getSessionDraft(chat.address);
      host.syncDraft({...chat.address,expectedRevision:draft.revision,content:{text:"",pastes:[],images:[]}});
      // The initial public-bus snapshot pins a starting child even if the parent is idle.
      const nativeView=()=>host.getSessionSnapshot(chat.address).sessionUI.views.find(e=>e.view.source.label==="pi-subagent");
      expect(nativeView().view.runs[0].state.phase).toBe("queued");
      heartbeat();await host.suspendIdle();now+=RUNTIME_IDLE_MS;heartbeat();
      expect(await host.suspendIdle()).toBe(0);
      globalThis.__finishChild();
      expect(nativeView().view.runs[0].state.outcome).toBe("success");
      const shutdownsBefore=globalThis.__shutdowns??0;
      heartbeat();await host.suspendIdle();now+=RUNTIME_IDLE_MS;heartbeat();
      expect(await host.suspendIdle()).toBe(1);
      expect(globalThis.__shutdowns).toBe(shutdownsBefore+1);
      // A package update skips sleeping tabs; they discover new extensions on wake.
      await writeFile(join(cwd,".pi/extensions/reload-probe.ts"),'export default pi => pi.registerCommand("reload-probe",{handler:async()=>{}});');
      expect(await host.reloadPackageExtensions()).toEqual([]);
      expect(()=>host.session(id)).toThrow("Chat is not open");
      chat=await host.wakeSession(host.runtimeState().sessions.find(item=>item.address.sessionId===id).address);
      expect(host.listSlashCommands(chat.address).some(command=>command.name==="reload-probe")).toBe(true);
      await host.closeSession(chat.address);
      // A live open wins while the browser is reading the same history file.
      const reading=Promise.withResolvers(), resumeRead=Promise.withResolvers();
      const readHistory=sessionFiles.readSessionFile;
      const spy=spyOn(sessionFiles,"readSessionFile").mockImplementationOnce(async (...args)=>{
        const result=await readHistory(...args);
        reading.resolve();await resumeRead.promise;return result;
      });
      const browsing=host.openSession({cwd,id,openId:"racing-browser",historyOnly:true});
      await reading.promise;
      let live;
      try {
        live=await host.openSession({cwd,id,openId:"racing-live"});
      } finally {
        resumeRead.resolve();spy.mockRestore();
      }
      const browsed=await browsing;
      expect(browsed.address).toEqual(live.address);
      expect(browsed.suspended).toBeUndefined();
      expect(events.filter(e=>e.type==="ready" && e.openId==="racing-browser")).toHaveLength(0);
      await host.closeSession(live.address);
      // If the winner is still starting, the history open must not report a ready result.
      const readingSlow=Promise.withResolvers(), resumeSlow=Promise.withResolvers();
      const slowSpy=spyOn(sessionFiles,"readSessionFile").mockImplementationOnce(async (...args)=>{
        const result=await readHistory(...args);
        readingSlow.resolve();await resumeSlow.promise;return result;
      });
      const slowBrowse=host.openSession({cwd,id,openId:"racing-slow-browser",historyOnly:true});
      await readingSlow.promise;
      startupGate=Promise.withResolvers();
      const slowLive=host.openSession({cwd,id,openId:"racing-slow-live"});
      try {
        while(host.getOpenState({openId:"racing-slow-live"}).state==="unknown") await Bun.sleep(1);
        expect(host.getOpenState({openId:"racing-slow-live"}).state).toBe("opening");
        resumeSlow.resolve();
        await expect(slowBrowse).rejects.toThrow("already opening or closing");
        expect((await host.readOpenState({openId:"racing-slow-browser"})).state).toBe("failed");
      } finally {
        resumeSlow.resolve();slowSpy.mockRestore();startupGate.resolve();startupGate=undefined;
      }
      await host.closeSession((await slowLive).address);
      // Browsing starts no SDK and changes no history file.
      const before=await readFile(file,"utf8");
      const priorStarts=starts;
      const findById=SessionManager.findById;
      let lookups=0;
      SessionManager.findById=(...args)=>{lookups++;return findById.apply(SessionManager,args);};
      cold=await host.openSession({cwd,id,openId:"history",historyOnly:true});
      expect(lookups).toBe(1);
      expect(cold.suspended).toBe(true);expect(cold.ready).toBeUndefined();
      expect(starts).toBe(priorStarts);expect(await readFile(file,"utf8")).toBe(before);
      expect((await host.readOpenState({openId:"history"})).state).toBe("ready");
      expect((await host.openSession({cwd,id,openId:"history",historyOnly:true})).address).toEqual(cold.address);
      const stamp=await stat(file),previousRevision=cold.transcript.history.revision;
      const cursor={...cold.address,revision:previousRevision,before:cold.transcript.records.at(-1).entryId};
      lookups=0;
      const [page,samePage]=await Promise.all([
        host.getSessionHistory(cursor),host.getSessionHistory({...cursor}),
      ]);
      expect(JSON.stringify(page)).toContain("first question");
      expect(samePage).toEqual(page);
      expect(lookups).toBe(1);
      await writeFile(file,before.replace("saved answer","other answer"));
      await utimes(file,stamp.atime,stamp.mtime);
      const rejected=await Promise.allSettled([
        host.getSessionHistory(cursor),host.getSessionHistory(cursor),
      ]);
      expect(rejected.map(r=>r.status==="rejected"&&r.reason.message)).toEqual([
        "STALE_HISTORY_CURSOR","STALE_HISTORY_CURSOR",
      ]);
      expect(lookups).toBe(2);
      await writeFile(file,before);
      await utimes(file,stamp.atime,stamp.mtime);
      expect(await host.getSessionHistory(cursor)).toEqual(page);
      expect(lookups).toBe(3);
      SessionManager.findById=findById;
      await writeFile(file,before.replace("saved answer","other answer"));
      await utimes(file,stamp.atime,stamp.mtime);
      await expect(host.wakeSession(cold.address)).rejects.toThrow("History changed externally");
      expect(starts).toBe(priorStarts);
      cold=await host.readSessionSnapshot(cold.address);
      expect(cold.transcript.history.revision).not.toBe(previousRevision);
      expect(JSON.stringify(cold.transcript)).toContain("other answer");
      draft=host.getSessionDraft(cold.address);
      host.syncDraft({...cold.address,expectedRevision:draft.revision,content:{text:"preserve on failure",pastes:[],images:[]}});
      failStartup=true;
      await expect(host.wakeSession(cold.address)).rejects.toThrow("startup failure");
      expect(host.getSessionDraft(cold.address).text).toBe("preserve on failure");
      expect((await host.readSessionSnapshot(cold.address)).suspended).toBe(true);
      expect(requests).toBe(1);
      failStartup=false;
      // Close during startup cannot resurrect the cold handle.
      startupGate=Promise.withResolvers();
      const waking=host.wakeSession(cold.address).catch(()=>{});
      while(starts===priorStarts+1) await Bun.sleep(1);
      const duringWake=await host.openSession({cwd,id,openId:"browse-during-wake",historyOnly:true});
      expect(duringWake.suspended).toBe(true);
      expect(duringWake.ready).toBeUndefined();
      const closing=host.closeSession(cold.address);
      startupGate.resolve();await waking;await closing;
      expect(host.runtimeState().sessions).toHaveLength(0);
      expect(requests).toBe(1);
      cold=await host.openSession({cwd,id,openId:"delete-cold",historyOnly:true});
      const deletingStarts=starts;
      await host.deleteSession(cold.info);
      expect(host.runtimeState().sessions).toHaveLength(0);
      expect(starts).toBe(deletingStarts);
      await host.dispose();await disposeSessions();
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        PI_CODING_AGENT_DIR: join(home, "agent"),
        PI_CODING_AGENT_SESSION_DIR: join(home, "sessions"),
        PI_OFFLINE: "1",
      },
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
}, 30_000);

test("isolated SDK: approvals, receipts, slow/failed shutdown and Close races never dispatch or resurrect", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-suspension-races-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {join} from "node:path";
      import {fauxProvider,fauxAssistantMessage} from "@earendil-works/pi-ai";
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {modelInfo,disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      import {RUNTIME_IDLE_MS} from ${JSON.stringify(new URL("../shared/runtime-contract.ts", import.meta.url).href)};
      const cwd=${JSON.stringify(home)},faux=fauxProvider({tokensPerSecond:Infinity,models:[{id:"fixture"}]});
      let now=0,starts=0,calls=0,sequence=0;
      const events=[],notices=[];
      const host=new SessionHost({modelInfo,idleNow:()=>now,configureModels:models=>{starts++;models.registerNativeProvider(faux.provider);},
        emit:event=>events.push(event),emitUI:event=>notices.push(event),emitTerminal(){}});
      const heartbeat=()=>host.heartbeatUI({clientId:"root",usage:{sequence:++sequence,protected:[]}});
      host.connectUI({clientId:"root",usage:{sequence:sequence,protected:[]}});
      let chat=await host.openSession({cwd,openId:"first"});
      await host.setModel({...chat.address,provider:faux.getModel().provider,id:faux.getModel().id});
      faux.setResponses([()=>{calls++;return fauxAssistantMessage("answer");}]);
      await host.prompt({...chat.address,text:"question",requestId:"first",draftRevision:0});await host.receipts.settled();
      const id=chat.address.sessionId;
      const request={...chat.address,uiId:"approval",kind:"confirm",title:"Approval",message:"Wait"};
      const approval=host.broker.request(request);
      heartbeat();await host.suspendIdle();now+=RUNTIME_IDLE_MS;heartbeat();expect(await host.suspendIdle()).toBe(0);
      host.resolveExtensionUI({...request,value:true});await approval;
      let draft=host.getSessionDraft(chat.address);
      host.syncDraft({...chat.address,requestId:"prepared",expectedRevision:draft.revision,content:{text:"held",pastes:[],images:[]}});
      draft=host.getSessionDraft(chat.address);
      host.syncDraft({...chat.address,expectedRevision:draft.revision,content:{text:"",pastes:[],images:[]}});
      heartbeat();await host.suspendIdle();now+=RUNTIME_IDLE_MS;heartbeat();expect(await host.suspendIdle()).toBe(0);
      host.cancelPrompt({...chat.address,requestId:"prepared"});
      heartbeat();await host.suspendIdle();now+=RUNTIME_IDLE_MS;heartbeat();
      let managed=host.sessions.get(id),gate=Promise.withResolvers(),entered=false;
      const oldSession=host.session(id),dispose=managed.runtime.dispose.bind(managed.runtime);
      managed.runtime.dispose=async()=>{entered=true;await gate.promise;return dispose();};
      const sleeping=host.suspendIdle();while(!entered)await Bun.sleep(1);
      expect(host.runtimeState().sessions.find(row=>row.address.sessionId===id).suspended).toBeUndefined();
      const waking=host.wakeSession(chat.address);
      await Bun.sleep(1);expect(starts).toBe(1);expect(calls).toBe(1);
      gate.resolve();expect(await sleeping).toBe(1);chat=await waking;
      expect(starts).toBe(2);expect(calls).toBe(1);
      expect(()=>oldSession.agent.prompt({role:"user",content:"never",timestamp:0})).toThrow();
      // Cleanup failure is not successful suspension and must not start another SDK.
      managed=host.sessions.get(id);
      const realDispose=managed.runtime.dispose.bind(managed.runtime);
      managed.runtime.dispose=async()=>{throw new Error("cleanup failure fixture");};
      heartbeat();await host.suspendIdle();now+=RUNTIME_IDLE_MS;heartbeat();
      expect(await host.suspendIdle()).toBe(0);
      await expect(host.wakeSession(chat.address)).rejects.toThrow("suspension failed");
      expect(starts).toBe(2);expect(notices.some(event=>event.type==="notify"&&event.level==="error")).toBe(true);
      managed.runtime.dispose=realDispose;
      await host.closeSession(chat.address);
      chat=await host.openSession({cwd,id,openId:"again"});
      managed=host.sessions.get(id);gate=Promise.withResolvers();entered=false;
      const closingDispose=managed.runtime.dispose.bind(managed.runtime);
      managed.runtime.dispose=async()=>{entered=true;await gate.promise;return closingDispose();};
      heartbeat();await host.suspendIdle();now+=RUNTIME_IDLE_MS;heartbeat();
      const parking=host.suspendIdle();while(!entered)await Bun.sleep(1);
      const closing=host.closeSession(chat.address);
      gate.resolve();await parking;await closing;
      expect(host.runtimeState().sessions).toHaveLength(0);
      expect(events.filter(event=>event.type==="suspended")).toHaveLength(1);
      expect(calls).toBe(1);
      await host.dispose();await disposeSessions();
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        PI_CODING_AGENT_DIR: join(home, "agent"),
        PI_CODING_AGENT_SESSION_DIR: join(home, "sessions"),
        PI_OFFLINE: "1",
      },
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
}, 30_000);
