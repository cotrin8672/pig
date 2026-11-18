import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("branch answers independently while the source streams and retains its queue and draft", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-session-fork-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {fauxProvider,fauxAssistantMessage} from "@earendil-works/pi-ai";
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {modelInfo,disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      const cwd = ${JSON.stringify(home)};
      const faux = fauxProvider({tokensPerSecond:Infinity,models:[{id:"fixture"}]});
      const model = faux.getModel();
      const events = [];
      const release = Promise.withResolvers();
      const host = new SessionHost({modelInfo,configureModels:m=>m.registerNativeProvider(faux.provider),emit:e=>events.push(e),emitUI(){},emitTerminal(){}});
      try {
        const {address:source} = await host.openSession({cwd,openId:"source"});
        const sdk = host.session(source.sessionId);
        const reply = text => fauxAssistantMessage(text,{model:model.id,provider:model.provider});
        const messages = address => host.getSessionSnapshot(address).transcript.records.filter(r=>r.kind==="message");
        const draft = (address,text,requestId,delivery) => host.syncDraft({...address,requestId,delivery,expectedRevision:host.drafts.read(address).revision,content:{text,pastes:[],images:[]}}).draft;
        const send = (address,text,requestId,delivery) => host.prompt({...address,text,requestId,delivery,draftRevision:draft(address,text,requestId,delivery).revision});
        await host.setModel({...source,provider:model.provider,id:model.id});
        faux.setResponses([reply("common answer")]);
        await send(source,"common question","first");
        await host.receipts.settled(source);
        const target = messages(source).find(r=>r.message.role==="assistant");
        const entered = Promise.withResolvers();
        faux.setResponses([async () => {entered.resolve(); await release.promise; return reply("SOURCE_DONE");},reply("BRANCH_DONE"),reply("QUEUE_DONE")]);
        await send(source,"source only question","second");
        await entered.promise;
        const queued = send(source,"source queued question","queued","followUp");
        const key = {...source,requestId:"queued"};
        for(let i=0;host.getPromptReceipt(key).stage!=="queued";i++) {
          if(i===500) throw new Error("Follow-up was not queued");
          await Bun.sleep(5);
        }
        draft(source,"source unsent draft");
        const branch = await host.forkSession({...source,entryId:target.entryId});
        expect(branch.address.sessionId).not.toBe(source.sessionId);
        expect(host.session(source.sessionId)).toBe(sdk);
        expect(sdk.isStreaming).toBe(true);
        expect(messages(branch.address).map(r=>r.entryId)).toEqual(messages(source).slice(0,2).map(r=>r.entryId));
        expect(host.drafts.read(source).text).toBe("source unsent draft");
        expect(host.drafts.read(branch.address).text).toBe("");
        expect(host.getPromptReceipt(key)).toMatchObject({state:"pending",stage:"queued"});
        expect(events.some(e=>e.type==="replaced" || e.type==="closed")).toBe(false);
        await send(branch.address,"branch only question","branch");
        await host.receipts.settled(branch.address);
        expect(JSON.stringify(messages(branch.address))).toContain("BRANCH_DONE");
        expect(sdk.isStreaming).toBe(true);
        release.resolve();
        expect(await queued).toEqual({disposition:"started"});
        await host.receipts.settled(source);
        await sdk.waitForIdle();
        expect(JSON.stringify(messages(source))).toContain("SOURCE_DONE");
        expect(JSON.stringify(messages(source))).toContain("QUEUE_DONE");
        expect(JSON.stringify(messages(source))).not.toContain("branch only question");
        expect(JSON.stringify(messages(branch.address))).not.toContain("source only question");
        expect(host.drafts.read(source).text).toBe("source unsent draft");
      } finally {
        release.resolve();
        await host.dispose();
        await disposeSessions();
      }
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
