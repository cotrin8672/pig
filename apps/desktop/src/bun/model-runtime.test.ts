import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("user-only catalog and same-cwd/different-cwd SDK ModelRuntimes isolate provider removal", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-sdk-models-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {mkdir,writeFile,rm} from "node:fs/promises";
      import {join} from "node:path";
      const home = ${JSON.stringify(home)};
      const global = join(home,".config/pig");
      const source = (provider,model) => 'export default function(pi) {pi.registerProvider(' + JSON.stringify(provider) + ', {api:"openai-completions",baseUrl:"http://fixture.invalid",models:[{id:' + JSON.stringify(model) + ',name:' + JSON.stringify(model) + '}]});}';
      await mkdir(join(global,"extensions"),{recursive:true});
      await writeFile(join(global,"extensions/user.ts"),source("user-fixture","user-model"));
      const app = await import(${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)});
      const {SessionHost} = await import(${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)});
      if(!app.runtime.getModel("user-fixture","user-model")) throw new Error(JSON.stringify(app.modelErrors));
      expect(app.runtime.getModel("user-fixture","user-model")).toBeDefined();
      expect((await app.listProviders()).find(p => p.id === "user-fixture").extension).toBe(true);
      expect((await app.listProviders()).find(p => p.id === "openai-api").extension).toBe(false);
      const a = join(home,"a"), b = join(home,"b");
      for(const [cwd,model] of [[a,"a-model"],[b,"b-model"]]) {
        await mkdir(join(cwd,".pi/extensions"),{recursive:true});
        await writeFile(join(cwd,".pi/extensions/provider.ts"),source("workspace-fixture",model));
      }
      let host;
      host = new SessionHost({credentials:app.credentials,modelInfo:app.modelInfo,emit(){},emitTerminal(){},emitUI(e){if(e.type === "request" && e.request.kind === "project-trust") queueMicrotask(() => host.resolveExtensionUI({...e.request,kind:"project-trust",value:"once"}));}});
      host.connectUI({clientId:"root"});
      const first = await host.openSession({cwd:a,openId:"a1"});
      const same = await host.openSession({cwd:a,openId:"a2"});
      const other = await host.openSession({cwd:b,openId:"b"});
      const A = host.session(first.info.id).modelRuntime, C = host.session(same.info.id).modelRuntime, B = host.session(other.info.id).modelRuntime;
      expect(A).not.toBe(B); expect(A).not.toBe(C); expect(A).not.toBe(app.runtime);
      expect(A.getModel("workspace-fixture","a-model")).toBeDefined();
      expect(B.getModel("workspace-fixture","b-model")).toBeDefined();
      expect(C.getModel("workspace-fixture","a-model")).toBeDefined();
      expect(app.runtime.getProvider("workspace-fixture")).toBeUndefined();
      await app.credentials.modify("workspace-fixture",async()=>({type:"api_key",key:"fixture-only"}));
      await app.refreshModels({providers:["workspace-fixture"],allowNetwork:false});
      expect((await A.getAvailable("workspace-fixture")).length).toBe(1); expect((await B.getAvailable("workspace-fixture")).length).toBe(1);
      await rm(join(a,".pi/extensions/provider.ts"));
      await host.reloadSession(first.address);
      expect(A.getProvider("workspace-fixture")).toBeUndefined();
      expect(C.getModel("workspace-fixture","a-model")).toBeDefined(); expect(B.getModel("workspace-fixture","b-model")).toBeDefined();
      expect(app.runtime.getModel("user-fixture","user-model")).toBeDefined();
      await host.reloadSession(same.address); expect(C.getProvider("workspace-fixture")).toBeUndefined();
      // Disposing twice is a single owned shutdown; new opens fail closed.
      const closing = host.dispose(); expect(host.dispose()).toBe(closing); await closing;
      await expect(host.openSession({cwd:b,openId:"after-close"})).rejects.toThrow("shutting down");
      await app.disposeSessions();
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
