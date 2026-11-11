import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extension = `export default function(pi) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "rpc") throw new Error("Expected rpc extension mode, received " + ctx.mode);
    globalThis.__starts++;
    await ctx.ui.confirm("Startup", "Ready?");
    globalThis.__customValue = await ctx.ui.custom((_tui, _theme, _keys, done) => {
      queueMicrotask(() => done({token: Symbol("Bun-only")}));
      return {render: () => ["SDK startup custom"], dispose() {globalThis.__customDisposed = (globalThis.__customDisposed ?? 0) + 1;}};
    });
    ctx.ui.setEditorText("extension draft");
    ctx.ui.setStatus("fixture", "ready");
    pi.appendEntry("fixture", {saved: true});
  });
  pi.on("session_shutdown", (event) => {globalThis.__shutdown.push(event.reason);});
  pi.registerCommand("boom", {description: "Fixture error", handler: async () => {throw new Error("command failure fixture");}});
  pi.registerCommand("complete", {description:"Complete fixture", getArgumentCompletions: async prefix => [{value:prefix + "-value", label:prefix, description:"result"}], handler: async () => {}});
  pi.registerCommand("dupe", {description:"first", handler: async () => {}});
  pi.on("input", async (event) => {if(event.text === "slow-input") {globalThis.__inputStarted = true; await globalThis.__inputGate;}});
  pi.on("before_agent_start", async (event) => {if(event.messageType === "user" && event.prompt === "slow-start") {globalThis.__startStarted = true; await globalThis.__startGate;}});
  pi.on("agent_settled", async () => {if(globalThis.__holdSettled) {globalThis.__settling = true; await globalThis.__settledGate;}});
  pi.on("tool_call", (event) => {if(globalThis.__denyWrites && event.toolName === "write") return {block: true, reason: "fixture permission denied"};});
}`;

