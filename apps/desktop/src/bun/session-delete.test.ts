import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("deletion handles unsaved chats and persisted history without accepting foreign or missing sessions", async () => {
  const home = await mkdtemp(join(tmpdir(), "pig-session-delete-"));
  try {
    const script = `
      import {expect} from "bun:test";
      import {existsSync} from "node:fs";
      import {mkdir,readFile,writeFile} from "node:fs/promises";
      import {basename,join} from "node:path";
      import {defaultSessionDir} from ${JSON.stringify(new URL("./session-directory.ts", import.meta.url).href)};
      import {agentDir} from ${JSON.stringify(new URL("./runtime-profile.ts", import.meta.url).href)};
      import {fauxProvider} from "@earendil-works/pi-ai";
      import {SessionHost} from ${JSON.stringify(new URL("./session-host.ts", import.meta.url).href)};
      import {modelInfo,disposeSessions} from ${JSON.stringify(new URL("./pi-service.ts", import.meta.url).href)};
      const cwd = ${JSON.stringify(home)};
      const faux = fauxProvider();
      const events = [];
      const host = new SessionHost({modelInfo,recoveryFile:join(cwd,"recovery.sqlite"),configureModels:m=>m.registerNativeProvider(faux.provider),emit:e=>events.push(e),emitTerminal(){},emitUI(e){
        if(e.type === "request" && e.request.kind === "project-trust") queueMicrotask(()=>host.resolveExtensionUI({...e.request,kind:"project-trust",value:"once"}));
      }});
      const open = () => host.openSession({cwd,openId:crypto.randomUUID()});
      try {
        for(const renamed of [false,true]) {
          const chat = await open();
          const file = host.session(chat.info.id).sessionManager.getSessionFile();
          if(renamed) await host.renameSession(chat.info,"Still unsaved");
          host.syncDraft({...chat.address,expectedRevision:0,content:{text:"Unsent draft",pastes:[],images:[]}});
          expect(existsSync(file)).toBe(false);
          const info = await host.findSession(cwd,chat.info.id);
          await host.deleteSession(info);
          expect(existsSync(file)).toBe(false);
          expect(await host.listSessions(cwd)).toEqual([]);
          expect(host.runtimeState().sessions).toHaveLength(0);
          expect(host.runtimeState().retainedDrafts).toHaveLength(0);
          expect(events.some(e=>e.type === "closed" && e.address.sessionId === info.id && e.discardDraft)).toBe(true);
        }
        for(const closed of [false,true]) {
          const chat = await open();
          const manager = host.session(chat.info.id).sessionManager;
          manager.appendMessage({role:"user",content:"Persisted",timestamp:1});
          const file = manager.getSessionFile();
          expect(existsSync(file)).toBe(true);
          if(!closed){
            const other=join(cwd,"copy-project"), directory=defaultSessionDir(other,agentDir);
            await mkdir(other,{recursive:true});await mkdir(directory,{recursive:true});
            const original=await readFile(file,"utf8");
            const lines=original.split("\\n");lines[0]=JSON.stringify({...JSON.parse(lines[0]),cwd:other});
            const copy=join(directory,basename(file));
            await writeFile(copy,lines.join("\\n"));
            const copied=await host.findSession(other,chat.info.id);
            expect(copied.cwd).toBe(other);
            expect(()=>host.sessionAddress(copied.id,other)).toThrow("does not belong");
            await expect(host.renameSession(copied,"Copy title")).rejects.toThrow("does not belong");
            expect(await readFile(file,"utf8")).toBe(original);
            expect(await readFile(copy,"utf8")).toBe(lines.join("\\n"));
          }
          if(closed) await host.closeSession(chat.address);
          await expect(host.findSession(join(cwd,"foreign"),chat.info.id)).rejects.toThrow("does not belong");
          await expect(host.deleteSession({...chat.info,cwd:join(cwd,"foreign")})).rejects.toThrow("does not belong");
          expect(existsSync(file)).toBe(true);
          await host.deleteSession(await host.findSession(cwd,chat.info.id));
          expect(existsSync(file)).toBe(false);
          expect(await host.listSessions(cwd)).toEqual([]);
        }
        await expect(host.deleteSession({id:"missing-id",cwd,title:"",modified:0})).rejects.toThrow("not found");
      } finally {
        await host.dispose(); await disposeSessions();
      }
    `;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PI_OFFLINE: "1",
    };
    delete env.PI_CODING_AGENT_DIR;
    delete env.PI_CODING_AGENT_SESSION_DIR;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, "../.."),
      env,
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
