import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("real SessionHost separates lost CAS ACK from dispatch and accepts the frozen revision while preserving a newer draft", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-send-recovery-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {join} from "node:path";
      import {fauxProvider, fauxAssistantMessage} from "@earendil-works/pi-ai";
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {modelInfo, disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      import {DraftStore} from ${JSON.stringify(new URL("../mainview/draft-store.ts", import.meta.url).href)};
      import {SendController} from ${JSON.stringify(new URL("../mainview/send-controller.ts", import.meta.url).href)};
      const cwd = ${JSON.stringify(home)};
      const faux = fauxProvider({tokensPerSecond:Infinity, models:[{id:"fixture"}]});
      const renderer = new DraftStore();
      const events = [];
      const host = new SessionHost({modelInfo,recoveryFile:join(cwd,"test.sqlite"),configureModels:m=>m.registerNativeProvider(faux.provider),emit:e=>events.push(e),emitTerminal(){},emitUI(e){
        if(e.type === "draft") renderer.receive(e.address,e.draft);
        if(e.type === "request" && e.request.kind === "project-trust") queueMicrotask(()=>host.resolveExtensionUI({...e.request,kind:"project-trust",value:"once"}));
      }});
      host.connectUI({clientId:"root"});
      const chat = await host.openSession({cwd,openId:"initial"});
      await host.setModel({...chat.address,provider:faux.getModel().provider,id:faux.getModel().id});
      const sdk = host.session(chat.info.id), prompt = sdk.prompt.bind(sdk);
      let invocations = 0;
      sdk.prompt = (...args) => { invocations++; return prompt(...args); };
      renderer.receive(chat.address,host.drafts.read(chat.address));
      renderer.edit(chat.address,()=>({text:"CAS ACK lost",pastes:[],images:[]}));
      let loseAck = true, waitAck = false;
      const entered = Promise.withResolvers(), ack = Promise.withResolvers();
      const sends = new SendController(renderer,{
        syncDraft:async input=>{
          const result=host.syncDraft(input);
          if(loseAck){loseAck=false;throw new Error("saved CAS ACK dropped");}
          if(waitAck){entered.resolve(result);await ack.promise;}
          return result;
        },
        prompt:async input=>{await host.prompt(input);throw new Error("prompt accepted; reply dropped");},
        getPromptReceipt:async key=>host.getPromptReceipt(key)
      },()=>{});
      await sends.send(chat.address);
      const prepared = sends.read(chat.address);
      expect(invocations).toBe(0);
      expect(prepared.state).toBe("unknown");
      expect(host.getPromptReceipt(prepared.key)).toMatchObject({state:"pending",stage:"prepared"});
      await host.abort(chat.address);
      const original = {text:"[paste #1 6 chars]",pastes:[{id:"p",marker:"[paste #1 6 chars]",text:"frozen"}],images:[]};
      renderer.edit(chat.address,()=>original);
      waitAck = true;
      faux.setResponses([fauxAssistantMessage("answer")]);
      const sending=sends.send(chat.address);
      const sent = await entered.promise;
      renderer.edit(chat.address,()=>({text:"newer draft",pastes:[],images:[]}));
      host.syncDraft({...chat.address,expectedRevision:sent.draft.revision,content:renderer.read(chat.address).content});
      ack.resolve();
      await sending;
      await host.receipts.settled();
      expect(invocations).toBe(1);
      expect(sends.read(chat.address).state).toBe("accepted");
      expect(host.drafts.read(chat.address).text).toBe("newer draft");
      expect(renderer.read(chat.address).content.text).toBe("newer draft");
      const users=host.getSessionSnapshot(chat.address).transcript.records.filter(r=>r.kind === "message" && r.message.role === "user");
      expect(users).toHaveLength(1);
      expect(JSON.stringify(users[0].message.content)).toContain("frozen");
      expect(JSON.stringify(users[0].message.content)).not.toContain("newer draft");
      sdk.settingsManager.setProjectTrusted(false);
      expect(host.runtimeState().sendIntents).toHaveLength(0);
      sdk.settingsManager.setProjectTrusted(true);
      expect(host.runtimeState().sendIntents).not.toHaveLength(0);
      await host.deleteSession(chat.info);
      expect(host.runtimeState().sendIntents).toHaveLength(0);
      expect(events.some(e=>e.type === "closed" && e.discardDraft)).toBe(true);
      await host.dispose(); await disposeSessions();
      console.log(JSON.stringify({preparedSdkInvocations:0,dispatchedSdkInvocations:invocations,lostReplies:2,newDraftRetained:true}));
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
    expect(code, stdout + stderr).toBe(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);