test("SDK fork/rewind/reload/shutdown, root startup UI and stale epochs", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-sdk-lifecycle-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {mkdir, writeFile, readFile} from "node:fs/promises";
      import {existsSync} from "node:fs";
      import {join} from "node:path";
      import {fauxProvider, fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
      import {defaultSettings} from ${JSON.stringify(new URL("../shared/settings.ts", import.meta.url).href)};
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {modelInfo, disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      import {DesktopStateStore} from ${JSON.stringify(new URL("./desktop-state.ts", import.meta.url).href)};
      const cwd = ${JSON.stringify(home)};
      globalThis.__shutdown = []; globalThis.__starts = 0;
      await mkdir(join(cwd, ".pi/extensions"), {recursive:true});
      await writeFile(join(cwd, ".pi/extensions/fixture.ts"), ${JSON.stringify(extension)});
      const faux = fauxProvider({tokensPerSecond: Infinity, models:[{id:"fixture", input:["text","image"]}]});
      await writeFile(join(cwd, ".pi/extensions/second.ts"), 'export default pi => pi.registerCommand("dupe", {description:"second", handler: async () => {}})');
      await mkdir(join(cwd, ".pi/skills/example"), {recursive:true});
      await writeFile(join(cwd, ".pi/skills/example/SKILL.md"), '---\\nname: example\\ndescription: Example skill\\n---\\nSkill body');
      await mkdir(join(cwd, ".pi/prompts"), {recursive:true});
      await writeFile(join(cwd, ".pi/prompts/complete.md"), '---\\ndescription: Hidden prompt\\n---\\nPrompt');
      await writeFile(join(cwd, ".pi/prompts/greeting.md"), '---\\ndescription: Greeting prompt\\n---\\nPrompt');
      let settings = {...defaultSettings};
      let startup = 0, holdStartup = false;
      const events = [];
      const host = new SessionHost({modelInfo, settings:() => settings, configureModels: m => {m.registerNativeProvider(faux.provider);}, emit: e => events.push(e), emitTerminal(e) {if(e.type === "open") queueMicrotask(() => host.terminalCommand({...e, type:"ready", cols:80, rows:24}));}, emitUI(e) {
        if(e.type !== "request") return;
        if(e.request.kind === "project-trust") queueMicrotask(() => host.resolveExtensionUI({...e.request, kind: "project-trust", value: "once"}));
        if(e.request.kind === "confirm") {startup++; if(!holdStartup) queueMicrotask(() => host.resolveExtensionUI({...e.request, kind: "confirm", value: true}));}
      }});
      host.connectUI({clientId: "root"});
      let chat = await host.openSession({cwd, openId: "first"});
      expect(startup).toBe(1); expect(globalThis.__starts).toBe(1);
      expect(typeof globalThis.__customValue.token).toBe("symbol");
      expect(globalThis.__customDisposed).toBe(1);
      expect(chat.transcript.records.some(r => r.kind === "custom-entry" && r.customType === "fixture")).toBe(true);
      expect(host.drafts.read(chat.address).text).toBe("extension draft");
      expect(host.listSlashCommands(chat.address)).toContainEqual({name:"complete", description:"Complete fixture", category:"extension"});
      expect(await host.completeSlashArguments({...chat.address,name:"complete",argumentPrefix:"abc"})).toEqual([{value:"abc-value",label:"abc",description:"result"}]);
      expect(await host.completeSlashArguments({...chat.address,name:"unknown",argumentPrefix:""})).toEqual([]);
      const commands = host.listSlashCommands(chat.address);
      expect(commands.filter(c => c.name.startsWith("dupe:")).map(c => c.name).sort()).toEqual(["dupe:1", "dupe:2"]);
      expect(commands.filter(c => c.name === "complete")).toHaveLength(1);
      expect(commands).toContainEqual({name:"greeting",description:"Greeting prompt",category:"prompt"});
      expect(commands).toContainEqual({name:"skill:example",description:"Example skill",category:"skill"});
      host.session(chat.info.id).settingsManager.setEnableSkillCommands(false);
      expect(host.listSlashCommands(chat.address).some(c => c.name === "skill:example")).toBe(false);
      host.session(chat.info.id).settingsManager.setEnableSkillCommands(true);
      const initial = chat.address;
      const flags = new DesktopStateStore(join(cwd, "desktop.json"));
      await flags.setSession(chat.info.id, {pinned: true, archived: true});
      const stored = structuredClone(flags.value);
      const send = async (text, answer) => {
        faux.setResponses([fauxAssistantMessage(answer)]);
        await host.prompt({...chat.address, requestId: crypto.randomUUID(), draftRevision: host.drafts.read(chat.address).revision, text});
        await host.receipts.settled();
        chat = host.getSessionSnapshot(chat.address);
      };
      await host.setModel({...chat.address, provider:faux.getModel().provider, id:faux.getModel().id});
      await send("first", "first answer"); await send("second", "old answer");
      const second = chat.transcript.records.filter(r => r.kind === "message" && r.message.role === "user")[1];
      const last = chat.transcript.records.filter(r => r.kind === "message" && r.message.role === "assistant").at(-1);
      const fork = await host.forkSession({...chat.address, entryId:last.entryId});
      expect(fork.info.id).not.toBe(chat.info.id); expect(fork.address.epoch).toBeGreaterThan(chat.address.epoch);
      expect(() => host.getSessionSnapshot(initial)).toThrow("STALE");
      expect(() => host.listSlashCommands(initial)).toThrow("STALE");
      await expect(host.completeSlashArguments({...initial,name:"complete",argumentPrefix:""})).rejects.toThrow("STALE");
      expect(globalThis.__shutdown).toEqual(["fork"]);
      chat = fork;
      await host.setModel({...chat.address, provider:faux.getModel().provider, id:faux.getModel().id});
      chat = await host.rewindSession({...chat.address, entryId:second.entryId});
      expect(JSON.stringify(chat.transcript)).not.toContain("old answer");
      await send("edited second", "new answer");
      expect(JSON.stringify(chat.transcript)).toContain("new answer");
      expect(JSON.stringify(host.session(chat.info.id).messages)).not.toContain("old answer");
      const old = chat.address;
      expect(await host.reloadSession(chat.address)).toEqual({state:"applied"});
      chat = host.runtimeState().sessions[0].snapshot;
      expect(chat.address.sessionId).toBe(old.sessionId); expect(chat.address.epoch).toBeGreaterThan(old.epoch);
      expect(globalThis.__starts).toBe(3); expect(globalThis.__shutdown).toEqual(["fork", "reload"]);
      const errorSend = {...chat.address, requestId:"handled-error", draftRevision:host.drafts.read(chat.address).revision, text:"/boom"};
      expect(await host.prompt(errorSend)).toEqual({disposition:"handled"}); await host.receipts.settled();
      expect(host.getSessionSnapshot(chat.address).failure).toContain("command failure fixture");
      // The SDK's real tools retain cwd, error/details and image behavior.
      const toolSend = async (text, images) => {await host.prompt({...chat.address, requestId:crypto.randomUUID(), text, images, draftRevision:host.drafts.read(chat.address).revision}); await host.receipts.settled();};
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall("write", {path:"fixture.txt",content:"before"}), {stopReason:"toolUse"}),
        fauxAssistantMessage(fauxToolCall("edit", {path:"fixture.txt",edits:[{oldText:"before",newText:"after"}]}), {stopReason:"toolUse"}),
        fauxAssistantMessage(fauxToolCall("read", {path:"fixture.txt"}), {stopReason:"toolUse"}), fauxAssistantMessage("tools done")
      ]);
      await toolSend("tools"); expect(await readFile(join(cwd,"fixture.txt"),"utf8")).toBe("after");
      globalThis.__denyWrites = true;
      faux.setResponses([fauxAssistantMessage(fauxToolCall("write", {path:"denied.txt",content:"must not execute"}), {stopReason:"toolUse"}), fauxAssistantMessage("denied")]);
      await toolSend("permission denial"); expect(existsSync(join(cwd,"denied.txt"))).toBe(false); globalThis.__denyWrites = false;
      const bitmap = Buffer.alloc(58); bitmap.write("BM"); bitmap.writeUInt32LE(58,2); bitmap.writeUInt32LE(54,10); bitmap.writeUInt32LE(40,14); bitmap.writeInt32LE(1,18); bitmap.writeInt32LE(1,22); bitmap.writeUInt16LE(1,26); bitmap.writeUInt16LE(24,28); bitmap.writeUInt32LE(4,34);
      await writeFile(join(cwd,"image.bmp"),bitmap);
      const image = {type:"image",mimeType:"image/bmp",data:bitmap.toString("base64")};
      settings = {...settings, blockImages:true};
      faux.setResponses([fauxAssistantMessage(fauxToolCall("read", {path:"image.bmp"}), {stopReason:"toolUse"}), transcript => {expect(JSON.stringify(transcript)).not.toContain('"type":"image"'); return fauxAssistantMessage("blocked");}]);
      await toolSend("blocked",[image]);
      expect(JSON.stringify(host.session(chat.info.id).sessionManager.getEntries())).not.toContain('"type":"image"');
      settings = {...settings,blockImages:false};
      faux.setResponses([fauxAssistantMessage(fauxToolCall("read", {path:"image.bmp"}), {stopReason:"toolUse"}), fauxAssistantMessage("unblocked")]);
      await toolSend("unblocked"); expect(JSON.stringify(host.getSessionSnapshot(chat.address).transcript)).toContain('"type":"image"');
      // Prompt images reach the agent as stored file paths, never as image blocks.
      const modelGate = Promise.withResolvers(); let modelStarted = false;
      faux.setResponses([async () => {modelStarted = true; await modelGate.promise; return fauxAssistantMessage("first queued");}, fauxAssistantMessage("queued image")]);
      const queueInput = text => ({...chat.address,requestId:text,text,draftRevision:host.drafts.read(chat.address).revision});
      await host.prompt(queueInput("queue-start")); while(!modelStarted) await Bun.sleep(1);
      expect(await host.prompt({...queueInput("queue-image"),images:[image]})).toEqual({disposition:"queued"});
      modelGate.resolve(); await host.receipts.settled();
      const sentImage = host.session(chat.info.id).messages.filter(m => m.role === "user").at(-1);
      expect(JSON.stringify(sentImage.content)).not.toContain('"type":"image"');
      const imagePath = sentImage.content.find(c => c.type === "text").text.split("\\n").at(-1);
      expect(imagePath).toEndWith(".bmp"); expect(await readFile(imagePath)).toEqual(bitmap);
      // Stop during SDK input/preparation: rejected receipt must never launch a
      // late model, nor leave SDK _isAgentRunActive wedged outside its finally.
      let dispatches = 0;
      faux.setResponses([() => {dispatches++; return fauxAssistantMessage("must not run");}]);
      for (const text of ["slow-input", "slow-start"]) {
        const gate = Promise.withResolvers();
        globalThis.__inputGate = gate.promise; globalThis.__startGate = gate.promise;
        globalThis.__inputStarted = false; globalThis.__startStarted = false;
        const request = {...chat.address, requestId:text, text, draftRevision:host.drafts.read(chat.address).revision};
        const pending = host.prompt(request).then(() => "accepted", () => "cancelled");
        while(!(text === "slow-input" ? globalThis.__inputStarted : globalThis.__startStarted)) await Bun.sleep(1);
        const stopping = host.abort(chat.address);
        expect(host.getPromptReceipt(request).state).toBe("rejected");
        gate.resolve(); expect(await pending).toBe("cancelled"); await stopping;
        expect(host.session(chat.info.id).isStreaming).toBe(false);
      }
      expect(dispatches).toBe(0);
      // During an async settled hook SDK prompt() would return before dispatch.
      // Host holds acceptance pending until the typed public settled event.
      const settled = Promise.withResolvers(); globalThis.__holdSettled = true; globalThis.__settledGate = settled.promise;
      faux.setResponses([fauxAssistantMessage("settling"), fauxAssistantMessage("after settled")]);
      const nextRequest = (text) => ({...chat.address, requestId:text, text, draftRevision:host.drafts.read(chat.address).revision});
      await host.prompt(nextRequest("start-settle"));
      while(!globalThis.__settling) await Bun.sleep(1);
      const deferredRequest = nextRequest("after-settle");
      const deferred = host.prompt(deferredRequest);
      await Bun.sleep(5); expect(host.getPromptReceipt(deferredRequest).state).toBe("pending");
      globalThis.__holdSettled = false; settled.resolve();
      expect(await deferred).toEqual({disposition:"started"}); await host.receipts.settled();
      expect(host.getPromptReceipt(deferredRequest).state).toBe("accepted");
      await host.closeSession(chat.address);
      expect(globalThis.__shutdown).toEqual(["fork", "reload", "quit"]);
      expect(await flags.settled()).toEqual(stored);
      // Root listener exists before open; cancellation destroys late startup results.
      holdStartup = true;
      const pending = host.openSession({cwd, openId:"cancel-startup"}).then(() => "ready", () => "cancelled");
      while(!host.broker.pending().some(r => r.kind === "confirm")) await Bun.sleep(1);
      host.cancelOpen({openId:"cancel-startup"});
      expect(await pending).toBe("cancelled");
      expect(host.getOpenState({openId:"cancel-startup"}).state).toBe("cancelled");
      expect(host.runtimeState().sessions).toHaveLength(0);
      expect(globalThis.__shutdown.at(-1)).toBe("quit");
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
}, 30_000);
