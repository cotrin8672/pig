import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Real SDK and extension loader in an isolated profile; no model/network request.
test("session adapters attach, invoke, reload independently and reject stale ownership", async () => {
  const home = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-adapters-"),
  );
  const extension = `export default function(pi) {
    let enabled = false;
    let timer;
    pi.on("session_start", (_e, ctx) => {
      globalThis.__starts = (globalThis.__starts ?? 0) + 1;
      pi.appendEntry("fixture-state", {enabled});
      timer = setInterval(() => {globalThis.__ticks = (globalThis.__ticks ?? 0) + 1;}, 10);
      globalThis.__fixtureBus = pi.events;
    });
    pi.on("session_shutdown", () => { clearInterval(timer); globalThis.__stops = (globalThis.__stops ?? 0) + 1; });
    pi.registerCommand("flip", {handler: async () => {
      globalThis.__flips = (globalThis.__flips ?? 0) + 1;
      if(globalThis.__gate) await globalThis.__gate;
      enabled = !enabled; pi.appendEntry("fixture-state", {enabled});
    }});
    pi.registerCommand("failure", {handler: async () => {throw new Error("fixture command rejected");}});
  }`;
  const script = `
    import {expect} from "bun:test";
    import {mkdir,writeFile} from "node:fs/promises";
    import {join} from "node:path";
    import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
    import {modelInfo,disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
    const cwd = ${JSON.stringify(home)};
    const source = join(cwd,".pi/extensions/fixture.ts");
    const configFile = join(cwd,"config.ts");
    await mkdir(join(cwd,".pi/extensions"), {recursive:true});
    await writeFile(source,${JSON.stringify(extension)});
    const config = 'import {defineConfig,viewActions} from "@pig/config";' +
      'export default defineConfig({apiVersion:1,sessionAdapters:[{id:"fixture",connect(ctx){' +
      'const source={label:"Fixture",scope:{kind:"session",id:ctx.session.id},freshness:"live"};' +
      'ctx.commands.register({id:"flip",title:"Flip",run:()=>ctx.pi.invoke({name:"flip",source:' + JSON.stringify(source) + '})});' +
      'ctx.commands.register({id:"failure",title:"Failure",run:()=>ctx.pi.invoke({name:"failure",source:' + JSON.stringify(source) + '})});' +
      'ctx.sources.subscribe(()=>{const last=ctx.sources.entries("all").filter(e=>e.customType==="fixture-state").at(-1);' +
      'ctx.views.set({kind:"mode",id:"mode",title:"Fixture mode",source,axis:"fixture",value:last?.data.enabled?"on":"off",choices:[{id:"on",label:"On"},{id:"off",label:"Off"}],actions:[{id:"flip",label:"Flip",command:"flip"},{id:"failure",label:"Failure",command:"failure"}]});});' +
      'ctx.sources.onBus("fixture:update", data=>ctx.views.set({kind:"background",id:"jobs",title:"Jobs",source,runs:[{id:"task",title:String(data),state:{phase:"running"},lifetime:"session"}]}));' +
      'ctx.views.set({kind:"schedule",id:"schedule",title:"Schedule",source,schedules:[{id:"schedule-1",title:"Nightly",enabled:false,timing:{kind:"cron",expression:"0 0 * * *",timezone:"UTC"},runs:[{id:"run-1",title:"Previous run",state:{phase:"running"}}]}]});' +
      'if(viewActions({kind:"status",actions:[]}).length!==0) throw new Error("bad API");' +
      '}}]});';
    await writeFile(configFile,config);
    const host = new SessionHost({modelInfo,configFile,emit(){},emitTerminal(){},emitUI(e){if(e.type==="request" && e.request.kind==="project-trust") queueMicrotask(()=>host.resolveExtensionUI({...e.request,kind:"project-trust",value:"once"}));}});
    host.connectUI({clientId:"root"});
    const chat = await host.openSession({cwd,openId:"first"});
    const originalBus=globalThis.__fixtureBus;
    const snapshot=()=>host.getSessionSnapshot(chat.address);
    const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return; await Bun.sleep(5);} throw new Error("Timed out: "+JSON.stringify(snapshot().sessionUI));};
    await wait(()=>snapshot().sessionUI?.views.length===2);
    expect(snapshot().sessionUI.diagnostics).toEqual([]);
    expect(snapshot().sessionUI.views.find(v=>v.view.kind==="mode").view.value).toBe("off");
    const request=(id="flip")=>{const ui=snapshot().sessionUI;const v=ui.views.find(v=>v.view.kind==="mode");return {...chat.address,generation:ui.generation,adapterId:"fixture",viewId:v.view.id,revision:v.revision,commandId:id,actionId:id};};
    const old=request();
    await host.invokeSessionAction(old);
    await wait(()=>snapshot().sessionUI.views.find(v=>v.view.kind==="mode").view.value==="on");
    await expect(host.invokeSessionAction(old)).rejects.toThrow("STALE");
    expect(globalThis.__flips).toBe(1);
    await expect(host.invokeSessionAction(request("failure"))).rejects.toThrow("fixture command rejected");
    expect(snapshot().sessionUI.diagnostics).toEqual([]);
    globalThis.__fixtureBus.emit("fixture:update","build");
    await wait(()=>snapshot().sessionUI.views.some(v=>v.view.kind==="background"));
    const starts=globalThis.__starts;
    const generation=snapshot().sessionUI.generation;
    const ticks=globalThis.__ticks ?? 0;
    expect(await host.reloadAdapterConfig()).toEqual({state:"applied"});
    await wait(()=>snapshot().sessionUI.generation!==generation && snapshot().sessionUI.views.length===2);
    await Bun.sleep(25);
    expect(globalThis.__ticks).toBeGreaterThan(ticks);
    expect(globalThis.__starts).toBe(starts);
    expect(globalThis.__stops ?? 0).toBe(0);
    await expect(host.invokeSessionAction(old)).rejects.toThrow("STALE");
    const cachedUI=snapshot().sessionUI;
    expect(snapshot().sessionUI).toBe(cachedUI);
    await writeFile(configFile,'export default {apiVersion:1,sessionAdapters:[{id:"broken",connect(){throw new Error("cached adapter failure");}}]};');
    expect(await host.reloadAdapterConfig()).toEqual({state:"applied"});
    await wait(()=>snapshot().sessionUI.diagnostics.some(d=>d.message==="cached adapter failure"));
    expect(snapshot().sessionUI).not.toBe(cachedUI);
    await writeFile(configFile,config);
    expect(await host.reloadAdapterConfig()).toEqual({state:"applied"});
    await wait(()=>snapshot().sessionUI.views.length===2 && snapshot().sessionUI.diagnostics.length===0);
    const goodGeneration=snapshot().sessionUI.generation;
    await writeFile(configFile,"export default {broken");
    expect(await host.reloadAdapterConfig()).toEqual({state:"failed"});
    expect(snapshot().sessionUI.generation).toBe(goodGeneration);
    expect(snapshot().configError).toContain(configFile);
    await writeFile(configFile,config);
    const gate=Promise.withResolvers(); globalThis.__gate=gate.promise;
    const pending=host.invokeSessionAction(request());
    const leafBefore = host.session(chat.info.id).sessionManager.getLeafId();
    await expect(host.rewindSession({...chat.address,entryId:"not-reached"})).rejects.toThrow("SESSION_TRANSITION_BUSY");
    expect(host.session(chat.info.id).sessionManager.getLeafId()).toBe(leafBefore);
    await Bun.sleep(1);
    expect(await host.reloadAdapterConfig()).toEqual({state:"pending"});
    gate.resolve(); await pending; globalThis.__gate=undefined;
    await wait(()=>snapshot().sessionUI.generation!==goodGeneration);
    expect(globalThis.__starts).toBe(starts);
    const second=await host.openSession({cwd,openId:"second"});
    await Bun.sleep(5);
    globalThis.__fixtureBus.emit("fixture:update","second only");
    await Bun.sleep(5);
    expect(host.getSessionSnapshot(second.address).sessionUI.views.some(v=>v.view.kind==="background")).toBe(true);
    expect(snapshot().sessionUI.views.some(v=>v.view.kind==="background")).toBe(false);
    const missing=request();
    host.session(chat.info.id).resourceLoader.getExtensions().extensions.find(e=>e.path===source).commands.delete("flip");
    await expect(host.invokeSessionAction(missing)).rejects.toThrow("EXTENSION_COMMAND_UNAVAILABLE");
    expect(host.session(chat.info.id).messages).toHaveLength(0);
    const beforeReload=chat.address;
    expect(await host.reloadSession(beforeReload)).toEqual({state:"applied"});
    const next=host.sessionAddress(chat.info.id);
    expect(()=>originalBus.emit("fixture:update","retired runtime")).toThrow("stale");
    await Bun.sleep(5);
    expect(host.getSessionSnapshot(next).sessionUI.views.some(v=>v.view.kind==="background")).toBe(false);
    expect(next.epoch).toBeGreaterThan(beforeReload.epoch);
    await expect(host.invokeSessionAction({...missing,generation:host.getSessionSnapshot(next).sessionUI.generation})).rejects.toThrow("STALE_SESSION_ADDRESS");
    await host.closeSession(next); await host.closeSession(second.address);
    await host.dispose(); await disposeSessions();
  `;
  try {
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

test("official Pi todo and plan-mode project through user adapters with a real SDK", async () => {
  const home = await mkdtemp(
    join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "pig-official-adapters-"),
  );
  const sdkRoot = new URL(
    "../../node_modules/@earendil-works/pi-coding-agent/examples/extensions/",
    import.meta.url,
  );
  const adapterPath = fileURLToPath(
    new URL("../../../../examples/session-ui/pi-adapters.ts", import.meta.url),
  );
  const script = `
    import {expect} from "bun:test";
    import {mkdir,writeFile} from "node:fs/promises";
    import {join} from "node:path";
    import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
    import {modelInfo,disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
    const cwd=${JSON.stringify(home)};
    const planPath=join(cwd,".pi/extensions/plan-mode/index.ts");
    await mkdir(join(cwd,".pi/extensions/plan-mode"),{recursive:true});
    await writeFile(join(cwd,".pi/extensions/todo.ts"),${JSON.stringify(await Bun.file(new URL("todo.ts", sdkRoot)).text())});
    await writeFile(planPath,${JSON.stringify(await Bun.file(new URL("plan-mode/index.ts", sdkRoot)).text())});
    await writeFile(join(cwd,".pi/extensions/plan-mode/utils.ts"),${JSON.stringify(await Bun.file(new URL("plan-mode/utils.ts", sdkRoot)).text())});
    const configFile=join(cwd,"config.ts");
    await writeFile(configFile,'import {connectPiTodos,connectPiPlanMode} from '+JSON.stringify(${JSON.stringify(adapterPath)})+';export default {apiVersion:1,sessionAdapters:[connectPiTodos(),connectPiPlanMode({source:'+JSON.stringify(planPath)+'})]};');
    const updates=new Set();
    const host=new SessionHost({modelInfo,configFile,emit(){for(const update of updates)update();},emitTerminal(){},emitUI(e){if(e.type==="request"&&e.request.kind==="project-trust")queueMicrotask(()=>host.resolveExtensionUI({...e.request,kind:"project-trust",value:"once"}));}});
    host.connectUI({clientId:"root"});
    const chat=await host.openSession({cwd,openId:"official"});
    let address=chat.address;
    const snapshot=()=>host.getSessionSnapshot(address);
    const wait=(fn)=>fn()?Promise.resolve():new Promise(resolve=>{const update=()=>{if(fn()){updates.delete(update);resolve();}};updates.add(update);});
    await wait(()=>snapshot().sessionUI?.views.some(v=>v.view.kind==="mode"));
    expect(snapshot().sessionUI.diagnostics).toEqual([]);
    // Exercise the official tool and saved-state projection, not an unrelated model turn.
    const session=host.session(chat.info.id);
    const todo=session.agent.state.tools.find(tool=>tool.name==="todo");
    expect(todo).toBeDefined();
    const result=await todo.execute("todo",{action:"add",text:"Actual SDK todo"});
    session.sessionManager.appendMessage({role:"toolResult",toolCallId:"todo",toolName:"todo",...result,isError:false,timestamp:Date.now()});
    expect(await host.reloadSession(address)).toEqual({state:"applied"});
    address=host.sessionAddress(chat.info.id);
    await wait(()=>snapshot().sessionUI?.views.some(v=>v.view.kind==="todo"&&v.view.items.some(i=>i.title==="Actual SDK todo")));
    const ui=snapshot().sessionUI;
    const mode=ui.views.find(v=>v.view.kind==="mode");
    const toggle=mode.view.actions[0];
    expect(toggle.confirmation).toBeTruthy();
    await host.invokeSessionAction({...address,generation:ui.generation,adapterId:mode.adapterId,viewId:mode.view.id,revision:mode.revision,commandId:toggle.command,actionId:toggle.id});
    await wait(()=>snapshot().sessionUI.views.some(v=>v.view.kind==="mode"&&v.view.value==="plan"));
    expect(host.session(chat.info.id).sessionManager.getEntries().some(e=>e.type==="custom"&&e.customType==="plan-mode"&&e.data.enabled)).toBe(true);
    await host.dispose();await disposeSessions();
  `;
  try {
    const scriptFile = join(home, "official-check.ts");
    await writeFile(scriptFile, script);
    const child = Bun.spawn([process.execPath, scriptFile], {
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
